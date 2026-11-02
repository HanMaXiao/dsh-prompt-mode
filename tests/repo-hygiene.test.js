/**
 * Repo hygiene guards for the two AGENTS.md rules that nothing else enforced.
 *
 * Rule sources, both from the root AGENTS.md:
 * - "Every file ends with exactly one newline" (约束 / Constraints).
 * - "This file has a byte budget: at most 8192 bytes" (改这份文件 / Editing
 *   this file). The budget exists because AGENTS.md is injected into every
 *   agent session, so every byte is a tax paid on every round.
 *
 * Before this file, neither rule had any enforcement: the newline rule was a
 * convention each contributor had to remember, and the byte budget was a
 * number you only noticed after the file had already grown past it. Both are
 * cheap to re-check on every run, so they are re-checked here.
 *
 * Why `git ls-files`: the tracked set is the set the rest of the repo is
 * written against, and a clean checkout is self-consistent. Untracked working
 * files (scratch notes under `.ai-advice/`, editor backups) must not fail the
 * run, and `git ls-files` never lists them. The trade-off is that this guard
 * needs git metadata, which is fine: the only verification command is
 * `node --test` inside a checkout.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const AGENTS_MD = path.join(PACKAGE_DIR, 'AGENTS.md')
const AGENTS_BYTE_BUDGET = 8192
const TEXT_EXTENSIONS = ['.js', '.mjs', '.md', '.json', '.yml', '.svg']

const hex = byte => (byte === undefined ? 'none' : `0x${byte.toString(16).padStart(2, '0')}`)

describe('repo hygiene', () => {
  it('every tracked text file ends with exactly one newline', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: PACKAGE_DIR, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean)

    const offenders = []
    let checked = 0
    for (const rel of tracked) {
      if (!TEXT_EXTENSIONS.some(ext => rel.endsWith(ext))) continue
      checked += 1
      const bytes = readFileSync(path.join(PACKAGE_DIR, rel))
      const last = bytes[bytes.length - 1]
      const secondToLast = bytes[bytes.length - 2]
      if (last !== 0x0a || secondToLast === 0x0a) {
        offenders.push(`${rel} ends with ${hex(secondToLast)} ${hex(last)}`)
      }
    }

    assert.ok(checked > 0, 'no tracked file matched the text extension filter; git ls-files output or the filter is wrong')
    assert.equal(
      offenders.length,
      0,
      `every file must end with exactly one newline (0x0a):\n${offenders.join('\n')}`,
    )
  })

  it('AGENTS.md stays within its byte budget', () => {
    const size = statSync(AGENTS_MD).size
    assert.ok(
      size <= AGENTS_BYTE_BUDGET,
      `AGENTS.md is ${size} bytes, over the ${AGENTS_BYTE_BUDGET}-byte budget; move rationale into .agents/notes/ and point at the README`,
    )
  })
})
