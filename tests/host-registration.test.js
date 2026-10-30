/**
 * Section 7 of the migrated offline suite: plugin wiring without a Harness.
 *
 * A minimal fake Cordis context proves `host.js` and `mode.js` register into the
 * real service shapes — the four tool definitions, the evolving skill, the
 * `prompt:policy` system-prompt section and its mount receipt. When this checkout
 * happens to sit beside the harness repository, the *live*
 * `@deepseek-ai/dsh-tools` registry guards the exact preconditions
 * `ToolRuntime.register` enforces; otherwise those checks SKIP, exactly as the
 * old script reported them.
 *
 * Nothing here edits the bundle's own sources: it only reads the public surface.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { apply as applyHost, contributions } from '../host.js'
import { apply as applyMode } from '../mode.js'

const testLibrary = mkdtempSync(path.join(os.tmpdir(), 'prompt-mode-host-'))
after(() => rmSync(testLibrary, { recursive: true, force: true }))

/**
 * Drive host.js/mode.js against a minimal fake Cordis context: this is what
 * proves the plugin registers into the real service shapes without a Harness.
 *
 * The context records every registration instead of storing it, so the tests can
 * inspect what would have reached the live services.
 */
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

/** Where the real tool registry lives when the harness checkout is beside this one. */
const DSH_TOOLS_CANDIDATES = [
  'D:/XiaoProject/deepseek-harness/packages/bundle/base/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
  'D:/XiaoProject/deepseek-harness/packages/bundle/web-app/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
]

describe('plugin wiring (no Harness imports)', () => {
  describe('contributions', () => {
    it('host.js exports the four tool names', () => {
      assert.equal(
        contributions.tools.join(','),
        'prompt_doc_plan,prompt_doc_write,prompt_doc_audit,prompt_doc_learn',
        contributions.tools.join(','),
      )
    })

    it('host.js exports the skill name', () => {
      assert.equal(contributions.skill, 'system-prompt-doc-best-practices', contributions.skill)
    })

    it('the standard lists seven sections and three required metadata keys', () => {
      assert.ok(
        contributions.sections.length === 7
        && contributions.metaFields.slice(0, 3).join(',') === '版本,适用任务,使用方法',
      )
    })
  })

  describe('host.js', () => {
    let host
    before(() => {
      host = fakeContext()
      applyHost(host.ctx, { libraryDir: testLibrary })
    })

    it('registers exactly the four tools', () => {
      assert.equal(host.registered.tools.length, 4, host.registered.tools.map(t => t.name).join(','))
    })

    it('every tool carries a model-facing JSON Schema', () => {
      assert.ok(host.registered.tools.every(tool => tool.parameters?.type === 'object'
        && typeof tool.description === 'string'
        && typeof tool.execute === 'function'))
    })

    describe('live tool-registry preconditions', () => {
      let realTools
      before(async () => {
        for (const candidate of DSH_TOOLS_CANDIDATES) {
          if (!existsSync(candidate)) continue
          try {
            realTools = await import(pathToFileURL(candidate).href)
            break
          }
          catch { /* try the next candidate */ }
        }
      })

      // The live registry rejects a definition whose `output` lacks `render`, and
      // it does so inside an injection fiber where the failure is silent. Guard
      // the exact preconditions `ToolRuntime.register` enforces, with the real
      // module.
      it('every tool satisfies the live registry preconditions', (t) => {
        if (realTools === undefined) return t.skip('dsh-tools not found beside this checkout')
        const problems = []
        for (const tool of host.registered.tools) {
          const output = tool.output
          if (output === undefined || typeof output !== 'object' || typeof output.render !== 'function') {
            problems.push(`${tool.name}: output.render missing`)
            continue
          }
          try {
            realTools.assertSupportedJsonSchema(output.schema)
          }
          catch (error) {
            problems.push(`${tool.name}: output.schema — ${error.message}`)
          }
          try {
            realTools.assertSupportedJsonSchema(tool.parameters)
          }
          catch (error) {
            problems.push(`${tool.name}: parameters — ${error.message}`)
          }
        }
        assert.equal(problems.length, 0, problems.join(' | '))
      })

      it('no tool claims the reserved run_code name', (t) => {
        if (realTools === undefined) return t.skip('dsh-tools not found beside this checkout')
        assert.ok(host.registered.tools.every(tool => tool.name !== realTools.RUN_CODE_NAME))
      })

      it('rendered output is a content block', (t) => {
        if (realTools === undefined) return t.skip('dsh-tools not found beside this checkout')
        assert.ok(host.registered.tools.every((tool) => {
          const blocks = tool.output.render({}, { ok: true })
          return Array.isArray(blocks) && blocks.length > 0 && blocks.every(block => typeof block?.text === 'string')
        }))
      })
    })

    it('registers the evolving skill', () => {
      assert.equal(host.registered.skills.length, 1, host.registered.skills[0]?.name)
    })

    it('the skill body carries the baseline plus the lessons section', () => {
      const content = host.registered.skills[0]?.content ?? ''
      assert.ok(content.includes('文档标准') && content.includes('已积累的经验教训'))
    })
  })

  describe('mode.js', () => {
    let preset
    before(() => {
      preset = fakeContext()
      applyMode(preset.ctx, {})
    })

    it('mode.js registers the prompt:policy section', () => {
      assert.ok(
        preset.registered.sections.length === 1 && preset.registered.sections[0].name === 'prompt:policy',
        preset.registered.sections[0]?.name,
      )
    })

    it('prompt:policy orders just after plan policy', () => {
      assert.equal(preset.registered.sections[0].order, 520, String(preset.registered.sections[0].order))
    })

    it('prompt:policy tells a new session to load the skill first', () => {
      const text = preset.registered.sections[0].text
      assert.ok(text.includes('每次新会话的第一件事') && text.includes('system-prompt-doc-best-practices'))
    })
  })

  // The preset half's receipt is the only observable proof that its row mounted:
  // `AgentPresetRegistry.activate()` swallows a failed preset mount into a
  // `logger.warn` and keeps the declaring row active, and a `dsh headless` run
  // printed nothing at all for a deliberately unresolvable preset row. Point the
  // receipt at the self-test directory so this check stays side-effect free.
  it('mode.js leaves a mount receipt naming the registered section and order', () => {
    const savedProfileDir = process.env.DSH_PROFILE_DIR
    process.env.DSH_PROFILE_DIR = testLibrary
    try {
      applyMode(fakeContext().ctx, {})
    }
    finally {
      if (savedProfileDir === undefined) delete process.env.DSH_PROFILE_DIR
      else process.env.DSH_PROFILE_DIR = savedProfileDir
    }
    const receiptFile = path.join(testLibrary, 'prompt-mode', 'preset.json')
    const receipt = existsSync(receiptFile) ? JSON.parse(readFileSync(receiptFile, 'utf8')) : {}
    assert.ok(
      receipt.section === 'prompt:policy' && receipt.order === 520 && typeof receipt.version === 'string',
      `${receipt.section}@${receipt.order} v${receipt.version}`,
    )
  })
})
