import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ConsoleStdout, Directory, File, OpenFile, PreopenDirectory, WASI, WASIProcExit } from '@bjorn3/browser_wasi_shim'

import { buildTinyGoUpstreamProbeWasm } from '../scripts/build-tinygo-upstream-probe.mjs'
import { prepareTinyGoWasiProbeSource } from '../scripts/prepare-tinygo-wasi-probe.mjs'

const textEncoder = new TextEncoder()

const buildDirectoryContents = (entries) => {
  const root = new Map()
  for (const [entryPath, contents] of Object.entries(entries)) {
    const parts = entryPath.split('/')
    let currentDirectory = root
    for (const [index, part] of parts.entries()) {
      if (index === parts.length - 1) {
        currentDirectory.set(part, new File(textEncoder.encode(contents)))
        continue
      }
      const existing = currentDirectory.get(part)
      if (existing instanceof Directory) {
        currentDirectory = existing.contents
        continue
      }
      const directory = new Directory(new Map())
      currentDirectory.set(part, directory)
      currentDirectory = directory.contents
    }
  }
  return root
}

test('build-tinygo-upstream-probe builds and runs a patched upstream TinyGo WASI probe', async () => {
  const result = await buildTinyGoUpstreamProbeWasm()
  const [wasmBytes, targetJson, runtimeSysSource, deviceArmSource] = await Promise.all([
    readFile(result.outputPath),
    readFile(result.targetPath, 'utf8'),
    readFile(result.runtimeSysPath, 'utf8'),
    readFile(result.deviceArmPath, 'utf8'),
  ])

  assert.equal(wasmBytes[0], 0x00)
  assert.equal(wasmBytes[1], 0x61)
  assert.equal(wasmBytes[2], 0x73)
  assert.equal(wasmBytes[3], 0x6d)

  const stdoutLines = []
  const stderrLines = []
  const tinygoRoot = new PreopenDirectory('/tinygo-root', buildDirectoryContents({
    'targets/wasip1.json': targetJson,
    'src/runtime/internal/sys/zversion.go': runtimeSysSource,
    'src/device/arm/arm.go': deviceArmSource,
  }))
  const stdout = ConsoleStdout.lineBuffered((line) => stdoutLines.push(line))
  const stderr = ConsoleStdout.lineBuffered((line) => stderrLines.push(line))
  const wasi = new WASI(
    ['tinygo-upstream-probe'],
    ['TINYGOROOT=/tinygo-root', 'TINYGO_WASI_TARGET=wasip1'],
    [new OpenFile(new File([])), stdout, stderr, tinygoRoot],
  )

  const { instance } = await WebAssembly.instantiate(wasmBytes, {
    wasi_snapshot_preview1: wasi.wasiImport,
  })

  let exitCode = 0
  try {
    exitCode = wasi.start(instance)
  } catch (error) {
    if (error instanceof WASIProcExit) {
      exitCode = error.code
    } else {
      throw error
    }
  }

  assert.equal(exitCode, 0)
  assert.deepEqual(stderrLines, [])

  const payload = JSON.parse(stdoutLines.join('\n'))
  assert.equal(payload.requestedTarget, 'wasip1')
  assert.equal(payload.resolvedGoos, 'wasip1')
  assert.equal(payload.resolvedGoarch, 'wasm')
  assert.equal(payload.triple, 'wasm32-unknown-wasi')
  assert.equal(payload.gc, 'precise')
  assert.equal(payload.scheduler, 'asyncify')
  assert.equal(payload.linker, 'wasm-ld')
  assert.deepEqual(payload.buildTags.includes('tinygo.wasm'), true)
  assert.deepEqual(payload.buildTags.includes('tinygo'), true)
  assert.deepEqual(payload.buildTags.includes('purego'), true)
  assert.deepEqual(payload.buildTags.includes('gc.precise'), true)
  assert.deepEqual(payload.buildTags.includes('scheduler.asyncify'), true)
})

test('prepareTinyGoWasiProbeSource refreshes a stale cache directory with nested target assets', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-wasi-probe-cache-'))
  const cacheDir = path.join(tempDir, 'tinygo-src-wasi-probe')
  const previousCacheDir = process.env.WASM_TINYGO_WASI_PROBE_SOURCE_ROOT
  process.env.WASM_TINYGO_WASI_PROBE_SOURCE_ROOT = cacheDir
  t.after(async () => {
    if (previousCacheDir === undefined) {
      delete process.env.WASM_TINYGO_WASI_PROBE_SOURCE_ROOT
    } else {
      process.env.WASM_TINYGO_WASI_PROBE_SOURCE_ROOT = previousCacheDir
    }
    await rm(tempDir, { recursive: true, force: true })
  })

  const first = await prepareTinyGoWasiProbeSource()
  await writeFile(path.join(cacheDir, 'targets', 'stale.txt'), 'stale\n')

  const second = await prepareTinyGoWasiProbeSource()
  const commandSource = await readFile(path.join(cacheDir, 'cmd', 'tinygo-wasi-probe', 'main.go'), 'utf8')

  assert.equal(first.patchedRoot, cacheDir)
  assert.equal(second.patchedRoot, cacheDir)
  await assert.rejects(access(path.join(cacheDir, 'targets', 'stale.txt')))
  assert.match(commandSource, /func main\(\)/)
})
