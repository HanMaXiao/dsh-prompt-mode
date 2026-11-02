/**
 * Unit tests for scripts/verify-host.mjs: the CLI resolution order and the two
 * receipt assertions. The script itself is never executed here — it creates
 * profiles, installs packages through pnpm and calls a model — so these cover
 * only its pure decision functions, with the filesystem probe injected.
 */
import path from 'node:path'
import process from 'node:process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  KNOWN_CLI_PATH,
  assertPresetReceipt,
  assertStatusReceipt,
  freshnessProblem,
  resolveCliPath,
} from '../scripts/verify-host.mjs'

const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PKG_VERSION = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')).version

/** The executable name a PATH lookup finds on this platform. */
const PATH_CLI_NAME = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'

/** A receipt as registerTools writes it: registration order, not alphabetical. */
function statusReceipt(overrides = {}) {
  return {
    at: new Date().toISOString(),
    plugin: '@local/dsh-prompt-mode',
    version: PKG_VERSION,
    libraryDir: 'C:\\Users\\someone\\.dsh\\prompt-mode',
    scanDepth: 4,
    skill: 'system-prompt-doc-best-practices',
    tools: ['prompt_doc_plan', 'prompt_doc_write', 'prompt_doc_audit', 'prompt_doc_learn'],
    toolsFailed: [],
    ...overrides,
  }
}

describe('resolveCliPath', () => {
  it('prefers DSH_CLI over every other source', () => {
    const isFile = () => true
    assert.equal(
      resolveCliPath({ DSH_CLI: 'C:\\custom\\dsh-entry.js', PATH: 'C:\\bin' }, isFile),
      'C:\\custom\\dsh-entry.js',
    )
  })

  it('treats a blank DSH_CLI as unset', () => {
    const isFile = candidate => candidate === KNOWN_CLI_PATH
    assert.equal(resolveCliPath({ DSH_CLI: '   ', PATH: '' }, isFile), KNOWN_CLI_PATH)
  })

  it('uses the known checkout when it exists', () => {
    const isFile = candidate => candidate === KNOWN_CLI_PATH
    assert.equal(resolveCliPath({ PATH: 'C:\\bin' }, isFile), KNOWN_CLI_PATH)
  })

  // PATH entries are colon-free on purpose: a Windows-style `C:\dir` carries a
  // colon that is the POSIX path delimiter, so such a literal splits into two
  // broken segments on Linux and the test would only ever pass on Windows.
  it('falls back to dsh on PATH', () => {
    const dir = path.join('fake', 'dshbin')
    const expected = path.join(dir, PATH_CLI_NAME)
    const isFile = candidate => candidate === expected
    assert.equal(resolveCliPath({ PATH: `elsewhere${path.delimiter}${dir}` }, isFile), expected)
  })

  it('takes the first PATH directory that holds a candidate', () => {
    const first = path.join('fake', 'first')
    const second = path.join('fake', 'second')
    const isFile = candidate => candidate === path.join(first, PATH_CLI_NAME)
      || candidate === path.join(second, PATH_CLI_NAME)
    assert.equal(
      resolveCliPath({ PATH: `${first}${path.delimiter}${second}` }, isFile),
      path.join(first, PATH_CLI_NAME),
    )
  })

  it('returns undefined when no source is available', () => {
    assert.equal(resolveCliPath({ PATH: `nowhere${path.delimiter}empty` }, () => false), undefined)
    assert.equal(resolveCliPath({}, () => false), undefined)
  })
})

describe('assertStatusReceipt', () => {
  it('passes a receipt with the manifest version, the four tools and no failures', () => {
    assert.deepEqual(assertStatusReceipt(statusReceipt(), PKG_VERSION), { status: 'pass' })
  })

  it('fails when the version does not match package.json', () => {
    const verdict = assertStatusReceipt(statusReceipt({ version: '0.0.1' }), PKG_VERSION)
    assert.equal(verdict.status, 'fail')
    assert.match(verdict.reason, /0\.0\.1/)
    assert.match(verdict.reason, new RegExp(PKG_VERSION.replace(/\./g, '\\.')))
  })

  it('fails when a tool is missing', () => {
    const verdict = assertStatusReceipt(
      statusReceipt({ tools: ['prompt_doc_plan', 'prompt_doc_write', 'prompt_doc_audit'] }),
      PKG_VERSION,
    )
    assert.equal(verdict.status, 'fail')
    assert.match(verdict.reason, /prompt_doc_learn/)
  })

  it('fails when an unexpected tool is registered', () => {
    const verdict = assertStatusReceipt(
      statusReceipt({ tools: [...statusReceipt().tools, 'prompt_doc_extra'] }),
      PKG_VERSION,
    )
    assert.equal(verdict.status, 'fail')
    assert.match(verdict.reason, /prompt_doc_extra/)
  })

  it('fails when a tool failed to register', () => {
    const verdict = assertStatusReceipt(
      statusReceipt({ toolsFailed: ['prompt_doc_learn: output lacks render'] }),
      PKG_VERSION,
    )
    assert.equal(verdict.status, 'fail')
    assert.match(verdict.reason, /toolsFailed/)
  })

  it('fails when tools is not an array', () => {
    assert.equal(assertStatusReceipt(statusReceipt({ tools: 'four' }), PKG_VERSION).status, 'fail')
  })

  it('fails when the receipt is missing', () => {
    assert.equal(assertStatusReceipt(null, PKG_VERSION).status, 'fail')
  })
})

describe('assertPresetReceipt', () => {
  it('passes the second-write shape that proves the section registered', () => {
    assert.deepEqual(
      assertPresetReceipt({
        at: new Date().toISOString(),
        plugin: '@local/dsh-prompt-mode',
        version: PKG_VERSION,
        half: 'mode',
        preset: 'prompt',
        section: 'prompt:policy',
        order: 520,
        libraryDir: 'C:\\Users\\someone\\.dsh\\prompt-mode',
      }),
      { status: 'pass' },
    )
  })

  it('fails the first-write shape: the row mounted but the section never registered', () => {
    const verdict = assertPresetReceipt({
      at: new Date().toISOString(),
      plugin: '@local/dsh-prompt-mode',
      version: PKG_VERSION,
      half: 'mode',
      preset: 'prompt',
      libraryDir: 'C:\\Users\\someone\\.dsh\\prompt-mode',
    })
    assert.equal(verdict.status, 'fail')
    assert.match(verdict.reason, /first-write/)
  })

  it('fails a wrong section name', () => {
    const verdict = assertPresetReceipt({ section: 'other:policy', order: 520 })
    assert.equal(verdict.status, 'fail')
    assert.match(verdict.reason, /other:policy/)
  })

  it('fails a wrong order', () => {
    const verdict = assertPresetReceipt({ section: 'prompt:policy', order: 500 })
    assert.equal(verdict.status, 'fail')
    assert.match(verdict.reason, /500/)
  })

  it('skips when no receipt exists: this composition mounts no agentPresets service', () => {
    const verdict = assertPresetReceipt(null)
    assert.equal(verdict.status, 'skip')
    assert.match(verdict.reason, /agentPresets/)
  })

  it('fails a receipt that is not an object', () => {
    assert.equal(assertPresetReceipt('prompt:policy').status, 'fail')
  })
})

describe('freshnessProblem', () => {
  const startedAt = Date.parse('2026-11-02T05:00:00.000Z')

  it('accepts a receipt written during this run', () => {
    assert.equal(freshnessProblem({ at: '2026-11-02T05:00:01.000Z' }, startedAt), null)
  })

  it('rejects a receipt left behind by an earlier run', () => {
    const reason = freshnessProblem({ at: '2026-11-02T04:59:00.000Z' }, startedAt)
    assert.match(reason, /before this run started/)
  })

  it('rejects a receipt with no parsable timestamp', () => {
    assert.match(freshnessProblem({ at: 'not-a-date' }, startedAt), /at timestamp/)
    assert.match(freshnessProblem({}, startedAt), /at timestamp/)
  })
})
