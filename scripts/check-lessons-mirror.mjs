// Contract: this bundle and its public sibling `dsh-prompt-optimize` each ship
// their own `lib/lessons.js`. The duplication is deliberate — a bundle is
// installed and loaded as an independent package, so neither side can import
// the other's copy — and so is its cost: change one and the two plugins drift
// apart in the one place where a silent difference costs real lessons. The
// decision and its boundaries live in
// `.agents/notes/implemented/architecture/2026-10-30-two-prompt-bundles-keep-separate-lesson-stores.md`.
//
// This script is the mechanism that note says was missing: nothing used to
// notice when the two copies stopped agreeing. It compares the *contract
// surface*, not the text — the exports both bundles must ship, plus a behaviour
// probe run against a real store in a scratch directory. Everything the note
// marks as deliberately different (lesson id prefixes, category sets, library
// directory names, mirror file names, and where `composeLessonsSection` lives)
// is outside the comparison, so a real divergence is reported while the
// documented asymmetry is not.
//
// Exit codes:
//   0  no drift, or no sibling module is known (SKIP: a bare checkout and a CI
//      job that never got the source must not fail)
//   1  drift detected; every differing item is printed with its reason
//   2  a sibling path was named but holds no lib/lessons.js, or an argument is
//      unknown (a broken contract must fail loudly, not silently pass)
//
// No dependencies: node: built-ins only, like every other file in this bundle.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const LOCAL_LESSONS = path.join(PACKAGE_ROOT, 'lib', 'lessons.js')

/**
 * The sibling checkout consulted when neither SIBLING_ROOT nor --sibling names
 * one. It is only a candidate: an absent path is an environment fact, so the
 * check SKIPs. Exit 2 is reserved for a path that was named explicitly and is
 * not there, which is a caller mistake rather than a missing machine.
 */
export const LOCAL_SIBLING_FILE = 'D:/XiaoProject/DSHPluginDev/dsh-prompt-optimize/lib/lessons.js'

/**
 * The export surface both bundles must ship.
 *
 * Extras are out of contract on purpose: the sibling also exports
 * `composeLessonsSection`, which this bundle keeps in `lib/standard.js` because
 * the two compose their skill sections differently. The architecture note
 * records that asymmetry, so it must not read as drift here.
 */
export const REQUIRED_EXPORTS = ['LESSON_CATEGORIES', 'LessonsStore', 'writeFileAtomic', 'defaultLibraryDir']

/** The one category both bundles list, so the probe lesson files identically. */
const PROBE_CATEGORY = 'constraint'
const PROBE_LESSON = 'lessons mirror probe: this text must survive the round trip'
const PROBE_EVIDENCE = 'scripts/check-lessons-mirror.mjs'
const PROBE_MIRROR_BODY = '# lessons mirror probe\n\nwritten by scripts/check-lessons-mirror.mjs\n'
/** Deliberately unparsable: the store must degrade, not throw and not drop silently. */
const PROBE_CORRUPT_JSON = '{ this is not lessons.json'

const PROBE_ADD = 'add() returns { record, total, file }'
const PROBE_ID = 'record.id is non-empty and survives readSync()'
const PROBE_MIRROR = 'writeMirror() writes a readable file with the given content'
const PROBE_CORRUPT = 'a corrupt lessons.json degrades to an empty list with .problem set'

/** The probes, in the order they run, for one store. */
export const PROBE_NAMES = [PROBE_ADD, PROBE_ID, PROBE_MIRROR, PROBE_CORRUPT]

const NOTE_PATH = '.agents/notes/implemented/architecture/2026-10-30-two-prompt-bundles-keep-separate-lesson-stores.md'

const EXIT_OK = 0
const EXIT_DRIFT = 1
const EXIT_USAGE = 2

const USAGE = `Usage: node scripts/check-lessons-mirror.mjs [--sibling <path>]

Compares this bundle's lib/lessons.js against the sibling bundle's copy. The
two are hand-mirrored duplicates that must change together, so the check
compares their contract surface: the exports both bundles must ship, plus a
behaviour probe run against a real store in a scratch directory.

Options:
  --sibling <path>  the sibling package root, its lib/ directory, or the
                    lib/lessons.js file itself
  -h, --help        show this help

Environment:
  SIBLING_ROOT      same as --sibling, and takes precedence over it

Exit codes: 0 no drift or nothing to compare, 1 drift detected, 2 a named
sibling path holds no lib/lessons.js or an argument is unknown.`

function parseArgs(argv) {
  let siblingRoot = ''
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--sibling') {
      siblingRoot = argv[++i] ?? ''
    }
    else if (arg.startsWith('--sibling=')) {
      siblingRoot = arg.slice('--sibling='.length)
    }
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${USAGE}\n`)
      process.exit(EXIT_OK)
    }
    else {
      process.stderr.write(`error: unknown argument '${arg}'\n\n${USAGE}\n`)
      process.exit(EXIT_USAGE)
    }
  }
  return { siblingRoot: siblingRoot.trim() }
}

function usageError(message) {
  process.stderr.write(`error: ${message}\n\n${USAGE}\n`)
  process.exit(EXIT_USAGE)
}

function defaultIsFile(candidate) {
  try {
    return statSync(candidate).isFile()
  }
  catch {
    return false
  }
}

function reason(error) {
  return error instanceof Error ? error.message : String(error)
}

/** A value as one short line, for a drift reason. */
function show(value) {
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return JSON.stringify(value)
  try {
    return JSON.stringify(value) ?? String(value)
  }
  catch {
    return String(value)
  }
}

/**
 * Read a path as the sibling module: a file is taken as given, a directory is
 * read as a package root (or as `lib/`), and a path matching none of those
 * shapes resolves to the package-root reading, so the error message names the
 * file the caller most likely meant.
 */
function asLessonsFile(root, isFile) {
  const candidates = [root, path.join(root, 'lib', 'lessons.js'), path.join(root, 'lessons.js')]
  for (const candidate of candidates) {
    if (isFile(candidate)) return candidate
  }
  return candidates[1]
}

/**
 * Resolve which `lib/lessons.js` to compare against. SIBLING_ROOT wins over
 * --sibling, because CI supplies it and a stray flag must not silently redirect
 * the check the pipeline runs.
 *
 * @param siblingRoot - the --sibling value, already trimmed
 * @param env - environment mapping to read
 * @param isFile - existence probe, injectable for tests
 * @returns { file, source, explicit } — `explicit` marks a path the caller
 *   named, which is the one case where a missing file is a usage error
 */
export function resolveSiblingFile({ siblingRoot = '', env = {}, isFile = defaultIsFile } = {}) {
  const fromEnv = typeof env.SIBLING_ROOT === 'string' ? env.SIBLING_ROOT.trim() : ''
  if (fromEnv !== '') return { file: asLessonsFile(fromEnv, isFile), source: 'SIBLING_ROOT', explicit: true }
  const fromArg = typeof siblingRoot === 'string' ? siblingRoot.trim() : ''
  if (fromArg !== '') return { file: asLessonsFile(fromArg, isFile), source: '--sibling', explicit: true }
  return { file: LOCAL_SIBLING_FILE, source: 'the local sibling checkout', explicit: false }
}

/** Does this module namespace export `name`? */
function hasExport(moduleNamespace, name) {
  return moduleNamespace !== null
    && typeof moduleNamespace === 'object'
    && moduleNamespace[name] !== undefined
}

/**
 * Compare the two export surfaces against the contract both bundles ship.
 *
 * @param localNs - this bundle's lib/lessons.js namespace
 * @param siblingNs - the sibling's namespace
 * @returns one row per required export, `same` when both sides have it
 */
export function compareExportSurfaces(localNs, siblingNs) {
  return REQUIRED_EXPORTS.map((name) => {
    const inLocal = hasExport(localNs, name)
    const inSibling = hasExport(siblingNs, name)
    if (inLocal && inSibling) {
      return { area: 'exports', name, status: 'same' }
    }
    return {
      area: 'exports',
      name,
      status: 'drift',
      detail: `missing from ${inLocal ? 'the sibling bundle' : 'this bundle'}`,
    }
  })
}

/** Run one call into the module under test, keeping either its value or the throw. */
function capture(body) {
  try {
    return { value: body() }
  }
  catch (error) {
    return { problem: `threw ${reason(error)}` }
  }
}

/**
 * Run one probe body and turn its verdict into a problem string.
 *
 * The body returns undefined when the probe passes, or the reason it failed.
 * An exception from the module under test is caught and reported the same way,
 * so a throwing store is a drift report rather than a crashed check.
 */
function problemOf(body) {
  try {
    return body() ?? undefined
  }
  catch (error) {
    return `threw ${reason(error)}`
  }
}

/** What is wrong with the shape `add()` returned, or undefined when it is right. */
function addShapeProblem(result) {
  if (result === null || typeof result !== 'object') return `add() returned ${show(result)}, expected an object`
  const { record, total, file } = result
  if (record === null || typeof record !== 'object') return `record is ${show(record)}, expected an object`
  if (typeof total !== 'number') return `total is ${show(total)}, expected a number`
  if (typeof file !== 'string' || file === '') return `file is ${show(file)}, expected a path`
  if (record.lesson !== PROBE_LESSON) return `record.lesson is ${show(record.lesson)}, expected the appended text`
  if (total !== 1) return `total is ${total}, expected 1 for the first lesson in a scratch store`
  return undefined
}

/**
 * Probe one store's behaviour against the contract the two bundles share.
 *
 * The store gets a scratch directory the caller owns; nothing outside it is
 * read or written, which is what makes it safe to import and drive the
 * sibling's code from a check.
 *
 * @param moduleNamespace - the module under test
 * @param directory - a writable scratch directory
 * @returns one row per probe, `same` when the store honours the contract
 */
export function probeStore(moduleNamespace, directory) {
  const rows = []
  const note = (name, problem) => rows.push({
    area: 'behavior',
    name,
    status: problem === undefined ? 'same' : 'drift',
    ...(problem === undefined ? {} : { detail: problem }),
  })

  const storeRun = capture(() => new moduleNamespace.LessonsStore(directory))
  if (storeRun.problem !== undefined) {
    for (const name of PROBE_NAMES) note(name, `no store to probe: ${storeRun.problem}`)
    return rows
  }
  const store = storeRun.value

  const addRun = capture(() => store.add({ lesson: PROBE_LESSON, category: PROBE_CATEGORY, evidence: PROBE_EVIDENCE }))
  note(PROBE_ADD, addRun.problem ?? addShapeProblem(addRun.value))

  note(PROBE_ID, problemOf(() => {
    if (addRun.problem !== undefined) return `add() failed, so there is no record: ${addRun.problem}`
    const lessons = store.readSync()
    if (!Array.isArray(lessons)) return `readSync() returned ${show(lessons)}, expected an array`
    const id = addRun.value?.record?.id
    if (typeof id !== 'string' || id.trim() === '') return `record.id is ${show(id)}, expected a non-empty string`
    if (!lessons.some(lesson => lesson !== null && typeof lesson === 'object' && lesson.id === id)) {
      return `readSync() lists ${lessons.length} lesson(s) and none carries id ${id}`
    }
    return undefined
  }))

  note(PROBE_MIRROR, problemOf(() => {
    const target = store.writeMirror(PROBE_MIRROR_BODY)
    if (typeof target !== 'string' || target === '') return `writeMirror() returned ${show(target)}, expected a path`
    let content
    try {
      content = readFileSync(target, 'utf8')
    }
    catch (error) {
      return `the mirror at ${target} is unreadable: ${reason(error)}`
    }
    if (content !== PROBE_MIRROR_BODY) {
      return `the mirror at ${target} holds ${content.length} characters, not the ${PROBE_MIRROR_BODY.length} written`
    }
    return undefined
  }))

  // A corrupt store is the failure mode that costs lessons: the plugin answers
  // it by dropping the history and reporting it, never by throwing during
  // apply(). A scratch directory keeps the torn file away from any real store.
  const corruptDir = path.join(directory, 'corrupt')
  note(PROBE_CORRUPT, problemOf(() => {
    mkdirSync(corruptDir, { recursive: true })
    writeFileSync(path.join(corruptDir, 'lessons.json'), PROBE_CORRUPT_JSON, 'utf8')
    const corrupt = new moduleNamespace.LessonsStore(corruptDir)
    const lessons = corrupt.readSync()
    if (!Array.isArray(lessons) || lessons.length !== 0) {
      return `readSync() returned ${show(lessons)}, expected an empty list`
    }
    if (typeof corrupt.problem !== 'string' || corrupt.problem.trim() === '') {
      return `problem is ${show(corrupt.problem)}, expected the parse failure to be reported`
    }
    return undefined
  }))

  return rows
}

/** Load one module by path, naming the file when it cannot be imported. */
async function importModule(file) {
  try {
    return await import(pathToFileURL(file).href)
  }
  catch (error) {
    throw new Error(`cannot import ${file}: ${reason(error)}`)
  }
}

/** Stamp every probe row with the store it belongs to. */
function stamp(side, rows) {
  return rows.map(row => ({ ...row, side }))
}

/**
 * Run the whole comparison: both export surfaces, then both behaviour probes.
 *
 * @param localFile - this bundle's lib/lessons.js
 * @param siblingFile - the sibling's lib/lessons.js
 * @returns { status, rows, drift, localFile, siblingFile }
 */
export async function checkLessonsMirror({ localFile = LOCAL_LESSONS, siblingFile } = {}) {
  const localNs = await importModule(localFile)
  const siblingNs = await importModule(siblingFile)

  const rows = [...compareExportSurfaces(localNs, siblingNs)]
  const localDir = mkdtempSync(path.join(os.tmpdir(), 'lessons-mirror-this-bundle-'))
  const siblingDir = mkdtempSync(path.join(os.tmpdir(), 'lessons-mirror-sibling-'))
  try {
    rows.push(...stamp('this bundle', probeStore(localNs, localDir)))
    rows.push(...stamp('the sibling bundle', probeStore(siblingNs, siblingDir)))
  }
  finally {
    rmSync(localDir, { recursive: true, force: true })
    rmSync(siblingDir, { recursive: true, force: true })
  }

  const drift = rows.filter(row => row.status === 'drift')
  return {
    status: drift.length === 0 ? 'same' : 'drift',
    rows,
    drift,
    localFile,
    siblingFile,
  }
}

/** One titled block of rows: `same` / `drift` plus the reason when there is one. */
function formatArea(title, rows) {
  if (rows.length === 0) return []
  const lines = [`${title}:`]
  for (const row of rows) {
    lines.push(`  ${row.status.padEnd(6)} ${row.name}${row.detail === undefined ? '' : `: ${row.detail}`}`)
  }
  lines.push('')
  return lines
}

/** The whole report as the text `main` prints. */
function formatReport(report, resolved) {
  const lines = [
    `lessons mirror check: lib/lessons.js (this bundle) vs ${report.siblingFile}`,
    `  sibling:  from ${resolved.source}`,
    `  compared: the ${REQUIRED_EXPORTS.length} exports both bundles ship, plus ${PROBE_NAMES.length} behavior probes per store`,
    '  out of contract: lesson id prefixes, category sets, library directory names, mirror file names, and where composeLessonsSection lives',
    '',
  ]
  lines.push(...formatArea('exports', report.rows.filter(row => row.area === 'exports')))
  lines.push(...formatArea("behavior (this bundle's store)", report.rows.filter(row => row.area === 'behavior' && row.side === 'this bundle')))
  lines.push(...formatArea("behavior (the sibling bundle's store)", report.rows.filter(row => row.area === 'behavior' && row.side === 'the sibling bundle')))

  const exportDrift = report.drift.filter(row => row.area === 'exports').length
  const probeDrift = report.drift.length - exportDrift
  if (report.drift.length === 0) {
    lines.push(`lessons mirror check: zero drift (${REQUIRED_EXPORTS.length} exports, ${PROBE_NAMES.length} behavior probes per store)`)
  }
  else {
    lines.push(`DRIFT DETECTED: ${exportDrift} export(s), ${probeDrift} behavior probe(s)`)
    lines.push('')
    lines.push('fix: lib/lessons.js is a hand-mirrored copy of the sibling bundle\'s; the two change together.')
    lines.push(`     ${NOTE_PATH}`)
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const { siblingRoot } = parseArgs(process.argv.slice(2))
  const resolved = resolveSiblingFile({ siblingRoot, env: process.env })

  if (!defaultIsFile(resolved.file)) {
    if (resolved.explicit) {
      usageError(`${resolved.source} names '${resolved.file}', which is not a lib/lessons.js file`)
    }
    process.stdout.write(
      'SKIP: the lessons mirror check needs the sibling bundle\'s lib/lessons.js. Set SIBLING_ROOT,\n' +
      '     pass --sibling <path>, or keep the local checkout at\n' +
      `     ${LOCAL_SIBLING_FILE}\n`,
    )
    process.exit(EXIT_OK)
  }

  let report
  try {
    report = await checkLessonsMirror({ siblingFile: resolved.file })
  }
  catch (error) {
    usageError(reason(error))
  }
  process.stdout.write(formatReport(report, resolved))
  process.exit(report.status === 'drift' ? EXIT_DRIFT : EXIT_OK)
}

/** Run only when executed directly, so tests can import the pure functions. */
function invokedDirectly() {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return realPathOf(entry) === realPathOf(fileURLToPath(import.meta.url))
  }
  catch {
    return false
  }
}

/** The canonical path of a file that exists, or its resolved form when it does not. */
function realPathOf(file) {
  return existsSync(file) ? realpathSync(file) : path.resolve(file)
}

if (invokedDirectly()) main()
