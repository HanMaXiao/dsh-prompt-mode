/**
 * Scan bounds as configuration: `maxEntries` and `groupCaps`.
 *
 * tests/scan.test.js pins the scanner's bounds at the unit level. This file
 * pins the same two bounds one layer up, where an operator sets them: the
 * `resolveOptions` half of host.js. A configured bound must reach
 * `prompt_doc_plan`'s walk and truncate earlier than the shipped default, an
 * absent one must leave the shipped truncation points untouched, and a
 * malformed one must fail loud at apply time instead of degrading into a
 * silently different bound. Depth is pinned here too, because the two new keys
 * must not become a second way to move it.
 *
 * Every tree is synthetic and built under `mkdtempSync`, and no assertion
 * depends on directory enumeration order, so the file holds identically on the
 * ubuntu and windows CI runners.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { apply as applyHost } from '../host.js'

const libraryDir = mkdtempSync(path.join(os.tmpdir(), 'prompt-mode-scan-config-lib-'))
const workspaces = []
after(() => {
  rmSync(libraryDir, { recursive: true, force: true })
  for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true })
})

/** The same minimal fake Cordis context the registration tests drive. */
function fakeContext() {
  const registered = { tools: [], skills: [], sections: [], effects: 0 }
  const makeCtx = () => ({
    get: name => (name === 'skills'
      ? { list: async () => [{ name: 'blender-mcp-best-practices', description: 'Blender via MCP' }] }
      : undefined),
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

/** The shipped `prompt_doc_plan` definition out of one applied composition. */
function planToolWith(config) {
  const host = fakeContext()
  applyHost(host.ctx, { libraryDir, ...config })
  return host.registered.tools.find(tool => tool.name === 'prompt_doc_plan')
}

/** An `exec` envelope carrying the session's working directory. */
const sessionExec = cwd => ({ agent: { session: { header: { cwd } } }, signal: undefined })

/** A fresh synthetic tree, removed once the file is done. */
function makeWorkspace(label) {
  const root = mkdtempSync(path.join(os.tmpdir(), `prompt-mode-scan-config-${label}-`))
  workspaces.push(root)
  return root
}

/** `count` same-shaped files under `root/dir`, all classified into one group. */
function fill(root, dir, count, extension) {
  const target = path.join(root, dir)
  mkdirSync(target, { recursive: true })
  for (let index = 0; index < count; index++) {
    writeFileSync(path.join(target, `file-${index}${extension}`), 'scan config fixture\n', 'utf8')
  }
}

/** A tree whose code and docs groups both overshoot their shipped caps. */
function fillOvershootingTree(label) {
  const workspace = makeWorkspace(label)
  fill(workspace, 'src', 130, '.js') // the shipped code cap is 120
  fill(workspace, 'docs', 90, '.md') // the shipped docs cap is 80
  return workspace
}

describe('scan bounds as configuration', () => {
  it('applies libraryDir, scanDepth, maxEntries and groupCaps in one composition', async () => {
    // Both groups overshoot their shipped caps and the tree holds far more
    // files than the configured entry budget, so every number below can only
    // come from the configured bounds.
    const workspace = fillOvershootingTree('configured')

    const plan = planToolWith({ scanDepth: 3, maxEntries: 40, groupCaps: { code: 5, docs: 6 } })
    const result = await plan.execute({ task: 'scan config fixture' }, sessionExec(workspace))

    assert.equal(result.scanned.visited, 40)
    assert.equal(result.scanned.truncated, true)
    // The caps bite long before the entry budget: at the shipped caps (120 and
    // 80) every one of the 40 visited files would have landed in a group.
    assert.ok(result.files.code.length <= 5, `code=${result.files.code.length}`)
    assert.ok(result.files.docs.length <= 6, `docs=${result.files.docs.length}`)
    assert.ok(
      result.files.code.length + result.files.docs.length < 40,
      `grouped=${result.files.code.length + result.files.docs.length}`,
    )
  })

  it('truncates each group exactly at its configured cap', async () => {
    // An entry budget the walk never reaches, so the group counts are the only
    // bound in play and the assertion is independent of enumeration order.
    const workspace = fillOvershootingTree('caps')

    const plan = planToolWith({ scanDepth: 3, maxEntries: 100000, groupCaps: { code: 5, docs: 6 } })
    const result = await plan.execute({ task: 'scan config fixture' }, sessionExec(workspace))

    assert.equal(result.files.code.length, 5, `code=${result.files.code.length}`)
    assert.equal(result.files.docs.length, 6, `docs=${result.files.docs.length}`)
    assert.equal(result.scanned.visited, 220)
    assert.equal(result.scanned.truncated, false)
  })

  it('stops the walk at a configured maxEntries and reports the truncation', async () => {
    const workspace = makeWorkspace('entries')
    fill(workspace, 'docs', 30, '.md')

    const plan = planToolWith({ scanDepth: 3, maxEntries: 4, groupCaps: { docs: 20 } })
    const result = await plan.execute({ task: 'scan config fixture' }, sessionExec(workspace))

    assert.equal(result.scanned.visited, 4)
    assert.equal(result.scanned.truncated, true)
    assert.equal(result.files.docs.length, 4)
  })

  it('keeps the shipped cap for groups the config omits', async () => {
    const workspace = fillOvershootingTree('partial')

    const plan = planToolWith({ scanDepth: 3, groupCaps: { docs: 3 } })
    const result = await plan.execute({ task: 'scan config fixture' }, sessionExec(workspace))

    assert.equal(result.files.docs.length, 3, `docs=${result.files.docs.length}`)
    assert.equal(result.files.code.length, 120, `code=${result.files.code.length}`)
  })

  it('still takes depth from scanDepth, never from the new keys', async () => {
    const workspace = makeWorkspace('depth')
    fill(workspace, 'docs', 2, '.md')
    fill(workspace, path.join('docs', 'nested'), 2, '.md')

    const shallow = planToolWith({ scanDepth: 1, maxEntries: 100, groupCaps: { docs: 50 } })
    const deep = planToolWith({ scanDepth: 2, maxEntries: 100, groupCaps: { docs: 50 } })
    const rels = result => result.files.docs.map(entry => entry.rel).sort()

    const shallowResult = await shallow.execute({ task: 'scan config fixture' }, sessionExec(workspace))
    const deepResult = await deep.execute({ task: 'scan config fixture' }, sessionExec(workspace))

    assert.deepEqual(rels(shallowResult), [
      path.join('docs', 'file-0.md'),
      path.join('docs', 'file-1.md'),
    ])
    assert.equal(rels(deepResult).filter(rel => rel.includes('nested')).length, 2)
  })
})

describe('scan bounds fail loud on malformed config', () => {
  for (const value of [0, -1, 1.5, 'x']) {
    it(`rejects maxEntries ${String(value)}`, () => {
      assert.throws(
        () => planToolWith({ maxEntries: value }),
        /config key maxEntries must be a positive integer/,
      )
    })
  }

  it('rejects an unknown groupCaps group', () => {
    assert.throws(
      () => planToolWith({ groupCaps: { images: 5 } }),
      /config key groupCaps has unknown group images/,
    )
  })

  for (const value of [0, -3, 1.5]) {
    it(`rejects groupCaps.docs ${String(value)}`, () => {
      assert.throws(
        () => planToolWith({ groupCaps: { docs: value } }),
        /config key groupCaps\.docs must be a positive integer/,
      )
    })
  }

  it('rejects a groupCaps that is not a plain object', () => {
    assert.throws(
      () => planToolWith({ groupCaps: ['docs'] }),
      /config key groupCaps must be a plain object/,
    )
    assert.throws(
      () => planToolWith({ groupCaps: 'docs: 200' }),
      /config key groupCaps must be a plain object/,
    )
  })

  it('still rejects an unknown config key, so a typo cannot pass as a bound', () => {
    assert.throws(
      () => planToolWith({ maxEntry: 10 }),
      /unknown config key\(s\) maxEntry/,
    )
  })
})

describe('shipped scan bounds with the new keys absent', () => {
  it('keeps the shipped caps, entry budget and result shape', async () => {
    const workspace = fillOvershootingTree('defaults')

    const plan = planToolWith({})
    const result = await plan.execute({ task: 'scan config fixture' }, sessionExec(workspace))

    assert.equal(result.files.code.length, 120, `code=${result.files.code.length}`)
    assert.equal(result.files.docs.length, 80, `docs=${result.files.docs.length}`)
    assert.equal(result.scanned.visited, 220)
    assert.equal(result.scanned.truncated, false)
    // The result envelope the caller reads is unchanged.
    assert.deepEqual(Object.keys(result.scanned).sort(), ['skipped', 'truncated', 'visited'])
    assert.deepEqual(Object.keys(result.files).sort(), ['code', 'docs', 'plans', 'prompts', 'refs', 'specs'])
  })
})
