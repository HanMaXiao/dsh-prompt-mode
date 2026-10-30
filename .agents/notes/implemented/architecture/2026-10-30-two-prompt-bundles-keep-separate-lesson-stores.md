# Agent Note: 两个提示词 bundle 各自持有一份教训存储实现

Status: implemented

## Problem

工作区里有两个提示词插件：本仓库 `@local/dsh-prompt-mode`（把任务写成系统提示词文档再交接）和姊妹仓库 `@local/dsh-prompt-optimize`（把用户的输入改写成更好的提示词）。两者都要「记一条教训，让下一次会话加载 skill 时读到」，于是两边都要一个同步可读、追加写、落在 profile 目录下的 JSON 存储。

第一反应是把这份实现抽出来共享。它是纯粹的 `node:fs` 加 `node:path`，没有第三方依赖，两边连方法签名都一致——复制的味道很重，而任何后来的审计都会把它标成重复代码。

但两个 bundle 不是同一个进程里的两个模块，也不是一个 monorepo 里的两个 package。它们各自被 `install_bundle` / `plugin add` 装进同一个 DSH profile，由 Loader 按磁盘上的路径独立 `import()`。**它们之间不存在任何共享代码的通道。**

## Decision

两个 bundle 各自持有一份 `lib/lessons.js`，并且这是刻意的：

- **目录分开。** 本包落在 `<libraryDir>/prompt-mode`，姊妹包落在 `<libraryDir>/prompt-optimize`。两个能力、两套教训、两份 skill 可读镜像，互不抢占。
- **代码是手工镜像的副本，不是同一份。** `dsh-prompt-optimize` 无法 import `dsh-prompt-mode/lib/lessons.js`，反过来也一样——两边之间没有共享的内部 package。理由和边界原样记在姊妹仓库（`D:\XiaoProject\DSHPluginDev\dsh-prompt-optimize`，在本仓库之外）的 `lib/lessons.js` 模块注释里：改一份就必须改两份，否则两个插件会在「静默差异真的会吃掉教训」那一个地方各自漂移。
- **标识刻意不同。** 本包教训 id 是 `L###`，姊妹包是 `T###`；两边的分类集合也不同（本包 anatomy / skills / datasource / order / constraint / acceptance / handoff / tooling / other，姊妹包 structure / wording / context / constraint / acceptance / format / tooling / other）。同一个 store 里混两种 id 前缀和两套分类，读的人无法判断一条教训属于哪个 skill。

镜像是有界的：重复的只有 `lib/lessons.js` 一个文件，约 200 行，且它的契约被两边各自的 `node --test` 独立钉住。

一处已知的不对称，记录在此以免后来者「顺手修平」：本包的 `composeLessonsSection` 在 [`lib/standard.js`](../../../../lib/standard.js)（和渲染、审计共用一份文档标准），姊妹包的在它自己的 `lib/lessons.js` 里。这不是疏漏，是两边组合方式不同的结果；统一它要动的是打包形状，不是代码位置。

## Alternatives considered

**建一个共享的内部 package（比如 `@local/dsh-prompt-lessons`），两个 bundle 都依赖它。** 这是最干净的 DRY 答案，也是每一次代码评审都会提的那个。它输在加载模型上：一个 bundle 是作为独立 package 被安装和加载的，Loader 按解析出的文件 URL 决定要不要 `import()`，第三个本地 package 意味着每个 profile 要多一次安装、多一条可以独立漂移的依赖，而插件自己 `package.json` 的 `files` / `exports` 必须把它一起发出去。更麻烦的是它把「改一份」从两处变成三处，却没有去掉任何一个。共享代码的通道不存在，不是因为没人建，而是因为建了它不连通。

**两个 bundle 共用一个 `lessons.json` 目录。** 省掉一份实现，也省掉一次同步。它输在语义上：两边的 skill 基线不同，一条关于「七块结构怎么排」的教训和一条关于「数据源必须逐个确认存在」的教训不属于同一份经验。混在一个 store 里，`composeLessonsSection` 会把两类教训渲染进同一个 skill 正文，而两个 skill 各自只该读到自己的那半。目录分开正是为了让两份教训集、两份镜像永不互相覆盖。

**用一个生成步骤或构建步骤把公共部分同步过去。** 本包刻意没有 build：Loader 按磁盘原样读文件，任何生成步骤都只会保证 `package.json` 的 `files` 和目录树不一致。用一个脚本在发布前复制 `lib/lessons.js` 听起来无害，但它把「两份必须逐字节相同」这条约束从评审可见降级成一条只在有人记得跑时才成立的约定——而忘跑的那次不会报错。

**让一个 bundle 直接读另一个的教训存储。** 省掉一整份实现。它输在生命周期上：两个插件可以分别启用、分别卸载、分别指向不同的 `libraryDir`，一个插件读不到另一个的文件时必须退化，而这个退化路径比它省下的那份实现更难验证。姊妹包的 `lib/lessons.js` 头部把这一点写成了结论：两个能力、两个教训集、两个镜像。

## Consequences

- **改一份必须改两份。** 这是这笔交易的核心代价，而且它有名字：静默差异会真的吃掉教训，而被吃掉的教训是拿真实返工换来的。本包的[原子落盘与串行追加](../bug-fix/2026-10-30-atomic-document-writes-and-serialized-lesson-appends.md) 和姊妹包 `bcb5d6c` 的「serialize the lesson store's writes」就是同一组改动在两边的两次落地——那一次是同步做的。
- 两个 store 永不互相抢占：目录不同、id 前缀不同、分类集合不同、skill 镜像文件名不同（`system-prompt-doc-best-practices.md` 对 `prompt-optimization-best-practices.md`）。
- 重复被限制在 `lib/lessons.js` 一个文件里，且两边各自的 `node --test` 独立钉住同一份契约：`lessons.json` 的 `{ version: 1, lessons: [...] }` 形状、`add()` 的同步语义、以及并发写入被拒绝而不是被允许竞争。
- 一个新读者第一次看到两份近似相同的文件时，会想合并它们。这篇 note 就是给那个人看的：先读上面第四条备选方案，再决定要不要动。

## Testing

两边的存储契约由各自的离线套件独立钉住，任何一边单独改都不会被另一边放过：

- 本包 [`tests/host-write-safety.test.js`](../../../../tests/host-write-safety.test.js) 的 `LessonsStore.add` 块：12 条并发追加一条不丢、id 连续且唯一、`lessons.json` 格式逐字节钉住、后续写入失败时已记的教训仍在。
- 本包 [`tests/lessons-store.test.js`](../../../../tests/lessons-store.test.js)：往返、可读镜像、按分类分组的教训段。
- 姊妹包 `tests/tune-heuristics.test.js`：`lessons.json` 格式与 `add()` 的同步契约、以及「another write … is still in flight」的拒绝形状。

## Related

- [Agent Note: 原子落盘与串行追加](../bug-fix/2026-10-30-atomic-document-writes-and-serialized-lesson-appends.md) —— 同一份实现在本包这一侧的安全属性。
- [README.md 三、运行时数据](../../../../README.md) —— 两个 store 各自落在哪个目录、`libraryDir` 怎么解析。
