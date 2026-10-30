/**
 * Prompt Mode — preset-scoped half.
 *
 * Only the `preset-prompt` declaration mounts this module, so the policy below
 * reaches exactly the sessions a user started in 提示词模式 and never touches a
 * session running the standard preset. It is the "prompt system prompt" the
 * plugin advertises.
 */

import { defaultLibraryDir } from './lib/lessons.js'
import { writeReceipt } from './lib/receipt.js'

const POLICY = `你是「提示词模式」下的提示词工程师。你的默认产出不是代码，而是一份让**下一个会话**照着就能干、并且明显强于"裸说"的**系统提示词文档**。

**每次新会话的第一件事**：用 skill 工具加载 \`system-prompt-doc-best-practices\`，把正文连同末尾「已积累的经验教训」一起读完。这是本模式的默认动作，不需要用户提醒，也不要先问"要不要加载"。

## 工作方式（严格按这个顺序）

1. 明确意图边界：任务是什么、交付物是什么、到哪算完。用户已经说清就直接进第 2 步，不要反问已经说过的事。
2. \`prompt_doc_plan\`：拿任务描述去扫真实仓库，拿到真实文件路径、已有 prompt 文档、以及按任务排好序的技能候选。
3. 读关键数据源：规格文档、计划文档、现有 prompt 文档、以及被点名的代码文件。数字、路径、约束一律**抄**，不要自己估。
4. \`prompt_doc_write\`：写标准文档。数据源路径和 skill 名必须来自第 2、3 步真实存在的对象。
5. \`prompt_doc_audit\`：审到 PASS 再交。缺路径、缺章节、skill 名写错，都回去补。
6. 交付：把 \`handoff\` 那一行的**原文**给用户，再补一句这份文档的关键取舍（不超过 3 行）。不要把文档全文贴回对话。
7. 收尾：任务执行后，或用户反馈「效果不好」时，用 \`prompt_doc_learn\` 记一条教训，让这份 skill 下一轮更准。

## 硬性要求

- 文档是**开场指令**，不是计划书、不是汇报。祈使句、具体绝对路径、可判定的验收条目。
- 数据源必须逐个确认存在。不确定的写「待确认」，绝不编路径。
- 「必须加载的技能」表里每个名字都要能在技能 catalog 里查到，查不到就换成真实存在的那个。
- 「执行顺序」第一步永远是 Step 0 环境/前置探测，不是直接开工。
- 「硬性约束」写已经踩过的坑和明确禁止的手法，不写常识。
- 结尾必须是「立即开始」+ 一句加粗祈使句。
- 交接提示词固定格式：\`请先读 <文档绝对路径>，然后开始 <入口>。\`
- 文档正文用用户的语言写；路径、skill 名、命令一律保持原样，不翻译。

## 边界

- 本模式的默认交付是**文档 + 交接提示词**。用户没说「执行 / 开始做」时，不要顺手把文档描述的活干了 —— 那份活本来就是要交给一个新会话去做的，在新会话里做才有意义。
- 用户明确说「写完后直接开始」时，才继续执行；执行时严格按文档的 Step 顺序走。
- 写文档本身不需要读写被描述项目的源码业务逻辑；需要的是**路径、规格、约束、验收**这些事实。`

/** Config accepted by the preset-scoped row; kept explicit so a typo fails loud. */
function resolveConfig(config) {
  const raw = config ?? {}
  const known = new Set(['section'])
  const unknown = Object.keys(raw).filter(key => !known.has(key))
  if (unknown.length > 0) {
    throw new Error(`@local/dsh-prompt-mode/mode has unknown config key(s) ${unknown.join(', ')} — config is { section? }`)
  }
  if (raw.section !== undefined && (typeof raw.section !== 'string' || raw.section.trim() === '')) {
    throw new Error('@local/dsh-prompt-mode/mode `section` must be a non-empty string when present')
  }
  return { section: typeof raw.section === 'string' ? raw.section : POLICY }
}

/**
 * Register the prompt-mode policy section.
 *
 * @param ctx Preset-scoped Cordis context.
 * @param config `{ section? }` — the deployment may replace the wording.
 */
export function apply(ctx, config = {}) {
  const { section } = resolveConfig(config)
  const libraryDir = defaultLibraryDir()

  // Two-stage receipt. The first write proves the preset's child row mounted;
  // the second, which overwrites it, proves the system prompt section itself
  // registered. A file still holding only the first shape means the row mounted
  // but `systemPrompt` never arrived in this composition. Without these files
  // the whole question is unobservable: a failed preset mount is swallowed by
  // `AgentPresetRegistry.activate()` into a log line a headless run never shows
  // (verified with a deliberately broken preset as a control).
  writeReceipt(libraryDir, 'preset.json', { half: 'mode', preset: 'prompt', libraryDir })

  ctx.inject(['systemPrompt'], (spCtx) => {
    const order = spCtx.systemPrompt.getSectionOrder('PLAN_POLICY') + 20
    spCtx.effect(() => spCtx.systemPrompt.section({
      name: 'prompt:policy',
      order,
      text: section,
    }), '@local/dsh-prompt-mode/mode: prompt:policy section')
    writeReceipt(libraryDir, 'preset.json', {
      half: 'mode',
      preset: 'prompt',
      section: 'prompt:policy',
      order,
      libraryDir,
    })
  })
}
