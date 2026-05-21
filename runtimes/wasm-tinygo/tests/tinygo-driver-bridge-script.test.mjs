import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('probe-tinygo-driver-bridge writes a normalized bridge manifest', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-driver-bridge-script-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeBinDir = path.join(tempDir, 'bin')
  await mkdir(fakeBinDir, { recursive: true })

const fakeGoPath = path.join(fakeBinDir, 'go')
  await writeFile(fakeGoPath, `#!/bin/sh
set -eu
node - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
if (process.env.WASM_TINYGO_MODE === 'frontend') {
  if (!process.env.WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH) {
    throw new Error('frontend expected WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH')
  }
  if (process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH) {
    throw new Error('frontend should not receive WASM_TINYGO_FRONTEND_ANALYSIS_PATH once adapter-only bridge execution is supported')
  }
  if (process.env.WASM_TINYGO_FRONTEND_ENV_RECORD_PATH) {
    fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_ENV_RECORD_PATH, JSON.stringify({
      analysisPath: process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH ?? null,
      inputPath: process.env.WASM_TINYGO_FRONTEND_INPUT_PATH ?? null,
      realAdapterPath: process.env.WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH ?? null,
    }, null, 2))
  }
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  const adapterResult = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH, 'utf8'))
  const adapter = adapterResult.adapter ?? {}
  const programPackage = (adapter.packageGraph ?? []).find((packageInfo) => !packageInfo.depOnly && packageInfo.importPath)
  const compileUnits = (adapter.compileUnits ?? []).map((compileUnit) => {
    const packageInfo = (adapter.packageGraph ?? []).find((candidate) => candidate.importPath === compileUnit.importPath)
      ?? (compileUnit.kind === 'program' && compileUnit.importPath === 'command-line-arguments' ? programPackage : undefined)
    return {
      ...compileUnit,
      importPath: compileUnit.kind === 'program' && compileUnit.importPath === 'command-line-arguments' && packageInfo?.importPath ? packageInfo.importPath : compileUnit.importPath,
      imports: (compileUnit.imports ?? []).length === 0 && (packageInfo?.imports ?? []).length > 0 ? packageInfo.imports : (compileUnit.imports ?? []),
      packageDir: compileUnit.packageDir ?? packageInfo?.dir,
      packageName: compileUnit.packageName ?? packageInfo?.name,
      files: (compileUnit.files ?? []).length === 0 && packageInfo?.dir ? (packageInfo.files?.goFiles ?? []).map((goFile) => path.join(packageInfo.dir, goFile)) : (compileUnit.files ?? []),
    }
  })
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_RESULT_PATH, JSON.stringify({
    ok: true,
    generatedFiles: [
      {
        path: '/working/tinygo-compile-unit.json',
        contents: JSON.stringify({
          entryFile: adapter.entryFile,
          toolchain: {
            ...(input.toolchain ?? {}),
            ...(adapter.toolchain ?? {}),
          },
          sourceSelection: { allCompile: adapter.allCompileFiles ?? [] },
          compileUnits,
        }),
      },
    ],
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-analysis-build') {
  throw new Error('frontend bridge verification should use frontend')
}
if (process.env.WASM_TINYGO_MODE === 'frontend-analysis') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  if (Array.isArray(input.compileUnits)) {
    throw new Error('frontend-analysis expected packageGraph-only input')
  }
  const compileUnits = (input.packageGraph ?? []).map((packageInfo) => ({
    depOnly: packageInfo.depOnly ?? false,
    files: (packageInfo.files?.goFiles ?? []).map((goFile) => path.join(packageInfo.dir, goFile)),
    importPath: packageInfo.importPath,
    imports: packageInfo.imports ?? [],
    kind: packageInfo.depOnly ? (packageInfo.standard ? 'stdlib' : 'imported') : 'program',
    modulePath: packageInfo.modulePath ?? '',
    packageDir: packageInfo.dir,
    packageName: packageInfo.name,
    standard: packageInfo.standard ?? false,
  }))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, JSON.stringify({
    ok: true,
    analysis: {
      buildContext: input.buildContext,
      entryFile: input.entryFile,
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: input.sourceSelection?.allCompile ?? [],
      compileGroups: [
        { name: 'program', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'program').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'all-compile', files: input.sourceSelection?.allCompile ?? [] },
      ],
      compileUnits,
      packageGraph: input.packageGraph,
      toolchain: {
        target: input.toolchain?.target,
        llvmTarget: input.buildContext?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-real-adapter') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  const entryPackage = (input.packageGraph ?? []).find((packageInfo) => !packageInfo.depOnly && packageInfo.importPath)
  const compileUnits = (input.compileUnits ?? []).map((compileUnit) => {
    const packageInfo = (input.packageGraph ?? []).find((candidate) => candidate.importPath === compileUnit.importPath)
      ?? (compileUnit.kind === 'program' && compileUnit.importPath === 'command-line-arguments' ? entryPackage : undefined)
    return {
      ...compileUnit,
      modulePath: compileUnit.modulePath ?? packageInfo?.modulePath ?? '',
      importPath: compileUnit.kind === 'program' && compileUnit.importPath === 'command-line-arguments' && entryPackage?.importPath ? entryPackage.importPath : compileUnit.importPath,
      imports: (compileUnit.imports ?? []).length === 0 && (packageInfo?.imports ?? []).length > 0 ? packageInfo.imports : (compileUnit.imports ?? []),
      depOnly: compileUnit.kind === 'program' ? false : (compileUnit.depOnly ?? true),
      packageDir: compileUnit.packageDir ?? packageInfo?.dir,
      packageName: compileUnit.packageName ?? packageInfo?.name,
      files: (compileUnit.files ?? []).length === 0 && packageInfo?.dir ? (packageInfo.files?.goFiles ?? []).map((goFile) => path.join(packageInfo.dir, goFile)) : (compileUnit.files ?? []),
      standard: compileUnit.kind === 'stdlib' ? true : (compileUnit.standard ?? false),
    }
  })
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH, JSON.stringify({
    ok: true,
    adapter: {
      buildContext: input.buildContext,
      entryFile: input.entryFile,
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: input.sourceSelection?.allCompile ?? [],
      compileGroups: [
        { name: 'program', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'program').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'imported', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'imported').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'stdlib', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'stdlib').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'all-compile', files: input.sourceSelection?.allCompile ?? [] },
      ],
      compileUnits,
      packageGraph: input.packageGraph ?? [],
      toolchain: {
        target: input.toolchain?.target,
        llvmTarget: input.buildContext?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
const request = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_REQUEST_PATH, 'utf8'))
fs.writeFileSync(process.env.WASM_TINYGO_RESULT_PATH, JSON.stringify({
  ok: true,
  files: [
    {
      path: '/working/tinygo-frontend-input.json',
      contents: JSON.stringify({
        buildContext: {
          target: request.target,
          llvmTarget: 'wasm32-unknown-wasi',
          goos: 'wasip1',
          goarch: 'wasm',
          gc: 'precise',
          scheduler: request.scheduler ?? 'tasks',
          buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
          modulePath: 'example.com/fake',
        },
        entryFile: request.entry,
        modulePath: 'example.com/fake',
        toolchain: {
          target: request.target,
          artifactOutputPath: request.output,
        },
        sourceSelection: {
          program: [request.entry],
          allCompile: [request.entry, '/working/.tinygo-root/src/fmt/print.go'],
        },
        compileUnits: [
          {
            kind: 'program',
            importPath: 'command-line-arguments',
            packageName: 'main',
            packageDir: path.dirname(request.entry),
            files: [request.entry],
          },
          {
            kind: 'stdlib',
            importPath: 'fmt',
            packageName: 'fmt',
            packageDir: '/working/.tinygo-root/src/fmt',
            files: ['/working/.tinygo-root/src/fmt/print.go'],
          },
        ],
        packageGraph: [
          {
            depOnly: false,
            dir: path.dirname(request.entry),
            files: { goFiles: [path.basename(request.entry)] },
            importPath: 'example.com/fake',
            imports: ['fmt'],
            modulePath: 'example.com/fake',
            name: 'main',
            standard: false,
          },
          {
            depOnly: true,
            dir: '/working/.tinygo-root/src/fmt',
            files: { goFiles: ['print.go'] },
            importPath: 'fmt',
            imports: ['errors'],
            modulePath: '',
            name: 'fmt',
            standard: true,
          },
        ],
      }),
    },
  ],
  metadata: {
    buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
    gc: 'precise',
    goarch: 'wasm',
    goos: 'wasip1',
    llvmTarget: 'wasm32-unknown-wasi',
    optimize: '-Oz',
    panicStrategy: request.panic ?? 'print',
    scheduler: request.scheduler ?? 'asyncify',
  },
}, null, 2))
NODE
`)
  await chmod(fakeGoPath, 0o755)

  const fakeTinyGoPath = path.join(fakeBinDir, 'tinygo')
  await writeFile(fakeTinyGoPath, `#!/bin/sh
set -eu
if [ "$1" = "info" ]; then
  cat <<'EOF'
LLVM triple:       wasm32-unknown-wasi
GOOS:              wasip1
GOARCH:            wasm
build tags:        gc.precise scheduler.tasks tinygo purego tinygo.unicore tinygo.wasm
garbage collector: precise
scheduler:         tasks
EOF
  exit 0
fi
if [ "$1" = "list" ]; then
  cat <<EOF
{
  "Dir": "$(pwd)",
  "ImportPath": "example.com/fake",
  "Module": {
    "Path": "example.com/fake"
  },
  "Name": "main",
  "GoFiles": [
    "main.go"
  ],
  "Imports": [
    "fmt"
  ]
}
{
  "Dir": "/working/.tinygo-root/src/fmt",
  "ImportPath": "fmt",
  "Name": "fmt",
  "GoFiles": [
    "print.go"
  ],
  "Imports": [
    "errors"
  ],
  "DepOnly": true,
  "Standard": true
}
EOF
  exit 0
fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
mkdir -p "$(dirname "$out")"
printf '\\000asm\\001\\000\\000\\000' > "$out"
`)
  await chmod(fakeTinyGoPath, 0o755)

  const fakeTinyGoRoot = path.join(tempDir, 'tinygo-root')
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys'), { recursive: true })
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'device', 'arm'), { recursive: true })
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys', 'zversion.go'), 'package sys\n')
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'device', 'arm', 'arm.go'), 'package arm\n')

  const workspaceDir = path.join(tempDir, 'workspace')
  await mkdir(workspaceDir, { recursive: true })
  const entryPath = path.join(workspaceDir, 'main.go')
  const outputPath = path.join(workspaceDir, 'out.wasm')
  const requestPath = path.join(workspaceDir, 'tinygo-request.json')
  const bridgeManifestPath = path.join(workspaceDir, 'tinygo-driver-bridge.json')
  const frontendEnvRecordPath = path.join(workspaceDir, 'tinygo-frontend-env.json')

  await writeFile(entryPath, 'package main\n\nfunc main() {}\n')
  await writeFile(requestPath, JSON.stringify({
    command: 'build',
    planner: 'tinygo',
    entry: entryPath,
    optimize: 'z',
    output: outputPath,
    panic: 'trap',
    scheduler: 'tasks',
    target: 'wasip1',
  }))

  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/probe-tinygo-driver-bridge.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_DRIVER_BRIDGE_MANIFEST_PATH: bridgeManifestPath,
      WASM_TINYGO_FRONTEND_ENV_RECORD_PATH: frontendEnvRecordPath,
      WASM_TINYGO_GO_BIN: fakeGoPath,
      WASM_TINYGO_HOST_PROBE_REQUEST_PATH: requestPath,
      WASM_TINYGO_HOST_PROBE_SKIP_RUNTIME: '1',
      WASM_TINYGO_TINYGOROOT: fakeTinyGoRoot,
      WASM_TINYGO_TINYGO_BIN: fakeTinyGoPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })

  assert.equal(exitCode, 0, output)
  const manifest = JSON.parse(await readFile(bridgeManifestPath, 'utf8'))
  assert.equal(manifest.target, 'wasip1')
  assert.equal(manifest.llvmTriple, 'wasm32-unknown-wasi')
  assert.equal(manifest.scheduler, 'tasks')
  assert.equal(manifest.artifactOutputPath, outputPath)
  assert.equal(manifest.entryFile, entryPath)
  assert.deepEqual(manifest.entryPackage, {
    dir: workspaceDir,
    goFiles: ['main.go'],
    importPath: 'example.com/fake',
    imports: ['fmt'],
    name: 'main',
  })
  assert.deepEqual(manifest.packageGraph, [
    {
      depOnly: false,
      dir: workspaceDir,
      goFiles: ['main.go'],
      importPath: 'example.com/fake',
      imports: ['fmt'],
      modulePath: 'example.com/fake',
      name: 'main',
      standard: false,
    },
    {
      depOnly: true,
      dir: '/working/.tinygo-root/src/fmt',
      goFiles: ['print.go'],
      importPath: 'fmt',
      imports: ['errors'],
      modulePath: '',
      name: 'fmt',
      standard: true,
    },
  ])
  assert.deepEqual(manifest.frontendAnalysisInput, {
    buildContext: {
      target: 'wasip1',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'wasip1',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'tasks',
      buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
      modulePath: 'example.com/fake',
    },
    entryFile: entryPath,
    modulePath: 'example.com/fake',
    sourceSelection: {
      program: [entryPath],
      allCompile: [entryPath, '/working/.tinygo-root/src/fmt/print.go'],
    },
    toolchain: {
      target: 'wasip1',
      llvmTarget: 'wasm32-unknown-wasi',
      artifactOutputPath: outputPath,
    },
    packageGraph: [
      {
        depOnly: false,
        dir: workspaceDir,
        files: { goFiles: ['main.go'] },
        importPath: 'example.com/fake',
        imports: ['fmt'],
        modulePath: 'example.com/fake',
        name: 'main',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/working/.tinygo-root/src/fmt',
        files: { goFiles: ['print.go'] },
        importPath: 'fmt',
        imports: ['errors'],
        modulePath: '',
        name: 'fmt',
        standard: true,
      },
    ],
  })
  assert.deepEqual(manifest.frontendHandoff, {
    artifactOutputPath: outputPath,
    bridgeEntryGoFiles: [entryPath],
    bridgeEntryImportPath: 'example.com/fake',
    bridgeEntryImports: ['fmt'],
    bridgeEntryPackageDir: workspaceDir,
    bridgeEntryPackageName: 'main',
    bridgePackageCount: 1,
    bridgePackageGraphImportPaths: ['fmt'],
    compileUnitCount: 2,
    compileUnitFileCount: 2,
    compileUnitImportPaths: ['fmt'],
    bridgeFileCount: 2,
    coveredFileCount: 2,
    coveredPackageCount: 1,
    depOnlyPackageCount: 1,
    entryFile: entryPath,
    graphPackageCount: 2,
    llvmTarget: 'wasm32-unknown-wasi',
    localPackageCount: 1,
    programFiles: [entryPath],
    programImportAlias: 'direct',
    programImportPath: 'example.com/fake',
    programPackageDir: workspaceDir,
    programPackageName: 'main',
    standardPackageCount: 1,
    target: 'wasip1',
  })
  assert.equal(manifest.frontendAnalysis, undefined)
  assert.deepEqual(manifest.frontendAnalysisInput, {
    buildContext: {
      target: 'wasip1',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'wasip1',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'tasks',
      buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
      modulePath: 'example.com/fake',
    },
    entryFile: entryPath,
    modulePath: 'example.com/fake',
    sourceSelection: {
      program: [entryPath],
      allCompile: [entryPath, '/working/.tinygo-root/src/fmt/print.go'],
    },
    toolchain: {
      artifactOutputPath: outputPath,
      llvmTarget: 'wasm32-unknown-wasi',
      target: 'wasip1',
    },
    packageGraph: [
      {
        depOnly: false,
        dir: workspaceDir,
        files: { goFiles: ['main.go'] },
        importPath: 'example.com/fake',
        imports: ['fmt'],
        modulePath: 'example.com/fake',
        name: 'main',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/working/.tinygo-root/src/fmt',
        files: { goFiles: ['print.go'] },
        importPath: 'fmt',
        imports: ['errors'],
        modulePath: '',
        name: 'fmt',
        standard: true,
      },
    ],
  })
  assert.deepEqual(manifest.frontendRealAdapter, {
    buildContext: {
      buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
      gc: 'precise',
      goarch: 'wasm',
      goos: 'wasip1',
      llvmTarget: 'wasm32-unknown-wasi',
      modulePath: 'example.com/fake',
      scheduler: 'tasks',
      target: 'wasip1',
    },
    allCompileFiles: [entryPath, '/working/.tinygo-root/src/fmt/print.go'],
    compileGroups: [
      { files: [entryPath], name: 'program' },
      { files: [], name: 'imported' },
      { files: ['/working/.tinygo-root/src/fmt/print.go'], name: 'stdlib' },
      { files: [entryPath, '/working/.tinygo-root/src/fmt/print.go'], name: 'all-compile' },
    ],
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    compileUnits: [
      {
        depOnly: false,
        files: [entryPath],
        importPath: 'example.com/fake',
        imports: ['fmt'],
        kind: 'program',
        modulePath: 'example.com/fake',
        packageDir: workspaceDir,
        packageName: 'main',
        standard: false,
      },
      {
        depOnly: true,
        files: ['/working/.tinygo-root/src/fmt/print.go'],
        importPath: 'fmt',
        imports: ['errors'],
        kind: 'stdlib',
        modulePath: '',
        packageDir: '/working/.tinygo-root/src/fmt',
        packageName: 'fmt',
        standard: true,
      },
    ],
    entryFile: entryPath,
    packageGraph: [
      {
        depOnly: false,
        dir: workspaceDir,
        files: { goFiles: ['main.go'] },
        importPath: 'example.com/fake',
        imports: ['fmt'],
        modulePath: 'example.com/fake',
        name: 'main',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/working/.tinygo-root/src/fmt',
        files: { goFiles: ['print.go'] },
        importPath: 'fmt',
        imports: ['errors'],
        modulePath: '',
        name: 'fmt',
        standard: true,
      },
    ],
    toolchain: {
      llvmTarget: 'wasm32-unknown-wasi',
      target: 'wasip1',
    },
  })
  assert.deepEqual(manifest.realFrontendAnalysis, manifest.frontendRealAdapter)
  assert.equal(manifest.hostArtifact.artifactKind, 'probe')
  assert.equal(manifest.hostArtifact.bytesBase64, 'AGFzbQEAAAA=')
  assert.deepEqual(manifest.hostArtifact.command.slice(0, 9), [
    fakeTinyGoPath,
    'build',
    '-target',
    'wasip1',
    '-opt',
    'z',
    '-scheduler',
    'tasks',
    '-panic',
  ])
  assert.equal(manifest.hostArtifact.command[9], 'trap')
  assert.equal(manifest.hostArtifact.command[10], '-o')
  assert.match(manifest.hostArtifact.command[11], /tinygo-bridge-execution\.wasm$/)
  assert.equal(manifest.hostArtifact.command[12], entryPath)
  assert.equal(manifest.hostArtifact.entrypoint, null)
  assert.deepEqual(manifest.hostArtifact.logs, [])
  assert.equal(manifest.hostArtifact.path, outputPath)
  assert.equal(manifest.hostArtifact.reason, 'missing-wasi-entrypoint')
  assert.equal(manifest.hostArtifact.runnable, false)
  assert.equal(manifest.hostArtifact.size, 8)
  assert.equal(manifest.hostArtifact.target, 'wasip1')
  assert.deepEqual(manifest.driverBuildTags, ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'])
  assert.deepEqual(manifest.hostBuildTags, ['gc.precise', 'purego', 'scheduler.tasks', 'tinygo', 'tinygo.unicore', 'tinygo.wasm'])
  assert.equal(manifest.driverResultPath, path.join(workspaceDir, 'tinygo-result.json'))
  assert.equal(manifest.hostProbeManifestPath, path.join(workspaceDir, 'tinygo-host-probe.json'))
  assert.deepEqual(JSON.parse(await readFile(frontendEnvRecordPath, 'utf8')), {
    analysisPath: null,
    inputPath: path.join(workspaceDir, 'tinygo-frontend-input.json'),
    realAdapterPath: path.join(workspaceDir, 'tinygo-frontend-real-adapter.json'),
  })
})

test('probe-tinygo-driver-bridge passes a packageGraph-only input to frontend-analysis', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-driver-bridge-script-analysis-only-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeBinDir = path.join(tempDir, 'bin')
  await mkdir(fakeBinDir, { recursive: true })

  const fakeGoPath = path.join(fakeBinDir, 'go')
  await writeFile(fakeGoPath, `#!/bin/sh
set -eu
node - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
if (process.env.WASM_TINYGO_MODE === 'frontend' || process.env.WASM_TINYGO_MODE === 'frontend-analysis-build') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_RESULT_PATH, JSON.stringify({
    ok: true,
    generatedFiles: [
      {
        path: '/working/tinygo-compile-unit.json',
        contents: JSON.stringify({
          entryFile: input.entryFile,
          toolchain: input.toolchain,
          sourceSelection: input.sourceSelection,
          compileUnits: input.compileUnits ?? [],
        }),
      },
    ],
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-analysis') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  if ('compileUnits' in input) {
    console.error('frontend-analysis received compileUnits')
    process.exit(12)
  }
  const compileUnits = (input.packageGraph ?? []).map((packageInfo) => ({
    depOnly: Boolean(packageInfo.depOnly),
    kind: packageInfo.standard ? 'stdlib' : (packageInfo.depOnly ? 'imported' : 'program'),
    importPath: packageInfo.importPath,
    imports: packageInfo.imports ?? [],
    packageName: packageInfo.name,
    packageDir: packageInfo.dir,
    files: (packageInfo.files?.goFiles ?? []).map((goFile) => path.join(packageInfo.dir, goFile)),
    standard: Boolean(packageInfo.standard),
  }))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, JSON.stringify({
    ok: true,
    analysis: {
      buildContext: input.buildContext,
      entryFile: input.entryFile,
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: input.sourceSelection?.allCompile ?? [],
      compileGroups: [
        { name: 'program', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'program').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'all-compile', files: input.sourceSelection?.allCompile ?? [] },
      ],
      compileUnits,
      packageGraph: input.packageGraph ?? [],
      toolchain: {
        target: input.toolchain?.target,
        llvmTarget: input.buildContext?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-real-adapter') {
  const analysisResult = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, 'utf8'))
  const analysis = analysisResult.analysis ?? {}
  const compileUnits = analysis.compileUnits ?? []
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH, JSON.stringify({
    ok: true,
    adapter: {
      buildContext: analysis.buildContext,
      entryFile: analysis.entryFile,
      compileUnitManifestPath: analysis.compileUnitManifestPath ?? '/working/tinygo-compile-unit.json',
      allCompileFiles: analysis.allCompileFiles ?? [],
      compileGroups: [
        { name: 'program', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'program').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'imported', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'imported').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'stdlib', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'stdlib').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'all-compile', files: analysis.allCompileFiles ?? [] },
      ],
      compileUnits,
      packageGraph: analysis.packageGraph ?? [],
      toolchain: {
        target: analysis.toolchain?.target,
        llvmTarget: analysis.toolchain?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
const request = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_REQUEST_PATH, 'utf8'))
fs.writeFileSync(process.env.WASM_TINYGO_RESULT_PATH, JSON.stringify({
  ok: true,
  files: [
    {
      path: '/working/tinygo-frontend-input.json',
      contents: JSON.stringify({
        buildContext: {
          target: request.target,
          llvmTarget: 'wasm32-unknown-wasi',
          goos: 'wasip1',
          goarch: 'wasm',
          gc: 'precise',
          scheduler: request.scheduler ?? 'tasks',
          buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
          modulePath: 'example.com/fake',
        },
        entryFile: request.entry,
        modulePath: 'example.com/fake',
        toolchain: {
          target: request.target,
          artifactOutputPath: request.output,
        },
        sourceSelection: {
          allCompile: [request.entry, '/working/.tinygo-root/src/fmt/print.go'],
        },
        compileUnits: [
          {
            kind: 'program',
            importPath: 'command-line-arguments',
            packageName: 'main',
            packageDir: path.dirname(request.entry),
            files: [request.entry],
          },
          {
            kind: 'stdlib',
            importPath: 'fmt',
            packageName: 'fmt',
            packageDir: '/working/.tinygo-root/src/fmt',
            files: ['/working/.tinygo-root/src/fmt/print.go'],
          },
        ],
        packageGraph: [
          {
            depOnly: false,
            dir: path.dirname(request.entry),
            files: { goFiles: [path.basename(request.entry)] },
            importPath: 'example.com/fake',
            imports: ['fmt'],
            modulePath: 'example.com/fake',
            name: 'main',
            standard: false,
          },
          {
            depOnly: true,
            dir: '/working/.tinygo-root/src/fmt',
            files: { goFiles: ['print.go'] },
            importPath: 'fmt',
            imports: ['errors'],
            modulePath: '',
            name: 'fmt',
            standard: true,
          },
        ],
      }),
    },
  ],
  metadata: {
    buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
    gc: 'precise',
    goarch: 'wasm',
    goos: 'wasip1',
    llvmTarget: 'wasm32-unknown-wasi',
    optimize: '-Oz',
    panicStrategy: request.panic ?? 'print',
    scheduler: request.scheduler ?? 'tasks',
  },
}, null, 2))
NODE
`)
  await chmod(fakeGoPath, 0o755)

  const fakeTinyGoPath = path.join(fakeBinDir, 'tinygo')
  await writeFile(fakeTinyGoPath, `#!/bin/sh
set -eu
if [ "$1" = "info" ]; then
  cat <<'EOF'
LLVM triple:       wasm32-unknown-wasi
GOOS:              wasip1
GOARCH:            wasm
build tags:        gc.precise scheduler.tasks tinygo purego tinygo.unicore tinygo.wasm
garbage collector: precise
scheduler:         tasks
EOF
  exit 0
fi
if [ "$1" = "list" ]; then
  cat <<EOF
{
  "Dir": "$(pwd)",
  "ImportPath": "example.com/fake",
  "Module": {
    "Path": "example.com/fake"
  },
  "Name": "main",
  "GoFiles": [
    "main.go"
  ],
  "Imports": [
    "fmt"
  ]
}
{
  "Dir": "/working/.tinygo-root/src/fmt",
  "ImportPath": "fmt",
  "Name": "fmt",
  "GoFiles": [
    "print.go"
  ],
  "Imports": [
    "errors"
  ],
  "DepOnly": true,
  "Standard": true
}
EOF
  exit 0
fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
mkdir -p "$(dirname "$out")"
printf '\\000asm\\001\\000\\000\\000' > "$out"
`)
  await chmod(fakeTinyGoPath, 0o755)

  const fakeTinyGoRoot = path.join(tempDir, 'tinygo-root')
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys'), { recursive: true })
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'device', 'arm'), { recursive: true })
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys', 'zversion.go'), 'package sys\n')
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'device', 'arm', 'arm.go'), 'package arm\n')

  const workspaceDir = path.join(tempDir, 'workspace')
  await mkdir(workspaceDir, { recursive: true })
  const entryPath = path.join(workspaceDir, 'main.go')
  const outputPath = path.join(workspaceDir, 'out.wasm')
  const requestPath = path.join(workspaceDir, 'tinygo-request.json')
  const bridgeManifestPath = path.join(workspaceDir, 'tinygo-driver-bridge.json')

  await writeFile(entryPath, 'package main\n\nfunc main() {}\n')
  await writeFile(requestPath, JSON.stringify({
    command: 'build',
    planner: 'tinygo',
    entry: entryPath,
    optimize: 'z',
    output: outputPath,
    panic: 'trap',
    scheduler: 'tasks',
    target: 'wasip1',
  }))

  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/probe-tinygo-driver-bridge.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_DRIVER_BRIDGE_MANIFEST_PATH: bridgeManifestPath,
      WASM_TINYGO_DRIVER_BRIDGE_INCLUDE_FRONTEND_ANALYSIS: '1',
      WASM_TINYGO_GO_BIN: fakeGoPath,
      WASM_TINYGO_HOST_PROBE_REQUEST_PATH: requestPath,
      WASM_TINYGO_HOST_PROBE_SKIP_RUNTIME: '1',
      WASM_TINYGO_TINYGOROOT: fakeTinyGoRoot,
      WASM_TINYGO_TINYGO_BIN: fakeTinyGoPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })

  assert.equal(exitCode, 0, output)
  const manifest = JSON.parse(await readFile(bridgeManifestPath, 'utf8'))
  assert.deepEqual(manifest.frontendAnalysis.compileUnits, [
    {
      depOnly: false,
      kind: 'program',
      importPath: 'example.com/fake',
      imports: ['fmt'],
      packageName: 'main',
      packageDir: workspaceDir,
      files: [entryPath],
      standard: false,
    },
    {
      depOnly: true,
      kind: 'stdlib',
      importPath: 'fmt',
      imports: ['errors'],
      packageName: 'fmt',
      packageDir: '/working/.tinygo-root/src/fmt',
      files: ['/working/.tinygo-root/src/fmt/print.go'],
      standard: true,
    },
  ])
})

test('probe-tinygo-driver-bridge falls back to frontend compile units when tinygo list returns no package graph', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-driver-bridge-script-empty-list-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeBinDir = path.join(tempDir, 'bin')
  await mkdir(fakeBinDir, { recursive: true })

  const fakeGoPath = path.join(fakeBinDir, 'go')
  await writeFile(fakeGoPath, `#!/bin/sh
set -eu
node - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
if (process.env.WASM_TINYGO_MODE === 'frontend' || process.env.WASM_TINYGO_MODE === 'frontend-analysis-build') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  const programPackage = (input.packageGraph ?? []).find((packageInfo) => !packageInfo.depOnly && packageInfo.importPath)
  const compileUnits = (input.compileUnits ?? []).map((compileUnit) => {
    const packageInfo = (input.packageGraph ?? []).find((candidate) => candidate.importPath === compileUnit.importPath)
      ?? (compileUnit.kind === 'program' && compileUnit.importPath === 'command-line-arguments' ? programPackage : undefined)
    return {
      ...compileUnit,
      importPath: compileUnit.kind === 'program' && compileUnit.importPath === 'command-line-arguments' && packageInfo?.importPath ? packageInfo.importPath : compileUnit.importPath,
      imports: (compileUnit.imports ?? []).length === 0 && (packageInfo?.imports ?? []).length > 0 ? packageInfo.imports : (compileUnit.imports ?? []),
      packageDir: compileUnit.packageDir ?? packageInfo?.dir,
      packageName: compileUnit.packageName ?? packageInfo?.name,
      files: (compileUnit.files ?? []).length === 0 && packageInfo?.dir ? (packageInfo.files?.goFiles ?? []).map((goFile) => path.join(packageInfo.dir, goFile)) : (compileUnit.files ?? []),
    }
  })
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_RESULT_PATH, JSON.stringify({
    ok: true,
    generatedFiles: [
      {
        path: '/working/tinygo-compile-unit.json',
        contents: JSON.stringify({
          entryFile: input.entryFile,
          toolchain: input.toolchain,
          sourceSelection: input.sourceSelection,
          compileUnits,
        }),
      },
    ],
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-analysis') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  if (Array.isArray(input.compileUnits)) {
    throw new Error('frontend-analysis expected packageGraph-only input')
  }
  const compileUnits = (input.packageGraph ?? []).map((packageInfo) => ({
    depOnly: packageInfo.depOnly ?? false,
    files: (packageInfo.files?.goFiles ?? []).map((goFile) => path.join(packageInfo.dir, goFile)),
    importPath: packageInfo.importPath,
    imports: packageInfo.imports ?? [],
    kind: packageInfo.depOnly ? (packageInfo.standard ? 'stdlib' : 'imported') : 'program',
    packageDir: packageInfo.dir,
    packageName: packageInfo.name,
    standard: packageInfo.standard ?? false,
  }))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, JSON.stringify({
    ok: true,
    analysis: {
      buildContext: input.buildContext,
      entryFile: input.entryFile,
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: input.sourceSelection?.allCompile ?? [],
      compileGroups: [
        { name: 'program', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'program').flatMap((compileUnit) => compileUnit.files ?? []) },
      ],
      compileUnits,
      packageGraph: input.packageGraph,
      toolchain: {
        target: input.toolchain?.target,
        llvmTarget: input.buildContext?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-real-adapter') {
  const analysisResult = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, 'utf8'))
  const analysis = analysisResult.analysis ?? {}
  const entryPackage = (analysis.packageGraph ?? []).find((packageInfo) => !packageInfo.depOnly && packageInfo.importPath)
  const compileUnits = (analysis.compileUnits ?? []).map((compileUnit) => ({
    ...compileUnit,
    importPath: compileUnit.kind === 'program' && compileUnit.importPath === 'command-line-arguments' && entryPackage?.importPath ? entryPackage.importPath : compileUnit.importPath,
    imports: compileUnit.kind === 'program' && (compileUnit.imports ?? []).length === 0 && (entryPackage?.imports ?? []).length > 0 ? entryPackage.imports : (compileUnit.imports ?? []),
    depOnly: compileUnit.kind === 'program' ? false : (compileUnit.depOnly ?? true),
    standard: compileUnit.kind === 'stdlib' ? true : (compileUnit.standard ?? false),
  }))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH, JSON.stringify({
    ok: true,
    adapter: {
      buildContext: analysis.buildContext,
      entryFile: analysis.entryFile,
      compileUnitManifestPath: analysis.compileUnitManifestPath ?? '/working/tinygo-compile-unit.json',
      allCompileFiles: analysis.allCompileFiles ?? [],
      compileGroups: [
        { name: 'program', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'program').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'imported', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'imported').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'stdlib', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'stdlib').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'all-compile', files: analysis.allCompileFiles ?? [] },
      ],
      compileUnits,
      packageGraph: analysis.packageGraph ?? [],
      toolchain: {
        target: analysis.toolchain?.target,
        llvmTarget: analysis.toolchain?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
const request = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_REQUEST_PATH, 'utf8'))
fs.writeFileSync(process.env.WASM_TINYGO_RESULT_PATH, JSON.stringify({
  ok: true,
  files: [
    {
      path: '/working/tinygo-frontend-input.json',
      contents: JSON.stringify({
        buildContext: {
          target: request.target,
          llvmTarget: 'wasm32-unknown-wasi',
          goos: 'js',
          goarch: 'wasm',
          gc: 'precise',
          scheduler: request.scheduler ?? 'asyncify',
          buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
          modulePath: 'example.com/bridge',
        },
        entryFile: request.entry,
        modulePath: 'example.com/bridge',
        toolchain: {
          target: request.target,
          artifactOutputPath: request.output,
        },
        sourceSelection: {
          program: [request.entry],
          allCompile: [request.entry],
        },
        compileUnits: [
          {
            kind: 'program',
            importPath: 'command-line-arguments',
            packageName: 'main',
            packageDir: path.dirname(request.entry),
            files: [request.entry],
          },
        ],
        packageGraph: [
          {
            depOnly: false,
            dir: path.dirname(request.entry),
            files: { goFiles: [path.basename(request.entry)] },
            importPath: 'command-line-arguments',
            imports: [],
            modulePath: 'example.com/bridge',
            name: 'main',
            standard: false,
          },
        ],
      }),
    },
  ],
  metadata: {
    buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
    gc: 'precise',
    goarch: 'wasm',
    goos: 'js',
    llvmTarget: 'wasm32-unknown-wasi',
    optimize: '-Oz',
    panicStrategy: request.panic ?? 'print',
    scheduler: request.scheduler ?? 'asyncify',
  },
}, null, 2))
NODE
`)
  await chmod(fakeGoPath, 0o755)

  const fakeTinyGoPath = path.join(fakeBinDir, 'tinygo')
  await writeFile(fakeTinyGoPath, `#!/bin/sh
set -eu
if [ "$1" = "info" ]; then
  cat <<'EOF'
LLVM triple:       wasm32-unknown-wasi
GOOS:              js
GOARCH:            wasm
build tags:        gc.precise scheduler.asyncify tinygo purego tinygo.unicore tinygo.wasm
garbage collector: precise
scheduler:         asyncify
EOF
  exit 0
fi
if [ "$1" = "list" ]; then
  exit 0
fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
mkdir -p "$(dirname "$out")"
printf '\\000asm\\001\\000\\000\\000' > "$out"
`)
  await chmod(fakeTinyGoPath, 0o755)

  const fakeTinyGoRoot = path.join(tempDir, 'tinygo-root')
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys'), { recursive: true })
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'device', 'arm'), { recursive: true })
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys', 'zversion.go'), 'package sys\n')
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'device', 'arm', 'arm.go'), 'package arm\n')

  const workspaceDir = path.join(tempDir, 'workspace')
  await mkdir(workspaceDir, { recursive: true })
  const entryPath = path.join(workspaceDir, 'main.go')
  const outputPath = path.join(workspaceDir, 'out.wasm')
  const requestPath = path.join(workspaceDir, 'tinygo-request.json')
  const bridgeManifestPath = path.join(workspaceDir, 'tinygo-driver-bridge.json')

  await writeFile(entryPath, 'package main\n\nfunc main() {}\n')
  await writeFile(requestPath, JSON.stringify({
    command: 'build',
    planner: 'tinygo',
    entry: entryPath,
    optimize: 'z',
    output: outputPath,
    panic: 'trap',
    target: 'wasm',
  }))

  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/probe-tinygo-driver-bridge.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_DRIVER_BRIDGE_MANIFEST_PATH: bridgeManifestPath,
      WASM_TINYGO_DRIVER_BRIDGE_INCLUDE_FRONTEND_ANALYSIS: '1',
      WASM_TINYGO_GO_BIN: fakeGoPath,
      WASM_TINYGO_HOST_PROBE_REQUEST_PATH: requestPath,
      WASM_TINYGO_HOST_PROBE_SKIP_RUNTIME: '1',
      WASM_TINYGO_TINYGOROOT: fakeTinyGoRoot,
      WASM_TINYGO_TINYGO_BIN: fakeTinyGoPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })

  assert.equal(exitCode, 0, output)
  const manifest = JSON.parse(await readFile(bridgeManifestPath, 'utf8'))
  assert.deepEqual(manifest.entryPackage, {
    dir: workspaceDir,
    goFiles: ['main.go'],
    importPath: 'command-line-arguments',
    imports: [],
    name: 'main',
  })
  assert.deepEqual(manifest.packageGraph, [
    {
      depOnly: false,
      dir: workspaceDir,
      goFiles: ['main.go'],
      importPath: 'command-line-arguments',
      imports: [],
      modulePath: 'example.com/bridge',
      name: 'main',
      standard: false,
    },
  ])
  assert.deepEqual(manifest.frontendAnalysis, {
    allCompileFiles: [entryPath],
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/bridge',
    },
    compileGroups: [
      { files: [entryPath], name: 'program' },
    ],
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    compileUnits: [
      {
        depOnly: false,
        files: [entryPath],
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: [],
        packageDir: workspaceDir,
        packageName: 'main',
        standard: false,
      },
    ],
    entryFile: entryPath,
    packageGraph: [
      {
        depOnly: false,
        dir: workspaceDir,
        files: { goFiles: ['main.go'] },
        importPath: 'command-line-arguments',
        imports: [],
        modulePath: 'example.com/bridge',
        name: 'main',
        standard: false,
      },
    ],
    toolchain: {
      llvmTarget: 'wasm32-unknown-wasi',
      target: 'wasm',
    },
  })
  assert.deepEqual(manifest.frontendRealAdapter, {
    buildContext: {
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      gc: 'precise',
      goarch: 'wasm',
      goos: 'js',
      llvmTarget: 'wasm32-unknown-wasi',
      modulePath: 'example.com/bridge',
      scheduler: 'asyncify',
      target: 'wasm',
    },
    allCompileFiles: [entryPath],
    compileGroups: [
      { files: [entryPath], name: 'program' },
      { files: [], name: 'imported' },
      { files: [], name: 'stdlib' },
      { files: [entryPath], name: 'all-compile' },
    ],
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    compileUnits: [
      {
        depOnly: false,
        files: [entryPath],
        importPath: 'command-line-arguments',
        imports: [],
        kind: 'program',
        packageDir: workspaceDir,
        packageName: 'main',
        standard: false,
      },
    ],
    entryFile: entryPath,
    packageGraph: [
      {
        depOnly: false,
        dir: workspaceDir,
        files: { goFiles: ['main.go'] },
        importPath: 'command-line-arguments',
        imports: [],
        modulePath: 'example.com/bridge',
        name: 'main',
        standard: false,
      },
    ],
    toolchain: {
      llvmTarget: 'wasm32-unknown-wasi',
      target: 'wasm',
    },
  })
  assert.deepEqual(manifest.realFrontendAnalysis, manifest.frontendRealAdapter)
})

test('probe-tinygo-driver-bridge can skip frontend-analysis and write an adapter-only bridge manifest', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-driver-bridge-adapter-only-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeBinDir = path.join(tempDir, 'bin')
  await mkdir(fakeBinDir, { recursive: true })

  const fakeGoPath = path.join(fakeBinDir, 'go')
  await writeFile(fakeGoPath, `#!/bin/sh
set -eu
node - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
if (process.env.WASM_TINYGO_MODE === 'frontend-analysis') {
  throw new Error('skip mode should not invoke frontend-analysis')
}
if (process.env.WASM_TINYGO_MODE === 'frontend') {
  if (process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH) {
    throw new Error('frontend should not receive WASM_TINYGO_FRONTEND_ANALYSIS_PATH when bridge skip mode is enabled')
  }
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  const adapterResult = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH, 'utf8'))
  const adapter = adapterResult.adapter ?? {}
  if (process.env.WASM_TINYGO_FRONTEND_ENV_RECORD_PATH) {
    fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_ENV_RECORD_PATH, JSON.stringify({
      analysisPath: process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH ?? null,
      inputPath: process.env.WASM_TINYGO_FRONTEND_INPUT_PATH ?? null,
      realAdapterPath: process.env.WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH ?? null,
    }, null, 2))
  }
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_RESULT_PATH, JSON.stringify({
    ok: true,
    generatedFiles: [
      {
        path: '/working/tinygo-compile-unit.json',
        contents: JSON.stringify({
          entryFile: adapter.entryFile,
          toolchain: {
            ...(input.toolchain ?? {}),
            ...(adapter.toolchain ?? {}),
          },
          sourceSelection: {
            allCompile: adapter.allCompileFiles ?? [],
          },
          compileUnits: adapter.compileUnits ?? [],
        }),
      },
    ],
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-real-adapter') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  const entryPackage = (input.packageGraph ?? []).find((packageInfo) => !packageInfo.depOnly && packageInfo.importPath)
  const compileUnits = (input.compileUnits ?? []).map((compileUnit) => {
    const packageInfo = (input.packageGraph ?? []).find((candidate) => candidate.importPath === compileUnit.importPath)
      ?? (compileUnit.kind === 'program' && compileUnit.importPath === 'command-line-arguments' ? entryPackage : undefined)
    return {
      ...compileUnit,
      importPath: compileUnit.kind === 'program' && compileUnit.importPath === 'command-line-arguments' && entryPackage?.importPath ? entryPackage.importPath : compileUnit.importPath,
      imports: (compileUnit.imports ?? []).length === 0 && (packageInfo?.imports ?? []).length > 0 ? packageInfo.imports : (compileUnit.imports ?? []),
      modulePath: compileUnit.modulePath ?? packageInfo?.modulePath ?? '',
      depOnly: compileUnit.kind === 'program' ? false : (compileUnit.depOnly ?? true),
      packageDir: compileUnit.packageDir ?? packageInfo?.dir,
      packageName: compileUnit.packageName ?? packageInfo?.name,
      files: (compileUnit.files ?? []).length === 0 && packageInfo?.dir ? (packageInfo.files?.goFiles ?? []).map((goFile) => path.join(packageInfo.dir, goFile)) : (compileUnit.files ?? []),
      standard: compileUnit.kind === 'stdlib' ? true : (compileUnit.standard ?? false),
    }
  })
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH, JSON.stringify({
    ok: true,
    adapter: {
      allCompileFiles: input.sourceSelection?.allCompile ?? [],
      buildContext: input.buildContext,
      compileGroups: [
        { name: 'program', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'program').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'stdlib', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'stdlib').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'all-compile', files: input.sourceSelection?.allCompile ?? [] },
      ],
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      compileUnits,
      entryFile: input.entryFile,
      packageGraph: input.packageGraph ?? [],
      toolchain: {
        target: input.toolchain?.target,
        llvmTarget: input.buildContext?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
const request = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_REQUEST_PATH, 'utf8'))
fs.writeFileSync(process.env.WASM_TINYGO_RESULT_PATH, JSON.stringify({
  ok: true,
  files: [
    {
      path: '/working/tinygo-frontend-input.json',
      contents: JSON.stringify({
        buildContext: {
          target: request.target,
          llvmTarget: 'wasm32-unknown-wasi',
          goos: 'wasip1',
          goarch: 'wasm',
          gc: 'precise',
          scheduler: request.scheduler ?? 'tasks',
          buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
          modulePath: 'example.com/fake',
        },
        entryFile: request.entry,
        modulePath: 'example.com/fake',
        toolchain: {
          target: request.target,
          artifactOutputPath: request.output,
        },
        sourceSelection: {
          program: [request.entry],
          allCompile: [request.entry, '/working/.tinygo-root/src/fmt/print.go'],
        },
        compileUnits: [
          {
            kind: 'program',
            importPath: 'command-line-arguments',
            packageName: 'main',
            packageDir: path.dirname(request.entry),
            files: [request.entry],
          },
          {
            kind: 'stdlib',
            importPath: 'fmt',
            packageName: 'fmt',
            packageDir: '/working/.tinygo-root/src/fmt',
            files: ['/working/.tinygo-root/src/fmt/print.go'],
          },
        ],
        packageGraph: [
          {
            depOnly: false,
            dir: path.dirname(request.entry),
            files: { goFiles: [path.basename(request.entry)] },
            importPath: 'example.com/fake',
            imports: ['fmt'],
            modulePath: 'example.com/fake',
            name: 'main',
            standard: false,
          },
          {
            depOnly: true,
            dir: '/working/.tinygo-root/src/fmt',
            files: { goFiles: ['print.go'] },
            importPath: 'fmt',
            imports: ['errors'],
            modulePath: '',
            name: 'fmt',
            standard: true,
          },
        ],
      }),
    },
  ],
  metadata: {
    buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
    gc: 'precise',
    goarch: 'wasm',
    goos: 'wasip1',
    llvmTarget: 'wasm32-unknown-wasi',
    optimize: '-Oz',
    panicStrategy: request.panic ?? 'print',
    scheduler: request.scheduler ?? 'tasks',
  },
}, null, 2))
NODE
`)
  await chmod(fakeGoPath, 0o755)

  const fakeTinyGoPath = path.join(fakeBinDir, 'tinygo')
  await writeFile(fakeTinyGoPath, `#!/bin/sh
set -eu
if [ "$1" = "info" ]; then
  cat <<'EOF'
LLVM triple:       wasm32-unknown-wasi
GOOS:              wasip1
GOARCH:            wasm
build tags:        gc.precise scheduler.tasks tinygo purego tinygo.unicore tinygo.wasm
garbage collector: precise
scheduler:         tasks
EOF
  exit 0
fi
if [ "$1" = "list" ]; then
  cat <<EOF
{
  "Dir": "$(pwd)",
  "ImportPath": "example.com/fake",
  "Module": {
    "Path": "example.com/fake"
  },
  "Name": "main",
  "GoFiles": [
    "main.go"
  ],
  "Imports": [
    "fmt"
  ]
}
{
  "Dir": "/working/.tinygo-root/src/fmt",
  "ImportPath": "fmt",
  "Name": "fmt",
  "GoFiles": [
    "print.go"
  ],
  "Imports": [
    "errors"
  ],
  "DepOnly": true,
  "Standard": true
}
EOF
  exit 0
fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
mkdir -p "$(dirname "$out")"
printf '\\000asm\\001\\000\\000\\000' > "$out"
`)
  await chmod(fakeTinyGoPath, 0o755)

  const fakeTinyGoRoot = path.join(tempDir, 'tinygo-root')
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys'), { recursive: true })
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'device', 'arm'), { recursive: true })
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys', 'zversion.go'), 'package sys\n')
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'device', 'arm', 'arm.go'), 'package arm\n')

  const workspaceDir = path.join(tempDir, 'workspace')
  await mkdir(workspaceDir, { recursive: true })
  const entryPath = path.join(workspaceDir, 'main.go')
  const outputPath = path.join(workspaceDir, 'out.wasm')
  const requestPath = path.join(workspaceDir, 'tinygo-request.json')
  const bridgeManifestPath = path.join(workspaceDir, 'tinygo-driver-bridge.json')
  const frontendEnvRecordPath = path.join(workspaceDir, 'tinygo-frontend-env.json')

  await writeFile(entryPath, 'package main\n\nfunc main() {}\n')
  await writeFile(requestPath, JSON.stringify({
    command: 'build',
    planner: 'tinygo',
    entry: entryPath,
    optimize: 'z',
    output: outputPath,
    panic: 'trap',
    scheduler: 'tasks',
    target: 'wasip1',
  }))

  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/probe-tinygo-driver-bridge.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_DRIVER_BRIDGE_MANIFEST_PATH: bridgeManifestPath,
      WASM_TINYGO_DRIVER_BRIDGE_SKIP_FRONTEND_ANALYSIS: '1',
      WASM_TINYGO_FRONTEND_ENV_RECORD_PATH: frontendEnvRecordPath,
      WASM_TINYGO_GO_BIN: fakeGoPath,
      WASM_TINYGO_HOST_PROBE_REQUEST_PATH: requestPath,
      WASM_TINYGO_HOST_PROBE_SKIP_RUNTIME: '1',
      WASM_TINYGO_TINYGOROOT: fakeTinyGoRoot,
      WASM_TINYGO_TINYGO_BIN: fakeTinyGoPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })

  assert.equal(exitCode, 0, output)
  const manifest = JSON.parse(await readFile(bridgeManifestPath, 'utf8'))
  assert.equal(manifest.frontendAnalysis, undefined)
  assert.deepEqual(manifest.realFrontendAnalysis, manifest.frontendRealAdapter)
  assert.equal(manifest.frontendRealAdapter.toolchain.target, 'wasip1')
  assert.equal(manifest.frontendRealAdapter.toolchain.llvmTarget, 'wasm32-unknown-wasi')
  assert.equal(manifest.frontendHandoff.compileUnitCount, 2)
  assert.deepEqual(JSON.parse(await readFile(frontendEnvRecordPath, 'utf8')), {
    analysisPath: null,
    inputPath: path.join(workspaceDir, 'tinygo-frontend-input.json'),
    realAdapterPath: path.join(workspaceDir, 'tinygo-frontend-real-adapter.json'),
  })
})

test('probe-tinygo-driver-bridge prefers frontend analysis packageGraph when tinygo list returns no package graph', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-driver-bridge-script-analysis-graph-fallback-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeBinDir = path.join(tempDir, 'bin')
  await mkdir(fakeBinDir, { recursive: true })

  const fakeGoPath = path.join(fakeBinDir, 'go')
  await writeFile(fakeGoPath, `#!/bin/sh
set -eu
node - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
if (process.env.WASM_TINYGO_MODE === 'frontend' || process.env.WASM_TINYGO_MODE === 'frontend-analysis-build') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_RESULT_PATH, JSON.stringify({
    ok: true,
    generatedFiles: [
      {
        path: '/working/tinygo-compile-unit.json',
        contents: JSON.stringify({
          entryFile: input.entryFile,
          toolchain: input.toolchain,
          sourceSelection: input.sourceSelection,
          compileUnits: [
            {
              kind: 'program',
              importPath: 'command-line-arguments',
              imports: ['fmt'],
              modulePath: 'example.com/analysisgraph',
              depOnly: false,
              packageName: 'main',
              packageDir: path.dirname(input.entryFile),
              files: [input.entryFile],
              standard: false,
            },
          ],
        }),
      },
    ],
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-analysis') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  if (Array.isArray(input.compileUnits)) {
    throw new Error('frontend-analysis expected packageGraph-only input')
  }
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, JSON.stringify({
    ok: true,
    analysis: {
      buildContext: input.buildContext,
      entryFile: input.entryFile,
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: input.sourceSelection?.allCompile ?? [],
      compileGroups: [
        { name: 'program', files: [input.entryFile] },
      ],
      compileUnits: [
        {
          depOnly: false,
          files: [input.entryFile],
          importPath: 'example.com/analysisgraph',
          imports: [],
          kind: 'program',
          modulePath: 'example.com/analysisgraph',
          packageDir: path.dirname(input.entryFile),
          packageName: 'main',
          standard: false,
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: path.dirname(input.entryFile),
          files: { goFiles: [path.basename(input.entryFile)] },
          importPath: 'example.com/analysisgraph',
          imports: [],
          modulePath: 'example.com/analysisgraph',
          name: 'main',
          standard: false,
        },
      ],
      toolchain: {
        target: input.toolchain?.target,
        llvmTarget: input.buildContext?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-real-adapter') {
  const analysisResult = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, 'utf8'))
  const analysis = analysisResult.analysis ?? {}
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH, JSON.stringify({
    ok: true,
    adapter: {
      ...analysis,
      compileGroups: [
        { name: 'program', files: [analysis.entryFile] },
        { name: 'imported', files: [] },
        { name: 'stdlib', files: [] },
        { name: 'all-compile', files: analysis.allCompileFiles ?? [] },
      ],
    },
  }, null, 2))
  process.exit(0)
}
const request = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_REQUEST_PATH, 'utf8'))
fs.writeFileSync(process.env.WASM_TINYGO_RESULT_PATH, JSON.stringify({
  ok: true,
  files: [
    {
      path: '/working/tinygo-frontend-input.json',
      contents: JSON.stringify({
        buildContext: {
          target: request.target,
          llvmTarget: 'wasm32-unknown-wasi',
          goos: 'js',
          goarch: 'wasm',
          gc: 'precise',
          scheduler: request.scheduler ?? 'asyncify',
          buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
          modulePath: 'example.com/analysisgraph',
        },
        entryFile: request.entry,
        modulePath: 'example.com/analysisgraph',
        toolchain: {
          target: request.target,
          artifactOutputPath: request.output,
        },
        sourceSelection: {
          program: [request.entry],
          allCompile: [request.entry],
        },
        compileUnits: [
          {
            kind: 'program',
            importPath: 'command-line-arguments',
            packageName: 'main',
            packageDir: path.dirname(request.entry),
            files: [request.entry],
          },
        ],
        packageGraph: [
          {
            depOnly: false,
            dir: path.dirname(request.entry),
            files: { goFiles: [path.basename(request.entry)] },
            importPath: 'command-line-arguments',
            imports: [],
            modulePath: 'example.com/analysisgraph',
            name: 'main',
            standard: false,
          },
        ],
      }),
    },
  ],
  metadata: {
    buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
    gc: 'precise',
    goarch: 'wasm',
    goos: 'js',
    llvmTarget: 'wasm32-unknown-wasi',
    optimize: '-Oz',
    panicStrategy: request.panic ?? 'print',
    scheduler: request.scheduler ?? 'asyncify',
  },
}, null, 2))
NODE
`)
  await chmod(fakeGoPath, 0o755)

  const fakeTinyGoPath = path.join(fakeBinDir, 'tinygo')
  await writeFile(fakeTinyGoPath, `#!/bin/sh
set -eu
if [ "$1" = "info" ]; then
  cat <<'EOF'
LLVM triple:       wasm32-unknown-wasi
GOOS:              js
GOARCH:            wasm
build tags:        gc.precise scheduler.asyncify tinygo purego tinygo.unicore tinygo.wasm
garbage collector: precise
scheduler:         asyncify
EOF
  exit 0
fi
if [ "$1" = "list" ]; then
  exit 0
fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
mkdir -p "$(dirname "$out")"
printf '\\000asm\\001\\000\\000\\000' > "$out"
`)
  await chmod(fakeTinyGoPath, 0o755)

  const fakeTinyGoRoot = path.join(tempDir, 'tinygo-root')
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys'), { recursive: true })
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'device', 'arm'), { recursive: true })
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys', 'zversion.go'), 'package sys\n')
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'device', 'arm', 'arm.go'), 'package arm\n')

  const workspaceDir = path.join(tempDir, 'workspace')
  await mkdir(workspaceDir, { recursive: true })
  const entryPath = path.join(workspaceDir, 'main.go')
  const outputPath = path.join(workspaceDir, 'out.wasm')
  const requestPath = path.join(workspaceDir, 'tinygo-request.json')
  const bridgeManifestPath = path.join(workspaceDir, 'tinygo-driver-bridge.json')

  await writeFile(entryPath, 'package main\n\nfunc main() {}\n')
  await writeFile(requestPath, JSON.stringify({
    command: 'build',
    planner: 'tinygo',
    entry: entryPath,
    optimize: 'z',
    output: outputPath,
    panic: 'trap',
    target: 'wasm',
  }))

  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/probe-tinygo-driver-bridge.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_DRIVER_BRIDGE_MANIFEST_PATH: bridgeManifestPath,
      WASM_TINYGO_DRIVER_BRIDGE_INCLUDE_FRONTEND_ANALYSIS: '1',
      WASM_TINYGO_GO_BIN: fakeGoPath,
      WASM_TINYGO_HOST_PROBE_REQUEST_PATH: requestPath,
      WASM_TINYGO_HOST_PROBE_SKIP_RUNTIME: '1',
      WASM_TINYGO_TINYGOROOT: fakeTinyGoRoot,
      WASM_TINYGO_TINYGO_BIN: fakeTinyGoPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })

  assert.equal(exitCode, 0, output)
  const manifest = JSON.parse(await readFile(bridgeManifestPath, 'utf8'))
  assert.deepEqual(manifest.entryPackage, {
    dir: workspaceDir,
    goFiles: ['main.go'],
    importPath: 'example.com/analysisgraph',
    imports: [],
    name: 'main',
  })
  assert.deepEqual(manifest.packageGraph, [
    {
      depOnly: false,
      dir: workspaceDir,
      goFiles: ['main.go'],
      importPath: 'example.com/analysisgraph',
      imports: [],
      modulePath: 'example.com/analysisgraph',
      name: 'main',
      standard: false,
    },
  ])
})

test('probe-tinygo-driver-bridge fails when tinygo list exits non-zero', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-driver-bridge-script-list-failure-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeBinDir = path.join(tempDir, 'bin')
  await mkdir(fakeBinDir, { recursive: true })

  const fakeGoPath = path.join(fakeBinDir, 'go')
  await writeFile(fakeGoPath, `#!/bin/sh
set -eu
node - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const request = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_REQUEST_PATH, 'utf8'))
fs.writeFileSync(process.env.WASM_TINYGO_RESULT_PATH, JSON.stringify({
  ok: true,
  files: [
    {
      path: '/working/tinygo-frontend-input.json',
      contents: JSON.stringify({
        buildContext: {
          target: request.target,
          llvmTarget: 'wasm32-unknown-wasi',
          goos: 'wasip1',
          goarch: 'wasm',
          gc: 'precise',
          scheduler: request.scheduler ?? 'tasks',
          buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
          modulePath: 'example.com/listfailure',
        },
        entryFile: request.entry,
        modulePath: 'example.com/listfailure',
        toolchain: {
          target: request.target,
          artifactOutputPath: request.output,
        },
        sourceSelection: {
          allCompile: [request.entry],
        },
        compileUnits: [
          {
            kind: 'program',
            importPath: 'command-line-arguments',
            imports: [],
            modulePath: 'example.com/listfailure',
            depOnly: false,
            packageName: 'main',
            packageDir: path.dirname(request.entry),
            files: [request.entry],
            standard: false,
          },
        ],
        packageGraph: [
          {
            depOnly: false,
            dir: path.dirname(request.entry),
            files: { goFiles: [path.basename(request.entry)] },
            importPath: 'command-line-arguments',
            imports: [],
            modulePath: 'example.com/listfailure',
            name: 'main',
            standard: false,
          },
        ],
      }),
    },
  ],
  metadata: {
    buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
    gc: 'precise',
    goarch: 'wasm',
    goos: 'wasip1',
    llvmTarget: 'wasm32-unknown-wasi',
    optimize: '-Oz',
    panicStrategy: request.panic ?? 'trap',
    scheduler: request.scheduler ?? 'tasks',
  },
}, null, 2))
NODE
`)
  await chmod(fakeGoPath, 0o755)

  const fakeTinyGoPath = path.join(fakeBinDir, 'tinygo')
  await writeFile(fakeTinyGoPath, `#!/bin/sh
set -eu
if [ "$1" = "info" ]; then
  cat <<'EOF'
LLVM triple:       wasm32-unknown-wasi
GOOS:              wasip1
GOARCH:            wasm
build tags:        gc.precise scheduler.tasks tinygo purego tinygo.unicore tinygo.wasm
garbage collector: precise
scheduler:         tasks
EOF
  exit 0
fi
if [ "$1" = "list" ]; then
  echo 'fake tinygo list failure' >&2
  exit 9
fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
mkdir -p "$(dirname "$out")"
printf '\\000asm\\001\\000\\000\\000' > "$out"
`)
  await chmod(fakeTinyGoPath, 0o755)

  const fakeTinyGoRoot = path.join(tempDir, 'tinygo-root')
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys'), { recursive: true })
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'device', 'arm'), { recursive: true })
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys', 'zversion.go'), 'package sys\n')
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'device', 'arm', 'arm.go'), 'package arm\n')

  const workspaceDir = path.join(tempDir, 'workspace')
  await mkdir(workspaceDir, { recursive: true })
  const entryPath = path.join(workspaceDir, 'main.go')
  const outputPath = path.join(workspaceDir, 'out.wasm')
  const requestPath = path.join(workspaceDir, 'tinygo-request.json')
  const bridgeManifestPath = path.join(workspaceDir, 'tinygo-driver-bridge.json')

  await writeFile(entryPath, 'package main\n\nfunc main() {}\n')
  await writeFile(requestPath, JSON.stringify({
    command: 'build',
    planner: 'tinygo',
    entry: entryPath,
    optimize: 'z',
    output: outputPath,
    panic: 'trap',
    scheduler: 'tasks',
    target: 'wasip1',
  }))

  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/probe-tinygo-driver-bridge.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_DRIVER_BRIDGE_MANIFEST_PATH: bridgeManifestPath,
      WASM_TINYGO_DRIVER_BRIDGE_INCLUDE_FRONTEND_ANALYSIS: '1',
      WASM_TINYGO_GO_BIN: fakeGoPath,
      WASM_TINYGO_HOST_PROBE_REQUEST_PATH: requestPath,
      WASM_TINYGO_HOST_PROBE_SKIP_RUNTIME: '1',
      WASM_TINYGO_TINYGOROOT: fakeTinyGoRoot,
      WASM_TINYGO_TINYGO_BIN: fakeTinyGoPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })

  assert.equal(exitCode, 9, output)
  assert.match(output, /fake tinygo list failure/)
  assert.match(output, /tinygo list failed during driver bridge verification/)
})

test('probe-tinygo-driver-bridge canonicalizes frontend-analysis input buildContext from host facts', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-driver-bridge-script-analysis-input-build-context-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeBinDir = path.join(tempDir, 'bin')
  await mkdir(fakeBinDir, { recursive: true })

  const fakeGoPath = path.join(fakeBinDir, 'go')
  await writeFile(fakeGoPath, `#!/bin/sh
set -eu
node - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
if (process.env.WASM_TINYGO_MODE === 'frontend' || process.env.WASM_TINYGO_MODE === 'frontend-analysis-build') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_RESULT_PATH, JSON.stringify({
    ok: true,
    generatedFiles: [
      {
        path: '/working/tinygo-compile-unit.json',
        contents: JSON.stringify({
          entryFile: input.entryFile,
          toolchain: input.toolchain,
          sourceSelection: input.sourceSelection,
          compileUnits: input.compileUnits,
        }),
      },
    ],
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-analysis') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  if (Array.isArray(input.compileUnits)) {
    throw new Error('frontend-analysis expected packageGraph-only input')
  }
  const buildContext = input.buildContext ?? {}
  const buildTags = [...(buildContext.buildTags ?? [])].sort()
  if (
    buildContext.target !== 'wasm' ||
    buildContext.llvmTarget !== 'wasm32-unknown-wasi' ||
    buildContext.goos !== 'wasip1' ||
    buildContext.goarch !== 'wasm' ||
    buildContext.gc !== 'precise' ||
    buildContext.scheduler !== 'asyncify' ||
    buildContext.modulePath !== 'example.com/canonical' ||
    buildTags.join(',') !== 'gc.precise,scheduler.asyncify,tinygo.wasm'
  ) {
    console.error(JSON.stringify(input, null, 2))
    process.exit(13)
  }
  const compileUnits = (input.packageGraph ?? []).map((packageInfo) => ({
    depOnly: packageInfo.depOnly ?? false,
    files: (packageInfo.files?.goFiles ?? []).map((goFile) => path.join(packageInfo.dir, goFile)),
    importPath: packageInfo.importPath,
    imports: packageInfo.imports ?? [],
    kind: packageInfo.depOnly ? (packageInfo.standard ? 'stdlib' : 'imported') : 'program',
    modulePath: packageInfo.modulePath ?? '',
    packageDir: packageInfo.dir,
    packageName: packageInfo.name,
    standard: packageInfo.standard ?? false,
  }))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, JSON.stringify({
    ok: true,
    analysis: {
      buildContext,
      entryFile: input.entryFile,
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: input.sourceSelection?.allCompile ?? [],
      compileGroups: [
        { name: 'program', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'program').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'imported', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'imported').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'stdlib', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'stdlib').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'all-compile', files: input.sourceSelection?.allCompile ?? [] },
      ],
      compileUnits,
      packageGraph: input.packageGraph ?? [],
      toolchain: {
        target: input.toolchain?.target,
        llvmTarget: input.buildContext?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-real-adapter') {
  const analysisResult = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, 'utf8'))
  const analysis = analysisResult.analysis ?? {}
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH, JSON.stringify({
    ok: true,
    adapter: {
      buildContext: analysis.buildContext,
      entryFile: analysis.entryFile,
      compileUnitManifestPath: analysis.compileUnitManifestPath ?? '/working/tinygo-compile-unit.json',
      allCompileFiles: analysis.allCompileFiles ?? [],
      compileGroups: analysis.compileGroups ?? [],
      compileUnits: analysis.compileUnits ?? [],
      packageGraph: analysis.packageGraph ?? [],
      toolchain: {
        target: analysis.toolchain?.target,
        llvmTarget: analysis.toolchain?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
const request = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_REQUEST_PATH, 'utf8'))
fs.writeFileSync(process.env.WASM_TINYGO_RESULT_PATH, JSON.stringify({
  ok: true,
  files: [
    {
      path: '/working/tinygo-frontend-input.json',
      contents: JSON.stringify({
        buildContext: {
          target: 'js',
          llvmTarget: 'wasm32-unknown-unknown',
          goos: 'js',
          goarch: 'wasm',
          gc: 'leaking',
          scheduler: 'tasks',
          buildTags: ['scheduler.tasks', 'tinygo.wasm'],
          modulePath: 'example.com/canonical',
        },
        entryFile: request.entry,
        modulePath: 'example.com/canonical',
        toolchain: {
          target: request.target,
          artifactOutputPath: request.output,
        },
        sourceSelection: {
          program: [request.entry],
          allCompile: [request.entry],
        },
        compileUnits: [
          {
            depOnly: false,
            kind: 'program',
            importPath: 'command-line-arguments',
            imports: [],
            modulePath: 'example.com/canonical',
            packageName: 'main',
            packageDir: path.dirname(request.entry),
            files: [request.entry],
            standard: false,
          },
        ],
        packageGraph: [
          {
            depOnly: false,
            dir: path.dirname(request.entry),
            files: { goFiles: [path.basename(request.entry)] },
            importPath: 'example.com/canonical',
            imports: [],
            modulePath: 'example.com/canonical',
            name: 'main',
            standard: false,
          },
        ],
      }),
    },
  ],
  metadata: {
    buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
    gc: 'precise',
    goarch: 'wasm',
    goos: 'wasip1',
    llvmTarget: 'wasm32-unknown-wasi',
    modulePath: 'example.com/canonical',
    optimize: '-Oz',
    panicStrategy: request.panic ?? 'trap',
    scheduler: request.scheduler ?? 'tasks',
  },
}, null, 2))
NODE
`)
  await chmod(fakeGoPath, 0o755)

  const fakeTinyGoPath = path.join(fakeBinDir, 'tinygo')
  await writeFile(fakeTinyGoPath, `#!/bin/sh
set -eu
if [ "$1" = "info" ]; then
  cat <<'EOF'
LLVM triple:       wasm32-unknown-wasi
GOOS:              wasip1
GOARCH:            wasm
build tags:        gc.precise scheduler.asyncify tinygo purego tinygo.unicore tinygo.wasm
garbage collector: precise
scheduler:         asyncify
EOF
  exit 0
fi
if [ "$1" = "list" ]; then
  cat <<EOF
{"ImportPath":"example.com/canonical","Name":"main","Dir":"$PWD","GoFiles":["main.go"],"Imports":[]}
EOF
  exit 0
fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
mkdir -p "$(dirname "$out")"
printf '\\000asm\\001\\000\\000\\000' > "$out"
`)
  await chmod(fakeTinyGoPath, 0o755)

  const fakeTinyGoRoot = path.join(tempDir, 'tinygo-root')
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys'), { recursive: true })
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'device', 'arm'), { recursive: true })
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys', 'zversion.go'), 'package sys\n')
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'device', 'arm', 'arm.go'), 'package arm\n')

  const workspaceDir = path.join(tempDir, 'workspace')
  await mkdir(workspaceDir, { recursive: true })
  const entryPath = path.join(workspaceDir, 'main.go')
  const outputPath = path.join(workspaceDir, 'out.wasm')
  const requestPath = path.join(workspaceDir, 'tinygo-request.json')
  const bridgeManifestPath = path.join(workspaceDir, 'tinygo-driver-bridge.json')

  await writeFile(path.join(workspaceDir, 'go.mod'), 'module example.com/canonical\n\ngo 1.22\n')
  await writeFile(entryPath, 'package main\n\nfunc main() {}\n')
  await writeFile(requestPath, JSON.stringify({
    command: 'build',
    planner: 'tinygo',
    entry: entryPath,
    optimize: 'z',
    output: outputPath,
    panic: 'trap',
    scheduler: 'asyncify',
    target: 'wasm',
  }))

  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/probe-tinygo-driver-bridge.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_DRIVER_BRIDGE_MANIFEST_PATH: bridgeManifestPath,
      WASM_TINYGO_DRIVER_BRIDGE_INCLUDE_FRONTEND_ANALYSIS: '1',
      WASM_TINYGO_GO_BIN: fakeGoPath,
      WASM_TINYGO_HOST_PROBE_REQUEST_PATH: requestPath,
      WASM_TINYGO_HOST_PROBE_SKIP_RUNTIME: '1',
      WASM_TINYGO_TINYGOROOT: fakeTinyGoRoot,
      WASM_TINYGO_TINYGO_BIN: fakeTinyGoPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })

  assert.equal(exitCode, 0, output)

  const manifest = JSON.parse(await readFile(bridgeManifestPath, 'utf8'))
  assert.deepEqual(manifest.frontendAnalysis?.buildContext, {
    target: 'wasm',
    llvmTarget: 'wasm32-unknown-wasi',
    goos: 'wasip1',
    goarch: 'wasm',
    gc: 'precise',
    scheduler: 'asyncify',
    buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
    modulePath: 'example.com/canonical',
  })
})

test('probe-tinygo-driver-bridge canonicalizes frontend-analysis input toolchain from host facts', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-driver-bridge-script-analysis-input-toolchain-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeBinDir = path.join(tempDir, 'bin')
  await mkdir(fakeBinDir, { recursive: true })

  const fakeGoPath = path.join(fakeBinDir, 'go')
  await writeFile(fakeGoPath, `#!/bin/sh
set -eu
node - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
if (process.env.WASM_TINYGO_MODE === 'frontend' || process.env.WASM_TINYGO_MODE === 'frontend-analysis-build') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_RESULT_PATH, JSON.stringify({
    ok: true,
    generatedFiles: [
      {
        path: '/working/tinygo-compile-unit.json',
        contents: JSON.stringify({
          entryFile: input.entryFile,
          toolchain: input.toolchain,
          sourceSelection: input.sourceSelection,
          compileUnits: input.compileUnits ?? [],
        }),
      },
    ],
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-analysis') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  if (Array.isArray(input.compileUnits)) {
    throw new Error('frontend-analysis expected packageGraph-only input')
  }
  const toolchain = input.toolchain ?? {}
  if (
    toolchain.target !== 'wasm' ||
    toolchain.llvmTarget !== 'wasm32-unknown-wasi' ||
    toolchain.artifactOutputPath !== path.join(path.dirname(input.entryFile), 'out.wasm')
  ) {
    console.error(JSON.stringify(toolchain, null, 2))
    process.exit(15)
  }
  const compileUnits = (input.packageGraph ?? []).map((packageInfo) => ({
    depOnly: packageInfo.depOnly ?? false,
    files: (packageInfo.files?.goFiles ?? []).map((goFile) => path.join(packageInfo.dir, goFile)),
    importPath: packageInfo.importPath,
    imports: packageInfo.imports ?? [],
    kind: packageInfo.depOnly ? (packageInfo.standard ? 'stdlib' : 'imported') : 'program',
    modulePath: packageInfo.modulePath ?? '',
    packageDir: packageInfo.dir,
    packageName: packageInfo.name,
    standard: packageInfo.standard ?? false,
  }))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, JSON.stringify({
    ok: true,
    analysis: {
      buildContext: input.buildContext,
      entryFile: input.entryFile,
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: input.sourceSelection?.allCompile ?? [],
      compileGroups: [
        { name: 'program', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'program').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'imported', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'imported').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'stdlib', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'stdlib').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'all-compile', files: input.sourceSelection?.allCompile ?? [] },
      ],
      compileUnits,
      packageGraph: input.packageGraph ?? [],
      toolchain,
    },
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-real-adapter') {
  const analysisResult = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, 'utf8'))
  const analysis = analysisResult.analysis ?? {}
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH, JSON.stringify({
    ok: true,
    adapter: {
      buildContext: analysis.buildContext,
      entryFile: analysis.entryFile,
      compileUnitManifestPath: analysis.compileUnitManifestPath ?? '/working/tinygo-compile-unit.json',
      allCompileFiles: analysis.allCompileFiles ?? [],
      compileGroups: analysis.compileGroups ?? [],
      compileUnits: analysis.compileUnits ?? [],
      packageGraph: analysis.packageGraph ?? [],
      toolchain: analysis.toolchain ?? {},
    },
  }, null, 2))
  process.exit(0)
}
const request = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_REQUEST_PATH, 'utf8'))
fs.writeFileSync(process.env.WASM_TINYGO_RESULT_PATH, JSON.stringify({
  ok: true,
  files: [
    {
      path: '/working/tinygo-frontend-input.json',
      contents: JSON.stringify({
        buildContext: {
          target: request.target,
          llvmTarget: 'wasm32-unknown-wasi',
          goos: 'wasip1',
          goarch: 'wasm',
          gc: 'precise',
          scheduler: request.scheduler ?? 'tasks',
          buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
          modulePath: 'example.com/toolchain',
        },
        entryFile: request.entry,
        modulePath: 'example.com/toolchain',
        toolchain: {
          target: 'js',
          llvmTarget: 'wasm32-unknown-unknown',
          artifactOutputPath: request.output,
        },
        sourceSelection: {
          program: [request.entry],
          allCompile: [request.entry],
        },
        compileUnits: [
          {
            depOnly: false,
            kind: 'program',
            importPath: 'command-line-arguments',
            imports: [],
            modulePath: 'example.com/toolchain',
            packageName: 'main',
            packageDir: path.dirname(request.entry),
            files: [request.entry],
            standard: false,
          },
        ],
        packageGraph: [
          {
            depOnly: false,
            dir: path.dirname(request.entry),
            files: { goFiles: [path.basename(request.entry)] },
            importPath: 'example.com/toolchain',
            imports: [],
            modulePath: 'example.com/toolchain',
            name: 'main',
            standard: false,
          },
        ],
      }),
    },
  ],
  metadata: {
    buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
    gc: 'precise',
    goarch: 'wasm',
    goos: 'wasip1',
    llvmTarget: 'wasm32-unknown-wasi',
    modulePath: 'example.com/toolchain',
    optimize: '-Oz',
    panicStrategy: request.panic ?? 'trap',
    scheduler: request.scheduler ?? 'tasks',
  },
}, null, 2))
NODE
`)
  await chmod(fakeGoPath, 0o755)

  const fakeTinyGoPath = path.join(fakeBinDir, 'tinygo')
  await writeFile(fakeTinyGoPath, `#!/bin/sh
set -eu
if [ "$1" = "info" ]; then
  cat <<'EOF'
LLVM triple:       wasm32-unknown-wasi
GOOS:              wasip1
GOARCH:            wasm
build tags:        gc.precise scheduler.tasks tinygo purego tinygo.unicore tinygo.wasm
garbage collector: precise
scheduler:         tasks
EOF
  exit 0
fi
if [ "$1" = "list" ]; then
  cat <<EOF
{"Dir":"$PWD","ImportPath":"example.com/toolchain","Module":{"Path":"example.com/toolchain"},"Name":"main","GoFiles":["main.go"],"Imports":[]}
EOF
  exit 0
fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
mkdir -p "$(dirname "$out")"
printf '\\000asm\\001\\000\\000\\000' > "$out"
`)
  await chmod(fakeTinyGoPath, 0o755)

  const fakeTinyGoRoot = path.join(tempDir, 'tinygo-root')
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys'), { recursive: true })
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'device', 'arm'), { recursive: true })
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys', 'zversion.go'), 'package sys\n')
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'device', 'arm', 'arm.go'), 'package arm\n')

  const workspaceDir = path.join(tempDir, 'workspace')
  await mkdir(workspaceDir, { recursive: true })
  const entryPath = path.join(workspaceDir, 'main.go')
  const outputPath = path.join(workspaceDir, 'out.wasm')
  const requestPath = path.join(workspaceDir, 'tinygo-request.json')
  const bridgeManifestPath = path.join(workspaceDir, 'tinygo-driver-bridge.json')

  await writeFile(path.join(workspaceDir, 'go.mod'), 'module example.com/toolchain\n\ngo 1.22\n')
  await writeFile(entryPath, 'package main\n\nfunc main() {}\n')
  await writeFile(requestPath, JSON.stringify({
    command: 'build',
    planner: 'tinygo',
    entry: entryPath,
    optimize: 'z',
    output: outputPath,
    panic: 'trap',
    target: 'wasm',
  }))

  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/probe-tinygo-driver-bridge.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_DRIVER_BRIDGE_MANIFEST_PATH: bridgeManifestPath,
      WASM_TINYGO_DRIVER_BRIDGE_INCLUDE_FRONTEND_ANALYSIS: '1',
      WASM_TINYGO_GO_BIN: fakeGoPath,
      WASM_TINYGO_HOST_PROBE_REQUEST_PATH: requestPath,
      WASM_TINYGO_HOST_PROBE_SKIP_RUNTIME: '1',
      WASM_TINYGO_TINYGOROOT: fakeTinyGoRoot,
      WASM_TINYGO_TINYGO_BIN: fakeTinyGoPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })

  assert.equal(exitCode, 0, output)
  const manifest = JSON.parse(await readFile(bridgeManifestPath, 'utf8'))
  assert.deepEqual(manifest.frontendAnalysis?.toolchain, {
    target: 'wasm',
    llvmTarget: 'wasm32-unknown-wasi',
    artifactOutputPath: outputPath,
  })
})

test('probe-tinygo-driver-bridge canonicalizes alias-only tinygo list program packages from frontend analysis packageGraph', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-driver-bridge-script-program-alias-canonicalization-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeBinDir = path.join(tempDir, 'bin')
  await mkdir(fakeBinDir, { recursive: true })

  const fakeGoPath = path.join(fakeBinDir, 'go')
  await writeFile(fakeGoPath, `#!/bin/sh
set -eu
node - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
if (process.env.WASM_TINYGO_MODE === 'frontend' || process.env.WASM_TINYGO_MODE === 'frontend-analysis-build') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_RESULT_PATH, JSON.stringify({
    ok: true,
    generatedFiles: [
      {
        path: '/working/tinygo-compile-unit.json',
        contents: JSON.stringify({
          entryFile: input.entryFile,
          toolchain: input.toolchain,
          sourceSelection: input.sourceSelection,
          compileUnits: [
            {
              kind: 'program',
              importPath: 'command-line-arguments',
              imports: ['fmt'],
              modulePath: 'example.com/canonicalized',
              depOnly: false,
              packageName: 'main',
              packageDir: path.dirname(input.entryFile),
              files: [input.entryFile],
              standard: false,
            },
            {
              kind: 'stdlib',
              importPath: 'fmt',
              imports: [],
              modulePath: '',
              depOnly: true,
              packageName: 'fmt',
              packageDir: '/working/.tinygo-root/src/fmt',
              files: ['/working/.tinygo-root/src/fmt/print.go'],
              standard: true,
            },
          ],
        }),
      },
    ],
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-analysis') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  if (Array.isArray(input.compileUnits)) {
    throw new Error('frontend-analysis expected packageGraph-only input')
  }
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, JSON.stringify({
    ok: true,
    analysis: {
      buildContext: input.buildContext,
      entryFile: input.entryFile,
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: input.sourceSelection?.allCompile ?? [],
      compileGroups: [
        { name: 'program', files: [input.entryFile] },
        { name: 'imported', files: [] },
        { name: 'stdlib', files: ['/working/.tinygo-root/src/fmt/print.go'] },
        { name: 'all-compile', files: input.sourceSelection?.allCompile ?? [] },
      ],
      compileUnits: [
        {
          depOnly: false,
          files: [input.entryFile],
          importPath: 'example.com/canonicalized',
          imports: ['fmt'],
          kind: 'program',
          modulePath: 'example.com/canonicalized',
          packageDir: path.dirname(input.entryFile),
          packageName: 'main',
          standard: false,
        },
        {
          depOnly: true,
          files: ['/working/.tinygo-root/src/fmt/print.go'],
          importPath: 'fmt',
          imports: [],
          kind: 'stdlib',
          modulePath: '',
          packageDir: '/working/.tinygo-root/src/fmt',
          packageName: 'fmt',
          standard: true,
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: path.dirname(input.entryFile),
          files: { goFiles: [path.basename(input.entryFile)] },
          importPath: 'example.com/canonicalized',
          imports: ['fmt'],
          modulePath: 'example.com/canonicalized',
          name: 'main',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/working/.tinygo-root/src/fmt',
          files: { goFiles: ['print.go'] },
          importPath: 'fmt',
          imports: [],
          modulePath: '',
          name: 'fmt',
          standard: true,
        },
      ],
      toolchain: {
        target: input.toolchain?.target,
        llvmTarget: input.buildContext?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-real-adapter') {
  const analysisResult = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, 'utf8'))
  const analysis = analysisResult.analysis ?? {}
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH, JSON.stringify({
    ok: true,
    adapter: {
      ...analysis,
      compileGroups: [
        { name: 'program', files: [analysis.entryFile] },
        { name: 'imported', files: [] },
        { name: 'stdlib', files: ['/working/.tinygo-root/src/fmt/print.go'] },
        { name: 'all-compile', files: analysis.allCompileFiles ?? [] },
      ],
    },
  }, null, 2))
  process.exit(0)
}
const request = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_REQUEST_PATH, 'utf8'))
fs.writeFileSync(process.env.WASM_TINYGO_RESULT_PATH, JSON.stringify({
  ok: true,
  files: [
    {
      path: '/working/tinygo-frontend-input.json',
      contents: JSON.stringify({
        buildContext: {
          target: request.target,
          llvmTarget: 'wasm32-unknown-wasi',
          goos: 'js',
          goarch: 'wasm',
          gc: 'precise',
          scheduler: request.scheduler ?? 'asyncify',
          buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
          modulePath: 'example.com/canonicalized',
        },
        entryFile: request.entry,
        modulePath: 'example.com/canonicalized',
        toolchain: {
          target: request.target,
          artifactOutputPath: request.output,
        },
        sourceSelection: {
          program: [request.entry],
          allCompile: [request.entry, '/working/.tinygo-root/src/fmt/print.go'],
        },
        compileUnits: [
          {
            kind: 'program',
            importPath: 'command-line-arguments',
            packageName: 'main',
            packageDir: path.dirname(request.entry),
            files: [request.entry],
          },
          {
            kind: 'stdlib',
            importPath: 'fmt',
            packageName: 'fmt',
            packageDir: '/working/.tinygo-root/src/fmt',
            files: ['/working/.tinygo-root/src/fmt/print.go'],
          },
        ],
        packageGraph: [
          {
            depOnly: false,
            dir: path.dirname(request.entry),
            files: { goFiles: [path.basename(request.entry)] },
            importPath: 'command-line-arguments',
            imports: ['fmt'],
            modulePath: 'example.com/canonicalized',
            name: 'main',
            standard: false,
          },
          {
            depOnly: true,
            dir: '/working/.tinygo-root/src/fmt',
            files: { goFiles: ['print.go'] },
            importPath: 'fmt',
            imports: [],
            modulePath: '',
            name: 'fmt',
            standard: true,
          },
        ],
      }),
    },
  ],
  metadata: {
    buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
    gc: 'precise',
    goarch: 'wasm',
    goos: 'js',
    llvmTarget: 'wasm32-unknown-wasi',
    optimize: '-Oz',
    panicStrategy: request.panic ?? 'print',
    scheduler: request.scheduler ?? 'asyncify',
  },
}, null, 2))
NODE
`)
  await chmod(fakeGoPath, 0o755)

  const fakeTinyGoPath = path.join(fakeBinDir, 'tinygo')
  await writeFile(fakeTinyGoPath, `#!/bin/sh
set -eu
if [ "$1" = "info" ]; then
  cat <<'EOF'
LLVM triple:       wasm32-unknown-wasi
GOOS:              js
GOARCH:            wasm
build tags:        gc.precise scheduler.asyncify tinygo purego tinygo.unicore tinygo.wasm
garbage collector: precise
scheduler:         asyncify
EOF
  exit 0
fi
if [ "$1" = "list" ]; then
  cat <<EOF
{
  "Dir": "$(pwd)",
  "ImportPath": "command-line-arguments",
  "Module": {
    "Path": "example.com/canonicalized"
  },
  "Name": "main",
  "GoFiles": [
    "main.go"
  ],
  "Imports": [
    "fmt"
  ]
}
{
  "Dir": "/working/.tinygo-root/src/fmt",
  "ImportPath": "fmt",
  "Name": "fmt",
  "GoFiles": [
    "print.go"
  ],
  "Imports": [],
  "DepOnly": true,
  "Standard": true
}
EOF
  exit 0
fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
mkdir -p "$(dirname "$out")"
printf '\\000asm\\001\\000\\000\\000' > "$out"
`)
  await chmod(fakeTinyGoPath, 0o755)

  const fakeTinyGoRoot = path.join(tempDir, 'tinygo-root')
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys'), { recursive: true })
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'device', 'arm'), { recursive: true })
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'fmt'), { recursive: true })
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys', 'zversion.go'), 'package sys\n')
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'device', 'arm', 'arm.go'), 'package arm\n')
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'fmt', 'print.go'), 'package fmt\n')

  const workspaceDir = path.join(tempDir, 'workspace')
  await mkdir(workspaceDir, { recursive: true })
  const entryPath = path.join(workspaceDir, 'main.go')
  const outputPath = path.join(workspaceDir, 'out.wasm')
  const requestPath = path.join(workspaceDir, 'tinygo-request.json')
  const bridgeManifestPath = path.join(workspaceDir, 'tinygo-driver-bridge.json')

  await writeFile(entryPath, 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println() }\n')
  await writeFile(requestPath, JSON.stringify({
    command: 'build',
    planner: 'tinygo',
    entry: entryPath,
    optimize: 'z',
    output: outputPath,
    panic: 'trap',
    target: 'wasm',
  }))

  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/probe-tinygo-driver-bridge.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_DRIVER_BRIDGE_MANIFEST_PATH: bridgeManifestPath,
      WASM_TINYGO_DRIVER_BRIDGE_INCLUDE_FRONTEND_ANALYSIS: '1',
      WASM_TINYGO_GO_BIN: fakeGoPath,
      WASM_TINYGO_HOST_PROBE_REQUEST_PATH: requestPath,
      WASM_TINYGO_HOST_PROBE_SKIP_RUNTIME: '1',
      WASM_TINYGO_TINYGOROOT: fakeTinyGoRoot,
      WASM_TINYGO_TINYGO_BIN: fakeTinyGoPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })

  assert.equal(exitCode, 0, output)
  const manifest = JSON.parse(await readFile(bridgeManifestPath, 'utf8'))
  assert.deepEqual(manifest.entryPackage, {
    dir: workspaceDir,
    goFiles: ['main.go'],
    importPath: 'example.com/canonicalized',
    imports: ['fmt'],
    name: 'main',
  })
  assert.deepEqual(manifest.packageGraph, [
    {
      depOnly: false,
      dir: workspaceDir,
      goFiles: ['main.go'],
      importPath: 'example.com/canonicalized',
      imports: ['fmt'],
      modulePath: 'example.com/canonicalized',
      name: 'main',
      standard: false,
    },
    {
      depOnly: true,
      dir: '/working/.tinygo-root/src/fmt',
      goFiles: ['print.go'],
      importPath: 'fmt',
      imports: [],
      modulePath: '',
      name: 'fmt',
      standard: true,
    },
  ])
})

test('probe-tinygo-driver-bridge canonicalizes frontend-analysis input packageGraph from host tinygo list facts', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-driver-bridge-script-analysis-input-package-graph-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeBinDir = path.join(tempDir, 'bin')
  await mkdir(fakeBinDir, { recursive: true })

  const fakeGoPath = path.join(fakeBinDir, 'go')
  await writeFile(fakeGoPath, `#!/bin/sh
set -eu
node - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
if (process.env.WASM_TINYGO_MODE === 'frontend' || process.env.WASM_TINYGO_MODE === 'frontend-analysis-build') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_RESULT_PATH, JSON.stringify({
    ok: true,
    generatedFiles: [
      {
        path: '/working/tinygo-compile-unit.json',
        contents: JSON.stringify({
          entryFile: input.entryFile,
          toolchain: input.toolchain,
          sourceSelection: input.sourceSelection,
          compileUnits: input.compileUnits,
        }),
      },
    ],
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-analysis') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  if (Array.isArray(input.compileUnits)) {
    throw new Error('frontend-analysis expected packageGraph-only input')
  }
  const expectedPackageGraph = [
    {
      depOnly: false,
      dir: path.dirname(input.entryFile),
      files: { goFiles: ['main.go'] },
      importPath: 'example.com/packagegraph',
      imports: ['fmt'],
      modulePath: 'example.com/packagegraph',
      name: 'main',
      standard: false,
    },
    {
      depOnly: true,
      dir: '/working/.tinygo-root/src/fmt',
      files: { goFiles: ['print.go'] },
      importPath: 'fmt',
      imports: ['errors'],
      modulePath: '',
      name: 'fmt',
      standard: true,
    },
  ]
  if (JSON.stringify(input.packageGraph ?? []) !== JSON.stringify(expectedPackageGraph)) {
    console.error(JSON.stringify(input.packageGraph ?? [], null, 2))
    process.exit(14)
  }
  const compileUnits = expectedPackageGraph.map((packageInfo) => ({
    depOnly: packageInfo.depOnly,
    files: (packageInfo.files?.goFiles ?? []).map((goFile) => path.join(packageInfo.dir, goFile)),
    importPath: packageInfo.importPath,
    imports: packageInfo.imports ?? [],
    kind: packageInfo.depOnly ? (packageInfo.standard ? 'stdlib' : 'imported') : 'program',
    modulePath: packageInfo.modulePath ?? '',
    packageDir: packageInfo.dir,
    packageName: packageInfo.name,
    standard: packageInfo.standard ?? false,
  }))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, JSON.stringify({
    ok: true,
    analysis: {
      buildContext: input.buildContext,
      entryFile: input.entryFile,
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: input.sourceSelection?.allCompile ?? [],
      compileGroups: [
        { name: 'program', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'program').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'imported', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'imported').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'stdlib', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'stdlib').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'all-compile', files: input.sourceSelection?.allCompile ?? [] },
      ],
      compileUnits,
      packageGraph: expectedPackageGraph.map((packageInfo) => ({
        depOnly: packageInfo.depOnly,
        dir: packageInfo.dir,
        files: { goFiles: packageInfo.files?.goFiles ?? [] },
        importPath: packageInfo.importPath,
        imports: packageInfo.imports ?? [],
        modulePath: packageInfo.modulePath ?? '',
        name: packageInfo.name,
        standard: packageInfo.standard ?? false,
      })),
      toolchain: {
        target: input.toolchain?.target,
        llvmTarget: input.buildContext?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-real-adapter') {
  const analysisResult = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, 'utf8'))
  const analysis = analysisResult.analysis ?? {}
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH, JSON.stringify({
    ok: true,
    adapter: {
      buildContext: analysis.buildContext,
      entryFile: analysis.entryFile,
      compileUnitManifestPath: analysis.compileUnitManifestPath ?? '/working/tinygo-compile-unit.json',
      allCompileFiles: analysis.allCompileFiles ?? [],
      compileGroups: analysis.compileGroups ?? [],
      compileUnits: analysis.compileUnits ?? [],
      packageGraph: analysis.packageGraph ?? [],
      toolchain: {
        target: analysis.toolchain?.target,
        llvmTarget: analysis.toolchain?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
const request = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_REQUEST_PATH, 'utf8'))
fs.writeFileSync(process.env.WASM_TINYGO_RESULT_PATH, JSON.stringify({
  ok: true,
  files: [
    {
      path: '/working/tinygo-frontend-input.json',
      contents: JSON.stringify({
        buildContext: {
          target: request.target,
          llvmTarget: 'wasm32-unknown-wasi',
          goos: 'wasip1',
          goarch: 'wasm',
          gc: 'precise',
          scheduler: request.scheduler ?? 'tasks',
          buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
          modulePath: 'example.com/packagegraph',
        },
        entryFile: request.entry,
        modulePath: 'example.com/packagegraph',
        toolchain: {
          target: request.target,
          artifactOutputPath: request.output,
        },
        sourceSelection: {
          program: [request.entry],
          allCompile: [request.entry, '/working/.tinygo-root/src/fmt/print.go'],
        },
        compileUnits: [
          {
            depOnly: false,
            kind: 'program',
            importPath: 'command-line-arguments',
            imports: [],
            modulePath: 'example.com/packagegraph',
            packageName: 'main',
            packageDir: path.dirname(request.entry),
            files: [request.entry],
            standard: false,
          },
          {
            depOnly: true,
            kind: 'stdlib',
            importPath: 'fmt',
            imports: [],
            modulePath: '',
            packageName: 'fmt',
            packageDir: '/working/.tinygo-root/src/fmt',
            files: ['/working/.tinygo-root/src/fmt/print.go'],
            standard: true,
          },
        ],
        packageGraph: [
          {
            depOnly: false,
            dir: path.dirname(request.entry),
            goFiles: [path.basename(request.entry)],
            importPath: 'command-line-arguments',
            imports: [],
            modulePath: 'example.com/packagegraph',
            name: 'main',
            standard: false,
          },
        ],
      }),
    },
  ],
  metadata: {
    buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
    gc: 'precise',
    goarch: 'wasm',
    goos: 'wasip1',
    llvmTarget: 'wasm32-unknown-wasi',
    modulePath: 'example.com/packagegraph',
    optimize: '-Oz',
    panicStrategy: request.panic ?? 'trap',
    scheduler: request.scheduler ?? 'tasks',
  },
}, null, 2))
NODE
`)
  await chmod(fakeGoPath, 0o755)

  const fakeTinyGoPath = path.join(fakeBinDir, 'tinygo')
  await writeFile(fakeTinyGoPath, `#!/bin/sh
set -eu
if [ "$1" = "info" ]; then
  cat <<'EOF'
LLVM triple:       wasm32-unknown-wasi
GOOS:              wasip1
GOARCH:            wasm
build tags:        gc.precise scheduler.tasks tinygo purego tinygo.unicore tinygo.wasm
garbage collector: precise
scheduler:         tasks
EOF
  exit 0
fi
if [ "$1" = "list" ]; then
  cat <<EOF
{"Dir":"$PWD","ImportPath":"example.com/packagegraph","Module":{"Path":"example.com/packagegraph"},"Name":"main","GoFiles":["main.go"],"Imports":["fmt"]}
{"Dir":"/working/.tinygo-root/src/fmt","ImportPath":"fmt","Name":"fmt","GoFiles":["print.go"],"Imports":["errors"],"DepOnly":true,"Standard":true}
EOF
  exit 0
fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
mkdir -p "$(dirname "$out")"
printf '\\000asm\\001\\000\\000\\000' > "$out"
`)
  await chmod(fakeTinyGoPath, 0o755)

  const fakeTinyGoRoot = path.join(tempDir, 'tinygo-root')
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys'), { recursive: true })
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'device', 'arm'), { recursive: true })
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys', 'zversion.go'), 'package sys\n')
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'device', 'arm', 'arm.go'), 'package arm\n')

  const workspaceDir = path.join(tempDir, 'workspace')
  await mkdir(workspaceDir, { recursive: true })
  const entryPath = path.join(workspaceDir, 'main.go')
  const outputPath = path.join(workspaceDir, 'out.wasm')
  const requestPath = path.join(workspaceDir, 'tinygo-request.json')
  const bridgeManifestPath = path.join(workspaceDir, 'tinygo-driver-bridge.json')

  await writeFile(path.join(workspaceDir, 'go.mod'), 'module example.com/packagegraph\n\ngo 1.22\n')
  await writeFile(entryPath, 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("ok") }\n')
  await writeFile(requestPath, JSON.stringify({
    command: 'build',
    planner: 'tinygo',
    entry: entryPath,
    optimize: 'z',
    output: outputPath,
    panic: 'trap',
    target: 'wasm',
  }))

  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/probe-tinygo-driver-bridge.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_DRIVER_BRIDGE_MANIFEST_PATH: bridgeManifestPath,
      WASM_TINYGO_DRIVER_BRIDGE_INCLUDE_FRONTEND_ANALYSIS: '1',
      WASM_TINYGO_GO_BIN: fakeGoPath,
      WASM_TINYGO_HOST_PROBE_REQUEST_PATH: requestPath,
      WASM_TINYGO_HOST_PROBE_SKIP_RUNTIME: '1',
      WASM_TINYGO_TINYGOROOT: fakeTinyGoRoot,
      WASM_TINYGO_TINYGO_BIN: fakeTinyGoPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })

  assert.equal(exitCode, 0, output)

  const manifest = JSON.parse(await readFile(bridgeManifestPath, 'utf8'))
  assert.deepEqual(manifest.frontendAnalysis?.packageGraph, [
    {
      depOnly: false,
      dir: workspaceDir,
      files: { goFiles: ['main.go'] },
      importPath: 'example.com/packagegraph',
      imports: ['fmt'],
      modulePath: 'example.com/packagegraph',
      name: 'main',
      standard: false,
    },
    {
      depOnly: true,
      dir: '/working/.tinygo-root/src/fmt',
      files: { goFiles: ['print.go'] },
      importPath: 'fmt',
      imports: ['errors'],
      modulePath: '',
      name: 'fmt',
      standard: true,
    },
  ])
})

test('probe-tinygo-driver-bridge rejects mismatched frontend-analysis buildContext instead of patching it', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-driver-bridge-script-analysis-mismatch-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeBinDir = path.join(tempDir, 'bin')
  await mkdir(fakeBinDir, { recursive: true })

  const fakeGoPath = path.join(fakeBinDir, 'go')
  await writeFile(fakeGoPath, `#!/bin/sh
set -eu
node - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
if (process.env.WASM_TINYGO_MODE === 'frontend' || process.env.WASM_TINYGO_MODE === 'frontend-analysis-build') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_RESULT_PATH, JSON.stringify({
    ok: true,
    generatedFiles: [
      {
        path: '/working/tinygo-compile-unit.json',
        contents: JSON.stringify({
          entryFile: input.entryFile,
          toolchain: input.toolchain,
          sourceSelection: input.sourceSelection,
          compileUnits: input.compileUnits,
        }),
      },
    ],
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-analysis') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  if (Array.isArray(input.compileUnits)) {
    throw new Error('frontend-analysis expected packageGraph-only input')
  }
  const compileUnits = (input.packageGraph ?? []).map((packageInfo) => ({
    depOnly: packageInfo.depOnly ?? false,
    files: (packageInfo.files?.goFiles ?? []).map((goFile) => path.join(packageInfo.dir, goFile)),
    importPath: packageInfo.importPath,
    imports: packageInfo.imports ?? [],
    kind: packageInfo.depOnly ? (packageInfo.standard ? 'stdlib' : 'imported') : 'program',
    packageDir: packageInfo.dir,
    packageName: packageInfo.name,
    standard: packageInfo.standard ?? false,
  }))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, JSON.stringify({
    ok: true,
    analysis: {
      buildContext: {
        ...input.buildContext,
        target: 'mismatch-target',
      },
      entryFile: input.entryFile,
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: input.sourceSelection?.allCompile ?? [],
      compileGroups: [
        { name: 'program', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'program').flatMap((compileUnit) => compileUnit.files ?? []) },
      ],
      compileUnits,
      packageGraph: input.packageGraph,
      toolchain: {
        target: input.toolchain?.target,
        llvmTarget: input.buildContext?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-real-adapter') {
  const analysisResult = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, 'utf8'))
  const analysis = analysisResult.analysis ?? {}
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH, JSON.stringify({
    ok: true,
    adapter: {
      buildContext: analysis.buildContext,
      entryFile: analysis.entryFile,
      compileUnitManifestPath: analysis.compileUnitManifestPath ?? '/working/tinygo-compile-unit.json',
      allCompileFiles: analysis.allCompileFiles ?? [],
      compileGroups: analysis.compileGroups ?? [],
      compileUnits: analysis.compileUnits ?? [],
      packageGraph: analysis.packageGraph ?? [],
      toolchain: {
        target: analysis.toolchain?.target,
        llvmTarget: analysis.toolchain?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
const request = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_REQUEST_PATH, 'utf8'))
fs.writeFileSync(process.env.WASM_TINYGO_RESULT_PATH, JSON.stringify({
  ok: true,
  files: [
    {
      path: '/working/tinygo-frontend-input.json',
      contents: JSON.stringify({
        buildContext: {
          target: request.target,
          llvmTarget: 'wasm32-unknown-wasi',
          goos: 'wasip1',
          goarch: 'wasm',
          gc: 'precise',
          scheduler: request.scheduler ?? 'asyncify',
          buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
          modulePath: 'example.com/mismatch',
        },
        entryFile: request.entry,
        modulePath: 'example.com/mismatch',
        toolchain: {
          target: request.target,
          artifactOutputPath: request.output,
        },
        sourceSelection: {
          program: [request.entry],
          allCompile: [request.entry],
        },
        compileUnits: [
          {
            kind: 'program',
            importPath: 'command-line-arguments',
            imports: [],
            packageName: 'main',
            packageDir: path.dirname(request.entry),
            files: [request.entry],
          },
        ],
        packageGraph: [
          {
            depOnly: false,
            dir: path.dirname(request.entry),
            files: { goFiles: [path.basename(request.entry)] },
            importPath: 'example.com/mismatch',
            imports: [],
            modulePath: 'example.com/mismatch',
            name: 'main',
            standard: false,
          },
        ],
      }),
    },
  ],
  metadata: {
    buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
    gc: 'precise',
    goarch: 'wasm',
    goos: 'wasip1',
    llvmTarget: 'wasm32-unknown-wasi',
    optimize: '-Oz',
    panicStrategy: request.panic ?? 'trap',
    scheduler: request.scheduler ?? 'asyncify',
  },
}, null, 2))
NODE
`)
  await chmod(fakeGoPath, 0o755)

  const fakeTinyGoPath = path.join(fakeBinDir, 'tinygo')
  await writeFile(fakeTinyGoPath, `#!/bin/sh
set -eu
if [ "$1" = "info" ]; then
  cat <<'EOF'
LLVM triple:       wasm32-unknown-wasi
GOOS:              wasip1
GOARCH:            wasm
build tags:        gc.precise scheduler.asyncify tinygo purego tinygo.unicore tinygo.wasm
garbage collector: precise
scheduler:         asyncify
EOF
  exit 0
fi
if [ "$1" = "list" ]; then
  cat <<EOF
{"ImportPath":"example.com/mismatch","Name":"main","Dir":"$PWD","GoFiles":["main.go"],"Imports":[]}
EOF
  exit 0
fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
mkdir -p "$(dirname "$out")"
printf '\\000asm\\001\\000\\000\\000' > "$out"
`)
  await chmod(fakeTinyGoPath, 0o755)

  const fakeTinyGoRoot = path.join(tempDir, 'tinygo-root')
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys'), { recursive: true })
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'device', 'arm'), { recursive: true })
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys', 'zversion.go'), 'package sys\n')
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'device', 'arm', 'arm.go'), 'package arm\n')

  const workspaceDir = path.join(tempDir, 'workspace')
  await mkdir(workspaceDir, { recursive: true })
  const entryPath = path.join(workspaceDir, 'main.go')
  const outputPath = path.join(workspaceDir, 'out.wasm')
  const requestPath = path.join(workspaceDir, 'tinygo-request.json')
  const bridgeManifestPath = path.join(workspaceDir, 'tinygo-driver-bridge.json')

  await writeFile(path.join(workspaceDir, 'go.mod'), 'module example.com/mismatch\n\ngo 1.22\n')
  await writeFile(entryPath, 'package main\n\nfunc main() {}\n')
  await writeFile(requestPath, JSON.stringify({
    command: 'build',
    planner: 'tinygo',
    entry: entryPath,
    optimize: 'z',
    output: outputPath,
    panic: 'trap',
    target: 'wasm',
  }))

  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/probe-tinygo-driver-bridge.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_DRIVER_BRIDGE_MANIFEST_PATH: bridgeManifestPath,
      WASM_TINYGO_DRIVER_BRIDGE_INCLUDE_FRONTEND_ANALYSIS: '1',
      WASM_TINYGO_GO_BIN: fakeGoPath,
      WASM_TINYGO_HOST_PROBE_REQUEST_PATH: requestPath,
      WASM_TINYGO_HOST_PROBE_SKIP_RUNTIME: '1',
      WASM_TINYGO_TINYGOROOT: fakeTinyGoRoot,
      WASM_TINYGO_TINYGO_BIN: fakeTinyGoPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })

  assert.equal(exitCode, 1, output)
  assert.match(output, /frontend analysis buildContext did not match real TinyGo driver bridge/)
})

test('probe-tinygo-driver-bridge rejects mismatched frontend-analysis compileUnits instead of accepting them', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-driver-bridge-script-analysis-compileunits-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeBinDir = path.join(tempDir, 'bin')
  await mkdir(fakeBinDir, { recursive: true })

  const fakeGoPath = path.join(fakeBinDir, 'go')
  await writeFile(fakeGoPath, `#!/bin/sh
set -eu
node - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
if (process.env.WASM_TINYGO_MODE === 'frontend' || process.env.WASM_TINYGO_MODE === 'frontend-analysis-build') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_RESULT_PATH, JSON.stringify({
    ok: true,
    generatedFiles: [
      {
        path: '/working/tinygo-compile-unit.json',
        contents: JSON.stringify({
          entryFile: input.entryFile,
          toolchain: input.toolchain,
          sourceSelection: input.sourceSelection,
          compileUnits: input.compileUnits,
        }),
      },
    ],
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-analysis') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  if (Array.isArray(input.compileUnits)) {
    throw new Error('frontend-analysis expected packageGraph-only input')
  }
  const compileUnits = (input.packageGraph ?? []).map((packageInfo) => ({
    depOnly: packageInfo.depOnly ?? false,
    files: (packageInfo.files?.goFiles ?? []).map((goFile) => path.join(packageInfo.dir, goFile)),
    importPath: packageInfo.importPath,
    imports: packageInfo.depOnly ? (packageInfo.imports ?? []) : [],
    kind: packageInfo.depOnly ? (packageInfo.standard ? 'stdlib' : 'imported') : 'program',
    packageDir: packageInfo.dir,
    packageName: packageInfo.name,
    standard: packageInfo.standard ?? false,
  }))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, JSON.stringify({
    ok: true,
    analysis: {
      buildContext: input.buildContext,
      entryFile: input.entryFile,
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: input.sourceSelection?.allCompile ?? [],
      compileGroups: [
        { name: 'program', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'program').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'imported', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'imported').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'stdlib', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'stdlib').flatMap((compileUnit) => compileUnit.files ?? []) },
        { name: 'all-compile', files: input.sourceSelection?.allCompile ?? [] },
      ],
      compileUnits,
      packageGraph: input.packageGraph,
      toolchain: {
        target: input.toolchain?.target,
        llvmTarget: input.buildContext?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-real-adapter') {
  const analysisResult = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, 'utf8'))
  const analysis = analysisResult.analysis ?? {}
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH, JSON.stringify({
    ok: true,
    adapter: {
      buildContext: analysis.buildContext,
      entryFile: analysis.entryFile,
      compileUnitManifestPath: analysis.compileUnitManifestPath ?? '/working/tinygo-compile-unit.json',
      allCompileFiles: analysis.allCompileFiles ?? [],
      compileGroups: analysis.compileGroups ?? [],
      compileUnits: analysis.compileUnits ?? [],
      packageGraph: analysis.packageGraph ?? [],
      toolchain: {
        target: analysis.toolchain?.target,
        llvmTarget: analysis.toolchain?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
const request = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_REQUEST_PATH, 'utf8'))
fs.writeFileSync(process.env.WASM_TINYGO_RESULT_PATH, JSON.stringify({
  ok: true,
  files: [
    {
      path: '/working/tinygo-frontend-input.json',
      contents: JSON.stringify({
        buildContext: {
          target: request.target,
          llvmTarget: 'wasm32-unknown-wasi',
          goos: 'wasip1',
          goarch: 'wasm',
          gc: 'precise',
          scheduler: request.scheduler ?? 'asyncify',
          buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
          modulePath: 'example.com/compileunits',
        },
        entryFile: request.entry,
        modulePath: 'example.com/compileunits',
        toolchain: {
          target: request.target,
          artifactOutputPath: request.output,
        },
        sourceSelection: {
          program: [request.entry],
          allCompile: [request.entry, '/working/.tinygo-root/src/fmt/print.go'],
        },
        compileUnits: [
          {
            kind: 'program',
            importPath: 'command-line-arguments',
            imports: ['fmt'],
            packageName: 'main',
            packageDir: path.dirname(request.entry),
            files: [request.entry],
          },
          {
            kind: 'stdlib',
            importPath: 'fmt',
            imports: ['errors'],
            packageName: 'fmt',
            packageDir: '/working/.tinygo-root/src/fmt',
            files: ['/working/.tinygo-root/src/fmt/print.go'],
          },
        ],
        packageGraph: [
          {
            depOnly: false,
            dir: path.dirname(request.entry),
            files: { goFiles: [path.basename(request.entry)] },
            importPath: 'example.com/compileunits',
            imports: ['fmt'],
            modulePath: 'example.com/compileunits',
            name: 'main',
            standard: false,
          },
          {
            depOnly: true,
            dir: '/working/.tinygo-root/src/fmt',
            files: { goFiles: ['print.go'] },
            importPath: 'fmt',
            imports: ['errors'],
            modulePath: '',
            name: 'fmt',
            standard: true,
          },
        ],
      }),
    },
  ],
  metadata: {
    buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
    gc: 'precise',
    goarch: 'wasm',
    goos: 'wasip1',
    llvmTarget: 'wasm32-unknown-wasi',
    optimize: '-Oz',
    panicStrategy: request.panic ?? 'print',
    scheduler: request.scheduler ?? 'asyncify',
  },
}, null, 2))
NODE
`)
  await chmod(fakeGoPath, 0o755)

  const fakeTinyGoPath = path.join(fakeBinDir, 'tinygo')
  await writeFile(fakeTinyGoPath, `#!/bin/sh
set -eu
if [ "$1" = "info" ]; then
  cat <<'EOF'
LLVM triple:       wasm32-unknown-wasi
GOOS:              wasip1
GOARCH:            wasm
build tags:        gc.precise scheduler.asyncify tinygo purego tinygo.unicore tinygo.wasm
garbage collector: precise
scheduler:         asyncify
EOF
  exit 0
fi
if [ "$1" = "list" ]; then
  cat <<EOF
{
  "Dir": "$(pwd)",
  "ImportPath": "example.com/compileunits",
  "Module": {
    "Path": "example.com/compileunits"
  },
  "Name": "main",
  "GoFiles": [
    "main.go"
  ],
  "Imports": [
    "fmt"
  ]
}
{
  "Dir": "/working/.tinygo-root/src/fmt",
  "ImportPath": "fmt",
  "Name": "fmt",
  "GoFiles": [
    "print.go"
  ],
  "Imports": [
    "errors"
  ],
  "DepOnly": true,
  "Standard": true
}
EOF
  exit 0
fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
mkdir -p "$(dirname "$out")"
printf '\\000asm\\001\\000\\000\\000' > "$out"
`)
  await chmod(fakeTinyGoPath, 0o755)

  const fakeTinyGoRoot = path.join(tempDir, 'tinygo-root')
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys'), { recursive: true })
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'device', 'arm'), { recursive: true })
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys', 'zversion.go'), 'package sys\n')
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'device', 'arm', 'arm.go'), 'package arm\n')

  const workspaceDir = path.join(tempDir, 'workspace')
  await mkdir(workspaceDir, { recursive: true })
  const entryPath = path.join(workspaceDir, 'main.go')
  const outputPath = path.join(workspaceDir, 'out.wasm')
  const requestPath = path.join(workspaceDir, 'tinygo-request.json')

  await writeFile(entryPath, 'package main\n\nfunc main() {}\n')
  await writeFile(requestPath, JSON.stringify({
    command: 'build',
    planner: 'tinygo',
    entry: entryPath,
    optimize: 'z',
    output: outputPath,
    panic: 'trap',
    scheduler: 'asyncify',
    target: 'wasip1',
  }))

  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/probe-tinygo-driver-bridge.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_DRIVER_BRIDGE_INCLUDE_FRONTEND_ANALYSIS: '1',
      WASM_TINYGO_GO_BIN: fakeGoPath,
      WASM_TINYGO_HOST_PROBE_REQUEST_PATH: requestPath,
      WASM_TINYGO_HOST_PROBE_SKIP_RUNTIME: '1',
      WASM_TINYGO_TINYGOROOT: fakeTinyGoRoot,
      WASM_TINYGO_TINYGO_BIN: fakeTinyGoPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })

  assert.equal(exitCode, 1, output)
  assert.match(output, /frontend analysis compileUnits did not match real TinyGo driver bridge/)
})

test('probe-tinygo-driver-bridge rejects mismatched frontend-real-adapter buildContext instead of accepting it', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-driver-bridge-script-real-adapter-mismatch-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeBinDir = path.join(tempDir, 'bin')
  await mkdir(fakeBinDir, { recursive: true })

  const fakeGoPath = path.join(fakeBinDir, 'go')
  await writeFile(fakeGoPath, `#!/bin/sh
set -eu
node - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
if (process.env.WASM_TINYGO_MODE === 'frontend' || process.env.WASM_TINYGO_MODE === 'frontend-analysis-build') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_RESULT_PATH, JSON.stringify({
    ok: true,
    generatedFiles: [
      {
        path: '/working/tinygo-compile-unit.json',
        contents: JSON.stringify({
          entryFile: input.entryFile,
          toolchain: input.toolchain,
          sourceSelection: input.sourceSelection,
          compileUnits: input.compileUnits,
        }),
      },
    ],
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-analysis') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  if (Array.isArray(input.compileUnits)) {
    throw new Error('frontend-analysis expected packageGraph-only input')
  }
  const compileUnits = (input.packageGraph ?? []).map((packageInfo) => ({
    depOnly: packageInfo.depOnly ?? false,
    files: (packageInfo.files?.goFiles ?? []).map((goFile) => path.join(packageInfo.dir, goFile)),
    importPath: packageInfo.importPath,
    imports: packageInfo.imports ?? [],
    kind: packageInfo.depOnly ? (packageInfo.standard ? 'stdlib' : 'imported') : 'program',
    packageDir: packageInfo.dir,
    packageName: packageInfo.name,
    standard: packageInfo.standard ?? false,
  }))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, JSON.stringify({
    ok: true,
    analysis: {
      buildContext: input.buildContext,
      entryFile: input.entryFile,
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: input.sourceSelection?.allCompile ?? [],
      compileGroups: [
        { name: 'program', files: compileUnits.filter((compileUnit) => compileUnit.kind === 'program').flatMap((compileUnit) => compileUnit.files ?? []) },
      ],
      compileUnits,
      packageGraph: input.packageGraph,
      toolchain: {
        target: input.toolchain?.target,
        llvmTarget: input.buildContext?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-real-adapter') {
  const analysisResult = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, 'utf8'))
  const analysis = analysisResult.analysis ?? {}
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH, JSON.stringify({
    ok: true,
    adapter: {
      buildContext: {
        ...analysis.buildContext,
        target: 'mismatch-target',
      },
      entryFile: analysis.entryFile,
      compileUnitManifestPath: analysis.compileUnitManifestPath ?? '/working/tinygo-compile-unit.json',
      allCompileFiles: analysis.allCompileFiles ?? [],
      compileGroups: [
        { name: 'program', files: analysis.allCompileFiles ?? [] },
      ],
      compileUnits: analysis.compileUnits ?? [],
      packageGraph: analysis.packageGraph ?? [],
      toolchain: {
        target: analysis.toolchain?.target,
        llvmTarget: analysis.toolchain?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
const request = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_REQUEST_PATH, 'utf8'))
fs.writeFileSync(process.env.WASM_TINYGO_RESULT_PATH, JSON.stringify({
  ok: true,
  files: [
    {
      path: '/working/tinygo-frontend-input.json',
      contents: JSON.stringify({
        buildContext: {
          target: request.target,
          llvmTarget: 'wasm32-unknown-wasi',
          goos: 'wasip1',
          goarch: 'wasm',
          gc: 'precise',
          scheduler: request.scheduler ?? 'asyncify',
          buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
          modulePath: 'example.com/real-adapter-mismatch',
        },
        entryFile: request.entry,
        modulePath: 'example.com/real-adapter-mismatch',
        toolchain: {
          target: request.target,
          artifactOutputPath: request.output,
        },
        sourceSelection: {
          program: [request.entry],
          allCompile: [request.entry],
        },
        compileUnits: [
          {
            kind: 'program',
            importPath: 'command-line-arguments',
            imports: [],
            packageName: 'main',
            packageDir: path.dirname(request.entry),
            files: [request.entry],
          },
        ],
        packageGraph: [
          {
            depOnly: false,
            dir: path.dirname(request.entry),
            files: { goFiles: [path.basename(request.entry)] },
            importPath: 'example.com/real-adapter-mismatch',
            imports: [],
            modulePath: 'example.com/real-adapter-mismatch',
            name: 'main',
            standard: false,
          },
        ],
      }),
    },
  ],
  metadata: {
    buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
    gc: 'precise',
    goarch: 'wasm',
    goos: 'wasip1',
    llvmTarget: 'wasm32-unknown-wasi',
    optimize: '-Oz',
    panicStrategy: request.panic ?? 'trap',
    scheduler: request.scheduler ?? 'asyncify',
  },
}, null, 2))
NODE
`)
  await chmod(fakeGoPath, 0o755)

  const fakeTinyGoPath = path.join(fakeBinDir, 'tinygo')
  await writeFile(fakeTinyGoPath, `#!/bin/sh
set -eu
if [ "$1" = "info" ]; then
  cat <<'EOF'
LLVM triple:       wasm32-unknown-wasi
GOOS:              wasip1
GOARCH:            wasm
build tags:        gc.precise scheduler.asyncify tinygo purego tinygo.unicore tinygo.wasm
garbage collector: precise
scheduler:         asyncify
EOF
  exit 0
fi
if [ "$1" = "list" ]; then
  cat <<EOF
{"ImportPath":"example.com/real-adapter-mismatch","Name":"main","Dir":"$PWD","GoFiles":["main.go"],"Imports":[]}
EOF
  exit 0
fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
mkdir -p "$(dirname "$out")"
printf '\\000asm\\001\\000\\000\\000' > "$out"
`)
  await chmod(fakeTinyGoPath, 0o755)

  const fakeTinyGoRoot = path.join(tempDir, 'tinygo-root')
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys'), { recursive: true })
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'device', 'arm'), { recursive: true })
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys', 'zversion.go'), 'package sys\n')
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'device', 'arm', 'arm.go'), 'package arm\n')

  const workspaceDir = path.join(tempDir, 'workspace')
  await mkdir(workspaceDir, { recursive: true })
  const entryPath = path.join(workspaceDir, 'main.go')
  const outputPath = path.join(workspaceDir, 'out.wasm')
  const requestPath = path.join(workspaceDir, 'tinygo-request.json')
  const bridgeManifestPath = path.join(workspaceDir, 'tinygo-driver-bridge.json')

  await writeFile(path.join(workspaceDir, 'go.mod'), 'module example.com/real-adapter-mismatch\n\ngo 1.22\n')
  await writeFile(entryPath, 'package main\n\nfunc main() {}\n')
  await writeFile(requestPath, JSON.stringify({
    command: 'build',
    planner: 'tinygo',
    entry: entryPath,
    optimize: 'z',
    output: outputPath,
    panic: 'trap',
    target: 'wasm',
  }))

  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/probe-tinygo-driver-bridge.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_DRIVER_BRIDGE_MANIFEST_PATH: bridgeManifestPath,
      WASM_TINYGO_DRIVER_BRIDGE_INCLUDE_FRONTEND_ANALYSIS: '1',
      WASM_TINYGO_GO_BIN: fakeGoPath,
      WASM_TINYGO_HOST_PROBE_REQUEST_PATH: requestPath,
      WASM_TINYGO_HOST_PROBE_SKIP_RUNTIME: '1',
      WASM_TINYGO_TINYGOROOT: fakeTinyGoRoot,
      WASM_TINYGO_TINYGO_BIN: fakeTinyGoPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })

  assert.equal(exitCode, 1, output)
  assert.match(output, /frontend analysis buildContext did not match real TinyGo analysis adapter/)
})

test('probe-tinygo-driver-bridge rejects frontend-real-adapter package drift against frontend-analysis', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-driver-bridge-script-real-adapter-seam-mismatch-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeBinDir = path.join(tempDir, 'bin')
  await mkdir(fakeBinDir, { recursive: true })

  const fakeGoPath = path.join(fakeBinDir, 'go')
  await writeFile(fakeGoPath, `#!/bin/sh
set -eu
node - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
if (process.env.WASM_TINYGO_MODE === 'frontend') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_RESULT_PATH, JSON.stringify({
    ok: true,
    generatedFiles: [
      {
        path: '/working/tinygo-compile-unit.json',
        contents: JSON.stringify({
          entryFile: input.entryFile,
          toolchain: input.toolchain,
          sourceSelection: input.sourceSelection,
          compileUnits: input.compileUnits,
        }),
      },
    ],
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-analysis') {
  const input = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_INPUT_PATH, 'utf8'))
  if (Array.isArray(input.compileUnits)) {
    throw new Error('frontend-analysis expected packageGraph-only input')
  }
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, JSON.stringify({
    ok: true,
    analysis: {
      buildContext: input.buildContext,
      entryFile: input.entryFile,
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: input.sourceSelection?.allCompile ?? [],
      compileGroups: [
        { name: 'program', files: [input.entryFile] },
        { name: 'imported', files: ['/working/.tinygo-root/src/fmt/print.go'] },
        { name: 'stdlib', files: [] },
        { name: 'all-compile', files: input.sourceSelection?.allCompile ?? [] },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'command-line-arguments',
          imports: ['fmt'],
          packageName: 'main',
          packageDir: path.dirname(input.entryFile),
          files: [input.entryFile],
        },
        {
          kind: 'imported',
          importPath: 'fmt',
          imports: ['errors'],
          depOnly: true,
          packageName: 'fmt',
          packageDir: '/working/.tinygo-root/src/fmt',
          files: ['/working/.tinygo-root/src/fmt/print.go'],
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: path.dirname(input.entryFile),
          files: { goFiles: ['main.go'] },
          importPath: 'command-line-arguments',
          imports: ['fmt'],
          modulePath: 'example.com/seamdrift',
          name: 'main',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/working/.tinygo-root/src/fmt',
          files: { goFiles: ['print.go'] },
          importPath: 'fmt',
          imports: ['errors'],
          modulePath: '',
          name: 'fmt',
          standard: true,
        },
      ],
      toolchain: {
        target: input.toolchain?.target,
        llvmTarget: input.buildContext?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
if (process.env.WASM_TINYGO_MODE === 'frontend-real-adapter') {
  const analysisResult = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_FRONTEND_ANALYSIS_PATH, 'utf8'))
  const analysis = analysisResult.analysis ?? {}
  fs.writeFileSync(process.env.WASM_TINYGO_FRONTEND_REAL_ADAPTER_PATH, JSON.stringify({
    ok: true,
    adapter: {
      buildContext: analysis.buildContext,
      entryFile: analysis.entryFile,
      compileUnitManifestPath: analysis.compileUnitManifestPath ?? '/working/tinygo-compile-unit.json',
      allCompileFiles: analysis.allCompileFiles ?? [],
      compileGroups: [
        { name: 'program', files: [analysis.entryFile] },
        { name: 'imported', files: ['/working/.tinygo-root/src/fmt/print.go'] },
        { name: 'stdlib', files: [] },
        { name: 'all-compile', files: analysis.allCompileFiles ?? [] },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/seamdrift',
          imports: [],
          depOnly: false,
          packageName: 'main',
          packageDir: path.dirname(analysis.entryFile),
          files: [analysis.entryFile],
          standard: false,
        },
        {
          kind: 'imported',
          importPath: 'fmt',
          imports: ['errors'],
          depOnly: true,
          packageName: 'fmt',
          packageDir: '/working/.tinygo-root/src/fmt',
          files: ['/working/.tinygo-root/src/fmt/print.go'],
          standard: true,
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: path.dirname(analysis.entryFile),
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/seamdrift',
          imports: [],
          modulePath: 'example.com/seamdrift',
          name: 'main',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/working/.tinygo-root/src/fmt',
          files: { goFiles: ['print.go'] },
          importPath: 'fmt',
          imports: ['errors'],
          modulePath: '',
          name: 'fmt',
          standard: true,
        },
      ],
      toolchain: {
        target: analysis.toolchain?.target,
        llvmTarget: analysis.toolchain?.llvmTarget ?? 'wasm32-unknown-wasi',
      },
    },
  }, null, 2))
  process.exit(0)
}
const request = JSON.parse(fs.readFileSync(process.env.WASM_TINYGO_REQUEST_PATH, 'utf8'))
fs.writeFileSync(process.env.WASM_TINYGO_RESULT_PATH, JSON.stringify({
  ok: true,
  files: [
    {
      path: '/working/tinygo-frontend-input.json',
      contents: JSON.stringify({
        buildContext: {
          target: request.target,
          llvmTarget: 'wasm32-unknown-wasi',
          goos: 'wasip1',
          goarch: 'wasm',
          gc: 'precise',
          scheduler: request.scheduler ?? 'tasks',
          buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
          modulePath: 'example.com/seamdrift',
        },
        entryFile: request.entry,
        modulePath: 'example.com/seamdrift',
        toolchain: {
          target: request.target,
          artifactOutputPath: request.output,
        },
        sourceSelection: {
          program: [request.entry],
          allCompile: [request.entry, '/working/.tinygo-root/src/fmt/print.go'],
        },
        compileUnits: [
          {
            kind: 'program',
            importPath: 'command-line-arguments',
            imports: ['fmt'],
            packageName: 'main',
            packageDir: path.dirname(request.entry),
            files: [request.entry],
          },
          {
            kind: 'stdlib',
            importPath: 'fmt',
            imports: ['errors'],
            packageName: 'fmt',
            packageDir: '/working/.tinygo-root/src/fmt',
            files: ['/working/.tinygo-root/src/fmt/print.go'],
          },
        ],
        packageGraph: [
          {
            depOnly: false,
            dir: path.dirname(request.entry),
            files: { goFiles: [path.basename(request.entry)] },
            importPath: 'example.com/seamdrift',
            imports: ['fmt'],
            modulePath: 'example.com/seamdrift',
            name: 'main',
            standard: false,
          },
          {
            depOnly: true,
            dir: '/working/.tinygo-root/src/fmt',
            files: { goFiles: ['print.go'] },
            importPath: 'fmt',
            imports: ['errors'],
            modulePath: '',
            name: 'fmt',
            standard: true,
          },
        ],
      }),
    },
  ],
  metadata: {
    buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
    gc: 'precise',
    goarch: 'wasm',
    goos: 'wasip1',
    llvmTarget: 'wasm32-unknown-wasi',
    modulePath: 'example.com/seamdrift',
    optimize: '-Oz',
    panicStrategy: request.panic ?? 'trap',
    scheduler: request.scheduler ?? 'tasks',
  },
}, null, 2))
NODE
`)
  await chmod(fakeGoPath, 0o755)

  const fakeTinyGoPath = path.join(fakeBinDir, 'tinygo')
  await writeFile(fakeTinyGoPath, `#!/bin/sh
set -eu
if [ "$1" = "info" ]; then
  cat <<'EOF'
LLVM triple:       wasm32-unknown-wasi
GOOS:              wasip1
GOARCH:            wasm
build tags:        gc.precise scheduler.tasks tinygo purego tinygo.unicore tinygo.wasm
garbage collector: precise
scheduler:         tasks
EOF
  exit 0
fi
if [ "$1" = "list" ]; then
  cat <<EOF
{"Dir":"$PWD","ImportPath":"example.com/seamdrift","Module":{"Path":"example.com/seamdrift"},"Name":"main","GoFiles":["main.go"],"Imports":["fmt"]}
{"Dir":"/working/.tinygo-root/src/fmt","ImportPath":"fmt","Name":"fmt","GoFiles":["print.go"],"Imports":["errors"],"DepOnly":true,"Standard":true}
EOF
  exit 0
fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
mkdir -p "$(dirname "$out")"
printf '\\000asm\\001\\000\\000\\000' > "$out"
`)
  await chmod(fakeTinyGoPath, 0o755)

  const fakeTinyGoRoot = path.join(tempDir, 'tinygo-root')
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys'), { recursive: true })
  await mkdir(path.join(fakeTinyGoRoot, 'src', 'device', 'arm'), { recursive: true })
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'runtime', 'internal', 'sys', 'zversion.go'), 'package sys\n')
  await writeFile(path.join(fakeTinyGoRoot, 'src', 'device', 'arm', 'arm.go'), 'package arm\n')

  const workspaceDir = path.join(tempDir, 'workspace')
  await mkdir(workspaceDir, { recursive: true })
  const entryPath = path.join(workspaceDir, 'main.go')
  const outputPath = path.join(workspaceDir, 'out.wasm')
  const requestPath = path.join(workspaceDir, 'tinygo-request.json')
  const bridgeManifestPath = path.join(workspaceDir, 'tinygo-driver-bridge.json')

  await writeFile(path.join(workspaceDir, 'go.mod'), 'module example.com/seamdrift\n\ngo 1.22\n')
  await writeFile(entryPath, 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("ok") }\n')
  await writeFile(requestPath, JSON.stringify({
    command: 'build',
    planner: 'tinygo',
    entry: entryPath,
    optimize: 'z',
    output: outputPath,
    panic: 'trap',
    target: 'wasm',
  }))

  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/probe-tinygo-driver-bridge.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_DRIVER_BRIDGE_MANIFEST_PATH: bridgeManifestPath,
      WASM_TINYGO_DRIVER_BRIDGE_INCLUDE_FRONTEND_ANALYSIS: '1',
      WASM_TINYGO_GO_BIN: fakeGoPath,
      WASM_TINYGO_HOST_PROBE_REQUEST_PATH: requestPath,
      WASM_TINYGO_HOST_PROBE_SKIP_RUNTIME: '1',
      WASM_TINYGO_TINYGOROOT: fakeTinyGoRoot,
      WASM_TINYGO_TINYGO_BIN: fakeTinyGoPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })

  assert.equal(exitCode, 1, output)
  assert.match(output, /frontend analysis program package did not match real TinyGo analysis adapter/)
})
