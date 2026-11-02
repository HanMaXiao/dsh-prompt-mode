/**
 * Unit tests for scripts/check-lessons-mirror.mjs: the sibling lesson-store
 * mirror check.
 *
 * The two prompt bundles each ship their own `lib/lessons.js` — a deliberate
 * hand-mirrored duplicate, because a bundle is installed and loaded as an
 * independent package and neither side can import the other's copy. The
 * architecture note records that decision and its cost (change one and the two
 * plugins drift apart where a silent difference costs real lessons), and says
 * nothing used to notice. This script is that notice, so the tests below pin
 * what it compares: the contract surface both bundles must ship, plus the
 * behaviour of a real store in a scratch directory.
 *
 * The comparison functions are imported directly; the script itself is never
 * spawned here, exactly like tests/verify-host.test.js treats
 * scripts/verify-host.mjs.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LESSON_CATEGORIES, LessonsStore, defaultLibraryDir, writeFileAtomic } from '../lib/lessons.js'
import {
  LOCAL_SIBLING_FILE,
  PROBE_NAMES,
  REQUIRED_EXPORTS,
  checkLessonsMirror,
  compareExportSurfaces,
  probeStore,
  resolveSiblingFile,
} from '../scripts/check-lessons-mirror.mjs'

const scratch = mkdtempSync(path.join(os.tmpdir(), 'prompt-mode-mirror-check-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

/** A directory for one probe run. */
function probeDir(name) {
  const dir = path.join(scratch, name)
  return dir
}

/** A module namespace that honours the whole contract, like this bundle's own. */
function contractNamespace(overrides = {}) {
  return {
    LESSON_CATEGORIES,
    LessonsStore,
    writeFileAtomic,
    defaultLibraryDir,
    ...overrides,
  }
}

/** The rows of one probe run, by probe name. */
function rowsByName(rows) {
  return new Map(rows.map(row => [row.name, row]))
}

describe('compareExportSurfaces', () => {
  it('reports every contract export as same when both bundles ship it', () => {
    const rows = compareExportSurfaces(contractNamespace(), contractNamespace())
    assert.deepEqual(rows.map(row => row.status), REQUIRED_EXPORTS.map(() => 'same'))
    assert.deepEqual(rows.map(row => row.name), REQUIRED_EXPORTS)
  })

  // The sibling also exports composeLessonsSection, which this bundle keeps in
  // lib/standard.js. The architecture note records that asymmetry, so an extra
  // export must never read as drift.
  it('ignores exports outside the contract surface', () => {
    const rows = compareExportSurfaces(
      contractNamespace(),
      contractNamespace({ composeLessonsSection: () => '' }),
    )
    assert.equal(rows.length, REQUIRED_EXPORTS.length)
    assert.ok(rows.every(row => row.status === 'same'))
  })

  it('reports drift naming the side that is missing the export', () => {
    const rows = compareExportSurfaces(contractNamespace(), contractNamespace({ writeFileAtomic: undefined }))
    const row = rowsByName(rows).get('writeFileAtomic')
    assert.equal(row.status, 'drift')
    assert.match(row.detail, /missing from the sibling bundle/)
  })

  it('reports drift when this bundle is the side that lost an export', () => {
    const rows = compareExportSurfaces(contractNamespace({ LessonsStore: undefined }), contractNamespace())
    const row = rowsByName(rows).get('LessonsStore')
    assert.equal(row.status, 'drift')
    assert.match(row.detail, /missing from this bundle/)
  })

  it('reports drift when neither bundle ships the export', () => {
    const rows = compareExportSurfaces({}, {})
    assert.ok(rows.every(row => row.status === 'drift'))
  })
})

describe('probeStore', () => {
  it('reports every probe as same for a store that honours the contract', () => {
    const rows = probeStore(contractNamespace(), probeDir('good'))
    assert.deepEqual(rows.map(row => row.name), PROBE_NAMES)
    assert.ok(rows.every(row => row.status === 'same'), JSON.stringify(rows.filter(row => row.status !== 'same')))
  })

  it('reports drift when add() returns the wrong shape', () => {
    const rows = probeStore(contractNamespace({
      LessonsStore: class extends LessonsStore {
        add() { return { record: {}, total: 0 } }
      },
    }), probeDir('bad-add-shape'))
    assert.equal(rowsByName(rows).get('add() returns { record, total, file }').status, 'drift')
    assert.equal(rowsByName(rows).get('record.id is non-empty and survives readSync()').status, 'drift')
  })

  it('reports drift when add() throws instead of returning the record', () => {
    const rows = probeStore(contractNamespace({
      LessonsStore: class extends LessonsStore {
        add() { throw new Error('no lesson today') }
      },
    }), probeDir('add-throws'))
    const row = rowsByName(rows).get('add() returns { record, total, file }')
    assert.equal(row.status, 'drift')
    assert.match(row.detail, /threw no lesson today/)
  })

  it('reports drift when readSync() loses the appended record', () => {
    const rows = probeStore(contractNamespace({
      LessonsStore: class extends LessonsStore {
        readSync() { return [] }
      },
    }), probeDir('read-loses'))
    const row = rowsByName(rows).get('record.id is non-empty and survives readSync()')
    assert.equal(row.status, 'drift')
    assert.match(row.detail, /none carries id/)
  })

  it('reports drift when writeMirror() leaves nothing readable', () => {
    const rows = probeStore(contractNamespace({
      LessonsStore: class extends LessonsStore {
        writeMirror() { return undefined }
      },
    }), probeDir('mirror-missing'))
    const row = rowsByName(rows).get('writeMirror() writes a readable file with the given content')
    assert.equal(row.status, 'drift')
    assert.match(row.detail, /expected a path/)
  })

  // The failure mode that actually costs lessons: the plugin answers a corrupt
  // store by dropping the history and reporting it, never by throwing during
  // apply(). A throwing readSync would take the whole plugin down instead.
  it('reports drift when a corrupt store throws instead of degrading', () => {
    const rows = probeStore(contractNamespace({
      LessonsStore: class extends LessonsStore {
        readSync() { throw new Error('unexpected token') }
      },
    }), probeDir('corrupt-throws'))
    const row = rowsByName(rows).get('a corrupt lessons.json degrades to an empty list with .problem set')
    assert.equal(row.status, 'drift')
    assert.match(row.detail, /threw unexpected token/)
  })

  it('reports drift when a corrupt store stays silent about the problem', () => {
    const rows = probeStore(contractNamespace({
      LessonsStore: class extends LessonsStore {
        readSync() {
          this.problem = undefined
          return []
        }
      },
    }), probeDir('corrupt-silent'))
    const row = rowsByName(rows).get('a corrupt lessons.json degrades to an empty list with .problem set')
    assert.equal(row.status, 'drift')
    assert.match(row.detail, /problem is undefined/)
  })

  it('reports every probe as drift when the store cannot be constructed', () => {
    const rows = probeStore({ LessonsStore: undefined }, probeDir('no-store'))
    assert.deepEqual(rows.map(row => row.name), PROBE_NAMES)
    assert.ok(rows.every(row => row.status === 'drift'))
  })
})

describe('resolveSiblingFile', () => {
  const packageRoot = 'D:/sibling'
  const lessonsFile = path.join(packageRoot, 'lib', 'lessons.js')

  /** Existence probe over a fixed set of paths. */
  const isFile = candidate => candidate === lessonsFile

  it('prefers SIBLING_ROOT over --sibling', () => {
    const resolved = resolveSiblingFile({ siblingRoot: 'D:/elsewhere', env: { SIBLING_ROOT: packageRoot }, isFile })
    assert.equal(resolved.file, lessonsFile)
    assert.equal(resolved.source, 'SIBLING_ROOT')
    assert.equal(resolved.explicit, true)
  })

  it('treats a blank SIBLING_ROOT as unset', () => {
    const resolved = resolveSiblingFile({ siblingRoot: packageRoot, env: { SIBLING_ROOT: '   ' }, isFile })
    assert.equal(resolved.file, lessonsFile)
    assert.equal(resolved.source, '--sibling')
  })

  it('falls back to the local sibling checkout', () => {
    const resolved = resolveSiblingFile({ env: {} })
    assert.equal(resolved.file, LOCAL_SIBLING_FILE)
    assert.equal(resolved.source, 'the local sibling checkout')
    assert.equal(resolved.explicit, false)
  })

  it('accepts the lib/lessons.js file itself', () => {
    const resolved = resolveSiblingFile({ siblingRoot: lessonsFile, env: {}, isFile })
    assert.equal(resolved.file, lessonsFile)
  })

  it('accepts the lib/ directory', () => {
    const libDir = path.join(packageRoot, 'lib')
    const resolved = resolveSiblingFile({ siblingRoot: libDir, env: {}, isFile })
    assert.equal(resolved.file, lessonsFile)
  })
})

describe('checkLessonsMirror against the real sibling bundle', () => {
  // The sibling lives in a separate checkout on this machine and is absent
  // everywhere else, including CI runners, so this integration case SKIPs
  // rather than fails when it is not there. CI gets its own copy through the
  // `lessons mirror drift (informational)` job.
  it('reports zero drift', async (t) => {
    const resolved = resolveSiblingFile({ env: {} })
    if (!existsSync(resolved.file)) {
      return t.skip(`${resolved.file} (absent: the sibling checkout is not on this machine)`)
    }
    const report = await checkLessonsMirror({ siblingFile: resolved.file })
    assert.equal(report.status, 'same', JSON.stringify(report.drift, null, 2))
    assert.equal(report.rows.length, REQUIRED_EXPORTS.length + 2 * PROBE_NAMES.length)
  })
})
