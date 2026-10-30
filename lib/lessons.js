/**
 * Durable lesson store behind the self-iterating best-practice skill.
 *
 * Lessons are plugin-owned data, not session state: they must survive every
 * session, every project and every restart, and they must be readable
 * synchronously while a plugin registers its skill. A small JSON file under the
 * profile directory is the whole mechanism — no session event is appended, so
 * an older reader can always reopen the log.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** Categories a lesson can be filed under; the skill groups lessons by these. */
export const LESSON_CATEGORIES = [
  'anatomy',
  'skills',
  'datasource',
  'order',
  'constraint',
  'acceptance',
  'handoff',
  'tooling',
  'other',
]

/**
 * Where plugin-owned prompt-mode data lives when the config names no path.
 *
 * Measured with a diagnostic bundle: the Host process carries **no `DSH_*`
 * variable at all** — `DSH_HOME`, `DSH_PROFILE` and `DSH_PROFILE_DIR` are null
 * there, even though every shell call the Harness spawns gets them. The profile
 * and home branches below therefore stay as declarations of intent for a
 * launcher that does export them; in this profile the homedir fallback is what
 * actually runs, and it lands on the same `~/.dsh/prompt-mode` directory.
 */
export function defaultLibraryDir() {
  const env = process.env
  const home = typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== ''
    ? env.DSH_HOME.trim()
    : path.join(os.homedir(), '.dsh')
  if (typeof env.DSH_PROFILE_DIR === 'string' && env.DSH_PROFILE_DIR.trim() !== '') {
    return path.join(env.DSH_PROFILE_DIR.trim(), 'prompt-mode')
  }
  if (typeof env.DSH_PROFILE === 'string' && env.DSH_PROFILE.trim() !== '') {
    return path.join(home, 'profiles', env.DSH_PROFILE.trim(), 'prompt-mode')
  }
  return path.join(home, 'prompt-mode')
}

/** Durable, append-mostly list of lessons plus a human-readable mirror. */
export class LessonsStore {
  constructor(directory) {
    this.directory = directory
    this.file = path.join(directory, 'lessons.json')
    this.mirror = path.join(directory, 'system-prompt-doc-best-practices.md')
    this.problem = undefined
  }

  /** Read every lesson, newest last. A missing file is an empty store. */
  readSync() {
    try {
      if (!existsSync(this.file)) return []
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      return Array.isArray(parsed?.lessons) ? parsed.lessons : []
    }
    catch (error) {
      // A corrupt store must never take the plugin down: report it through the
      // skill body and the panel instead of throwing during apply().
      this.problem = error instanceof Error ? error.message : String(error)
      return []
    }
  }

  /** Append one lesson and return the stored record. */
  add({ lesson, category, evidence, docPath }) {
    const text = String(lesson ?? '').trim()
    if (text === '') throw new Error('prompt_doc_learn needs a non-empty `lesson`')
    const lessons = this.readSync()
    const record = {
      id: `L${String(lessons.length + 1).padStart(3, '0')}`,
      at: new Date().toISOString(),
      category: LESSON_CATEGORIES.includes(category) ? category : 'other',
      lesson: text,
      ...(String(evidence ?? '').trim() === '' ? {} : { evidence: String(evidence).trim() }),
      ...(String(docPath ?? '').trim() === '' ? {} : { docPath: String(docPath).trim() }),
    }
    const next = [...lessons, record]
    mkdirSync(this.directory, { recursive: true })
    writeFileSync(this.file, `${JSON.stringify({ version: 1, lessons: next }, null, 2)}\n`, 'utf8')
    return { record, total: next.length, file: this.file }
  }

  /** Mirror the composed skill body beside the store so a human can read it. */
  writeMirror(content) {
    try {
      mkdirSync(this.directory, { recursive: true })
      writeFileSync(this.mirror, content, 'utf8')
      return this.mirror
    }
    catch {
      return undefined
    }
  }
}
