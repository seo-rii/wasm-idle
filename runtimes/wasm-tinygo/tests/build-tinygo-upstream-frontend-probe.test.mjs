import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ConsoleStdout, Directory, File, OpenFile, PreopenDirectory, WASI, WASIProcExit } from '@bjorn3/browser_wasi_shim'

import { buildTinyGoUpstreamFrontendProbeWasm } from '../scripts/build-tinygo-upstream-frontend-probe.mjs'
import {
  verifyUpstreamFrontendProbeAgainstFrontendAnalysisInputManifest,
  verifyUpstreamFrontendProbeAgainstFrontendAnalysisManifest,
  verifyUpstreamFrontendProbeAgainstFrontendRealAdapterManifest,
  normalizeTinyGoDriverBridgeManifestForBrowser,
  verifyUpstreamFrontendProbeAgainstDriverBridgeManifest,
} from '../src/compile-unit.ts'

const textEncoder = new TextEncoder()
const repoRoot = new URL('..', import.meta.url)
const browserTinyGoRoot = '/working/.tinygo-root'

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

const normalizePackageDirForProbe = (packageInfo) => {
  const packageDir = packageInfo.dir ?? ''
  if (packageDir === '/workspace' || packageDir.startsWith('/workspace/')) {
    return packageDir
  }
  if (packageDir === browserTinyGoRoot || packageDir.startsWith(`${browserTinyGoRoot}/`)) {
    return packageDir
  }
  if (packageInfo.standard && (packageInfo.importPath ?? '') !== '') {
    return `${browserTinyGoRoot}/src/${packageInfo.importPath}`
  }
  return packageDir
}

const runFrontendProbe = async ({
  wasmBytes,
  tinygoRootPath,
  tinygoRootEntries,
  workspaceEntries,
}) => {
  const stdoutLines = []
  const stderrLines = []
  const tinygoRoot = new PreopenDirectory(tinygoRootPath, buildDirectoryContents(tinygoRootEntries))
  const workspace = new PreopenDirectory('/workspace', buildDirectoryContents(workspaceEntries))
  const stdout = ConsoleStdout.lineBuffered((line) => stdoutLines.push(line))
  const stderr = ConsoleStdout.lineBuffered((line) => stderrLines.push(line))
  const wasi = new WASI(
    ['tinygo-upstream-frontend-probe'],
    [
      `TINYGOROOT=${tinygoRootPath}`,
      'TINYGO_WASI_TARGET=wasip1',
      'TINYGO_WASI_WORKING_DIR=/workspace',
      'TINYGO_WASI_PACKAGE_JSON_PATH=/workspace/package-list.json',
      'GOROOT=/go-root',
      'GOVERSION=go1.24.0',
    ],
    [new OpenFile(new File([])), stdout, stderr, tinygoRoot, workspace],
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

  assert.equal(exitCode, 0, `stdout:\n${stdoutLines.join('\n')}\n\nstderr:\n${stderrLines.join('\n')}`)
  assert.deepEqual(stderrLines, [], `stdout:\n${stdoutLines.join('\n')}\n\nstderr:\n${stderrLines.join('\n')}`)
  return JSON.parse(stdoutLines.join('\n'))
}

test('build-tinygo-upstream-frontend-probe parses a file-backed package graph with upstream loader', async () => {
  const result = await buildTinyGoUpstreamFrontendProbeWasm()
  const [wasmBytes, targetJson, runtimeSysSource, deviceArmSource] = await Promise.all([
    readFile(result.outputPath),
    readFile(result.targetPath, 'utf8'),
    readFile(result.runtimeSysPath, 'utf8'),
    readFile(result.deviceArmPath, 'utf8'),
  ])
  const deviceDirStat = await lstat(path.join(result.gorootPath, 'src', 'device'))

  assert.equal(wasmBytes[0], 0x00)
  assert.equal(wasmBytes[1], 0x61)
  assert.equal(wasmBytes[2], 0x73)
  assert.equal(wasmBytes[3], 0x6d)
  assert.equal(deviceDirStat.isSymbolicLink(), false)

  const packageList = [
    {
      Dir: '/workspace',
      ImportPath: 'command-line-arguments',
      Name: 'main',
      Root: '/workspace',
      Module: {
        Path: 'example.com/app',
        Main: true,
        Dir: '/workspace',
        GoMod: '/workspace/go.mod',
        GoVersion: '1.22',
      },
      GoFiles: ['main.go'],
      CgoFiles: [],
      CFiles: [],
      EmbedFiles: [],
      Imports: [],
      ImportMap: {},
    },
  ]
  const payload = await runFrontendProbe({
    wasmBytes,
    tinygoRootPath: '/tinygo-root',
    tinygoRootEntries: {
      'targets/wasip1.json': targetJson,
      'src/runtime/internal/sys/zversion.go': runtimeSysSource,
      'src/device/arm/arm.go': deviceArmSource,
    },
    workspaceEntries: {
      'go.mod': 'module example.com/app\n\ngo 1.22\n',
      'main.go': 'package main\n\nconst Answer = 7\n\nfunc main() {}\n',
      'package-list.json': `${JSON.stringify(packageList, null, 2)}\n`,
    },
  })
  assert.equal(payload.requestedTarget, 'wasip1')
  assert.equal(payload.mainImportPath, 'command-line-arguments')
  assert.equal(payload.mainPackageName, 'main')
  assert.equal(payload.packageCount, 1)
  assert.equal(payload.fileCount, 1)
  assert.equal(payload.declarationCount, 2)
  assert.deepEqual(payload.imports, [])
  assert.deepEqual(payload.packages, [
    {
      importPath: 'command-line-arguments',
      name: 'main',
      fileCount: 1,
      imports: [],
    },
  ])
})

test('build-tinygo-upstream-frontend-probe can rebuild its shipped goroot snapshot in place', async () => {
  const firstBuild = await buildTinyGoUpstreamFrontendProbeWasm()
  const secondBuild = await buildTinyGoUpstreamFrontendProbeWasm()

  assert.equal(secondBuild.outputPath, firstBuild.outputPath)
  assert.equal(secondBuild.gorootPath, firstBuild.gorootPath)
  const bisectSource = await readFile(
    path.join(secondBuild.gorootPath, 'src', 'internal', 'bisect', 'bisect.go'),
    'utf8',
  )
  assert.match(bisectSource, /^package bisect/m)
})

test('build-tinygo-upstream-frontend-probe parses a real driver bridge package graph with shipped TinyGo source snapshot', async (t) => {
  const result = await buildTinyGoUpstreamFrontendProbeWasm()
  const bridgeWorkDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-upstream-frontend-bridge-'))
  t.after(async () => {
    await rm(bridgeWorkDir, { recursive: true, force: true })
  })

  const workspaceFiles = {
    'go.mod': `module example.com/upstreamprobe

go 1.22
`,
    'helper/helper.go': `package helper

import "fmt"

func Run() {
\tfmt.Println("upstream-ok")
}
`,
    'main.go': `package main

import "example.com/upstreamprobe/helper"

func main() {
\thelper.Run()
}
`,
  }
  const requestPath = path.join(bridgeWorkDir, 'tinygo-request.json')
  const manifestPath = path.join(bridgeWorkDir, 'tinygo-driver-bridge.json')
  await mkdir(path.join(bridgeWorkDir, 'helper'), { recursive: true })
  await writeFile(path.join(bridgeWorkDir, 'go.mod'), workspaceFiles['go.mod'])
  await writeFile(path.join(bridgeWorkDir, 'helper', 'helper.go'), workspaceFiles['helper/helper.go'])
  await writeFile(path.join(bridgeWorkDir, 'main.go'), workspaceFiles['main.go'])
  await writeFile(
    requestPath,
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
  const bridge = spawnSync(process.execPath, [new URL('../scripts/probe-tinygo-driver-bridge.mjs', import.meta.url).pathname], {
    cwd: repoRoot,
    env: {
      ...process.env,
      WASM_TINYGO_DRIVER_BRIDGE_INCLUDE_UPSTREAM_FRONTEND_PROBE: '1',
      WASM_TINYGO_DRIVER_BRIDGE_MANIFEST_PATH: manifestPath,
      WASM_TINYGO_DRIVER_BRIDGE_REQUEST_PATH: requestPath,
      WASM_TINYGO_DRIVER_BRIDGE_WORK_DIR: bridgeWorkDir,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.equal(bridge.status, 0, [bridge.stdout, bridge.stderr].join(''))

  const browserManifest = normalizeTinyGoDriverBridgeManifestForBrowser(
    JSON.parse(await readFile(manifestPath, 'utf8')),
  )
  const packageList = (browserManifest.packageGraph ?? []).map((packageInfo) => {
    const packageDir = normalizePackageDirForProbe(packageInfo)
    const isWorkspacePackage = packageDir === '/workspace' || packageDir.startsWith('/workspace/')
    return {
      Dir: packageDir,
      ImportPath: packageInfo.importPath ?? '',
      Name: packageInfo.name ?? '',
      Root: isWorkspacePackage ? '/workspace' : '/working/.tinygo-root',
      Module:
        isWorkspacePackage && (packageInfo.modulePath ?? '') !== ''
          ? {
              Path: packageInfo.modulePath,
              Main: true,
              Dir: '/workspace',
              GoMod: '/workspace/go.mod',
              GoVersion: '1.22',
            }
          : undefined,
      GoFiles: packageInfo.goFiles ?? [],
      CgoFiles: [],
      CFiles: [],
      EmbedFiles: [],
      Imports: packageInfo.imports ?? [],
      ImportMap: {},
    }
  })
  assert.ok(packageList.length > 1)

  const [wasmBytes, targetJson, runtimeSysSource, deviceArmSource] = await Promise.all([
    readFile(result.outputPath),
    readFile(result.targetPath, 'utf8'),
    readFile(result.runtimeSysPath, 'utf8'),
    readFile(result.deviceArmPath, 'utf8'),
  ])
  const tinygoRootEntries = {
    'targets/wasip1.json': targetJson,
    'src/runtime/internal/sys/zversion.go': runtimeSysSource,
    'src/device/arm/arm.go': deviceArmSource,
  }
  const tinygoRootPrefix = `${browserTinyGoRoot}/`
  const assetReads = []
  for (const packageInfo of browserManifest.packageGraph ?? []) {
    const packageDir = normalizePackageDirForProbe(packageInfo)
    if (!packageDir.startsWith(tinygoRootPrefix)) {
      continue
    }
    const assetDir = packageDir.slice(tinygoRootPrefix.length)
    for (const goFile of packageInfo.goFiles ?? []) {
      const relativeAssetPath = `${assetDir}/${goFile}`.replace(/\\/g, '/')
      assetReads.push(
        readFile(path.join(result.gorootPath, relativeAssetPath), 'utf8').then((contents) => [
          relativeAssetPath,
          contents,
        ]),
      )
    }
  }
  for (const [relativeAssetPath, contents] of await Promise.all(assetReads)) {
    tinygoRootEntries[relativeAssetPath] = contents
  }

  const payload = await runFrontendProbe({
    wasmBytes,
    tinygoRootPath: browserTinyGoRoot,
    tinygoRootEntries,
    workspaceEntries: {
      ...workspaceFiles,
      'package-list.json': `${JSON.stringify(packageList, null, 2)}\n`,
    },
  })

  assert.equal(payload.requestedTarget, 'wasip1')
  assert.equal(payload.mainImportPath, browserManifest.entryPackage?.importPath ?? 'command-line-arguments')
  assert.equal(payload.mainPackageName, browserManifest.entryPackage?.name ?? 'main')
  assert.ok(payload.packageCount > 1)
  assert.ok(payload.fileCount >= 1)
  assert.deepEqual(payload.imports, browserManifest.entryPackage?.imports ?? [])
  assert.equal(Array.isArray(payload.packages), true)
  assert.equal(payload.packages.length, payload.packageCount)
  assert.deepEqual(
    payload.packages.find((pkg) => pkg.importPath === (browserManifest.entryPackage?.importPath ?? 'command-line-arguments')),
    {
      importPath: browserManifest.entryPackage?.importPath ?? 'command-line-arguments',
      name: browserManifest.entryPackage?.name ?? 'main',
      fileCount: 1,
      imports: browserManifest.entryPackage?.imports ?? [],
    },
  )
  assert.equal(
    payload.packages.some((pkg) => pkg.importPath === 'fmt'),
    true,
  )
  assert.deepEqual(browserManifest.upstreamFrontendProbe, payload)
  assert.deepEqual(
    verifyUpstreamFrontendProbeAgainstDriverBridgeManifest(payload, browserManifest),
    {
      entryImportPath: browserManifest.entryPackage?.importPath ?? 'command-line-arguments',
      graphPackageCount: browserManifest.packageGraph?.length ?? 0,
      mainPackageName: browserManifest.entryPackage?.name ?? 'main',
    },
  )
  assert.deepEqual(
    verifyUpstreamFrontendProbeAgainstFrontendAnalysisInputManifest(
      payload,
      browserManifest.frontendAnalysisInput,
    ),
    {
      entryImportPath: browserManifest.entryPackage?.importPath ?? 'command-line-arguments',
      graphPackageCount: browserManifest.frontendAnalysisInput?.packageGraph?.length ?? 0,
      mainPackageName: browserManifest.entryPackage?.name ?? 'main',
    },
  )
  assert.deepEqual(browserManifest.frontendAnalysisInput?.upstreamFrontendProbe, payload)
  assert.equal(browserManifest.frontendAnalysis, undefined)
  assert.deepEqual(browserManifest.frontendRealAdapter?.upstreamFrontendProbe, payload)
  assert.deepEqual(
    verifyUpstreamFrontendProbeAgainstFrontendRealAdapterManifest(
      payload,
      browserManifest.frontendRealAdapter,
    ),
    {
      entryImportPath: browserManifest.entryPackage?.importPath ?? 'command-line-arguments',
      graphPackageCount: browserManifest.frontendRealAdapter?.packageGraph?.length ?? 0,
      mainPackageName: browserManifest.entryPackage?.name ?? 'main',
    },
  )
})

test('verifyUpstreamFrontendProbeAgainstDriverBridgeManifest rejects mismatched package summaries', () => {
  assert.throws(
    () =>
      verifyUpstreamFrontendProbeAgainstDriverBridgeManifest(
        {
          requestedTarget: 'wasip1',
          mainImportPath: 'command-line-arguments',
          mainPackageName: 'main',
          packageCount: 1,
          fileCount: 1,
          declarationCount: 1,
          imports: [],
          packages: [
            {
              importPath: 'command-line-arguments',
              name: 'main',
              fileCount: 2,
              imports: [],
            },
          ],
        },
        {
          entryPackage: {
            importPath: 'command-line-arguments',
            name: 'main',
            imports: [],
          },
          packageGraph: [
            {
              dir: '/workspace',
              goFiles: ['main.go'],
              importPath: 'command-line-arguments',
              imports: [],
              name: 'main',
            },
          ],
        },
      ),
    /upstream frontend probe package summaries did not match real TinyGo driver bridge/,
  )
})

test('verifyUpstreamFrontendProbeAgainstFrontendAnalysisInputManifest rejects mismatched package summaries', () => {
  assert.throws(
    () =>
      verifyUpstreamFrontendProbeAgainstFrontendAnalysisInputManifest(
        {
          requestedTarget: 'wasip1',
          mainImportPath: 'command-line-arguments',
          mainPackageName: 'main',
          packageCount: 2,
          fileCount: 1,
          declarationCount: 1,
          imports: ['fmt'],
          packages: [
            {
              importPath: 'command-line-arguments',
              name: 'main',
              fileCount: 1,
              imports: ['fmt'],
            },
            {
              importPath: 'fmt',
              name: 'fmt',
              fileCount: 4,
              imports: [],
            },
          ],
        },
        {
          buildContext: {
            target: 'wasm',
            llvmTarget: 'wasm32-unknown-wasi',
            goos: 'js',
            goarch: 'wasm',
            gc: 'conservative',
            scheduler: 'asyncify',
            buildTags: [],
            modulePath: '',
          },
          entryFile: '/workspace/main.go',
          modulePath: '',
          optimizeFlag: '-Oz',
          toolchain: {
            target: 'wasm',
            llvmTarget: 'wasm32-unknown-wasi',
            linker: 'wasm-ld',
            cflags: [],
            ldflags: [],
            translationUnitPath: '/working/tinygo-bootstrap.c',
            objectOutputPath: '/working/tinygo-bootstrap.o',
            artifactOutputPath: '/working/out.wasm',
          },
          sourceSelection: {
            targetAssets: [],
            runtimeSupport: [],
            program: ['/workspace/main.go'],
            imported: [],
            stdlib: ['/working/.tinygo-root/src/fmt/print.go'],
            allCompile: ['/workspace/main.go', '/working/.tinygo-root/src/fmt/print.go'],
          },
          packageGraph: [
            {
              depOnly: false,
              dir: '/workspace',
              files: {
                goFiles: ['main.go'],
              },
              importPath: 'command-line-arguments',
              imports: ['fmt'],
              modulePath: '',
              name: 'main',
              standard: false,
            },
            {
              depOnly: false,
              dir: '/working/.tinygo-root/src/fmt',
              files: {
                goFiles: ['print.go'],
              },
              importPath: 'fmt',
              imports: ['io'],
              modulePath: '',
              name: 'fmt',
              standard: true,
            },
          ],
        },
      ),
    /upstream frontend probe package summaries did not match frontend analysis input/,
  )
})

test('verifyUpstreamFrontendProbeAgainstFrontendAnalysisManifest rejects mismatched package summaries', () => {
  assert.throws(
    () =>
      verifyUpstreamFrontendProbeAgainstFrontendAnalysisManifest(
        {
          requestedTarget: 'wasip1',
          mainImportPath: 'command-line-arguments',
          mainPackageName: 'main',
          packageCount: 2,
          fileCount: 1,
          declarationCount: 1,
          imports: ['fmt'],
          packages: [
            {
              importPath: 'command-line-arguments',
              name: 'main',
              fileCount: 1,
              imports: ['fmt'],
            },
            {
              importPath: 'fmt',
              name: 'fmt',
              fileCount: 4,
              imports: [],
            },
          ],
        },
        {
          buildContext: {
            target: 'wasm',
            llvmTarget: 'wasm32-unknown-wasi',
            goos: 'js',
            goarch: 'wasm',
            gc: 'conservative',
            scheduler: 'asyncify',
            buildTags: [],
            modulePath: '',
          },
          entryFile: '/workspace/main.go',
          compileUnitManifestPath: '/working/tinygo-compile-unit.json',
          allCompileFiles: ['/workspace/main.go', '/working/.tinygo-root/src/fmt/print.go'],
          compileGroups: [
            {
              name: 'program',
              files: ['/workspace/main.go'],
            },
            {
              name: 'stdlib',
              files: ['/working/.tinygo-root/src/fmt/print.go'],
            },
          ],
          compileUnits: [
            {
              kind: 'program',
              importPath: 'command-line-arguments',
              imports: ['fmt'],
              modulePath: '',
              depOnly: false,
              packageName: 'main',
              packageDir: '/workspace',
              files: ['/workspace/main.go'],
              standard: false,
            },
            {
              kind: 'stdlib',
              importPath: 'fmt',
              imports: ['io'],
              modulePath: '',
              depOnly: false,
              packageName: 'fmt',
              packageDir: '/working/.tinygo-root/src/fmt',
              files: ['/working/.tinygo-root/src/fmt/print.go'],
              standard: true,
            },
          ],
          packageGraph: [
            {
              depOnly: false,
              dir: '/workspace',
              files: {
                goFiles: ['main.go'],
              },
              importPath: 'command-line-arguments',
              imports: ['fmt'],
              modulePath: '',
              name: 'main',
              standard: false,
            },
            {
              depOnly: false,
              dir: '/working/.tinygo-root/src/fmt',
              files: {
                goFiles: ['print.go'],
              },
              importPath: 'fmt',
              imports: ['io'],
              modulePath: '',
              name: 'fmt',
              standard: true,
            },
          ],
          toolchain: {
            target: 'wasm',
            llvmTarget: 'wasm32-unknown-wasi',
            linker: 'wasm-ld',
            cflags: [],
            ldflags: [],
            translationUnitPath: '/working/tinygo-bootstrap.c',
            objectOutputPath: '/working/tinygo-bootstrap.o',
            artifactOutputPath: '/working/out.wasm',
          },
        },
      ),
    /upstream frontend probe package summaries did not match frontend analysis/,
  )
})

test('verifyUpstreamFrontendProbeAgainstFrontendRealAdapterManifest rejects mismatched package summaries', () => {
  assert.throws(
    () =>
      verifyUpstreamFrontendProbeAgainstFrontendRealAdapterManifest(
        {
          requestedTarget: 'wasip1',
          mainImportPath: 'command-line-arguments',
          mainPackageName: 'main',
          packageCount: 2,
          fileCount: 1,
          declarationCount: 1,
          imports: ['fmt'],
          packages: [
            {
              importPath: 'command-line-arguments',
              name: 'main',
              fileCount: 1,
              imports: ['fmt'],
            },
            {
              importPath: 'fmt',
              name: 'fmt',
              fileCount: 4,
              imports: [],
            },
          ],
        },
        {
          buildContext: {
            target: 'wasm',
            llvmTarget: 'wasm32-unknown-wasi',
            goos: 'js',
            goarch: 'wasm',
            gc: 'conservative',
            scheduler: 'asyncify',
            buildTags: [],
            modulePath: '',
          },
          entryFile: '/workspace/main.go',
          compileUnitManifestPath: '/working/tinygo-compile-unit.json',
          allCompileFiles: ['/workspace/main.go', '/working/.tinygo-root/src/fmt/print.go'],
          compileGroups: [
            {
              name: 'program',
              files: ['/workspace/main.go'],
            },
            {
              name: 'stdlib',
              files: ['/working/.tinygo-root/src/fmt/print.go'],
            },
          ],
          compileUnits: [
            {
              kind: 'program',
              importPath: 'command-line-arguments',
              imports: ['fmt'],
              modulePath: '',
              depOnly: false,
              packageName: 'main',
              packageDir: '/workspace',
              files: ['/workspace/main.go'],
              standard: false,
            },
            {
              kind: 'stdlib',
              importPath: 'fmt',
              imports: ['io'],
              modulePath: '',
              depOnly: false,
              packageName: 'fmt',
              packageDir: '/working/.tinygo-root/src/fmt',
              files: ['/working/.tinygo-root/src/fmt/print.go'],
              standard: true,
            },
          ],
          packageGraph: [
            {
              depOnly: false,
              dir: '/workspace',
              files: {
                goFiles: ['main.go'],
              },
              importPath: 'command-line-arguments',
              imports: ['fmt'],
              modulePath: '',
              name: 'main',
              standard: false,
            },
            {
              depOnly: false,
              dir: '/working/.tinygo-root/src/fmt',
              files: {
                goFiles: ['print.go'],
              },
              importPath: 'fmt',
              imports: ['io'],
              modulePath: '',
              name: 'fmt',
              standard: true,
            },
          ],
          toolchain: {
            target: 'wasm',
            llvmTarget: 'wasm32-unknown-wasi',
            linker: 'wasm-ld',
            cflags: [],
            ldflags: [],
            translationUnitPath: '/working/tinygo-bootstrap.c',
            objectOutputPath: '/working/tinygo-bootstrap.o',
            artifactOutputPath: '/working/out.wasm',
          },
        },
      ),
    /upstream frontend probe package summaries did not match frontend real adapter/,
  )
})
