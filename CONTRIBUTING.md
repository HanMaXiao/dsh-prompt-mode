# 贡献指南

欢迎提 issue 和 PR。本文件只讲**流程**；规则与事实不住在这里——动手之前先读 [AGENTS.md](AGENTS.md)（必须怎么做）与 [README.md](README.md)（是什么、实测到什么）。三者冲突时以 README 为准，本文件与 Agent Notes 冲突时以 AGENTS.md 为准。

## 动手之前

1. 通读 [AGENTS.md](AGENTS.md)。它的每条规则都自成一句，并链接权威而不是复述权威；本文件同样遵守这条，所以这里只有指针。
2. 装好插件、跑一遍验证命令，确认你的树是绿的（见下）。
3. 报告安全问题不要开 issue：走 [SECURITY.md](SECURITY.md) 的私密漏洞报告途径。

## 开发循环

唯一的验证命令：

```sh
node --test
```

**没有** build、bundler、typecheck、lint，也不要引入其中任何一步，也不要引入依赖。理由是加载方式：Loader 直接按磁盘上的原样读这些文件，纯 ESM、零依赖。一个编译步骤只会保证 `package.json` 的 `files` 和目录树不一致，而 bug 只能被 `node --test` 或真跑一遍发现。测试描述的是行为——改掉了某个行为，就连它的测试一起改。

DSH 升级后、以及每次改过 `cordis.patch.yml` 的 `plugins` 列表之后，必须跑预设复刻校验，命令与退出码见 [AGENTS.md 的命令一节](AGENTS.md#命令)。

## 改动怎么生效

Host 侧（`host.js`、`lib/`、`mode.js`）的改动**必须重启 Harness 进程**才会上线；Client 侧（`client.js`）刷新页面即可。原因是 Loader 只在从未加载过一个包名时才 `import()` 它，重装、关闭再打开、改解析目标统统无效——逐条实测与唯一确定的生效手段见 [README 五、维护须知 第 1 条](README.md#五维护须知)。实践中这意味着：Host 侧改动要么一次做对，要么在 PR 里说明它需要一次重启。

## 分支与提交

分支名用 `type/mode-topic`，与既有分支保持一致（例如 `docs/mode-repo-security`、`fix/mode-asar-extract-oneliner`）。`type` 取 `feat` / `fix` / `docs` / `chore` / `refactor` / `test` 之一，`topic` 用短横线连接的小写短语。

提交信息用 [Conventional Commits](https://www.conventionalcommits.org/)：`type: subject`，可加 scope（既有历史里有 `client:` 这种用法）。subject 用现在时、说清做了什么，不写「修复了一些问题」这种空话。

## locale 双语同步

新增用户可见字符串一律走 `ctx.locale.register` / `bind`，`locale/zh.json` 与 `locale/en.json` **同步加同样的键**。两份字典的键集合必须始终保持一致——少一个键就是少一种语言的用户，`tests/smoke.test.js` 会把它拦下来。

## Agent Notes

决策理由——为什么这么做、放弃了什么、代价是什么——住在 [.agents/notes/](.agents/notes/README.md)，那里的一页 README 规定格式、分类与生命周期。**什么时候该写一篇**：只有「代码、测试和 README 都解释不了的为什么」才写；机械性修改和局部 UI 调整豁免。永远不要把一篇 note 改写成另一个决策：用新 note 取代它，并让两篇互相交叉链接。提 PR 前先做一次取代检查——活跃树里有没有已经持有同一篇决策的旧 note。

## 提 PR

PR 描述请对照 [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md) 的检查清单逐项确认，特别是 `node --test` 全绿、零 emoji、未引入依赖、未顺手改 `preset-prompt` 的复刻行。改动会随 DSH 版本漂移的部分（`cordis.patch.yml` 的复刻列表）要附上漂移检查的结果。
