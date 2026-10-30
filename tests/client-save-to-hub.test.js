/**
 * Behaviour test for the save-to-Hub button in `client.js`.
 *
 * The bundle is a function body served by the browser module table, so the way
 * to prove its behaviour without a page is the technique the sibling
 * `check-optimize.mjs` uses: a stub module table plus a minimal React with
 * per-mount hook state. That covers the parts a page refresh would otherwise
 * be the only way to see — the registration shape, the disabled and hidden
 * states, and every click path including the failures.
 *
 * One part is deliberately absent: a real-React render. This package ships no
 * dependency and may not gain one, so `react` does not resolve in a clean
 * checkout and CI could not run it. `node --check` plus this file are the whole
 * of what CI can verify here.
 */
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
  // The error boundary the tab half declares extends it; nothing in this suite
  // ever instantiates one, so an empty base is all the class statement needs.
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

const find = (node, predicate) => {
  if (node === null || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  for (const child of node.children ?? []) {
    const hit = find(child, predicate)
    if (hit !== undefined) return hit
  }
  return undefined
}
const texts = node => (node === null || node === undefined
  ? []
  : [typeof node === 'string' ? node : '', ...(node.children ?? []).flatMap(texts)])
const click = node => node.props.onClick()
const buttonsOf = node => {
  const out = []
  const walk = current => {
    if (current?.type === 'button') out.push(current)
    for (const child of current?.children ?? []) walk(child)
  }
  walk(node)
  return out
}
/** Let the awaited Remote call settle: its continuation is a microtask. */
const flush = async () => {
  for (let round = 0; round < 10; round++) await Promise.resolve()
}

/** The whole rendered text of one mount, as one string. */
const rendered = record => texts(record.tree).join('')

/**
 * Build the plugin object once.
 *
 * The browser module table serves one entry per package, so one factory call
 * is one module instance: applying the same instance to a second context is
 * what an unload-and-reload of the Hub bundle looks like from in here.
 */
const makePlugin = () => loaded[0].factory(name => {
  if (name === 'react') return React
  throw new Error(`unexpected require(${name})`)
})

/**
 * Apply one plugin instance against a stub Cordis context.
 *
 * `hub` is the `remote.hub` namespace service as the Hub plugin's mounted
 * Remote provides it: `undefined` models a composition where the Hub bundle is
 * not installed at all, which is the case the button must degrade through.
 */
const applyTo = (plugin, { hub, language = 'zh', throwingGet = false } = {}) => {
  const registrations = []
  const dictionaries = new Map()
  const services = new Map()
  if (hub !== undefined) services.set('remote.hub', hub)
  const ctx = {
    effect: callback => { callback(); return () => {} },
    // The tab half injects the sidebar, resource and session registries; the
    // stub answers with the two the apply body actually touches.
    inject: (_deps, callback) => callback({
      resources: { register: () => () => {} },
      sidebarRightTabs: { register: () => () => {} },
      sessions: {},
    }),
    get: name => {
      if (throwingGet) throw new Error(`service "${name}" was not injected`)
      return services.get(name)
    },
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
  return { registrations, dictionaries, plugin }
}

/** Apply a fresh module instance, the way a fresh page load would. */
const applyClient = async (options = {}) => applyTo(makePlugin(), options)

/** The save-to-Hub entry's component out of one applied composition. */
const saveComponent = registrations => {
  const entry = registrations.find(candidate => candidate.options.id === 'prompt-mode.save-to-hub')
  assert.notEqual(entry, undefined, 'the save-to-Hub entry is not registered')
  return entry.component
}

/** A draft reader shaped like the seat's injected `useInput`. */
const readerOf = draft => selector => selector({ draft })

describe('registration', () => {
  it('declares only the services it reads, so a Hub-less composition still activates', async () => {
    const { plugin } = await applyClient({})
    // `remote.hub` is another bundle's service: declaring it in `inject` would
    // park this entry forever in a composition without Hub, which is the one
    // degradation this button exists to survive.
    assert.deepEqual(plugin.inject, ['slots', 'locale'])
  })

  it('adds a second compact button in the same seat, after the launcher', async () => {
    const { registrations } = await applyClient({})
    const left = registrations.filter(entry => entry.options.name === 'conversation.input.left')
    assert.deepEqual(left.map(entry => [entry.options.id, entry.options.order]),
      [['prompt-mode.launcher', 30], ['prompt-mode.save-to-hub', 40]])
    for (const entry of left) assert.equal(entry.options.locale, 'prompt-mode')
  })

  it('registers the new keys in both dictionaries with identical key sets', async () => {
    const { dictionaries } = await applyClient({})
    const zh = dictionaries.get('prompt-mode')?.zh ?? {}
    const en = dictionaries.get('prompt-mode')?.en ?? {}
    const hubKeys = Object.keys(zh).filter(key => key.startsWith('hub.'))
    assert.ok(hubKeys.length >= 8, `expected the hub.* keys, found ${hubKeys.join(',')}`)
    assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
    for (const key of hubKeys) {
      assert.equal(typeof en[key], 'string', `en is missing "${key}"`)
      assert.notEqual(en[key].trim(), '', `en["${key}"] is blank`)
      assert.notEqual(zh[key].trim(), '', `zh["${key}"] is blank`)
    }
  })

  it('routes every user-visible string through the dictionary', async () => {
    // A component that hardcoded its copy would render the same text in both
    // languages, which is what this catches.
    const zh = await applyClient({ hub: { create: async () => ({ ok: true, value: {} }) }, language: 'zh' })
    const en = await applyClient({ hub: { create: async () => ({ ok: true, value: {} }) }, language: 'en' })
    const draft = '帮我写一个登录页'
    const zhLabel = texts(mount(saveComponent(zh.registrations), { useInput: readerOf(draft) }).tree).join('')
    const enLabel = texts(mount(saveComponent(en.registrations), { useInput: readerOf(draft) }).tree).join('')
    assert.notEqual(zhLabel, enLabel, 'both languages rendered the same text')
    assert.match(zhLabel, /存到 Hub/)
    assert.match(enLabel, /Save to Hub/)
  })
})

describe('the save-to-Hub button', () => {
  it('is hidden when Hub is not installed', async () => {
    const { registrations } = await applyClient({})
    const tree = mount(saveComponent(registrations), { useInput: readerOf('帮我写一个登录页') }).tree
    assert.equal(tree, null, 'the entry rendered something without a Hub to save to')
  })

  it('is hidden when the namespace exists but exposes no create', async () => {
    const { registrations } = await applyClient({ hub: {} })
    const tree = mount(saveComponent(registrations), { useInput: readerOf('帮我写一个登录页') }).tree
    assert.equal(tree, null)
  })

  it('is disabled and says why when the draft is empty', async () => {
    const { registrations } = await applyClient({ hub: { create: async () => ({ ok: true, value: {} }) } })
    const mounted = mount(saveComponent(registrations), { useInput: readerOf('   \n  ') })
    const [button] = buttonsOf(mounted.tree)
    assert.equal(button.props.disabled, true)
    assert.match(String(button.props.title ?? ''), /输入框是空的|empty/)
  })

  it('says so instead of showing a dead button when the seat injected no useInput', async () => {
    const { registrations } = await applyClient({ hub: { create: async () => ({ ok: true, value: {} }) } })
    const mounted = mount(saveComponent(registrations), {})
    assert.match(rendered(mounted), /useInput/)
    assert.equal(buttonsOf(mounted.tree).length, 0)
  })

  it('creates one Prompt item from the draft and keeps the draft', async () => {
    const calls = []
    const writes = []
    const { registrations } = await applyClient({
      hub: { create: async draft => { calls.push(draft); return { ok: true, value: { id: 'p1', ...draft } } } },
    })
    const draft = '\n  第一行是标题  \n第二行是正文\n第三行'
    const mounted = mount(saveComponent(registrations), {
      useInput: readerOf(draft),
      inputActions: { setDraft: value => writes.push(value) },
    })
    const [button] = buttonsOf(mounted.tree)
    assert.equal(button.props.disabled, false, 'a non-empty draft must leave the button enabled')
    click(button)
    await flush()

    assert.equal(calls.length, 1, `create was called ${calls.length} times`)
    assert.deepEqual(calls[0], {
      kind: 'prompt',
      title: '第一行是标题',
      text: draft,
    })
    assert.equal(writes.length, 0, 'the draft must not be cleared or rewritten')
    assert.match(rendered(mounted), /已存到 Hub/)
  })

  it('caps the title at the first non-empty line, trimmed and shortened', async () => {
    const calls = []
    const { registrations } = await applyClient({
      hub: { create: async draft => { calls.push(draft); return { ok: true, value: {} } } },
    })
    const long = 'x'.repeat(70)
    const draft = `   \n  ${long}  \n正文`
    const mounted = mount(saveComponent(registrations), { useInput: readerOf(draft) })
    click(buttonsOf(mounted.tree)[0])
    await flush()
    assert.equal(calls[0].title, `${'x'.repeat(60)}…`)
    assert.equal(calls[0].text, draft, 'the whole draft travels as the item content, untrimmed')
  })

  it('reports the busy state while the call is in flight', async () => {
    let release = () => {}
    const { registrations } = await applyClient({
      hub: { create: () => new Promise((resolve) => { release = () => resolve({ ok: true, value: {} }) }) },
    })
    const mounted = mount(saveComponent(registrations), { useInput: readerOf('帮我写一个登录页') })
    click(buttonsOf(mounted.tree)[0])
    assert.match(rendered(mounted), /正在保存/)
    release()
    await flush()
    assert.match(rendered(mounted), /已存到 Hub/)
  })

  it('names the Hub reason and can be dismissed when the save is refused', async () => {
    // The gateway folds a Host rejection into the envelope's error branch
    // rather than throwing, so that is the shape under test. `hub/invalid-item`
    // is what the Host answers a blank title and blank content with.
    const { registrations } = await applyClient({
      hub: { create: async () => ({ ok: false, error: { code: 'hub/invalid-item', message: 'title and text are both blank' } }) },
    })
    const mounted = mount(saveComponent(registrations), { useInput: readerOf('帮我写一个登录页') })
    click(buttonsOf(mounted.tree)[0])
    await flush()
    const failure = rendered(mounted)
    assert.match(failure, /保存失败/)
    assert.match(failure, /hub\/invalid-item/)
    assert.match(failure, /title and text are both blank/)

    const dismiss = buttonsOf(mounted.tree).at(-1)
    click(dismiss)
    assert.doesNotMatch(rendered(mounted), /hub\/invalid-item/)
    assert.equal(buttonsOf(mounted.tree).length, 1, 'dismissing must leave the button, not the seat')
  })

  it('reports a thrown failure instead of letting it escape', async () => {
    const { registrations } = await applyClient({
      hub: { create: async () => { throw new Error('the carrier went away') } },
    })
    const mounted = mount(saveComponent(registrations), { useInput: readerOf('帮我写一个登录页') })
    click(buttonsOf(mounted.tree)[0])
    await flush()
    assert.match(rendered(mounted), /the carrier went away/)
  })

  it('says Hub went away when the namespace vanishes between render and click', async () => {
    const calls = []
    // One module instance, applied twice: the second composition is the same
    // page after the Hub bundle unloaded, so the reader the button closed over
    // now finds no service. That is the state a real unload leaves behind.
    const plugin = makePlugin()
    const present = applyTo(plugin, { hub: { create: async draft => { calls.push(draft); return { ok: true, value: {} } } } })
    const mounted = mount(saveComponent(present.registrations), { useInput: readerOf('帮我写一个登录页') })
    const [button] = buttonsOf(mounted.tree)
    assert.equal(button.props.disabled, false)

    applyTo(plugin, {})
    click(button)
    await flush()
    assert.equal(calls.length, 0, 'a vanished Hub must not be called')
    assert.match(rendered(mounted), /Hub 不可用/)
    assert.equal(buttonsOf(mounted.tree).length, 1, 'the seat keeps its button')
  })

  it('survives a context whose get() throws', async () => {
    const { registrations } = await applyClient({ throwingGet: true })
    const tree = mount(saveComponent(registrations), { useInput: readerOf('帮我写一个登录页') }).tree
    assert.equal(tree, null, 'a throwing service read must degrade to hidden, not crash the seat')
  })

  it('clears its own confirmation after a moment', async () => {
    const scheduled = []
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = (fn, ms) => { scheduled.push({ fn, ms }); return 0 }
    try {
      const { registrations } = await applyClient({ hub: { create: async () => ({ ok: true, value: {} }) } })
      const mounted = mount(saveComponent(registrations), { useInput: readerOf('帮我写一个登录页') })
      click(buttonsOf(mounted.tree)[0])
      await flush()
      assert.match(rendered(mounted), /已存到 Hub/)
      assert.deepEqual(scheduled.map(timer => timer.ms), [3000])
      scheduled[0].fn()
      assert.doesNotMatch(rendered(mounted), /已存到 Hub/)
      assert.equal(buttonsOf(mounted.tree).length, 1)
    }
    finally {
      globalThis.setTimeout = realSetTimeout
    }
  })

  it('keeps two mounted buttons independent', async () => {
    const { registrations } = await applyClient({ hub: { create: async () => ({ ok: true, value: {} }) } })
    const component = saveComponent(registrations)
    const first = mount(component, { useInput: readerOf('帮我写一个登录页') })
    const second = mount(component, { useInput: readerOf('另一个草稿') })
    click(buttonsOf(first.tree)[0])
    await flush()
    assert.match(rendered(first), /已存到 Hub/)
    assert.doesNotMatch(rendered(second), /已存到 Hub/)
  })
})
