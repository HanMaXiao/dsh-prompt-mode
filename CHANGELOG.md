# Changelog

本仓库遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的格式，版本号尽量贴近 [语义化版本](https://semver.org/lang/zh-CN/)。README 持有当前状态的事实，本文件只记录版本之间变了什么。本文件从 1.3.0 起记；更早的历史在 git log 里。

## [1.4.0] - 2026-11-02

### 新增

- **`prompt_doc_audit` 批量模式。** 新增 `paths` 参数：一次调用审计多个文档，逐文档给出分数、PASS/FAIL 与问题，外加一行汇总（总数、通过 / 失败数、平均分）；省掉 `paths` 时行为与返回形状和以前完全一致。
- **提示词会话切换器。** 标签页头部把本工作区记住的会话列成一排小按钮（短 session id，当前会话标「当前」），点一下就在右侧栏打开那个会话。记住的列表从「每工作区一个 id」换成 localStorage 里的有界列表（上限 8 条），旧的单 id 记录按单条目列表读取，启动器仍恢复最后一条。
- **可配置的扫描边界。** 插件 config 新增 `maxEntries`（扫描条目上限）与 `groupCaps`（每组保留上限，未列出的分组保持默认）两个键；类型、范围、未知键与未知分组都在 apply 时响亮报错，不静默回退默认值。

### 变更

- **审计标记与图标去 emoji。** `prompt_doc_audit` 的 `presentResult` 用 PASS / WARN / FAIL 文字标记取代 emoji 三件套；启动器与标签页头部改用内联 SVG 图标（可访问名不变），skill 正文的约束行同步换词。

### 修复

- **`prompt_doc_write` 落盘前校验。** 每个数据源路径与 skill 名现在在动磁盘之前解析：解析不动的条目默认让调用失败并逐条点名，`force: true` 才强行写入（结果仍带同样的报告）。此前死路径只会在文档写完之后的结果里报出。
- **Client 诊断字符串 locale 化。** `diag.*` 诊断文案改走 locale 字典，zh / en 两份同步加同样的键。

### 重构

- **四个工具定义移入 `lib/tools.js`。** `host.js` 只留装配层（config 解析、自迭代 skill、回执、入口）；纯移动，函数签名与导出形状不变，`node --test` 计数不变。
- **有界扫描改用索引队列与解析器记忆化。** 大仓库里的 syscalls 随之下降；扫描结果与分组不变。

### 工具

- **仓库守护测试。** 新增三条：AGENTS.md 不超过 8192 字节预算、每个 git 跟踪文本文件恰好一个结尾新行、全仓库零 emoji。
- **CI 上 Windows。** 测试套件在 ubuntu 之外多一个 `node --test (windows)` 作业——两个具名作业而非 matrix，分支保护因此要求 `node --test` 与 `node --test (windows)` 两个 context；同时补上 resolver 与 plan 工具路径的测试。
- **`scripts/verify-host.mjs`。** 把「另起一个晚于代码的 profile、跑通四个回执判据」的手工流程脚本化为一条命令（`npm run verify`）；DSH CLI 不可得时打印 SKIP 并以 0 退出。
- **`scripts/check-lessons-mirror.mjs`。** 比对本包与姊妹包 `lib/lessons.js` 的契约面（4 个导出加行为探针），退出码与 `check-preset-drift.mjs` 一致；CI 增加 `continue-on-error` 的 `lessons mirror drift (informational)` job。

### 文档

- 新增 `SECURITY.md`、`CONTRIBUTING.md`、`CODEOWNERS`、dependabot 配置、issue 模板、PR 模板与 `.gitignore`。

## [1.3.0] - 2026-10-30

### 新增

- **save-to-Hub 按钮。** `conversation.input.left` 座位里多一个紧凑按钮（id `prompt-mode.save-to-hub`，order 40，紧跟启动器），把输入框里的草稿复制成 `@hanmaxiao/dsh-hub` 的 Prompt 条目。草稿通过座位注入的 `useInput` 读，条目通过 Hub 自己挂上的 `remote.hub` 命名空间写，标题取草稿第一个非空行 trim 后截到 60 字符。Hub 没装时整个条目不渲染，草稿为空时禁用并说明原因，保存被拒时给一行可关闭的原因。草稿永不清空。

### 变更

- **预设插件列表按运行中的 DSH 发行版刷新。** `preset-prompt` 的 `plugins` 是从 shipped `standard` 预设逐行复刻再加一行本包自己的 `prompt-mode-policy`；这次按用户实际运行的那个发行版（`app.asar` 里的 `standard.patch.yml`）重新对齐，现在是 22 行复刻 + 1 行自有。新增 `time-context`、`tool-schedule`、`tool-plugin-market`，去掉 `persona` 多余的 `suffix`、`tool-subagent` / `tool-subagent-fork` 的 `backgroundMode: continuable`、delegation 组的三个子行，并把 plan-mode 的 `section` 文本换成发行版用词。
- **离线自测迁移到 `node --test`。** 父目录的 `check.mjs` 删除，按逻辑拆成 `tests/` 下的多个 `*.test.js`，断言 1:1 保留；验证命令统一为包内 `node --test`。`skills/system-prompt-doc-best-practices.md` 改为入库（`.gitignore` 里运行时数据的模式改为根锚定），否则干净检出的 skill 正文会退化成 stub。

### 修复

- **Host 侧写入不再留下半份文件。** `prompt_doc_write` 原先直接把渲染结果写到目标上，一次中断的写入会在原本完整文档的位置留下半渲染的一份。现在走 `lib/lessons.js` 的 `writeFileAtomic`：同目录临时文件加一次重命名，失败时清理临时文件并在错误里点名目标路径。落盘字节与普通写路径逐字节相同。
- **并发 `prompt_doc_learn` 不再丢教训。** `LessonsStore.add` 原先把读、推 id、写回当成三个独立步骤，两次重叠调用会推出同一个 id 且后一次覆盖前一条；写裂的 `lessons.json` 更糟——读回来是零条教训而不是报错。现在整个读-改-写作为一个同步 unit 串行执行，发现队列忙时拒绝这次调用并提示重试。`lessons.json` 格式和 `add()` 的返回形状不变。

### 工具

- **`scripts/check-preset-drift.mjs`。** 零依赖的逐行 diff，比对本包 `preset-prompt` 的 `plugins` 列表与一个 DSH 源码检出里的 shipped `standard` 预设，自动剔除本包自己追加的行。零漂移退出码 0，有漂移逐行打印后退出码 1，给了不可用的根退出码 2；没有根时打印 SKIP 并以 0 退出。CI 增加一个 `continue-on-error` 的 `preset drift (informational)` job 跑同一个脚本——它只提醒，不拦截合并。

### 文档

- 新增 `AGENTS.md`（未来 agent 的工作规则）与 `.agents/notes/`（决策理由库）。README 里指向已删除的 `check.mjs` 的引用、过期的自测计数「44 项」、过期的预设行数「131 行标准插件列表」一并订正。

[1.3.0]: https://github.com/HanMaXiao/dsh-prompt-mode/compare/d5490a3...6c9a2aa
[1.4.0]: https://github.com/HanMaXiao/dsh-prompt-mode/compare/4c52223...8b661f1
