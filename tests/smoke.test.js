/**
 * Packaging contract smoke test.
 *
 * The bundle is imported straight off disk by the Loader, so the cheapest
 * regression that matters is "everything `package.json` promises is actually
 * in the tree, and the two dictionaries agree". This runs in CI before any
 * behaviour test does, because a missing file fails as an install that
 * succeeds and then refuses to mount.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8'))

describe('package contract', () => {
  it('every exports target exists on disk', () => {
    for (const [key, target] of Object.entries(pkg.exports ?? {})) {
      if (typeof target !== 'string') continue
      if (target.includes('*')) {
        // A pattern export: the directory it globs must exist.
        const dir = path.join(PACKAGE_DIR, target.split('*')[0])
        assert.ok(existsSync(dir), `exports["${key}"] globs a missing directory: ${target}`)
        continue
      }
      assert.ok(existsSync(path.join(PACKAGE_DIR, target)), `exports["${key}"] points at a missing file: ${target}`)
    }
  })

  it('the two locale dictionaries carry identical key sets', () => {
    const zh = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'locale/zh.json'), 'utf8'))
    const en = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'locale/en.json'), 'utf8'))
    assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  })
})

describe('contributions', () => {
  it('declares the four tools and the skill the README documents', async () => {
    const { contributions } = await import('../host.js')
    assert.equal(contributions.skill, 'system-prompt-doc-best-practices')
    assert.deepEqual(contributions.tools, [
      'prompt_doc_plan',
      'prompt_doc_write',
      'prompt_doc_audit',
      'prompt_doc_learn',
    ])
  })
})
