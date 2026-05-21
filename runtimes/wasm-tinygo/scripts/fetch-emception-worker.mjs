import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { patchEmceptionWorkerSource } from './patch-emception-worker-source.mjs'

const emceptionWorkerUrl =
  process.env.WASM_TINYGO_EMCEPTION_WORKER_URL ?? 'https://jprendes.github.io/emception/emception.worker.bundle.worker.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputPath =
  process.env.WASM_TINYGO_EMCEPTION_OUTPUT_PATH ?? path.join(rootDir, 'public', 'vendor', 'emception', 'emception.worker.js')

let sourceText = ''
let reusedExistingWorker = false
try {
  const response = await fetch(emceptionWorkerUrl)
  if (!response.ok) {
    throw new Error(`Failed to download emception worker: ${response.status} ${response.statusText}`)
  }
  sourceText = await response.text()
} catch (error) {
  try {
    await access(outputPath)
    console.warn(
      `Reusing existing emception worker at ${path.relative(rootDir, outputPath)} because download failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    reusedExistingWorker = true
    sourceText = await readFile(outputPath, 'utf8')
  } catch {
    throw error
  }
}

const outputDir = path.dirname(outputPath)
let workerSource = sourceText
if (!reusedExistingWorker) {
  workerSource = patchEmceptionWorkerSource(sourceText)

  const banner = `/* Generated from ${emceptionWorkerUrl} by scripts/fetch-emception-worker.mjs. */\n`

  await mkdir(outputDir, { recursive: true })
  await writeFile(outputPath, `${banner}${workerSource}`)

  console.log(`Wrote ${path.relative(rootDir, outputPath)}`)
}

const assetBaseUrl = new URL('./', emceptionWorkerUrl)
const assetNames = []
const seenAssetNames = new Set()
for (const match of workerSource.matchAll(/e\.exports=t\.p\+"([^"]+)"/g)) {
  const assetName = match[1]
  if (seenAssetNames.has(assetName)) {
    continue
  }
  seenAssetNames.add(assetName)
  assetNames.push(assetName)
}

for (const assetName of assetNames) {
  const assetPath = path.join(outputDir, assetName)
  try {
    await access(assetPath)
    continue
  } catch {}
  let remoteAssetName = assetName
  if (assetName.endsWith('.brotli')) {
    remoteAssetName = `${assetName.slice(0, -'.brotli'.length)}.br`
  }
  const response = await fetch(new URL(remoteAssetName, assetBaseUrl))
  if (!response.ok) {
    throw new Error(`Failed to download emception asset ${remoteAssetName}: ${response.status} ${response.statusText}`)
  }
  const assetBytes = Buffer.from(await response.arrayBuffer())
  await mkdir(path.dirname(assetPath), { recursive: true })
  await writeFile(assetPath, assetBytes)
  console.log(`Wrote ${path.relative(rootDir, assetPath)}`)
}
