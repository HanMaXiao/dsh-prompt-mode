/**
 * The path resolver behind every document reference.
 *
 * `prompt_doc_write` and `prompt_doc_audit` decide whether a referenced data
 * source is a dead path through `makeResolver`, and until now nothing exercised
 * it directly: the end-to-end test only ever cited paths that lived in the
 * document's own directory, so the ancestor walk, its depth bound and the cwd
 * fallback were untested behaviour behind two shipped tools.
 *
 * The contract is a resolution ORDER, not one lookup: the document's own
 * directory first (a document is read from where it lies), then up to four
 * ancestors (documents under `docs/` habitually write paths relative to the
 * project root), then the Host process cwd. Each test below pins one rung of
 * that ladder, so a reordered or unbounded walk fails here instead of quietly
 * shipping a document whose paths resolve by accident.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeResolver } from '../host.js'

const originalCwd = process.cwd()
const root = mkdtempSync(path.join(os.tmpdir(), 'prompt-mode-resolver-'))

/** A file whose only job is to exist, so existence is the thing under test. */
function touch(file) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, 'resolver fixture\n', 'utf8')
}

const DOC_DIR = path.join(root, 'docs')
const DEEP_DIR = path.join(root, 'deep', 'a', 'b', 'c', 'd', 'e')
const CWD_DIR = path.join(root, 'cwd')

before(() => {
  // The same name in the document directory and one level above it.
  touch(path.join(DOC_DIR, 'dup.md'))
  touch(path.join(root, 'dup.md'))
  // Only in the document directory.
  touch(path.join(DOC_DIR, 'own.md'))
  // Only at the project root: one ancestor above the document directory.
  touch(path.join(root, 'ancestor.md'))
  // The depth bound. DEEP_DIR is root/deep/a/b/c/d/e, so root/deep/a is its
  // fourth ancestor and root/deep its fifth.
  touch(path.join(root, 'deep', 'a', 'level4.md'))
  touch(path.join(root, 'deep', 'level5.md'))
  mkdirSync(DEEP_DIR, { recursive: true })
  // Reachable only through the last rung, the process cwd.
  touch(path.join(CWD_DIR, 'cwd-only.md'))
  // Pin the cwd for this file so the last rung is deterministic: without it,
  // the runner's own directory is an anchor and a fixture name could resolve
  // through it by accident.
  process.chdir(CWD_DIR)
})

after(() => {
  // Windows refuses to remove a directory that is the process cwd, so step out
  // of the fixture before deleting it.
  try {
    process.chdir(originalCwd)
  }
  finally {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('makeResolver', () => {
  let resolve
  // The resolver captures `process.cwd()` when it is built, and the describe
  // body runs before any hook — so it has to be built here, after the chdir
  // above, or the cwd rung would be tested against the wrong directory.
  before(() => { resolve = makeResolver(DOC_DIR) })

  it('resolves a relative path against the document directory first', () => {
    assert.equal(resolve('own.md'), path.join(DOC_DIR, 'own.md'))
  })

  it('stops at the document directory instead of walking past a hit there', () => {
    // `dup.md` exists in the document directory and in its parent. Answering
    // with the parent copy would mean the walk continued after a hit.
    assert.equal(resolve('dup.md'), path.join(DOC_DIR, 'dup.md'), resolve('dup.md'))
  })

  it('walks up to an ancestor when the document directory has no such file', () => {
    assert.equal(resolve('ancestor.md'), path.join(root, 'ancestor.md'))
  })

  it('probes at most four ancestors above the document directory', () => {
    const fromDeep = makeResolver(DEEP_DIR)
    assert.equal(fromDeep('level4.md'), path.join(root, 'deep', 'a', 'level4.md'))
    // The fifth ancestor, and not the cwd either: beyond the bound, so the
    // document must report this path as missing rather than resolve it.
    assert.equal(fromDeep('level5.md'), undefined)
  })

  it('falls back to the process cwd', () => {
    // The cwd is a sibling of the document directory, so no ancestor of
    // DOC_DIR holds this file: only the last rung can answer.
    assert.equal(resolve('cwd-only.md'), path.join(CWD_DIR, 'cwd-only.md'))
  })

  it('accepts an absolute path only when it exists on disk', () => {
    assert.equal(resolve(path.join(DOC_DIR, 'own.md')), path.join(DOC_DIR, 'own.md'))
    assert.equal(resolve(path.join(DOC_DIR, 'absent.md')), undefined)
  })

  it('reports a relative path that no rung holds', () => {
    assert.equal(resolve('absent.md'), undefined)
  })

  it('treats a blank candidate as no reference at all', () => {
    assert.equal(resolve(''), undefined)
    assert.equal(resolve('   '), undefined)
    assert.equal(resolve('\t\n '), undefined)
  })
})
