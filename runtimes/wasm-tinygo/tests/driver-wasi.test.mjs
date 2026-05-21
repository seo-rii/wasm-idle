import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ConsoleStdout, Directory, File, OpenFile, PreopenDirectory, WASI, WASIProcExit } from '@bjorn3/browser_wasi_shim'
import { verifyCompileUnitManifestAgainstDriverBridgeManifest } from '../src/compile-unit.ts'

const wasmBytes = readFileSync(new URL('../public/tools/go-probe.wasm', import.meta.url))
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const buildDirectoryContents = (entries) => {
  const root = new Map()
  for (const [path, contents] of Object.entries(entries)) {
    const parts = path.split('/')
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

const runProbe = async ({ mode, rootPath, entries, resultFileName }) => {
  const logs = []
  const rootDirectory = new PreopenDirectory(rootPath, buildDirectoryContents(entries))
  const stdout = ConsoleStdout.lineBuffered((line) => logs.push(`stdout ${line}`))
  const stderr = ConsoleStdout.lineBuffered((line) => logs.push(`stderr ${line}`))
  const wasi = new WASI(['tinygo-driver'], [`WASM_TINYGO_MODE=${mode}`], [new OpenFile(new File([])), stdout, stderr, rootDirectory])
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

  const resultNode = rootDirectory.dir.contents.get(resultFileName)
  const compileRequestNode = rootDirectory.dir.contents.get('tinygo-compile-request.json')
  const rootFiles = Object.fromEntries(
    [...rootDirectory.dir.contents.entries()]
      .filter(([, node]) => node instanceof File)
      .map(([name, node]) => [name, textDecoder.decode(node.data)]),
  )
  const result = resultNode ? JSON.parse(textDecoder.decode(resultNode.data)) : null
  const compileRequest = compileRequestNode ? JSON.parse(textDecoder.decode(compileRequestNode.data)) : null
  return { exitCode, result, compileRequest, logs, rootFiles }
}

const runDriver = async ({ source, files, request }) => runProbe({
  mode: 'driver',
  rootPath: '/workspace',
  entries: {
    'tinygo-request.json': JSON.stringify(request),
    ...(files ?? { 'main.go': source }),
  },
  resultFileName: 'tinygo-result.json',
})

const runFrontend = async ({ input, analysisResult, adapterResult, files }) => runProbe({
  mode: 'frontend',
  rootPath: '/working',
  entries: {
    ...(input ? { 'tinygo-frontend-input.json': JSON.stringify(input) } : {}),
    ...(analysisResult ? { 'tinygo-frontend-analysis.json': JSON.stringify(analysisResult) } : {}),
    ...(adapterResult ? { 'tinygo-frontend-real-adapter.json': JSON.stringify(adapterResult) } : {}),
    ...(files ?? {}),
  },
  resultFileName: 'tinygo-frontend-result.json',
})

const runFrontendAnalysis = async ({ input, files }) => runProbe({
  mode: 'frontend-analysis',
  rootPath: '/working',
  entries: {
    'tinygo-frontend-input.json': JSON.stringify(input),
    ...(files ?? {}),
  },
  resultFileName: 'tinygo-frontend-analysis.json',
})

const runFrontendFromAnalysis = async ({ analysisResult, files }) => runProbe({
  mode: 'frontend-analysis-build',
  rootPath: '/working',
  entries: {
    'tinygo-frontend-analysis.json': JSON.stringify(analysisResult),
    ...(files ?? {}),
  },
  resultFileName: 'tinygo-frontend-result.json',
})

const runFrontendRealAdapter = async ({ input, files }) => runProbe({
  mode: 'frontend-real-adapter',
  rootPath: '/working',
  entries: {
    'tinygo-frontend-input.json': JSON.stringify(input),
    ...(files ?? {}),
  },
  resultFileName: 'tinygo-frontend-real-adapter.json',
})

const runFrontendRealAdapterFromAnalysis = async ({ analysisResult, files }) => runProbe({
  mode: 'frontend-real-adapter-analysis',
  rootPath: '/working',
  entries: {
    'tinygo-frontend-analysis.json': JSON.stringify(analysisResult),
    ...(files ?? {}),
  },
  resultFileName: 'tinygo-frontend-real-adapter.json',
})

const runFrontendFromRealAdapter = async ({ analysisResult, adapterResult, files }) => runProbe({
  mode: 'frontend-real-adapter-build',
  rootPath: '/working',
  entries: {
    ...(analysisResult ? { 'tinygo-frontend-analysis.json': JSON.stringify(analysisResult) } : {}),
    'tinygo-frontend-real-adapter.json': JSON.stringify(adapterResult),
    ...(files ?? {}),
  },
  resultFileName: 'tinygo-frontend-result.json',
})

const runBackend = async ({ input, files }) => runProbe({
  mode: 'backend',
  rootPath: '/working',
  entries: {
    'tinygo-backend-input.json': JSON.stringify(input),
    ...(files ?? {}),
  },
  resultFileName: 'tinygo-backend-result.json',
})

test('wasi driver writes tinygo metadata for valid source', async () => {
  const execution = await runDriver({
    source: 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("ok") }\n',
    request: {
      command: 'build',
      planner: 'tinygo',
      entry: '/workspace/main.go',
      output: '/working/out.wasm',
      target: 'wasm',
      optimize: 'z',
      scheduler: 'tasks',
      panic: 'trap',
    },
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.equal(execution.result.mode, 'tinygo-bootstrap')
  assert.equal(execution.result.metadata.llvmTarget, 'wasm32-unknown-wasi')
  assert.equal(execution.result.metadata.scheduler, 'tasks')
  assert.equal(execution.result.metadata.panicStrategy, 'trap')
  assert.ok(execution.result.metadata.buildTags.includes('tinygo.wasm'))
  const manifestFile = execution.result.files.find((file) => file.path === '/working/tinygo-bootstrap.json')
  const frontendInputFile = execution.result.files.find((file) => file.path === '/working/tinygo-frontend-input.json')
  assert.ok(manifestFile)
  assert.ok(frontendInputFile)
  const manifest = JSON.parse(manifestFile.contents)
  const frontendInput = JSON.parse(frontendInputFile.contents)
  const generatedPaths = execution.result.files.map((file) => file.path)
  assert.ok(generatedPaths.includes('/working/tinygo-bootstrap.json'))
  assert.ok(generatedPaths.includes('/working/tinygo-frontend-input.json'))
  assert.ok(generatedPaths.includes('/working/.tinygo-root/targets/wasm.json'))
  assert.ok(generatedPaths.includes('/working/.tinygo-root/src/errors/errors.go'))
  assert.ok(generatedPaths.includes('/working/.tinygo-root/src/fmt/print.go'))
  assert.ok(generatedPaths.includes('/working/.tinygo-root/src/io/io.go'))
  assert.ok(generatedPaths.includes('/working/.tinygo-root/src/runtime/runtime.go'))
  assert.ok(generatedPaths.includes('/working/.tinygo-root/src/unsafe/unsafe.go'))
  assert.ok(!generatedPaths.includes('/working/.tinygo-root/targets/wasip1.json'))
  assert.equal(manifest.tinygoRoot, undefined)
  assert.equal(manifest.entryPath, undefined)
  assert.equal(manifest.modulePath, undefined)
  assert.equal(manifest.packageFiles, undefined)
  assert.equal(manifest.importedPackageFiles, undefined)
  assert.equal(manifest.imports, undefined)
  assert.equal(manifest.stdlibImports, undefined)
  assert.equal(manifest.stdlibPackageFiles, undefined)
  assert.equal(manifest.buildTags, undefined)
  assert.equal(manifest.target, undefined)
  assert.equal(manifest.scheduler, undefined)
  assert.equal(manifest.panicStrategy, undefined)
  assert.equal(manifest.optimizeFlag, undefined)
  assert.equal(manifest.compileInputs.entryFile, '/workspace/main.go')
  assert.deepEqual(manifest.compileInputs.packageFiles, ['/workspace/main.go'])
  assert.deepEqual(manifest.compileInputs.importedPackageFiles, [])
  assert.deepEqual(manifest.compileInputs.stdlibPackageFiles, [
    '/working/.tinygo-root/src/errors/errors.go',
    '/working/.tinygo-root/src/fmt/print.go',
    '/working/.tinygo-root/src/io/io.go',
    '/working/.tinygo-root/src/runtime/runtime.go',
    '/working/.tinygo-root/src/unsafe/unsafe.go',
  ])
  assert.equal(manifest.bootstrapExports, undefined)
  assert.deepEqual(manifest.bootstrapDispatch, {
    targetAssetFiles: [
      '/working/.tinygo-root/targets/wasm-undefined.txt',
      '/working/.tinygo-root/targets/wasm.json',
    ],
    runtimeSupportFiles: [
      '/working/.tinygo-root/src/device/arm/arm.go',
      '/working/.tinygo-root/src/runtime/asm_tinygowasm.S',
      '/working/.tinygo-root/src/runtime/gc_boehm.c',
      '/working/.tinygo-root/src/runtime/internal/sys/zversion.go',
    ],
    materializedFiles: [
      '/working/.tinygo-root/src/device/arm/arm.go',
      '/working/.tinygo-root/src/errors/errors.go',
      '/working/.tinygo-root/src/fmt/print.go',
      '/working/.tinygo-root/src/io/io.go',
      '/working/.tinygo-root/src/runtime/asm_tinygowasm.S',
      '/working/.tinygo-root/src/runtime/gc_boehm.c',
      '/working/.tinygo-root/src/runtime/internal/sys/zversion.go',
      '/working/.tinygo-root/src/runtime/runtime.go',
      '/working/.tinygo-root/src/unsafe/unsafe.go',
      '/working/.tinygo-root/targets/wasm-undefined.txt',
      '/working/.tinygo-root/targets/wasm.json',
      '/working/tinygo-bootstrap.json',
      '/working/tinygo-frontend-input.json',
    ],
  })
  assert.equal(frontendInput.tinygoRoot, undefined)
  assert.equal(frontendInput.target, undefined)
  assert.equal(frontendInput.llvmTarget, undefined)
  assert.equal(frontendInput.linker, undefined)
  assert.equal(frontendInput.translationUnitPath, undefined)
  assert.equal(frontendInput.objectOutputPath, undefined)
  assert.equal(frontendInput.artifactOutputPath, undefined)
  assert.deepEqual(frontendInput.toolchain, {
    target: 'wasm',
    artifactOutputPath: '/working/out.wasm',
  })
  assert.equal(frontendInput.packageFiles, undefined)
  assert.equal(frontendInput.targetAssetFiles, undefined)
  assert.equal(frontendInput.runtimeSupportFiles, undefined)
  assert.equal(frontendInput.programFiles, undefined)
  assert.equal(frontendInput.importedPackageFiles, undefined)
  assert.equal(frontendInput.stdlibPackageFiles, undefined)
  assert.equal(frontendInput.allCompileFiles, undefined)
  assert.deepEqual(frontendInput.compileUnits, [
    {
      depOnly: false,
      kind: 'program',
      importPath: 'command-line-arguments',
      imports: ['fmt'],
      modulePath: '',
      packageName: 'main',
      packageDir: '/workspace',
      files: ['/workspace/main.go'],
      standard: false,
    },
    {
      depOnly: true,
      kind: 'stdlib',
      importPath: 'errors',
      modulePath: '',
      packageName: 'errors',
      packageDir: '/working/.tinygo-root/src/errors',
      files: ['/working/.tinygo-root/src/errors/errors.go'],
      standard: true,
    },
    {
      depOnly: true,
      kind: 'stdlib',
      importPath: 'fmt',
      modulePath: '',
      packageName: 'fmt',
      packageDir: '/working/.tinygo-root/src/fmt',
      files: ['/working/.tinygo-root/src/fmt/print.go'],
      standard: true,
    },
    {
      depOnly: true,
      kind: 'stdlib',
      importPath: 'io',
      modulePath: '',
      packageName: 'io',
      packageDir: '/working/.tinygo-root/src/io',
      files: ['/working/.tinygo-root/src/io/io.go'],
      standard: true,
    },
    {
      depOnly: true,
      kind: 'stdlib',
      importPath: 'runtime',
      modulePath: '',
      packageName: 'runtime',
      packageDir: '/working/.tinygo-root/src/runtime',
      files: ['/working/.tinygo-root/src/runtime/runtime.go'],
      standard: true,
    },
    {
      depOnly: true,
      kind: 'stdlib',
      importPath: 'unsafe',
      modulePath: '',
      packageName: 'unsafe',
      packageDir: '/working/.tinygo-root/src/unsafe',
      files: ['/working/.tinygo-root/src/unsafe/unsafe.go'],
      standard: true,
    },
  ])
  assert.equal(frontendInput.sourceSelection.targetAssets, undefined)
  assert.equal(frontendInput.sourceSelection.runtimeSupport, undefined)
  assert.equal(frontendInput.sourceSelection.program, undefined)
  assert.equal(frontendInput.sourceSelection.imported, undefined)
  assert.equal(frontendInput.sourceSelection.stdlib, undefined)
  assert.deepEqual(frontendInput.sourceSelection.allCompile, [
    '/working/.tinygo-root/src/errors/errors.go',
    '/working/.tinygo-root/src/fmt/print.go',
    '/working/.tinygo-root/src/io/io.go',
    '/working/.tinygo-root/src/runtime/runtime.go',
    '/working/.tinygo-root/src/unsafe/unsafe.go',
    '/workspace/main.go',
  ])
  assert.equal(frontendInput.scheduler, undefined)
  assert.equal(frontendInput.panicStrategy, undefined)
  assert.equal(frontendInput.modulePath, '')
  assert.deepEqual(frontendInput.buildContext, {
    target: 'wasm',
    llvmTarget: 'wasm32-unknown-wasi',
    goos: 'js',
    goarch: 'wasm',
    gc: 'precise',
    scheduler: 'tasks',
    buildTags: [
      'gc.precise',
      'math_big_pure_go',
      'osusergo',
      'purego',
      'scheduler.tasks',
      'serial.none',
      'tinygo',
      'tinygo.unicore',
      'tinygo.wasm',
    ],
    modulePath: '',
  })
  assert.equal(frontendInput.imports, undefined)
  assert.deepEqual(frontendInput.buildTags, [
    'gc.precise',
    'math_big_pure_go',
    'osusergo',
    'purego',
    'scheduler.tasks',
    'serial.none',
    'tinygo',
    'tinygo.unicore',
    'tinygo.wasm',
  ])
  assert.deepEqual(frontendInput.packageGraph, [
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
      depOnly: true,
      dir: '/working/.tinygo-root/src/errors',
      files: {
        goFiles: ['errors.go'],
      },
      importPath: 'errors',
      imports: [],
      modulePath: '',
      name: 'errors',
      standard: true,
    },
    {
      depOnly: true,
      dir: '/working/.tinygo-root/src/fmt',
      files: {
        goFiles: ['print.go'],
      },
      importPath: 'fmt',
      imports: [],
      modulePath: '',
      name: 'fmt',
      standard: true,
    },
    {
      depOnly: true,
      dir: '/working/.tinygo-root/src/io',
      files: {
        goFiles: ['io.go'],
      },
      importPath: 'io',
      imports: [],
      modulePath: '',
      name: 'io',
      standard: true,
    },
    {
      depOnly: true,
      dir: '/working/.tinygo-root/src/runtime',
      files: {
        goFiles: ['runtime.go'],
      },
      importPath: 'runtime',
      imports: [],
      modulePath: '',
      name: 'runtime',
      standard: true,
    },
    {
      depOnly: true,
      dir: '/working/.tinygo-root/src/unsafe',
      files: {
        goFiles: ['unsafe.go'],
      },
      importPath: 'unsafe',
      imports: [],
      modulePath: '',
      name: 'unsafe',
      standard: true,
    },
  ])
  assert.equal(frontendInput.materializedFiles, undefined)
  const frontendAnalysisExecution = await runFrontendAnalysis({ input: frontendInput, files: {} })
  assert.equal(frontendAnalysisExecution.exitCode, 0)
  assert.equal(frontendAnalysisExecution.result.ok, true)
  const frontendExecution = await runFrontend({ analysisResult: frontendAnalysisExecution.result, files: {} })
  assert.equal(frontendExecution.exitCode, 0)
  assert.equal(frontendExecution.result.ok, true)
  const compileUnitManifest = JSON.parse(frontendExecution.result.generatedFiles.find((file) => file.path === '/working/tinygo-compile-unit.json').contents)
  const bridgeVerification = verifyCompileUnitManifestAgainstDriverBridgeManifest(compileUnitManifest, {
    artifactOutputPath: '/working/out.wasm',
    entryFile: '/workspace/main.go',
    entryPackage: {
      dir: '/workspace',
      goFiles: ['main.go'],
      importPath: 'command-line-arguments',
      name: 'main',
    },
    llvmTriple: 'wasm32-unknown-wasi',
    target: 'wasm',
  })
  assert.equal(bridgeVerification.target, 'wasm')
  assert.equal(bridgeVerification.programPackageName, 'main')
  assert.equal(bridgeVerification.programPackageDir, '/workspace')
  assert.deepEqual(bridgeVerification.programFiles, ['/workspace/main.go'])
  assert.ok(!generatedPaths.includes('/working/tinygo-bootstrap.c'))
})

test('wasi driver writes diagnostics for invalid source', async () => {
  const execution = await runDriver({
    source: 'package main\n\nfunc helper() {}\n',
    request: {
      command: 'build',
      planner: 'tinygo',
      entry: '/workspace/main.go',
      output: '/working/out.wasm',
      target: 'wasm',
    },
  })

  assert.equal(execution.exitCode, 1)
  assert.equal(execution.result.ok, false)
  assert.match(execution.result.diagnostics[0], /func main/)
})

test('wasi driver supports wasip1 metadata', async () => {
  const execution = await runDriver({
    source: 'package main\n\nfunc main() {}\n',
    request: {
      command: 'build',
      planner: 'tinygo',
      entry: '/workspace/main.go',
      output: '/working/out.wasm',
      target: 'wasip1',
    },
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.equal(execution.result.metadata.goos, 'wasip1')
  assert.equal(execution.result.metadata.llvmTarget, 'wasm32-unknown-wasi')
  const generatedPaths = execution.result.files.map((file) => file.path)
  assert.ok(generatedPaths.includes('/working/.tinygo-root/targets/wasip1.json'))
  assert.ok(!generatedPaths.includes('/working/.tinygo-root/targets/wasm.json'))
})

test('wasi driver supports wasip2 and wasip3 metadata', async () => {
  for (const target of ['wasip2', 'wasip3']) {
    const execution = await runDriver({
      source: 'package main\n\nfunc main() {}\n',
      request: {
        command: 'build',
        planner: 'tinygo',
        entry: '/workspace/main.go',
        output: '/working/out.wasm',
        target,
      },
    })

    assert.equal(execution.exitCode, 0)
    assert.equal(execution.result.ok, true)
    assert.equal(execution.result.metadata.goos, 'linux')
    assert.equal(execution.result.metadata.goarch, 'arm')
    assert.equal(execution.result.metadata.llvmTarget, 'wasm32-unknown-wasi')
    assert.ok(execution.result.metadata.buildTags.includes(target))
    const generatedPaths = execution.result.files.map((file) => file.path)
    assert.ok(generatedPaths.includes(`/working/.tinygo-root/targets/${target}.json`))
    assert.ok(!generatedPaths.includes('/working/.tinygo-root/targets/wasm.json'))
    assert.ok(!generatedPaths.includes('/working/.tinygo-root/targets/wasip1.json'))
  }
})

test('wasi driver honors go:build constraints when loading package files', async () => {
  const execution = await runDriver({
    files: {
      'main.go': 'package main\n\nfunc main() { browserOnly() }\n',
      'browser.go': '//go:build tinygo.wasm && scheduler.tasks\n\npackage main\n\nfunc browserOnly() {}\n',
      'wasip1_only.go': '//go:build wasip1\n\npackage broken\n',
      'not_wasm.go': '//go:build !tinygo.wasm\n\npackage broken\n',
    },
    request: {
      command: 'build',
      planner: 'tinygo',
      entry: '/workspace/main.go',
      output: '/working/out.wasm',
      target: 'wasm',
      scheduler: 'tasks',
    },
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.deepEqual(execution.result.metadata.packageFiles, [
    '/workspace/browser.go',
    '/workspace/main.go',
  ])
})

test('wasi driver honors filename target suffixes when loading package files', async () => {
  const execution = await runDriver({
    files: {
      'main.go': 'package main\n\nfunc main() { browserOnly(); archOnly() }\n',
      'browser_js.go': 'package main\n\nfunc browserOnly() {}\n',
      'arch_wasm.go': 'package main\n\nfunc archOnly() {}\n',
      'host_wasip1.go': 'package broken\n',
    },
    request: {
      command: 'build',
      planner: 'tinygo',
      entry: '/workspace/main.go',
      output: '/working/out.wasm',
      target: 'wasm',
    },
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.deepEqual(execution.result.metadata.packageFiles, [
    '/workspace/arch_wasm.go',
    '/workspace/browser_js.go',
    '/workspace/main.go',
  ])
})

test('wasi driver writes diagnostics for unresolved external imports', async () => {
  const execution = await runDriver({
    source: 'package main\n\nimport "example.com/lib"\n\nfunc main() { lib.Run() }\n',
    request: {
      command: 'build',
      planner: 'tinygo',
      entry: '/workspace/main.go',
      output: '/working/out.wasm',
      target: 'wasm',
    },
  })

  assert.equal(execution.exitCode, 1)
  assert.equal(execution.result.ok, false)
  assert.match(execution.result.diagnostics[0], /module resolution/)
})

test('wasi driver tracks current-module imports when go.mod is present', async () => {
  const execution = await runDriver({
    files: {
      'go.mod': 'module example.com/app\n\ngo 1.24\n',
      'main.go': 'package main\n\nimport "example.com/app/internal/helper"\n\nfunc main() { helper.Run() }\n',
      'internal/helper/helper.go': 'package helper\n\nimport "example.com/app/internal/deep"\n\nfunc Run() { deep.Call() }\n',
      'internal/deep/deep.go': 'package deep\n\nfunc Call() {}\n',
    },
    request: {
      command: 'build',
      planner: 'tinygo',
      entry: '/workspace/main.go',
      output: '/working/out.wasm',
      target: 'wasm',
    },
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.equal(execution.result.metadata.modulePath, 'example.com/app')
  assert.deepEqual(execution.result.metadata.localModuleImports, [
    'example.com/app/internal/deep',
    'example.com/app/internal/helper',
  ])
  assert.deepEqual(execution.result.metadata.importedPackageFiles, [
    '/workspace/internal/deep/deep.go',
    '/workspace/internal/helper/helper.go',
  ])
})

test('wasi driver tracks local replace module imports', async () => {
  const execution = await runDriver({
    files: {
      'go.mod': 'module example.com/app\n\ngo 1.24\n\nreplace example.com/lib => ./third_party/lib\n',
      'main.go': 'package main\n\nimport "example.com/lib/pkg"\n\nfunc main() { pkg.Run() }\n',
      'third_party/lib/pkg/pkg.go': 'package pkg\n\nfunc Run() {}\n',
    },
    request: {
      command: 'build',
      planner: 'tinygo',
      entry: '/workspace/main.go',
      output: '/working/out.wasm',
      target: 'wasm',
    },
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.deepEqual(execution.result.metadata.replacedModuleImports, [
    'example.com/lib/pkg',
  ])
  assert.deepEqual(execution.result.metadata.importedPackageFiles, [
    '/workspace/third_party/lib/pkg/pkg.go',
  ])
})

test('wasi driver tracks workspace module imports from go.work', async () => {
  const execution = await runDriver({
    files: {
      'go.work': 'go 1.24\n\nuse (\n\t./app\n\t./libs/lib\n)\n',
      'app/go.mod': 'module example.com/app\n\ngo 1.24\n',
      'app/main.go': 'package main\n\nimport "example.com/lib/pkg"\n\nfunc main() { pkg.Run() }\n',
      'libs/lib/go.mod': 'module example.com/lib\n\ngo 1.24\n',
      'libs/lib/pkg/pkg.go': 'package pkg\n\nfunc Run() {}\n',
    },
    request: {
      command: 'build',
      planner: 'tinygo',
      entry: '/workspace/app/main.go',
      output: '/working/out.wasm',
      target: 'wasm',
    },
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.deepEqual(execution.result.metadata.workspaceModuleImports, [
    'example.com/lib/pkg',
  ])
  assert.deepEqual(execution.result.metadata.importedPackageFiles, [
    '/workspace/libs/lib/pkg/pkg.go',
  ])
})

test('wasi driver tracks workspace module replace imports', async () => {
  const execution = await runDriver({
    files: {
      'go.work': 'go 1.24\n\nuse (\n\t./app\n\t./libs/lib\n)\n',
      'app/go.mod': 'module example.com/app\n\ngo 1.24\n',
      'app/main.go': 'package main\n\nimport "example.com/lib/pkg"\n\nfunc main() { pkg.Run() }\n',
      'libs/lib/go.mod': 'module example.com/lib\n\ngo 1.24\n\nreplace example.com/dep => ../../shared/dep\n',
      'libs/lib/pkg/pkg.go': 'package pkg\n\nimport "example.com/dep/value"\n\nfunc Run() { value.Call() }\n',
      'shared/dep/go.mod': 'module example.com/dep\n\ngo 1.24\n',
      'shared/dep/value/value.go': 'package value\n\nfunc Call() {}\n',
    },
    request: {
      command: 'build',
      planner: 'tinygo',
      entry: '/workspace/app/main.go',
      output: '/working/out.wasm',
      target: 'wasm',
    },
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.deepEqual(execution.result.metadata.workspaceModuleImports, [
    'example.com/lib/pkg',
  ])
  assert.deepEqual(execution.result.metadata.replacedModuleImports, [
    'example.com/dep/value',
  ])
  assert.deepEqual(execution.result.metadata.importedPackageFiles, [
    '/workspace/libs/lib/pkg/pkg.go',
    '/workspace/shared/dep/value/value.go',
  ])
})

test('wasi driver tracks go.work replace module imports', async () => {
  const execution = await runDriver({
    files: {
      'go.work': 'go 1.24\n\nuse ./app\n\nreplace example.com/lib => ./shared/lib\n',
      'app/go.mod': 'module example.com/app\n\ngo 1.24\n',
      'app/main.go': 'package main\n\nimport "example.com/lib/pkg"\n\nfunc main() { pkg.Run() }\n',
      'shared/lib/go.mod': 'module example.com/lib\n\ngo 1.24\n',
      'shared/lib/pkg/pkg.go': 'package pkg\n\nfunc Run() {}\n',
    },
    request: {
      command: 'build',
      planner: 'tinygo',
      entry: '/workspace/app/main.go',
      output: '/working/out.wasm',
      target: 'wasm',
    },
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.deepEqual(execution.result.metadata.workspaceModuleImports, [])
  assert.deepEqual(execution.result.metadata.replacedModuleImports, [
    'example.com/lib/pkg',
  ])
  assert.deepEqual(execution.result.metadata.importedPackageFiles, [
    '/workspace/shared/lib/pkg/pkg.go',
  ])
})

test('wasi driver writes diagnostics for non-local go.work replace directives', async () => {
  const execution = await runDriver({
    files: {
      'go.work': 'go 1.24\n\nuse ./app\n\nreplace example.com/lib => example.com/lib v1.2.3\n',
      'app/go.mod': 'module example.com/app\n\ngo 1.24\n',
      'app/main.go': 'package main\n\nimport "example.com/lib/pkg"\n\nfunc main() { pkg.Run() }\n',
    },
    request: {
      command: 'build',
      planner: 'tinygo',
      entry: '/workspace/app/main.go',
      output: '/working/out.wasm',
      target: 'wasm',
    },
  })

  assert.equal(execution.exitCode, 1)
  assert.equal(execution.result.ok, false)
  assert.match(execution.result.diagnostics[0], /non-local replace directive is not supported yet/)
})

test('wasi driver writes diagnostics for current-module import cycles', async () => {
  const execution = await runDriver({
    files: {
      'go.mod': 'module example.com/app\n\ngo 1.24\n',
      'main.go': 'package main\n\nimport "example.com/app/internal/helper"\n\nfunc main() { helper.Run() }\n',
      'internal/helper/helper.go': 'package helper\n\nimport "example.com/app/internal/deep"\n\nfunc Run() { deep.Call() }\n',
      'internal/deep/deep.go': 'package deep\n\nimport "example.com/app/internal/helper"\n\nfunc Call() { helper.Run() }\n',
    },
    request: {
      command: 'build',
      planner: 'tinygo',
      entry: '/workspace/main.go',
      output: '/working/out.wasm',
      target: 'wasm',
    },
  })

  assert.equal(execution.exitCode, 1)
  assert.equal(execution.result.ok, false)
  assert.match(execution.result.diagnostics[0], /import cycle/)
})

test('wasi driver writes diagnostics when a local package is excluded by target constraints', async () => {
  const execution = await runDriver({
    files: {
      'go.mod': 'module example.com/app\n\ngo 1.24\n',
      'main.go': 'package main\n\nimport "example.com/app/internal/helper"\n\nfunc main() { helper.Run() }\n',
      'internal/helper/helper_wasip1.go': 'package helper\n\nfunc Run() {}\n',
    },
    request: {
      command: 'build',
      planner: 'tinygo',
      entry: '/workspace/main.go',
      output: '/working/out.wasm',
      target: 'wasm',
    },
  })

  assert.equal(execution.exitCode, 1)
  assert.equal(execution.result.ok, false)
  assert.match(execution.result.diagnostics[0], /no files matching current target\/build constraints/)
})

test('wasi frontend emits synthetic artifacts from frontend-analysis handoff', async () => {
  const frontendInput = {
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
    optimizeFlag: '-Oz',
    entryFile: '/workspace/main.go',
    sourceSelection: {
      program: ['/workspace/main.go'],
      allCompile: [
        '/working/.tinygo-root/src/errors/errors.go',
        '/working/.tinygo-root/src/fmt/print.go',
        '/workspace/main.go',
      ],
    },
    compileUnits: [
      {
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['fmt'],
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
      {
        kind: 'stdlib',
        importPath: 'errors',
        imports: [],
        packageName: 'errors',
        packageDir: '/working/.tinygo-root/src/errors',
        files: ['/working/.tinygo-root/src/errors/errors.go'],
      },
      {
        kind: 'stdlib',
        importPath: 'fmt',
        imports: ['errors', 'io'],
        packageName: 'fmt',
        packageDir: '/working/.tinygo-root/src/fmt',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
      },
    ],
  }
  const analysisExecution = await runFrontendAnalysis({ input: frontendInput })
  assert.equal(analysisExecution.exitCode, 0)
  assert.equal(analysisExecution.result.ok, true)

  const execution = await runFrontend({
    analysisResult: analysisExecution.result,
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.equal(execution.result.mode, undefined)
  assert.equal(execution.result.entryFile, undefined)
  assert.equal(execution.result.target, undefined)
  assert.equal(execution.result.compileRequestPath, undefined)
  assert.equal(execution.result.bootstrapArtifact, undefined)
  assert.equal(execution.result.generatedFiles.length, 7)
  assert.deepEqual(execution.result.generatedFiles, [
    {
      path: '/working/tinygo-bootstrap.c',
      contents: execution.result.generatedFiles[0].contents,
    },
    {
      path: '/working/tinygo-compile-unit.json',
      contents: execution.result.generatedFiles[1].contents,
    },
    {
      path: '/working/tinygo-intermediate.json',
      contents: execution.result.generatedFiles[2].contents,
    },
    {
      path: '/working/tinygo-lowering-input.json',
      contents: execution.result.generatedFiles[3].contents,
    },
    {
      path: '/working/tinygo-work-items.json',
      contents: execution.result.generatedFiles[4].contents,
    },
    {
      path: '/working/tinygo-lowering-plan.json',
      contents: execution.result.generatedFiles[5].contents,
    },
    {
      path: '/working/tinygo-backend-input.json',
      contents: execution.result.generatedFiles[6].contents,
    },
  ])
  assert.equal(execution.result.generatedFiles[0].contents.includes('module: '), false)
  assert.match(execution.result.generatedFiles[0].contents, /\\"materializedFiles\\":\[\\"\/working\/\.tinygo-root\/src\/device\/arm\/arm\.go\\"/)
  assert.match(execution.result.generatedFiles[1].contents, /"entryFile":"\/workspace\/main.go"/)
  assert.match(execution.result.generatedFiles[1].contents, /"toolchain":\{"target":"wasm".*"artifactOutputPath":"\/working\/out\.wasm"\}/)
  assert.match(execution.result.generatedFiles[1].contents, /"compileUnits":\[\{"kind":"program","importPath":"command-line-arguments","imports":\["fmt"\],"modulePath":"","depOnly":false,"packageName":"main","packageDir":"\/workspace","files":\["\/workspace\/main\.go"\],"standard":false\},\{"kind":"stdlib","importPath":"errors","imports":\[\],"modulePath":"","depOnly":true,"packageName":"errors","packageDir":"\/working\/\.tinygo-root\/src\/errors","files":\["\/working\/\.tinygo-root\/src\/errors\/errors\.go"\],"standard":true\},\{"kind":"stdlib","importPath":"fmt","imports":\["errors","io"\],"modulePath":"","depOnly":true,"packageName":"fmt","packageDir":"\/working\/\.tinygo-root\/src\/fmt","files":\["\/working\/\.tinygo-root\/src\/fmt\/print\.go"\],"standard":true\}\]/)
  assert.match(execution.result.generatedFiles[1].contents, /"sourceSelection":\{"allCompile":\["\/working\/\.tinygo-root\/src\/errors\/errors\.go","\/working\/\.tinygo-root\/src\/fmt\/print\.go","\/workspace\/main\.go"\]\}/)
  assert.match(execution.result.generatedFiles[1].contents, /"materializedFiles":\["\/working\/\.tinygo-root\/src\/device\/arm\/arm\.go"/)
  assert.equal(execution.result.generatedFiles[0].contents.includes('/working/tinygo-bootstrap.json'), false)
  assert.equal(execution.result.generatedFiles[0].contents.includes('/working/tinygo-frontend-input.json'), false)
  assert.equal(execution.result.generatedFiles[1].contents.includes('/working/tinygo-bootstrap.json'), false)
  assert.equal(execution.result.generatedFiles[1].contents.includes('/working/tinygo-frontend-input.json'), false)
  const intermediateManifest = JSON.parse(execution.result.generatedFiles[2].contents)
  assert.equal(intermediateManifest.entryFile, '/workspace/main.go')
  assert.deepEqual(intermediateManifest.sourceSelection.program, ['/workspace/main.go'])
  assert.deepEqual(intermediateManifest.sourceSelection.imported, [])
  assert.deepEqual(intermediateManifest.sourceSelection.stdlib, [
    '/working/.tinygo-root/src/errors/errors.go',
    '/working/.tinygo-root/src/fmt/print.go',
  ])
  assert.deepEqual(intermediateManifest.sourceSelection.targetAssets, [
    '/working/.tinygo-root/targets/wasm-undefined.txt',
    '/working/.tinygo-root/targets/wasm.json',
  ])
  assert.deepEqual(intermediateManifest.toolchain, {
    target: 'wasm',
    llvmTarget: 'wasm32-unknown-wasi',
    linker: 'wasm-ld',
    cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
    ldflags: ['--stack-first', '--no-demangle'],
    translationUnitPath: '/working/tinygo-bootstrap.c',
    objectOutputPath: '/working/tinygo-bootstrap.o',
    artifactOutputPath: '/working/out.wasm',
  })
  assert.deepEqual(intermediateManifest.compileUnits, [
    {
      depOnly: false,
      kind: 'program',
      importPath: 'command-line-arguments',
      imports: ['fmt'],
      modulePath: '',
      packageName: 'main',
      packageDir: '/workspace',
      files: ['/workspace/main.go'],
      standard: false,
    },
    {
      depOnly: true,
      kind: 'stdlib',
      importPath: 'errors',
      imports: [],
      modulePath: '',
      packageName: 'errors',
      packageDir: '/working/.tinygo-root/src/errors',
      files: ['/working/.tinygo-root/src/errors/errors.go'],
      standard: true,
    },
    {
      depOnly: true,
      kind: 'stdlib',
      importPath: 'fmt',
      imports: ['errors', 'io'],
      modulePath: '',
      packageName: 'fmt',
      packageDir: '/working/.tinygo-root/src/fmt',
      files: ['/working/.tinygo-root/src/fmt/print.go'],
      standard: true,
    },
  ])
  const loweringManifest = JSON.parse(execution.result.generatedFiles[3].contents)
  assert.deepEqual(loweringManifest.support, {
    targetAssets: [
      '/working/.tinygo-root/targets/wasm-undefined.txt',
      '/working/.tinygo-root/targets/wasm.json',
    ],
    runtimeSupport: [
      '/working/.tinygo-root/src/device/arm/arm.go',
      '/working/.tinygo-root/src/runtime/asm_tinygowasm.S',
      '/working/.tinygo-root/src/runtime/gc_boehm.c',
      '/working/.tinygo-root/src/runtime/internal/sys/zversion.go',
    ],
  })
  assert.deepEqual(loweringManifest.compileUnits, intermediateManifest.compileUnits)
  const workItemsManifest = JSON.parse(execution.result.generatedFiles[4].contents)
  assert.deepEqual(workItemsManifest.workItems, [
    {
      id: 'program-000',
      kind: 'program',
      importPath: 'command-line-arguments',
      imports: ['fmt'],
      depOnly: false,
      modulePath: '',
      packageName: 'main',
      packageDir: '/workspace',
      files: ['/workspace/main.go'],
      bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
      standard: false,
    },
    {
      id: 'stdlib-000',
      kind: 'stdlib',
      importPath: 'errors',
      imports: [],
      depOnly: true,
      modulePath: '',
      packageName: 'errors',
      packageDir: '/working/.tinygo-root/src/errors',
      files: ['/working/.tinygo-root/src/errors/errors.go'],
      bitcodeOutputPath: '/working/tinygo-work/stdlib-000.bc',
      standard: true,
    },
    {
      id: 'stdlib-001',
      kind: 'stdlib',
      importPath: 'fmt',
      imports: ['errors', 'io'],
      depOnly: true,
      modulePath: '',
      packageName: 'fmt',
      packageDir: '/working/.tinygo-root/src/fmt',
      files: ['/working/.tinygo-root/src/fmt/print.go'],
      bitcodeOutputPath: '/working/tinygo-work/stdlib-001.bc',
      standard: true,
    },
  ])
  const loweringPlanManifest = JSON.parse(execution.result.generatedFiles[5].contents)
  assert.deepEqual(loweringPlanManifest.compileJobs, [
    {
      id: 'program-000',
      kind: 'program',
      importPath: 'command-line-arguments',
      imports: ['fmt'],
      depOnly: false,
      modulePath: '',
      packageName: 'main',
      packageDir: '/workspace',
      files: ['/workspace/main.go'],
      bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
      llvmTarget: 'wasm32-unknown-wasi',
      cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
      optimizeFlag: '-Oz',
      standard: false,
    },
    {
      id: 'stdlib-000',
      kind: 'stdlib',
      importPath: 'errors',
      imports: [],
      depOnly: true,
      modulePath: '',
      packageName: 'errors',
      packageDir: '/working/.tinygo-root/src/errors',
      files: ['/working/.tinygo-root/src/errors/errors.go'],
      bitcodeOutputPath: '/working/tinygo-work/stdlib-000.bc',
      llvmTarget: 'wasm32-unknown-wasi',
      cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
      optimizeFlag: '-Oz',
      standard: true,
    },
    {
      id: 'stdlib-001',
      kind: 'stdlib',
      importPath: 'fmt',
      imports: ['errors', 'io'],
      depOnly: true,
      modulePath: '',
      packageName: 'fmt',
      packageDir: '/working/.tinygo-root/src/fmt',
      files: ['/working/.tinygo-root/src/fmt/print.go'],
      bitcodeOutputPath: '/working/tinygo-work/stdlib-001.bc',
      llvmTarget: 'wasm32-unknown-wasi',
      cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
      optimizeFlag: '-Oz',
      standard: true,
    },
  ])
  assert.deepEqual(loweringPlanManifest.linkJob, {
    linker: 'wasm-ld',
    ldflags: ['--stack-first', '--no-demangle', '--no-entry', '--export-all'],
    artifactOutputPath: '/working/out.wasm',
    bitcodeInputs: [
      '/working/tinygo-work/program-000.bc',
      '/working/tinygo-work/stdlib-000.bc',
      '/working/tinygo-work/stdlib-001.bc',
    ],
  })
  const backendInputManifest = JSON.parse(execution.result.generatedFiles[6].contents)
  assert.equal(backendInputManifest.entryFile, '/workspace/main.go')
  assert.deepEqual(backendInputManifest.compileJobs, loweringPlanManifest.compileJobs)
  assert.deepEqual(backendInputManifest.linkJob, {
    linker: loweringPlanManifest.linkJob.linker,
    ldflags: loweringPlanManifest.linkJob.ldflags,
    artifactOutputPath: loweringPlanManifest.linkJob.artifactOutputPath,
  })
  assert.equal(backendInputManifest.loweredUnits, undefined)
  assert.equal(backendInputManifest.linkJob.bitcodeInputs, undefined)
  const compileUnitManifest = JSON.parse(execution.result.generatedFiles[1].contents)
  assert.equal(compileUnitManifest.target, undefined)
  assert.equal(compileUnitManifest.llvmTarget, undefined)
  assert.equal(compileUnitManifest.linker, undefined)
  assert.equal(compileUnitManifest.modulePath, undefined)
  assert.equal(compileUnitManifest.imports, undefined)
  assert.equal(compileUnitManifest.buildTags, undefined)
  assert.equal(compileUnitManifest.translationUnitPath, undefined)
  assert.equal(compileUnitManifest.objectOutputPath, undefined)
  assert.equal(compileUnitManifest.artifactOutputPath, undefined)
  assert.equal(compileUnitManifest.packageFiles, undefined)
  assert.equal(compileUnitManifest.importedPackageFiles, undefined)
  assert.equal(compileUnitManifest.stdlibPackageFiles, undefined)
  assert.equal(compileUnitManifest.allFiles, undefined)
  assert.equal(compileUnitManifest.allCompileFiles, undefined)
  assert.equal(compileUnitManifest.targetAssetFiles, undefined)
  assert.equal(compileUnitManifest.runtimeSupportFiles, undefined)
  assert.equal(compileUnitManifest.sourceSelection.targetAssets, undefined)
  assert.equal(compileUnitManifest.sourceSelection.runtimeSupport, undefined)
  assert.equal(compileUnitManifest.programFiles, undefined)
  assert.equal(compileUnitManifest.packageFileCount, undefined)
  assert.equal(compileUnitManifest.importedPackageFileCount, undefined)
  assert.equal(compileUnitManifest.stdlibPackageFileCount, undefined)
  assert.equal(compileUnitManifest.allFileCount, undefined)
  assert.equal(compileUnitManifest.targetAssetCount, undefined)
  assert.equal(compileUnitManifest.runtimeSupportFileCount, undefined)
  assert.equal(compileUnitManifest.programFileCount, undefined)
  assert.equal(compileUnitManifest.materializedFileCount, undefined)
  assert.equal(execution.result.compileRequest, undefined)
  assert.equal(execution.result.compileGroups, undefined)
  assert.equal(execution.result.summary, undefined)
  assert.equal(execution.compileRequest, null)
  assert.match(execution.result.diagnostics[0], /frontend prepared bootstrap compile request for wasm/)
  assert.ok(execution.rootFiles['tinygo-frontend-real-adapter.json'])
  assert.match(execution.logs.join('\n'), /tinygo frontend prepared bootstrap compile request/)
})

test('wasi frontend consumes frontend-analysis handoff without rereading input', async () => {
  const analysisExecution = await runFrontendAnalysis({
    input: {
      buildTags: ['tinygo.wasm', 'scheduler.tasks'],
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'tasks',
        buildTags: ['scheduler.tasks', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      toolchain: {
        target: 'wasm',
        artifactOutputPath: '/working/out.wasm',
      },
      optimizeFlag: '-Oz',
      entryFile: '/workspace/main.go',
      modulePath: 'example.com/app',
      sourceSelection: {
        allCompile: [
          '/working/.tinygo-root/src/fmt/print.go',
          '/workspace/lib/helper.go',
          '/workspace/main.go',
        ],
      },
      compileUnits: [
        {
          kind: 'program',
          importPath: 'command-line-arguments',
          imports: ['example.com/app/lib'],
          packageName: 'main',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
        },
        {
          kind: 'imported',
          importPath: 'example.com/app/lib',
          imports: ['fmt'],
          packageName: 'helper',
          packageDir: '/workspace/lib',
          files: ['/workspace/lib/helper.go'],
        },
        {
          kind: 'stdlib',
          importPath: 'fmt',
          imports: ['errors', 'io'],
          packageName: 'fmt',
          packageDir: '/working/.tinygo-root/src/fmt',
          files: ['/working/.tinygo-root/src/fmt/print.go'],
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: '/workspace',
          files: { goFiles: ['main.go'] },
          importPath: 'command-line-arguments',
          imports: ['example.com/app/lib'],
          name: 'main',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/workspace/lib',
          files: { goFiles: ['helper.go'] },
          importPath: 'example.com/app/lib',
          imports: ['fmt'],
          name: 'helper',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/working/.tinygo-root/src/fmt',
          files: { goFiles: ['print.go'] },
          importPath: 'fmt',
          imports: ['errors', 'io'],
          name: 'fmt',
          standard: true,
        },
      ],
    },
  })

  assert.equal(analysisExecution.exitCode, 0)
  assert.equal(analysisExecution.result.ok, true)

  const execution = await runFrontend({
    analysisResult: analysisExecution.result,
    files: {},
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.equal(execution.result.generatedFiles.length, 7)
  assert.match(execution.result.diagnostics[0], /frontend prepared bootstrap compile request for wasm/)
  assert.match(execution.logs.join('\n'), /tinygo frontend prepared bootstrap compile request/)
  assert.match(execution.logs.join('\n'), /tinygo frontend consuming analysis handoff/)
})

test('wasi frontend prefers frontend-real-adapter handoff when present', async () => {
  const input = {
    buildTags: ['tinygo.wasm', 'scheduler.tasks'],
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'tasks',
      buildTags: ['scheduler.tasks', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
    optimizeFlag: '-Oz',
    entryFile: '/workspace/main.go',
    modulePath: 'example.com/app',
    sourceSelection: {
      allCompile: [
        '/working/.tinygo-root/src/fmt/print.go',
        '/workspace/lib/helper.go',
        '/workspace/main.go',
      ],
    },
    compileUnits: [
      {
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['example.com/app/lib'],
        modulePath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
      {
        kind: 'imported',
        importPath: 'example.com/app/lib',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        packageName: 'helper',
        packageDir: '/workspace/lib',
        files: ['/workspace/lib/helper.go'],
      },
      {
        kind: 'stdlib',
        importPath: 'fmt',
        imports: ['errors', 'io'],
        modulePath: '',
        packageName: 'fmt',
        packageDir: '/working/.tinygo-root/src/fmt',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
      },
    ],
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'command-line-arguments',
        imports: ['example.com/app/lib'],
        modulePath: 'example.com/app',
        name: 'main',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/workspace/lib',
        files: { goFiles: ['helper.go'] },
        importPath: 'example.com/app/lib',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        name: 'helper',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/working/.tinygo-root/src/fmt',
        files: { goFiles: ['print.go'] },
        importPath: 'fmt',
        imports: ['errors', 'io'],
        modulePath: '',
        name: 'fmt',
        standard: true,
      },
    ],
  }
  const analysisExecution = await runFrontendAnalysis({ input, files: {} })
  assert.equal(analysisExecution.exitCode, 0)
  assert.equal(analysisExecution.result.ok, true)

  const adapterExecution = await runFrontendRealAdapterFromAnalysis({
    analysisResult: analysisExecution.result,
    files: {},
  })
  assert.equal(adapterExecution.exitCode, 0)
  assert.equal(adapterExecution.result.ok, true)
  adapterExecution.result.adapter.compileUnits[0].importPath = 'example.com/app'
  adapterExecution.result.adapter.packageGraph[0].importPath = 'example.com/app'

  const execution = await runFrontend({
    analysisResult: analysisExecution.result,
    adapterResult: adapterExecution.result,
    files: {},
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  const compileUnitFile = execution.result.generatedFiles.find((file) => file.path === '/working/tinygo-compile-unit.json')
  assert.ok(compileUnitFile)
  const compileUnitManifest = JSON.parse(compileUnitFile.contents)
  assert.equal(compileUnitManifest.compileUnits[0].importPath, 'example.com/app')
  assert.match(execution.logs.join('\n'), /tinygo frontend consuming real adapter handoff/)
})

test('wasi frontend consumes frontend-real-adapter handoff without analysis when input is present', async () => {
  const input = {
    buildTags: ['tinygo.wasm', 'scheduler.tasks'],
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'tasks',
      buildTags: ['scheduler.tasks', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
    optimizeFlag: '-Oz',
    entryFile: '/workspace/main.go',
    modulePath: 'example.com/app',
    sourceSelection: {
      allCompile: [
        '/working/.tinygo-root/src/fmt/print.go',
        '/workspace/lib/helper.go',
        '/workspace/main.go',
      ],
    },
    compileUnits: [
      {
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['example.com/app/lib'],
        modulePath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
      {
        kind: 'imported',
        importPath: 'example.com/app/lib',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        packageName: 'helper',
        packageDir: '/workspace/lib',
        files: ['/workspace/lib/helper.go'],
      },
      {
        kind: 'stdlib',
        importPath: 'fmt',
        imports: ['errors', 'io'],
        modulePath: '',
        packageName: 'fmt',
        packageDir: '/working/.tinygo-root/src/fmt',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
      },
    ],
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'command-line-arguments',
        imports: ['example.com/app/lib'],
        modulePath: 'example.com/app',
        name: 'main',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/workspace/lib',
        files: { goFiles: ['helper.go'] },
        importPath: 'example.com/app/lib',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        name: 'helper',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/working/.tinygo-root/src/fmt',
        files: { goFiles: ['print.go'] },
        importPath: 'fmt',
        imports: ['errors', 'io'],
        modulePath: '',
        name: 'fmt',
        standard: true,
      },
    ],
  }
  const adapterExecution = await runFrontendRealAdapter({
    input,
    files: {},
  })
  assert.equal(adapterExecution.exitCode, 0)
  assert.equal(adapterExecution.result.ok, true)
  adapterExecution.result.adapter.compileUnits[0].importPath = 'example.com/app'
  adapterExecution.result.adapter.packageGraph[0].importPath = 'example.com/app'

  const execution = await runFrontend({
    input,
    adapterResult: adapterExecution.result,
    files: {},
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  const compileUnitFile = execution.result.generatedFiles.find((file) => file.path === '/working/tinygo-compile-unit.json')
  assert.ok(compileUnitFile)
  const compileUnitManifest = JSON.parse(compileUnitFile.contents)
  assert.equal(compileUnitManifest.compileUnits[0].importPath, 'example.com/app')
  assert.match(execution.logs.join('\n'), /tinygo frontend consuming real adapter handoff/)
})

test('wasi frontend-analysis writes normalized handoff analysis', async () => {
  const execution = await runFrontendAnalysis({
    input: {
      buildTags: ['tinygo.wasm', 'scheduler.tasks'],
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'tasks',
        buildTags: ['scheduler.tasks', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      toolchain: {
        target: 'wasm',
        artifactOutputPath: '/working/out.wasm',
      },
      optimizeFlag: '-Oz',
      entryFile: '/workspace/main.go',
      modulePath: 'example.com/app',
      sourceSelection: {
        allCompile: [
          '/working/.tinygo-root/src/fmt/print.go',
          '/workspace/lib/helper.go',
          '/workspace/main.go',
        ],
      },
      compileUnits: [
        {
          kind: 'program',
          importPath: 'command-line-arguments',
          imports: ['example.com/app/lib'],
          packageName: 'main',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
        },
        {
          kind: 'imported',
          importPath: 'example.com/app/lib',
          imports: ['fmt'],
          packageName: 'helper',
          packageDir: '/workspace/lib',
          files: ['/workspace/lib/helper.go'],
        },
        {
          kind: 'stdlib',
          importPath: 'fmt',
          imports: ['errors', 'io'],
          packageName: 'fmt',
          packageDir: '/working/.tinygo-root/src/fmt',
          files: ['/working/.tinygo-root/src/fmt/print.go'],
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: '/workspace',
          files: { goFiles: ['main.go'] },
          importPath: 'command-line-arguments',
          imports: ['example.com/app/lib'],
          name: 'main',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/workspace/lib',
          files: { goFiles: ['helper.go'] },
          importPath: 'example.com/app/lib',
          imports: ['fmt'],
          name: 'helper',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/working/.tinygo-root/src/fmt',
          files: { goFiles: ['print.go'] },
          importPath: 'fmt',
          imports: ['errors', 'io'],
          name: 'fmt',
          standard: true,
        },
      ],
    },
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.equal(execution.result.analysis.toolchain.target, 'wasm')
  assert.equal(execution.result.analysis.toolchain.llvmTarget, 'wasm32-unknown-wasi')
  assert.equal(execution.result.analysis.compileUnitManifestPath, '/working/tinygo-compile-unit.json')
  assert.equal(execution.result.analysis.compileGroups.length, 6)
  assert.deepEqual(execution.result.analysis.buildContext, {
    target: 'wasm',
    llvmTarget: 'wasm32-unknown-wasi',
    goos: 'js',
    goarch: 'wasm',
    gc: 'precise',
    scheduler: 'tasks',
    buildTags: ['scheduler.tasks', 'tinygo.wasm'],
    modulePath: 'example.com/app',
  })
  assert.deepEqual(execution.result.analysis.packageGraph, [
    {
      depOnly: false,
      dir: '/workspace',
      files: { goFiles: ['main.go'] },
      importPath: 'command-line-arguments',
      imports: ['example.com/app/lib'],
      modulePath: 'example.com/app',
      name: 'main',
      standard: false,
    },
    {
      depOnly: true,
      dir: '/workspace/lib',
      files: { goFiles: ['helper.go'] },
      importPath: 'example.com/app/lib',
      imports: ['fmt'],
      modulePath: 'example.com/app',
      name: 'helper',
      standard: false,
    },
    {
      depOnly: true,
      dir: '/working/.tinygo-root/src/fmt',
      files: { goFiles: ['print.go'] },
      importPath: 'fmt',
      imports: ['errors', 'io'],
      modulePath: '',
      name: 'fmt',
      standard: true,
    },
  ])
  assert.deepEqual(execution.result.analysis.allCompileFiles, [
    '/working/.tinygo-root/src/fmt/print.go',
    '/workspace/lib/helper.go',
    '/workspace/main.go',
  ])
  assert.deepEqual(execution.result.analysis.compileUnits, [
    {
      depOnly: false,
      kind: 'program',
      importPath: 'command-line-arguments',
      imports: ['example.com/app/lib'],
      modulePath: 'example.com/app',
      packageName: 'main',
      packageDir: '/workspace',
      files: ['/workspace/main.go'],
      standard: false,
    },
    {
      depOnly: true,
      kind: 'imported',
      importPath: 'example.com/app/lib',
      imports: ['fmt'],
      modulePath: 'example.com/app',
      packageName: 'helper',
      packageDir: '/workspace/lib',
      files: ['/workspace/lib/helper.go'],
      standard: false,
    },
    {
      depOnly: true,
      kind: 'stdlib',
      importPath: 'fmt',
      imports: ['errors', 'io'],
      modulePath: '',
      packageName: 'fmt',
      packageDir: '/working/.tinygo-root/src/fmt',
      files: ['/working/.tinygo-root/src/fmt/print.go'],
      standard: true,
    },
  ])
  assert.match(execution.logs.join('\n'), /tinygo frontend prepared analysis handoff/)
})

test('wasi frontend-analysis accepts a direct packageGraph for a command-line-arguments program alias', async () => {
  const execution = await runFrontendAnalysis({
    input: {
      buildTags: ['tinygo.wasm', 'scheduler.tasks'],
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'tasks',
        buildTags: ['scheduler.tasks', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      toolchain: {
        target: 'wasm',
        artifactOutputPath: '/working/out.wasm',
      },
      optimizeFlag: '-Oz',
      entryFile: '/workspace/main.go',
      modulePath: 'example.com/app',
      sourceSelection: {
        allCompile: [
          '/working/.tinygo-root/src/fmt/print.go',
          '/workspace/lib/helper.go',
          '/workspace/main.go',
        ],
      },
      compileUnits: [
        {
          kind: 'program',
          importPath: 'command-line-arguments',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
        },
        {
          kind: 'imported',
          importPath: 'example.com/app/lib',
          imports: ['fmt'],
          packageName: 'helper',
          packageDir: '/workspace/lib',
          files: ['/workspace/lib/helper.go'],
        },
        {
          kind: 'stdlib',
          importPath: 'fmt',
          imports: ['errors', 'io'],
          packageName: 'fmt',
          packageDir: '/working/.tinygo-root/src/fmt',
          files: ['/working/.tinygo-root/src/fmt/print.go'],
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: '/workspace',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: ['example.com/app/lib'],
          name: 'main',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/workspace/lib',
          files: { goFiles: ['helper.go'] },
          importPath: 'example.com/app/lib',
          imports: ['fmt'],
          name: 'helper',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/working/.tinygo-root/src/fmt',
          files: { goFiles: ['print.go'] },
          importPath: 'fmt',
          imports: ['errors', 'io'],
          name: 'fmt',
          standard: true,
        },
      ],
    },
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.equal(execution.result.analysis.compileUnits[0].importPath, 'example.com/app')
  assert.deepEqual(execution.result.analysis.compileUnits[0].imports, ['example.com/app/lib'])
  assert.equal(execution.result.analysis.packageGraph[0].importPath, 'example.com/app')
})

test('wasi frontend-analysis synthesizes compileUnits from packageGraph when compileUnits are omitted', async () => {
  const execution = await runFrontendAnalysis({
    input: {
      buildTags: ['tinygo.wasm', 'scheduler.tasks'],
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'tasks',
        buildTags: ['scheduler.tasks', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      toolchain: {
        target: 'wasm',
        artifactOutputPath: '/working/out.wasm',
      },
      optimizeFlag: '-Oz',
      entryFile: '/workspace/main.go',
      modulePath: 'example.com/app',
      sourceSelection: {
        allCompile: [
          '/working/.tinygo-root/src/fmt/print.go',
          '/workspace/lib/helper.go',
          '/workspace/main.go',
        ],
      },
      packageGraph: [
        {
          depOnly: false,
          dir: '/workspace',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: ['example.com/app/lib'],
          name: 'main',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/workspace/lib',
          files: { goFiles: ['helper.go'] },
          importPath: 'example.com/app/lib',
          imports: ['fmt'],
          name: 'helper',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/working/.tinygo-root/src/fmt',
          files: { goFiles: ['print.go'] },
          importPath: 'fmt',
          imports: ['errors', 'io'],
          name: 'fmt',
          standard: true,
        },
      ],
    },
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.deepEqual(execution.result.analysis.compileUnits, [
    {
      depOnly: false,
      kind: 'program',
      importPath: 'example.com/app',
      imports: ['example.com/app/lib'],
      modulePath: 'example.com/app',
      packageName: 'main',
      packageDir: '/workspace',
      files: ['/workspace/main.go'],
      standard: false,
    },
    {
      depOnly: true,
      kind: 'imported',
      importPath: 'example.com/app/lib',
      imports: ['fmt'],
      modulePath: 'example.com/app',
      packageName: 'helper',
      packageDir: '/workspace/lib',
      files: ['/workspace/lib/helper.go'],
      standard: false,
    },
    {
      depOnly: true,
      kind: 'stdlib',
      importPath: 'fmt',
      imports: ['errors', 'io'],
      modulePath: '',
      packageName: 'fmt',
      packageDir: '/working/.tinygo-root/src/fmt',
      files: ['/working/.tinygo-root/src/fmt/print.go'],
      standard: true,
    },
  ])
  assert.deepEqual(execution.result.analysis.allCompileFiles, [
    '/working/.tinygo-root/src/fmt/print.go',
    '/workspace/lib/helper.go',
    '/workspace/main.go',
  ])
  assert.equal(execution.result.analysis.compileGroups.length, 6)
})

test('wasi frontend-analysis-build consumes normalized analysis handoff', async () => {
  const input = {
    buildTags: ['tinygo.wasm', 'scheduler.tasks'],
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'tasks',
      buildTags: ['scheduler.tasks', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
    optimizeFlag: '-Oz',
    entryFile: '/workspace/main.go',
    modulePath: 'example.com/app',
    sourceSelection: {
      allCompile: [
        '/working/.tinygo-root/src/fmt/print.go',
        '/workspace/lib/helper.go',
        '/workspace/main.go',
      ],
    },
    compileUnits: [
      {
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['example.com/app/lib'],
        modulePath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
      {
        kind: 'imported',
        importPath: 'example.com/app/lib',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        packageName: 'helper',
        packageDir: '/workspace/lib',
        files: ['/workspace/lib/helper.go'],
      },
      {
        kind: 'stdlib',
        importPath: 'fmt',
        imports: ['errors', 'io'],
        modulePath: '',
        packageName: 'fmt',
        packageDir: '/working/.tinygo-root/src/fmt',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
      },
    ],
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'command-line-arguments',
        imports: ['example.com/app/lib'],
        modulePath: 'example.com/app',
        name: 'main',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/workspace/lib',
        files: { goFiles: ['helper.go'] },
        importPath: 'example.com/app/lib',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        name: 'helper',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/working/.tinygo-root/src/fmt',
        files: { goFiles: ['print.go'] },
        importPath: 'fmt',
        imports: ['errors', 'io'],
        modulePath: '',
        name: 'fmt',
        standard: true,
      },
    ],
  }
  const analysisExecution = await runFrontendAnalysis({ input, files: {} })
  assert.equal(analysisExecution.exitCode, 0)
  assert.equal(analysisExecution.result.ok, true)

  const execution = await runFrontendFromAnalysis({
    analysisResult: analysisExecution.result,
    files: {},
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.equal(execution.result.generatedFiles.length, 7)

  const directExecution = await runFrontend({ analysisResult: analysisExecution.result, files: {} })
  assert.equal(directExecution.exitCode, 0)
  assert.equal(directExecution.result.ok, true)
  assert.equal(directExecution.result.generatedFiles.length, 7)
  assert.ok(directExecution.rootFiles['tinygo-frontend-real-adapter.json'])
  const directAdapterResult = JSON.parse(directExecution.rootFiles['tinygo-frontend-real-adapter.json'])
  assert.equal(directAdapterResult.ok, true)
  assert.match(execution.logs.join('\n'), /tinygo frontend prepared bootstrap compile request/)
  assert.match(execution.logs.join('\n'), /tinygo frontend consuming analysis handoff/)
})

test('wasi frontend-real-adapter-analysis consumes normalized analysis handoff', async () => {
  const analysisExecution = await runFrontendAnalysis({
    input: {
      buildTags: ['tinygo.wasm', 'scheduler.tasks'],
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'tasks',
        buildTags: ['scheduler.tasks', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      toolchain: {
        target: 'wasm',
        artifactOutputPath: '/working/out.wasm',
      },
      optimizeFlag: '-Oz',
      entryFile: '/workspace/main.go',
      modulePath: 'example.com/app',
      sourceSelection: {
        allCompile: [
          '/working/.tinygo-root/src/fmt/print.go',
          '/workspace/lib/helper.go',
          '/workspace/main.go',
        ],
      },
      compileUnits: [
        {
          kind: 'program',
          importPath: 'command-line-arguments',
          imports: ['example.com/app/lib'],
          packageName: 'main',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
        },
        {
          kind: 'imported',
          importPath: 'example.com/app/lib',
          imports: ['fmt'],
          packageName: 'helper',
          packageDir: '/workspace/lib',
          files: ['/workspace/lib/helper.go'],
        },
        {
          kind: 'stdlib',
          importPath: 'fmt',
          imports: ['errors', 'io'],
          packageName: 'fmt',
          packageDir: '/working/.tinygo-root/src/fmt',
          files: ['/working/.tinygo-root/src/fmt/print.go'],
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: '/workspace',
          files: { goFiles: ['main.go'] },
          importPath: 'command-line-arguments',
          imports: ['example.com/app/lib'],
          name: 'main',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/workspace/lib',
          files: { goFiles: ['helper.go'] },
          importPath: 'example.com/app/lib',
          imports: ['fmt'],
          name: 'helper',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/working/.tinygo-root/src/fmt',
          files: { goFiles: ['print.go'] },
          importPath: 'fmt',
          imports: ['errors', 'io'],
          name: 'fmt',
          standard: true,
        },
      ],
    },
  })

  assert.equal(analysisExecution.exitCode, 0)
  assert.equal(analysisExecution.result.ok, true)

  const execution = await runFrontendRealAdapterFromAnalysis({
    analysisResult: analysisExecution.result,
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.equal(execution.result.adapter.toolchain.target, 'wasm')
  assert.equal(execution.result.adapter.toolchain.llvmTarget, 'wasm32-unknown-wasi')
  assert.deepEqual(execution.result.adapter.buildContext, {
    target: 'wasm',
    llvmTarget: 'wasm32-unknown-wasi',
    goos: 'js',
    goarch: 'wasm',
    gc: 'precise',
    scheduler: 'tasks',
    buildTags: ['scheduler.tasks', 'tinygo.wasm'],
    modulePath: 'example.com/app',
  })
  assert.equal(execution.result.adapter.compileUnitManifestPath, '/working/tinygo-compile-unit.json')
  assert.equal(execution.result.adapter.compileGroups.length, 4)
  assert.deepEqual(execution.result.adapter.allCompileFiles, [
    '/working/.tinygo-root/src/fmt/print.go',
    '/workspace/lib/helper.go',
    '/workspace/main.go',
  ])
  assert.deepEqual(execution.result.adapter.packageGraph, [
    {
      depOnly: false,
      dir: '/workspace',
      files: { goFiles: ['main.go'] },
      importPath: 'command-line-arguments',
      imports: ['example.com/app/lib'],
      modulePath: 'example.com/app',
      name: 'main',
      standard: false,
    },
    {
      depOnly: true,
      dir: '/workspace/lib',
      files: { goFiles: ['helper.go'] },
      importPath: 'example.com/app/lib',
      imports: ['fmt'],
      modulePath: 'example.com/app',
      name: 'helper',
      standard: false,
    },
    {
      depOnly: true,
      dir: '/working/.tinygo-root/src/fmt',
      files: { goFiles: ['print.go'] },
      importPath: 'fmt',
      imports: ['errors', 'io'],
      modulePath: '',
      name: 'fmt',
      standard: true,
    },
  ])
  assert.match(execution.logs.join('\n'), /tinygo frontend prepared real adapter handoff/)
})

test('wasi frontend-real-adapter-build consumes normalized real-adapter handoff', async () => {
  const input = {
    buildTags: ['tinygo.wasm', 'scheduler.tasks'],
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'tasks',
      buildTags: ['scheduler.tasks', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
    optimizeFlag: '-Oz',
    entryFile: '/workspace/main.go',
    modulePath: 'example.com/app',
    sourceSelection: {
      allCompile: [
        '/working/.tinygo-root/src/fmt/print.go',
        '/workspace/lib/helper.go',
        '/workspace/main.go',
      ],
    },
    compileUnits: [
      {
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['example.com/app/lib'],
        modulePath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
      {
        kind: 'imported',
        importPath: 'example.com/app/lib',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        packageName: 'helper',
        packageDir: '/workspace/lib',
        files: ['/workspace/lib/helper.go'],
      },
      {
        kind: 'stdlib',
        importPath: 'fmt',
        imports: ['errors', 'io'],
        modulePath: '',
        packageName: 'fmt',
        packageDir: '/working/.tinygo-root/src/fmt',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
      },
    ],
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'command-line-arguments',
        imports: ['example.com/app/lib'],
        modulePath: 'example.com/app',
        name: 'main',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/workspace/lib',
        files: { goFiles: ['helper.go'] },
        importPath: 'example.com/app/lib',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        name: 'helper',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/working/.tinygo-root/src/fmt',
        files: { goFiles: ['print.go'] },
        importPath: 'fmt',
        imports: ['errors', 'io'],
        modulePath: '',
        name: 'fmt',
        standard: true,
      },
    ],
  }
  const analysisExecution = await runFrontendAnalysis({ input, files: {} })
  assert.equal(analysisExecution.exitCode, 0)
  assert.equal(analysisExecution.result.ok, true)

  const adapterExecution = await runFrontendRealAdapterFromAnalysis({
    analysisResult: analysisExecution.result,
    files: {},
  })
  assert.equal(adapterExecution.exitCode, 0)
  assert.equal(adapterExecution.result.ok, true)
  adapterExecution.result.adapter.compileUnits[0].importPath = 'example.com/app'
  adapterExecution.result.adapter.packageGraph[0].importPath = 'example.com/app'

  const execution = await runFrontendFromRealAdapter({
    adapterResult: adapterExecution.result,
    files: {},
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.equal(execution.result.generatedFiles.length, 7)

  const directExecution = await runFrontend({ analysisResult: analysisExecution.result, files: {} })
  assert.equal(directExecution.exitCode, 0)
  assert.equal(directExecution.result.ok, true)
  assert.match(execution.logs.join('\n'), /tinygo frontend prepared bootstrap compile request/)
  assert.match(execution.logs.join('\n'), /tinygo frontend consuming real adapter handoff/)
  const compileUnitFile = execution.result.generatedFiles.find((file) => file.path === '/working/tinygo-compile-unit.json')
  assert.ok(compileUnitFile)
  const compileUnitManifest = JSON.parse(compileUnitFile.contents)
  assert.equal(compileUnitManifest.compileUnits[0].importPath, 'example.com/app')
  assert.equal(compileUnitManifest.optimizeFlag, '-Oz')
  assert.equal(compileUnitManifest.toolchain.artifactOutputPath, '/working/out.wasm')
})

test('wasi frontend-real-adapter writes package-focused adapter analysis', async () => {
  const execution = await runFrontendRealAdapter({
    input: {
      buildTags: ['tinygo.wasm', 'scheduler.tasks'],
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'tasks',
        buildTags: ['scheduler.tasks', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      toolchain: {
        target: 'wasm',
        artifactOutputPath: '/working/out.wasm',
      },
      optimizeFlag: '-Oz',
      entryFile: '/workspace/main.go',
      modulePath: 'example.com/app',
      sourceSelection: {
        allCompile: [
          '/working/.tinygo-root/src/fmt/print.go',
          '/workspace/lib/helper.go',
          '/workspace/main.go',
        ],
      },
      compileUnits: [
        {
          kind: 'program',
          importPath: 'command-line-arguments',
          imports: ['example.com/app/lib'],
          packageName: 'main',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
        },
        {
          kind: 'imported',
          importPath: 'example.com/app/lib',
          imports: ['fmt'],
          packageName: 'helper',
          packageDir: '/workspace/lib',
          files: ['/workspace/lib/helper.go'],
        },
        {
          kind: 'stdlib',
          importPath: 'fmt',
          imports: ['errors', 'io'],
          packageName: 'fmt',
          packageDir: '/working/.tinygo-root/src/fmt',
          files: ['/working/.tinygo-root/src/fmt/print.go'],
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: '/workspace',
          files: { goFiles: ['main.go'] },
          importPath: 'command-line-arguments',
          imports: ['example.com/app/lib'],
          name: 'main',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/workspace/lib',
          files: { goFiles: ['helper.go'] },
          importPath: 'example.com/app/lib',
          imports: ['fmt'],
          name: 'helper',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/working/.tinygo-root/src/fmt',
          files: { goFiles: ['print.go'] },
          importPath: 'fmt',
          imports: ['errors', 'io'],
          name: 'fmt',
          standard: true,
        },
      ],
    },
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.equal(execution.result.adapter.toolchain.target, 'wasm')
  assert.equal(execution.result.adapter.toolchain.llvmTarget, 'wasm32-unknown-wasi')
  assert.deepEqual(execution.result.adapter.buildContext, {
    target: 'wasm',
    llvmTarget: 'wasm32-unknown-wasi',
    goos: 'js',
    goarch: 'wasm',
    gc: 'precise',
    scheduler: 'tasks',
    buildTags: ['scheduler.tasks', 'tinygo.wasm'],
    modulePath: 'example.com/app',
  })
  assert.equal(execution.result.adapter.compileUnitManifestPath, '/working/tinygo-compile-unit.json')
  assert.deepEqual(execution.result.adapter.compileGroups, [
    { name: 'program', files: ['/workspace/main.go'] },
    { name: 'imported', files: ['/workspace/lib/helper.go'] },
    { name: 'stdlib', files: ['/working/.tinygo-root/src/fmt/print.go'] },
    { name: 'all-compile', files: ['/working/.tinygo-root/src/fmt/print.go', '/workspace/lib/helper.go', '/workspace/main.go'] },
  ])
  assert.deepEqual(execution.result.adapter.packageGraph, [
    {
      depOnly: false,
      dir: '/workspace',
      files: { goFiles: ['main.go'] },
      importPath: 'command-line-arguments',
      imports: ['example.com/app/lib'],
      modulePath: 'example.com/app',
      name: 'main',
      standard: false,
    },
    {
      depOnly: true,
      dir: '/workspace/lib',
      files: { goFiles: ['helper.go'] },
      importPath: 'example.com/app/lib',
      imports: ['fmt'],
      modulePath: 'example.com/app',
      name: 'helper',
      standard: false,
    },
    {
      depOnly: true,
      dir: '/working/.tinygo-root/src/fmt',
      files: { goFiles: ['print.go'] },
      importPath: 'fmt',
      imports: ['errors', 'io'],
      modulePath: '',
      name: 'fmt',
      standard: true,
    },
  ])
  assert.match(execution.logs.join('\n'), /tinygo frontend prepared real adapter handoff/)
})

test('wasi frontend-real-adapter fills missing package facts from packageGraph', async () => {
  const execution = await runFrontendRealAdapter({
    input: {
      buildTags: ['tinygo.wasm', 'scheduler.tasks'],
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'tasks',
        buildTags: ['scheduler.tasks', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      toolchain: {
        target: 'wasm',
        artifactOutputPath: '/working/out.wasm',
      },
      optimizeFlag: '-Oz',
      entryFile: '/workspace/main.go',
      modulePath: 'example.com/app',
      sourceSelection: {
        allCompile: [
          '/working/.tinygo-root/src/fmt/print.go',
          '/workspace/lib/helper.go',
          '/workspace/main.go',
        ],
      },
      compileUnits: [
        {
          kind: 'program',
          importPath: 'command-line-arguments',
          files: ['/workspace/main.go'],
        },
        {
          kind: 'imported',
          importPath: 'example.com/app/lib',
          files: ['/workspace/lib/helper.go'],
        },
        {
          kind: 'stdlib',
          importPath: 'fmt',
          files: ['/working/.tinygo-root/src/fmt/print.go'],
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: '/workspace',
          files: { goFiles: ['main.go'] },
          importPath: 'command-line-arguments',
          imports: ['example.com/app/lib'],
          name: 'main',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/workspace/lib',
          files: { goFiles: ['helper.go'] },
          importPath: 'example.com/app/lib',
          imports: ['fmt'],
          name: 'helper',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/working/.tinygo-root/src/fmt',
          files: { goFiles: ['print.go'] },
          importPath: 'fmt',
          imports: ['errors', 'io'],
          name: 'fmt',
          standard: true,
        },
      ],
    },
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.deepEqual(execution.result.adapter.compileUnits, [
    {
      depOnly: false,
      kind: 'program',
      importPath: 'command-line-arguments',
      imports: ['example.com/app/lib'],
      modulePath: 'example.com/app',
      packageName: 'main',
      packageDir: '/workspace',
      files: ['/workspace/main.go'],
      standard: false,
    },
    {
      depOnly: true,
      kind: 'imported',
      importPath: 'example.com/app/lib',
      imports: ['fmt'],
      modulePath: 'example.com/app',
      packageName: 'helper',
      packageDir: '/workspace/lib',
      files: ['/workspace/lib/helper.go'],
      standard: false,
    },
    {
      depOnly: true,
      kind: 'stdlib',
      importPath: 'fmt',
      imports: ['errors', 'io'],
      modulePath: '',
      packageName: 'fmt',
      packageDir: '/working/.tinygo-root/src/fmt',
      files: ['/working/.tinygo-root/src/fmt/print.go'],
      standard: true,
    },
  ])
})

test('wasi backend consumes backend input', async () => {
  const execution = await runBackend({
    input: {
      entryFile: '/workspace/main.go',
      optimizeFlag: '-Oz',
      compileJobs: [
        {
          id: 'program-000',
          kind: 'program',
          importPath: 'command-line-arguments',
          imports: ['errors'],
          depOnly: false,
          modulePath: 'example.com/app',
          packageName: 'main',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
          bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
          llvmTarget: 'wasm32-unknown-wasi',
          cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
          optimizeFlag: '-Oz',
          standard: false,
        },
        {
          id: 'stdlib-000',
          kind: 'stdlib',
          importPath: 'errors',
          imports: [],
          depOnly: true,
          modulePath: '',
          packageName: 'errors',
          packageDir: '/working/.tinygo-root/src/errors',
          files: ['/working/.tinygo-root/src/errors/errors.go'],
          bitcodeOutputPath: '/working/tinygo-work/stdlib-000.bc',
          llvmTarget: 'wasm32-unknown-wasi',
          cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
          optimizeFlag: '-Oz',
          standard: true,
        },
      ],
      linkJob: {
        linker: 'wasm-ld',
        ldflags: ['--stack-first', '--no-demangle', '--no-entry', '--export-all'],
        artifactOutputPath: '/working/out.wasm',
      },
    },
  })

  assert.equal(execution.exitCode, 0)
  assert.equal(execution.result.ok, true)
  assert.equal(execution.result.generatedFiles.length, 9)
  assert.deepEqual(execution.result.generatedFiles, [
    {
      path: '/working/tinygo-lowered-sources.json',
      contents: execution.result.generatedFiles[0].contents,
    },
    {
      path: '/working/tinygo-lowered-bitcode.json',
      contents: execution.result.generatedFiles[1].contents,
    },
    {
      path: '/working/tinygo-lowered/program-000.c',
      contents: execution.result.generatedFiles[2].contents,
    },
    {
      path: '/working/tinygo-lowered/stdlib-000.c',
      contents: execution.result.generatedFiles[3].contents,
    },
    {
      path: '/working/tinygo-lowered-ir.json',
      contents: execution.result.generatedFiles[4].contents,
    },
    {
      path: '/working/tinygo-lowered-command-batch.json',
      contents: execution.result.generatedFiles[5].contents,
    },
    {
      path: '/working/tinygo-lowered-artifact.json',
      contents: execution.result.generatedFiles[6].contents,
    },
    {
      path: '/working/tinygo-command-artifact.json',
      contents: execution.result.generatedFiles[7].contents,
    },
    {
      path: '/working/tinygo-command-batch.json',
      contents: execution.result.generatedFiles[8].contents,
    },
  ])
  const loweredSourcesManifest = JSON.parse(execution.result.generatedFiles[0].contents)
  assert.deepEqual(loweredSourcesManifest.units, [
    {
      id: 'program-000',
      kind: 'program',
      importPath: 'command-line-arguments',
      imports: ['errors'],
      depOnly: false,
      modulePath: 'example.com/app',
      packageName: 'main',
      packageDir: '/workspace',
      sourceFiles: ['/workspace/main.go'],
      loweredSourcePath: '/working/tinygo-lowered/program-000.c',
      standard: false,
    },
    {
      id: 'stdlib-000',
      kind: 'stdlib',
      importPath: 'errors',
      imports: [],
      depOnly: true,
      modulePath: '',
      packageName: 'errors',
      packageDir: '/working/.tinygo-root/src/errors',
      sourceFiles: ['/working/.tinygo-root/src/errors/errors.go'],
      loweredSourcePath: '/working/tinygo-lowered/stdlib-000.c',
      standard: true,
    },
  ])
  const loweredBitcodeManifest = JSON.parse(execution.result.generatedFiles[1].contents)
  assert.deepEqual(loweredBitcodeManifest.bitcodeFiles, [
    '/working/tinygo-work/program-000.bc',
    '/working/tinygo-work/stdlib-000.bc',
  ])
  assert.match(execution.result.generatedFiles[2].contents, /tinygo_lowered_program_000_id/)
  assert.match(execution.result.generatedFiles[3].contents, /tinygo_lowered_stdlib_000_kind_tag/)
  const loweredIRManifest = JSON.parse(execution.result.generatedFiles[4].contents)
  assert.deepEqual(loweredIRManifest.units, [
    {
      id: 'program-000',
      kind: 'program',
      importPath: 'command-line-arguments',
      modulePath: 'example.com/app',
      packageDir: '/workspace',
      sourceFiles: ['/workspace/main.go'],
      loweredSourcePath: '/working/tinygo-lowered/program-000.c',
      packageName: 'main',
      imports: [],
      functions: [],
      types: [],
      constants: [],
      variables: [],
      declarations: [],
      placeholderBlocks: [],
      loweringBlocks: [],
    },
    {
      id: 'stdlib-000',
      kind: 'stdlib',
      importPath: 'errors',
      modulePath: '',
      packageDir: '/working/.tinygo-root/src/errors',
      sourceFiles: ['/working/.tinygo-root/src/errors/errors.go'],
      loweredSourcePath: '/working/tinygo-lowered/stdlib-000.c',
      packageName: 'errors',
      imports: [],
      functions: [],
      types: [],
      constants: [],
      variables: [],
      declarations: [],
      placeholderBlocks: [],
      loweringBlocks: [],
    },
  ])
  const loweredCommandBatchManifest = JSON.parse(execution.result.generatedFiles[5].contents)
  assert.deepEqual(loweredCommandBatchManifest.compileCommands, [
    {
      argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-lowered/program-000.o'],
      cwd: '/working',
    },
    {
      argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext', '-c', '/working/tinygo-lowered/stdlib-000.c', '-o', '/working/tinygo-lowered/stdlib-000.o'],
      cwd: '/working',
    },
  ])
  assert.deepEqual(loweredCommandBatchManifest.linkCommand, {
    argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '--no-entry', '--export-all', '/working/tinygo-lowered/program-000.o', '/working/tinygo-lowered/stdlib-000.o', '-o', '/working/tinygo-lowered-out.wasm'],
    cwd: '/working',
  })
  const loweredArtifactManifest = JSON.parse(execution.result.generatedFiles[6].contents)
  assert.deepEqual(loweredArtifactManifest, {
    artifactOutputPath: '/working/tinygo-lowered-out.wasm',
    artifactKind: 'probe',
    entrypoint: null,
    objectFiles: [
      '/working/tinygo-lowered/program-000.o',
      '/working/tinygo-lowered/stdlib-000.o',
    ],
    reason: 'missing-wasi-entrypoint',
    runnable: false,
  })
  const commandArtifactManifest = JSON.parse(execution.result.generatedFiles[7].contents)
  assert.deepEqual(commandArtifactManifest, {
    artifactOutputPath: '/working/out.wasm',
    artifactKind: 'probe',
    bitcodeFiles: [
      '/working/tinygo-work/program-000.bc',
      '/working/tinygo-work/stdlib-000.bc',
    ],
    entrypoint: null,
    reason: 'missing-wasi-entrypoint',
    runnable: false,
  })
  const commandBatchManifest = JSON.parse(execution.result.generatedFiles[8].contents)
  assert.deepEqual(commandBatchManifest.compileCommands, [
    {
      argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext', '-emit-llvm', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-work/program-000.bc'],
      cwd: '/working',
    },
    {
      argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext', '-emit-llvm', '-c', '/working/tinygo-lowered/stdlib-000.c', '-o', '/working/tinygo-work/stdlib-000.bc'],
      cwd: '/working',
    },
  ])
  assert.deepEqual(commandBatchManifest.linkCommand, {
    argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '--no-entry', '--export-all', '/working/tinygo-work/program-000.bc', '/working/tinygo-work/stdlib-000.bc', '-o', '/working/out.wasm'],
    cwd: '/working',
  })
  assert.match(execution.result.diagnostics[0], /backend prepared 2 compile jobs/)
})
