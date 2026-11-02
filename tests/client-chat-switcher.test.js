/**
 * Behaviour test for the chat switcher in the prompt-chat tab header.
 *
 * The bundle is a function body served by the browser module table, so the way
 * to prove its behaviour without a page is the technique the sibling
 * `client-save-to-hub.test.js` uses: a stub module table plus a minimal React
 * with per-mount hook state. What it proves here is the UX gap this closes —
 * the remembered chats were write-only history, so a chat switched away from
 * could not be opened again — and the parts a page refresh would otherwise be
 * the only way to see: the list, the current marker, the address a click
 * opens, the empty state, and the refresh after a fresh chat is created.
 *
 * One part is deliberately absent: a real-React render. This package ships no
 * dependency and may not gain one, so `react` does not resolve in a clean
 * checkout and CI could not run it. `node --check` plus this file are the whole
 * of what CI can verify here.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const STORAGE_KEY = 'dsh-prompt-mode:chats'
const CWD = 'D:\\XiaoProject\\Demo'
const FIRST = 'aaaa1111-2222-3333-4444-555566667777'
const SECOND = 'bbbb2222-3333-4444-5555-666677778888'
const FRESH = 'cccc3333-4444-5555-6666-777788889999'

// `window` must exist before the module is imported: client.js reads
// `__ModuleLoader__` at module scope. `localStorage` is swapped per case, the
// way a page's own storage is per origin.
const store = new Map()
const loaded = []
globalThis.window = {
  __ModuleLoader__: { load: entry => { loaded.push(entry) } },
  localStorage: {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
  },
}
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
  // The tab half's error boundary extends it; nothing here reaches its error
  // branch, so an empty base is all the class statement needs.
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

/** Per-mount hook state: two mounted tabs must not share it. */
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
 * The canonical address of one prompt chat.
 *
 * Spelled out here because `promptChatAddress` is internal to the bundle: the
 * tab's own resource provider registers `${ADDRESS_PREFIX}**` against this
 * shape, so a click that produced anything else would open nothing.
 */
const addressOf = (sessionId, cwd) => `dsh-resource://promptchat/session/${encodeURIComponent(sessionId)}?cwd=${encodeURIComponent(cwd)}`

/**
 * Build the plugin object once.
 *
 * The browser module table serves one entry per package, so one factory call
 * is one module instance: applying the same instance to a second context is
 * what an unload-and-reload of this bundle looks like from in here.
 */
const makePlugin = () => loaded[0].factory(name => {
  if (name === 'react') return React
  throw new Error(`unexpected require(${name})`)
})

/**
 * Apply one plugin instance against a stub Cordis context.
 *
 * `opened` records every `sidebarRight.openResource` call, which is the one
 * side effect a switcher click has. `create` is what `remote.session.create`
 * answers, so the "new chat" path can be driven without a Host — and broken
 * on purpose, which is the failure the header must survive.
 */
const applyTo = (plugin, { language = 'zh', create = async () => ({ ok: true, value: { sessionId: FRESH } }) } = {}) => {
  const registrations = []
  const dictionaries = new Map()
  const opened = []
  const ctx = {
    effect: callback => { callback(); return () => {} },
    // The tab half injects the sidebar, resource and session registries; the
    // stub answers with the ones the apply body actually touches.
    inject: (_deps, callback) => callback({
      resources: { register: () => () => {} },
      sidebarRightTabs: { register: () => () => {} },
      sessions: {},
    }),
    get: () => undefined,
    remote: {
      session: { create },
      agentPresets: { select: async () => ({ ok: true, value: undefined }) },
    },
    sidebarRight: {
      openResource: (address, options) => { opened.push({ address, options }) },
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
  return { registrations, dictionaries, opened }
}

/** Apply a fresh module instance, the way a fresh page load would. */
const applyClient = (options = {}) => applyTo(makePlugin(), options)

/** The tab body's component out of one applied composition. */
const chatTabComponent = registrations => {
  const entry = registrations.find(candidate => candidate.options.name === 'sidebar.right.pane.tab')
  assert.notEqual(entry, undefined, 'the prompt chat tab entry is not registered')
  return entry.component
}

/**
 * Mount the tab body over one retained prompt chat.
 *
 * `SessionProvider` is absent on purpose: the session-scoped child slot is
 * what injects it, and the switcher lives in the header, above that body.
 */
const mountTab = (component, { current, cwd = CWD } = {}) => {
  const contentId = addressOf(current ?? FIRST, cwd)
  return mount(component, {
    useTabInfo: () => ({ tab: { contentId } }),
    useResource: () => ({ value: { reference: { sessionId: current ?? FIRST } } }),
    renderSlot: () => null,
  })
}

/**
 * The switcher's own buttons, in the order the header renders them.
 *
 * An entry is the button whose tooltip is a whole session id: the new-chat
 * button beside it carries none, so the two never get confused.
 */
const switcherButtons = record => buttonsOf(record.tree).filter(button => typeof button.props.title === 'string')

describe('the remembered chats', () => {
  it('keeps a short history per workspace instead of one overwritten slot', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ [CWD]: [FIRST, SECOND], 'D:\\elsewhere': ['zzzz9999'] }))
    const { registrations } = await applyClient({})
    const mounted = mountTab(chatTabComponent(registrations), { current: FIRST })
    assert.deepEqual(switcherButtons(mounted).map(button => texts(button).join('').slice(0, 8)), [FIRST.slice(0, 8), SECOND.slice(0, 8)])
  })

  it('reads a legacy single-id record as a one-entry list', async () => {
    // A map written before this change holds one id per workspace; it must
    // still surface, or an existing user would lose the chat they are in.
    store.set(STORAGE_KEY, JSON.stringify({ [CWD]: FIRST }))
    const { registrations } = await applyClient({})
    const mounted = mountTab(chatTabComponent(registrations), { current: FIRST })
    assert.deepEqual(switcherButtons(mounted).map(button => texts(button).join('').slice(0, 8)), [FIRST.slice(0, 8)])
  })

  it('ignores a record that is not the shape it wrote', async () => {
    for (const broken of ['[]', '"nope"', 'null', '{']) {
      store.set(STORAGE_KEY, broken)
      const { registrations } = await applyClient({})
      const mounted = mountTab(chatTabComponent(registrations), { current: FIRST })
      assert.equal(switcherButtons(mounted).length, 0, `the switcher rendered something for ${broken}`)
      assert.equal(buttonsOf(mounted.tree).length, 1, 'the tab itself must still render its new-chat button')
    }
  })
})

describe('the chat switcher', () => {
  it('renders one compact button per remembered chat, current one marked', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ [CWD]: [FIRST, SECOND] }))
    const { registrations } = await applyClient({})
    const mounted = mountTab(chatTabComponent(registrations), { current: FIRST })
    const buttons = switcherButtons(mounted)
    assert.equal(buttons.length, 2)
    assert.equal(buttons[0].props['aria-current'], 'true')
    assert.equal(buttons[1].props['aria-current'], undefined)
    assert.match(rendered(mounted), /当前/)
    assert.equal(buttons[0].props.title, FIRST, 'the tooltip carries the whole session id')
    assert.equal(buttons[1].props.title, SECOND)
  })

  it('marks the second entry when that is the chat this tab shows', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ [CWD]: [FIRST, SECOND] }))
    const { registrations } = await applyClient({})
    const mounted = mountTab(chatTabComponent(registrations), { current: SECOND })
    const buttons = switcherButtons(mounted)
    assert.equal(buttons[0].props['aria-current'], undefined)
    assert.equal(buttons[1].props['aria-current'], 'true')
  })

  it('opens the clicked chat at its own prompt-chat address', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ [CWD]: [FIRST, SECOND] }))
    const { registrations, opened } = await applyClient({})
    const mounted = mountTab(chatTabComponent(registrations), { current: FIRST })
    click(switcherButtons(mounted)[1])
    assert.deepEqual(opened, [{
      address: addressOf(SECOND, CWD),
      options: { kind: 'promptchat', preferNewPane: true },
    }])
  })

  it('opens the current chat again when it is clicked', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ [CWD]: [FIRST, SECOND] }))
    const { registrations, opened } = await applyClient({})
    const mounted = mountTab(chatTabComponent(registrations), { current: FIRST })
    click(switcherButtons(mounted)[0])
    assert.deepEqual(opened.map(call => call.address), [addressOf(FIRST, CWD)])
  })

  it('renders nothing at all when the workspace remembers no chat', async () => {
    store.clear()
    const { registrations } = await applyClient({})
    const mounted = mountTab(chatTabComponent(registrations), { current: FIRST })
    assert.equal(switcherButtons(mounted).length, 0)
    assert.doesNotMatch(rendered(mounted), /切换会话|Switch chat/)
    // The seat keeps its shape: the new-chat button is still the only one.
    assert.equal(buttonsOf(mounted.tree).length, 1)
    assert.match(rendered(mounted), /新会话/)
  })

  it('renders nothing for a workspace whose remembered chat belongs elsewhere', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ 'D:\\elsewhere': [SECOND] }))
    const { registrations } = await applyClient({})
    const mounted = mountTab(chatTabComponent(registrations), { current: FIRST })
    assert.equal(switcherButtons(mounted).length, 0)
  })

  it('routes its two strings through the registered dictionaries', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ [CWD]: [FIRST, SECOND] }))
    const zh = await applyClient({ language: 'zh' })
    const en = await applyClient({ language: 'en' })
    const zhText = rendered(mountTab(chatTabComponent(zh.registrations), { current: FIRST }))
    const enText = rendered(mountTab(chatTabComponent(en.registrations), { current: FIRST }))
    assert.match(zhText, /切换会话/)
    assert.match(zhText, /当前/)
    assert.match(enText, /Switch chat/)
    assert.match(enText, /Current/)
    assert.notEqual(zhText, enText, 'both languages rendered the same text')
  })

  it('carries the switcher copy in the packaged dictionaries too', async () => {
    // The client bundle registers its dictionaries in code — the browser
    // cannot read the shipped files — so the packaged pair is a second home
    // for the same strings, and this is what stops the two from drifting.
    const { dictionaries } = await applyClient({})
    const registered = dictionaries.get('prompt-mode')
    for (const language of ['zh', 'en']) {
      const packaged = JSON.parse(readFileSync(path.join(PACKAGE_DIR, `locale/${language}.json`), 'utf8'))
      for (const key of ['chat.switcher.label', 'chat.switcher.current']) {
        assert.equal(registered[language][key], packaged[key],
          `locale/${language}.json and the registered ${language} dictionary disagree on "${key}"`)
      }
    }
  })
})

describe('a fresh chat joins the switcher', () => {
  it('lists the new session beside the ones already remembered', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ [CWD]: [FIRST, SECOND] }))
    const { registrations, opened } = await applyClient({})
    const mounted = mountTab(chatTabComponent(registrations), { current: FIRST })
    assert.equal(switcherButtons(mounted).length, 2)

    const fresh = buttonsOf(mounted.tree).at(-1)
    click(fresh)
    await flush()

    assert.deepEqual(switcherButtons(mounted).map(button => texts(button).join('').slice(0, 8)),
      [FIRST.slice(0, 8), SECOND.slice(0, 8), FRESH.slice(0, 8)])
    assert.deepEqual(opened.map(call => call.address), [addressOf(FRESH, CWD)])
    assert.equal(buttonsOf(mounted.tree).at(-1).props['aria-current'], undefined,
      'the tab still shows the chat it was opened on, so that one stays marked')
  })

  it('keeps the history bounded', async () => {
    const many = Array.from({ length: 12 }, (_unused, index) => `id${String(index).padStart(7, '0')}-xxxx`)
    store.set(STORAGE_KEY, JSON.stringify({ [CWD]: many }))
    const { registrations } = await applyClient({})
    const mounted = mountTab(chatTabComponent(registrations), { current: many[0] })
    click(buttonsOf(mounted.tree).at(-1))
    await flush()
    const shown = switcherButtons(mounted).map(button => texts(button).join('').slice(0, 8))
    assert.equal(shown.length, 8, `the switcher showed ${shown.length} entries`)
    assert.equal(shown.at(-1), FRESH.slice(0, 8))
  })

  it('leaves the switcher alone when creating the chat fails', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ [CWD]: [FIRST, SECOND] }))
    const { registrations, opened } = applyTo(makePlugin(), {
      create: async () => ({ ok: false, error: { code: 'session/create-failed', message: 'the Host said no' } }),
    })
    const mounted = mountTab(chatTabComponent(registrations), { current: FIRST })
    const before = rendered(mounted)
    const warned = []
    const realWarn = console.warn
    console.warn = (...args) => { warned.push(args) }
    try {
      click(buttonsOf(mounted.tree).at(-1))
      await flush()
    }
    finally {
      console.warn = realWarn
    }
    assert.equal(switcherButtons(mounted).length, 2, 'a failed creation must not drop the list')
    assert.equal(rendered(mounted), before, 'the header must not change shape on a failure')
    assert.deepEqual(opened, [], 'nothing may be opened when the creation failed')
    assert.equal(warned.length, 1, 'the failure must still be reported, not swallowed')
  })
})

describe('registration', () => {
  it('registers the two switcher keys in both dictionaries with identical key sets', async () => {
    const { dictionaries } = await applyClient({})
    const zh = dictionaries.get('prompt-mode')?.zh ?? {}
    const en = dictionaries.get('prompt-mode')?.en ?? {}
    assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
    for (const key of ['chat.switcher.label', 'chat.switcher.current']) {
      assert.equal(typeof en[key], 'string', `en is missing "${key}"`)
      assert.notEqual(en[key].trim(), '', `en["${key}"] is blank`)
      assert.notEqual(zh[key].trim(), '', `zh["${key}"] is blank`)
    }
  })

  it('puts the switcher left of the new-chat button, in the same header', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ [CWD]: [FIRST, SECOND] }))
    const { registrations } = await applyClient({})
    const mounted = mountTab(chatTabComponent(registrations), { current: FIRST })
    const header = find(mounted.tree, node => Array.isArray(node.children)
      && node.children.some(child => texts(child).join('').includes('新会话')))
    assert.notEqual(header, undefined, 'the new-chat button is not inside a header group')
    assert.ok(texts(header).join('').includes('切换会话'), 'the switcher is not in the same header')
    const order = []
    const walk = node => {
      if (node?.type === 'button') order.push(texts(node).join('').slice(0, 8))
      for (const child of node?.children ?? []) walk(child)
    }
    walk(header)
    assert.deepEqual(order, [FIRST.slice(0, 8), SECOND.slice(0, 8), '新会话'])
  })

  it('keeps two mounted tabs independent', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ [CWD]: [FIRST, SECOND] }))
    const { registrations } = await applyClient({})
    const component = chatTabComponent(registrations)
    const first = mountTab(component, { current: FIRST })
    const second = mountTab(component, { current: SECOND })
    assert.equal(switcherButtons(first)[0].props['aria-current'], 'true')
    assert.equal(switcherButtons(second)[0].props['aria-current'], undefined)
    assert.equal(switcherButtons(second)[1].props['aria-current'], 'true')
  })
})
