/**
 * Behaviour test for the three failure lines in `client.js`.
 *
 * The bundle is a function body served by the browser module table, so the
 * way to prove its behaviour without a page is the technique the sibling
 * `client-save-to-hub.test.js` uses: a stub module table plus a minimal React
 * with per-mount hook state. What it proves here is that the three
 * diagnostics — a missing `renderFactorySlot`, a missing `SessionProvider`,
 * and the error boundary's prefix — are read out of the registered
 * dictionaries instead of a hardcoded copy, and that a dictionary answering
 * the key itself still leaves the built-in copy standing.
 *
 * One part is deliberately absent: a real-React render. This package ships no
 * dependency and may not gain one, so `react` does not resolve in a clean
 * checkout and CI could not run it. `node --check` plus this file are the
 * whole of what CI can verify here.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// `window` must exist before the module is imported: client.js reads
// `__ModuleLoader__` at module scope.
const loaded = []
globalThis.window = { __ModuleLoader__: { load: entry => { loaded.push(entry) } } }
await import(pathToFileURL(path.join(PACKAGE_DIR, 'client.js')).href)

/** A minimal React: enough for a function component with state. */
const React = {
  createElement(type, props, ...children) {
    return {
      type,
      props: props ?? {},
      children: children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false),
    }
  },
  // The error boundary the conversation half declares extends it. The
  // boundary is instantiated directly rather than mounted — reaching its
  // error branch through a real React would mean throwing from a child — so
  // an empty base is all the class statement needs.
  Component: class {
    constructor(props) {
      this.props = props ?? {}
    }
  },
  useState(initial) {
    const record = active
    const index = record.cursor++
    if (record.hooks.length <= index) record.hooks[index] = initial
    return [record.hooks[index], value => {
      record.hooks[index] = typeof value === 'function' ? value(record.hooks[index]) : value
      record.render()
    }]
  },
}

/** Per-mount hook state: two mounted instances must not share it. */
let active
const mount = (Component, props) => {
  const record = {
    hooks: [],
    cursor: 0,
    tree: undefined,
    render: () => {
      record.cursor = 0
      active = record
      record.tree = Component(props)
    },
  }
  record.render()
  return record
}

const texts = node => (node === null || node === undefined
  ? []
  : [typeof node === 'string' ? node : '', ...(node.children ?? []).flatMap(texts)])

/** The whole rendered text of one mount, as one string. */
const rendered = record => texts(record.tree).join('')

/**
 * Build the plugin object once.
 *
 * The browser module table serves one entry per package, so one factory call
 * is one module instance: every applied composition binds its own
 * `translate`, the way a fresh page load would.
 */
const makePlugin = () => loaded[0].factory(name => {
  if (name === 'react') return React
  throw new Error(`unexpected require(${name})`)
})

/**
 * Apply one plugin instance against a stub Cordis context.
 *
 * `language` picks the dictionary the stub bind reads, exactly as the active
 * locale does at runtime. An unregistered language answers the key itself,
 * which is the shape a stale dictionary produces and the reason every
 * component keeps a built-in fallback.
 */
const applyTo = (plugin, { language = 'zh' } = {}) => {
  const registrations = []
  const dictionaries = new Map()
  const ctx = {
    effect: callback => { callback(); return () => {} },
    // The tab half injects the sidebar, resource and session registries; the
    // stub answers with the two the apply body actually touches.
    inject: (_deps, callback) => callback({
      resources: { register: () => () => {} },
      sidebarRightTabs: { register: () => () => {} },
      sessions: {},
    }),
    // No Hub namespace in this composition: none of the three diagnostics
    // reads it.
    get: () => undefined,
    // Dictionary-aware on purpose: a bind returning the raw key would let a
    // missing dictionary entry pass every assertion below.
    locale: {
      register: (ns, dicts) => { dictionaries.set(ns, dicts); return () => {} },
      bind: ns => key => dictionaries.get(ns)?.[language]?.[key] ?? key,
    },
    slots: {
      inject: (_key, callback) => callback(),
      register: (options, component) => { registrations.push({ options, component }); return () => {} },
    },
  }
  plugin.apply(ctx)
  return { registrations, dictionaries }
}

/** The packaged dictionaries: the second home of the same strings. */
const packaged = {
  zh: JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'locale/zh.json'), 'utf8')),
  en: JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'locale/en.json'), 'utf8')),
}

/** The three diagnostic keys, in the order the components meet them. */
const DIAG_KEYS = ['diag.noFactorySlot', 'diag.noSessionProvider', 'diag.boundaryPrefix']

/** The embedded conversation's component out of one applied composition. */
const conversationComponent = registrations => {
  const entry = registrations.find(candidate => candidate.options.name === 'promptchat.conversation')
  assert.notEqual(entry, undefined, 'the embedded conversation entry is not registered')
  return entry.component
}

/** The tab body's component out of one applied composition. */
const chatTabComponent = registrations => {
  const entry = registrations.find(candidate => candidate.options.name === 'sidebar.right.pane.tab')
  assert.notEqual(entry, undefined, 'the prompt chat tab entry is not registered')
  return entry.component
}

/**
 * Store readers for the embedded conversation.
 *
 * A blank, open session keeps the phase computation on its shortest path to
 * the `renderFactorySlot` check, which is the branch under test.
 */
const conversationProps = {
  useSession: value => value({ blank: true, awaitingFirstTurn: false, openState: 'open' }),
  useConversation: value => value({ activeTargets: new Set() }),
  useSessions: value => value({ byId: {} }),
}

/**
 * A retained prompt-chat resource, as the tab body reads it.
 *
 * `SessionProvider` is absent on purpose: the session-scoped child slot is
 * what injects it, and a composition that does not is the failure under test.
 */
const chatTabProps = {
  useTabInfo: () => ({ tab: { contentId: 'dsh-resource://promptchat/session/s1' } }),
  useResource: () => ({ value: { reference: { sessionId: 's1' } } }),
  renderSlot: () => null,
}

/** The boundary class, reached as the conversation's wrapper element type. */
const boundaryOf = registrations => {
  const tree = mount(conversationComponent(registrations),
    { ...conversationProps, renderFactorySlot: () => null }).tree
  assert.equal(typeof tree.type, 'function', 'the conversation did not wrap its slot in the error boundary')
  return tree.type
}

/** One boundary instance with its error state already set. */
const failedBoundary = (Boundary, message) => {
  const boundary = new Boundary({})
  boundary.state = { error: message }
  return boundary.render()
}

describe('registration', () => {
  it('registers the three diagnostic keys in both dictionaries with identical key sets', () => {
    const { dictionaries } = applyTo(makePlugin())
    const zh = dictionaries.get('prompt-mode')?.zh ?? {}
    const en = dictionaries.get('prompt-mode')?.en ?? {}
    assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
    for (const key of DIAG_KEYS) {
      assert.equal(typeof en[key], 'string', `en is missing "${key}"`)
      assert.notEqual(en[key].trim(), '', `en["${key}"] is blank`)
      assert.notEqual(zh[key].trim(), '', `zh["${key}"] is blank`)
    }
  })

  it('keeps the packaged dictionaries carrying the same diagnostic copy', () => {
    // The client bundle registers its dictionaries in code — the browser
    // cannot read the shipped files — so the packaged pair is a second home
    // for the same strings, and this is what stops the two from drifting.
    const { dictionaries } = applyTo(makePlugin())
    const registered = dictionaries.get('prompt-mode')
    for (const language of ['zh', 'en']) {
      for (const key of DIAG_KEYS) {
        assert.equal(registered[language][key], packaged[language][key],
          `locale/${language}.json and the registered ${language} dictionary disagree on "${key}"`)
      }
    }
  })
})

describe('the missing renderFactorySlot diagnostic', () => {
  it('renders the dictionary copy instead of a hardcoded line', () => {
    const zh = applyTo(makePlugin(), { language: 'zh' })
    const en = applyTo(makePlugin(), { language: 'en' })
    const zhText = rendered(mount(conversationComponent(zh.registrations), conversationProps))
    const enText = rendered(mount(conversationComponent(en.registrations), conversationProps))
    assert.equal(zhText, packaged.zh['diag.noFactorySlot'])
    assert.equal(enText, packaged.en['diag.noFactorySlot'])
    assert.notEqual(zhText, enText, 'both languages rendered the same text')
  })

  it('falls back to the built-in copy when translate answers the key', () => {
    const { registrations } = applyTo(makePlugin(), { language: 'ja' })
    const text = rendered(mount(conversationComponent(registrations), conversationProps))
    assert.equal(text, packaged.zh['diag.noFactorySlot'])
  })
})

describe('the missing SessionProvider diagnostic', () => {
  it('renders the dictionary copy in the tab body', () => {
    const zh = applyTo(makePlugin(), { language: 'zh' })
    const en = applyTo(makePlugin(), { language: 'en' })
    const zhText = rendered(mount(chatTabComponent(zh.registrations), chatTabProps))
    const enText = rendered(mount(chatTabComponent(en.registrations), chatTabProps))
    assert.ok(zhText.includes(packaged.zh['diag.noSessionProvider']), `the zh tab body rendered: ${zhText}`)
    assert.ok(enText.includes(packaged.en['diag.noSessionProvider']), `the en tab body rendered: ${enText}`)
  })

  it('falls back to the built-in copy when translate answers the key', () => {
    const { registrations } = applyTo(makePlugin(), { language: 'ja' })
    const text = rendered(mount(chatTabComponent(registrations), chatTabProps))
    assert.ok(text.includes(packaged.zh['diag.noSessionProvider']), `the tab body rendered: ${text}`)
  })
})

describe('the error boundary prefix', () => {
  it('prefixes the failure with the dictionary copy', () => {
    const message = 'the host conversation threw'
    const zh = applyTo(makePlugin(), { language: 'zh' })
    const en = applyTo(makePlugin(), { language: 'en' })
    const zhText = texts(failedBoundary(boundaryOf(zh.registrations), message)).join('')
    const enText = texts(failedBoundary(boundaryOf(en.registrations), message)).join('')
    assert.equal(zhText, `${packaged.zh['diag.boundaryPrefix']}${message}`)
    assert.equal(enText, `${packaged.en['diag.boundaryPrefix']}${message}`)
    assert.notEqual(zhText, enText, 'both languages rendered the same text')
  })

  it('falls back to the built-in copy when translate answers the key', () => {
    const { registrations } = applyTo(makePlugin(), { language: 'ja' })
    const text = texts(failedBoundary(boundaryOf(registrations), 'boom')).join('')
    assert.equal(text, `${packaged.zh['diag.boundaryPrefix']}boom`)
  })
})
