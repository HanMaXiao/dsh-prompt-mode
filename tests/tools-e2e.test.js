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
 *
 * `prompt_doc_audit` also takes an optional `paths` array: every listed document
 * goes through the single-path logic (its own directory resolves its relative
 * paths, its own skill names are checked) and the call answers with a
 * per-document summary instead of the single-document shape, while a missing
 * document becomes a failed row rather than an error.
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

describe('prompt_doc_audit audits several documents in one call', () => {
  let auditTool
  let writeTool
  let batchDir
  let passDoc
  let deadDoc
  let junkDoc
  let batch

  before(async () => {
    batchDir = mkdtempSync(path.join(os.tmpdir(), 'prompt-mode-audit-batch-'))
    const host = fakeContext()
    applyHost(host.ctx, { libraryDir: testLibrary })
    auditTool = host.registered.tools.find(tool => tool.name === 'prompt_doc_audit')
    writeTool = host.registered.tools.find(tool => tool.name === 'prompt_doc_write')

    // The passing document's data source sits next to it, so its row proves
    // each document is resolved against its own directory.
    const source = path.join(batchDir, 'batch-source.md')
    writeFileSync(source, '批量自测数据源：prompt_doc_audit 必须逐文档解析相对路径。\n', 'utf8')
    passDoc = path.join(batchDir, 'batch-pass-doc.md')
    rmSync(passDoc, { force: true })
    await writeTool.execute({
      path: passDoc,
      title: '批量自测 Agent 提示词',
      appliesTo: '验证 prompt_doc_audit 一次审计多个文档',
      role: '你是一位自测工程师。',
      entry: 'Step 1 批量自测',
      skills: [{ when: '需要驱动 Blender 时', skill: 'blender-mcp-best-practices' }],
      dataSources: [{ path: 'batch-source.md', covers: '本批量自测' }],
      steps: [{ title: 'Step 0 · 探测', items: ['确认 batch-source.md 可读'] }],
      constraints: [{ group: '自测', items: ['不要把自测产物留在仓库里'] }],
      acceptance: ['audit 返回 PASS'],
      firstActions: ['读 batch-source.md'],
      closingLine: '现在跑一遍批量自测。',
    }, { agent: undefined, signal: undefined })

    deadDoc = path.join(batchDir, 'batch-dead-doc.md')
    junkDoc = path.join(batchDir, 'batch-junk-doc.md')
    writeFileSync(junkDoc, '# 占位文档\n\n没有任何标准章节。\n', 'utf8')

    batch = await auditTool.execute({
      path: passDoc,
      paths: [passDoc, deadDoc, junkDoc],
    }, { agent: undefined, signal: undefined })
  })

  after(() => rmSync(batchDir, { recursive: true, force: true }))

  it('summarizes the whole run', () => {
    assert.equal(batch.summary.total, 3)
    assert.equal(batch.summary.passed, 1)
    assert.equal(batch.summary.failed, 2)
    assert.equal(batch.summary.averageScore, Math.round((batch.documents[0].score + batch.documents[1].score + batch.documents[2].score) / 3))
  })

  it('reports every document with its own outcome', () => {
    assert.deepEqual(batch.documents.map(doc => doc.path), [passDoc, deadDoc, junkDoc])
    assert.deepEqual(batch.documents.map(doc => Object.keys(doc)), [
      ['path', 'ok', 'score', 'missingPaths', 'unknownSkills'],
      ['path', 'ok', 'score', 'missingPaths', 'unknownSkills'],
      ['path', 'ok', 'score', 'missingPaths', 'unknownSkills'],
    ])
    assert.equal(batch.documents[0].ok, true)
    assert.equal(batch.documents[0].score, 100)
    assert.deepEqual(batch.documents[0].missingPaths, [])
    assert.deepEqual(batch.documents[0].unknownSkills, [])
  })

  it('counts a missing document as a failed row instead of throwing', () => {
    const dead = batch.documents[1]
    assert.equal(dead.ok, false)
    assert.equal(dead.score, 0)
    assert.deepEqual(dead.missingPaths, [deadDoc], dead.missingPaths.join(','))
    assert.deepEqual(dead.unknownSkills, [])
  })

  it('fails a document whose failures are structural, not path or skill related', () => {
    const junk = batch.documents[2]
    assert.equal(junk.ok, false)
    assert.deepEqual(junk.missingPaths, [])
    assert.deepEqual(junk.unknownSkills, [])
  })

  it('renders one row per document plus the first failure', () => {
    const body = auditTool.output.render({}, batch)[0].text
    assert.match(body, /^audited 3 document\(s\): 1 passed, 2 failed, average score \d+\/100/m)
    assert.ok(body.includes(`${passDoc}  100/100  PASS  0 problem(s)`), body)
    assert.ok(body.includes(`${deadDoc}  0/100  FAIL  1 problem(s)`), body)
    assert.ok(body.includes(`${junkDoc}  0/100  FAIL  0 problem(s)`), body)
    assert.ok(body.includes(`first failed document: ${deadDoc}`), body)
    assert.ok(body.includes(`- path does not resolve: ${deadDoc}`), body)
  })

  it('renders the structural-failure hint when no path or skill is unresolved', async () => {
    const result = await auditTool.execute({
      path: junkDoc,
      paths: [junkDoc],
    }, { agent: undefined, signal: undefined })
    const body = auditTool.output.render({}, result)[0].text
    assert.ok(body.includes(`first failed document: ${junkDoc}`), body)
    assert.ok(body.includes(`- no unresolved path or skill name; audit ${junkDoc} alone for the failing checks`), body)
  })

  it('presents a batch card with the counts and the failed list', () => {
    const card = auditTool.presentResult({}, { value: batch })
    assert.equal(card.card, 'generic')
    assert.equal(card.title, '审计 3 份文档：1 通过 / 2 失败')
    const body = card.content[0].text
    assert.match(body, /平均分 \d+\/100/)
    assert.ok(body.includes(`- ${deadDoc}（0/100）`), body)
    assert.ok(body.includes(`- ${junkDoc}（0/100）`), body)
  })

  it('keeps the single-document shape when paths is omitted', async () => {
    const single = await auditTool.execute({ path: passDoc }, { agent: undefined, signal: undefined })
    assert.equal(single.documents, undefined)
    assert.equal(single.summary, undefined)
    assert.equal(single.path, passDoc)
    assert.equal(single.ok, true)
    assert.equal(single.score, 100)
    assert.equal(typeof single.bytes, 'number')
    assert.ok(Array.isArray(single.checks) && single.checks.length > 0)
    assert.equal(typeof single.referencedPaths, 'number')
    const body = auditTool.output.render({}, single)[0].text
    assert.ok(body.startsWith(`${passDoc}: 100/100 PASS (`), body)
    assert.ok(body.includes('WARN 可选元信息'), body)
    assert.ok(!body.includes('document(s):'), 'the batch summary never renders for a single document')
  })

  it('keeps the single-document shape when paths is an empty array', async () => {
    const single = await auditTool.execute({ path: passDoc, paths: [] }, { agent: undefined, signal: undefined })
    assert.equal(single.documents, undefined)
    assert.equal(single.summary, undefined)
    assert.equal(single.ok, true)
    assert.equal(single.score, 100)
  })

  it('still throws for a missing document on the single-path call', async () => {
    await assert.rejects(
      () => auditTool.execute({ path: deadDoc, paths: [] }, { agent: undefined, signal: undefined }),
      /document not found/,
    )
  })
})
