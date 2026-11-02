// Contract: one command for the fresh-profile verification that README
// "七、复现验证" documents by hand. A profile is created from the shipped
// `headless` template (a new process is the only way to load this bundle's
// current code — the running `web` process keeps the module generation it
// imported first), this bundle is linked into it, a two-row overlay grants
// danger-full-access and mounts the agent-preset registry, and one headless
// run answers the tool-name question. The verdict comes from the receipts on
// disk, never from row state: a failed preset mount is swallowed into
// `record.broken` plus a log line this app never prints.
//
// Exit codes:
//   0  every applicable criterion passed; a SKIPped criterion does not fail
//   1  a step or a criterion failed; the reason is printed, never swallowed
//   2  a usage error, or DSH_CLI names a file that does not exist
//
// No CLI on the machine is an environment fact, not a failure: the script
// prints SKIP and exits 0, exactly like scripts/check-preset-drift.mjs treats
// a missing DSH source root.
//
// No dependencies: node: built-ins only, like every other file in this bundle.

import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const PACKAGE_JSON = path.join(PACKAGE_ROOT, 'package.json')

/**
 * The DSH source checkout this repository develops against, used when neither
 * DSH_CLI nor PATH names a CLI. An explicit DSH_CLI that does not exist is a
 * usage error (exit 2); this one is only a candidate, probed for existence.
 */
export const KNOWN_CLI_PATH = 'D:/XiaoProject/deepseek-harness/apps/cli/lib/bin.js'

/** The four tools the Host half must register, in the order README lists them. */
const EXPECTED_TOOLS = ['prompt_doc_audit', 'prompt_doc_learn', 'prompt_doc_plan', 'prompt_doc_write']

/** The question README "七" asks; VERIFY_QUERY overrides it. */
const DEFAULT_QUERY = '只输出一行：你当前可用工具中所有以 prompt_doc 开头的工具名，用逗号分隔。'

/** The second-write shape of preset.json: proof the section itself registered. */
const PRESET_SECTION = 'prompt:policy'
const PRESET_ORDER = 520

/** The skill mirror and the lessons heading a rewritten mirror always carries. */
const SKILL_MIRROR = 'system-prompt-doc-best-practices.md'
const LESSONS_HEADING = '## 已积累的经验教训'

/** Profile name: pid-suffixed so concurrent runs never share one profile. */
const PROFILE_PREFIX = 'promptverify'

/** The overlay this script writes and applies with --patch. A fixed name keeps repeated runs reproducible. */
const OVERLAY_FILE = path.join(os.tmpdir(), 'dsh-prompt-mode-verify-overlay.yml')

/**
 * The two-row overlay README "七" adds to the profile, reproduced verbatim
 * from the measured `promptverify` profile. Applied through --patch, the
 * profile's own user layer stays the shipped empty list.
 *
 * Row 1 seeds every fresh session with danger-full-access: headless has
 * nobody to approve a write. Row 2 mounts the agent-preset registry, without
 * which the bundle's preset-prompt row stays pending and its subtree — the
 * prompt:policy section — is never resolved. That row must be wrapped in
 * `- insert:`; a top-level `- id:` is an override and is skipped with
 * "patch: entry not found" when the id does not exist yet.
 */
const OVERLAY_YAML = `# Written by scripts/verify-host.mjs (README "七、复现验证"); applied
# with --patch so the profile's own user layer stays the shipped empty list.
# Delete it together with the profile.
- id: permission
  name: "@deepseek-ai/dsh-permission-presets"
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never
    defaultPreset: danger-full-access

- insert:
    - id: agent-preset-registry
      name: "@deepseek-ai/dsh-agent-preset-registry"
      config:
        default: prompt
`

const EXIT_OK = 0
const EXIT_FAIL = 1
const EXIT_USAGE = 2

/** Generous capture for the pnpm install and the model run, both of which print a lot. */
const MAX_BUFFER = 32 * 1024 * 1024
const TIMEOUT_MS = 600000

const USAGE = `Usage: node scripts/verify-host.mjs [--receipts-only]

Automates README "七、复现验证": creates a fresh profile from the shipped
headless template, links this bundle into it, applies the two-row overlay
(permission danger-full-access plus the agent-preset-registry insert), runs one
headless question, and asserts the on-disk receipts. The profile is never
deleted; the script prints the cleanup command instead.

Options:
  --receipts-only   skip the model question: boot without a task, which mounts
                    the tree and writes the receipts, then assert receipts only
  -h, --help        show this help

Environment:
  DSH_CLI           CLI entry to use instead of the known checkout or PATH
  VERIFY_QUERY      question to ask instead of the README one (full mode)

Exit codes: 0 every applicable criterion passed, 1 a criterion failed,
2 a usage error.`

/** Is this path an existing regular file? The injectable probe keeps resolveCliPath testable. */
function defaultIsFile(candidate) {
  try {
    return statSync(candidate).isFile()
  }
  catch {
    return false
  }
}

/** The executable names a PATH lookup tries, in order, for this platform. */
function cliCandidates() {
  return process.platform === 'win32'
    ? ['dsh', 'dsh.cmd', 'dsh.exe', 'dsh.bat']
    : ['dsh']
}

/** First PATH directory holding one of the candidate executables. */
function findOnPath(env, isFile) {
  const search = env.PATH ?? env.Path ?? ''
  for (const dir of search.split(path.delimiter)) {
    if (dir === '') continue
    for (const name of cliCandidates()) {
      const candidate = path.join(dir, name)
      if (isFile(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Resolve the DSH CLI entry, highest precedence first: $DSH_CLI, then this
 * repository's known checkout (probed for existence), then `dsh` on PATH.
 * An explicit $DSH_CLI is trusted as given; main() fails it loudly when the
 * file is not there.
 *
 * @param env - environment mapping to read
 * @param isFile - existence probe, injectable for tests
 * @returns the CLI entry path, or undefined when none is available
 */
export function resolveCliPath(env = process.env, isFile = defaultIsFile) {
  const fromEnv = typeof env.DSH_CLI === 'string' ? env.DSH_CLI.trim() : ''
  if (fromEnv !== '') return fromEnv
  if (isFile(KNOWN_CLI_PATH)) return KNOWN_CLI_PATH
  return findOnPath(env, isFile)
}

/**
 * Assert the Host half's receipt: the running process registered this
 * package's version and exactly the four documented tools, with no failures.
 * A version mismatch is the interesting failure — it means the process loaded
 * a different generation of this bundle than the one on disk.
 *
 * @param json - parsed status.json, or null when the file is missing or unreadable
 * @param pkgVersion - the version from this package's package.json
 * @returns { status: 'pass' } or { status: 'fail', reason }
 */
export function assertStatusReceipt(json, pkgVersion) {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return { status: 'fail', reason: 'status.json is missing or not a JSON object' }
  }
  if (json.version !== pkgVersion) {
    return {
      status: 'fail',
      reason: `version is ${JSON.stringify(json.version)}, package.json says ${JSON.stringify(pkgVersion)} — the running process loaded a different generation of this bundle`,
    }
  }
  if (!Array.isArray(json.tools)) {
    return { status: 'fail', reason: `tools is ${JSON.stringify(json.tools)}, expected an array of tool names` }
  }
  const actual = [...json.tools].sort()
  const expected = [...EXPECTED_TOOLS].sort()
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    return {
      status: 'fail',
      reason: `tools are ${JSON.stringify(json.tools)}, expected exactly ${JSON.stringify(EXPECTED_TOOLS)}`,
    }
  }
  if (!Array.isArray(json.toolsFailed) || json.toolsFailed.length > 0) {
    return {
      status: 'fail',
      reason: `toolsFailed is ${JSON.stringify(json.toolsFailed)}, expected an empty array`,
    }
  }
  return { status: 'pass' }
}

/**
 * Assert the preset half's receipt. Only the second write proves the
 * prompt:policy section itself registered: the first write lands as soon as
 * the preset's child row mounts, even in a composition whose systemPrompt
 * service never arrives, so a receipt without the section is a real failure.
 *
 * A missing file is a SKIP, not a failure: the shipped headless bundle mounts
 * no agentPresets service, so the preset row stays pending there and no
 * receipt is ever written — README records this app-combination difference.
 * The overlay's registry insert is what makes the receipt appear where it can.
 *
 * @param json - parsed preset.json, or null when the file is missing
 * @returns { status: 'pass' | 'fail' | 'skip', reason }
 */
export function assertPresetReceipt(json) {
  if (json === null || json === undefined) {
    return {
      status: 'skip',
      reason: 'no preset.json: this composition mounted no agentPresets service, so the preset criterion does not apply (README records this headless app-combination difference)',
    }
  }
  if (typeof json !== 'object' || Array.isArray(json)) {
    return { status: 'fail', reason: 'preset.json is not a JSON object' }
  }
  if (json.section !== PRESET_SECTION) {
    return {
      status: 'fail',
      reason: `section is ${JSON.stringify(json.section)}, expected ${JSON.stringify(PRESET_SECTION)} — a receipt without the section is the first-write shape: the preset row mounted but the section never registered`,
    }
  }
  if (json.order !== PRESET_ORDER) {
    return {
      status: 'fail',
      reason: `order is ${JSON.stringify(json.order)}, expected ${PRESET_ORDER}`,
    }
  }
  return { status: 'pass' }
}

/** The harness home, resolved exactly like lib/lessons.js resolves it. */
function resolveHome(env) {
  return typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== ''
    ? env.DSH_HOME.trim()
    : path.join(os.homedir(), '.dsh')
}

/** libraryDir for a run whose env carries no DSH_PROFILE_DIR and no DSH_PROFILE. */
function resolveLibraryDir(env) {
  return path.join(resolveHome(env), 'prompt-mode')
}

/** The profile directory the CLI resolves for this name. */
function resolveProfileDir(env, name) {
  return path.join(resolveHome(env), 'profiles', name)
}

/**
 * The environment every spawned CLI sees: the ambient one minus the two
 * variables that redirect libraryDir into a live profile. This shell (a DSH
 * shell call) exports DSH_PROFILE and DSH_PROFILE_DIR, and without this strip
 * the receipts would land inside the running profile instead of the
 * documented ~/.dsh/prompt-mode.
 */
function childEnv(env) {
  const clean = { ...env }
  delete clean.DSH_PROFILE_DIR
  delete clean.DSH_PROFILE
  return clean
}

/** Last non-empty lines of a captured stream, for a failure message. */
function tail(text, lines = 12) {
  const all = String(text ?? '').split(/\r?\n/).filter(line => line.trim() !== '')
  return all.slice(-lines).join('\n')
}

/** Read one receipt file: missing, unreadable, or parsed. */
function readReceipt(file) {
  if (!existsSync(file)) return { missing: true }
  try {
    return { json: JSON.parse(readFileSync(file, 'utf8')) }
  }
  catch (error) {
    return { problem: `not valid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * A receipt written before this run started is evidence of an older run, not
 * proof of this one. The Host process carries no DSH_* variable, so a stale
 * receipt is the signature of "the bundle never loaded".
 *
 * @param receipt - parsed receipt
 * @param startedAt - epoch ms captured before the first spawned step
 * @returns a reason string, or null when the receipt is fresh
 */
export function freshnessProblem(receipt, startedAt) {
  const at = typeof receipt?.at === 'string' ? Date.parse(receipt.at) : Number.NaN
  if (Number.isNaN(at)) return 'carries no parsable at timestamp'
  if (at < startedAt - 1000) return `was written at ${receipt.at}, before this run started — the headless process never (re)loaded this bundle`
  return null
}

function usageError(message) {
  process.stderr.write(`error: ${message}\n\n${USAGE}\n`)
  process.exit(EXIT_USAGE)
}

function parseArgs(argv) {
  let receiptsOnly = false
  for (const arg of argv) {
    if (arg === '--receipts-only') receiptsOnly = true
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${USAGE}\n`)
      process.exit(EXIT_OK)
    }
    else usageError(`unknown argument '${arg}'`)
  }
  return { receiptsOnly }
}

/** One spawned CLI step, normalized. `error` carries why the spawn itself failed. */
function runCli(args, options) {
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    timeout: TIMEOUT_MS,
    ...options,
  })
  if (result.error) {
    return { ok: false, error: result.error.message, stdout: '', stderr: '' }
  }
  return { ok: result.status === 0, status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** The failure block for one step: what happened, plus the captured output tail. */
function stepFailure(title, step) {
  const why = step.error ?? `exited ${step.status}`
  const output = tail(step.stderr) || tail(step.stdout)
  return `error: ${title} ${why}\n${output === '' ? '(no output captured)' : `${output}\n`}`
}

/** Print one criterion verdict and count it. */
function report(counts, status, label, detail) {
  counts[status] += 1
  const word = status === 'pass' ? 'PASS' : status === 'skip' ? 'SKIP' : 'FAIL'
  process.stdout.write(`  ${word} ${label}${detail === undefined ? '' : `: ${detail}`}\n`)
}

function main() {
  const { receiptsOnly } = parseArgs(process.argv.slice(2))

  let pkg
  try {
    pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'))
  }
  catch (error) {
    usageError(`cannot read ${PACKAGE_JSON}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const env = process.env
  const cli = resolveCliPath(env)
  if (cli === undefined) {
    process.stdout.write(
      'SKIP: no DSH CLI available. Set DSH_CLI to the entry (for example\n' +
      `     ${KNOWN_CLI_PATH}), install that checkout, or put dsh on PATH.\n` +
      '     A machine without a CLI is an environment fact, not a verification failure.\n',
    )
    process.exit(EXIT_OK)
  }
  const fromEnv = typeof env.DSH_CLI === 'string' && env.DSH_CLI.trim() !== ''
  if (fromEnv && !defaultIsFile(cli)) {
    usageError(`DSH_CLI '${cli}' is not a file; point it at the dsh CLI entry (apps/cli/lib/bin.js)`)
  }
  const cliSource = fromEnv ? 'DSH_CLI' : cli === KNOWN_CLI_PATH ? 'known checkout' : 'PATH'

  const profile = `${PROFILE_PREFIX}-${process.pid}`
  const libraryDir = resolveLibraryDir(env)
  const profileDir = resolveProfileDir(env, profile)
  const linkSpec = `link:${PACKAGE_ROOT.replaceAll('\\', '/')}`
  const query = (env.VERIFY_QUERY ?? '').trim() || DEFAULT_QUERY
  const child = childEnv(env)
  const startedAt = Date.now()

  process.stdout.write(
    `verify-host: fresh-profile verification for ${pkg.name} ${pkg.version}\n` +
    `  cli:     ${cli} (${cliSource})\n` +
    `  profile: ${profile}\n` +
    `  bundle:  ${linkSpec}\n` +
    `  overlay: ${OVERLAY_FILE}\n` +
    `  library: ${libraryDir} (DSH_PROFILE_DIR and DSH_PROFILE stripped from the child env)\n` +
    `  mode:    ${receiptsOnly ? 'receipts-only (no model question)' : 'full (the model answers the tool-name question)'}\n\n`,
  )

  const total = 5
  const step = (index, title) => process.stdout.write(`[${index}/${total}] ${title} ... `)

  step(1, 'create the profile from the shipped headless template')
  const created = runCli([cli, '--profile', profile, '--from-default-profile', 'headless', '--dump-config'])
  if (!created.ok) {
    process.stdout.write('FAILED\n')
    process.stdout.write(stepFailure('profile creation', created))
    process.exit(EXIT_FAIL)
  }
  process.stdout.write('ok\n')

  step(2, 'link this bundle into the profile (dsh plugin add)')
  const installed = runCli([cli, 'plugin', '--profile', profile, 'add', linkSpec])
  if (!installed.ok) {
    process.stdout.write('FAILED\n')
    process.stdout.write(stepFailure('bundle install', installed))
    process.stdout.write(cleanupLines(profileDir))
    process.exit(EXIT_FAIL)
  }
  process.stdout.write('ok\n')

  step(3, 'write the two-row overlay (permission + agent-preset-registry)')
  try {
    writeFileSync(OVERLAY_FILE, OVERLAY_YAML)
  }
  catch (error) {
    process.stdout.write('FAILED\n')
    process.stdout.write(`error: cannot write ${OVERLAY_FILE}: ${error instanceof Error ? error.message : String(error)}\n`)
    process.stdout.write(cleanupLines(profileDir))
    process.exit(EXIT_FAIL)
  }
  process.stdout.write('ok\n')

  step(4, receiptsOnly ? 'boot the profile without a task (mounts the tree, writes the receipts)' : 'run the headless question')
  const bootArgs = [cli, '--profile', profile, '--patch', OVERLAY_FILE]
  if (!receiptsOnly) bootArgs.push(query)
  const boot = runCli(bootArgs, { env: child, cwd: PACKAGE_ROOT, input: '' })
  if (receiptsOnly) {
    // A taskless boot mounts the whole tree — both receipts are written during
    // it — and then stops with the app's own "a task is required" error, so the
    // exit code is not the criterion; the receipts below are. Anything else is
    // printed for transparency and still settles in the assertions.
    const expectedStop = boot.status === 1 && boot.stderr.includes('a task is required')
    process.stdout.write(expectedStop ? 'ok (stopped before the model call, as intended)\n' : `exit ${boot.status ?? '?'}\n`)
    if (!expectedStop && boot.stderr.trim() !== '') process.stdout.write(`  note: ${tail(boot.stderr, 4)}\n`)
  }
  else if (!boot.ok) {
    process.stdout.write('FAILED\n')
    process.stdout.write(stepFailure('the headless run', boot))
    process.stdout.write(cleanupLines(profileDir))
    process.exit(EXIT_FAIL)
  }
  else process.stdout.write('ok\n')

  step(5, 'assert the receipts')
  process.stdout.write('\n')

  const counts = { pass: 0, fail: 0, skip: 0 }
  const statusFile = path.join(libraryDir, 'status.json')
  const statusRead = readReceipt(statusFile)
  if (statusRead.missing) {
    report(counts, 'fail', `status.json (${statusFile})`, 'the file does not exist — the headless process never loaded this bundle')
  }
  else if (statusRead.problem !== undefined) {
    report(counts, 'fail', `status.json (${statusFile})`, statusRead.problem)
  }
  else {
    const stale = freshnessProblem(statusRead.json, startedAt)
    if (stale !== null) report(counts, 'fail', `status.json (${statusFile})`, stale)
    else report(counts, 'pass', `status.json (${statusFile})`, `fresh, written ${statusRead.json.at}`)
    const verdict = assertStatusReceipt(statusRead.json, pkg.version)
    report(counts, verdict.status, 'status.json content', verdict.status === 'pass'
      ? `version ${pkg.version}, tools = ${EXPECTED_TOOLS.join(', ')}, toolsFailed = []`
      : verdict.reason)
  }

  if (receiptsOnly) {
    report(counts, 'skip', 'the answer', '--receipts-only skipped the model question')
  }
  else {
    const answer = boot.stdout
    const missing = EXPECTED_TOOLS.filter(name => !answer.includes(name))
    if (missing.length > 0) {
      const shown = tail(answer, 6)
      report(counts, 'fail', 'the answer', `does not list ${missing.join(', ')}${shown === '' ? ' (stdout was empty)' : `; stdout tail:\n${shown}`}`)
    }
    else {
      report(counts, 'pass', 'the answer', `lists all four tool names: ${tail(answer, 1)}`)
    }
  }

  const presetFile = path.join(libraryDir, 'preset.json')
  const presetRead = readReceipt(presetFile)
  if (presetRead.missing) {
    const verdict = assertPresetReceipt(null)
    report(counts, verdict.status, `preset.json (${presetFile})`, verdict.reason)
  }
  else if (presetRead.problem !== undefined) {
    report(counts, 'fail', `preset.json (${presetFile})`, presetRead.problem)
  }
  else {
    const stale = freshnessProblem(presetRead.json, startedAt)
    if (stale !== null) report(counts, 'fail', `preset.json (${presetFile})`, stale)
    else report(counts, 'pass', `preset.json (${presetFile})`, `fresh, written ${presetRead.json.at}`)
    const verdict = assertPresetReceipt(presetRead.json)
    report(counts, verdict.status, 'preset.json content', verdict.status === 'pass'
      ? `section ${PRESET_SECTION}, order ${PRESET_ORDER}`
      : verdict.reason)
  }

  const mirrorFile = path.join(libraryDir, SKILL_MIRROR)
  if (!existsSync(mirrorFile)) {
    report(counts, 'fail', `skill mirror (${mirrorFile})`, 'the file does not exist — the plugin never registered the skill')
  }
  else {
    let body
    try {
      body = readFileSync(mirrorFile, 'utf8')
    }
    catch (error) {
      body = null
      report(counts, 'fail', `skill mirror (${mirrorFile})`, `unreadable: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (body !== null) {
      const writtenAt = statSync(mirrorFile).mtimeMs
      const bytes = Buffer.byteLength(body, 'utf8')
      if (body.trim() === '') {
        report(counts, 'fail', `skill mirror (${mirrorFile})`, 'the file is empty — the mirror was not written')
      }
      else if (writtenAt < startedAt - 1000) {
        report(counts, 'fail', `skill mirror (${mirrorFile})`, `last written ${new Date(writtenAt).toISOString()}, before this run started`)
      }
      else if (!body.includes(LESSONS_HEADING)) {
        report(counts, 'fail', `skill mirror (${mirrorFile})`, 'no lessons section — the mirror is not the composed skill body')
      }
      else {
        report(counts, 'pass', `skill mirror (${mirrorFile})`, `${bytes} bytes, lessons section present`)
      }
    }
  }

  process.stdout.write(`\nresult: ${counts.pass} passed, ${counts.skip} skipped, ${counts.fail} failed\n`)
  process.stdout.write(cleanupLines(profileDir))
  process.exit(counts.fail > 0 ? EXIT_FAIL : EXIT_OK)
}

/** The cleanup block: the profile is evidence and is never deleted automatically. */
function cleanupLines(profileDir) {
  return (
    '\nthe profile is kept on purpose; remove it when done:\n' +
    `  Remove-Item -Recurse -Force ${profileDir}\n` +
    `  Remove-Item ${OVERLAY_FILE}\n`
  )
}

/** Run only when executed directly, so tests can import the pure functions. */
function invokedDirectly() {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  }
  catch {
    return false
  }
}

if (invokedDirectly()) main()
