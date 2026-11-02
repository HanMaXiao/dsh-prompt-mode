/**
 * Prompt Mode — Host half: the assembly layer.
 *
 * Contributes, profile-wide:
 * - the four tools that ground, write, audit and hand off a standard
 *   system-prompt document (`prompt_doc_*`), assembled from the definitions in
 *   `lib/tools.js`;
 * - the self-iterating `system-prompt-doc-best-practices` skill, whose body is
 *   the shipped baseline plus every lesson recorded through `prompt_doc_learn`;
 * - the `status.json` receipt naming what this generation managed to register.
 *
 * Nothing here touches other sessions' prompts: the prompt-mode policy section
 * lives in `mode.js`, which only the Prompt Mode preset mounts. The floating
 * panel lives in `client.js`.
 *
 * The file is named `host.js` rather than `index.js` so the three halves of the
 * bundle read symmetrically (`host.js` / `mode.js` / `client.js`). The entry is
 * resolved through `exports["."]`, so the name is free to change.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  composeLessonsSection,
  DOC_SECTIONS,
  META_FIELDS,
} from './lib/standard.js'
import { defaultLibraryDir, LessonsStore } from './lib/lessons.js'
import { writeReceipt } from './lib/receipt.js'
import { DEFAULT_MAX_ENTRIES, GROUP_CAP } from './lib/scan.js'
import {
  auditTool,
  learnTool,
  makeResolver,
  planTool,
  SKILL_NAME,
  TOOL_AUDIT,
  TOOL_LEARN,
  TOOL_PLAN,
  TOOL_WRITE,
  writeTool,
} from './lib/tools.js'

// Re-exported from its new home in the tool definition layer: the resolver moved
// there with the two tools that resolve references through it, while this module
// stays the public path the tests and the reference-document audit import.
export { makeResolver }

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = path.join(PACKAGE_DIR, 'skills')
const LESSONS_MARKER = '<!-- LESSONS -->'

/**
 * Validate one scan bound: a positive integer, or a loud failure.
 *
 * Config arrives as operator-written YAML, so a wrong type or range here is a
 * deployment mistake that must surface at apply time; falling back to a
 * default would scan a different tree than the operator configured.
 */
function requirePositiveInteger(value, key) {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`@local/dsh-prompt-mode config key ${key} must be a positive integer, got ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * Validate `groupCaps`: a plain object keyed by scan group name, with positive
 * integer values. Groups the object omits keep their shipped default, so a
 * config may tighten one group without restating the other five.
 */
function resolveGroupCaps(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`@local/dsh-prompt-mode config key groupCaps must be a plain object of per-group caps, got ${JSON.stringify(value)}`)
  }
  const caps = { ...GROUP_CAP }
  for (const [group, cap] of Object.entries(value)) {
    if (!Object.keys(GROUP_CAP).includes(group)) {
      throw new Error(`@local/dsh-prompt-mode config key groupCaps has unknown group ${group} — known groups are ${Object.keys(GROUP_CAP).join(', ')}`)
    }
    caps[group] = requirePositiveInteger(cap, `groupCaps.${group}`)
  }
  return caps
}

/** Accept only the config keys this plugin understands; unknown keys fail loud. */
function resolveOptions(config) {
  const raw = config ?? {}
  const known = new Set(['libraryDir', 'scanDepth', 'maxEntries', 'groupCaps'])
  const unknown = Object.keys(raw).filter(key => !known.has(key))
  if (unknown.length > 0) {
    throw new Error(`@local/dsh-prompt-mode has unknown config key(s) ${unknown.join(', ')} — config is { libraryDir?, scanDepth?, maxEntries?, groupCaps? }`)
  }
  const libraryDir = typeof raw.libraryDir === 'string' && raw.libraryDir.trim() !== ''
    ? path.resolve(raw.libraryDir)
    : defaultLibraryDir()
  const scanDepth = Number.isFinite(raw.scanDepth) ? Number(raw.scanDepth) : 4
  const maxEntries = raw.maxEntries === undefined
    ? DEFAULT_MAX_ENTRIES
    : requirePositiveInteger(raw.maxEntries, 'maxEntries')
  const groupCaps = raw.groupCaps === undefined
    ? { ...GROUP_CAP }
    : resolveGroupCaps(raw.groupCaps)
  return { libraryDir, scanDepth, maxEntries, groupCaps }
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
 * @param config `{ libraryDir?, scanDepth?, maxEntries?, groupCaps? }` from that row.
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
