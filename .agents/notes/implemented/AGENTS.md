# AGENTS.md — Implemented Agent Notes

这些 Agent Note 描述已经发布的决策。遵循[根说明](../../../AGENTS.md) 与 [Agent Note 格式](../README.md#the-file-format)。

## 让一篇已实现的 Agent Note 跟得上实际发布了什么

路径、座位 id、字段名、默认值和机制，在改动它们的同一个改动里改到最新。就地重写过期的事实，不要追加变更历史。

当一篇已发布的 note 不太可能再指导后续工作时，通过[归档与删除](../README.md#归档与删除) 归档它，而不是继续维护它。

## 这不是改写*决策*的许可证

就地更新事实落地。决策或其理由的反转需要一篇新的 Agent Note 和一条交叉链接；一篇被完全取代的旧 note 只能按 [Agent Note 规则](../README.md) 删除或归档。

## 正文读作现在时事实

`## Decision` 描述现在存在什么，不是计划过什么。提案期小标题——`## Proposal`、`## Plan`、`## Migration plan`、`## Acceptance criteria`——不出现在这里。`## Testing`、`## Deferred` 和 `## Related` 在陈述现在时事实时可以出现。

备选方案按原样留着。一个输给了一个已不存在设计的备选方案，正是这个目录要保住的东西：不要因为它读起来别扭就删掉，也不要为了讨好当前设计而改写它。
