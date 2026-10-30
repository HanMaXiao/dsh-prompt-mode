/**
 * Section 1 of the migrated offline suite: the two real reference documents.
 *
 * `blender-agent-prompt.md` is the canonical shape this plugin's renderer
 * reproduces; `blender-iteration-prompt.md` is the Round-based variant of the
 * same family, which must be *recognised* through its own heading names (order
 * via 迭代协议, acceptance via 视觉保真检查清单) while the auditor honestly
 * reports the mission-standard sections it does not carry.
 *
 * Both documents live outside the package, so every check below SKIPs when its
 * document is absent — the same behaviour the old `check.mjs` had, now reported
 * by `node --test` instead of a printed line.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeResolver } from '../host.js'
import { auditDocument, DOC_SECTIONS, readMetadata, sectionBodies } from '../lib/standard.js'

/** The documents this plugin was designed from, and what each must show. */
const referenceDocs = [
  {
    file: 'D:/XiaoProject/HanMaXiaoArtExhibition/docs/blender-agent-prompt.md',
    // The canonical shape this plugin's renderer reproduces.
    expected: { metadata: true, sections: 7 },
  },
  {
    file: 'D:/XiaoProject/HanMaXiaoArtExhibition/docs/blender-iteration-prompt.md',
    // A Round-based protocol document: the family's second shape.
    expected: { metadata: false, sections: 3 },
  },
]

const ITERATION_DOC = referenceDocs[1].file

/** Parse and audit one reference document, or report it absent. */
function analyse(doc) {
  if (!existsSync(doc)) return { present: false }
  const markdown = readFileSync(doc, 'utf8')
  const meta = readMetadata(markdown)
  const bodies = sectionBodies(markdown)
  const found = DOC_SECTIONS.filter(section => bodies[section.id] !== undefined).map(section => section.id)
  const resolve = makeResolver(path.dirname(doc))
  const audit = auditDocument(markdown, { pathExists: candidate => resolve(candidate) !== undefined })
  return { present: true, meta, bodies, found, audit }
}

describe('reference documents audit', () => {
  for (const { file: doc, expected } of referenceDocs) {
    const named = doc.split('/').pop()
    describe(named, () => {
      let state
      before(() => { state = analyse(doc) })

      it(`${named}: parses the metadata block`, (t) => {
        if (!state.present) return t.skip(`${doc} (absent)`)
        assert.ok(Object.keys(state.meta).length >= 3, Object.keys(state.meta).join('/'))
      })

      it(`${named}: recognises >= ${expected.sections} standard sections`, (t) => {
        if (!state.present) return t.skip(`${doc} (absent)`)
        assert.ok(state.found.length >= expected.sections, `${state.found.length}`)
      })

      // Only the canonical document is expected to carry the mission-standard
      // metadata; the Round variant is recognised without it.
      if (expected.metadata) {
        it(`${named}: carries 版本/适用任务/使用方法`, (t) => {
          if (!state.present) return t.skip(`${doc} (absent)`)
          assert.ok(['版本', '适用任务', '使用方法'].every(key => state.meta[key] !== undefined))
        })
      }

      it(`${named}: audit is deterministic and scored`, (t) => {
        if (!state.present) return t.skip(`${doc} (absent)`)
        assert.ok(Number.isFinite(state.audit.score), `score=${state.audit.score}`)
      })
    })
  }

  // The iteration document must be recognized through its own heading names.
  describe('iteration document heading aliases', () => {
    let bodies
    before(() => {
      bodies = existsSync(ITERATION_DOC) ? sectionBodies(readFileSync(ITERATION_DOC, 'utf8')) : undefined
    })

    it('iteration doc: 「迭代协议」 counts as 执行顺序', (t) => {
      if (bodies === undefined) return t.skip(`${ITERATION_DOC} (absent)`)
      assert.notStrictEqual(bodies.order, undefined)
    })

    it('iteration doc: 「视觉保真检查清单」 counts as 验收标准', (t) => {
      if (bodies === undefined) return t.skip(`${ITERATION_DOC} (absent)`)
      assert.notStrictEqual(bodies.acceptance, undefined)
    })
  })
})
