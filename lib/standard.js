/**
 * The system-prompt-document standard, shared by the Host tools and the
 * floating panel.
 *
 * A document that follows this standard is called a "系统提示词文档": a
 * self-contained brief that an agent can read as its opening instruction and
 * execute without further conversation. Everything here is plain data plus pure
 * functions, so the same anatomy backs rendering, auditing and the panel's
 * checklist.
 */

/** Metadata keys every document's head block must carry. */
export const META_FIELDS = [
  { key: '版本', required: true, hint: '如 2026-09-25 或 v3；每次实质修改都要变' },
  { key: '适用任务', required: true, hint: '一句话说明这份文档驱动什么任务、边界到哪' },
  { key: '使用方法', required: true, hint: '如「每次开新会话让 Agent 先读这个文件作为系统 prompt」' },
  { key: '前置条件', required: false, hint: '需要先存在的产物/环境，如某个 .blend 或已装好的依赖' },
  { key: '目标', required: false, hint: '这次要抵达的终态，与「适用任务」互为补充' },
]

/**
 * The required body sections, in the order they must appear.
 *
 * `canonical` is what the renderer writes; `accept` lists the alternative
 * headings real-world documents use (the two reference documents in
 * `HanMaXiaoArtExhibition/docs` say `## 验收`, not `## 验收标准`), so audits
 * pass on hand-written documents too.
 */
export const DOC_SECTIONS = [
  {
    id: 'role',
    canonical: '角色与目标',
    accept: ['角色与目标', '角色', '角色定位与目标'],
    required: true,
    hint: 'Agent 是谁 + 最终要交付什么，2-5 条即可',
  },
  {
    id: 'skills',
    canonical: '必须加载的技能（按任务自动触发）',
    accept: ['必须加载的技能', '必须加载的技能（按任务自动触发）', '技能加载'],
    required: true,
    hint: '「任务场景 → skill 名」表格；必须点名真实存在的 skill',
  },
  {
    id: 'sources',
    canonical: '数据源（全部在本地工作目录）',
    accept: ['数据源', '数据源（全部在本地工作目录）', '数据源（本地文件）', '事实源'],
    required: true,
    hint: '规格/计划/代码/参考图的真实绝对路径；写进文档前必须确认存在',
  },
  {
    id: 'order',
    canonical: '执行顺序（严格按依赖）',
    accept: ['执行顺序', '执行顺序（严格按依赖）', '执行步骤', '实施顺序', '迭代协议', '执行协议'],
    required: true,
    hint: 'Step 0 / Round 0 起步，每步写清依据哪个数据源、加载哪个 skill',
  },
  {
    id: 'constraints',
    canonical: '硬性约束（踩坑前知道）',
    accept: ['硬性约束', '硬性约束（踩坑前知道）', '约束', '禁止事项', '禁止'],
    required: true,
    hint: '已经踩过的坑、协议限制、命名规范、明确禁止的手法',
  },
  {
    id: 'acceptance',
    canonical: '验收标准',
    accept: ['验收标准', '验收', '完成标准', '验收（每轮都要过）', '视觉保真检查清单', '检查清单', '完成清单'],
    required: true,
    hint: '可判定的条目；能写成命令、阈值或可勾选清单最好',
  },
  {
    id: 'start',
    canonical: '立即开始',
    accept: ['立即开始', '现在开始', '开始执行'],
    required: true,
    hint: '前 3 步动作 + 一句祈使句收尾，让 Agent 读完就能动手',
  },
]

/** The handoff sentence template the user copies into a fresh session. */
export const HANDOFF_TEMPLATE = '请先读 {path}，然后开始 {entry}。'

/** Build the copy-paste handoff line. */
export function handoffLine(docPath, entry) {
  const clean = String(entry ?? '').trim() || '执行'
  return HANDOFF_TEMPLATE.replace('{path}', String(docPath ?? '').trim()).replace('{entry}', clean)
}

/** Strip numbering, parenthesised qualifiers and punctuation from a heading. */
export function normalizeHeading(text) {
  return String(text ?? '')
    .replace(/^[#\s]+/, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[*_`~·:：,，.。、!！?？\-\s]/g, '')
    .toLowerCase()
}

/** Match one heading against a section definition. */
export function headingMatches(section, heading) {
  const got = normalizeHeading(heading)
  if (got === '') return false
  for (const candidate of section.accept ?? [section.canonical]) {
    const want = normalizeHeading(candidate)
    if (want === '') continue
    if (got === want) return true
    // Tolerate qualifiers the author added around the standard heading, on
    // either side (`Phase 1 执行顺序`, `数据源（全部在本地工作目录）`). Short
    // headings stay exact-only so 验收 never swallows 验收标准草稿 or similar.
    if (want.length >= 4 && (got.startsWith(want) || want.startsWith(got) || got.includes(want))) return true
  }
  return false
}

/** Every markdown heading in a document, in order. */
export function headings(markdown) {
  const out = []
  for (const line of String(markdown ?? '').split('\n')) {
    const match = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line)
    if (match) out.push({ level: match[1].length, text: match[2] })
  }
  return out
}

/** Slice a document into heading-delimited blocks keyed by section id. */
export function sectionBodies(markdown, sections = DOC_SECTIONS) {
  const lines = String(markdown ?? '').split('\n')
  const marks = []
  for (const [index, line] of lines.entries()) {
    const match = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line)
    if (!match) continue
    const section = sections.find(candidate => headingMatches(candidate, match[2]))
    marks.push({ index, level: match[1].length, section: section?.id })
  }
  const bodies = {}
  for (const [position, mark] of marks.entries()) {
    if (mark.section === undefined || bodies[mark.section] !== undefined) continue
    const next = marks.slice(position + 1).find(later => later.level <= mark.level)
    const end = next === undefined ? lines.length : next.index
    bodies[mark.section] = lines.slice(mark.index + 1, end).join('\n')
  }
  return bodies
}

/** Read the `> **键**: 值` metadata block that opens a document. */
export function readMetadata(markdown) {
  const found = {}
  for (const line of String(markdown ?? '').split('\n')) {
    const match = /^>[ \t]*\*\*(.+?)\*\*[ \t]*[:：][ \t]*(.*)$/.exec(line.trim())
    if (match) found[match[1].trim()] = match[2].trim()
  }
  return found
}

/** One `## 必须加载的技能` table row: `| 任务场景 | \`skill-name\` |`. */
export function readSkillTable(body) {
  const rows = []
  for (const line of String(body ?? '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
    if (cells.length < 2) continue
    if (/^-{2,}$/.test(cells[0].replace(/[\s:]/g, ''))) continue
    if (normalizeHeading(cells[0]) === '任务场景') continue
    const names = [...cells[1].matchAll(/`([^`]+)`/g)].map(match => match[1].trim())
    for (const name of names) rows.push({ when: cells[0], skill: name })
  }
  return rows
}

const PATH_IN_BACKTICKS = /`([^`\n]{1,400})`/g
const PATH_BARE_WINDOWS = /(?:^|[\s"'(（[|])([A-Za-z]:[\\/][^\s"'`)\]）|<>]+)/g
const PATH_BARE_POSIX = /(?:^|[\s"'(（[|])(\/(?:[\w.@+-]+\/)+[\w.@+-]+)/g

/** Does this string look like a concrete local file path we can stat? */
function looksLikePath(value) {
  const text = String(value ?? '').trim()
  if (text.length < 4 || text.length > 400) return false
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return false
  if (/[<>{}*?|]/.test(text)) return false
  if (/[\r\n]/.test(text)) return false
  // `D:/.../file.exr` and `assets/…/spec.md` are placeholders, not references.
  if (text.includes('...') || text.includes('…')) return false
  if (/^[A-Za-z]:[\\/]/.test(text)) return true
  // Bare relative paths only count with a directory separator and an extension;
  // otherwise `lib/standard.js`-style prose references create false positives.
  return /[/\\]/.test(text) && /\.[A-Za-z0-9]{1,10}$/.test(text)
}

/** A bare file name, acceptable only inside a data-source table row. */
const BARE_FILE = /^[^\\/\s|<>*?]{1,120}\.[A-Za-z0-9]{1,10}$/

/** Every plausible local file path a document references. */
export function extractLocalPaths(markdown) {
  const found = new Set()
  const text = String(markdown ?? '')
  for (const match of text.matchAll(PATH_IN_BACKTICKS)) {
    if (looksLikePath(match[1])) found.add(match[1].trim())
  }
  for (const match of text.matchAll(PATH_BARE_WINDOWS)) {
    const value = match[1].replace(/[.,;:。，、]+$/, '')
    if (looksLikePath(value)) found.add(value)
  }
  for (const match of text.matchAll(PATH_BARE_POSIX)) {
    const value = match[1].replace(/[.,;:。，、]+$/, '')
    if (looksLikePath(value)) found.add(value)
  }
  return [...found]
}

/**
 * Paths a data-source table row names, where a bare file name is a legitimate
 * reference. Prose backtick mentions of a bare name (`Spec.md`) stay excluded,
 * so the stricter rule above keeps its protection against false positives.
 */
export function extractTablePaths(body) {
  const found = new Set()
  for (const line of String(body ?? '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    for (const match of trimmed.matchAll(/`([^`\n]{2,400})`/g)) {
      const value = match[1].trim()
      if (looksLikePath(value) || BARE_FILE.test(value)) found.add(value)
    }
  }
  return [...found]
}

/** A token that is a single latin word, the only kind fuzzy containment applies to. */
const LATIN_TOKEN = /^[a-z0-9][a-z0-9_.+-]*$/

/** Tokenise text for skill matching: latin words plus CJK bigrams. */
export function tokens(text) {
  const out = new Set()
  const lower = String(text ?? '').toLowerCase()
  for (const match of lower.matchAll(/[a-z0-9][a-z0-9_.+-]{1,}/g)) out.add(match[0])
  for (const match of lower.matchAll(/[\u3400-\u9fff]+/g)) {
    const run = match[0]
    if (run.length === 1) out.add(run)
    for (let index = 0; index + 2 <= run.length; index++) out.add(run.slice(index, index + 2))
  }
  return out
}

/**
 * Rank catalog skills against a task description.
 *
 * Name hits outweigh description hits, and a compound latin word matches a
 * skill's own part (`BlenderMCP` → `blender` in `blender-mcp-best-practices`),
 * which is how a task written as prose still finds its skill family. A skill
 * must clear the threshold to be reported, so the result reads as "these are
 * plausibly relevant" rather than "these share a character".
 */
export function rankSkills(task, skills, limit = 12) {
  const wanted = tokens(task)
  if (wanted.size === 0) return []
  const scored = []
  for (const skill of skills ?? []) {
    const nameText = String(skill.name ?? '')
    const nameTokens = tokens(nameText.replace(/[-_/.]/g, ' '))
    const bodyTokens = tokens(`${skill.description ?? ''} ${skill.whenToUse ?? ''}`)
    let score = 0
    const hits = new Set()
    for (const token of wanted) {
      const latin = LATIN_TOKEN.test(token)
      let resolved = false
      if (nameTokens.has(token)) { score += 4; hits.add(token); resolved = true }
      else if (bodyTokens.has(token)) { score += 1; hits.add(token) }
      // Fuzzy name containment runs even after a body hit: `BlenderMCP` appears
      // verbatim in a description *and* contains `blender` from a name.
      if (!resolved && latin && token.length >= 4) {
        for (const part of nameTokens) {
          if (part.length >= 4 && (token.includes(part) || part.includes(token))) {
            score += 3
            hits.add(part)
            resolved = true
            break
          }
        }
      }
      if (resolved || !latin || token.length < 5) continue
      for (const part of bodyTokens) {
        if (part.length >= 5 && token.includes(part)) { score += 1; hits.add(part); break }
      }
    }
    if (nameText !== '' && String(task ?? '').toLowerCase().includes(nameText.toLowerCase())) score += 8
    if (score >= 3) {
      scored.push({ name: skill.name, description: skill.description, score, hits: [...hits].slice(0, 8) })
    }
  }
  scored.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
  return scored.slice(0, limit)
}

/** Render a metadata value, quoting nothing but keeping it on one line. */
function oneLine(value) {
  return String(value ?? '').replace(/\s*\n\s*/g, ' ').trim()
}

/**
 * Render a document that satisfies the standard.
 *
 * @param spec Document content; only `title`, `appliesTo` and `role` are
 *   mandatory, because a document without them cannot brief an agent.
 * @returns The complete markdown text, ending in a newline.
 */
export function renderDocument(spec) {
  const meta = [
    ['版本', spec.version ?? new Date().toISOString().slice(0, 10)],
    ['适用任务', spec.appliesTo],
    ['使用方法', spec.usage ?? '每次开新会话让 Agent 先读这个文件，作为它的系统提示词。'],
    ['前置条件', spec.prerequisites],
    ['目标', spec.objective],
  ].filter(([, value]) => String(value ?? '').trim() !== '')

  const blocks = []
  blocks.push(`# ${oneLine(spec.title) || '未命名系统提示词文档'}\n`)
  blocks.push(`${meta.map(([key, value]) => `> **${key}**: ${oneLine(value)}`).join('\n')}\n`)
  blocks.push('---\n')

  const skills = Array.isArray(spec.skills) ? spec.skills.filter(entry => entry?.skill) : []
  blocks.push('## 角色与目标\n')
  blocks.push(String(spec.role ?? '').trim() + '\n')

  blocks.push('---\n')
  blocks.push('## 必须加载的技能（按任务自动触发）\n')
  blocks.push('| 任务场景 | 加载 skill |\n|---------|-----------|')
  blocks.push(skills.length === 0
    ? '| 尚未确定 | （用 `prompt_doc_plan` 的 skill 候选补全） |'
    : skills.map(entry => `| ${oneLine(entry.when)} | \`${oneLine(entry.skill)}\` |`).join('\n'))
  blocks.push('')

  const sources = Array.isArray(spec.dataSources) ? spec.dataSources.filter(entry => entry?.path) : []
  blocks.push('---\n')
  blocks.push('## 数据源（全部在本地工作目录）\n')
  if (String(spec.sourcesNote ?? '').trim() !== '') blocks.push(String(spec.sourcesNote).trim() + '\n')
  if (sources.length === 0) {
    blocks.push('| 文件 | 覆盖 |\n|-----|-----|\n| （待补：先跑 `prompt_doc_plan` 找到真实文件） | — |\n')
  }
  else {
    blocks.push('| 文件 | 覆盖 |\n|-----|-----|')
    blocks.push(sources.map(entry => `| \`${oneLine(entry.path)}\` | ${oneLine(entry.covers ?? '—')} |`).join('\n'))
    blocks.push('')
  }

  const steps = Array.isArray(spec.steps) ? spec.steps.filter(entry => entry?.title) : []
  blocks.push('---\n')
  blocks.push('## 执行顺序（严格按依赖）\n')
  blocks.push(steps.length === 0
    ? '### Step 0 · 环境探测\n\n1. 确认数据源文件全部可读\n2. 再动手\n'
    : steps.map((entry) => {
      const items = (entry.items ?? []).map(item => `1. ${item}`).join('\n')
      return `### ${oneLine(entry.title)}\n\n${items}\n`
    }).join('\n'))

  const constraints = Array.isArray(spec.constraints) ? spec.constraints.filter(Boolean) : []
  blocks.push('---\n')
  blocks.push('## 硬性约束（踩坑前知道）\n')
  if (constraints.length === 0) {
    blocks.push('- （待补：把已经踩过的坑写在这里，一条一行）\n')
  }
  else {
    for (const entry of constraints) {
      if (typeof entry === 'string') { blocks.push(`- ${entry}`); continue }
      if (String(entry.group ?? '').trim() !== '') blocks.push(`### ${oneLine(entry.group)}\n`)
      for (const item of entry.items ?? []) blocks.push(`- ${item}`)
    }
    blocks.push('')
  }

  const acceptance = Array.isArray(spec.acceptance) ? spec.acceptance.filter(Boolean) : []
  blocks.push('---\n')
  blocks.push('## 验收标准\n')
  blocks.push(acceptance.length === 0
    ? '- （待补：写成可判定的条目，能跑命令/量阈值最好）\n'
    : acceptance.map(item => `- ${item}`).join('\n') + '\n')

  const first = Array.isArray(spec.firstActions) ? spec.firstActions.filter(Boolean) : []
  blocks.push('---\n')
  blocks.push('## 立即开始\n')
  blocks.push(first.length === 0
    ? '1. 先确认数据源存在\n'
    : first.map((item, index) => `${index + 1}. ${item}`).join('\n') + '\n')
  const closing = oneLine(spec.closingLine) || '现在就开始第一步，不要等我补充说明。'
  blocks.push(`**${closing}**`)

  return blocks.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n'
}

/**
 * Audit a document against the standard.
 *
 * @param markdown Document text.
 * @param options `pathExists` resolves a referenced path, `skillNames` is the
 *   catalog of resolvable skill names, `hasSkillCatalog` says whether that
 *   catalog was readable at all (an unreadable catalog must not fail a
 *   document).
 * @returns `{ ok, score, checks, missingPaths, unknownSkills }`.
 */
export function auditDocument(markdown, options = {}) {
  const text = String(markdown ?? '')
  const meta = readMetadata(text)
  const bodies = sectionBodies(text)
  const checks = []
  const add = (id, label, status, detail, required = true) => {
    checks.push({ id, label, status, detail, required })
  }

  for (const field of META_FIELDS.filter(entry => entry.required)) {
    const value = meta[field.key]
    add(`meta.${field.key}`, `元信息含「${field.key}」`, String(value ?? '').trim() === '' ? 'fail' : 'pass',
      String(value ?? '').trim() === '' ? `缺少：${field.hint}` : valueTrim(value), true)
  }
  const optionalMissing = META_FIELDS.filter(entry => !entry.required && String(meta[entry.key] ?? '').trim() === '')
  if (optionalMissing.length > 0) {
    add('meta.optional', '可选元信息（前置条件 / 目标）', 'warn',
      `未填：${optionalMissing.map(entry => entry.key).join('、')}`, false)
  }

  for (const section of DOC_SECTIONS) {
    const body = bodies[section.id]
    const present = body !== undefined
    // "Substantive" is structural, not a character count: one bullet or one
    // table row is a real answer, while a placeholder line is not.
    const structured = present && /^[ \t]*(?:[-*]|\d+\.|\|)/m.test(body)
    const visible = present ? body.replace(/[\s|>#*`-]/g, '').length : 0
    const substantive = structured || visible >= 24
    add(`section.${section.id}`, `章节「${section.canonical}」`,
      !present ? 'fail' : substantive ? 'pass' : 'warn',
      !present ? `缺失。${section.hint}` : substantive ? '' : '章节存在但只有占位内容', section.required)
  }

  // Order: the standard expects the sections in DOC_SECTIONS order.
  const order = headings(text)
    .map(entry => ({ id: DOC_SECTIONS.find(section => headingMatches(section, entry.text))?.id, text: entry.text }))
    .filter(entry => entry.id !== undefined)
  const seen = [...new Set(order.map(entry => entry.id))]
  const expected = DOC_SECTIONS.filter(section => seen.includes(section.id)).map(section => section.id)
  const ordered = seen.join(',') === expected.join(',')
  if (seen.length > 1) {
    add('structure.order', '章节顺序符合标准', ordered ? 'pass' : 'warn',
      ordered ? '' : `实际顺序：${seen.join(' → ')}`, false)
  }

  const paths = extractLocalPaths(text)
  // A reader executes the 数据源 section literally, so a dead path there is a
  // hard failure; a short-form reference elsewhere in the prose is a warning.
  const tablePaths = [...new Set([
    ...extractLocalPaths(bodies.sources ?? ''),
    ...extractTablePaths(bodies.sources ?? ''),
  ])]
  const tableSet = new Set(tablePaths)
  const missingPaths = []
  const unresolvedInline = []
  if (typeof options.pathExists === 'function') {
    for (const candidate of paths) {
      if (options.pathExists(candidate) === true) continue
      if (tableSet.has(candidate)) missingPaths.push(candidate)
      else unresolvedInline.push(candidate)
    }
    add('sources.exist', `「数据源」章节列出的文件全部存在（${tablePaths.length} 条）`,
      tablePaths.length === 0 ? 'warn' : missingPaths.length === 0 ? 'pass' : 'fail',
      tablePaths.length === 0 ? '数据源章节没有列出任何本地文件路径'
        : missingPaths.length === 0 ? '' : `不存在：${missingPaths.slice(0, 8).join('、')}${missingPaths.length > 8 ? ` 等 ${missingPaths.length} 条` : ''}`,
      true)
    const inlineTotal = Math.max(0, paths.length - tableSet.size)
    add('sources.inline', `正文内联引用的路径可解析（${inlineTotal} 条）`,
      unresolvedInline.length === 0 ? 'pass' : 'warn',
      unresolvedInline.length === 0 ? '' : `未解析：${unresolvedInline.slice(0, 6).join('、')}${unresolvedInline.length > 6 ? ` 等 ${unresolvedInline.length} 条` : ''}`,
      false)
  }

  const skillRows = readSkillTable(bodies.skills ?? '')
  const known = options.skillNames instanceof Set ? options.skillNames : undefined
  const unknownSkills = known === undefined ? [] : skillRows.filter(row => !known.has(row.skill)).map(row => row.skill)
  if (known !== undefined) {
    add('skills.resolvable', `技能表中的 skill 可解析（${skillRows.length} 个）`,
      skillRows.length === 0 ? 'warn' : unknownSkills.length === 0 ? 'pass' : 'fail',
      skillRows.length === 0 ? '技能表为空或格式不是 `| 任务场景 | \\`skill\\` |`'
        : unknownSkills.length === 0 ? '' : `catalog 中找不到：${[...new Set(unknownSkills)].join('、')}`,
      true)
  }
  else {
    add('skills.resolvable', '技能表中的 skill 可解析', 'warn', '技能 catalog 不可读，已跳过校验', false)
  }

  const startBody = bodies.start ?? ''
  const numbered = /^\s*(?:\d+\.|[-*])\s+\S/m.test(startBody)
  add('start.actions', '「立即开始」给出可执行的头几步', numbered ? 'pass' : 'fail',
    numbered ? '' : '"立即开始" 里没有编号动作列表', true)
  const closing = /\*\*[^*\n]{4,}\*\*/.test(startBody)
  add('start.closing', '以祈使句收尾（加粗的「现在就…」）', closing ? 'pass' : 'warn',
    closing ? '' : '文档末尾没有一句直接命令 Agent 动手的加粗句子', false)

  const scored = checks.filter(check => check.required)
  const passed = scored.filter(check => check.status === 'pass').length
  const failed = scored.filter(check => check.status === 'fail').length
  const score = scored.length === 0 ? 0 : Math.round((passed / scored.length) * 100)
  return { ok: failed === 0, score, checks, missingPaths, unknownSkills: [...new Set(unknownSkills)], paths }
}

function valueTrim(value) {
  const text = oneLine(value)
  return text.length > 80 ? `${text.slice(0, 77)}…` : text
}

/** Reusable body of the evolving best-practice skill, rendered from lessons. */
export function composeLessonsSection(lessons) {
  const list = Array.isArray(lessons) ? lessons : []
  const head = [
    '## 已积累的经验教训（本段由 dsh-prompt-mode 自动迭代，请勿手工重排）',
    '',
    `> 共 ${list.length} 条。每次用 \`prompt_doc_learn\` 记一条，下一次任何会话加载本 skill 时都会读到。`,
    '',
  ]
  if (list.length === 0) return [...head, '（还没有积累到教训。做完第一份文档后，把「哪里差点翻车」用 `prompt_doc_learn` 记下来。）', ''].join('\n')
  const byCategory = new Map()
  for (const entry of list) {
    const key = String(entry.category ?? 'other')
    if (!byCategory.has(key)) byCategory.set(key, [])
    byCategory.get(key).push(entry)
  }
  const blocks = [...head]
  for (const [category, entries] of [...byCategory.entries()].sort((left, right) => right[1].length - left[1].length)) {
    blocks.push(`### ${category}（${entries.length}）`, '')
    for (const entry of entries) {
      const evidence = String(entry.evidence ?? '').trim()
      blocks.push(`- ${String(entry.lesson ?? '').trim()}${evidence === '' ? '' : `\n  - 来源：${evidence}`}`)
    }
    blocks.push('')
  }
  return blocks.join('\n')
}
