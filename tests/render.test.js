/**
 * Sections 2 and 3 of the migrated offline suite: the renderer round-trip and
 * the handoff line.
 *
 * Both are pure functions of `lib/standard.js`. The only input that needs a real
 * file is the rendered document's data-source row, which now points at this test
 * file itself — the old script pointed at `check.mjs`, the file this migration
 * deletes, so the reference had to move to something that still exists.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  auditDocument,
  DOC_SECTIONS,
  handoffLine,
  META_FIELDS,
  renderDocument,
} from '../lib/standard.js'

const SELF = fileURLToPath(import.meta.url)

const spec = {
  title: 'Demo Agent 提示词 — Phase 1',
  version: 'v1',
  appliesTo: '驱动演示流程完成 Phase 1',
  role: '你是一位演示工程师。\n\n1. 读规格\n2. 交付白模',
  skills: [{ when: '扫真实仓库时', skill: 'system-prompt-doc-best-practices' }],
  dataSources: [{ path: SELF, covers: '本测试文件' }],
  steps: [{ title: 'Step 0 · 探测', items: ['确认数据源可读'] }],
  constraints: [{ group: '协议', items: ['单次调用 ≤ 4KB'] }],
  acceptance: ['审计 ≥ 90 分'],
  firstActions: ['跑 prompt_doc_plan'],
  closingLine: '现在就开始第一步。',
}
const rendered = renderDocument(spec)
const audit = auditDocument(rendered, { pathExists: candidate => existsSync(candidate) })

describe('renderer round-trip', () => {
  it('rendered document audits clean', () => {
    assert.ok(audit.ok, `score=${audit.score}`)
  })

  it('rendered document carries every standard heading', () => {
    assert.ok(DOC_SECTIONS.every(section => rendered.includes(`## ${section.canonical}`)))
  })

  it('rendered document carries every required metadata key', () => {
    assert.ok(META_FIELDS.filter(field => field.required).every(field => rendered.includes(`**${field.key}**`)))
  })

  it('rendered document ends with the bold imperative', () => {
    assert.match(rendered, /\*\*[^*]+\*\*\s*$/)
  })
})

describe('handoff line', () => {
  it('handoff matches the requested shape', () => {
    const line = handoffLine('d:\\XiaoProject\\HanMaXiaoArtExhibition\\docs\\blender-agent-prompt.md', 'Phase 1 搭建')
    assert.equal(
      line,
      '请先读 d:\\XiaoProject\\HanMaXiaoArtExhibition\\docs\\blender-agent-prompt.md，然后开始 Phase 1 搭建。',
      line,
    )
  })
})
