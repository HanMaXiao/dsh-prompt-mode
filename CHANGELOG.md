# Changelog

本仓库遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的格式，版本号尽量贴近 [语义化版本](https://semver.org/lang/zh-CN/)。README 持有当前状态的事实，本文件只记录版本之间变了什么。本文件从 1.3.0 起记；更早的历史在 git log 里。

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
