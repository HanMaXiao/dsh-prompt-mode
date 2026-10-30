/**
 * Prompt Mode — Client half.
 *
 * The prompt surface is an **embedded conversation**, not an information panel:
 * a small chat that is already in prompt mode, drawn with the host's own
 * Conversation content so the composer, the model selector and the @-file
 * reference picker all come for free.
 *
 * Two registrations carry it:
 * - `conversation.input.left` — a compact launcher beside the composer controls.
 *   It finds or creates the prompt-chat Session for this workspace, binds the
 *   `prompt` agent preset, and opens the tab.
 * - `sidebar.right.pane.tab` — the tab body. It adapts a retained Session
 *   reference through the `promptchat` resource protocol and renders the
 *   embedded Conversation, exactly as `ui-subagent`'s chat tab does for a child
 *   Session.
 *
 * Styles use only `--dsw-alias-*` theme tokens. No Harness Client package is
 * imported: React comes from the browser module table and everything else is
 * written here.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-prompt-mode',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState } = React

    /** Bound by `apply` once the locale namespace is registered. */
    let translate = () => ''
    const NS = 'prompt-mode'
    /** This implementation's identity in the tab system. */
    const TAB_ID = '@local/dsh-prompt-mode'
    /** Resource protocol carrying one prompt-chat Session. */
    const PROTOCOL = 'promptchat'
    const ADDRESS_PREFIX = `dsh-resource://${PROTOCOL}/session/`
    const PROMPT_PRESET = 'prompt'
    const STORAGE_KEY = 'dsh-prompt-mode:chats'

    const ZH = {
      'launcher.label': '提示词',
      'launcher.title': '打开提示词会话：一个已经在提示词模式里的迷你对话，产出可以粘贴到新会话的那一行',
      'launcher.busy': '正在新建提示词会话…',
      'launcher.failed': '创建失败：',
      'tab.title': '提示词会话',
      'tab.new': '新会话',
      'tab.loading': '正在打开会话…',
    }
    const EN = {
      'launcher.label': 'Prompts',
      'launcher.title': 'Open a prompt chat: a small conversation already in prompt mode that returns the one line to paste into a fresh session',
      'launcher.busy': 'Starting a prompt chat…',
      'launcher.failed': 'Could not start: ',
      'tab.title': 'Prompt chat',
      'tab.new': 'New chat',
      'tab.loading': 'Opening the session…',
    }

    const TOKEN = {
      surface: 'var(--dsw-alias-bg-layer-1)',
      sunken: 'var(--dsw-alias-bg-layer-2)',
      border: 'var(--dsw-alias-border-l1)',
      borderStrong: 'var(--dsw-alias-border-l2)',
      label: 'var(--dsw-alias-label-primary)',
      labelSoft: 'var(--dsw-alias-label-secondary)',
      brand: 'var(--dsw-alias-brand-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
    }
    const FONT = '12px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'

    /** Canonical resource address of one prompt-chat Session. */
    function promptChatAddress(sessionId, cwd) {
      const query = cwd === undefined || cwd === '' ? '' : `?cwd=${encodeURIComponent(cwd)}`
      return `${ADDRESS_PREFIX}${encodeURIComponent(sessionId)}${query}`
    }

    /** Parse a prompt-chat address back into its Session and workspace. */
    function parsePromptChatAddress(value) {
      let url
      try {
        url = new URL(String(value ?? ''))
      }
      catch {
        return undefined
      }
      if (url.protocol !== 'dsh-resource:' || url.hostname.toLowerCase() !== PROTOCOL) return undefined
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length !== 2 || parts[0] !== 'session') return undefined
      try {
        return {
          sessionId: decodeURIComponent(parts[1]),
          cwd: url.searchParams.get('cwd') ?? undefined,
        }
      }
      catch {
        return undefined
      }
    }

    /** Resolve a value the way a RemoteResult or a bare value could carry it. */
    function unwrap(result) {
      if (result !== null && typeof result === 'object' && 'ok' in result) {
        if (result.ok === true) return result.value
        throw new Error(String(result.error?.message ?? 'remote call failed'))
      }
      return result
    }

    /** Resume one prompt chat per workspace across page reloads. */
    function readChats() {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      }
      catch {
        return {}
      }
    }

    function rememberChat(key, sessionId) {
      try {
        const chats = readChats()
        chats[key] = sessionId
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(chats))
      }
      catch { /* private mode: the launcher just forgets */ }
    }

    function waitForAbort(signal) {
      if (signal.aborted) return Promise.resolve()
      return new Promise((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    }

    /**
     * Create a blank Session, bind the `prompt` preset to it, and remember it.
     * @returns the new Session id.
     */
    async function createPromptChat(ctx, cwd) {
      const created = unwrap(await ctx.remote.session.create(cwd === undefined ? {} : { cwd }))
      const sessionId = created.sessionId
      try {
        await ctx.remote.agentPresets.select(sessionId, PROMPT_PRESET)
      }
      catch (error) {
        // The session exists and is usable; a failed preset binding only means
        // it will not carry the prompt-mode policy, so say so and continue.
        console.warn('@local/dsh-prompt-mode: could not bind the prompt preset:', error)
      }
      if (cwd !== undefined && cwd !== '') rememberChat(cwd, sessionId)
      return sessionId
    }

    /** Find the remembered chat for a workspace, or create one. */
    async function ensurePromptChat(ctx, cwd) {
      if (cwd !== undefined && cwd !== '') {
        const known = readChats()[cwd]
        if (typeof known === 'string' && known !== '') return known
      }
      return createPromptChat(ctx, cwd)
    }

    /** Compact launcher beside the composer's left controls. */
    function makeLauncher(ctx) {
      return function PromptLauncher({ sessionId }) {
        const [busy, setBusy] = useState(false)
        const [error, setError] = useState('')
        const tr = (key, fallback) => {
          try {
            const value = translate(key)
            return typeof value === 'string' && value !== '' && value !== key ? value : fallback
          }
          catch {
            return fallback
          }
        }

        const open = async () => {
          if (busy) return
          setBusy(true)
          setError('')
          try {
            const summary = ctx.sessions?.list?.getSnapshot?.()?.byId?.[sessionId]
            const cwd = typeof summary?.cwd === 'string' && summary.cwd !== '' ? summary.cwd : undefined
            const chatId = await ensurePromptChat(ctx, cwd)
            ctx.sidebarRight.openResource(promptChatAddress(chatId, cwd), {
              kind: PROTOCOL,
              preferNewPane: true,
            })
          }
          catch (cause) {
            setError(String(cause instanceof Error ? cause.message : cause))
          }
          finally {
            setBusy(false)
          }
        }

        return h('button', {
          type: 'button',
          onClick: open,
          title: error === '' ? tr('launcher.title', ZH['launcher.title']) : `${tr('launcher.failed', ZH['launcher.failed'])}${error}`,
          'aria-busy': busy ? 'true' : undefined,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            height: 24,
            padding: '0 8px',
            borderRadius: 999,
            border: `1px solid ${error === '' ? TOKEN.border : TOKEN.error}`,
            background: TOKEN.sunken,
            color: error === '' ? TOKEN.labelSoft : TOKEN.error,
            font: FONT,
            cursor: busy ? 'progress' : 'pointer',
            whiteSpace: 'nowrap',
          },
        },
        h('span', { style: { color: TOKEN.brand, fontSize: 12, lineHeight: 1 } }, '✳'),
        h('span', null, busy ? tr('launcher.busy', ZH['launcher.busy']) : tr('launcher.label', ZH['launcher.label'])))
      }
    }

    /** The embedded Conversation's fixed view: the Chat surface, nothing else. */
    function FixedChatView(props) {
      return h(React.Fragment, null, props.renderSlot('conversation.session', { view: 'chat' }))
    }

    /**
     * Turn a subtree crash into a readable line.
     *
     * A throwing component otherwise blanks its slot entry and reports only
     * through the browser console — the same silent-failure shape that hid a
     * bug on the Host half of this bundle.
     */
    class PromptErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: '' }
      }

      static getDerivedStateFromError(error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }

      componentDidCatch(error) {
        console.warn('@local/dsh-prompt-mode: prompt chat subtree failed:', error)
      }

      render() {
        if (this.state.error !== '') {
          return h('div', {
            style: {
              padding: 12,
              font: FONT,
              color: TOKEN.error,
              whiteSpace: 'pre-wrap',
            },
          }, `提示词会话渲染失败：${this.state.error}`)
        }
        return this.props.children
      }
    }

    /**
     * Render the host Conversation for the Session this tab retained.
     *
     * This mirrors `ui-subagent`'s embedded chat: the phase computation decides
     * between the hero composer and the docked one, and `conversation.content`
     * supplies the real Chat nodes and composer.
     */
    function PromptConversation({ sessionId, useSession, useConversation, useSessions, renderFactorySlot }) {
      const session = useSession(value => value)
      const conversation = useConversation(value => value)
      const summaryBlank = useSessions(state => (sessionId === undefined ? undefined : state.byId[sessionId]?.blank))
      const activeTargets = conversation?.activeTargets
      const active = (activeTargets !== undefined && activeTargets.size > 0)
        || (session !== undefined && !session.blank && !session.awaitingFirstTurn)
        || session?.running === true
      const shellPhase = active ? 'active' : session?.promptAttempted ? 'engaging' : 'blank'
      const parentAvailabilityPending = session?.subagent?.address?.mode === 'continuable'
        && session.subagent.parentAvailable === undefined
      const settling = (shellPhase === 'blank' && session?.openState === 'loading' && summaryBlank !== true)
        || parentAvailabilityPending
      const hero = shellPhase === 'blank' && (session?.openState === 'open' || summaryBlank === true)
      const phase = settling ? 'settling' : hero ? 'hero' : 'active'
      if (typeof renderFactorySlot !== 'function') {
        return h('div', { style: { padding: 12, font: FONT, color: TOKEN.error } },
          '此插槽没有注入 renderFactorySlot，无法挂载宿主的对话内容。')
      }
      return h(PromptErrorBoundary, null,
        renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, {
          slots: { views: FixedChatView },
        }))
    }

    /** Tab body: a slim header over the retained Session's Conversation. */
    function makeChatTab(ctx) {
      return function PromptChatTab({ useResource, useTabInfo, SessionProvider, renderSlot }) {
        const { tab } = useTabInfo()
        const resource = useResource(tab.contentId)
        const tr = (key, fallback) => {
          try {
            const value = translate(key)
            return typeof value === 'string' && value !== '' && value !== key ? value : fallback
          }
          catch {
            return fallback
          }
        }
        const parsed = parsePromptChatAddress(tab.contentId)

        const startFresh = async () => {
          if (parsed === undefined) return
          try {
            const chatId = await createPromptChat(ctx, parsed.cwd)
            ctx.sidebarRight.openResource(promptChatAddress(chatId, parsed.cwd), {
              kind: PROTOCOL,
              preferNewPane: true,
            })
          }
          catch (cause) {
            console.warn('@local/dsh-prompt-mode: could not start a new prompt chat:', cause)
          }
        }

        const header = h('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '6px 10px',
            borderBottom: `1px solid ${TOKEN.border}`,
            background: TOKEN.surface,
            font: FONT,
            color: TOKEN.labelSoft,
            flex: '0 0 auto',
          },
        },
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
          h('span', { style: { color: TOKEN.brand } }, '✳'),
          h('span', null, tr('tab.title', ZH['tab.title']))),
        h('button', {
          type: 'button',
          onClick: startFresh,
          style: {
            border: `1px solid ${TOKEN.borderStrong}`,
            background: TOKEN.sunken,
            color: TOKEN.label,
            borderRadius: 6,
            padding: '2px 8px',
            font: FONT,
            cursor: 'pointer',
          },
        }, tr('tab.new', ZH['tab.new'])))

        const body = resource.value === undefined
          ? h('div', { style: { padding: 12, font: FONT, color: TOKEN.labelSoft } }, tr('tab.loading', ZH['tab.loading']))
          : typeof SessionProvider !== 'function'
            ? h('div', { style: { padding: 12, font: FONT, color: TOKEN.error } },
              '此插槽没有注入 SessionProvider，无法把保留的会话挂进对话。')
            : h(PromptErrorBoundary, null,
              h(SessionProvider, { session: resource.value.reference },
                renderSlot('promptchat.conversation', {})))

        return h('div', {
          style: {
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            background: TOKEN.surface,
          },
        }, header, h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' } }, body))
      }
    }

    /** Client plugin body. */
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-prompt-mode: prompt chat dictionaries')
        translate = ctx.locale.bind(NS)

        // The tab type and its resource provider need the sidebar and resource
        // registries; without them only the launcher would exist, so keep the
        // whole surface behind one injection.
        ctx.inject(['resources', 'sidebarRightTabs', 'sessions'], (scope) => {
          ctx.effect(() => scope.resources.register({
            protocol: PROTOCOL,
            async *open(address, { signal }) {
              const parsed = parsePromptChatAddress(address)
              if (parsed === undefined) throw new Error(`dsh-prompt-mode: invalid prompt chat address "${address}"`)
              if (signal.aborted) return
              const reference = ctx.sessions.retain(parsed.sessionId, { source: 'promptChat', signal })
              try {
                yield { ok: true, value: { sessionId: parsed.sessionId, cwd: parsed.cwd, reference } }
                await waitForAbort(signal)
              }
              finally {
                reference.release()
              }
            },
          }), 'dsh-prompt-mode: prompt chat resources')

          ctx.effect(() => scope.sidebarRightTabs.register({
            id: TAB_ID,
            kind: PROTOCOL,
            patterns: [`${ADDRESS_PREFIX}**`],
            canOpen: address => parsePromptChatAddress(address) !== undefined,
            title: () => {
              try {
                const value = translate('tab.title')
                return typeof value === 'string' && value !== '' && value !== 'tab.title' ? value : ZH['tab.title']
              }
              catch {
                return ZH['tab.title']
              }
            },
          }), 'dsh-prompt-mode: prompt chat tab type')
        })

        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          children: { 'promptchat.conversation': { kind: 'single', scope: 'session' } },
        }, makeChatTab(ctx)))

        ctx.slots.inject('promptchat.conversation', () => ctx.slots.register({
          name: 'promptchat.conversation',
        }, PromptConversation))

        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'prompt-mode.launcher',
          order: 30,
          locale: NS,
        }, makeLauncher(ctx)))
      },
    }
  },
})
