# @local/dsh-prompt-mode — 提示词模式插件

给 DSH 装上一套「先写系统提示词文档，再让新会话照着干」的工作方式。

起因很具体：同一件事，**裸说**给 Agent 的效果一般；先把任务写成一份系统提示词文档，再让 Agent「先读这份文档，然后开始」——效果明显更好。这个插件把这条经验做成了可安装的机制：文档有标准、标准有工具、工具有面板、经验会累积。

参考样本：`D:\XiaoProject\HanMaXiaoArtExhibition\docs\blender-agent-prompt.md`（canonical）与 `blender-iteration-prompt.md`（Round 型变体）。

---

## 一、安装后用户拿到的五件套

| # | 交付 | 落地位置 | 作用域 |
|---|------|---------|--------|
| 1 | **提示词模式** | agent preset `prompt`（新建会话顶部可选） | 会话级 |
| 2 | **相关工具** | `prompt_doc_plan` / `prompt_doc_write` / `prompt_doc_audit` / `prompt_doc_learn` | 全 profile |
| 3 | **提示词系统提示词** | `prompt:policy` prompt section（order 520） | 仅提示词模式 |
| 4 | **最佳实践 Skill** | `system-prompt-doc-best-practices`，随教训自迭代 | 全 profile |
| 5 | **悬浮提示词面板** | 编辑器左侧「✳ 提示词」启动器 + 右侧栏浮动标签页里的**嵌入对话** | 全 profile（Web UI） |

### 1 · 提示词模式

新会话的 agent preset 选择器里多一项 **提示词模式**。它的组成是「原 standard 预设 + 提示词策略」，也就是说选了它，普通编码 Agent 的能力一个不少，只是多了一条开场规则：

> 每次新会话的第一件事：加载 `system-prompt-doc-best-practices`，把正文连同末尾「已积累的经验教训」读完——不需要用户提醒。

这就是「提示词模式下每次新会话默认调用最佳实践 skill」。

### 2 · 四个工具

| 工具 | 干什么 | 关键保证 |
|------|--------|---------|
| `prompt_doc_plan` | 用任务描述扫真实仓库，产出**真实文件路径**分组（prompts / specs / plans / docs / refs / code）+ 按任务打分的**技能候选** | 有界扫描（深度、条目数、每组上限），不会在大仓库里失控 |
| `prompt_doc_write` | 按标准渲染并落盘文档，返回交接提示词 | 逐条 stat 数据源、逐条核对 skill 名；已存在且未 `overwrite` 时拒绝覆盖 |
| `prompt_doc_audit` | 按标准给已有文档打分 | 元信息块、七个章节、章节顺序、数据源章节路径、skill 可解析性、立即开始是否可执行 |
| `prompt_doc_learn` | 记一条教训，写进最佳实践 skill | 立即失效并重注册 skill，**不需要重启**下一个会话就能读到 |

### 3 · 文档标准

元信息块（`>` 引用 + 加粗键）：`版本` / `适用任务` / `使用方法` 必填，`前置条件` / `目标` 选填。

正文七章，顺序固定：

1. `角色与目标`
2. `必须加载的技能（按任务自动触发）`
3. `数据源（全部在本地工作目录）`
4. `执行顺序（严格按依赖）` — Step 0 永远是环境/前置探测
5. `硬性约束（踩坑前知道）`
6. `验收标准`
7. `立即开始` — 编号动作 + 一句加粗祈使句

审计器认得真实世界的写法：`## 验收`、`## Phase 1 执行顺序（严格按依赖）`、`## 迭代协议`、`## 视觉保真检查清单` 都能对上号。实测两份参考文档：canonical 那份 **100/100 PASS（7/7 章节）**，Round 那份被识别出 3 个章节并如实报出其缺失的 mission 章节（42/100）。

### 4 · 交接提示词

固定格式，一字不改：

```
请先读 <文档绝对路径>，然后开始 <入口>。
```

例：`请先读 d:\XiaoProject\HanMaXiaoArtExhibition\docs\blender-agent-prompt.md，然后开始 Phase 1 搭建。`

`prompt_doc_write` 的返回值里带这一行；悬浮面板也能实时生成并一键复制。

### 5 · 悬浮提示词面板 = 一个已经在提示词模式里的迷你对话

面板**不是**信息板。它是 DSH 自己的对话界面——只是绑在一个由插件创建、已经处于提示词模式的会话上。

- **入口**：编辑器工具栏左侧一个「✳ 提示词」小按钮（`conversation.input.left`）。点一下：找到或新建本工作区专属的提示词会话 → 给它绑定 `prompt` preset（`remote.agentPresets.select`）→ 在右侧栏浮动标签页打开它。
- **面板**：右侧栏标签页，里面用宿主的 `conversation.content` 工厂以 `variant: 'embedded'` 渲染那个会话。于是**编辑器、模型选择器、@ 文件引用选择器全部白送**——因为那就是 DSH 的对话框本身。
- **标签页头部**：标题 +「新会话」按钮（换一个新工作区会话，旧的保留）。

做法与 `ui-subagent` 的 sidebar-chat 完全同构：`ctx.resources.register` 一个 `promptchat` 协议提供者，把会话 id 适配成 `SessionReference`；`sidebar.right.pane.tab` 用 `SessionProvider` 包住内层会话级插槽；内层组件调用 `renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, …)`。

**为什么不是帧级浮层**：`shell.overlay` 是 root 作用域，拿不到 `SessionProvider`，因此无法在浮层里挂载另一个会话的对话。右侧栏浮动标签页才是 DSH 原生的"额外对话"座位。

**为什么去掉旧的信息面板**：它把文档标准、能力清单、工具说明全堆在一屏里，正是你不想要的那种"很多文本"。这些内容现在只在 skill 正文里，面板只负责对话。

---

## 二、文件地图

```
dsh-prompt-mode/
├── package.json          bundle 清单：dsh.bundle.patch + dsh.client + icon + 子路径导出
├── cordis.patch.yml      两行：prompt-doc-core（Host 核心）+ preset-prompt（提示词模式预设）
├── host.js               Host 核心：4 个工具 + 自迭代 skill + status.json 回执
├── mode.js               预设作用域：prompt:policy 系统提示词
├── client.js             Client：编辑器启动器 + 右侧栏浮动标签页里的嵌入对话
├── lib/standard.js       文档标准：渲染 / 审计 / 路径解析 / 技能打分（纯函数，无 Node 依赖）
├── lib/lessons.js        教训存储（同步读、追加写、可读镜像）
├── lib/scan.js           有界仓库扫描与文件分类
├── skills/system-prompt-doc-best-practices.md   基线 skill 正文（`<!-- LESSONS -->` 处注入教训）
├── locale/{zh,en}.json   插件管理页展示文案
└── icon.svg
```

## 三、运行时数据

| 内容 | 路径 |
|------|------|
| 教训存储 | `<libraryDir>/lessons.json` |
| skill 可读镜像 | `<libraryDir>/system-prompt-doc-best-practices.md` |
| 注册回执（Host 侧） | `<libraryDir>/status.json`（本次加载注册成功/失败的工具名） |
| 挂载回执（预设侧） | `<libraryDir>/preset.json`（**两段写入**：先记「预设子行已挂载」，再覆盖成带 `section` / `order` 的形态，证明 `prompt:policy` 段已注册） |

`libraryDir` 解析顺序：`config.libraryDir` → `$DSH_PROFILE_DIR/prompt-mode` → `$DSH_HOME/profiles/$DSH_PROFILE/prompt-mode` → `$DSH_HOME/prompt-mode` → `~/.dsh/prompt-mode`。

> 实测：**Host 进程里有 `DSH_HOME` 但没有 `DSH_PROFILE_DIR`**（后者是每次 shell 调用注入的），所以要靠 `DSH_PROFILE` 反推。想固定就改 `cordis.patch.yml` 里 `prompt-doc-core` 的 `config`：
> ```yaml
> - id: prompt-doc-core
>   name: '@local/dsh-prompt-mode'
>   config:
>     libraryDir: D:/some/where/prompt-mode
>     scanDepth: 4
> ```

---

## 四、安装与验证

安装（已在 `web` profile 完成，`application: applied`，无 warning）：

```
plugin_manager { action: "install_bundle", target: "D:\\XiaoProject\\DSHPluginDev\\dsh-prompt-mode" }
```

`install_bundle` 会自己做 pnpm 安装与 bundle 选择，**不要**手动改 profile 的 `package.json` / `cordis.patch.yml`。

离线自测（44 项，含真实 `dsh-tools` 注册表前置校验）：

```powershell
cd D:\XiaoProject\DSHPluginDev\dsh-prompt-mode
node --test
```

覆盖：两份真实参考文档的审计、渲染往返、交接提示词字面值、仓库扫描、技能打分、教训存储往返、`host.js`/`mode.js` 对真实服务形状的注册、以及四个工具在真实 cordis + 真实 `ToolRuntime` 下的端到端注册与执行。

## 五、维护须知

1. **改 Host 侧 JS 需要重启 Harness。**
   整轮排查量下来，Loader **只在它从未加载过这个包名时才 `import()`**；之后无论怎么重装，它都是把手里那份插件对象重跑一遍 `apply`。所以下列手段**全部无效**（逐条实测，不是推测）：

   | 手段 | 结果 |
   |------|------|
   | `install_bundle` 重装 | `ambiguous-install`（已安装时直接拒绝） |
   | `set_bundle` 关 → 开 | 重跑 `apply`，用的是**缓存**的模块代 |
   | `remove_bundle` → `install_bundle` | 同上 |
   | 改 `exports["."]` 解析目标（`index.js` → `host.js`） | 同上 —— 连解析目标变了也不重新 import |
   | 换行 id（`prompt-doc-core` → `prompt-doc-host`） | 同上 |
   | 换子路径 specifier（`@local/dsh-prompt-mode/host`） | **更糟**：`failed to import`，整行不激活（Node 侧 `import()` 三个 specifier 都能解析，是 Loader 自己的解析路径不吃子路径） |
   | 换目录（改名 → 解析出的文件 URL 变了，包名不变） | 同上，仍不重新 import |

   判据不是猜的：改用目录后，那份**旧代码**仍在运行，而它按 `import.meta.url` 拼出的基线路径已经随改名失效，于是 `readBaseline()` 抛 ENOENT，skill 正文退化成 stub ——
   运行中的进程把 `ENOENT ... 'D:\XiaoProject\DSHPluginDev\dsh-prompt-mode\skills\...'`（**旧路径**）写进了镜像文件，等于亲口承认它没有重新 import。改名实验因此作废并已还原。

   唯一确定能让新代码上线的是**新进程**（或换一个从未加载过的包名——用一次性探针包验证过，但交付物不该为此改名）。Client 侧（`client.js`）走浏览器模块表，HMR 自动重载，不需要重启。

   教训：Host 侧改动要么一次做对，要么安排重启；调试期用 `check.mjs` + 真实 `cordis` 离线探针替代在线试错。

2. **预设会随 DSH 版本漂移。**
   `preset-prompt` 的 `plugins` 列表是 `packages/bundle/web-app/presets/standard.patch.yml` 的**逐行复刻** + 一行 `prompt-mode-policy`。DSH 升级后如果 `standard` 预设变了（增删插件、改配置），这份列表要跟着同步，否则提示词模式会比 standard 少东西。diff 一下就知道：
   ```powershell
   git -C D:\XiaoProject\deepseek-harness diff -- packages/bundle/web-app/presets/standard.patch.yml
   ```

3. **失败要可见。**
   Host 侧：`tools.register()` 的抛错发生在 `ctx.inject` 的子 fiber 里，**默认静默**——开发期一个漏掉的 `output.render` 就让 4 个工具全部消失且没有任何日志。现在 `registerTools` 逐个尝试、汇总全部失败原因后再抛，并把 `status.json` 写下来。新增工具务必让 `check.mjs` 的注册表前置校验覆盖到。

   Client 侧同理：抛错的组件会把整个插槽条目变成空白，只在浏览器 console 里留一行 `slot entry crashed in '<slot>'`。`client.js` 因此包了 `PromptErrorBoundary`，并把 `SessionProvider` / `renderFactorySlot` 的缺失显式渲染成一行诊断，而不是静默空白。

4. **不要往 session log 写自定义事件类型。**
   插件自有的持久数据一律走 `libraryDir` 下的文件；`session.append()` 写的新事件类型会让旧读者拒绝重新打开会话。

5. **预设挂载失败是完全静默的 —— 判据只能是回执，不能是行状态。**
   `AgentPresetRegistry.activate()` 把挂载失败 catch 成 `record.broken` + 一行 `logger.warn`，**声明行仍然是 `active`**。实测对照：往 `prompt` 预设里塞一个必然解析失败的行，`dsh headless` 的输出与正常情况**一模一样**（只有答案，零 warning）——`logger.warn` 在该应用里根本不落到 stdout/stderr。所以：
   - 别用 `fiberPhase: "active"` 判断预设真的挂上了，它只证明 `register()` 返回了；
   - `mode.js` 因此在挂载时写 `<libraryDir>/preset.json`：第一次写证明子行已挂载，第二次（覆盖）带上 `section` / `order`，证明 `prompt:policy` 段真的注册了。只看到「没有 `section`」的形态 = 行挂上了，但这个组合里没有 `systemPrompt`。

6. **profile patch 里插入新行必须包在 `- insert:` 里。**
   顶层写 `- id: foo` + `name: bar` 是**覆盖**语义；id 不存在时 Loader 只打印 `patch: entry "foo" not found` 然后跳过。`- id:` 只能用来覆盖已存在的行（例如 `permission`、`ui-theme`）。

---

## 六、当前状态

- bundle `@local/dsh-prompt-mode@1.2.0`：`enabled: true`、`installed: true`，两行 `prompt-doc-core` / `preset-prompt`，无 `overrides`（不与任何现有行冲突）。
- **Host 行激活状态已核实**（`plugin_manager list_plugins`，共 190 行中的最后几行）：
  - `include:prompt-doc-core` → `fiberPhase: "active"`
  - `include:preset-prompt` → `fiberPhase: "active"`

  两条都 active 很重要：`@deepseek-ai/dsh-agent-preset` 的 `Service.init` 会 `await this.ctx.agentPresets.register(config)`，注册失败即抛、行会变 `failed`。所以 active ⇒ **提示词模式预设（连同 `mode.js` 注册的 `prompt:policy` 段）已经成功挂载**。
- **技能已在线**：`system-prompt-doc-best-practices` 出现在会话技能 catalog；禁用 bundle 后消失（归属确认）。
- **Client 三处注册已在线核实**（`Slots.listSubTree`，走的是用户那个真实页面）：
  - `conversation.input.left` → 占用者 `prompt-mode.launcher`，order 30，active
  - `sidebar.right.pane.tab` → 占用者 `@local/dsh-prompt-mode`，active；并声明了子插槽 `promptchat.conversation`（kind single / scope session）
  - `shell.overlay` → 旧的 `prompt.mode.panel` 已消失（只剩 5 个 shipped 占用者）

  Client 侧的 HMR 接收器**会自动重载**这个 bundle（每次改完 `client.js` 再查插槽，注册都跟着更新且无崩溃日志），所以 Client 迭代不需要重启。
- **接线已逐条对照源码核实**：
  - `renderFactorySlot` 是**每个插槽条目**的标准注入（`scoped-slots.tsx`：`const kit = { ...standard, renderFactorySlot: boundRenderFactorySlot(entry) }`，无条件）；
  - `SessionProvider` 在**子插槽声明了 session 作用域时**注入（`ui-slots`：`[Extract<ScopeOf<S>, 'session' | 'session-maybe'>] extends [never] ? object : { SessionProvider }`）——我的 `sidebar.right.pane.tab` 注册正声明了 `{ kind: 'single', scope: 'session' }` 的子插槽；
  - `remote.session.create(payload)` / `remote.agentPresets.select(sessionId, presetId)` 的调用形式与 shipped 调用点（`sessions/manager.ts`、`ui-agent-preset/seat-store.ts`）一致。
- **四个工具已在真实 Host 进程里验证上线**（不是推断）：建一个**晚于代码**的新 profile `promptverify`（`dsh --from-default-profile headless` + `dsh plugin add`），跑 `dsh headless`，其 `status.json` 为 `version: "1.2.0"`、`tools` 恰好四个名字、`toolsFailed: []`（见下「七、复现验证」）。
- **核心能力也已在同一个新进程里端到端跑通**：加载 skill → 读真实文件（`host.js` / `README.md` / `check.mjs`）→ `prompt_doc_write` 产出 15244 字节文档 → `prompt_doc_audit` 自审 **100/100 PASS** → `prompt_doc_learn` 记下 1 条教训 → 输出交接行
  `请先读 D:\XiaoProject\DSHPluginDev\verify-prompt-doc.md，然后开始 Phase 0 基线与环境探测。`
  产物留在 `verify-prompt-doc.md`（七章节 + Phase 0–4 + 验收标准齐全）；同一次运行把 skill 镜像从 8255 涨到 **8738 字节**、写出 `lessons.json`，**自迭代闭环闭合**。它甚至抓到了本 README 一处真实漂移（文件地图误写 `prompt-mode/`），已修。
- **用户那个运行中的 `web` 进程只差一次重启**：它仍持有首次安装那一刻的模块代（那份代码的 `output.render` 缺失，4 个工具静默失败）。重启后看 `C:\Users\xiaoge\.dsh\prompt-mode\` 下三个文件的 `at`/修改时间是否**晚于重启时刻**：`status.json`（四个工具）、`preset.json`（`section` + `order`）、skill 镜像。`preset.json` 尤其关键——它是目前唯一能证明 `prompt:policy` 真进了预设作用域的东西。
- **预设子行与 `prompt:policy` 段也已在真实进程里实证**（同一台 `promptverify`，给它的 user layer 插一行 `agent-preset-registry`）：`<libraryDir>/preset.json` 是 `{section: "prompt:policy", order: 520, version: "1.2.0"}` —— 这是**第二次写入**的形态，证明 `@local/dsh-prompt-mode/mode` 挂载成功、且系统提示词段真的注册进了那个预设作用域。对照实验（预设被 `--patch` 换成不可解析的行）下该文件**不出现**，所以这个判据不是自证。
  顺带把预设定义本身也验了：`mountPreset` 会挂载全部子行，一次跑通 131 行标准插件列表 + 我追加的 `prompt-mode-policy`，零失败行。
- **两处 app 组合差异，不是缺陷**：headless 应用没有 `agentPresets` 服务，所以 `preset-prompt` 行在 headless 里显示 `pending (waiting for service: agentPresets)`；在 `web` 里它 `active`。headless 也没有「选预设」的开关，所以即便把 registry 插进去，headless 里的 Agent 也不会 join 任何预设 —— 它的系统提示词里没有 `prompt:policy` 是预期行为，不是缺陷。另外 `<libraryDir>` 实测落在 `C:\Users\xiaoge\.dsh\prompt-mode`（`~/.dsh` 兜底那档）——Host 进程里没有 `DSH_PROFILE_DIR`、也没设 `DSH_PROFILE`，逐级回退到 homedir。
- **preset 漂移已核对，结论是零漂移**：把 `preset-prompt` 的 `plugins` 块与 shipped `packages/bundle/web-app/presets/standard.patch.yml` 的对应块逐行 `Compare-Object`，两侧各 131 行、**空差集**（剔除我追加的 `prompt-mode-policy` 一行后）。DSH 升级后再跑一次同款比对即可。
- **回执里的版本号已改为读 `package.json`**：原先写死 `'1.1.0'`，而清单已经是 1.2.0——回执的用途就是回答「跑的是哪一代」，写死的字面量等于自毁用途。
- **无法从我这侧做的验证**：用第二个浏览器打开 GUI 行不通——`dsh web` 的启动令牌是 `randomBytes`，只存在进程内 WeakMap 里（`browser-auth.ts` 的 `processLaunchToken`），既不落盘也不在进程命令行里，无令牌的浏览器只会拿到 `401 dsh web authentication required`。「点一下启动器」这一环必须在用户那个已认证的页面里做。

---

## 七、复现验证

「Host 侧改动要重启」这条结论把在线验证变成了死结，绕开的办法是**另起一个晚于代码的 profile**：新进程 = 全新 `import()`。全程不碰正在跑的 `web` 会话。

```powershell
$cli = 'D:\XiaoProject\deepseek-harness\apps\cli\lib\bin.js'

# 1) 从 shipped headless 模板建一个隔离 profile（--dump-config 只建不启动）
node $cli --profile promptverify --from-default-profile headless --dump-config > $null

# 2) 用真实 CLI 装 bundle（会同时写 dependencies 和 dsh.profile.bundles）
node $cli plugin --profile promptverify add link:D:/XiaoProject/DSHPluginDev/dsh-prompt-mode

# 3) 起一个新 Host 进程问它自己有哪些工具
Remove-Item Env:DSH_PROFILE_DIR, Env:DSH_PROFILE -ErrorAction SilentlyContinue
node $cli --profile promptverify "只输出一行：你当前可用工具中所有以 prompt_doc 开头的工具名，用逗号分隔。"
```

`promptverify` 的 `cordis.patch.yml` 里还加了两行——`permission`（`danger-full-access`，headless 没人在旁边批准）和一行 **insert** 进去的 `agent-preset-registry`（`config.default: prompt`）。第二步缺了它，`preset-prompt` 行会一直 `pending`，预设的子树永远不会被解析。注意那是 `- insert:` 包起来的新行，不是顶层 `- id:` 覆盖。

判定四条，全部是文件/输出事实，不依赖任何行状态：

| 判据 | 期望 |
|------|------|
| `<libraryDir>/status.json` | `version` 与 `package.json` 一致、`tools` 恰为四个名字、`toolsFailed` 为空 |
| 上面那条任务的输出 | 列出 `prompt_doc_audit, prompt_doc_learn, prompt_doc_plan, prompt_doc_write` |
| `<libraryDir>/preset.json` | 带 `section: "prompt:policy"` 与 `order: 520`（**第二次写入**的形态才说明段注册了） |
| `<libraryDir>/system-prompt-doc-best-practices.md` | 每次加载都被重写，正文含基线 + 经验教训段 |

预设那一条要配一个**对照**才有说服力——否则「文件在」可能只是自证。用一个覆盖层把预设换成必然解析失败的行，重跑，`preset.json` 必须**不出现**：

```powershell
@'
- id: preset-prompt
  config:
    id: prompt
    plugins:
      - id: bogus-control-row
        name: 'definitely-not-a-real-module-name'
'@ | Set-Content control-overlay.yml
Remove-Item "$env:USERPROFILE\.dsh\prompt-mode\preset.json" -Force
node $cli --profile promptverify --patch .\control-overlay.yml "回答一个字：好"
Test-Path "$env:USERPROFILE\.dsh\prompt-mode\preset.json"   # 必须是 False
```

不再需要这个 profile 时：

```powershell
Remove-Item -Recurse -Force C:\Users\xiaoge\.dsh\profiles\promptverify
```
