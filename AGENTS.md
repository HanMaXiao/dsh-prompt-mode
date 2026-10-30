# AGENTS.md

`@local/dsh-prompt-mode` 是一个 Cordis 插件：给 DSH 装上一套「先写系统提示词文档，再让新会话照着干」的工作方式。**[README.md](README.md) 是本仓库唯一的事实权威**，本文件只放约束、命令和指针——README 里已经写清的事实，这里一律不复述。README 与本文件冲突时以 README 为准；本文件与 Agent Notes 冲突时以本文件为准。

一个事实一个家：本文件写「必须怎么做」，README 写「是什么、实测到什么」，[.agents/notes/](.agents/notes/README.md) 写「为什么这么做、放弃了什么」。动任何一处之前，先读另外两处。

## 三个半边，三种生效方式

| 半边 | 文件 | 改完之后怎么生效 |
|---|---|---|
| Host 核心 | `host.js`、`lib/` | **必须重启 Harness 进程** |
| 预设作用域 | `mode.js` | **必须重启 Harness 进程** |
| Client | `client.js` | **刷新页面即可** |

Loader 只在从未加载过一个包名时才 `import()` 它，所以 Host 侧重装、关掉再打开、换行 id、改 `exports["."]` 的解析目标、换子路径 specifier、换目录——全部无效，跑在进程里的还是第一次那份模块代。逐条实测记录在 README「五、1」，本文件只留结论：**Host 侧改动要么一次做对，要么安排重启**。Client 侧走浏览器模块表，HMR 接收器会自动重载本 bundle，见 README「六」。

## 命令

```sh
node --test     # 唯一的验证命令；没有 build / bundler / typecheck / lint
```

包是纯 ESM、零依赖，Loader 直接按磁盘上的原样读。bug 只能被 `node --test` 或真跑一遍发现，不会被编译步骤发现——所以不要引入编译、打包、转译中的任何一步：那只会保证 `package.json` 的 `files` 和目录树不一致。

DSH 升级后、以及每次改过 `cordis.patch.yml` 的 `plugins` 列表之后，必须跑预设复刻校验：

```powershell
node scripts\check-preset-drift.mjs --dsh-root <DSH 源码检出或发行版预设目录>
```

零漂移退出码 0；有漂移逐行打印后退出码 1；给了不可用的根退出码 2。不带 `--dsh-root` 也没设 `DSH_SOURCE_ROOT` 时打印 SKIP 并以 0 退出——裸检出不报错。CI 里的 `preset drift (informational)` job 是 `continue-on-error`，只提醒、不拦截合并，**它不代替你本地跑**。为什么必须复刻、复刻的目标是哪个 DSH，见 README「五、2」与「六」。

## 约束

- **不要复述 README。** 需要一条事实时链接过去，不要抄过来。抄过来的那份会在下一次只改一边时变成假话，而它比没有更糟。
- **零 emoji，任何地方都不行。** 文案、注释、提交信息、标识符、文档都不行；可点击形态一律用内联 SVG 加 `aria-label`。
- **每个文件恰好一个结尾换行。**
- **两份 locale 字典的键集合必须始终保持一致。** 新增用户可见字符串一律走 `ctx.locale.register` / `bind`，`zh` 与 `en` 同步加同样的键。少一个键就是少一种语言的用户，而 `tests/smoke.test.js` 会把它拦下来。
- **`preset-prompt` 的 `plugins` 列表是 shipped `standard` 预设的逐行复刻，加末尾一行本包自己的 `prompt-mode-policy`。** 不要「顺手改进」其中任何一行——它的全部价值就在于和发行版逐字节相同。DSH 升级后用上面的脚本重跑，照输出改完再跑一遍。
- **插件自有的持久数据一律走 `libraryDir` 下的文件。** 不要往 session log 写自定义事件类型：旧读者会拒绝重新打开会话。教训存储在姊妹包那一侧为什么是两份、为什么必须同步改，见 [Agent Note: 两个提示词 bundle 各自持有一份教训存储实现](.agents/notes/implemented/architecture/2026-10-30-two-prompt-bundles-keep-separate-lesson-stores.md)。
- **失败要可见，不许退回静默。** Host 侧 `tools.register()` 的抛错发生在 `ctx.inject` 的子 fiber 里、默认静默；Client 侧抛错的组件会把整个插槽条目变成空白。两边的既有做法——Host 汇总全部失败原因后再抛并落 `status.json`，Client 包 `PromptErrorBoundary` 并把缺失的 `SessionProvider` / `renderFactorySlot` 显式渲染成一行诊断——是这条约束的落地，不要拆掉。落盘为什么必须走 `writeFileAtomic`、并发写入为什么必须被拒绝而不是排队，见 [Agent Note: 原子落盘与串行追加](.agents/notes/implemented/bug-fix/2026-10-30-atomic-document-writes-and-serialized-lesson-appends.md)。
- **预设挂载失败是完全静默的，判据只能是回执文件。** `AgentPresetRegistry.activate()` 把失败 catch 成 `record.broken` 加一行 `logger.warn`，声明行仍是 `active`。所以别用行状态判断预设挂没挂上，去看 `<libraryDir>/preset.json`。
- **跨插件集成只消费、不贡献。** save-to-Hub 按钮读 Hub 自己挂上的 `remote.hub` 命名空间：用 `ctx.get` 读、每次用之前重读、永远不进 `inject`——声明一个本组合满足不了的服务会让这个条目永久 park 掉，而它旁边的启动器会跟着一起失去座位。降级是设计路径，不是兜底；四种降级形态和它们各自的理由见 [Agent Note: save-to-Hub 的降级设计](.agents/notes/implemented/feature/2026-10-30-save-to-hub-degradation-design.md)。
- **注释只写本地契约。** 不复述代码、不展开无关注释、不解释远处行为；写清楚契约、失败形态、时机和安全用法，理由链到 Agent Note。

## 测试

`node --test` 跑 `tests/` 下的文件：两份真实参考文档的审计（其中一份不在工作区时那几条 SKIP）、渲染往返、交接提示词字面值、仓库扫描、技能打分、教训存储往返、`host.js` / `mode.js` 对真实服务形状的注册、四个工具在真实 cordis 加真实 `ToolRuntime` 下的端到端、`prompt_doc_write` 与 `lessons.json` 的写入安全、以及 `client.js` 的 save-to-Hub 按钮行为。

测试描述的是行为，不是正确性。改掉了某个行为就连它的测试一起改；只验证一个已删行为的测试，不是删除彻底的证据。

## Agent Notes

决策理由——为什么、放弃了什么、代价是什么——住在 [.agents/notes/](.agents/notes/README.md)。只有「代码、测试和 README 都解释不了的为什么」才写一篇；机械性修改和局部 UI 调整豁免。永远不要把一篇 note 改写成另一个决策：用新 note 取代它，并让两篇互相交叉链接。

## 改这份文件

只改仓库根目录这一份，没有符号链接副本。每条规则自成一句，同时链接权威而不是复述它。

本文件有字节预算：**不超过 8192 字节**。超了就把理由搬进 `.agents/notes/`、把参考指向 README，不要在这里加段落——AGENTS.md 会被注入每一个 agent session，是每轮都要交的税。
