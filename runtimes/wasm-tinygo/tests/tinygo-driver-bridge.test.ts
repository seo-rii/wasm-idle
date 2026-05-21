import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  normalizeTinyGoDriverBridgeManifestForBrowser,
  verifyTinyGoHostProbeManifestAgainstDriverMetadata,
} from '../src/compile-unit.ts'
import { resolveTinyGoToolchainPaths, toolchainIsReady } from '../scripts/tinygo-toolchain-paths.mjs'

let tinyGoToolchainReadyPromise: Promise<void> | null = null

const ensureTinyGoToolchainReady = async () => {
  if (tinyGoToolchainReadyPromise) {
    return tinyGoToolchainReadyPromise
  }
  tinyGoToolchainReadyPromise = (async () => {
    const paths = resolveTinyGoToolchainPaths()
    if (await toolchainIsReady(paths)) {
      return
    }
    const cwd = new URL('..', import.meta.url).pathname
    const fetchScriptPath = new URL('../scripts/fetch-tinygo-toolchain.mjs', import.meta.url).pathname
    const child = spawn(process.execPath, [fetchScriptPath], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })

    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    assert.equal(exitCode, 0, output)
  })()
  return tinyGoToolchainReadyPromise
}

test('real TinyGo host probe matches native driver metadata for the same request', async (t) => {
  await ensureTinyGoToolchainReady()
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-driver-bridge-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const workspaceDir = path.join(tempDir, 'workspace')
  await mkdir(workspaceDir, { recursive: true })
  const entryPath = path.join(workspaceDir, 'main.go')
  const outputPath = path.join(workspaceDir, 'out.wasm')
  const requestPath = path.join(workspaceDir, 'tinygo-request.json')
  const resultPath = path.join(workspaceDir, 'tinygo-result.json')
  const manifestPath = path.join(workspaceDir, 'tinygo-host-probe.json')

  await writeFile(entryPath, `package main

import "fmt"

func main() {
	fmt.Println("bridge-ok")
}
`)
  await writeFile(requestPath, JSON.stringify({
    command: 'build',
    expectedRuntimeLogs: ['stdout bridge-ok'],
    planner: 'tinygo',
    entry: entryPath,
    optimize: 'z',
    output: outputPath,
    panic: 'trap',
    target: 'wasip1',
  }))

  const cwd = new URL('..', import.meta.url).pathname
  const driver = spawn('go', ['run', './cmd/go-probe'], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_REQUEST_PATH: requestPath,
      WASM_TINYGO_RESULT_PATH: resultPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let driverOutput = ''
  driver.stdout.on('data', (chunk) => {
    driverOutput += chunk.toString()
  })
  driver.stderr.on('data', (chunk) => {
    driverOutput += chunk.toString()
  })

  const driverExitCode = await new Promise<number>((resolve, reject) => {
    driver.once('error', reject)
    driver.once('close', resolve)
  })

  assert.equal(driverExitCode, 0, driverOutput)

  const probe = spawn(process.execPath, [new URL('../scripts/probe-tinygo-host.mjs', import.meta.url).pathname], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_HOST_PROBE_REQUEST_PATH: requestPath,
      WASM_TINYGO_HOST_PROBE_MANIFEST_PATH: manifestPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let probeOutput = ''
  probe.stdout.on('data', (chunk) => {
    probeOutput += chunk.toString()
  })
  probe.stderr.on('data', (chunk) => {
    probeOutput += chunk.toString()
  })

  const probeExitCode = await new Promise<number>((resolve, reject) => {
    probe.once('error', reject)
    probe.once('close', resolve)
  })

  assert.equal(probeExitCode, 0, probeOutput)

  const driverResult = JSON.parse(await readFile(resultPath, 'utf8'))
  const hostProbeManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const verification = verifyTinyGoHostProbeManifestAgainstDriverMetadata(hostProbeManifest, {
    buildTags: driverResult.metadata.buildTags,
    entry: entryPath,
    gc: driverResult.metadata.gc,
    goarch: driverResult.metadata.goarch,
    goos: driverResult.metadata.goos,
    llvmTarget: driverResult.metadata.llvmTarget,
    optimize: driverResult.metadata.optimize,
    output: outputPath,
    panicStrategy: driverResult.metadata.panicStrategy,
    scheduler: driverResult.metadata.scheduler,
    target: 'wasip1',
  })

  assert.equal(verification.target, 'wasip1')
  assert.equal(hostProbeManifest.runtime.executed, true)
  assert.deepEqual(hostProbeManifest.runtime.logs, ['stdout bridge-ok'])
})

test('real TinyGo driver bridge records synthetic frontend handoff facts for the same entry package', async (t) => {
  await ensureTinyGoToolchainReady()
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-driver-bridge-script-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const cwd = new URL('..', import.meta.url).pathname
  const bridgeManifestPath = path.join(tempDir, 'tinygo-driver-bridge.json')
  const bridge = spawn(process.execPath, [new URL('../scripts/probe-tinygo-driver-bridge.mjs', import.meta.url).pathname], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_DRIVER_BRIDGE_MANIFEST_PATH: bridgeManifestPath,
      WASM_TINYGO_DRIVER_BRIDGE_WORK_DIR: tempDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let bridgeOutput = ''
  bridge.stdout.on('data', (chunk) => {
    bridgeOutput += chunk.toString()
  })
  bridge.stderr.on('data', (chunk) => {
    bridgeOutput += chunk.toString()
  })

  const bridgeExitCode = await new Promise<number>((resolve, reject) => {
    bridge.once('error', reject)
    bridge.once('close', resolve)
  })

  assert.equal(bridgeExitCode, 0, bridgeOutput)
  const bridgeManifest = JSON.parse(await readFile(bridgeManifestPath, 'utf8'))
  assert.equal(bridgeManifest.target, 'wasip1')
  assert.equal(bridgeManifest.entryPackage.importPath, 'example.com/wasm-tinygo/hostprobe')
  assert.equal(bridgeManifest.frontendHandoff.target, 'wasip1')
  assert.equal(bridgeManifest.frontendHandoff.llvmTarget, 'wasm32-unknown-wasi')
  assert.equal(bridgeManifest.frontendHandoff.programPackageName, 'main')
  assert.equal(bridgeManifest.frontendHandoff.programPackageDir, tempDir)
  assert.deepEqual(bridgeManifest.frontendHandoff.programFiles, [path.join(tempDir, 'main.go')])
  assert.equal(bridgeManifest.frontendHandoff.programImportPath, 'example.com/wasm-tinygo/hostprobe')
  assert.equal(bridgeManifest.frontendHandoff.programImportAlias, 'direct')
  assert.equal(bridgeManifest.frontendHandoff.bridgeEntryImportPath, 'example.com/wasm-tinygo/hostprobe')
  assert.deepEqual(bridgeManifest.frontendHandoff.bridgeEntryGoFiles, [path.join(tempDir, 'main.go')])
  assert.deepEqual(bridgeManifest.frontendHandoff.bridgeEntryImports, ['fmt'])
  assert.equal(bridgeManifest.frontendAnalysis, undefined)
  assert.equal(bridgeManifest.frontendRealAdapter.entryFile, path.join(tempDir, 'main.go'))
  assert.equal(bridgeManifest.frontendRealAdapter.toolchain.target, 'wasip1')
  assert.equal(bridgeManifest.frontendRealAdapter.toolchain.llvmTarget, 'wasm32-unknown-wasi')
  assert.equal(bridgeManifest.frontendRealAdapter.compileUnitManifestPath, '/working/tinygo-compile-unit.json')
  assert.equal(bridgeManifest.frontendRealAdapter.compileGroups.length, 4)
  assert.equal(bridgeManifest.frontendRealAdapter.buildContext.target, bridgeManifest.target)
  assert.equal(bridgeManifest.frontendRealAdapter.buildContext.goos, bridgeManifest.goos)
  assert.equal(bridgeManifest.frontendRealAdapter.buildContext.goarch, bridgeManifest.goarch)
  assert.equal(bridgeManifest.frontendRealAdapter.buildContext.gc, bridgeManifest.gc)
  assert.equal(bridgeManifest.frontendRealAdapter.buildContext.scheduler, bridgeManifest.scheduler)
  assert.equal(bridgeManifest.frontendRealAdapter.packageGraph.length, bridgeManifest.frontendRealAdapter.compileUnits.length)
  assert.deepEqual(bridgeManifest.realFrontendAnalysis, bridgeManifest.frontendRealAdapter)
  assert.equal(bridgeManifest.hostArtifact?.target, 'wasip1')
  assert.equal(bridgeManifest.hostArtifact?.artifactKind, 'execution')
  assert.equal(bridgeManifest.hostArtifact?.runnable, true)
  assert.equal((bridgeManifest.hostArtifact?.bytesBase64?.length ?? 0) > 0, true)
  assert.equal(bridgeManifest.frontendHandoff.compileUnitCount, 6)
  assert.equal(bridgeManifest.frontendHandoff.graphPackageCount, 41)
  assert.equal(bridgeManifest.frontendHandoff.bridgePackageCount, 40)
  assert.equal(bridgeManifest.frontendHandoff.coveredPackageCount, 5)
  assert.equal(bridgeManifest.frontendHandoff.depOnlyPackageCount, 40)
  assert.equal(bridgeManifest.frontendHandoff.standardPackageCount, 40)
  assert.equal(bridgeManifest.frontendHandoff.localPackageCount, 1)
  assert.ok(Array.isArray(bridgeManifest.packageGraph))
  assert.equal(bridgeManifest.packageGraph.length, bridgeManifest.frontendHandoff.graphPackageCount)
})

test('real TinyGo driver bridge covers local module imports in the synthetic frontend handoff', async (t) => {
  await ensureTinyGoToolchainReady()
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-driver-bridge-local-import-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const workspaceDir = path.join(tempDir, 'workspace')
  await mkdir(path.join(workspaceDir, 'helper'), { recursive: true })
  await writeFile(path.join(workspaceDir, 'go.mod'), `module example.com/bridgeprobe

go 1.22
`)
  await writeFile(path.join(workspaceDir, 'main.go'), `package main

import "example.com/bridgeprobe/helper"

func main() {
\thelper.Run()
}
`)
  await writeFile(path.join(workspaceDir, 'helper', 'helper.go'), `package helper

import "fmt"

func Run() {
\tfmt.Println("bridge-ok")
}
`)
  const requestPath = path.join(workspaceDir, 'tinygo-request.json')
  const outputPath = path.join(workspaceDir, 'out.wasm')
  const bridgeManifestPath = path.join(workspaceDir, 'tinygo-driver-bridge.json')
  await writeFile(requestPath, JSON.stringify({
    command: 'build',
    planner: 'tinygo',
    entry: path.join(workspaceDir, 'main.go'),
    optimize: 'z',
    output: outputPath,
    panic: 'trap',
    target: 'wasip1',
  }))

  const cwd = new URL('..', import.meta.url).pathname
  const bridge = spawn(process.execPath, [new URL('../scripts/probe-tinygo-driver-bridge.mjs', import.meta.url).pathname], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_DRIVER_BRIDGE_MANIFEST_PATH: bridgeManifestPath,
      WASM_TINYGO_DRIVER_BRIDGE_REQUEST_PATH: requestPath,
      WASM_TINYGO_DRIVER_BRIDGE_WORK_DIR: workspaceDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let bridgeOutput = ''
  bridge.stdout.on('data', (chunk) => {
    bridgeOutput += chunk.toString()
  })
  bridge.stderr.on('data', (chunk) => {
    bridgeOutput += chunk.toString()
  })

  const bridgeExitCode = await new Promise<number>((resolve, reject) => {
    bridge.once('error', reject)
    bridge.once('close', resolve)
  })

  assert.equal(bridgeExitCode, 0, bridgeOutput)
  const bridgeManifest = JSON.parse(await readFile(bridgeManifestPath, 'utf8'))
  assert.equal(bridgeManifest.entryPackage.importPath, 'example.com/bridgeprobe')
  assert.equal(bridgeManifest.frontendHandoff.target, 'wasip1')
  assert.equal(bridgeManifest.frontendHandoff.llvmTarget, 'wasm32-unknown-wasi')
  assert.equal(bridgeManifest.frontendHandoff.programPackageName, 'main')
  assert.equal(bridgeManifest.frontendHandoff.programPackageDir, workspaceDir)
  assert.deepEqual(bridgeManifest.frontendHandoff.programFiles, [path.join(workspaceDir, 'main.go')])
  assert.equal(bridgeManifest.frontendHandoff.programImportPath, 'example.com/bridgeprobe')
  assert.equal(bridgeManifest.frontendHandoff.programImportAlias, 'direct')
  assert.equal(bridgeManifest.frontendHandoff.bridgeEntryImportPath, 'example.com/bridgeprobe')
  assert.deepEqual(bridgeManifest.frontendHandoff.bridgeEntryGoFiles, [path.join(workspaceDir, 'main.go')])
  assert.deepEqual(bridgeManifest.frontendHandoff.bridgeEntryImports, ['example.com/bridgeprobe/helper'])
  assert.equal(bridgeManifest.frontendAnalysis, undefined)
  assert.equal(bridgeManifest.frontendRealAdapter.entryFile, path.join(workspaceDir, 'main.go'))
  assert.equal(bridgeManifest.frontendRealAdapter.toolchain.target, 'wasip1')
  assert.equal(bridgeManifest.frontendRealAdapter.toolchain.llvmTarget, 'wasm32-unknown-wasi')
  assert.equal(bridgeManifest.frontendRealAdapter.compileUnitManifestPath, '/working/tinygo-compile-unit.json')
  assert.equal(bridgeManifest.frontendRealAdapter.compileGroups.length, 4)
  assert.equal(bridgeManifest.frontendRealAdapter.buildContext.target, bridgeManifest.target)
  assert.equal(bridgeManifest.frontendRealAdapter.buildContext.goos, bridgeManifest.goos)
  assert.equal(bridgeManifest.frontendRealAdapter.buildContext.goarch, bridgeManifest.goarch)
  assert.equal(bridgeManifest.frontendRealAdapter.buildContext.gc, bridgeManifest.gc)
  assert.equal(bridgeManifest.frontendRealAdapter.buildContext.scheduler, bridgeManifest.scheduler)
  assert.equal(bridgeManifest.frontendRealAdapter.packageGraph.length, bridgeManifest.frontendRealAdapter.compileUnits.length)
  assert.equal(bridgeManifest.frontendRealAdapter.compileUnits.length, bridgeManifest.frontendHandoff.compileUnitCount)
  assert.equal(bridgeManifest.frontendRealAdapter.allCompileFiles.length, bridgeManifest.frontendHandoff.compileUnitFileCount)
  assert.deepEqual(bridgeManifest.realFrontendAnalysis, bridgeManifest.frontendRealAdapter)
  assert.equal(bridgeManifest.frontendHandoff.compileUnitCount, 7)
  assert.equal(bridgeManifest.frontendHandoff.graphPackageCount, 42)
  assert.equal(bridgeManifest.frontendHandoff.bridgePackageCount, 41)
  assert.equal(bridgeManifest.frontendHandoff.coveredPackageCount, 6)
  assert.equal(bridgeManifest.frontendHandoff.depOnlyPackageCount, 41)
  assert.equal(bridgeManifest.frontendHandoff.standardPackageCount, 40)
  assert.equal(bridgeManifest.frontendHandoff.localPackageCount, 2)
  assert.ok(Array.isArray(bridgeManifest.packageGraph))
  assert.equal(bridgeManifest.packageGraph.length, bridgeManifest.frontendHandoff.graphPackageCount)
  assert.deepEqual(bridgeManifest.frontendHandoff.bridgeEntryImports, ['example.com/bridgeprobe/helper'])

  const normalizedBridgeManifest = normalizeTinyGoDriverBridgeManifestForBrowser(bridgeManifest)
  const normalizedRealAnalysisPaths = [
    ...(normalizedBridgeManifest.frontendRealAdapter?.allCompileFiles ?? []),
    ...((normalizedBridgeManifest.frontendRealAdapter?.compileUnits ?? []).flatMap((compileUnit) => [
      compileUnit.packageDir ?? '',
      ...(compileUnit.files ?? []),
    ])),
  ]
  assert.equal(normalizedRealAnalysisPaths.every((filePath) => filePath.startsWith('/workspace') || filePath.startsWith('/working/.tinygo-root')), true)
})
