/**
 * Prompt Mode — Host half.
 *
 * Contributes, profile-wide:
 * - four tools that ground, write, audit and hand off a standard system-prompt
 *   document (`prompt_doc_*`);
 * - the self-iterating `system-prompt-doc-best-practices` skill, whose body is
 *   the shipped baseline plus every lesson recorded through `prompt_doc_learn`.
 *
 * Nothing here touches other sessions' prompts: the prompt-mode policy section
 * lives in `mode.js`, which only the Prompt Mode preset mounts. The floating
 * panel lives in `client.js`.
 *
 * The file is named `host.js` rather than `index.js` so the three halves of the
 * bundle read symmetrically (`host.js` / `mode.js` / `client.js`). The entry is
 * resolved through `exports["."]`, so the name is free to change.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  auditDocument,
  composeLessonsSection,
  DOC_SECTIONS,
  handoffLine,
  META_FIELDS,
  rankSkills,
  renderDocument,
} from './lib/standard.js'
import { defaultLibraryDir, LESSON_CATEGORIES, LessonsStore } from './lib/lessons.js'
import { writeReceipt } from './lib/receipt.js'
import { scanWorkspace } from './lib/scan.js'

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url))
const SKILL_NAME = 'system-prompt-doc-best-practices'
const SKILL_DIR = path.join(PACKAGE_DIR, 'skills')
const LESSONS_MARKER = '<!-- LESSONS -->'

const TOOL_PLAN = 'prompt_doc_plan'
const TOOL_WRITE = 'prompt_doc_write'
const TOOL_AUDIT = 'prompt_doc_audit'
const TOOL_LEARN = 'prompt_doc_learn'

const text = value => [{ type: 'text', text: String(value) }]

/**
 * The model-facing result envelope shared by every tool here.
 *
 * `render` is mandatory: the registry rejects a definition whose `output` lacks
 * it, and that rejection happens inside an injection fiber where it would
 * otherwise be silent. Each tool narrows this with its own readable renderer.
 */
const resultOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => text(JSON.stringify(value ?? null, null, 2)),
}

/** Keep a rendered line short enough to stay readable in a transcript. */
function clip(value, max = 240) {
  const line = String(value ?? '')
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** Accept only the config keys this plugin understands; unknown keys fail loud. */
function resolveOptions(config) {
  const raw = config ?? {}
  const known = new Set(['libraryDir', 'scanDepth'])
  const unknown = Object.keys(raw).filter(key => !known.has(key))
  if (unknown.length > 0) {
    throw new Error(`@local/dsh-prompt-mode has unknown config key(s) ${unknown.join(', ')} — config is { libraryDir?, scanDepth? }`)
  }
  const libraryDir = typeof raw.libraryDir === 'string' && raw.libraryDir.trim() !== ''
    ? path.resolve(raw.libraryDir)
    : defaultLibraryDir()
  const scanDepth = Number.isFinite(raw.scanDepth) ? Number(raw.scanDepth) : 4
  return { libraryDir, scanDepth }
}

/** The shipped baseline skill body, or a diagnostic stub when it is missing. */
function readBaseline() {
  const file = path.join(SKILL_DIR, `${SKILL_NAME}.md`)
  try {
    return readFileSync(file, 'utf8')
  }
  catch (error) {
    return [
      `# ${SKILL_NAME}`,
      '',
      `> 基线 skill 正文读取失败：${error instanceof Error ? error.message : String(error)}`,
      '',
      LESSONS_MARKER,
      '',
    ].join('\n')
  }
}

/** Compose the effective skill body: baseline plus the accumulated lessons. */
function composeSkillBody(baseline, lessons) {
  const section = composeLessonsSection(lessons)
  return baseline.includes(LESSONS_MARKER)
    ? baseline.replace(LESSONS_MARKER, section)
    : `${baseline.trimEnd()}\n\n${section}\n`
}

/** The agent's working directory, falling back to the Host process cwd. */
function resolveCwd(exec, explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') return path.resolve(explicit)
  const session = exec?.agent?.session
  const cwd = session?.header?.cwd ?? session?.cwd
  if (typeof cwd === 'string' && cwd.trim() !== '') return path.resolve(cwd)
  return process.cwd()
}

/** Combine the caller's signal with a bound so a slow provider cannot hang a tool. */
function boundedSignal(signal, ms) {
  try {
    if (typeof AbortSignal.any === 'function' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.any([signal, AbortSignal.timeout(ms)].filter(Boolean))
    }
  }
  catch { /* fall through to the caller's signal */ }
  return signal
}

/** Read the resolvable skill names, or `undefined` when the catalog is unreadable. */
async function skillCatalog(ctx, cwd, signal) {
  const service = ctx.get('skills')
  if (service === undefined) return { names: undefined, skills: [] }
  try {
    const listed = await service.list({ cwd, signal: boundedSignal(signal, 8000) })
    return { names: new Set(listed.map(entry => entry.name)), skills: listed }
  }
  catch {
    return { names: undefined, skills: [] }
  }
}

/**
 * Build a resolver for paths a document references.
 *
 * A document is read from its own directory, so a relative path is tried there
 * first; documents in `docs/` habitually write paths relative to the project
 * root, so ancestor directories are probed next, and the Host cwd last. All
 * three are real authoring habits and none of them should read as a dead path.
 *
 * @param baseDir Directory the document lives in.
 * @returns `(candidate) => absolutePath | undefined`.
 */
export function makeResolver(baseDir) {
  const cwd = process.cwd()
  const anchors = [path.resolve(baseDir)]
  let walk = path.resolve(baseDir)
  for (let level = 0; level < 4; level++) {
    const parent = path.dirname(walk)
    if (parent === walk) break
    walk = parent
    anchors.push(walk)
  }
  anchors.push(cwd)
  return candidate => {
    const value = String(candidate ?? '').trim()
    if (value === '') return undefined
    if (path.isAbsolute(value)) return existsSync(value) ? value : undefined
    for (const anchor of anchors) {
      const resolved = path.resolve(anchor, value)
      if (existsSync(resolved)) return resolved
    }
    return undefined
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function requireString(args, key) {
  const value = args?.[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} must be a non-empty string`)
  }
  return value.trim()
}

function optionalString(args, key) {
  const value = args?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** `prompt_doc_plan`: ground the document in the real repository. */
function planTool(ctx, options) {
  return {
    name: TOOL_PLAN,
    description: [
      'Ground a system-prompt document in a real repository before writing it.',
      'Scans the working directory for prompt documents, specs, plans, reference art and source files,',
      'and ranks the installed skill catalog against the stated task so the document\'s "skills to load" table cites real skills.',
      'Call this first, then pass the surviving paths to prompt_doc_write as `dataSources`.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What the future session must accomplish, in the user\'s own words (intent + requirements).' },
        cwd: { type: 'string', description: 'Repository root to scan. Defaults to the session working directory.' },
        depth: { type: 'integer', description: `Directory depth to walk (default ${options.scanDepth}).` },
        focus: { type: 'array', items: { type: 'string' }, description: 'Extra keywords that sharpen the skill ranking: the domains, tools and artifacts the task involves.' },
        group: { type: 'string', enum: ['all', 'prompts', 'specs', 'plans', 'docs', 'refs', 'code'], description: 'Restrict the returned file groups.' },
      },
      required: ['task'],
      additionalProperties: false,
    },
    output: {
      ...resultOutput,
      render: (_args, value) => text([
        `working directory: ${value.cwd}`,
        `scanned ${value.scanned?.visited ?? 0} file(s)${value.scanned?.truncated ? ' (entry cap reached)' : ''}`,
        ...Object.entries(value.files ?? {}).map(([group, list]) => list.length === 0
          ? `${group}: (none)`
          : `${group} (${list.length}):\n${list.slice(0, 12).map(file => `  ${file.path}  [${file.mtime}]`).join('\n')}`),
        value.skillCandidates?.length
          ? `skill candidates (${value.skillCatalogSize ?? '?'} in catalog):\n${value.skillCandidates.map(entry => `  ${entry.name}  score=${entry.score}  hits=${entry.hits.join('/')}`).join('\n')}`
          : 'skill candidates: none — widen `focus` or read the catalog in your own prompt',
        '',
        ...(value.guidance ?? []).map(line => `- ${line}`),
      ].join('\n')),
    },
    async execute(args, exec) {
      const task = requireString(args, 'task')
      const cwd = resolveCwd(exec, args.cwd)
      const depth = Number.isFinite(args.depth) ? Number(args.depth) : options.scanDepth
      if (!existsSync(cwd)) throw new Error(`working directory does not exist: ${cwd}`)
      const scan = scanWorkspace(cwd, { maxDepth: depth })
      const wanted = optionalString(args, 'group')
      const groups = {}
      for (const [key, files] of Object.entries(scan.groups)) {
        if (wanted === undefined || wanted === 'all' || wanted === key) groups[key] = files
      }
      const catalog = await skillCatalog(ctx, cwd, exec.signal)
      const focus = [task, ...asArray(args.focus)].join(' ').trim()
      const candidates = catalog.names === undefined
        ? []
        : rankSkills(focus, catalog.skills, 16)
      return {
        cwd,
        scanned: { visited: scan.visited, skipped: scan.skipped, truncated: scan.truncated },
        skillCatalogSize: catalog.names?.size ?? 0,
        skillCandidates: candidates,
        files: groups,
        guidance: [
          'Every path you put in the document must come from `files` above — do not invent paths.',
          '`skillCandidates` are keyword-overlap proposals, not the whole catalog: confirm each one, and add skills you know apply.',
          'Pick 1-4 candidates per task phase for the skills table.',
          'Existing entries under `prompts` are documents this plugin produced before: read one before writing a new one.',
          'Then call prompt_doc_write with the selected skills and dataSources, and prompt_doc_audit afterwards.',
        ],
      }
    },
    presentCall: args => ({ card: 'generic', title: `Ground prompt document · ${String(args?.task ?? '').slice(0, 60)}`, kind: 'search', rawInput: args }),
    presentResult: (_args, result) => {
      const value = result?.value ?? {}
      const counts = Object.entries(value.files ?? {}).map(([key, list]) => `${key}: ${list.length}`).join(' · ')
      const skills = (value.skillCandidates ?? []).slice(0, 8).map(entry => `${entry.name}(${entry.score})`).join(', ')
      return {
        card: 'generic',
        title: `Grounded in ${value.cwd ?? ''}`,
        content: text([
          `扫描：${value.scanned?.visited ?? 0} 个文件（truncated=${String(value.scanned?.truncated)}）`,
          counts === '' ? '没有可分类文件' : `分组：${counts}`,
          skills === '' ? '技能候选：无（技能 catalog 不可读或任务描述太短）' : `技能候选：${skills}`,
        ].join('\n')),
      }
    },
  }
}

/** `prompt_doc_write`: render and persist a document that satisfies the standard. */
function writeTool(ctx) {
  return {
    name: TOOL_WRITE,
    description: [
      'Write or refresh a standard system-prompt document, then return the copy-paste handoff line.',
      'The rendered document always carries the metadata block (版本 / 适用任务 / 使用方法),',
      '角色与目标, 必须加载的技能（按任务自动触发）, 数据源, 执行顺序, 硬性约束, 验收标准 and 立即开始.',
      'Referenced data-source paths are checked on disk and reported back, so a document never ships with a dead path.',
      'Refuses to overwrite an existing file unless `overwrite` is true.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path of the document to write, e.g. d:\\proj\\docs\\blender-agent-prompt.md' },
        title: { type: 'string', description: 'Document title (the H1).' },
        appliesTo: { type: 'string', description: '元信息「适用任务」: the task this document drives and its boundary.' },
        role: { type: 'string', description: '「角色与目标」 body: who the agent is and what it must deliver.' },
        entry: { type: 'string', description: 'Handoff entry point, e.g. "Phase 1 搭建". Used for the final copy-paste line.' },
        version: { type: 'string', description: '元信息「版本」. Defaults to today\'s date.' },
        usage: { type: 'string', description: '元信息「使用方法」. Defaults to the one-sentence standard wording.' },
        prerequisites: { type: 'string', description: '元信息「前置条件」.' },
        objective: { type: 'string', description: '元信息「目标」.' },
        sourcesNote: { type: 'string', description: 'One paragraph above the data-source table (e.g. "所有规格的唯一事实源").' },
        skills: {
          type: 'array',
          description: 'Rows of the skills table.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['when', 'skill'],
            properties: {
              when: { type: 'string', description: 'Task situation that triggers the skill.' },
              skill: { type: 'string', description: 'Exact skill name from prompt_doc_plan skillCandidates.' },
            },
          },
        },
        dataSources: {
          type: 'array',
          description: 'Files the executing session must read; each path is verified on disk.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path'],
            properties: {
              path: { type: 'string', description: 'Absolute local path.' },
              covers: { type: 'string', description: 'What this file is the source of truth for.' },
            },
          },
        },
        steps: {
          type: 'array',
          description: 'Ordered execution steps.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title'],
            properties: {
              title: { type: 'string', description: 'Step heading, e.g. "Step 0 · 连接 & 环境探测".' },
              items: { type: 'array', items: { type: 'string' }, description: 'Ordered actions; each may name the data source and skill it depends on.' },
            },
          },
        },
        constraints: {
          type: 'array',
          description: 'Hard constraints, optionally grouped.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['items'],
            properties: {
              group: { type: 'string', description: 'Group heading, e.g. "BlenderMCP 协议".' },
              items: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        acceptance: { type: 'array', items: { type: 'string' }, description: 'Decidable acceptance criteria.' },
        firstActions: { type: 'array', items: { type: 'string' }, description: 'The first 2-4 actions under 立即开始.' },
        closingLine: { type: 'string', description: 'The bold imperative that ends the document.' },
        overwrite: { type: 'boolean', description: 'Replace an existing document (default false).' },
      },
      required: ['path', 'title', 'appliesTo', 'role', 'entry'],
      additionalProperties: false,
    },
    output: {
      ...resultOutput,
      render: (_args, value) => text([
        `${value.replaced ? 'replaced' : 'wrote'} ${value.path} (${value.bytes} bytes)`,
        `self-audit: ${value.audit?.score ?? '?'}/100 ${value.audit?.ok ? 'PASS' : 'FAIL'}`,
        value.missingPaths?.length ? `unresolved data sources: ${value.missingPaths.join(', ')}` : 'every data source resolves',
        value.unknownSkills?.length ? `unresolved skills: ${value.unknownSkills.join(', ')}` : 'every skill name resolves',
        '',
        `handoff: ${value.handoff}`,
      ].join('\n')),
    },
    async execute(args, exec) {
      const target = path.resolve(requireString(args, 'path'))
      const entry = requireString(args, 'entry')
      const exists = existsSync(target)
      if (exists && args.overwrite !== true) {
        throw new Error(`${target} already exists. Read it, then either pass overwrite: true or pick a new path (e.g. a -v2 suffix).`)
      }
      const markdown = renderDocument({
        title: requireString(args, 'title'),
        appliesTo: requireString(args, 'appliesTo'),
        role: requireString(args, 'role'),
        version: optionalString(args, 'version'),
        usage: optionalString(args, 'usage'),
        prerequisites: optionalString(args, 'prerequisites'),
        objective: optionalString(args, 'objective'),
        sourcesNote: optionalString(args, 'sourcesNote'),
        skills: asArray(args.skills),
        dataSources: asArray(args.dataSources),
        steps: asArray(args.steps),
        constraints: asArray(args.constraints),
        acceptance: asArray(args.acceptance),
        firstActions: asArray(args.firstActions),
        closingLine: optionalString(args, 'closingLine'),
      })
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, markdown, 'utf8')

      const missingPaths = []
      const resolveReference = makeResolver(path.dirname(target))
      for (const source of asArray(args.dataSources)) {
        const candidate = String(source?.path ?? '').trim()
        if (candidate === '') continue
        if (resolveReference(candidate) === undefined) missingPaths.push(candidate)
      }
      const catalog = await skillCatalog(ctx, path.dirname(target), exec.signal)
      const requested = asArray(args.skills).map(row => String(row?.skill ?? '').trim()).filter(Boolean)
      const unknownSkills = catalog.names === undefined
        ? []
        : [...new Set(requested.filter(name => !catalog.names.has(name)))]

      const audit = auditDocument(markdown, {
        pathExists: candidate => resolveReference(candidate) !== undefined,
        skillNames: catalog.names,
      })
      return {
        path: target,
        bytes: Buffer.byteLength(markdown, 'utf8'),
        replaced: exists,
        sections: DOC_SECTIONS.map(section => section.canonical),
        missingPaths,
        unknownSkills,
        audit: { ok: audit.ok, score: audit.score },
        handoff: handoffLine(target, entry),
        next: unknownSkills.length > 0 || missingPaths.length > 0
          ? 'Fix missingPaths / unknownSkills before handing this document to a fresh session.'
          : `Hand the user this line and nothing else: ${handoffLine(target, entry)}`,
      }
    },
    presentCall: args => ({ card: 'generic', title: `Write ${path.basename(String(args?.path ?? 'prompt document'))}`, kind: 'edit', rawInput: args }),
    presentResult: (_args, result) => {
      const value = result?.value ?? {}
      const problems = [
        ...((value.missingPaths ?? []).length > 0 ? [`不存在的数据源：${value.missingPaths.join('、')}`] : []),
        ...((value.unknownSkills ?? []).length > 0 ? [`无法解析的 skill：${value.unknownSkills.join('、')}`] : []),
      ]
      return {
        card: 'generic',
        title: `${value.path ?? ''}`,
        content: text([
          `已写入 ${value.bytes ?? 0} 字节，自审 ${value.audit?.score ?? '?'}/100（${value.audit?.ok ? 'PASS' : 'FAIL'}）`,
          problems.length === 0 ? '数据源与 skill 全部可解析。' : problems.join('\n'),
          '',
          '交接提示词：',
          String(value.handoff ?? ''),
        ].join('\n')),
      }
    },
  }
}

/** `prompt_doc_audit`: score an existing document against the standard. */
function auditTool(ctx) {
  return {
    name: TOOL_AUDIT,
    description: [
      'Audit an existing system-prompt document against the standard: metadata block, the seven required sections,',
      'their order, every referenced local path on disk, every skill name against the live catalog,',
      'and whether 立即开始 gives runnable first steps plus an imperative closing line.',
      'Run it after hand-editing a document and before handing it to a fresh session.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path of the document to audit.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    output: {
      ...resultOutput,
      render: (_args, value) => text([
        `${value.path}: ${value.score}/100 ${value.ok ? 'PASS' : 'FAIL'} (${value.referencedPaths} referenced path(s) checked)`,
        ...(value.checks ?? []).filter(check => check.status !== 'pass')
          .map(check => `${check.status === 'warn' ? 'WARN' : 'FAIL'} ${check.label}${check.detail ? ` — ${clip(check.detail)}` : ''}`),
        (value.checks ?? []).every(check => check.status === 'pass') ? 'every check passed.' : '',
      ].filter(Boolean).join('\n')),
    },
    async execute(args, exec) {
      const target = path.resolve(requireString(args, 'path'))
      if (!existsSync(target)) throw new Error(`document not found: ${target}`)
      const markdown = readFileSync(target, 'utf8')
      const catalog = await skillCatalog(ctx, path.dirname(target), exec.signal)
      const resolveReference = makeResolver(path.dirname(target))
      const audit = auditDocument(markdown, {
        pathExists: candidate => resolveReference(candidate) !== undefined,
        skillNames: catalog.names,
      })
      return {
        path: target,
        bytes: statSync(target).size,
        ok: audit.ok,
        score: audit.score,
        checks: audit.checks,
        missingPaths: audit.missingPaths,
        unknownSkills: audit.unknownSkills,
        referencedPaths: audit.paths.length,
      }
    },
    presentCall: args => ({ card: 'generic', title: `Audit ${path.basename(String(args?.path ?? ''))}`, kind: 'read', rawInput: args }),
    presentResult: (_args, result) => {
      const value = result?.value ?? {}
      const line = check => `${check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌'} ${check.label}${check.detail ? ` — ${check.detail}` : ''}`
      return {
        card: 'generic',
        title: `${path.basename(String(value.path ?? ''))} · ${value.score}/100 ${value.ok ? 'PASS' : 'FAIL'}`,
        content: text((value.checks ?? []).filter(check => check.status !== 'pass').map(line).join('\n')
          || '全部检查项通过。'),
      }
    },
  }
}

/** `prompt_doc_learn`: fold a lesson into the evolving skill. */
function learnTool(skillHost, options) {
  return {
    name: TOOL_LEARN,
    description: [
      'Record one durable lesson into the system-prompt-doc-best-practices skill, which every future prompt-mode session loads.',
      'Use it right after a prompt document either worked unusually well or cost a rework round:',
      'what the document omitted, which path or skill name was wrong, which constraint was missing, which handoff line misfired.',
      'One sentence per lesson, written as an instruction to the next author. This is how the skill iterates.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        lesson: { type: 'string', description: 'The lesson, phrased as an instruction the next document author must follow.' },
        category: { type: 'string', enum: LESSON_CATEGORIES, description: 'Which part of the standard this lesson sharpens.' },
        evidence: { type: 'string', description: 'What actually happened that taught this — a failure, a rework, a user complaint.' },
        docPath: { type: 'string', description: 'The document this lesson came from, when there is one.' },
      },
      required: ['lesson'],
      additionalProperties: false,
    },
    output: {
      ...resultOutput,
      render: (_args, value) => text([
        `recorded ${value.id} under "${value.category}" — ${value.total} lesson(s) in ${value.store}`,
        `the skill body is now ${value.skillBytes} bytes${value.mirror ? `; readable mirror at ${value.mirror}` : ''}`,
        value.next,
      ].join('\n')),
    },
    execute(args) {
      const result = skillHost.store.add({
        lesson: args.lesson,
        category: args.category,
        evidence: args.evidence,
        docPath: args.docPath,
      })
      const refreshed = skillHost.refresh()
      return {
        stored: true,
        id: result.record.id,
        category: result.record.category,
        total: result.total,
        store: result.file,
        skill: SKILL_NAME,
        skillBytes: refreshed?.bytes ?? 0,
        mirror: refreshed?.mirror,
        directory: options.libraryDir,
        next: 'The next session that loads this skill reads the new lesson. No restart is needed.',
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Learn a lesson', kind: 'other', rawInput: args }),
    presentResult: (_args, result) => {
      const value = result?.value ?? {}
      return {
        card: 'generic',
        title: `已记入 skill（第 ${value.total ?? '?'} 条）`,
        content: text([
          `类别：${value.category ?? 'other'}`,
          `存储：${value.store ?? ''}`,
          value.mirror ? `可读镜像：${value.mirror}` : '',
          'skill 已刷新，下一个会话加载时即可看到。',
        ].filter(Boolean).join('\n')),
      }
    },
  }
}

/**
 * Write the plugin's own receipt beside the lesson store.
 *
 * It answers "which generation is the running Host actually using, and what did
 * it manage to register" without reading the process log — the question that
 * cost the most time while building this bundle.
 */
function writeStatus(options, fields) {
  return writeReceipt(options.libraryDir, 'status.json', {
    libraryDir: options.libraryDir,
    scanDepth: options.scanDepth,
    skill: SKILL_NAME,
    ...fields,
  })
}

/**
 * Register the four tools in the calling scope.
 *
 * Every definition is attempted, and every rejection is reported together: a
 * throw inside an injection fiber is otherwise silent, which turned one missing
 * `output.render` into four invisible tools during development.
 */
function registerTools(ctx, { store, options, skillHost }) {
  const definitions = [
    planTool(ctx, options),
    writeTool(ctx),
    auditTool(ctx),
    learnTool(skillHost, options),
  ]
  const failures = []
  const registered = []
  for (const definition of definitions) {
    try {
      ctx.tools.register(definition)
      registered.push(definition.name)
    }
    catch (error) {
      failures.push(`${definition.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  writeStatus(options, { tools: registered, toolsFailed: failures })
  if (failures.length > 0) {
    throw new Error(`@local/dsh-prompt-mode registered ${registered.length}/${definitions.length} tools; these failed:\n- ${failures.join('\n- ')}`)
  }
}

/** Register the evolving skill and keep it in sync with the lesson store. */
function registerSkill(ctx, { store, baseline }) {
  const disposers = []
  const refresh = () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      }
      catch { /* already disposed with the plugin fiber */ }
    }
    const lessons = store.readSync()
    const content = composeSkillBody(baseline, lessons)
    const mirror = store.writeMirror(content)
    disposers.push(ctx.skills.register({
      name: SKILL_NAME,
      description: '系统提示词文档（system prompt document）的创建、自审与交接最佳实践：文档元信息、角色与目标、按任务自动触发的技能表、数据源、执行顺序、硬性约束、验收标准、立即开始，以及可复制粘贴的交接提示词。写任何「让 Agent 先读文档再干活」的提示词文档前，先加载本 skill。',
      whenToUse: '当用户要求为某个 Agent 会话编写系统提示词 / 提示词文档 / 「让 Agent 读这份文档然后执行」的交接提示词，或提示词模式下开始任何新会话时。',
      content,
      source: 'runtime',
      invocation: { modelInvocable: true, userInvocable: true },
      resourceBase: { kind: 'directory', path: SKILL_DIR },
    }))
    return { bytes: Buffer.byteLength(content, 'utf8'), lessons: lessons.length, mirror, problem: store.problem }
  }
  ctx.effect(() => {
    refresh()
    return () => {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        }
        catch { /* ignore */ }
      }
    }
  }, '@local/dsh-prompt-mode: evolving skill')
  return refresh
}

/**
 * Bundle entry point.
 *
 * @param ctx Cordis context of the `prompt-doc-core` loader row.
 * @param config `{ libraryDir?, scanDepth? }` from that row.
 */
export function apply(ctx, config = {}) {
  const options = resolveOptions(config)
  const store = new LessonsStore(options.libraryDir)
  const baseline = readBaseline()
  const skillHost = { store, refresh: () => undefined }

  ctx.inject(['skills'], (skillCtx) => {
    try {
      skillHost.refresh = registerSkill(skillCtx, { store, baseline })
    }
    catch (error) {
      ctx.logger?.warn?.('@local/dsh-prompt-mode: the best-practice skill failed to register: %s', error instanceof Error ? error.message : String(error))
      throw error
    }
    // Surface a corrupt store once, where the operator will see it.
    if (store.problem !== undefined) {
      ctx.logger?.warn?.('@local/dsh-prompt-mode: lesson store unreadable (%s); starting from an empty history', store.problem)
    }
  })

  ctx.inject(['tools'], (toolCtx) => {
    try {
      registerTools(toolCtx, { store, options, skillHost })
    }
    catch (error) {
      ctx.logger?.warn?.('@local/dsh-prompt-mode: %s', error instanceof Error ? error.message : String(error))
      throw error
    }
  })
}

/** Names this bundle contributes, exported for the panel and for tests. */
export const contributions = {
  skill: SKILL_NAME,
  tools: [TOOL_PLAN, TOOL_WRITE, TOOL_AUDIT, TOOL_LEARN],
  sections: DOC_SECTIONS.map(section => section.canonical),
  metaFields: META_FIELDS.map(field => field.key),
  libraryDir: defaultLibraryDir(),
}
