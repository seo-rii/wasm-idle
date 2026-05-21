import { spawnSync } from 'node:child_process'
import { copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { prepareTinyGoWasiFrontendProbeSource } from './prepare-tinygo-wasi-probe.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const removeRecursive = async (targetPath, { attempts = 3 } = {}) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rm(targetPath, { recursive: true, force: true })
      return
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null
      if (code !== 'ENOTEMPTY' && code !== 'EBUSY' && code !== 'EPERM') {
        throw error
      }
      if (attempt + 1 >= attempts) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)))
    }
  }
}

const replaceDirectoryFromCopy = async (sourcePath, targetPath, copyOptions) => {
  const stagedTargetPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`
  await removeRecursive(stagedTargetPath)
  try {
    await cp(sourcePath, stagedTargetPath, copyOptions)
    await removeRecursive(targetPath)
    await rename(stagedTargetPath, targetPath)
  } catch (error) {
    await removeRecursive(stagedTargetPath).catch(() => {})
    throw error
  }
}

const runGo = ({ argv, cwd, env }) => {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) {
    throw new Error(
      `TinyGo upstream WASI frontend probe build failed: go is not available (${result.error.message})`,
    )
  }
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].join('').trim()
    throw new Error(
      details === ''
        ? `TinyGo upstream WASI frontend probe build failed (exit ${result.status ?? 1})`
        : `TinyGo upstream WASI frontend probe build failed: ${details}`,
    )
  }
}

export const buildTinyGoUpstreamFrontendProbeWasm = async () => {
  const source = await prepareTinyGoWasiFrontendProbeSource()
  const outputPath =
    process.env.WASM_TINYGO_UPSTREAM_FRONTEND_PROBE_OUTPUT_PATH ??
    path.join(rootDir, 'public', 'tools', 'tinygo-upstream-frontend-probe.wasm')
  const manifestPath =
    process.env.WASM_TINYGO_UPSTREAM_FRONTEND_PROBE_MANIFEST_PATH ??
    path.join(rootDir, 'public', 'tools', 'tinygo-upstream-frontend-probe.json')
  const probeAssetRoot = path.join(rootDir, 'public', 'tools', 'tinygo-upstream-frontend-probe')
  const gorootPath = path.join(probeAssetRoot, 'goroot')
  const targetDir = path.join(probeAssetRoot, 'targets')
  const runtimeSysDir = path.join(probeAssetRoot, 'src', 'runtime', 'internal', 'sys')
  const deviceArmDir = path.join(probeAssetRoot, 'src', 'device', 'arm')

  await mkdir(path.dirname(outputPath), { recursive: true })
  await mkdir(targetDir, { recursive: true })
  await mkdir(runtimeSysDir, { recursive: true })
  await mkdir(deviceArmDir, { recursive: true })

  runGo({
    argv: ['go', 'build', '-o', outputPath, './cmd/tinygo-wasi-frontend-probe'],
    cwd: source.patchedRoot,
    env: {
      ...process.env,
      CGO_ENABLED: '0',
      GOOS: 'wasip1',
      GOARCH: 'wasm',
      GOWORK: 'off',
    },
  })
  const bridgeWorkDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-upstream-frontend-probe-'))
  const bridgeRequestPath = path.join(bridgeWorkDir, 'tinygo-request.json')
  const bridgeManifestPath = path.join(bridgeWorkDir, 'tinygo-driver-bridge.json')
  await mkdir(bridgeWorkDir, { recursive: true })
  await writeFile(
    path.join(bridgeWorkDir, 'go.mod'),
    'module example.com/upstreamprobe\n\ngo 1.22\n',
  )
  await writeFile(
    path.join(bridgeWorkDir, 'main.go'),
    'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("upstream-probe")\n}\n',
  )
  await writeFile(
    bridgeRequestPath,
    `${JSON.stringify(
      {
        command: 'build',
        planner: 'tinygo',
        entry: path.join(bridgeWorkDir, 'main.go'),
        optimize: 'z',
        output: path.join(bridgeWorkDir, 'out.wasm'),
        panic: 'trap',
        scheduler: 'asyncify',
        target: 'wasm',
      },
      null,
      2,
    )}\n`,
  )
  const bridgeProbe = spawnSync(process.execPath, [new URL('./probe-tinygo-driver-bridge.mjs', import.meta.url).pathname], {
    cwd: rootDir,
    env: {
      ...process.env,
      WASM_TINYGO_DRIVER_BRIDGE_INCLUDE_UPSTREAM_FRONTEND_PROBE: '0',
      WASM_TINYGO_DRIVER_BRIDGE_MANIFEST_PATH: bridgeManifestPath,
      WASM_TINYGO_DRIVER_BRIDGE_REQUEST_PATH: bridgeRequestPath,
      WASM_TINYGO_DRIVER_BRIDGE_SKIP_FRONTEND_ANALYSIS: '1',
      WASM_TINYGO_DRIVER_BRIDGE_SKIP_UPSTREAM_FRONTEND_PROBE: '1',
      WASM_TINYGO_DRIVER_BRIDGE_WORK_DIR: bridgeWorkDir,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (bridgeProbe.status !== 0) {
    const details = [bridgeProbe.stdout, bridgeProbe.stderr].join('').trim()
    throw new Error(
      details === ''
        ? `TinyGo upstream frontend asset bridge probe failed (exit ${bridgeProbe.status ?? 1})`
        : `TinyGo upstream frontend asset bridge probe failed: ${details}`,
    )
  }
  const bridgeManifest = JSON.parse(await readFile(bridgeManifestPath, 'utf8'))
  const gorootPackageDir = (bridgeManifest.packageGraph ?? [])
    .map((packageInfo) => packageInfo?.dir ?? '')
    .find((packageDir) => typeof packageDir === 'string' && packageDir.includes(`${path.sep}src${path.sep}`))
  if (!gorootPackageDir) {
    throw new Error('TinyGo upstream frontend asset bridge probe did not report a cached goroot package directory')
  }
  const cachedGoroot = gorootPackageDir.slice(0, gorootPackageDir.lastIndexOf(`${path.sep}src${path.sep}`))

  await copyFile(
    path.join(source.patchedRoot, 'targets', 'wasip1.json'),
    path.join(targetDir, 'wasip1.json'),
  )
  await cp(path.join(source.patchedRoot, 'src'), path.join(probeAssetRoot, 'src'), { recursive: true })
  await replaceDirectoryFromCopy(cachedGoroot, gorootPath, { recursive: true, dereference: true })
  await removeRecursive(bridgeWorkDir)

  const wasmBytes = await readFile(outputPath)
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        sourceRef: source.sourceRef,
        sourceUrl: source.sourceUrl,
        sourceVersion: source.sourceVersion,
        patchedRoot: source.patchedRoot,
        cachedGoroot,
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
    gorootPath,
    runtimeSysPath: path.join(runtimeSysDir, 'zversion.go'),
    deviceArmPath: path.join(deviceArmDir, 'arm.go'),
    probeAssetRoot,
    patchedRoot: source.patchedRoot,
  }
}

const run = async () => {
  const result = await buildTinyGoUpstreamFrontendProbeWasm()
  console.log(`Built TinyGo upstream WASI frontend probe at ${path.relative(rootDir, result.outputPath)}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await run()
}
