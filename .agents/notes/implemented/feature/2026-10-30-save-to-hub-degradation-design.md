# Agent Note: save-to-Hub 的降级设计

Status: implemented

## Problem

提示词模式的产出是一段要交给新会话的系统提示词，而用户写它的地方是对话输入框。`@hanmaxiao/dsh-hub` 已经在管一个 Prompt 条目列表，于是很自然地想要一个按钮：把输入框里这段草稿存成 Hub 的 Prompt 条目，之后从 Hub 里取用。

难点不在「存」，在「Hub 不一定在」。这是一个跨插件集成：Hub 命名空间由 Hub bundle 自己为整个页面挂上，本包不贡献任何东西。于是一个 profile 里完全可能没装 Hub——那时这个按钮面对三种彼此不同的失败，而每一种都有一种看起来很合理的错误处理方式：

- 命名空间不存在，`ctx.get('remote.hub')` 返回 `undefined`；
- 命名空间存在但这个组合里它没有 `create`；
- 命名空间在渲染之后、点击之前消失了（Hub 被卸载）。

再叠上两种本包自己的失败：输入框是空的，以及这个座位没有注入 `useInput`（读不到草稿）。

把一个跨插件依赖做成硬依赖是最容易的写法，也正是这里不能用的写法。

## Decision

第二个紧凑按钮，和启动器同住在 `conversation.input.left`：id `prompt-mode.save-to-hub`、order 40，紧跟 order 30 的 `prompt-mode.launcher`。草稿通过座位注入的 `useInput` 读——和姊妹包那个 optimize 按钮读它的方式完全一样；条目通过 Hub 自己的 Typert Remote 命名空间写：`ctx.get('remote.hub').create({ kind: 'prompt', title, text })`。标题取草稿第一个非空行，trim 后截到 60 字符并加省略号。`RemoteResult` 信封被剥开，失败时保留错误对象本身，因为 Hub 的稳定 `code`（`hub/invalid-item` 等）才是失败行该念的东西。

**降级是设计路径，不是兜底。** 四条，逐条对应上面那种失败：

- **Hub 没装：整个条目不渲染。** 命名空间缺失时返回 `null`，旁边的启动器一根头发都没动。按钮会在命名空间于某次后续渲染到达时自己出现。
- **草稿是空的：按钮禁用，tooltip 说明原因。** 这是一个不同的失败，不能和「没装 Hub」共用一套呈现。
- **保存被拒：一行可关闭的内联说明，念出 Hub 的稳定 code；成功是一行短暂的内联确认。** 草稿永不清空——这是复制，不是发送。
- **座位没注入 `useInput`：明说读不到输入框内容**，而不是显示一个永远点不动的死按钮。

两条贯穿全文的规则：

- **用 `ctx.get` 读，永远不进 `inject`。** 一个本组合满足不了的服务被声明进 `inject`，会让这个条目永久 park 住；而它旁边的启动器在同一个 composition 里，会跟着一起失去座位。`readHub` 外面还包了一层 `try/catch`，覆盖连 `get` 都没有的 context。
- **每次用之前重读。** 命名空间可能在首次渲染之后才到，也可能在卸载时消失，所以点击那一刻重新读一次，而不是相信渲染时那一份。

条目本身是**无条件注册**的：渲染不渲染由 Hub 命名空间在渲染时决定，注不注册由座位决定。把「Hub 在不在」前移到注册条件，只会让「Hub 后到」这种情况永远看不到按钮。

## Alternatives considered

**把 Hub 命名空间声明进 client factory 的 `inject`。** 这是 declarative 的正统形状，也是任何一个 Cordis 老手的第一反应。它输在一个 profile 没有 Hub 的时候：`inject` 声明一个组合满足不了的服务，fiber 会永久 park，而这个条目占的正是启动器旁边那个座位——**一个可选的跨插件集成会顺手把主功能的座位一起拿走**。`ctx.get` 加每次重读，是让降级路径得以存在的前提；`inject` 留给这个包自己必须有的服务（`slots`、`locale`）。

**Hub 不在时显示一个禁用按钮。** 比不渲染「信息量更大」，至少用户知道有这个东西。它输在那个按钮在这里永远做不了任何事：一个永久禁用的控件是噪音，而隐藏是诚实的。唯一的例外是**已经报出来的失败**——Hub 在点击后消失时，那一行理由要留在原处，否则一次已经被报告的保存就变成了静默的。

**保存成功后清空输入框。** 「存完了就该清掉」读起来像发送。它输在语义上：这是复制，用户接下来往往还要继续改那段提示词；而一次被拒的保存如果已经清空了草稿，用户的文本就真的没了。草稿永不清空，因此成功和失败在这一点上没有差别。

**让 Hub 反过来读本包，或者本包自己贡献一个 Remote 命名空间。** 把依赖方向倒过来。它输在 Hub bundle 已经为整个页面挂上了 `remote.hub`，本包再贡献一份就是在重复一个别人已经拥有的服务；而且 Typert loader 只在 Host 侧发现一个包的 `./typert` 导出，一个手写 bundle 要自己 `ctx.remote.$mount()`——为了一次复制操作去搭一座桥。

**`apply` 里发现 Hub 不在就抛。** 响亮。它输在一个被拒绝的条目会让座位保持未注册，而一个看不见的按钮比一行「Hub 不可用」报告得更少。本包在 Client 侧的既定纪律就是把缺失的依赖显式渲染成一行诊断（`PromptErrorBoundary`、缺失的 `SessionProvider` / `renderFactorySlot`），这里遵循同一条。

**用 `ctx.get('remote')?.hub` 读命名空间。** 少打几个字。它永远是 `undefined`：那个载体只带 `$mount`、`$stream`、`$host` 和 `$on`，每个命名空间是网关安装成的独立 Cordis 服务，地址就是 `remote.<namespace>`。

## Consequences

- **只需要刷新页面**，不需要重启：整个改动都在 Client 侧。Host 侧一行没动。
- 按钮会在 Hub 到达的下一次渲染自己出现，所以「装了 Hub 但页面是旧的」这个状态会自愈。
- 两份字典各多 9 个 `hub.*` 键，键集合保持相同（`label` / `title` / `empty` / `busy` / `saved` / `failed` / `unavailable` / `noInput` / `dismiss`），全部走 `ctx.locale.register` / `bind`。少一个键就是少一种语言的用户。
- 样式只用 `--dsw-alias-*` 令牌，图标是内联 SVG 加 `aria-hidden`，没有 emoji。
- 这条跨插件依赖**没有任何编译期或安装期的连线**：`package.json` 里不出现 Hub。耦合整体住在两个地方——`client.js` 里一个字符串常量 `remote.hub`，和钉住它行为的测试。改名 Hub 的命名空间会让这个按钮静默退化成「不渲染」，而测试会红。
- 一个真实 React 渲染是刻意缺席的：本包不发依赖、也不许获得依赖，干净检出里 `react` 不解析，CI 跑不了。`node --check` 加 stub module table 加一个最小 React 就是 CI 在这里能做的全部。

## Testing

[`tests/client-save-to-hub.test.js`](../../../../tests/client-save-to-hub.test.js) 用 stub module table 加一个带 per-mount hook 状态的最小 React 驱动这个组件，17 个用例：

- 注册形状：只声明它真正读的服务（一个没有 Hub 的组合也能激活）、同一个座位里排在启动器之后的第二个紧凑按钮、新键进两份字典且键集合相同、每条用户可见字符串都过字典。
- 降级：Hub 没装时不渲染、命名空间存在但没有 `create` 时不渲染、草稿为空时禁用并说明原因、座位没注入 `useInput` 时明说。
- 点击路径：从草稿建一个 Prompt 条目且草稿保留、标题取第一个非空行 trim 后截断、飞行中报 busy、被拒时报出 Hub 的原因且可关闭、抛出的失败被报告而不是逃逸、Hub 在渲染与点击之间消失时说它走了、`get()` 会抛的 context 也能活、确认会自行清除、两个挂载的按钮互不共享状态。

## Related

- [AGENTS.md 跨插件集成](../../../../AGENTS.md) —— 这条约束在根说明里的形态：只消费、不贡献。
- [README 一、5 悬浮提示词面板](../../../../README.md) —— 同一个座位里启动器与新按钮的用户可见形状。
