/**
 * Host write safety: atomic document writes and serialized lesson appends.
 *
 * This bundle owns two write paths that can destroy work. `prompt_doc_write`
 * replaces a document in place, so a torn write costs one re-render;
 * `LessonsStore.add` read-modify-writes the lesson file, where a torn or
 * interleaved write costs lessons that took real rework to earn — a corrupt
 * store reads back as an empty history.
 *
 * The three properties pinned here are the ones that keep both safe: the atomic
 * write produces exactly the bytes a plain write produced, a failed write leaves
 * no temp file behind, and overlapping appends keep every lesson.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../host.js'
import { LessonsStore, writeFileAtomic } from '../lib/lessons.js'
import { handoffLine, renderDocument } from '../lib/standard.js'

/** Run `body` inside a temp directory that is removed either way. */
async function withScratch(body) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'prompt-mode-write-'))
  try {
    await body(dir)
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * The Host tools `apply` registers, captured out of a minimal fake scope.
 *
 * The tool definitions are what the live registry receives, so exercising
 * `prompt_doc_write` this way tests the shipped object rather than a copy of its
 * logic.
 */
function registeredTools(libraryDir) {
  const tools = []
  const ctx = {
    get: name => (name === 'skills' ? { list: async () => [] } : undefined),
    inject: (_deps, callback) => callback(ctx),
    effect: callback => callback(),
    tools: { register: definition => { tools.push(definition); return () => {} } },
    skills: { register: () => () => {} },
    logger: { warn: () => {} },
  }
  apply(ctx, { libraryDir })
  return tools
}

/** Arguments that render a complete, standard-satisfying document. */
function writeArgs(target) {
  return {
    path: target,
    title: '写入安全回归文档',
    appliesTo: '验证 prompt_doc_write 的原子落盘与 lessons.json 的串行追加。',
    role: '你是一名负责验证插件写入安全的工程师，需要交付一份可执行的自测文档。',
    entry: 'Step 1 落盘验证',
    version: '2026-10-30',
    steps: [
      { title: 'Step 0 · 环境探测', items: ['确认临时目录可写', '确认库目录存在'] },
      { title: 'Step 1 · 落盘验证', items: ['调用 prompt_doc_write', '比对字节'] },
    ],
    constraints: [{ group: '写入约束', items: ['不得截断已有文档', '不得留下临时文件'] }],
    acceptance: ['node --test 全绿', '临时目录中无 .tmp 残留'],
    firstActions: ['先跑一次 prompt_doc_write', '再读回文件比对字节'],
    closingLine: '先跑测试，再提交代码。',
  }
}

/**
 * Make the next write to `target` fail without touching its content, the way
 * each platform allows: Windows refuses to rename over a read-only file, POSIX
 * refuses to create the sibling temp file in a read-only directory. The POSIX
 * branch relies on directory permissions, so it assumes the suite does not run
 * as root.
 *
 * @returns A function that restores the permissions.
 */
function blockReplacements(target) {
  if (process.platform === 'win32') {
    chmodSync(target, 0o444)
    return () => chmodSync(target, 0o644)
  }
  chmodSync(path.dirname(target), 0o500)
  return () => chmodSync(path.dirname(target), 0o755)
}

/** Temp files this bundle leaves behind are dot-prefixed and `.tmp`-suffixed. */
function tempDebris(dir) {
  return readdirSync(dir).filter(name => name.endsWith('.tmp'))
}

describe('prompt_doc_write', () => {
  it('writes exactly the bytes the plain write path produced', async () => {
    await withScratch(async (dir) => {
      const libraryDir = path.join(dir, 'library')
      const target = path.join(dir, 'prompt.md')
      const write = registeredTools(libraryDir).find(tool => tool.name === 'prompt_doc_write')
      const expected = renderDocument(writeArgs(target))

      const result = await write.execute(writeArgs(target), {})

      // The return shape the caller depends on is unchanged.
      assert.equal(result.path, target)
      assert.equal(result.replaced, false)
      assert.equal(result.bytes, Buffer.byteLength(expected, 'utf8'))
      assert.equal(result.sections.length, 7)
      assert.deepEqual(result.missingPaths, [])
      assert.deepEqual(result.unknownSkills, [])
      assert.equal(result.handoff, handoffLine(target, 'Step 1 落盘验证'))
      assert.equal(result.next, `Hand the user this line and nothing else: ${result.handoff}`)
      // Byte-for-byte the same file a `writeFileSync(target, markdown)` produced.
      const control = path.join(dir, 'control.md')
      writeFileSync(control, expected, 'utf8')
      assert.deepEqual(readFileSync(target), readFileSync(control))
    })
  })

  it('leaves no temp file behind after a successful write', async () => {
    await withScratch(async (dir) => {
      const target = path.join(dir, 'docs', 'prompt.md')
      const write = registeredTools(path.join(dir, 'library')).find(tool => tool.name === 'prompt_doc_write')

      await write.execute(writeArgs(target), {})

      assert.deepEqual(readdirSync(path.dirname(target)), ['prompt.md'])
    })
  })

  it('still refuses to overwrite without overwrite: true', async () => {
    await withScratch(async (dir) => {
      const target = path.join(dir, 'prompt.md')
      const write = registeredTools(path.join(dir, 'library')).find(tool => tool.name === 'prompt_doc_write')
      const args = writeArgs(target)
      await write.execute(args, {})
      const before = readFileSync(target, 'utf8')

      await assert.rejects(
        () => write.execute({ ...args, version: '2026-10-31' }, {}),
        error => {
          assert.ok(error.message.includes(target), `message names the file: ${error.message}`)
          assert.match(error.message, /already exists/)
          return true
        },
      )

      assert.equal(readFileSync(target, 'utf8'), before)
      assert.deepEqual(tempDebris(dir), [])
    })
  })

  it('replaces the document when overwrite is true', async () => {
    await withScratch(async (dir) => {
      const target = path.join(dir, 'prompt.md')
      const write = registeredTools(path.join(dir, 'library')).find(tool => tool.name === 'prompt_doc_write')
      await write.execute(writeArgs(target), {})

      const refreshed = { ...writeArgs(target), version: '2026-10-31', overwrite: true }
      const result = await write.execute(refreshed, {})

      assert.equal(result.replaced, true)
      assert.equal(readFileSync(target, 'utf8'), renderDocument(refreshed))
      assert.deepEqual(tempDebris(dir), [])
    })
  })

  it('leaves no temp file behind when the write fails', async () => {
    await withScratch(async (dir) => {
      // A directory where the document should be: the rename has nowhere to
      // land, which is exactly the interrupted-write case.
      const blocked = path.join(dir, 'blocked')
      mkdirSync(blocked)
      const write = registeredTools(path.join(dir, 'library')).find(tool => tool.name === 'prompt_doc_write')

      await assert.rejects(
        () => write.execute({ ...writeArgs(blocked), overwrite: true }, {}),
        error => {
          assert.ok(error.message.includes(blocked), `message names the file: ${error.message}`)
          return true
        },
      )

      assert.ok(existsSync(blocked), 'the blocked target is untouched')
      assert.deepEqual(tempDebris(dir), [])
    })
  })
  it('leaves the previous document intact when the write fails', async () => {
    await withScratch(async (dir) => {
      const target = path.join(dir, 'prompt.md')
      const write = registeredTools(path.join(dir, 'library')).find(tool => tool.name === 'prompt_doc_write')
      const args = writeArgs(target)
      await write.execute(args, {})
      const before = readFileSync(target, 'utf8')
      const unlock = blockReplacements(target)
      try {
        await assert.rejects(
          () => write.execute({ ...args, version: '2026-10-31', overwrite: true }, {}),
          error => error.message.includes(target),
        )

        assert.equal(readFileSync(target, 'utf8'), before, 'the rendered document was never truncated')
        assert.deepEqual(tempDebris(dir), [])
      }
      finally {
        unlock()
      }
    })
  })
})

describe('writeFileAtomic', () => {
  it('replaces the target in one step and consumes the temp file', async () => {
    await withScratch((dir) => {
      const target = path.join(dir, 'doc.md')
      writeFileAtomic(target, 'first generation')
      writeFileAtomic(target, 'second generation')

      assert.equal(readFileSync(target, 'utf8'), 'second generation')
      assert.deepEqual(readdirSync(dir), ['doc.md'])
    })
  })

  it('leaves no temp file behind when the rename fails', async () => {
    await withScratch((dir) => {
      const blocked = path.join(dir, 'blocked')
      mkdirSync(blocked)

      assert.throws(() => writeFileAtomic(blocked, 'content'), /failed to write/)

      assert.deepEqual(tempDebris(dir), [])
      assert.deepEqual(readdirSync(dir), ['blocked'])
    })
  })

  it('leaves no temp file behind when the temp write itself fails', async () => {
    await withScratch((dir) => {
      const notADir = path.join(dir, 'not-a-dir.md')
      writeFileSync(notADir, 'plain file', 'utf8')

      assert.throws(
        () => writeFileAtomic(path.join(notADir, 'child.md'), 'content'),
        error => error.message.includes(path.join(notADir, 'child.md')),
      )

      assert.deepEqual(readdirSync(dir), ['not-a-dir.md'])
    })
  })

  it('keeps the previous content when the write fails', async () => {
    await withScratch((dir) => {
      const target = path.join(dir, 'doc.md')
      writeFileSync(target, 'previous generation', 'utf8')
      const unlock = blockReplacements(target)
      try {
        assert.throws(() => writeFileAtomic(target, 'next generation'), /failed to write/)

        assert.equal(readFileSync(target, 'utf8'), 'previous generation')
        assert.deepEqual(readdirSync(dir), ['doc.md'])
      }
      finally {
        unlock()
      }
    })
  })
})

describe('LessonsStore.add', () => {
  it('keeps every lesson when appends overlap', async () => {
    await withScratch(async (dir) => {
      const store = new LessonsStore(dir)
      const lessons = Array.from({ length: 12 }, (_, index) => `lesson ${index + 1}`)

      // Every call yields first, so the appends are issued from separate tasks
      // rather than one after another in a single statement.
      const results = await Promise.all(lessons.map((lesson, index) =>
        Promise.resolve().then(() => store.add({ lesson, category: 'tooling', evidence: `run ${index + 1}` }))))

      const stored = store.readSync()
      assert.equal(results.length, lessons.length)
      assert.equal(stored.length, lessons.length, 'no lesson was overwritten by a concurrent append')
      assert.deepEqual(stored.map(entry => entry.lesson), lessons)
      assert.deepEqual(results.map(entry => entry.record.id), lessons.map((_, index) => `L${String(index + 1).padStart(3, '0')}`))
      assert.equal(new Set(results.map(entry => entry.record.id)).size, lessons.length)
      assert.equal(JSON.parse(readFileSync(store.file, 'utf8')).lessons.length, lessons.length)
    })
  })

  it('keeps numbering lessons that were recorded before', async () => {
    await withScratch(async (dir) => {
      const store = new LessonsStore(dir)
      store.add({ lesson: 'earlier lesson', category: 'datasource' })

      const results = await Promise.all([0, 1, 2, 3].map(index =>
        Promise.resolve().then(() => store.add({ lesson: `later lesson ${index}`, category: 'order' }))))

      assert.deepEqual(results.map(entry => entry.record.id), ['L002', 'L003', 'L004', 'L005'])
      assert.deepEqual(store.readSync().map(entry => entry.id), ['L001', 'L002', 'L003', 'L004', 'L005'])
    })
  })

  it('keeps the lessons.json format', async () => {
    await withScratch((dir) => {
      const store = new LessonsStore(dir)
      store.add({ lesson: 'formatted lesson', category: 'handoff', evidence: 'a real failure', docPath: 'd:/proj/docs/doc.md' })

      const raw = readFileSync(store.file, 'utf8')
      assert.equal(raw, `${JSON.stringify({ version: 1, lessons: store.readSync() }, null, 2)}\n`)
      const parsed = JSON.parse(raw)
      assert.equal(parsed.version, 1)
      assert.deepEqual(Object.keys(parsed.lessons[0]), ['id', 'at', 'category', 'lesson', 'evidence', 'docPath'])
      assert.equal(parsed.lessons[0].category, 'handoff')
    })
  })

  it('keeps the recorded lessons when a later write fails', async () => {
    await withScratch((dir) => {
      const store = new LessonsStore(dir)
      store.add({ lesson: 'durable lesson', category: 'constraint' })
      const before = readFileSync(store.file, 'utf8')
      const unlock = blockReplacements(store.file)
      try {
        assert.throws(() => store.add({ lesson: 'lesson that cannot land', category: 'other' }), /failed to write/)

        assert.equal(readFileSync(store.file, 'utf8'), before)
        assert.deepEqual(tempDebris(dir), [])
      }
      finally {
        unlock()
      }
    })
  })

  it('leaves no temp file behind when the store file cannot be replaced', async () => {
    await withScratch((dir) => {
      const store = new LessonsStore(dir)
      store.add({ lesson: 'first lesson', category: 'other' })
      rmSync(store.file)
      mkdirSync(store.file)

      assert.throws(() => store.add({ lesson: 'second lesson', category: 'other' }), /failed to write/)

      assert.deepEqual(tempDebris(dir), [])
    })
  })
})
