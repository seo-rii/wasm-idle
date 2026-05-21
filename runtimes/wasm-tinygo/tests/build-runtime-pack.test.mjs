import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

const runBuildRuntimePack = async (cwd, env) =>
  await new Promise((resolve, reject) => {
    const child = spawn('node', ['scripts/build-runtime-pack.mjs'], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`build-runtime-pack exited ${code}\n${stdout}\n${stderr}`))
      }
    })
  })

test('build-runtime-pack bundles emception assets and go-probe into a pack index', async () => {
  const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-pack-'))
  const publicDir = path.join(tempDir, 'public')
  const emceptionDir = path.join(publicDir, 'vendor', 'emception')
  const toolsDir = path.join(publicDir, 'tools')
  await mkdir(emceptionDir, { recursive: true })
  await mkdir(toolsDir, { recursive: true })
  await writeFile(path.join(emceptionDir, 'emception.worker.js'), 'worker')
  await writeFile(path.join(emceptionDir, 'tool.wasm'), new Uint8Array([1, 2]))
  await writeFile(path.join(toolsDir, 'go-probe.wasm'), new Uint8Array([3, 4, 5]))

  await runBuildRuntimePack(repoRoot, {
    WASM_TINYGO_RUNTIME_PACK_ROOT: publicDir,
    WASM_TINYGO_RUNTIME_PACK_OUTPUT: path.join(publicDir, 'runtime-pack'),
  })

  const indexPath = path.join(publicDir, 'runtime-pack', 'runtime-pack.index.json')
  const packPath = path.join(publicDir, 'runtime-pack', 'runtime-pack.bin')
  const index = JSON.parse(await readFile(indexPath, 'utf8'))
  const packBytes = await readFile(packPath)

  assert.equal(index.format, 'wasm-tinygo-runtime-pack-index-v1')
  assert.equal(index.fileCount, 3)
  assert.equal(index.entries.length, 3)
  assert.equal(index.totalBytes, packBytes.length)
  assert.deepEqual(
    index.entries.map((entry) => entry.runtimePath),
    ['tools/go-probe.wasm', 'vendor/emception/emception.worker.js', 'vendor/emception/tool.wasm'],
  )
})

test('build-runtime-pack accepts a manifest-driven file list', async () => {
  const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-pack-manifest-'))
  const publicDir = path.join(tempDir, 'public')
  const assetsDir = path.join(tempDir, 'assets')
  await mkdir(publicDir, { recursive: true })
  await mkdir(assetsDir, { recursive: true })
  const firstPath = path.join(assetsDir, 'one.wasm')
  const secondPath = path.join(assetsDir, 'nested', 'two.wasm')
  await mkdir(path.dirname(secondPath), { recursive: true })
  await writeFile(firstPath, new Uint8Array([1, 2, 3, 4]))
  await writeFile(secondPath, new Uint8Array([9, 8]))

  const manifestPath = path.join(tempDir, 'runtime-pack.json')
  await writeFile(
    manifestPath,
    JSON.stringify(
      [
        { runtimePath: 'assets/one.wasm', filePath: firstPath },
        { runtimePath: 'assets/nested/two.wasm', filePath: secondPath },
      ],
      null,
      2,
    ),
  )

  await runBuildRuntimePack(repoRoot, {
    WASM_TINYGO_RUNTIME_PACK_ROOT: publicDir,
    WASM_TINYGO_RUNTIME_PACK_OUTPUT: path.join(publicDir, 'runtime-pack'),
    WASM_TINYGO_RUNTIME_PACK_MANIFEST: manifestPath,
  })

  const indexPath = path.join(publicDir, 'runtime-pack', 'runtime-pack.index.json')
  const packPath = path.join(publicDir, 'runtime-pack', 'runtime-pack.bin')
  const index = JSON.parse(await readFile(indexPath, 'utf8'))
  const packBytes = await readFile(packPath)

  assert.equal(index.fileCount, 2)
  assert.equal(index.totalBytes, packBytes.length)
  assert.deepEqual(index.entries.map((entry) => entry.runtimePath), [
    'assets/nested/two.wasm',
    'assets/one.wasm',
  ])
})

test('build-runtime-pack supports include/exclude patterns in the manifest', async () => {
  const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-pack-patterns-'))
  const rootDir = path.join(tempDir, 'assets')
  await mkdir(path.join(rootDir, 'nested'), { recursive: true })
  await writeFile(path.join(rootDir, 'keep.wasm'), new Uint8Array([1]))
  await writeFile(path.join(rootDir, 'drop.txt'), new Uint8Array([2]))
  await writeFile(path.join(rootDir, 'nested', 'skip.wasm'), new Uint8Array([3]))

  const manifestPath = path.join(tempDir, 'runtime-pack.json')
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        root: rootDir,
        include: ['\\.wasm$'],
        exclude: ['nested/'],
      },
      null,
      2,
    ),
  )

  const outputDir = path.join(tempDir, 'runtime-pack')
  await runBuildRuntimePack(repoRoot, {
    WASM_TINYGO_RUNTIME_PACK_ROOT: path.join(tempDir, 'public'),
    WASM_TINYGO_RUNTIME_PACK_OUTPUT: outputDir,
    WASM_TINYGO_RUNTIME_PACK_MANIFEST: manifestPath,
  })

  const indexPath = path.join(outputDir, 'runtime-pack.index.json')
  const index = JSON.parse(await readFile(indexPath, 'utf8'))

  assert.equal(index.fileCount, 1)
  assert.deepEqual(index.entries.map((entry) => entry.runtimePath), ['keep.wasm'])
})
