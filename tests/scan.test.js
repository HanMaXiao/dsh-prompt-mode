/**
 * Sections 4 and 5 of the migrated offline suite: the bounded workspace scan and
 * the skill ranking — the two halves of `prompt_doc_plan`'s grounding.
 *
 * The old script scanned the workspace root this plugin was developed in. That
 * path is machine-specific, so the scan falls back to this package when the
 * workspace root is absent (CI): the assertions only ask that a real tree is
 * walked and classified, which holds either way. On the development machine the
 * very same workspace root is scanned, with the same depth.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
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
