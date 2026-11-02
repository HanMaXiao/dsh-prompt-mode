提 PR 前先读 [CONTRIBUTING.md](../CONTRIBUTING.md)；下面是本仓库特有的检查项，请逐项确认。

## 检查清单

- [ ] `node --test` 已通过：失败为 0。跳过的条数随工作区变化（缺 canonical 参考文档时那几条 SKIP），不必强求；改了行为就连它的测试一起改。
- [ ] README / CHANGELOG / Agent Note 已按需更新：README 是事实权威，版本间的变化记进 CHANGELOG，「为什么这么做」写进 [.agents/notes/](../.agents/notes/README.md)。
- [ ] 零 emoji：文案、注释、提交信息、标识符、文档里都没有。
- [ ] 未引入依赖，也未引入 build / bundler / typecheck / lint 中的任何一步。
- [ ] 未改 `cordis.patch.yml` 里 `preset-prompt` 的复刻行——除非是随 DSH 升级同步，且已跑过漂移检查并把结果附在下面。
- [ ] 动了 Host 侧（`host.js`、`lib/`、`mode.js`）：已在说明里写清它需要重启 Harness 进程才生效（原因见 [README 五、维护须知 第 1 条](../README.md#五维护须知)）。

## 说明

（这个 PR 做了什么、为什么、放弃了什么；预设复刻同步请附漂移检查输出。）
