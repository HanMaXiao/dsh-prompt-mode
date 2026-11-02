/**
 * Zero-emoji guard.
 *
 * AGENTS.md states the rule plainly: zero emoji, anywhere — copy, comments,
 * commit messages, identifiers and documentation are all covered. This test
 * is the enforcement half of that sentence, so a stray glyph fails
 * `node --test` instead of shipping.
 *
 * The file list comes from `git ls-files` rather than a directory walk: on a
 * clean checkout the tracked set is self-consistent — everything the bundle
 * ships is on disk, and untracked local scratch (caches, notes, advice
 * folders) is correctly ignored — so no extension-based pruning of the walk
 * is needed beyond the text formats below.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/** Text formats the bundle ships and that a human reads: scan exactly these. */
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.md', '.json', '.yml', '.svg'])

/**
 * The banned ranges, as inclusive code-point pairs.
 *
 * U+1F000–U+1FAFF are the emoji blocks; U+2600–U+27BF (symbols and dingbats)
 * holds the check marks, crosses and warning signs; U+2B00–U+2BFF (arrows
 * and stars) holds glyphs used as icons, such as the eight-spoked asterisk;
 * U+FE0F is the variation selector that renders a bare symbol as emoji.
 */
const EMOJI_RANGES = [
  [0x1F000, 0x1FAFF],
  [0x2600, 0x27BF],
  [0x2B00, 0x2BFF],
  [0xFE0F, 0xFE0F],
]

/** Is this one code point inside a banned range? */
function isBanned(codePoint) {
  return EMOJI_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high)
}

/** Every banned character in `text`, reported as `U+XXXX` code points in order. */
function bannedCodePoints(text) {
  const hits = []
  for (const char of text) {
    const codePoint = char.codePointAt(0)
    if (isBanned(codePoint)) {
      hits.push(`U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`)
    }
  }
  return hits
}

describe('zero emoji', () => {
  it('no tracked text file carries an emoji or glyph character', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: PACKAGE_DIR, encoding: 'utf8' })
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(file => file !== '' && TEXT_EXTENSIONS.has(path.extname(file)))
    assert.ok(tracked.length > 0, 'git ls-files listed no scannable file — is this a git checkout?')
    for (const file of tracked) {
      const hits = bannedCodePoints(readFileSync(path.join(PACKAGE_DIR, file), 'utf8'))
      assert.deepEqual(hits, [], `${file} carries banned character(s): ${hits.join(' ')}`)
    }
  })
})
