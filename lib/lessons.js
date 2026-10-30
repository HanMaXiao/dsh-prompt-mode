/**
 * Durable lesson store behind the self-iterating best-practice skill.
 *
 * Lessons are plugin-owned data, not session state: they must survive every
 * session, every project and every restart, and they must be readable
 * synchronously while a plugin registers its skill. A small JSON file under the
 * profile directory is the whole mechanism — no session event is appended, so
 * an older reader can always reopen the log.
 *
 * Both write paths that touch that file go through `writeFileAtomic`, and the
 * only mutating method is serialized, because a half-written or interleaved
 * store silently costs lessons that took real rework to earn.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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

/** Distinguishes temp files written by concurrent calls inside one process. */
let tempCounter = 0

/**
 * Replace `target` with `content` in one filesystem step.
 *
 * `writeFileSync` truncates the target before the new bytes land, so a failure
 * half-way through leaves a torn file where a complete one used to be — and a
 * torn `lessons.json` reads back as a corrupt store, which the plugin answers by
 * dropping the whole history. Writing a sibling temp file first and renaming it
 * onto the target makes the replacement indivisible: a reader sees either the
 * old content or the new one.
 *
 * The temp file must live in the target's own directory, because a rename
 * across devices fails with `EXDEV`.
 *
 * @param target Absolute path to replace.
 * @param content UTF-8 text to put there.
 * @throws When the write or the rename fails, naming `target` and the reason.
 *   The temp file is removed either way, so a failed write leaves no debris for
 *   the next reader to trip over.
 */
export function writeFileAtomic(target, content) {
  const unique = `${process.pid}-${Date.now().toString(36)}-${(tempCounter++).toString(36)}`
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${unique}.tmp`)
  try {
    writeFileSync(temp, content, 'utf8')
    renameSync(temp, target)
  }
  catch (error) {
    try {
      rmSync(temp, { force: true })
    }
    catch { /* the temp file never reached the disk */ }
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`failed to write ${target}: ${reason}`)
  }
}

/**
 * Serialize store mutations inside one process.
 *
 * `add()` reads, extends and rewrites `lessons.json`, so that whole sequence has
 * to behave as a single step: two `prompt_doc_learn` calls that interleave
 * between the read and the write both derive their id from the same lesson
 * count, and the second write silently drops the first lesson.
 *
 * A mutation runs to completion before the next one starts. The unit is
 * synchronous — it never suspends between its read and its write — so the queue
 * is idle whenever a caller arrives, and that caller runs its own unit at once
 * and gets its result back. A caller that finds the queue busy is looking at a
 * unit that yielded mid-flight; it cannot wait for a result synchronously, so
 * the call is refused instead of being allowed to race the unit that holds the
 * queue. A refused call is retried, a raced one loses a lesson for good.
 */
class MutationQueue {
  /** @param file File every unit owns, named when a call has to be refused. */
  constructor(file) {
    this.file = file
    this.inFlight = false
  }

  /**
   * @param unit Synchronous read-modify-write; it must not suspend.
   * @returns Whatever `unit` returns.
   */
  run(unit) {
    if (this.inFlight) {
      throw new Error(`another write to ${this.file} is still in flight; retry this call so no lesson is lost`)
    }
    this.inFlight = true
    try {
      return unit()
    }
    finally {
      this.inFlight = false
    }
  }
}

/**
 * Durable, append-mostly list of lessons plus a human-readable mirror.
 *
 * `add()` is the only mutator and it runs as one serialized, atomic unit;
 * `readSync()` and `writeMirror()` are read-only from the store's point of view.
 */
export class LessonsStore {
  constructor(directory) {
    this.directory = directory
    this.file = path.join(directory, 'lessons.json')
    this.mirror = path.join(directory, 'system-prompt-doc-best-practices.md')
    this.problem = undefined
    this.queue = new MutationQueue(this.file)
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

  /**
   * Append one lesson and return the stored record.
   *
   * The read, the id derivation and the rewrite run as one queued unit, so a
   * concurrent `add()` cannot observe the same lesson count and overwrite this
   * lesson's record.
   */
  add({ lesson, category, evidence, docPath }) {
    const text = String(lesson ?? '').trim()
    if (text === '') throw new Error('prompt_doc_learn needs a non-empty `lesson`')
    return this.queue.run(() => {
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
      writeFileAtomic(this.file, `${JSON.stringify({ version: 1, lessons: next }, null, 2)}\n`)
      return { record, total: next.length, file: this.file }
    })
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
