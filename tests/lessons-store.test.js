/**
 * Section 6 of the migrated offline suite: the lesson store round-trip.
 *
 * The old script kept its self-test library in the workspace root, one store
 * shared by every section of the run. `node --test` runs each file as a separate
 * process in parallel, so each file now gets its own `mkdtemp` directory: a
 * shared store would let one file's append race another's `before + 1` count.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { composeLessonsSection } from '../lib/standard.js'
import { LessonsStore } from '../lib/lessons.js'

const testLibrary = mkdtempSync(path.join(os.tmpdir(), 'prompt-mode-lessons-'))
after(() => rmSync(testLibrary, { recursive: true, force: true }))

describe('lesson store round-trip', () => {
  let store
  let countBefore
  let added
  let body

  before(() => {
    store = new LessonsStore(testLibrary)
    countBefore = store.readSync().length
    added = store.add({ lesson: '自测：数据源路径必须在写入前逐个 stat。', category: 'datasource', evidence: 'self-test' })
    body = composeLessonsSection(store.readSync())
  })

  it('lesson appended', () => {
    assert.equal(added.total, countBefore + 1, `${countBefore} → ${added.total}`)
  })

  it('lesson readable back', () => {
    assert.match(store.readSync().at(-1).lesson, /^自测/)
  })

  it('lessons section renders the new lesson', () => {
    assert.ok(body.includes('数据源路径必须在写入前逐个 stat'))
  })

  it('lessons section groups by category', () => {
    assert.ok(body.includes('### datasource'))
  })
})
