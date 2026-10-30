/**
 * Bounded workspace scan behind `prompt_doc_plan`.
 *
 * The point of grounding a document in the real repository is that the agent
 * stops guessing at paths. This scanner is deliberately bounded (entry count,
 * depth, per-group cap) so it can run inside a tool call on a large monorepo
 * without turning into a full-repository crawl.
 */
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/** Directories that never hold task material worth grounding on. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'output',
  '.next', '.nuxt', '.turbo', '.cache', '.venv', 'venv', '__pycache__',
  'coverage', 'target', 'obj', 'bin', '.idea', '.vscode', '.gradle', '.mypy_cache',
  '.pytest_cache', '.ruff_cache', '.tox', 'vendor', '.parcel-cache', '.svelte-kit',
])

/** Source-code extensions worth listing as "the code this task touches". */
const CODE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.cs', '.go', '.rs',
  '.java', '.kt', '.swift', '.cpp', '.cc', '.h', '.hpp', '.c', '.rb', '.php',
  '.vue', '.svelte', '.lua', '.sh', '.ps1', '.sql', '.yml', '.yaml', '.json',
])

/** Reference-art extensions: the visual anchors a reconstruction task needs. */
const REF_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.exr', '.hdr', '.blend', '.fbx', '.glb', '.gltf'])

/** Classify one file name into the group a document would cite it under. */
export function classify(relativePath) {
  const lower = relativePath.toLowerCase()
  const base = path.basename(lower)
  const ext = path.extname(lower)
  if (CODE_EXT.has(ext) && ext !== '.json' && ext !== '.yml' && ext !== '.yaml') return 'code'
  if (REF_EXT.has(ext)) return 'refs'
  if (/(prompt|提示词|系统提示)/.test(lower)) return 'prompts'
  if (/(spec|规格|规范)/.test(base)) return 'specs'
  if (/(plan|计划|清单|roadmap|road-map|todo|任务表|排期)/.test(lower)) return 'plans'
  if (ext === '.md' || ext === '.mdx' || ext === '.txt') return 'docs'
  if (CODE_EXT.has(ext)) return 'code'
  return undefined
}

const GROUP_CAP = { prompts: 40, specs: 60, plans: 40, docs: 80, refs: 60, code: 120 }

/**
 * Walk a workspace and group the files a system-prompt document would cite.
 *
 * @param cwd Absolute root.
 * @param options `maxDepth` and `maxEntries` bound the walk.
 * @returns Groups of `{ path, rel, bytes, mtime }`, plus scan statistics.
 */
export function scanWorkspace(cwd, options = {}) {
  const root = path.resolve(cwd)
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 4
  const maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : 20000
  const groups = { prompts: [], specs: [], plans: [], docs: [], refs: [], code: [] }
  let visited = 0
  let skipped = 0
  const queue = [{ dir: root, depth: 0 }]

  while (queue.length > 0) {
    const { dir, depth } = queue.shift()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    }
    catch {
      skipped++
      continue
    }
    for (const entry of entries) {
      if (visited >= maxEntries) break
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) { skipped++; continue }
        if (depth + 1 <= maxDepth) queue.push({ dir: absolute, depth: depth + 1 })
        continue
      }
      if (!entry.isFile()) continue
      visited++
      const rel = path.relative(root, absolute)
      const group = classify(rel)
      if (group === undefined) continue
      if (groups[group].length >= GROUP_CAP[group]) continue
      let info
      try {
        info = statSync(absolute)
      }
      catch {
        continue
      }
      groups[group].push({
        path: absolute,
        rel,
        bytes: info.size,
        mtime: new Date(info.mtimeMs).toISOString().slice(0, 10),
      })
    }
    if (visited >= maxEntries) break
  }

  for (const key of Object.keys(groups)) {
    groups[key].sort((left, right) => right.mtime.localeCompare(left.mtime))
  }
  return {
    cwd: root,
    visited,
    skipped,
    truncated: visited >= maxEntries,
    groups,
  }
}
