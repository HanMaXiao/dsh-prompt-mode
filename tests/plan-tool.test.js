/**
 * Section 8b of the migrated offline suite: `prompt_doc_plan` executes.
 *
 * The end-to-end test covers write, audit and learn, so the one tool that runs
 * FIRST in the documented workflow — the one that grounds a document in a real
 * repository — had no execution path at all. This file drives the shipped
 * definition against a real tree built in a temporary directory, the same way
 * `tests/tools-e2e.test.js` drives the other three: through the fake Cordis
 * context the registration tests use.
 *
 * What is asserted is the envelope a caller depends on: which directory was
 * scanned, how deep the walk went, which file groups survived the filter, what
 * the walk statistics say, that the guidance names the next tool, and that the
 * skill candidates come from the live catalog rather than from the task text.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { apply as applyHost } from '../host.js'

/** The catalog a composition with the skills service mounted would answer with. */
const CATALOG = [
  {
    name: 'blender-mcp-best-practices',
    description: 'Drive a running Blender instance through the BlenderMCP add-on (JSON-over-TCP) to build and render 3D scenes.',
  },
  {
    name: 'system-prompt-doc-best-practices',
    description: '系统提示词文档的创建、自审与交接最佳实践：文档元信息、七章节标准与可复制粘贴的交接提示词。',
  },
]

/** A task that names both catalog skills in prose, the way a user writes one. */
const TASK = 'Drive Blender through the BlenderMCP add-on to rebuild the museum exhibition scene, then write the system-prompt document that hands the work to a fresh session.'

const libraryDir = mkdtempSync(path.join(os.tmpdir(), 'prompt-mode-plan-library-'))
const workspace = mkdtempSync(path.join(os.tmpdir(), 'prompt-mode-plan-work-'))
// A second real directory, so "an explicit cwd wins" has something to win over.
const elsewhere = mkdtempSync(path.join(os.tmpdir(), 'prompt-mode-plan-elsewhere-'))
after(() => {
  for (const dir of [libraryDir, workspace, elsewhere]) {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * The same minimal fake Cordis context the registration and end-to-end tests
 * drive. `catalog === null` models a composition with no skills service at all,
 * which is the degradation the tool must survive rather than throw through.
 */
function fakeContext(catalog = CATALOG) {
  const registered = { tools: [], skills: [], sections: [], effects: 0 }
  const service = catalog === null ? undefined : { list: async () => catalog }
  const makeCtx = () => ({
    get: name => (name === 'skills' ? service : undefined),
    inject: (_deps, callback) => { callback(makeCtx()) },
    effect: (callback) => { registered.effects++; return callback() },
    tools: { register: definition => { registered.tools.push(definition); return () => {} } },
    skills: { register: definition => { registered.skills.push(definition); return () => {} } },
    systemPrompt: {
      section: definition => { registered.sections.push(definition); return () => {} },
      getSectionOrder: () => 500,
    },
    logger: { warn: () => {} },
  })
  return { ctx: makeCtx(), registered }
}

/** One file per classification group the scanner knows, plus a deeper one. */
function buildWorkspace(root) {
  const files = [
    'prompts/existing-prompt.md',
    'specs/interface-spec.md',
    'plans/roadmap.md',
    'docs/fixture-guide.md',
    'refs/reference.png',
    'src/main.js',
    // Two levels down: reachable only when the walk is given the depth for it.
    'nested/one/fixture-deep.md',
  ]
  for (const relative of files) {
    const file = path.join(root, ...relative.split('/'))
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, 'plan tool fixture\n', 'utf8')
  }
}

/** The shipped `prompt_doc_plan` definition out of one applied composition. */
function planToolOf(catalog) {
  const host = fakeContext(catalog)
  applyHost(host.ctx, { libraryDir })
  return host.registered.tools.find(tool => tool.name === 'prompt_doc_plan')
}

/** An `exec` envelope carrying the session's working directory. */
const sessionExec = cwd => ({ agent: { session: { header: { cwd } } }, signal: undefined })

describe('prompt_doc_plan', () => {
  let plan
  let planWithoutCatalog
  before(() => {
    buildWorkspace(workspace)
    plan = planToolOf()
    planWithoutCatalog = planToolOf(null)
  })

  it('scans the session working directory and reports the walk statistics', async () => {
    const result = await plan.execute({ task: TASK }, sessionExec(workspace))

    assert.equal(result.cwd, path.resolve(workspace))
    assert.ok(result.scanned.visited > 0, `visited=${result.scanned.visited}`)
    assert.equal(typeof result.scanned.skipped, 'number')
    assert.equal(typeof result.scanned.truncated, 'boolean')
  })

  it('prefers an explicit cwd over the session one', async () => {
    const result = await plan.execute({ task: TASK, cwd: elsewhere }, sessionExec(workspace))

    assert.equal(result.cwd, path.resolve(elsewhere))
  })

  it('returns every group when the filter is all, each path a real file', async () => {
    const result = await plan.execute({ task: TASK, group: 'all' }, sessionExec(workspace))

    assert.deepEqual(Object.keys(result.files).sort(), ['code', 'docs', 'plans', 'prompts', 'refs', 'specs'])
    for (const [group, entries] of Object.entries(result.files)) {
      assert.ok(entries.length > 0, `${group} came back empty`)
      // The whole point of the tool: no path in the answer may be invented.
      for (const entry of entries) assert.ok(existsSync(entry.path), `${group}: ${entry.path}`)
    }
  })

  it('returns only the requested group', async () => {
    const result = await plan.execute({ task: TASK, group: 'code' }, sessionExec(workspace))

    assert.deepEqual(Object.keys(result.files), ['code'])
    assert.ok(result.files.code.length > 0, 'the code group came back empty')
  })

  it('passes the requested depth through to the walk', async () => {
    const deep = await plan.execute({ task: TASK, group: 'docs', depth: 4 }, sessionExec(workspace))
    const shallow = await plan.execute({ task: TASK, group: 'docs', depth: 1 }, sessionExec(workspace))
    const names = result => result.files.docs.map(entry => path.basename(entry.path))

    // The one-level-deep file is inside a subdirectory of the root, so depth 1
    // already reaches it; the two-level-deep one needs the extra depth.
    assert.ok(names(shallow).includes('fixture-guide.md'), names(shallow).join(','))
    assert.ok(!names(shallow).includes('fixture-deep.md'), names(shallow).join(','))
    assert.ok(names(deep).includes('fixture-deep.md'), names(deep).join(','))
  })

  it('carries guidance that names the tool to call next', async () => {
    const result = await plan.execute({ task: TASK }, sessionExec(workspace))

    assert.ok(Array.isArray(result.guidance) && result.guidance.length > 0)
    assert.ok(result.guidance.every(line => typeof line === 'string' && line.trim() !== ''))
    assert.ok(
      result.guidance.some(line => line.includes('prompt_doc_write')),
      result.guidance.join('\n'),
    )
  })

  it('ranks the live skill catalog against the task', async () => {
    const result = await plan.execute({ task: TASK }, sessionExec(workspace))

    assert.equal(result.skillCatalogSize, CATALOG.length)
    // Every candidate is a real catalog entry: none may be invented from the
    // task text, because the document's skills table cites these names.
    assert.deepEqual(
      result.skillCandidates.map(entry => entry.name).sort(),
      CATALOG.map(entry => entry.name).sort(),
      result.skillCandidates.map(entry => `${entry.name}:${entry.score}`).join(', '),
    )
    for (const entry of result.skillCandidates) {
      assert.equal(typeof entry.score, 'number')
      assert.ok(Array.isArray(entry.hits))
    }
  })

  it('still grounds the scan when the skill catalog cannot be read', async () => {
    const result = await planWithoutCatalog.execute({ task: TASK, group: 'code' }, sessionExec(workspace))

    assert.equal(result.skillCatalogSize, 0)
    assert.deepEqual(result.skillCandidates, [])
    assert.ok(result.files.code.length > 0, 'a missing catalog must not cost the scan')
  })

  it('refuses to plan without a task', async () => {
    await assert.rejects(
      () => plan.execute({ task: '   ' }, sessionExec(workspace)),
      /task must be a non-empty string/,
    )
  })

  it('refuses a working directory that does not exist', async () => {
    await assert.rejects(
      () => plan.execute({ task: TASK, cwd: path.join(workspace, 'absent-dir') }, sessionExec(workspace)),
      /working directory does not exist/,
    )
  })
})
