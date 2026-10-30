// Contract: this bundle ships a `preset-prompt` row whose plugin list is a
// verbatim replica of the shipped `standard` preset's plugin list, plus this
// bundle's own rows. A DSH upgrade can change that list, and a stale replica
// silently gives Prompt Mode a different tool set than standard mode.
//
// Exit codes:
//   0  the lists match, or no DSH source root is known (SKIP: a bare checkout
//      and a CI job that never got the source must not fail)
//   1  drift detected; the diff is printed
//   2  a root was supplied but is not a usable DSH source tree, or an expected
//      row is missing (a broken contract must fail loudly, not silently pass)
//
// No YAML library: the parser is purpose-built for the exact shape of these
// two files (a top-level `- insert:` sequence of preset rows; each row's
// `plugins:` list of `- id:` items). Anything outside that shape exits 2
// instead of guessing.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..')
const BUNDLE_PATCH = path.join(PACKAGE_ROOT, 'cordis.patch.yml')
const BUNDLE_ROW_ID = 'preset-prompt'
const SOURCE_PRESET_RELATIVE = path.join('packages', 'bundle', 'web-app', 'presets', 'standard.patch.yml')
const SOURCE_ROW_ID = 'preset-standard'
// Rows this bundle contributes to its own preset are its own business; the
// comparison covers only the rows replicated from the shipped preset.
const LOCAL_ROW_NAME_PREFIX = '@local/'

const EXIT_OK = 0
const EXIT_DRIFT = 1
const EXIT_USAGE = 2

const USAGE = `Usage: node scripts/check-preset-drift.mjs [--dsh-root <dir>]

Compares this bundle's \`preset-prompt\` plugin list against the shipped
\`standard\` preset of a DSH source checkout. The root comes from --dsh-root or
the DSH_SOURCE_ROOT environment variable; without either, the check prints a
SKIP notice and exits 0.`

function parseArgs(argv) {
  let dshRoot = process.env.DSH_SOURCE_ROOT || ''
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dsh-root') {
      dshRoot = argv[++i] ?? ''
    } else if (arg.startsWith('--dsh-root=')) {
      dshRoot = arg.slice('--dsh-root='.length)
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${USAGE}\n`)
      process.exit(EXIT_OK)
    } else {
      process.stderr.write(`error: unknown argument '${arg}'\n\n${USAGE}\n`)
      process.exit(EXIT_USAGE)
    }
  }
  return { dshRoot: dshRoot.trim() }
}

function usageError(message) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(EXIT_USAGE)
}

function readLines(file) {
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  return text.split(/\r?\n/)
}

function indentOf(line) {
  return /^[\t ]*/.exec(line)[0].length
}

function isBlank(line) {
  return line.trim() === ''
}

const ITEM_RE = /^([\t ]*)- (.*)$/
const ID_RE = /^id:[\t ]*(['"]?)(.*?)\1[\t ]*$/

function findRow(lines, rowId) {
  for (let i = 0; i < lines.length; i++) {
    const item = ITEM_RE.exec(lines[i])
    if (!item) continue
    const kv = ID_RE.exec(item[2])
    if (kv && kv[2] === rowId) return { index: i, indent: item[1].length }
  }
  return null
}

function rowEnd(lines, row) {
  for (let i = row.index + 1; i < lines.length; i++) {
    const item = ITEM_RE.exec(lines[i])
    if (item && item[1].length <= row.indent) return i
  }
  return lines.length
}

// Returns the plugin entries of `row`'s `plugins:` list, each entry keeping
// its raw lines (blank lines inside literal blocks included).
function extractPlugins(lines, row, file) {
  const end = rowEnd(lines, row)
  let keyIndex = -1
  let keyIndent = 0
  for (let i = row.index + 1; i < end; i++) {
    if (isBlank(lines[i])) continue
    const key = /^([\t ]*)plugins:[\t ]*$/.exec(lines[i])
    if (key) {
      keyIndex = i
      keyIndent = key[1].length
      break
    }
  }
  if (keyIndex < 0) usageError(`${file}: row '${BUNDLE_ROW_ID}' has no plugins: list`)

  const block = []
  for (let i = keyIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (isBlank(line)) {
      block.push(line)
      continue
    }
    if (indentOf(line) <= keyIndent) break
    block.push(line)
  }
  while (block.length > 0 && isBlank(block[block.length - 1])) block.pop()

  let first = 0
  while (first < block.length && isBlank(block[first])) first++
  if (first >= block.length) usageError(`${file}: row '${BUNDLE_ROW_ID}' has an empty plugins: list`)

  const itemIndent = indentOf(block[first])
  const entries = []
  let current = null
  for (let i = first; i < block.length; i++) {
    const line = block[i]
    const item = ITEM_RE.exec(line)
    if (item && item[1].length === itemIndent) {
      current = { id: null, name: null, lines: [line] }
      entries.push(current)
      continue
    }
    if (!current) usageError(`${file}: unexpected line before the first plugin item: ${line.trim()}`)
    current.lines.push(line)
  }

  const nameRe = new RegExp(`^[\\t ]{${itemIndent + 2}}name:[\\t ]*(['"]?)(.*?)\\1[\\t ]*$`)
  for (const entry of entries) {
    const kv = ID_RE.exec(ITEM_RE.exec(entry.lines[0])[2])
    if (!kv || !kv[2]) usageError(`${file}: plugin item without an id: ${entry.lines[0].trim()}`)
    entry.id = kv[2]
    for (const line of entry.lines) {
      const name = nameRe.exec(line)
      if (name) {
        entry.name = name[2]
        break
      }
    }
  }
  return entries
}

// Classic LCS over two sequences; returns the edit script.
function lcsOps(before, after, equal) {
  const n = before.length
  const m = after.length
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = equal(before[i], after[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (equal(before[i], after[j])) {
      ops.push({ type: 'same', before: before[i], after: after[j] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'only-before', before: before[i] })
      i++
    } else {
      ops.push({ type: 'only-after', after: after[j] })
      j++
    }
  }
  while (i < n) ops.push({ type: 'only-before', before: before[i++] })
  while (j < m) ops.push({ type: 'only-after', after: after[j++] })
  return ops
}

function lineDiff(before, after) {
  return lcsOps(before, after, (a, b) => a === b)
}

// Prints a line diff as compact hunks with three lines of context.
function printLineDiff(before, after, indent) {
  const ops = lineDiff(before, after)
  const keep = ops.map((op) => op.type !== 'same')
  ops.forEach((op, idx) => {
    if (op.type === 'same') return
    for (let k = Math.max(0, idx - 3); k <= Math.min(ops.length - 1, idx + 3); k++) keep[k] = true
  })
  let skipping = false
  for (let idx = 0; idx < ops.length; idx++) {
    const op = ops[idx]
    if (keep[idx]) {
      const marker = op.type === 'same' ? ' ' : op.type === 'only-before' ? '-' : '+'
      const line = op.type === 'same' ? op.before : op.type === 'only-before' ? op.before : op.after
      process.stdout.write(`${indent}${marker} ${line}\n`)
      skipping = false
    } else if (!skipping) {
      process.stdout.write(`${indent}...\n`)
      skipping = true
    }
  }
}

function main() {
  const { dshRoot } = parseArgs(process.argv.slice(2))

  if (!dshRoot) {
    process.stdout.write(
      'SKIP: preset drift check needs the DSH source tree; pass --dsh-root <dir> or set DSH_SOURCE_ROOT.\n' +
      '     Local example: node scripts/check-preset-drift.mjs --dsh-root D:\\XiaoProject\\deepseek-harness\n',
    )
    process.exit(EXIT_OK)
  }

  if (!existsSync(dshRoot)) {
    usageError(`--dsh-root '${dshRoot}' does not exist; expected a DSH source checkout (the directory containing packages/)`)
  }
  const sourcePreset = path.join(dshRoot, SOURCE_PRESET_RELATIVE)
  if (!existsSync(sourcePreset)) {
    usageError(`${sourcePreset} not found; is '${dshRoot}' a DSH source checkout?`)
  }
  if (!existsSync(BUNDLE_PATCH)) {
    usageError(`${BUNDLE_PATCH} not found; run this script from the package root`)
  }

  const bundleLines = readLines(BUNDLE_PATCH)
  const bundleRow = findRow(bundleLines, BUNDLE_ROW_ID)
  if (!bundleRow) usageError(`${BUNDLE_PATCH}: no row with id '${BUNDLE_ROW_ID}'`)
  const sourceLines = readLines(sourcePreset)
  const sourceRow = findRow(sourceLines, SOURCE_ROW_ID)
  if (!sourceRow) usageError(`${sourcePreset}: no row with id '${SOURCE_ROW_ID}'`)

  const bundleAll = extractPlugins(bundleLines, bundleRow, BUNDLE_PATCH)
  const sourceAll = extractPlugins(sourceLines, sourceRow, sourcePreset)

  const localRows = bundleAll.filter((entry) => entry.name && entry.name.startsWith(LOCAL_ROW_NAME_PREFIX))
  const bundle = bundleAll.filter((entry) => !localRows.includes(entry))
  const source = sourceAll

  const localNote = localRows.length > 0
    ? ` (${localRows.length} local row${localRows.length > 1 ? 's' : ''} excluded: ${localRows.map((e) => e.id).join(', ')})`
    : ''

  process.stdout.write(
    `preset drift check: ${BUNDLE_ROW_ID} (this bundle) vs ${SOURCE_ROW_ID} (shipped standard preset)\n` +
    `  bundle: cordis.patch.yml\n` +
    `  source: ${sourcePreset}\n` +
    `  compared: ${source.length} shipped plugin rows${localNote}\n\n`,
  )

  const ops = lcsOps(bundle, source, (a, b) => a.id === b.id)
  const missing = ops.filter((op) => op.type === 'only-after')
  const extra = ops.filter((op) => op.type === 'only-before')
  const changed = ops.filter((op) => op.type === 'same' && lineDiff(op.before.lines, op.after.lines).some((l) => l.type !== 'same'))

  if (missing.length === 0 && extra.length === 0 && changed.length === 0) {
    process.stdout.write(`preset drift check: zero drift (${source.length} plugin rows identical)\n`)
    process.exit(EXIT_OK)
  }

  process.stdout.write(`DRIFT DETECTED: ${missing.length} missing, ${extra.length} extra, ${changed.length} changed\n\n`)

  if (missing.length > 0) {
    process.stdout.write('missing from preset-prompt (standard has them, this bundle does not):\n')
    for (const op of missing) {
      process.stdout.write(`  - ${op.after.id}${op.after.name ? ` (${op.after.name})` : ''}\n`)
    }
    process.stdout.write('\n')
  }
  if (extra.length > 0) {
    process.stdout.write('extra in preset-prompt (not in standard):\n')
    for (const op of extra) {
      process.stdout.write(`  - ${op.before.id}${op.before.name ? ` (${op.before.name})` : ''}\n`)
    }
    process.stdout.write('\n')
  }
  for (const op of changed) {
    process.stdout.write(`changed: ${op.before.id} (- bundle, + standard)\n`)
    printLineDiff(op.before.lines, op.after.lines, '  ')
    process.stdout.write('\n')
  }

  process.stdout.write(
    'fix: refresh the plugins list of the preset-prompt row in cordis.patch.yml to match\n' +
    `     ${sourcePreset}\n` +
    '     (keep this bundle\'s own rows at the end), then re-run this script.\n',
  )
  process.exit(EXIT_DRIFT)
}

main()
