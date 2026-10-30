/**
 * Receipts: what the running process actually mounted, written to disk.
 *
 * A receipt answers "which generation of this bundle is the running process
 * using, and what did it manage to mount". That question cost the most time
 * while building this bundle, because both halves can fail invisibly:
 *
 * - The Host half registers its tools inside an injection fiber, where a throw
 *   is silent unless the plugin aggregates and reports it.
 * - The preset half is worse: `AgentPresetRegistry.activate()` catches a failed
 *   preset mount into `record.broken` and a `logger.warn`, and keeps the
 *   declaring row `active`. A `dsh headless` run prints nothing for it — a
 *   control run with a deliberately unresolvable preset row produced no output
 *   at all. So a receipt file is the only observable proof of the mount.
 *
 * Both files live beside the lesson store, so one directory answers the whole
 * question: `status.json` (Host half) and `preset.json` (preset half).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

export const PLUGIN_NAME = '@local/dsh-prompt-mode'

/**
 * The installed version, read from this package's own manifest.
 *
 * A hand-kept literal would defeat the purpose of a receipt: it reported 1.1.0
 * while the manifest already said 1.2.0.
 */
export const PLUGIN_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')).version ?? 'unknown'
  }
  catch {
    return 'unknown'
  }
})()

/**
 * Write one receipt.
 *
 * @param libraryDir Directory the receipts live in.
 * @param fileName Receipt file name, e.g. `status.json`.
 * @param fields Receipt payload, merged over the identity fields.
 * @returns The written path, or undefined when the directory is not writable.
 */
export function writeReceipt(libraryDir, fileName, fields) {
  try {
    mkdirSync(libraryDir, { recursive: true })
    const file = path.join(libraryDir, fileName)
    writeFileSync(file, `${JSON.stringify({
      at: new Date().toISOString(),
      plugin: PLUGIN_NAME,
      version: PLUGIN_VERSION,
      ...fields,
    }, null, 2)}\n`, 'utf8')
    return file
  }
  catch {
    // A read-only library directory must not stop the plugin from working.
    return undefined
  }
}
