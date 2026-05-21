import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const THIS_FILE = fileURLToPath(import.meta.url)
const ROOT_DIR = path.resolve(path.dirname(THIS_FILE), '..')
const PUBLIC_DIR =
  process.env.WASM_TINYGO_RUNTIME_PACK_ROOT ?? path.join(ROOT_DIR, 'public')
const OUTPUT_DIR =
  process.env.WASM_TINYGO_RUNTIME_PACK_OUTPUT ??
  path.join(PUBLIC_DIR, 'runtime-pack')
const MANIFEST_PATH = process.env.WASM_TINYGO_RUNTIME_PACK_MANIFEST ?? ''

const normalizePath = (value) => value.split(path.sep).join('/')

const collectFiles = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)))
      continue
    }
    if (entry.isFile()) {
      files.push(entryPath)
    }
  }
  return files
}

const loadManifestEntries = async (manifestPath) => {
  const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const manifestDir = path.dirname(manifestPath)
  if (Array.isArray(raw)) {
    return raw.map((entry, index) => normalizeManifestEntry(entry, index, manifestDir))
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('runtime pack manifest must be an array or object')
  }
  const root =
    typeof raw.root === 'string' && raw.root.length > 0
      ? (path.isAbsolute(raw.root) ? raw.root : path.resolve(manifestDir, raw.root))
      : null
  const include = normalizePatterns(raw.include, 'include')
  const exclude = normalizePatterns(raw.exclude, 'exclude')
  if (Array.isArray(raw.entries) && raw.entries.length > 0) {
    return raw.entries.map((entry, index) => normalizeManifestEntry(entry, index, manifestDir))
  }
  if (!root) {
    throw new Error('runtime pack manifest root is required when entries are omitted')
  }
  const candidates = (await collectFiles(root)).map((filePath) => ({
    filePath,
    runtimePath: normalizePath(path.relative(root, filePath)),
  }))
  return candidates.filter((entry) => {
    if (!entry.runtimePath) return false
    if (include.length && !include.some((pattern) => pattern.test(entry.runtimePath))) {
      return false
    }
    if (exclude.some((pattern) => pattern.test(entry.runtimePath))) {
      return false
    }
    return true
  })
}

const normalizePatterns = (patterns, label) => {
  if (patterns === undefined || patterns === null) return []
  if (!Array.isArray(patterns)) {
    throw new Error(`runtime pack manifest ${label} must be an array`)
  }
  return patterns.map((pattern, index) => {
    if (typeof pattern !== 'string' || pattern.length === 0) {
      throw new Error(`runtime pack manifest ${label}[${index}] must be a string`)
    }
    return new RegExp(pattern)
  })
}

const normalizeManifestEntry = (entry, index, manifestDir) => {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`runtime pack manifest entry ${index} is not an object`)
  }
  const runtimePath = entry.runtimePath
  const filePath = entry.filePath ?? entry.sourcePath
  if (typeof runtimePath !== 'string' || runtimePath.length === 0) {
    throw new Error(`runtime pack manifest entry ${index} is missing runtimePath`)
  }
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error(`runtime pack manifest entry ${index} is missing filePath`)
  }
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(manifestDir, filePath)
  return {
    runtimePath,
    filePath: resolvedPath,
  }
}

const buildPack = async () => {
  const packEntries = []
  const publicAssets = []
  const toolProbePath = path.join(PUBLIC_DIR, 'tools', 'go-probe.wasm')
  try {
    await fs.access(toolProbePath)
    publicAssets.push(toolProbePath)
  } catch {}

  const emceptionDir = path.join(PUBLIC_DIR, 'vendor', 'emception')
  try {
    await fs.access(emceptionDir)
    publicAssets.push(...(await collectFiles(emceptionDir)))
  } catch {}

  const sortedAssets = (MANIFEST_PATH
    ? await loadManifestEntries(MANIFEST_PATH)
    : publicAssets.map((filePath) => ({
        filePath,
        runtimePath: normalizePath(path.relative(PUBLIC_DIR, filePath)),
      })))
    .sort((a, b) => a.runtimePath.localeCompare(b.runtimePath))

  if (!sortedAssets.length) {
    throw new Error(`no runtime assets found under ${PUBLIC_DIR}`)
  }

  let offset = 0
  const chunks = []
  for (const asset of sortedAssets) {
    const bytes = await fs.readFile(asset.filePath)
    chunks.push(bytes)
    packEntries.push({
      runtimePath: asset.runtimePath,
      offset,
      length: bytes.length,
    })
    offset += bytes.length
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  const packBinaryPath = path.join(OUTPUT_DIR, 'runtime-pack.bin')
  const packIndexPath = path.join(OUTPUT_DIR, 'runtime-pack.index.json')
  await fs.writeFile(packBinaryPath, Buffer.concat(chunks))
  await fs.writeFile(
    packIndexPath,
    JSON.stringify(
      {
        format: 'wasm-tinygo-runtime-pack-index-v1',
        fileCount: packEntries.length,
        totalBytes: offset,
        entries: packEntries,
      },
      null,
      2,
    ),
  )
  return {
    outputDir: OUTPUT_DIR,
    packIndexPath,
    packBinaryPath,
    fileCount: packEntries.length,
    totalBytes: offset,
  }
}

const result = await buildPack()
process.stdout.write(
  `built wasm-tinygo runtime pack at ${path.relative(ROOT_DIR, result.outputDir)} (${result.fileCount} files, ${result.totalBytes} bytes)\n`,
)
