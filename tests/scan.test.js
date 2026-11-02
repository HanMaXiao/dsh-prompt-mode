/**
 * Sections 4 and 5 of the migrated offline suite: the bounded workspace scan and
 * the skill ranking — the two halves of `prompt_doc_plan`'s grounding.
 *
 * The old script scanned the workspace root this plugin was developed in. That
 * path is machine-specific, so the scan falls back to this package when the
 * workspace root is absent (CI): the assertions only ask that a real tree is
 * walked and classified, which holds either way. On the development machine the
 * very same workspace root is scanned, with the same depth.
 *
 * The bounds themselves — depth cap, entry cap, per-group cap, skipped
 * directories, mtime-descending group order — are pinned against synthetic
 * `mkdtempSync` trees instead, so they hold on every platform and on both CI
 * runners. The same file pins the resolver memoization contract behind
 * `prompt_doc_write` / `prompt_doc_audit`: the cache belongs to one resolver
 * instance, never to the module.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeResolver } from '../host.js'
import { rankSkills } from '../lib/standard.js'
import { scanWorkspace } from '../lib/scan.js'

const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const WORKSPACE_ROOT = 'D:/XiaoProject/DSHPluginDev'
const scanRoot = existsSync(WORKSPACE_ROOT) ? WORKSPACE_ROOT : PACKAGE_DIR

describe('workspace scan', () => {
  let scan
  before(() => { scan = scanWorkspace(scanRoot, { maxDepth: 3 }) })

  it('scan finds files', () => {
    assert.ok(scan.visited > 0, `visited=${scan.visited}`)
  })

  it('scan classifies the bundle sources as docs/code', () => {
    assert.ok(
      scan.groups.docs.length + scan.groups.code.length > 0,
      `docs=${scan.groups.docs.length} code=${scan.groups.code.length}`,
    )
  })
})

describe('skill ranking', () => {
  const catalog = [
    { name: 'blender-mcp-best-practices', description: 'Drive a running Blender instance through the BlenderMCP add-on to build and render 3D scenes.' },
    { name: 'lark-sheets', description: '飞书电子表格：创建和操作电子表格。' },
    { name: 'system-prompt-doc-best-practices', description: '系统提示词文档的创建、自审与交接最佳实践。' },
  ]
  const ranked = rankSkills('用 BlenderMCP 搭建博物馆场景，并写系统提示词文档', catalog, 3)

  it('ranks the two relevant skills first', () => {
    assert.ok(
      ranked.length >= 2 && ranked.slice(0, 2).every(entry => entry.name !== 'lark-sheets'),
      ranked.map(entry => `${entry.name}:${entry.score}`).join(', '),
    )
  })
})

/** A file whose only job is to exist, so existence is the thing under test. */
function touch(file, mtime) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, 'fixture\n', 'utf8')
  if (mtime !== undefined) utimesSync(file, mtime, mtime)
}

describe('bounded scan', () => {
  const roots = []

  /** A fresh synthetic tree per concern, so no assertion sees another's files. */
  function makeTree(label) {
    const root = mkdtempSync(path.join(os.tmpdir(), `prompt-mode-scan-${label}-`))
    roots.push(root)
    return root
  }

  after(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true })
  })

  it('stops descending past maxDepth but visits everything inside it', () => {
    const root = makeTree('depth')
    touch(path.join(root, 'alpha.md'))
    touch(path.join(root, 'one', 'note.md'))
    touch(path.join(root, 'one', 'two', 'toodeep.md'))

    const shallow = scanWorkspace(root, { maxDepth: 1 })
    assert.equal(shallow.visited, 2)
    assert.deepEqual(shallow.groups.docs.map(file => file.rel), [
      'alpha.md',
      path.join('one', 'note.md'),
    ])
    assert.ok(shallow.groups.docs.every(file => !file.rel.includes('toodeep')))

    const deeper = scanWorkspace(root, { maxDepth: 2 })
    assert.equal(deeper.visited, 3)
    assert.ok(deeper.groups.docs.some(file => file.rel === path.join('one', 'two', 'toodeep.md')))
  })

  it('stops at maxEntries and reports the truncation', () => {
    const root = makeTree('entries')
    for (let index = 0; index < 5; index++) touch(path.join(root, `cap-${index}.md`))

    const scan = scanWorkspace(root, { maxEntries: 3 })
    assert.equal(scan.visited, 3)
    assert.equal(scan.truncated, true)
    assert.equal(scan.groups.docs.length, 3)
  })

  it('caps a group at GROUP_CAP and skips node_modules and dot directories', () => {
    const root = makeTree('groups')
    // Fixed, distinct mtimes: group order is mtime-descending, and these dates
    // make the expected order independent of readdir order.
    touch(path.join(root, 'gamma.md'), new Date('2024-03-01T00:00:00Z'))
    touch(path.join(root, 'beta.md'), new Date('2024-02-01T00:00:00Z'))
    touch(path.join(root, 'alpha.md'), new Date('2024-01-01T00:00:00Z'))
    // The code group caps at 120 entries.
    for (let index = 0; index < 122; index++) touch(path.join(root, 'many', `mod-${index}.js`))
    touch(path.join(root, 'node_modules', 'pkg', 'index.js'))
    touch(path.join(root, '.hidden', 'secret.js'))

    const scan = scanWorkspace(root)
    assert.deepEqual(scan.groups.docs.map(file => file.rel), ['gamma.md', 'beta.md', 'alpha.md'])
    assert.equal(scan.groups.code.length, 120)
    assert.ok(scan.groups.code.every(file => file.rel.startsWith(`many${path.sep}`)))
    assert.equal(scan.skipped, 2)
    assert.equal(scan.visited, 125)
    assert.equal(scan.truncated, false)
  })
})

describe('makeResolver', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'prompt-mode-resolver-cache-'))
  const docDir = path.join(root, 'docs')
  const ownFile = path.join(docDir, 'resolver-own.md')
  const laterFile = path.join(docDir, 'resolver-later.md')

  before(() => { touch(ownFile) })
  after(() => { rmSync(root, { recursive: true, force: true }) })

  it('answers the same candidate identically within one resolver', () => {
    const resolve = makeResolver(docDir)
    assert.equal(resolve('resolver-own.md'), ownFile)
    assert.equal(resolve('resolver-own.md'), ownFile)
    assert.equal(resolve('resolver-absent.md'), undefined)
    assert.equal(resolve('resolver-absent.md'), undefined)
  })

  it('keeps the memo inside one resolver instance', () => {
    const first = makeResolver(docDir)
    assert.equal(first('resolver-later.md'), undefined)
    touch(laterFile)
    // The first instance keeps its cached answer; a cache shared across
    // instances would answer `undefined` here too and misreport a file that
    // now exists on disk.
    assert.equal(first('resolver-later.md'), undefined)
    // A fresh instance re-probes the disk, so the new file resolves.
    const second = makeResolver(docDir)
    assert.equal(second('resolver-later.md'), laterFile)
  })

  it('accepts an absolute path only when it exists on disk', () => {
    const resolve = makeResolver(docDir)
    assert.equal(resolve(ownFile), ownFile)
    assert.equal(resolve(path.join(docDir, 'resolver-absent.md')), undefined)
  })

  it('treats a blank candidate as no reference at all', () => {
    const resolve = makeResolver(docDir)
    assert.equal(resolve(''), undefined)
    assert.equal(resolve('   '), undefined)
  })
})
