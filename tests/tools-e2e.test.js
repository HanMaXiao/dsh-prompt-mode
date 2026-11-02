/**
 * Section 8 of the migrated offline suite: the four tools end to end.
 *
 * `prompt_doc_write` renders and persists a document on a real path and returns
 * the copy-paste handoff line, `prompt_doc_audit` scores what landed, the
 * overwrite guard refuses to clobber it, and `prompt_doc_learn` folds a lesson
 * into the evolving skill. `prompt_doc_write` also resolves every data-source
 * path and skill name before it touches the disk: unresolved entries fail the
 * call unless `force: true` is passed, and the tools are the shipped
 * definitions, captured out of the same fake Cordis context the registration
 * tests use.
 *
 * The old script cited `check.mjs` as its relative data source and wrote its
 * artifacts into the workspace root. Both move: the script is deleted by this
 * migration, and `node --test` runs this file as its own process, so the fixture
 * and the document live in this file's own temporary directory.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { apply as applyHost } from '../host.js'

const testLibrary = mkdtempSync(path.join(os.tmpdir(), 'prompt-mode-tools-'))
after(() => rmSync(testLibrary, { recursive: true, force: true }))

/** The same minimal fake Cordis context the registration tests drive. */
function fakeContext() {
  const registered = { tools: [], skills: [], sections: [], effects: 0 }
  const makeCtx = () => ({
    get: name => (name === 'skills'
      ? { list: async () => [{ name: 'blender-mcp-best-practices', description: 'Blender via MCP' }] }
      : undefined),
    inject: (deps, callback) => { callback(makeCtx()) },
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

describe('tool behaviour on a live path', () => {
  let writeTool
  let auditTool
  let learnTool
  let demoDoc
  let written
  let audited
  let learned

  before(async () => {
    const host = fakeContext()
    applyHost(host.ctx, { libraryDir: testLibrary })
    writeTool = host.registered.tools.find(tool => tool.name === 'prompt_doc_write')
    auditTool = host.registered.tools.find(tool => tool.name === 'prompt_doc_audit')
    learnTool = host.registered.tools.find(tool => tool.name === 'prompt_doc_learn')

    // The data source the old script cited is gone, so the relative reference
    // resolves against a fixture written next to the document — the same
    // "a relative path resolves to the document's own directory" behaviour the
    // assertion is about.
    const source = path.join(testLibrary, 'selftest-source.md')
    writeFileSync(source, '自测数据源：prompt_doc_write 必须把相对路径解析到文档所在目录。\n', 'utf8')
    demoDoc = path.join(testLibrary, 'prompt-mode-selftest-doc.md')
    rmSync(demoDoc, { force: true })

    written = await writeTool.execute({
      path: demoDoc,
      title: '自测 Agent 提示词 — Step 1',
      appliesTo: '验证 prompt_doc_write 渲染标准文档并返回交接提示词',
      role: '你是一位自测工程师。\n\n1. 读 selftest-source.md\n2. 跑一遍自测',
      entry: 'Step 1 自测',
      skills: [{ when: '需要驱动 Blender 时', skill: 'blender-mcp-best-practices' }],
      dataSources: [{ path: 'selftest-source.md', covers: '本自测脚本' }],
      steps: [{ title: 'Step 0 · 探测', items: ['确认 selftest-source.md 可读'] }],
      constraints: [{ group: '自测', items: ['不要把自测产物留在仓库里'] }],
      acceptance: ['audit 返回 PASS'],
      firstActions: ['读 selftest-source.md'],
      closingLine: '现在跑一遍自测。',
    }, { agent: undefined, signal: undefined })

    audited = await auditTool.execute({ path: demoDoc }, { agent: undefined, signal: undefined })
    learned = learnTool.execute({ lesson: '自测：交接提示词的入口要写文档里第一个可执行步骤的名字。', category: 'handoff' }, {})
  })

  it('write reports the handoff line', () => {
    assert.equal(written.handoff, `请先读 ${demoDoc}，然后开始 Step 1 自测。`, written.handoff)
  })

  it('write resolved the relative data source', () => {
    assert.equal(written.missingPaths.length, 0, written.missingPaths.join(','))
  })

  it('write resolved the skill name', () => {
    assert.equal(written.unknownSkills.length, 0, written.unknownSkills.join(','))
  })

  it('audit scores the written document clean', () => {
    assert.equal(audited.ok, true, `${audited.score}/100`)
  })

  it('audit surfaces no missing path', () => {
    assert.equal(audited.missingPaths.length, 0)
  })

  it('write refuses to clobber an existing document', async () => {
    await assert.rejects(
      () => writeTool.execute({
        path: demoDoc, title: 'x', appliesTo: 'x', role: 'x', entry: 'x',
      }, { agent: undefined, signal: undefined }),
      /already exists/,
    )
  })

  it('learn appends and refreshes the skill', () => {
    assert.ok(learned.total >= 1 && learned.skillBytes > 0, `total=${learned.total}`)
  })

  it('learn reports the readable mirror', () => {
    assert.equal(typeof learned.mirror, 'string', String(learned.mirror))
  })
})

describe('prompt_doc_write validates before it persists', () => {
  let writeTool
  const deadSource = 'no-such-source.md'

  before(async () => {
    const host = fakeContext()
    applyHost(host.ctx, { libraryDir: testLibrary })
    writeTool = host.registered.tools.find(tool => tool.name === 'prompt_doc_write')
  })

  it('refuses to write when a data source does not resolve', async () => {
    // The target sits in a directory that does not exist yet, so asserting it
    // is still absent also proves the rejection happened before mkdirSync.
    const target = path.join(testLibrary, 'rejected', 'dead-source-doc.md')
    await assert.rejects(
      () => writeTool.execute({
        path: target,
        title: '死数据源被拒',
        appliesTo: '验证 prompt_doc_write 在落盘前拒绝未解析的数据源',
        role: '你是一位自测工程师。',
        entry: 'Step 1 被拒',
        dataSources: [{ path: deadSource, covers: '一个不存在的文件' }],
      }, { agent: undefined, signal: undefined }),
      error => {
        assert.match(error.message, /refusing to write/)
        assert.ok(error.message.includes(deadSource), `message names the dead path: ${error.message}`)
        assert.ok(error.message.includes('force: true'), `message explains the escape hatch: ${error.message}`)
        return true
      },
    )
    assert.equal(existsSync(target), false, 'the document was never written')
    assert.equal(existsSync(path.dirname(target)), false, 'the target directory was never created')
  })

  it('writes with force: true and still reports the unresolved entries', async () => {
    const target = path.join(testLibrary, 'forced-doc.md')
    rmSync(target, { force: true })

    const result = await writeTool.execute({
      path: target,
      title: 'force 逃生门',
      appliesTo: '验证 force: true 后照常落盘且如实报告未解析条目',
      role: '你是一位自测工程师。',
      entry: 'Step 1 强制落盘',
      skills: [
        { when: '需要驱动 Blender 时', skill: 'blender-mcp-best-practices' },
        { when: '一个不存在的技能', skill: 'not-a-real-skill' },
      ],
      dataSources: [{ path: deadSource, covers: '一个不存在的文件' }],
      force: true,
    }, { agent: undefined, signal: undefined })

    assert.equal(existsSync(target), true, 'the document was written')
    assert.deepEqual(result.missingPaths, [deadSource], result.missingPaths.join(','))
    assert.deepEqual(result.unknownSkills, ['not-a-real-skill'], result.unknownSkills.join(','))
    assert.equal(result.handoff, `请先读 ${target}，然后开始 Step 1 强制落盘。`)
    assert.match(result.next, /Fix missingPaths \/ unknownSkills/)
  })
})
