# Agent Notes

这里只放一种文档。**Agent Note** 记录一个影响本代码库的决策或提案——*为什么*，以及*为此放弃了什么*，也就是代码、测试和 [README.md](../../README.md) 都承载不了的那部分。本文件规定 Agent Note 放在哪、什么时候该写、以及[文件格式](#the-file-format)。

这套规则抽取自 DeepSeek Harness 的 Agent Note 模式，并针对单一私有插件做过裁剪。有差异时以[与源模式的差异](#与源模式的差异)为准。

## 布局与命名

每篇 Agent Note 有两条轴，都编码在它的**路径**里——`{lifecycle}/{class}/yyyy-mm-dd-主题标题.md`：

- **Lifecycle**（顶层目录）就是这篇 Agent Note 的状态，状态变了就把文件在目录之间搬：
  - **`proposed/`** —— 实现之前评审的提案；尚未落地（或只落地了一部分）。
  - **`implemented/`** —— 决策已经发布。文件记录决定了什么、否决了什么，并且**跟着实际发布的内容保持最新**：之后代码移动了文件、改了座位 id、改了字段或默认值，同一个改动里就要把这篇 Agent Note 改到一致（只改事实——路径、名字、结构——不改决策本身）。见 [implemented/AGENTS.md](implemented/AGENTS.md)。
  - **`rejected/`** —— 考虑过并否决了。只在它的理由还能阻止一个诱人的、有分量的错误时保留，否则直接删掉文件。
  - **`archived/`** —— 已实现的 note 冻结成历史快照。见[归档与删除](#归档与删除)与 [archived/AGENTS.md](archived/AGENTS.md)。
- **Class**（嵌套目录）是决策的*种类*——见[分类](#分类)。

文件名里的日期是这个主题**第一次被提出**的日期。一篇后来在 lifecycle 之间搬动的 note 保留原日期：lifecycle 目录本身已经说明了变化。Agent Note 之间的交叉引用一律用相对 markdown 链接（形如 `../../implemented/architecture/2026-10-30-主题标题.md`，按实际路径写）——不用裸文字、不用裸编号——这样它才可机械检查，也才扛得住在目录之间搬家。

活跃的 lifecycle 树就是工作清单：翻它的 lifecycle/class 目录，或者直接搜仓库。**不要**加集中式 `INDEX.md`：它重复路径元数据，还会让互不相关的 note 改动争抢同一个生成文件。

## 分类

每篇 Agent Note 属于下面这个封闭集合里的一个路径编码 class。新增 class 必须同时更新本表和目录树。

| Class | 覆盖什么 |
|---|---|
| `feature` | 一个新的用户可见能力：一个标签页、一个视图、一个弹窗、一个排序字段。 |
| `bug-fix` | 修正一个缺陷或补上一个缺口。 |
| `simplification` | 在不增加能力的前提下去掉代码、行为或表面积。 |
| `architecture` | 关于**发布出去的源码**的结构性决策——两个主人各自持有什么、桥是什么、什么可以被拆分。 |
| `process` | 代码**周边**的工具、策略或工作流——Agent Note 流程本身、验证习惯、文件归属——不是运行时行为。 |
| `testing` | 测试基础设施与策略。 |

`architecture` / `process` 的分界线：**architecture** 是关于我们发出去的源码；**process** 是围绕它的工具与工作流。（`refactor` 是刻意缺席的——它和 `simplification` 重叠，而后者的判别式「可观察行为变不变？」已经覆盖了它。）

## 什么时候该写一篇

只有「代码、测试和 [README.md](../../README.md) 都解释不了的、长期的决策理由」，才在同一个改动里新增或更新一篇 Agent Note。对未来大量工作的提案从 `proposed/` 开始；已经做成的决策从 `implemented/` 开始。Class 目录选匹配这个决策的那个（见[分类](#分类)）。

更新已经持有该决策的那篇 Agent Note 就满足规则，不要建重复篇。机械性修改或局部编辑豁免，包括局部 UI 呈现与交互变化。**永远不要把一篇 Agent Note 改写成另一个决策**：用新的一篇取代它，并让两篇保持交叉链接。把一篇 `implemented/` 的 Agent Note 改到跟上前它自己的决策现在落在哪里，是必需而不是禁止；见 [implemented/AGENTS.md](implemented/AGENTS.md)。

一篇复述 README 的 Agent Note 不是 Agent Note——README 是权威，note 是它某一片背后的推理。实践中 note 拥有的是*为什么选了这个形状而不是旁边那个合理选项*，README 只把它当事实陈述，不负责辩论。

一篇被完全取代的已实现 Agent Note 可以合并进当前持有它的那篇然后删除。删除之前，持有人必须保住每一条独有的理由、备选方案、后果和被点名的覆盖缺口，并修好每一条入站链接。部分取代不算数：两篇都留着、互相交叉链接，并把每条仍然成立的事实改到最新。合并不许把旧文件改写成它的反面，也不许把版本控制历史当作理由的唯一副本。

## 归档与删除

删掉那类只描述小幅 UI 调整或纯机械变更的已实现 Agent Note，并修掉或去掉它的入站链接。一个局部 bug 修复、一次性能改动、一项新能力、一个有分量的行为决策，不会因为实现很小就获得删除资格。其他已实现 note 只在「发布的决策已经完结、它的理由不太可能再指导后续工作、而记录仍有历史决策价值」时归档。当它的备选方案、归属边界、否定性保证或重新引入条件仍然有用时，保持活跃。**永远不要归档一篇提案**：废弃的提案要否决。被否决的 note 只在它能阻止一个说得通的错误时保留，否则删掉。判断依据是决策本身还指不指导工作，不是字数、年龄或指标配额。

归档路径编码为 `archived/{class}/yyyy-mm-dd-主题标题.md`；`implemented` 刻意不出现在归档路径里，因为只有已实现的 note 能进这里。一次归档改动搬动文件、保留 `Status: implemented`、在状态行正下方插入一行 `Archived: YYYY-MM-DD`，并修掉或删掉入站链接。这是归档期间唯一允许的内容变更。既有的标题标点和空行布局不阻挡归档；连同正文一起保留。

一旦封存，每篇归档 note 永久冻结。不要编辑、重排、更新、移动或删除它，也不要把它当作当前行为的权威。活跃正文仍然可以链进一篇归档 note，只要那是刻意引用历史。

## 文件格式

每篇活跃 Agent Note 遵循同一种文件格式。统一格式的理由、以及它否决掉的备选方案，本身是源模式里的一篇归档 Agent Note；在这里，这个格式就是本节。

### 头部块

每篇 Agent Note 的前三行必须是：

```markdown
# Agent Note: <title>

Status: <status>
```

随后一个空行。`Status:` 的取值是三种形态之一，并且必须和文件所在的 lifecycle 目录一致：

- `Status: proposed`
- `Status: implemented`
- `Status: rejected — <一句话原因>`

状态行不带日期、不带括号：文件名持有首次提出日期，lifecycle 目录持有其余一切。「以修改后的形式接受」这类话是正文内容——在陈述决策的地方说明修改。否决原因是唯一带内容的状态，因为一篇被否决的 Agent Note，读者要的就是这个结论。

一篇归档 note 在状态行正下方多一行：

```markdown
Archived: YYYY-MM-DD
```

### 正文骨架

每篇 Agent Note 用 `## Problem` 开场——动机，写成脱离解决方案也站得住。之后的内容取决于 lifecycle；复用的章节用下面这些规范名，不用别的，而真正专门的技术章节（数据模型、桥、文件布局）在必需章节之间保持自由。

#### `proposed/`

```markdown
## Problem
## Proposal
…专门章节…
## Alternatives considered
## Acceptance criteria
## Risks
```

`## Proposal` 是意图中的变更，用将来时完全正当——计划、迁移步骤、开放问题在未建成时都属于这里。`## Acceptance criteria` 说出什么样的可观察状态算完成。`## Risks` 同时覆盖可能出什么错，以及这个变更有意放弃了什么。见 [proposed/AGENTS.md](proposed/AGENTS.md)。

#### `implemented/`

```markdown
## Problem
## Decision
…专门章节…
## Alternatives considered
## Consequences
```

`## Decision` 用现在时描述已发布的现实，并且整篇文件按 [implemented/AGENTS.md](implemented/AGENTS.md) 与它保持最新。`## Consequences` 记录这笔交易**付出**了什么、**买到**了什么。提案期的小标题在这里是规格用语，不许出现：`## Proposal`、`## Plan`、`## Migration plan`、`## Acceptance criteria` 不得出现在一篇已实现的 Agent Note 里。`## Testing`、`## Deferred`、`## Related` 在陈述现在时事实时可以出现。

#### `rejected/`

一篇被否决的 Agent Note 就是那份被冻结的提案：保留它提案期拥有的全部章节（包括 `## Acceptance criteria` 或 `## Plan`），结论住在 `Status:` 行。只有头部块、`## Problem` 开场、一个 `## Proposal` 章节，以及下面那条备选方案强制要求适用。见 [rejected/AGENTS.md](rejected/AGENTS.md)。

### Alternatives considered —— 强制

每篇 Agent Note 都带一个 `## Alternatives considered` 章节：每一个真实的备选方案和它为什么输，**一个加粗引导段一个备选方案**，或对有争议的用一个 `### Why not <X>?` 小节。一个没有记下它打败了什么 的决策，就是在邀请重新辩论——而这正是 Agent Note 要防的失败。

段落要把输家和理由写在加粗引导里：

```markdown
**Store items in browser `localStorage`.** The obvious cheap answer …
```

备选方案是记录下来的，不是发明出来的。不要重建一个从未被真正权衡过的备选方案，也不要用一个理性的实现者绝不会选的选项来填充这一节——这一节记录的是那场真实发生过的辩论。

## 在 lifecycle 之间搬动

把一个文件在 lifecycle 目录之间搬动，意味着在同一个改动里更新 `Status:` 行并重新满足目标目录的骨架。具体说，`proposed/` → `implemented/` 把 `## Proposal` 改写成现在时的 `## Decision`，把 `## Acceptance criteria` 和 `## Risks` 折进 `## Consequences`（或者为现在钉住行为的东西单开一个现在时的 `## Testing`），并用已发布的内容替换计划。`proposed/` → `rejected/` 只往 `Status:` 行加原因并冻结文件。`implemented/` → `archived/` 搬动文件并插入归档日期行；见[归档与删除](#归档与删除)。

## 中文对照件——建议，不强制

一篇 `.zh.md` 对照件**可以**逐节镜像一篇英文 note 的结构。当这篇 note 记录的决策是中文阅读的维护者很可能要为之辩护或重新审视的——一条理由、一个被否决的备选方案、一条边界——就写一篇。内容只是路径、字段名和字节上限的窄事实记录可以跳过。

真要写时，保持机器检查的头部 token（`# Agent Note: ` 和 `Status:` 行）英文原样，逐节镜像章节顺序，只译正文。两个文件在同一个改动里更新，永远不要让一对对照件漂移。

## 与源模式的差异

这套契约抽取自 DeepSeek Harness 的 Agent Note 模式。四处差异是刻意的。

- **权威不是 DESIGN.md，是 README.md。** 源模式把设计契约放在独立的 `DESIGN.md`，notes 只持有它背后的推理。本仓库没有 DESIGN.md：README 就是那份契约，所以「复述 README 的 note 不是 Agent Note」在这里比在源模式里更硬——README 已经同时是事实权威和设计陈述。
- **`.zh.md` 对照件是建议，不强制。** 源模式要求每篇 note 都有中文孪生并用检查器强制配对。这里由判断决定：这是一个单一私有插件，note 全集只有一小把，强制译写孪生只会让写入成本翻倍，而不会多出一个本来不读英文的读者。判断标准是[中文对照件](#中文对照件--建议不强制)那一节。
- **没有 `.i18n.yaml` 边车文件，也没有哈希清单。** 源模式记录一个配对口车和一个只追加的冻结内容清单，好让脚本能证明一个归档三元组从未被编辑。这里没有这样的脚本在跑，所以边车文件会变成一句无法验证的断言。归档由人对照 [archived/AGENTS.md](archived/AGENTS.md) 审。
- **没有可执行的格式闸门。** 源模式跑一个检查器，交叉核对 `Status:` 行与 lifecycle 目录、拒绝提案期小标题出现在已实现 note 里、拒绝未知 class 目录。这里那些是评审规则：读它们、应用它们，并在完成一个改动前第二遍审它们。
- **交叉引用和删除说的是文件，不是三元组。** 下面每条规则都说「文件」或「那篇」，因为一篇 note 就是一个文件，除非存在 `.zh.md` 对照件。
