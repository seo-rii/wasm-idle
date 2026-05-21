import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { prepareTinyGoWasiProbeSource } from './prepare-tinygo-wasi-probe.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const runGo = ({ argv, cwd, env }) => {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) {
    throw new Error(`TinyGo upstream WASI probe build failed: go is not available (${result.error.message})`)
  }
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].join('').trim()
    throw new Error(
      details === ''
        ? `TinyGo upstream WASI probe build failed (exit ${result.status ?? 1})`
        : `TinyGo upstream WASI probe build failed: ${details}`,
    )
  }
}

export const buildTinyGoUpstreamProbeWasm = async () => {
  const source = await prepareTinyGoWasiProbeSource()
  const outputPath =
    process.env.WASM_TINYGO_UPSTREAM_PROBE_OUTPUT_PATH ??
    path.join(rootDir, 'public', 'tools', 'tinygo-upstream-probe.wasm')
  const manifestPath =
    process.env.WASM_TINYGO_UPSTREAM_PROBE_MANIFEST_PATH ??
    path.join(rootDir, 'public', 'tools', 'tinygo-upstream-probe.json')
  const probeAssetRoot = path.join(rootDir, 'public', 'tools', 'tinygo-upstream-probe')
  const targetDir = path.join(probeAssetRoot, 'targets')
  const runtimeSysDir = path.join(probeAssetRoot, 'src', 'runtime', 'internal', 'sys')
  const deviceArmDir = path.join(probeAssetRoot, 'src', 'device', 'arm')

  await mkdir(path.dirname(outputPath), { recursive: true })
  await mkdir(targetDir, { recursive: true })
  await mkdir(runtimeSysDir, { recursive: true })
  await mkdir(deviceArmDir, { recursive: true })

  runGo({
    argv: ['go', 'build', '-o', outputPath, './cmd/tinygo-wasi-probe'],
    cwd: source.patchedRoot,
    env: {
      ...process.env,
      CGO_ENABLED: '0',
      GOOS: 'wasip1',
      GOARCH: 'wasm',
      GOWORK: 'off',
    },
  })

  await copyFile(
    path.join(source.patchedRoot, 'targets', 'wasip1.json'),
    path.join(targetDir, 'wasip1.json'),
  )
  await copyFile(
    path.join(source.patchedRoot, 'src', 'runtime', 'internal', 'sys', 'zversion.go'),
    path.join(runtimeSysDir, 'zversion.go'),
  )
  await copyFile(
    path.join(source.patchedRoot, 'src', 'device', 'arm', 'arm.go'),
    path.join(deviceArmDir, 'arm.go'),
  )

  const wasmBytes = await readFile(outputPath)
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        sourceRef: source.sourceRef,
        sourceUrl: source.sourceUrl,
        sourceVersion: source.sourceVersion,
        patchedRoot: source.patchedRoot,
        outputPath,
        wasmBytes: wasmBytes.length,
      },
      null,
      2,
    )}\n`,
  )

  return {
    outputPath,
    manifestPath,
    targetPath: path.join(targetDir, 'wasip1.json'),
    runtimeSysPath: path.join(runtimeSysDir, 'zversion.go'),
    deviceArmPath: path.join(deviceArmDir, 'arm.go'),
    probeAssetRoot,
    patchedRoot: source.patchedRoot,
  }
}

const run = async () => {
  const result = await buildTinyGoUpstreamProbeWasm()
  console.log(`Built TinyGo upstream WASI probe at ${path.relative(rootDir, result.outputPath)}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await run()
}
