# AGENTS.md — Agent Notes

Agent Note 是 agent 写的 RFC：持久的提案与决策记录，保住理由、备选方案、后果和必需的验证。它们是本仓库里唯一记录*为什么*和*放弃了什么*的地方；[README.md](../../README.md) 持有什么是真的，一篇 note 持有选了这个而不是那个。遵循[根说明](../../AGENTS.md) 与 [Agent Note 规则](README.md)。

**每新增一篇 Agent Note 都触发一次取代检查。** 在活跃树里搜索覆盖同一决策或同一机制的旧 note，按 [implemented/AGENTS.md](implemented/AGENTS.md) 和[归档与删除](README.md#归档与删除) 的规则给任何完整或部分取代定性，并在同一个改动里归档或合并每一篇符合条件的已实现 note。部分取代的两篇都保持活跃并互相交叉链接。不要把已知匹配推到以后的语料审计。

三个事实决定这里的大多数问题：

1. **[README.md](../../README.md) 是契约。** 复述它的 note 是重复，不是理由。记下推理、被否决的邻居和后果；链接陈述事实的那一节。
2. **`Status:` 必须和 lifecycle 目录一致。** `proposed/`、`implemented/`、`rejected/` 和 `archived/` 各有自己的骨架和自己的说明；一次搬动在同一个改动里重写正文。
3. **备选方案是记录下来的，不是发明出来的。** 每个真实输掉的选项一个加粗引导段，说清为什么。这是读者要的那一节。

Lifecycle 说明：[proposed/AGENTS.md](proposed/AGENTS.md) ·
[implemented/AGENTS.md](implemented/AGENTS.md) ·
[rejected/AGENTS.md](rejected/AGENTS.md) ·
[archived/AGENTS.md](archived/AGENTS.md)。

[`archived/`](archived/AGENTS.md) 下的文件是冻结的历史快照：永远不要编辑它们，也不要把它们当作当前权威。
