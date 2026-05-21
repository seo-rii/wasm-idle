import test from 'node:test'
import assert from 'node:assert/strict'

import {
  verifyBackendResultManifestAgainstBackendInputAndLoweredBitcodeManifest,
  verifyBackendInputManifestAgainstLoweringPlanAndLoweredSourcesManifest,
  buildLoweredBitcodeCompileCommandsFromLoweringPlanAndLoweredSourcesManifest,
  buildToolPlanFromCompileUnitManifest,
  normalizeTinyGoDriverBridgeManifestForBrowser,
  verifyCompileUnitManifestAgainstDriverBridgeManifest,
  verifyFrontendAnalysisAgainstDriverBridgeManifest,
  verifyFrontendAnalysisInputManifestAgainstDriverBridgeManifest,
  verifyFrontendRealAdapterAgainstFrontendAnalysis,
  verifyFrontendAnalysisAgainstRealDriverBridgeManifest,
  verifyFrontendInputManifestAgainstDriverBridgeManifest,
  verifyCommandBatchAgainstBackendInputManifest,
  verifyCommandArtifactManifestAgainstBackendInputAndLoweredBitcodeManifest,
  verifyCommandArtifactManifestAgainstCommandBatchAndLoweredBitcodeManifest,
  verifyLoweredArtifactManifestAgainstLoweredCommandBatchManifest,
  verifyLoweredBitcodeManifestAgainstLoweringPlanAndLoweredSourcesManifest,
  verifyLoweredCommandBatchAgainstCompileUnitAndLoweredSourcesManifest,
  verifyLoweredSourcesManifestAgainstWorkItemsManifest,
  verifyCommandBatchAgainstLoweringPlanAndLoweredSourcesManifest,
  verifyLoweringManifestAgainstIntermediateManifest,
  verifyIntermediateManifestAgainstCompileUnitManifest,
  verifyCompileUnitManifestAgainstCompileRequest,
  verifyLoweringPlanAgainstWorkItemsManifest,
  verifyTinyGoHostProbeManifestAgainstDriverMetadata,
  verifyWorkItemsManifestAgainstLoweringManifest,
} from '../src/compile-unit.ts'

test('buildToolPlanFromCompileUnitManifest derives a 2-step clang/wasm-ld plan', () => {
  const toolPlan = buildToolPlanFromCompileUnitManifest({
    optimizeFlag: '-Oz',
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
  })

  assert.deepEqual(toolPlan, [
    {
      argv: [
        '/usr/bin/clang',
        '--target=wasm32-unknown-wasi',
        '-Oz',
        '-mbulk-memory',
        '-mnontrapping-fptoint',
        '-mno-multivalue',
        '-mno-reference-types',
        '-msign-ext',
        '-c',
        'tinygo-bootstrap.c',
        '-o',
        'tinygo-bootstrap.o',
      ],
      cwd: '/working',
    },
    {
      argv: [
        '/usr/bin/wasm-ld',
        '--stack-first',
        '--no-demangle',
        '--no-entry',
        '--export-all',
        'tinygo-bootstrap.o',
        '-o',
        '/working/out.wasm',
      ],
      cwd: '/working',
    },
  ])
})

test('verifyCompileUnitManifestAgainstCompileRequest accepts compile requests that omit duplicated manifest metadata and returns the manifest-derived plan', () => {
  const verification = verifyCompileUnitManifestAgainstCompileRequest({
    optimizeFlag: '-Oz',
    materializedFiles: [
      '/working/.tinygo-root/src/device/arm/arm.go',
      '/working/.tinygo-root/src/fmt/print.go',
      '/working/.tinygo-root/src/runtime/runtime.go',
      '/working/.tinygo-root/targets/wasm.json',
      '/working/tinygo-bootstrap.c',
      '/working/tinygo-compile-unit.json',
    ],
    entryFile: '/workspace/main.go',
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
    compileUnits: [
      { kind: 'program', importPath: 'command-line-arguments', modulePath: '', packageName: 'main', packageDir: '/workspace', files: ['/workspace/main.go'] },
      { kind: 'imported', importPath: 'example.com/app/lib', modulePath: '', packageName: 'helper', packageDir: '/workspace/lib', files: ['/workspace/lib/helper.go'] },
      { kind: 'stdlib', importPath: 'fmt', modulePath: '', packageName: 'fmt', packageDir: '/working/.tinygo-root/src/fmt', files: ['/working/.tinygo-root/src/fmt/print.go'] },
    ],
    sourceSelection: {
      allCompile: [
        '/working/.tinygo-root/src/fmt/print.go',
        '/workspace/lib/helper.go',
        '/workspace/main.go',
      ],
    },
  }, {
    targetAssetFiles: ['/working/.tinygo-root/targets/wasm.json'],
    runtimeSupportFiles: ['/working/.tinygo-root/src/device/arm/arm.go', '/working/.tinygo-root/src/runtime/runtime.go'],
  })

  assert.equal(verification.summary.programCount, 1)
  assert.equal(verification.summary.importedCount, 1)
  assert.equal(verification.summary.stdlibCount, 1)
  assert.equal(verification.summary.allCompileCount, 3)
  assert.deepEqual(verification.toolchain.ldflags, [
    '--stack-first',
    '--no-demangle',
  ])
  assert.deepEqual(verification.compileUnits, [
    { kind: 'program', importPath: 'command-line-arguments', modulePath: '', packageName: 'main', packageDir: '/workspace', files: ['/workspace/main.go'] },
    { kind: 'imported', importPath: 'example.com/app/lib', modulePath: '', packageName: 'helper', packageDir: '/workspace/lib', files: ['/workspace/lib/helper.go'] },
    { kind: 'stdlib', importPath: 'fmt', modulePath: '', packageName: 'fmt', packageDir: '/working/.tinygo-root/src/fmt', files: ['/working/.tinygo-root/src/fmt/print.go'] },
  ])
  assert.deepEqual(verification.toolPlan, [
    {
      argv: [
        '/usr/bin/clang',
        '--target=wasm32-unknown-wasi',
        '-Oz',
        '-mbulk-memory',
        '-mnontrapping-fptoint',
        '-mno-multivalue',
        '-mno-reference-types',
        '-msign-ext',
        '-c',
        'tinygo-bootstrap.c',
        '-o',
        'tinygo-bootstrap.o',
      ],
      cwd: '/working',
    },
    {
      argv: [
        '/usr/bin/wasm-ld',
        '--stack-first',
        '--no-demangle',
        '--no-entry',
        '--export-all',
        'tinygo-bootstrap.o',
        '-o',
        '/working/out.wasm',
      ],
      cwd: '/working',
    },
  ])
})

test('verifyCompileUnitManifestAgainstCompileRequest preserves explicit execution ldflags while toolPlan appends probe-only flags', () => {
  const verification = verifyCompileUnitManifestAgainstCompileRequest({
    optimizeFlag: '-Oz',
    materializedFiles: [
      '/working/.tinygo-root/targets/wasm.json',
      '/working/tinygo-bootstrap.c',
      '/working/tinygo-compile-unit.json',
    ],
    entryFile: '/workspace/main.go',
    toolchain: {
      target: 'wasm',
      ldflags: ['--stack-first', '--import-memory'],
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      allCompile: ['/workspace/main.go'],
    },
  }, {})

  assert.deepEqual(verification.toolchain.ldflags, [
    '--stack-first',
    '--import-memory',
  ])
  assert.deepEqual(verification.toolPlan[1], {
    argv: [
      '/usr/bin/wasm-ld',
      '--stack-first',
      '--import-memory',
      '--no-entry',
      '--export-all',
      'tinygo-bootstrap.o',
      '-o',
      '/working/out.wasm',
    ],
    cwd: '/working',
  })
})

test('verifyCompileUnitManifestAgainstCompileRequest rejects mismatched tool plans', () => {
  assert.throws(() => verifyCompileUnitManifestAgainstCompileRequest({
    optimizeFlag: '-Oz',
    entryFile: '/workspace/main.go',
    materializedFiles: [
      '/working/.tinygo-root/targets/wasm.json',
      '/working/tinygo-bootstrap.c',
      '/working/tinygo-compile-unit.json',
    ],
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      allCompile: ['/workspace/main.go'],
    },
  }, {
    toolPlan: [
      {
        argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi'],
        cwd: '/working',
      },
    ],
  }), /frontend compile unit tool plan did not match compile request/)
})

test('verifyCompileUnitManifestAgainstCompileRequest rejects legacy top-level toolchain fields even when nested toolchain exists', () => {
  assert.throws(() => verifyCompileUnitManifestAgainstCompileRequest({
    optimizeFlag: '-Oz',
    entryFile: '/workspace/main.go',
    target: 'wasm',
    materializedFiles: [
      '/working/.tinygo-root/targets/wasm.json',
      '/working/tinygo-bootstrap.c',
      '/working/tinygo-compile-unit.json',
    ],
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      allCompile: ['/workspace/main.go'],
    },
  }, {}), /frontend compile unit legacy top-level toolchain fields are not supported/)
})

test('verifyCompileUnitManifestAgainstCompileRequest rejects legacy top-level source-file groups without nested sourceSelection', () => {
  assert.throws(() => verifyCompileUnitManifestAgainstCompileRequest({
    optimizeFlag: '-Oz',
    entryFile: '/workspace/main.go',
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
    programFiles: ['/workspace/main.go'],
    importedPackageFiles: ['/workspace/lib/helper.go'],
    stdlibPackageFiles: ['/working/.tinygo-root/src/fmt/print.go'],
    allCompileFiles: [
      '/working/.tinygo-root/src/fmt/print.go',
      '/workspace/lib/helper.go',
      '/workspace/main.go',
    ],
  }, {}), /frontend compile unit legacy top-level source-file groups are not supported/)
})

test('verifyCompileUnitManifestAgainstCompileRequest rejects legacy top-level source-file groups even when normalized sourceSelection exists', () => {
  assert.throws(() => verifyCompileUnitManifestAgainstCompileRequest({
    optimizeFlag: '-Oz',
    entryFile: '/workspace/main.go',
    materializedFiles: [
      '/working/.tinygo-root/targets/wasm.json',
      '/working/tinygo-bootstrap.c',
      '/working/tinygo-compile-unit.json',
    ],
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      allCompile: ['/workspace/main.go'],
    },
    programFiles: ['/workspace/main.go'],
  }, {}), /frontend compile unit legacy top-level source-file groups are not supported/)
})

test('verifyTinyGoHostProbeManifestAgainstDriverMetadata accepts matching real TinyGo target facts', () => {
  const verification = verifyTinyGoHostProbeManifestAgainstDriverMetadata({
    artifact: {
      path: '/working/out.wasm',
    },
    command: [
      '/cache/tinygo/bin/tinygo',
      'build',
      '-target',
      'wasip1',
      '-opt',
      'z',
      '-scheduler',
      'tasks',
      '-panic',
      'trap',
      '-o',
      '/working/out.wasm',
      '/workspace/main.go',
    ],
    target: 'wasip1',
    targetInfo: {
      buildTags: ['tinygo.wasm', 'tinygo', 'purego', 'gc.precise', 'scheduler.tasks', 'serial.none', 'tinygo.unicore'],
      gc: 'precise',
      goarch: 'wasm',
      goos: 'wasip1',
      llvmTriple: 'wasm32-unknown-wasi',
      scheduler: 'tasks',
    },
  }, {
    buildTags: ['tinygo.wasm', 'scheduler.tasks', 'gc.precise', 'serial.none', 'tinygo.unicore'],
    entry: '/workspace/main.go',
    gc: 'precise',
    goarch: 'wasm',
    goos: 'wasip1',
    llvmTarget: 'wasm32-unknown-wasi',
    optimize: 'z',
    output: '/working/out.wasm',
    panicStrategy: 'trap',
    scheduler: 'tasks',
    target: 'wasip1',
  })

  assert.equal(verification.target, 'wasip1')
  assert.equal(verification.llvmTriple, 'wasm32-unknown-wasi')
  assert.equal(verification.goos, 'wasip1')
  assert.equal(verification.goarch, 'wasm')
  assert.equal(verification.gc, 'precise')
  assert.equal(verification.scheduler, 'tasks')
  assert.equal(verification.entryFile, '/workspace/main.go')
  assert.equal(verification.artifactOutputPath, '/working/out.wasm')
  assert.equal(verification.commandArgv.length, 13)
  assert.deepEqual(verification.driverBuildTags, ['gc.precise', 'scheduler.tasks', 'serial.none', 'tinygo.unicore', 'tinygo.wasm'])
  assert.deepEqual(verification.hostBuildTags, ['gc.precise', 'purego', 'scheduler.tasks', 'serial.none', 'tinygo', 'tinygo.unicore', 'tinygo.wasm'])
})

test('verifyTinyGoHostProbeManifestAgainstDriverMetadata rejects missing driver build tags', () => {
  assert.throws(() => verifyTinyGoHostProbeManifestAgainstDriverMetadata({
    artifact: {
      path: '/working/out.wasm',
    },
    command: [
      '/cache/tinygo/bin/tinygo',
      'build',
      '-target',
      'wasip1',
      '-scheduler',
      'asyncify',
      '-o',
      '/working/out.wasm',
      '/workspace/main.go',
    ],
    target: 'wasip1',
    targetInfo: {
      buildTags: ['tinygo.wasm', 'tinygo', 'purego'],
      gc: 'precise',
      goarch: 'wasm',
      goos: 'wasip1',
      llvmTriple: 'wasm32-unknown-wasi',
      scheduler: 'asyncify',
    },
  }, {
    buildTags: ['tinygo.wasm', 'scheduler.asyncify', 'gc.precise'],
    entry: '/workspace/main.go',
    gc: 'precise',
    goarch: 'wasm',
    goos: 'wasip1',
    llvmTarget: 'wasm32-unknown-wasi',
    output: '/working/out.wasm',
    scheduler: 'asyncify',
    target: 'wasip1',
  }), /real TinyGo host probe build tags did not cover driver metadata/)
})

test('verifyFrontendInputManifestAgainstDriverBridgeManifest accepts matching buildContext and packageGraph facts', () => {
  const verification = verifyFrontendInputManifestAgainstDriverBridgeManifest({
    buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    modulePath: 'example.com/app',
    entryFile: '/workspace/main.go',
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      allCompile: [
        '/workspace/helper/helper.go',
        '/workspace/main.go',
        '/working/.tinygo-root/src/fmt/print.go',
      ],
    },
    compileUnits: [
      { kind: 'program', importPath: 'example.com/app', imports: ['example.com/app/helper'], packageName: 'main', packageDir: '/workspace', files: ['/workspace/main.go'], depOnly: false, standard: false },
      { kind: 'imported', importPath: 'example.com/app/helper', imports: ['fmt'], packageName: 'helper', packageDir: '/workspace/helper', files: ['/workspace/helper/helper.go'], depOnly: true, standard: false },
      { kind: 'stdlib', importPath: 'fmt', imports: ['errors'], packageName: 'fmt', packageDir: '/working/.tinygo-root/src/fmt', files: ['/working/.tinygo-root/src/fmt/print.go'], depOnly: true, standard: true },
    ],
    packageGraph: [
      { depOnly: false, dir: '/workspace', files: { goFiles: ['main.go'] }, importPath: 'example.com/app', imports: ['example.com/app/helper'], name: 'main', standard: false },
      { depOnly: true, dir: '/workspace/helper', files: { goFiles: ['helper.go'] }, importPath: 'example.com/app/helper', imports: ['fmt'], name: 'helper', standard: false },
      { depOnly: true, dir: '/working/.tinygo-root/src/fmt', files: { goFiles: ['print.go'] }, importPath: 'fmt', imports: ['errors'], name: 'fmt', standard: true },
    ],
  }, {
    artifactOutputPath: '/working/out.wasm',
    driverBuildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
    entryFile: '/workspace/main.go',
    entryPackage: {
      dir: '/workspace',
      goFiles: ['main.go'],
      importPath: 'example.com/app',
      imports: ['example.com/app/helper'],
      name: 'main',
    },
    gc: 'precise',
    goarch: 'wasm',
    goos: 'js',
    llvmTriple: 'wasm32-unknown-wasi',
    packageGraph: [
      { depOnly: false, dir: '/workspace', goFiles: ['main.go'], importPath: 'example.com/app', imports: ['example.com/app/helper'], name: 'main', standard: false },
      { depOnly: true, dir: '/workspace/helper', goFiles: ['helper.go'], importPath: 'example.com/app/helper', imports: ['fmt'], name: 'helper', standard: false },
      { depOnly: true, dir: '/working/.tinygo-root/src/fmt', goFiles: ['print.go'], importPath: 'fmt', imports: ['errors'], name: 'fmt', standard: true },
    ],
    scheduler: 'asyncify',
    target: 'wasm',
  })

  assert.equal(verification.target, 'wasm')
  assert.equal(verification.llvmTarget, 'wasm32-unknown-wasi')
  assert.equal(verification.scheduler, 'asyncify')
  assert.equal(verification.modulePath, 'example.com/app')
  assert.equal(verification.compileUnitCount, 3)
  assert.equal(verification.graphPackageCount, 3)
  assert.equal(verification.programImportAlias, 'direct')
})

test('verifyFrontendInputManifestAgainstDriverBridgeManifest rejects mismatched buildContext facts', () => {
  assert.throws(() => verifyFrontendInputManifestAgainstDriverBridgeManifest({
    buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'tasks',
      buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
      modulePath: '',
    },
    modulePath: '',
    entryFile: '/workspace/main.go',
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      allCompile: ['/workspace/main.go'],
    },
    compileUnits: [
      { kind: 'program', importPath: 'command-line-arguments', packageName: 'main', packageDir: '/workspace', files: ['/workspace/main.go'], depOnly: false, standard: false },
    ],
    packageGraph: [
      { depOnly: false, dir: '/workspace', files: { goFiles: ['main.go'] }, importPath: 'command-line-arguments', imports: [], name: 'main', standard: false },
    ],
  }, {
    artifactOutputPath: '/working/out.wasm',
    driverBuildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
    entryFile: '/workspace/main.go',
    entryPackage: {
      dir: '/workspace',
      goFiles: ['main.go'],
      importPath: 'command-line-arguments',
      imports: [],
      name: 'main',
    },
    gc: 'precise',
    goarch: 'wasm',
    goos: 'js',
    llvmTriple: 'wasm32-unknown-wasi',
    packageGraph: [
      { depOnly: false, dir: '/workspace', goFiles: ['main.go'], importPath: 'command-line-arguments', imports: [], name: 'main', standard: false },
    ],
    scheduler: 'asyncify',
    target: 'wasm',
  }), /build context/)
})

test('verifyFrontendAnalysisInputManifestAgainstDriverBridgeManifest accepts semantic bridge matches', () => {
  const verification = verifyFrontendAnalysisInputManifestAgainstDriverBridgeManifest({
    buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    modulePath: 'example.com/app',
    optimizeFlag: '-Oz',
    entryFile: '/workspace/main.go',
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      allCompile: [
        '/working/.tinygo-root/src/fmt/print.go',
        '/workspace/helper/helper.go',
        '/workspace/main.go',
      ],
    },
    packageGraph: [
      { depOnly: false, dir: '/workspace', files: { goFiles: ['main.go'] }, importPath: 'command-line-arguments', imports: ['example.com/app/helper'], modulePath: 'example.com/app', name: 'main', standard: false },
      { depOnly: true, dir: '/workspace/helper', files: { goFiles: ['helper.go'] }, importPath: 'example.com/app/helper', imports: ['fmt'], modulePath: 'example.com/app', name: 'helper', standard: false },
      { depOnly: true, dir: '/working/.tinygo-root/src/fmt', files: { goFiles: ['print.go'] }, importPath: 'fmt', imports: ['errors'], modulePath: '', name: 'fmt', standard: true },
    ],
  }, {
    artifactOutputPath: '/working/out.wasm',
    driverBuildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
    entryFile: '/workspace/main.go',
    entryPackage: {
      depOnly: false,
      dir: '/workspace',
      goFiles: ['main.go'],
      importPath: 'example.com/app',
      imports: ['example.com/app/helper'],
      modulePath: 'example.com/app',
      name: 'main',
      standard: false,
    },
    frontendAnalysisInput: {
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'asyncify',
        buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      modulePath: 'example.com/app',
      optimizeFlag: '-Oz',
      entryFile: '/workspace/main.go',
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        artifactOutputPath: '/working/out.wasm',
      },
      sourceSelection: {
        allCompile: [
          '/workspace/helper/helper.go',
          '/workspace/main.go',
          '/working/.tinygo-root/src/fmt/print.go',
        ],
      },
      packageGraph: [
        { depOnly: false, dir: '/workspace', files: { goFiles: ['main.go'] }, importPath: 'example.com/app', imports: ['example.com/app/helper'], modulePath: 'example.com/app', name: 'main', standard: false },
        { depOnly: true, dir: '/workspace/helper', files: { goFiles: ['helper.go'] }, importPath: 'example.com/app/helper', imports: ['fmt'], modulePath: 'example.com/app', name: 'helper', standard: false },
        { depOnly: true, dir: '/working/.tinygo-root/src/fmt', files: { goFiles: ['print.go'] }, importPath: 'fmt', imports: ['errors'], modulePath: '', name: 'fmt', standard: true },
      ],
    },
    gc: 'precise',
    goarch: 'wasm',
    goos: 'js',
    llvmTriple: 'wasm32-unknown-wasi',
    packageGraph: [
      { depOnly: false, dir: '/workspace', goFiles: ['main.go'], importPath: 'example.com/app', imports: ['example.com/app/helper'], modulePath: 'example.com/app', name: 'main', standard: false },
      { depOnly: true, dir: '/workspace/helper', goFiles: ['helper.go'], importPath: 'example.com/app/helper', imports: ['fmt'], modulePath: 'example.com/app', name: 'helper', standard: false },
      { depOnly: true, dir: '/working/.tinygo-root/src/fmt', goFiles: ['print.go'], importPath: 'fmt', imports: ['errors'], modulePath: '', name: 'fmt', standard: true },
    ],
    scheduler: 'asyncify',
    target: 'wasm',
  })

  assert.equal(verification.target, 'wasm')
  assert.equal(verification.llvmTarget, 'wasm32-unknown-wasi')
  assert.equal(verification.scheduler, 'asyncify')
  assert.equal(verification.graphPackageCount, 3)
})

test('verifyFrontendAnalysisInputManifestAgainstDriverBridgeManifest reports a generic mismatch when synthesized frontend input verification fails first', () => {
  const manifest = {
    buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    modulePath: 'example.com/app',
    optimizeFlag: '-Oz',
    entryFile: '/workspace/main.go',
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      allCompile: [
        '/working/.tinygo-root/src/fmt/print.go',
        '/workspace/helper/helper.go',
        '/workspace/main.go',
      ],
    },
    packageGraph: [
      { depOnly: false, dir: '/workspace', files: { goFiles: ['main.go'] }, importPath: 'command-line-arguments', imports: ['example.com/app/helper'], modulePath: 'example.com/app', name: 'main', standard: false },
      { depOnly: true, dir: '/workspace/helper', files: { goFiles: ['helper.go'] }, importPath: 'example.com/app/helper', imports: ['fmt'], modulePath: 'example.com/app', name: 'helper', standard: false },
      { depOnly: true, dir: '/working/.tinygo-root/src/fmt', files: { goFiles: ['print.go'] }, importPath: 'fmt', imports: ['errors'], modulePath: '', name: 'fmt', standard: true },
    ],
  }
  const bridgeManifest = {
    artifactOutputPath: '/working/out.wasm',
    driverBuildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
    entryFile: '/workspace/main.go',
    entryPackage: {
      depOnly: false,
      dir: '/workspace',
      goFiles: ['main.go'],
      importPath: 'example.com/app',
      imports: ['example.com/app/helper'],
      modulePath: 'example.com/app',
      name: 'main',
      standard: false,
    },
    frontendAnalysisInput: {
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      buildContext: {
        target: 'mismatch-target',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'asyncify',
        buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      modulePath: 'example.com/app',
      optimizeFlag: '-Oz',
      entryFile: '/workspace/main.go',
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        artifactOutputPath: '/working/out.wasm',
      },
      sourceSelection: {
        allCompile: [
          '/workspace/helper/helper.go',
          '/workspace/main.go',
          '/working/.tinygo-root/src/fmt/print.go',
        ],
      },
      packageGraph: [
        { depOnly: false, dir: '/workspace', files: { goFiles: ['main.go'] }, importPath: 'example.com/app', imports: ['example.com/app/helper'], modulePath: 'example.com/app', name: 'main', standard: false },
        { depOnly: true, dir: '/workspace/helper', files: { goFiles: ['helper.go'] }, importPath: 'example.com/app/helper', imports: ['fmt'], modulePath: 'example.com/app', name: 'helper', standard: false },
        { depOnly: true, dir: '/working/.tinygo-root/src/fmt', files: { goFiles: ['print.go'] }, importPath: 'fmt', imports: ['errors'], modulePath: '', name: 'fmt', standard: true },
      ],
    },
    gc: 'precise',
    goarch: 'wasm',
    goos: 'js',
    llvmTriple: 'wasm32-unknown-wasi',
    packageGraph: [
      { depOnly: false, dir: '/workspace', goFiles: ['main.go'], importPath: 'example.com/app', imports: ['example.com/app/helper'], modulePath: 'example.com/app', name: 'main', standard: false },
      { depOnly: true, dir: '/workspace/helper', goFiles: ['helper.go'], importPath: 'example.com/app/helper', imports: ['fmt'], modulePath: 'example.com/app', name: 'helper', standard: false },
      { depOnly: true, dir: '/working/.tinygo-root/src/fmt', goFiles: ['print.go'], importPath: 'fmt', imports: ['errors'], modulePath: '', name: 'fmt', standard: true },
    ],
    scheduler: 'asyncify',
    target: 'wasm',
  }

  assert.throws(() => verifyFrontendAnalysisInputManifestAgainstDriverBridgeManifest(
    manifest,
    bridgeManifest,
  ), /frontend analysis input did not match real TinyGo driver bridge/)
})

test('verifyFrontendAnalysisAgainstDriverBridgeManifest accepts matching analysis facts', () => {
  const verification = verifyFrontendAnalysisAgainstDriverBridgeManifest({
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    allCompileFiles: [
      '/workspace/helper/helper.go',
      '/workspace/main.go',
      '/working/.tinygo-root/src/fmt/print.go',
    ],
    compileGroups: [
      {
        name: 'program',
        files: ['/workspace/main.go'],
      },
      {
        name: 'all-compile',
        files: [
          '/workspace/helper/helper.go',
          '/workspace/main.go',
          '/working/.tinygo-root/src/fmt/print.go',
        ],
      },
    ],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
      {
        kind: 'imported',
        importPath: 'example.com/app/helper',
        packageName: 'helper',
        packageDir: '/workspace/helper',
        files: ['/workspace/helper/helper.go'],
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
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'example.com/app',
        imports: ['example.com/app/helper'],
        modulePath: 'example.com/app',
        name: 'main',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/workspace/helper',
        files: { goFiles: ['helper.go'] },
        importPath: 'example.com/app/helper',
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
        imports: ['errors'],
        modulePath: '',
        name: 'fmt',
        standard: true,
      },
    ],
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
    },
  }, {
    entryFile: '/workspace/main.go',
    frontendAnalysis: {
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'asyncify',
        buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      entryFile: '/workspace/main.go',
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: [
        '/workspace/helper/helper.go',
        '/workspace/main.go',
        '/working/.tinygo-root/src/fmt/print.go',
      ],
      compileGroups: [
        {
          name: 'program',
          files: ['/workspace/main.go'],
        },
        {
          name: 'all-compile',
          files: [
            '/workspace/helper/helper.go',
            '/workspace/main.go',
            '/working/.tinygo-root/src/fmt/print.go',
          ],
        },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          packageName: 'main',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
        },
        {
          kind: 'imported',
          importPath: 'example.com/app/helper',
          packageName: 'helper',
          packageDir: '/workspace/helper',
          files: ['/workspace/helper/helper.go'],
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
          dir: '/workspace',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: ['example.com/app/helper'],
          modulePath: 'example.com/app',
          name: 'main',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/workspace/helper',
          files: { goFiles: ['helper.go'] },
          importPath: 'example.com/app/helper',
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
          imports: ['errors'],
          modulePath: '',
          name: 'fmt',
          standard: true,
        },
      ],
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
      },
    },
    gc: 'precise',
    goarch: 'wasm',
    goos: 'js',
    llvmTriple: 'wasm32-unknown-wasi',
    packageGraph: [
      { depOnly: false, dir: '/workspace', goFiles: ['main.go'], importPath: 'example.com/app', imports: ['example.com/app/helper'], name: 'main', standard: false },
      { depOnly: true, dir: '/workspace/helper', goFiles: ['helper.go'], importPath: 'example.com/app/helper', imports: ['fmt'], name: 'helper', standard: false },
      { depOnly: true, dir: '/working/.tinygo-root/src/fmt', goFiles: ['print.go'], importPath: 'fmt', imports: ['errors'], name: 'fmt', standard: true },
    ],
    scheduler: 'asyncify',
    target: 'wasm',
  })

  assert.equal(verification.entryFile, '/workspace/main.go')
  assert.equal(verification.compileUnitManifestPath, '/working/tinygo-compile-unit.json')
  assert.equal(verification.compileGroupCount, 2)
  assert.equal(verification.compileUnitCount, 3)
  assert.equal(verification.allCompileCount, 3)
  assert.equal(verification.graphPackageCount, 3)
  assert.equal(verification.goos, 'js')
  assert.equal(verification.goarch, 'wasm')
  assert.equal(verification.gc, 'precise')
  assert.equal(verification.scheduler, 'asyncify')
  assert.equal(verification.target, 'wasm')
  assert.equal(verification.llvmTarget, 'wasm32-unknown-wasi')
  assert.equal(verification.programImportAlias, 'direct')
  assert.equal(verification.programImportPath, 'example.com/app')
})

test('verifyFrontendAnalysisAgainstDriverBridgeManifest accepts a synthetic program alias when the bridge uses a direct import path', () => {
  const verification = verifyFrontendAnalysisAgainstDriverBridgeManifest({
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    allCompileFiles: ['/workspace/main.go'],
    compileGroups: [
      {
        name: 'program',
        files: ['/workspace/main.go'],
      },
      {
        name: 'all-compile',
        files: ['/workspace/main.go'],
      },
    ],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'command-line-arguments',
        modulePath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
    ],
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'command-line-arguments',
        imports: [],
        modulePath: 'example.com/app',
        name: 'main',
        standard: false,
      },
    ],
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
    },
  }, {
    entryFile: '/workspace/main.go',
    entryPackage: {
      depOnly: false,
      dir: '/workspace',
      goFiles: ['main.go'],
      importPath: 'example.com/app',
      imports: [],
      modulePath: 'example.com/app',
      name: 'main',
      standard: false,
    },
    frontendAnalysis: {
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'asyncify',
        buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      entryFile: '/workspace/main.go',
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: ['/workspace/main.go'],
      compileGroups: [
        {
          name: 'program',
          files: ['/workspace/main.go'],
        },
        {
          name: 'all-compile',
          files: ['/workspace/main.go'],
        },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          modulePath: 'example.com/app',
          packageName: 'main',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: '/workspace',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: [],
          modulePath: 'example.com/app',
          name: 'main',
          standard: false,
        },
      ],
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
      },
    },
    gc: 'precise',
    goarch: 'wasm',
    goos: 'js',
    llvmTriple: 'wasm32-unknown-wasi',
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        goFiles: ['main.go'],
        importPath: 'example.com/app',
        imports: [],
        modulePath: 'example.com/app',
        name: 'main',
        standard: false,
      },
    ],
    scheduler: 'asyncify',
    target: 'wasm',
  })

  assert.equal(verification.programImportAlias, 'synthetic')
  assert.equal(verification.programImportPath, 'command-line-arguments')
})

test('verifyFrontendAnalysisAgainstDriverBridgeManifest accepts sparse stdlib imports when the bridge frontendAnalysis has richer host imports', () => {
  const verification = verifyFrontendAnalysisAgainstDriverBridgeManifest({
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    allCompileFiles: ['/workspace/main.go', '/working/.tinygo-root/src/fmt/print.go'],
    compileGroups: [
      { name: 'program', files: ['/workspace/main.go'] },
      { name: 'stdlib', files: ['/working/.tinygo-root/src/fmt/print.go'] },
      { name: 'all-compile', files: ['/workspace/main.go', '/working/.tinygo-root/src/fmt/print.go'] },
    ],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'example.com/app',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
      {
        kind: 'stdlib',
        importPath: 'fmt',
        imports: [],
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
        importPath: 'example.com/app',
        imports: ['fmt'],
        modulePath: 'example.com/app',
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
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
    },
  }, {
    entryFile: '/workspace/main.go',
    entryPackage: {
      depOnly: false,
      dir: '/workspace',
      goFiles: ['main.go'],
      importPath: 'example.com/app',
      imports: ['fmt'],
      modulePath: 'example.com/app',
      name: 'main',
      standard: false,
    },
    frontendAnalysis: {
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'asyncify',
        buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      entryFile: '/workspace/main.go',
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: ['/workspace/main.go', '/working/.tinygo-root/src/fmt/print.go'],
      compileGroups: [
        { name: 'program', files: ['/workspace/main.go'] },
        { name: 'stdlib', files: ['/working/.tinygo-root/src/fmt/print.go'] },
        { name: 'all-compile', files: ['/workspace/main.go', '/working/.tinygo-root/src/fmt/print.go'] },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          imports: ['fmt'],
          modulePath: 'example.com/app',
          packageName: 'main',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
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
          importPath: 'example.com/app',
          imports: ['fmt'],
          modulePath: 'example.com/app',
          name: 'main',
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
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
      },
    },
    gc: 'precise',
    goarch: 'wasm',
    goos: 'js',
    llvmTriple: 'wasm32-unknown-wasi',
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        goFiles: ['main.go'],
        importPath: 'example.com/app',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        name: 'main',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/working/.tinygo-root/src/fmt',
        goFiles: ['print.go'],
        importPath: 'fmt',
        imports: ['errors', 'io'],
        modulePath: '',
        name: 'fmt',
        standard: true,
      },
    ],
    scheduler: 'asyncify',
    target: 'wasm',
  })

  assert.equal(verification.compileUnitCount, 2)
  assert.equal(verification.graphPackageCount, 2)
})

test('verifyFrontendAnalysisAgainstDriverBridgeManifest rejects mismatched buildContext facts', () => {
  assert.throws(() => verifyFrontendAnalysisAgainstDriverBridgeManifest({
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'wasip1',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    allCompileFiles: ['/workspace/main.go'],
    compileGroups: [
      {
        name: 'program',
        files: ['/workspace/main.go'],
      },
    ],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
    ],
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'example.com/app',
        imports: [],
        name: 'main',
        standard: false,
      },
    ],
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
    },
  }, {
    frontendAnalysis: {
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'asyncify',
        buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      entryFile: '/workspace/main.go',
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: ['/workspace/main.go'],
      compileGroups: [
        {
          name: 'program',
          files: ['/workspace/main.go'],
        },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          packageName: 'main',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: '/workspace',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: [],
          name: 'main',
          standard: false,
        },
      ],
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
      },
    },
    gc: 'precise',
    goarch: 'wasm',
    goos: 'js',
    llvmTriple: 'wasm32-unknown-wasi',
    packageGraph: [
      { depOnly: false, dir: '/workspace', goFiles: ['main.go'], importPath: 'example.com/app', imports: [], name: 'main', standard: false },
    ],
    scheduler: 'asyncify',
    target: 'wasm',
  }), /frontend analysis buildContext did not match real TinyGo driver bridge/)
})

test('verifyFrontendAnalysisAgainstDriverBridgeManifest rejects mismatched packageGraph facts', () => {
  assert.throws(() => verifyFrontendAnalysisAgainstDriverBridgeManifest({
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    allCompileFiles: ['/workspace/main.go'],
    compileGroups: [
      {
        name: 'program',
        files: ['/workspace/main.go'],
      },
    ],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
    ],
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'example.com/app',
        imports: ['fmt'],
        name: 'main',
        standard: false,
      },
    ],
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
    },
  }, {
    frontendAnalysis: {
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'asyncify',
        buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      entryFile: '/workspace/main.go',
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: ['/workspace/main.go'],
      compileGroups: [
        {
          name: 'program',
          files: ['/workspace/main.go'],
        },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          packageName: 'main',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: '/workspace',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: [],
          name: 'main',
          standard: false,
        },
      ],
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
      },
    },
    gc: 'precise',
    goarch: 'wasm',
    goos: 'js',
    llvmTriple: 'wasm32-unknown-wasi',
    packageGraph: [
      { depOnly: false, dir: '/workspace', goFiles: ['main.go'], importPath: 'example.com/app', imports: [], name: 'main', standard: false },
    ],
    scheduler: 'asyncify',
    target: 'wasm',
  }), /frontend analysis packageGraph did not match real TinyGo driver bridge/)
})

test('verifyFrontendAnalysisAgainstDriverBridgeManifest rejects mismatched compile-unit manifest paths', () => {
  assert.throws(() => verifyFrontendAnalysisAgainstDriverBridgeManifest({
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-analysis.json',
    allCompileFiles: ['/workspace/main.go'],
    compileGroups: [
      {
        name: 'program',
        files: ['/workspace/main.go'],
      },
    ],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
    ],
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
    },
  }, {
    entryFile: '/workspace/main.go',
    frontendAnalysis: {
      entryFile: '/workspace/main.go',
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: ['/workspace/main.go'],
      compileGroups: [
        {
          name: 'program',
          files: ['/workspace/main.go'],
        },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          packageName: 'main',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
        },
      ],
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
      },
    },
    llvmTriple: 'wasm32-unknown-wasi',
    target: 'wasm',
  }), /frontend analysis compileUnitManifestPath did not match real TinyGo driver bridge/)
})

test('verifyFrontendAnalysisAgainstRealDriverBridgeManifest accepts matching package-focused analysis facts', () => {
  const verification = verifyFrontendAnalysisAgainstRealDriverBridgeManifest({
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    allCompileFiles: [
      '/workspace/helper/helper.go',
      '/workspace/main.go',
      '/working/.tinygo-root/src/fmt/print.go',
    ],
    compileGroups: [
      {
        name: 'target-assets',
        files: ['/working/.tinygo-root/targets/wasm.json'],
      },
      {
        name: 'runtime-support',
        files: ['/working/.tinygo-root/src/runtime/runtime.go'],
      },
      {
        name: 'program',
        files: ['/workspace/main.go'],
      },
      {
        name: 'imported',
        files: ['/workspace/helper/helper.go'],
      },
      {
        name: 'stdlib',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
      },
      {
        name: 'all-compile',
        files: [
          '/workspace/helper/helper.go',
          '/workspace/main.go',
          '/working/.tinygo-root/src/fmt/print.go',
        ],
      },
    ],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['example.com/app/helper'],
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
      {
        kind: 'imported',
        importPath: 'example.com/app/helper',
        imports: ['fmt'],
        packageName: 'helper',
        packageDir: '/workspace/helper',
        files: ['/workspace/helper/helper.go'],
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
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
    },
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'command-line-arguments',
        imports: ['example.com/app/helper'],
        modulePath: 'example.com/app',
        name: 'main',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/workspace/helper',
        files: { goFiles: ['helper.go'] },
        importPath: 'example.com/app/helper',
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
        imports: ['errors'],
        modulePath: '',
        name: 'fmt',
        standard: true,
      },
    ],
  }, {
    frontendRealAdapter: {
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'asyncify',
        buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      entryFile: '/workspace/main.go',
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: [
        '/workspace/helper/helper.go',
        '/workspace/main.go',
        '/working/.tinygo-root/src/fmt/print.go',
      ],
      compileGroups: [
        {
          name: 'program',
          files: ['/workspace/main.go'],
        },
        {
          name: 'imported',
          files: ['/workspace/helper/helper.go'],
        },
        {
          name: 'stdlib',
          files: ['/working/.tinygo-root/src/fmt/print.go'],
        },
        {
          name: 'all-compile',
          files: [
            '/workspace/helper/helper.go',
            '/workspace/main.go',
            '/working/.tinygo-root/src/fmt/print.go',
          ],
        },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          imports: ['example.com/app/helper'],
          depOnly: false,
          packageName: 'main',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
          standard: false,
        },
        {
          kind: 'imported',
          importPath: 'example.com/app/helper',
          imports: ['fmt'],
          depOnly: true,
          packageName: 'helper',
          packageDir: '/workspace/helper',
          files: ['/workspace/helper/helper.go'],
          standard: false,
        },
        {
          kind: 'stdlib',
          importPath: 'fmt',
          imports: ['errors'],
          depOnly: true,
          packageName: 'fmt',
          packageDir: '/working/.tinygo-root/src/fmt',
          files: ['/working/.tinygo-root/src/fmt/print.go'],
          standard: true,
        },
      ],
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
      },
      packageGraph: [
        {
          depOnly: false,
          dir: '/workspace',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: ['example.com/app/helper'],
          modulePath: 'example.com/app',
          name: 'main',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/workspace/helper',
          files: { goFiles: ['helper.go'] },
          importPath: 'example.com/app/helper',
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
          imports: ['errors'],
          modulePath: '',
          name: 'fmt',
          standard: true,
        },
      ],
    },
    target: 'wasm',
    llvmTriple: 'wasm32-unknown-wasi',
  })

  assert.equal(verification.programImportAlias, 'synthetic')
  assert.equal(verification.compileGroupCount, 4)
  assert.equal(verification.compileUnitCount, 3)
  assert.equal(verification.allCompileCount, 3)
  assert.equal(verification.graphPackageCount, 3)
  assert.equal(verification.goos, 'js')
  assert.equal(verification.goarch, 'wasm')
  assert.equal(verification.gc, 'precise')
  assert.equal(verification.scheduler, 'asyncify')
})

test('verifyFrontendAnalysisAgainstRealDriverBridgeManifest accepts sparse stdlib imports when the real adapter has richer host imports', () => {
  const verification = verifyFrontendAnalysisAgainstRealDriverBridgeManifest({
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    allCompileFiles: ['/workspace/main.go', '/working/.tinygo-root/src/fmt/print.go'],
    compileGroups: [
      { name: 'program', files: ['/workspace/main.go'] },
      { name: 'imported', files: [] },
      { name: 'stdlib', files: ['/working/.tinygo-root/src/fmt/print.go'] },
      { name: 'all-compile', files: ['/workspace/main.go', '/working/.tinygo-root/src/fmt/print.go'] },
    ],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'example.com/app',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
      {
        kind: 'stdlib',
        importPath: 'fmt',
        imports: [],
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
        importPath: 'example.com/app',
        imports: ['fmt'],
        modulePath: 'example.com/app',
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
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
    },
  }, {
    frontendRealAdapter: {
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'asyncify',
        buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      entryFile: '/workspace/main.go',
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: ['/workspace/main.go', '/working/.tinygo-root/src/fmt/print.go'],
      compileGroups: [
        { name: 'program', files: ['/workspace/main.go'] },
        { name: 'imported', files: [] },
        { name: 'stdlib', files: ['/working/.tinygo-root/src/fmt/print.go'] },
        { name: 'all-compile', files: ['/workspace/main.go', '/working/.tinygo-root/src/fmt/print.go'] },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          imports: ['fmt'],
          modulePath: 'example.com/app',
          depOnly: false,
          packageName: 'main',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
          standard: false,
        },
        {
          kind: 'stdlib',
          importPath: 'fmt',
          imports: ['errors', 'io'],
          modulePath: '',
          depOnly: true,
          packageName: 'fmt',
          packageDir: '/working/.tinygo-root/src/fmt',
          files: ['/working/.tinygo-root/src/fmt/print.go'],
          standard: true,
        },
      ],
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
      },
      packageGraph: [
        {
          depOnly: false,
          dir: '/workspace',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: ['fmt'],
          modulePath: 'example.com/app',
          name: 'main',
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
    },
    target: 'wasm',
    llvmTriple: 'wasm32-unknown-wasi',
  })

  assert.equal(verification.compileUnitCount, 2)
  assert.equal(verification.graphPackageCount, 2)
})

test('verifyFrontendRealAdapterAgainstFrontendAnalysis accepts package-focused normalization from analysis', () => {
  const verification = verifyFrontendRealAdapterAgainstFrontendAnalysis({
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    allCompileFiles: [
      '/workspace/helper/helper.go',
      '/workspace/main.go',
      '/working/.tinygo-root/src/fmt/print.go',
    ],
    compileGroups: [
      { name: 'program', files: ['/workspace/main.go'] },
      { name: 'imported', files: ['/workspace/helper/helper.go'] },
      { name: 'stdlib', files: ['/working/.tinygo-root/src/fmt/print.go'] },
      {
        name: 'all-compile',
        files: [
          '/workspace/helper/helper.go',
          '/workspace/main.go',
          '/working/.tinygo-root/src/fmt/print.go',
        ],
      },
    ],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'example.com/app',
        imports: ['example.com/app/helper'],
        depOnly: false,
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        standard: false,
      },
      {
        kind: 'imported',
        importPath: 'example.com/app/helper',
        imports: ['fmt'],
        depOnly: true,
        packageName: 'helper',
        packageDir: '/workspace/helper',
        files: ['/workspace/helper/helper.go'],
        standard: false,
      },
      {
        kind: 'stdlib',
        importPath: 'fmt',
        imports: ['errors'],
        depOnly: true,
        packageName: 'fmt',
        packageDir: '/working/.tinygo-root/src/fmt',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
        standard: true,
      },
    ],
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
    },
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'example.com/app',
        imports: ['example.com/app/helper'],
        modulePath: 'example.com/app',
        name: 'main',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/workspace/helper',
        files: { goFiles: ['helper.go'] },
        importPath: 'example.com/app/helper',
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
        imports: ['errors'],
        modulePath: '',
        name: 'fmt',
        standard: true,
      },
    ],
  }, {
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    allCompileFiles: [
      '/workspace/helper/helper.go',
      '/workspace/main.go',
      '/working/.tinygo-root/src/fmt/print.go',
    ],
    compileGroups: [
      {
        name: 'target-assets',
        files: ['/working/.tinygo-root/targets/wasm.json'],
      },
      {
        name: 'runtime-support',
        files: ['/working/.tinygo-root/src/runtime/runtime.go'],
      },
      {
        name: 'program',
        files: ['/workspace/main.go'],
      },
      {
        name: 'imported',
        files: ['/workspace/helper/helper.go'],
      },
      {
        name: 'stdlib',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
      },
      {
        name: 'all-compile',
        files: [
          '/workspace/helper/helper.go',
          '/workspace/main.go',
          '/working/.tinygo-root/src/fmt/print.go',
        ],
      },
    ],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['example.com/app/helper'],
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
      {
        kind: 'imported',
        importPath: 'example.com/app/helper',
        imports: ['fmt'],
        packageName: 'helper',
        packageDir: '/workspace/helper',
        files: ['/workspace/helper/helper.go'],
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
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
    },
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'command-line-arguments',
        imports: ['example.com/app/helper'],
        modulePath: 'example.com/app',
        name: 'main',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/workspace/helper',
        files: { goFiles: ['helper.go'] },
        importPath: 'example.com/app/helper',
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
        imports: ['errors'],
        modulePath: '',
        name: 'fmt',
        standard: true,
      },
    ],
  })

  assert.equal(verification.programImportAlias, 'synthetic')
  assert.equal(verification.compileGroupCount, 4)
  assert.equal(verification.compileUnitCount, 3)
  assert.equal(verification.allCompileCount, 3)
})

test('verifyFrontendRealAdapterAgainstFrontendAnalysis derives selected compileGroups from compileUnits when they are omitted', () => {
  const verification = verifyFrontendRealAdapterAgainstFrontendAnalysis({
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    allCompileFiles: [
      '/workspace/helper/helper.go',
      '/workspace/main.go',
      '/working/.tinygo-root/src/fmt/print.go',
    ],
    compileGroups: [],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'example.com/app',
        imports: ['example.com/app/helper'],
        depOnly: false,
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        standard: false,
      },
      {
        kind: 'imported',
        importPath: 'example.com/app/helper',
        imports: ['fmt'],
        depOnly: true,
        packageName: 'helper',
        packageDir: '/workspace/helper',
        files: ['/workspace/helper/helper.go'],
        standard: false,
      },
      {
        kind: 'stdlib',
        importPath: 'fmt',
        imports: ['errors'],
        depOnly: true,
        packageName: 'fmt',
        packageDir: '/working/.tinygo-root/src/fmt',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
        standard: true,
      },
    ],
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
    },
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'example.com/app',
        imports: ['example.com/app/helper'],
        modulePath: 'example.com/app',
        name: 'main',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/workspace/helper',
        files: { goFiles: ['helper.go'] },
        importPath: 'example.com/app/helper',
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
        imports: ['errors'],
        modulePath: '',
        name: 'fmt',
        standard: true,
      },
    ],
  }, {
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    allCompileFiles: [
      '/workspace/helper/helper.go',
      '/workspace/main.go',
      '/working/.tinygo-root/src/fmt/print.go',
    ],
    compileGroups: [
      { name: 'target-assets', files: ['/working/.tinygo-root/targets/wasm.json'] },
      { name: 'runtime-support', files: ['/working/.tinygo-root/src/runtime/runtime.go'] },
    ],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['example.com/app/helper'],
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
      {
        kind: 'imported',
        importPath: 'example.com/app/helper',
        imports: ['fmt'],
        packageName: 'helper',
        packageDir: '/workspace/helper',
        files: ['/workspace/helper/helper.go'],
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
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
    },
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'command-line-arguments',
        imports: ['example.com/app/helper'],
        modulePath: 'example.com/app',
        name: 'main',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/workspace/helper',
        files: { goFiles: ['helper.go'] },
        importPath: 'example.com/app/helper',
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
        imports: ['errors'],
        modulePath: '',
        name: 'fmt',
        standard: true,
      },
    ],
  })

  assert.equal(verification.programImportAlias, 'synthetic')
  assert.equal(verification.compileGroupCount, 4)
  assert.equal(verification.compileUnitCount, 3)
  assert.equal(verification.allCompileCount, 3)
})

test('verifyFrontendAnalysisAgainstRealDriverBridgeManifest accepts alias-only realFrontendAnalysis bridge manifests', () => {
  const verification = verifyFrontendAnalysisAgainstRealDriverBridgeManifest({
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    allCompileFiles: [
      '/workspace/helper/helper.go',
      '/workspace/main.go',
      '/working/.tinygo-root/src/fmt/print.go',
    ],
    compileGroups: [
      { name: 'program', files: ['/workspace/main.go'] },
      { name: 'imported', files: ['/workspace/helper/helper.go'] },
      { name: 'stdlib', files: ['/working/.tinygo-root/src/fmt/print.go'] },
      {
        name: 'all-compile',
        files: [
          '/workspace/helper/helper.go',
          '/workspace/main.go',
          '/working/.tinygo-root/src/fmt/print.go',
        ],
      },
    ],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['example.com/app/helper'],
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
      {
        kind: 'imported',
        importPath: 'example.com/app/helper',
        imports: ['fmt'],
        packageName: 'helper',
        packageDir: '/workspace/helper',
        files: ['/workspace/helper/helper.go'],
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
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
    },
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'command-line-arguments',
        imports: ['example.com/app/helper'],
        name: 'main',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/workspace/helper',
        files: { goFiles: ['helper.go'] },
        importPath: 'example.com/app/helper',
        imports: ['fmt'],
        name: 'helper',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/working/.tinygo-root/src/fmt',
        files: { goFiles: ['print.go'] },
        importPath: 'fmt',
        imports: ['errors'],
        name: 'fmt',
        standard: true,
      },
    ],
  }, {
    realFrontendAnalysis: {
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'asyncify',
        buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      entryFile: '/workspace/main.go',
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: [
        '/workspace/helper/helper.go',
        '/workspace/main.go',
        '/working/.tinygo-root/src/fmt/print.go',
      ],
      compileGroups: [
        { name: 'program', files: ['/workspace/main.go'] },
        { name: 'imported', files: ['/workspace/helper/helper.go'] },
        { name: 'stdlib', files: ['/working/.tinygo-root/src/fmt/print.go'] },
        {
          name: 'all-compile',
          files: [
            '/workspace/helper/helper.go',
            '/workspace/main.go',
            '/working/.tinygo-root/src/fmt/print.go',
          ],
        },
      ],
      compileUnits: [
        {
          depOnly: false,
          kind: 'program',
          importPath: 'example.com/app',
          imports: ['example.com/app/helper'],
          packageName: 'main',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
          standard: false,
        },
        {
          depOnly: true,
          kind: 'imported',
          importPath: 'example.com/app/helper',
          imports: ['fmt'],
          packageName: 'helper',
          packageDir: '/workspace/helper',
          files: ['/workspace/helper/helper.go'],
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
      ],
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
      },
      packageGraph: [
        {
          depOnly: false,
          dir: '/workspace',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: ['example.com/app/helper'],
          name: 'main',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/workspace/helper',
          files: { goFiles: ['helper.go'] },
          importPath: 'example.com/app/helper',
          imports: ['fmt'],
          name: 'helper',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/working/.tinygo-root/src/fmt',
          files: { goFiles: ['print.go'] },
          importPath: 'fmt',
          imports: ['errors'],
          name: 'fmt',
          standard: true,
        },
      ],
    },
    target: 'wasm',
    llvmTriple: 'wasm32-unknown-wasi',
  })

  assert.equal(verification.target, 'wasm')
  assert.equal(verification.programImportAlias, 'synthetic')
})

test('verifyFrontendAnalysisAgainstRealDriverBridgeManifest rejects mismatched imported files', () => {
  assert.throws(() => verifyFrontendAnalysisAgainstRealDriverBridgeManifest({
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    allCompileFiles: [
      '/workspace/helper/helper.go',
      '/workspace/main.go',
    ],
    compileGroups: [
      {
        name: 'program',
        files: ['/workspace/main.go'],
      },
      {
        name: 'imported',
        files: ['/workspace/helper/helper.go'],
      },
      {
        name: 'all-compile',
        files: [
          '/workspace/helper/helper.go',
          '/workspace/main.go',
        ],
      },
    ],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'example.com/app',
        imports: ['example.com/app/helper'],
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
      {
        kind: 'imported',
        importPath: 'example.com/app/helper',
        imports: ['fmt'],
        packageName: 'helper',
        packageDir: '/workspace/helper',
        files: ['/workspace/helper/helper.go'],
      },
    ],
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
    },
  }, {
    frontendRealAdapter: {
      entryFile: '/workspace/main.go',
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: [
        '/workspace/main.go',
        '/workspace/other/helper.go',
      ],
      compileGroups: [
        {
          name: 'program',
          files: ['/workspace/main.go'],
        },
        {
          name: 'imported',
          files: ['/workspace/other/helper.go'],
        },
        {
          name: 'all-compile',
          files: [
            '/workspace/main.go',
            '/workspace/other/helper.go',
          ],
        },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          imports: ['example.com/app/helper'],
          depOnly: false,
          packageName: 'main',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
          standard: false,
        },
        {
          kind: 'imported',
          importPath: 'example.com/app/helper',
          imports: ['fmt'],
          depOnly: true,
          packageName: 'helper',
          packageDir: '/workspace/other',
          files: ['/workspace/other/helper.go'],
          standard: false,
        },
      ],
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
      },
    },
    target: 'wasm',
    llvmTriple: 'wasm32-unknown-wasi',
  }), /frontend analysis allCompileFiles did not match real TinyGo analysis adapter/)
})

test('verifyFrontendAnalysisAgainstRealDriverBridgeManifest rejects mismatched buildContext facts', () => {
  assert.throws(() => verifyFrontendAnalysisAgainstRealDriverBridgeManifest({
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    allCompileFiles: ['/workspace/main.go'],
    compileGroups: [
      { name: 'program', files: ['/workspace/main.go'] },
      { name: 'imported', files: [] },
      { name: 'stdlib', files: [] },
      { name: 'all-compile', files: ['/workspace/main.go'] },
    ],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'example.com/app',
        imports: [],
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
    ],
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'example.com/app',
        imports: [],
        name: 'main',
        standard: false,
      },
    ],
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
    },
  }, {
    frontendRealAdapter: {
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'wasip1',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'asyncify',
        buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      entryFile: '/workspace/main.go',
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: ['/workspace/main.go'],
      compileGroups: [
        { name: 'program', files: ['/workspace/main.go'] },
        { name: 'imported', files: [] },
        { name: 'stdlib', files: [] },
        { name: 'all-compile', files: ['/workspace/main.go'] },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          imports: [],
          depOnly: false,
          packageName: 'main',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
          standard: false,
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: '/workspace',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: [],
          name: 'main',
          standard: false,
        },
      ],
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
      },
    },
    target: 'wasm',
    llvmTriple: 'wasm32-unknown-wasi',
  }), /frontend analysis buildContext did not match real TinyGo analysis adapter/)
})

test('verifyFrontendAnalysisAgainstRealDriverBridgeManifest rejects mismatched optimizeFlag facts', () => {
  assert.throws(() => verifyFrontendAnalysisAgainstRealDriverBridgeManifest({
    optimizeFlag: '-Oz',
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    allCompileFiles: ['/workspace/main.go'],
    compileGroups: [
      { name: 'program', files: ['/workspace/main.go'] },
      { name: 'imported', files: [] },
      { name: 'stdlib', files: [] },
      { name: 'all-compile', files: ['/workspace/main.go'] },
    ],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'example.com/app',
        imports: [],
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
    ],
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'example.com/app',
        imports: [],
        name: 'main',
        standard: false,
      },
    ],
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      artifactOutputPath: '/working/out.wasm',
    },
  }, {
    frontendRealAdapter: {
      optimizeFlag: '-O0',
      entryFile: '/workspace/main.go',
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: ['/workspace/main.go'],
      compileGroups: [
        { name: 'program', files: ['/workspace/main.go'] },
        { name: 'imported', files: [] },
        { name: 'stdlib', files: [] },
        { name: 'all-compile', files: ['/workspace/main.go'] },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          imports: [],
          depOnly: false,
          packageName: 'main',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
          standard: false,
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: '/workspace',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: [],
          name: 'main',
          standard: false,
        },
      ],
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        artifactOutputPath: '/working/out.wasm',
      },
    },
    target: 'wasm',
    llvmTriple: 'wasm32-unknown-wasi',
  }), /frontend analysis optimizeFlag did not match real TinyGo analysis adapter/)
})

test('verifyFrontendAnalysisAgainstRealDriverBridgeManifest rejects mismatched toolchain output paths', () => {
  assert.throws(() => verifyFrontendAnalysisAgainstRealDriverBridgeManifest({
    optimizeFlag: '-Oz',
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    allCompileFiles: ['/workspace/main.go'],
    compileGroups: [
      { name: 'program', files: ['/workspace/main.go'] },
      { name: 'imported', files: [] },
      { name: 'stdlib', files: [] },
      { name: 'all-compile', files: ['/workspace/main.go'] },
    ],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'example.com/app',
        imports: [],
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
    ],
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'example.com/app',
        imports: [],
        name: 'main',
        standard: false,
      },
    ],
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      translationUnitPath: '/working/tinygo-bootstrap.c',
      objectOutputPath: '/working/tinygo-bootstrap.o',
      artifactOutputPath: '/working/out.wasm',
    },
  }, {
    frontendRealAdapter: {
      optimizeFlag: '-Oz',
      entryFile: '/workspace/main.go',
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: ['/workspace/main.go'],
      compileGroups: [
        { name: 'program', files: ['/workspace/main.go'] },
        { name: 'imported', files: [] },
        { name: 'stdlib', files: [] },
        { name: 'all-compile', files: ['/workspace/main.go'] },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          imports: [],
          depOnly: false,
          packageName: 'main',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
          standard: false,
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: '/workspace',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: [],
          name: 'main',
          standard: false,
        },
      ],
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        translationUnitPath: '/working/tinygo-bootstrap.c',
        objectOutputPath: '/working/tinygo-bootstrap.o',
        artifactOutputPath: '/working/other.wasm',
      },
    },
    target: 'wasm',
    llvmTriple: 'wasm32-unknown-wasi',
  }), /frontend analysis toolchain did not match real TinyGo analysis adapter/)
})

test('verifyFrontendAnalysisAgainstRealDriverBridgeManifest rejects mismatched packageGraph facts', () => {
  assert.throws(() => verifyFrontendAnalysisAgainstRealDriverBridgeManifest({
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    allCompileFiles: ['/workspace/main.go'],
    compileGroups: [
      { name: 'program', files: ['/workspace/main.go'] },
      { name: 'imported', files: [] },
      { name: 'stdlib', files: [] },
      { name: 'all-compile', files: ['/workspace/main.go'] },
    ],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: [],
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
    ],
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'command-line-arguments',
        imports: [],
        name: 'main',
        standard: false,
      },
    ],
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
    },
  }, {
    frontendRealAdapter: {
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'asyncify',
        buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      entryFile: '/workspace/main.go',
      compileUnitManifestPath: '/working/tinygo-compile-unit.json',
      allCompileFiles: ['/workspace/main.go'],
      compileGroups: [
        { name: 'program', files: ['/workspace/main.go'] },
        { name: 'imported', files: [] },
        { name: 'stdlib', files: [] },
        { name: 'all-compile', files: ['/workspace/main.go'] },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          imports: [],
          depOnly: false,
          packageName: 'main',
          packageDir: '/workspace',
          files: ['/workspace/main.go'],
          standard: false,
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: '/workspace',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: ['fmt'],
          modulePath: '',
          name: 'main',
          standard: false,
        },
      ],
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
      },
    },
    target: 'wasm',
    llvmTriple: 'wasm32-unknown-wasi',
  }), /frontend analysis packageGraph did not match real TinyGo analysis adapter/)
})

test('verifyCompileUnitManifestAgainstDriverBridgeManifest accepts matching entry package facts', () => {
  const verification = verifyCompileUnitManifestAgainstDriverBridgeManifest({
    entryFile: '/workspace/main.go',
    toolchain: {
      target: 'wasip1',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      program: ['/workspace/main.go'],
      allCompile: ['/workspace/main.go', '/working/.tinygo-root/src/fmt/print.go'],
    },
    compileUnits: [
      {
        depOnly: false,
        kind: 'program',
        importPath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        standard: false,
      },
      {
        depOnly: true,
        kind: 'stdlib',
        importPath: 'fmt',
        packageName: 'fmt',
        packageDir: '/working/.tinygo-root/src/fmt',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
        standard: true,
      },
    ],
  }, {
    artifactOutputPath: '/working/out.wasm',
    entryFile: '/workspace/main.go',
    entryPackage: {
      depOnly: false,
      dir: '/workspace',
      goFiles: ['main.go'],
      importPath: 'example.com/app',
      imports: ['fmt'],
      name: 'main',
      standard: false,
    },
    llvmTriple: 'wasm32-unknown-wasi',
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        goFiles: ['main.go'],
        importPath: 'example.com/app',
        imports: ['fmt'],
        name: 'main',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/host/goroot/src/fmt',
        goFiles: ['print.go'],
        importPath: 'fmt',
        imports: ['errors', 'io'],
        name: 'fmt',
        standard: true,
      },
    ],
    target: 'wasip1',
  })

  assert.equal(verification.target, 'wasip1')
  assert.equal(verification.llvmTarget, 'wasm32-unknown-wasi')
  assert.equal(verification.entryFile, '/workspace/main.go')
  assert.equal(verification.artifactOutputPath, '/working/out.wasm')
  assert.equal(verification.programPackageName, 'main')
  assert.equal(verification.programPackageDir, '/workspace')
  assert.deepEqual(verification.programFiles, ['/workspace/main.go'])
  assert.equal(verification.programImportPath, 'example.com/app')
  assert.equal(verification.bridgeEntryImportPath, 'example.com/app')
  assert.equal(verification.bridgeEntryPackageName, 'main')
  assert.equal(verification.bridgeEntryPackageDir, '/workspace')
  assert.deepEqual(verification.bridgeEntryGoFiles, ['/workspace/main.go'])
  assert.deepEqual(verification.bridgeEntryImports, ['fmt'])
  assert.deepEqual(verification.bridgePackageGraphImportPaths, ['fmt'])
  assert.deepEqual(verification.compileUnitImportPaths, ['fmt'])
  assert.equal(verification.compileUnitCount, 2)
  assert.equal(verification.compileUnitFileCount, 2)
  assert.equal(verification.graphPackageCount, 2)
  assert.equal(verification.coveredPackageCount, 1)
  assert.equal(verification.bridgeFileCount, 2)
  assert.equal(verification.coveredFileCount, 2)
  assert.equal(verification.bridgePackageCount, 1)
  assert.equal(verification.depOnlyPackageCount, 1)
  assert.equal(verification.standardPackageCount, 1)
  assert.equal(verification.localPackageCount, 1)
  assert.equal(verification.programImportAlias, 'direct')
})

test('verifyCompileUnitManifestAgainstDriverBridgeManifest accepts matching package graph facts for local imports', () => {
  const verification = verifyCompileUnitManifestAgainstDriverBridgeManifest({
    entryFile: '/workspace/main.go',
    toolchain: {
      target: 'wasip1',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      program: ['/workspace/main.go'],
      allCompile: [
        '/workspace/helper/helper.go',
        '/workspace/main.go',
        '/working/.tinygo-root/src/fmt/print.go',
      ],
    },
    compileUnits: [
      {
        kind: 'program',
        importPath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
      {
        kind: 'imported',
        importPath: 'example.com/app/helper',
        packageName: 'helper',
        packageDir: '/workspace/helper',
        files: ['/workspace/helper/helper.go'],
      },
      {
        kind: 'stdlib',
        importPath: 'fmt',
        packageName: 'fmt',
        packageDir: '/working/.tinygo-root/src/fmt',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
      },
    ],
  }, {
    artifactOutputPath: '/working/out.wasm',
    entryFile: '/workspace/main.go',
    entryPackage: {
      dir: '/workspace',
      goFiles: ['main.go'],
      importPath: 'example.com/app',
      imports: ['example.com/app/helper'],
      name: 'main',
    },
    llvmTriple: 'wasm32-unknown-wasi',
    packageGraph: [
      {
        dir: '/workspace',
        goFiles: ['main.go'],
        importPath: 'example.com/app',
        imports: ['example.com/app/helper'],
        name: 'main',
      },
      {
        dir: '/workspace/helper',
        goFiles: ['helper.go'],
        importPath: 'example.com/app/helper',
        imports: ['fmt'],
        name: 'helper',
      },
      {
        dir: '/host/goroot/src/fmt',
        goFiles: ['print.go'],
        importPath: 'fmt',
        imports: ['errors', 'io'],
        name: 'fmt',
      },
    ],
    target: 'wasip1',
  })

  assert.deepEqual(verification.bridgeEntryImports, ['example.com/app/helper'])
  assert.deepEqual(verification.bridgePackageGraphImportPaths, ['example.com/app/helper', 'fmt'])
  assert.deepEqual(verification.compileUnitImportPaths, ['example.com/app/helper', 'fmt'])
  assert.equal(verification.compileUnitFileCount, 3)
  assert.equal(verification.bridgeFileCount, 3)
  assert.equal(verification.coveredFileCount, 3)
})

test('verifyCompileUnitManifestAgainstDriverBridgeManifest reports a synthetic alias when the program compile unit uses command-line-arguments', () => {
  const verification = verifyCompileUnitManifestAgainstDriverBridgeManifest({
    entryFile: '/workspace/main.go',
    toolchain: {
      target: 'wasip1',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      program: ['/workspace/main.go'],
      allCompile: ['/workspace/main.go', '/working/.tinygo-root/src/fmt/print.go'],
    },
    compileUnits: [
      {
        kind: 'program',
        importPath: 'command-line-arguments',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
      {
        kind: 'stdlib',
        importPath: 'fmt',
        packageName: 'fmt',
        packageDir: '/working/.tinygo-root/src/fmt',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
      },
    ],
  }, {
    artifactOutputPath: '/working/out.wasm',
    entryFile: '/workspace/main.go',
    entryPackage: {
      dir: '/workspace',
      goFiles: ['main.go'],
      importPath: 'example.com/app',
      imports: ['fmt'],
      name: 'main',
    },
    llvmTriple: 'wasm32-unknown-wasi',
    packageGraph: [
      {
        dir: '/workspace',
        goFiles: ['main.go'],
        importPath: 'example.com/app',
        imports: ['fmt'],
        name: 'main',
      },
      {
        dir: '/host/goroot/src/fmt',
        goFiles: ['print.go'],
        importPath: 'fmt',
        imports: ['errors', 'io'],
        name: 'fmt',
      },
    ],
    target: 'wasip1',
  })

  assert.equal(verification.programImportAlias, 'synthetic')
  assert.equal(verification.compileUnitCount, 2)
  assert.equal(verification.compileUnitFileCount, 2)
  assert.equal(verification.graphPackageCount, 2)
  assert.equal(verification.coveredPackageCount, 1)
  assert.equal(verification.bridgeFileCount, 2)
  assert.equal(verification.coveredFileCount, 2)
  assert.equal(verification.bridgePackageCount, 1)
})

test('verifyCompileUnitManifestAgainstDriverBridgeManifest rejects mismatched stdlib package files', () => {
  assert.throws(() => verifyCompileUnitManifestAgainstDriverBridgeManifest({
    entryFile: '/workspace/main.go',
    toolchain: {
      target: 'wasip1',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      program: ['/workspace/main.go'],
      allCompile: ['/workspace/main.go', '/working/.tinygo-root/src/fmt/print.go'],
    },
    compileUnits: [
      {
        kind: 'program',
        importPath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
      {
        kind: 'stdlib',
        importPath: 'fmt',
        packageName: 'fmt',
        packageDir: '/working/.tinygo-root/src/fmt',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
      },
    ],
  }, {
    artifactOutputPath: '/working/out.wasm',
    entryFile: '/workspace/main.go',
    entryPackage: {
      dir: '/workspace',
      goFiles: ['main.go'],
      importPath: 'example.com/app',
      imports: ['fmt'],
      name: 'main',
    },
    llvmTriple: 'wasm32-unknown-wasi',
    packageGraph: [
      {
        dir: '/workspace',
        goFiles: ['main.go'],
        importPath: 'example.com/app',
        imports: ['fmt'],
        name: 'main',
      },
      {
        dir: '/host/goroot/src/fmt',
        goFiles: ['format.go'],
        importPath: 'fmt',
        imports: ['errors', 'io'],
        name: 'fmt',
      },
    ],
    target: 'wasip1',
  }), /frontend compile unit package graph did not match real TinyGo driver bridge/)
})

test('verifyCompileUnitManifestAgainstDriverBridgeManifest rejects mismatched direct imports when compile units provide them', () => {
  assert.throws(() => verifyCompileUnitManifestAgainstDriverBridgeManifest({
    entryFile: '/workspace/main.go',
    toolchain: {
      target: 'wasip1',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      program: ['/workspace/main.go'],
      allCompile: [
        '/workspace/helper/helper.go',
        '/workspace/main.go',
      ],
    },
    compileUnits: [
      {
        kind: 'program',
        importPath: 'example.com/app',
        imports: ['example.com/app/helper'],
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
      {
        kind: 'imported',
        importPath: 'example.com/app/helper',
        imports: ['fmt'],
        packageName: 'helper',
        packageDir: '/workspace/helper',
        files: ['/workspace/helper/helper.go'],
      },
    ],
  }, {
    artifactOutputPath: '/working/out.wasm',
    entryFile: '/workspace/main.go',
    entryPackage: {
      dir: '/workspace',
      goFiles: ['main.go'],
      importPath: 'example.com/app',
      imports: ['example.com/app/helper'],
      name: 'main',
    },
    llvmTriple: 'wasm32-unknown-wasi',
    packageGraph: [
      {
        dir: '/workspace',
        goFiles: ['main.go'],
        importPath: 'example.com/app',
        imports: ['example.com/app/helper'],
        name: 'main',
      },
      {
        dir: '/workspace/helper',
        goFiles: ['helper.go'],
        importPath: 'example.com/app/helper',
        imports: ['errors'],
        name: 'helper',
      },
    ],
    target: 'wasip1',
  }), /frontend compile unit package graph did not match real TinyGo driver bridge/)
})

test('verifyCompileUnitManifestAgainstDriverBridgeManifest rejects mismatched standard and depOnly package facts when compile units provide them', () => {
  assert.throws(() => verifyCompileUnitManifestAgainstDriverBridgeManifest({
    entryFile: '/workspace/main.go',
    toolchain: {
      target: 'wasip1',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      program: ['/workspace/main.go'],
      allCompile: [
        '/workspace/helper/helper.go',
        '/workspace/main.go',
        '/working/.tinygo-root/src/fmt/print.go',
      ],
    },
    compileUnits: [
      {
        depOnly: false,
        kind: 'program',
        importPath: 'example.com/app',
        imports: ['example.com/app/helper'],
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        standard: false,
      },
      {
        depOnly: false,
        kind: 'imported',
        importPath: 'example.com/app/helper',
        imports: ['fmt'],
        packageName: 'helper',
        packageDir: '/workspace/helper',
        files: ['/workspace/helper/helper.go'],
        standard: true,
      },
      {
        depOnly: true,
        kind: 'stdlib',
        importPath: 'fmt',
        packageName: 'fmt',
        packageDir: '/working/.tinygo-root/src/fmt',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
        standard: false,
      },
    ],
  }, {
    artifactOutputPath: '/working/out.wasm',
    entryFile: '/workspace/main.go',
    entryPackage: {
      dir: '/workspace',
      goFiles: ['main.go'],
      importPath: 'example.com/app',
      imports: ['example.com/app/helper'],
      name: 'main',
    },
    llvmTriple: 'wasm32-unknown-wasi',
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        goFiles: ['main.go'],
        importPath: 'example.com/app',
        imports: ['example.com/app/helper'],
        name: 'main',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/workspace/helper',
        goFiles: ['helper.go'],
        importPath: 'example.com/app/helper',
        imports: ['fmt'],
        name: 'helper',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/host/goroot/src/fmt',
        goFiles: ['print.go'],
        importPath: 'fmt',
        imports: ['errors', 'io'],
        name: 'fmt',
        standard: true,
      },
    ],
    target: 'wasip1',
  }), /frontend compile unit package graph did not match real TinyGo driver bridge/)
})

test('verifyCompileUnitManifestAgainstDriverBridgeManifest rejects mismatched program depOnly and standard facts when compile units provide them', () => {
  assert.throws(() => verifyCompileUnitManifestAgainstDriverBridgeManifest({
    entryFile: '/workspace/main.go',
    toolchain: {
      target: 'wasip1',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      program: ['/workspace/main.go'],
      allCompile: ['/workspace/main.go'],
    },
    compileUnits: [
      {
        depOnly: true,
        kind: 'program',
        importPath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        standard: true,
      },
    ],
  }, {
    artifactOutputPath: '/working/out.wasm',
    entryFile: '/workspace/main.go',
    entryPackage: {
      depOnly: false,
      dir: '/workspace',
      goFiles: ['main.go'],
      importPath: 'example.com/app',
      name: 'main',
      standard: false,
    },
    llvmTriple: 'wasm32-unknown-wasi',
    target: 'wasip1',
  }), /frontend compile unit program package did not match real TinyGo driver bridge/)
})

test('normalizeTinyGoDriverBridgeManifestForBrowser rewrites host paths into browser workspace vocabulary', () => {
  const verification = normalizeTinyGoDriverBridgeManifestForBrowser({
    artifactOutputPath: '/tmp/bridge/out.wasm',
    entryFile: '/tmp/bridge/main.go',
    entryPackage: {
      dir: '/tmp/bridge',
      goFiles: ['main.go'],
      importPath: 'example.com/app',
      imports: ['example.com/app/helper'],
      name: 'main',
    },
    llvmTriple: 'wasm32-unknown-wasi',
    packageGraph: [
      {
        dir: '/tmp/bridge',
        goFiles: ['main.go'],
        importPath: 'example.com/app',
        imports: ['example.com/app/helper'],
        name: 'main',
      },
      {
        dir: '/tmp/bridge/helper',
        goFiles: ['helper.go'],
        importPath: 'example.com/app/helper',
        imports: ['fmt'],
        name: 'helper',
      },
      {
        dir: '/tmp/tinygo-root/src/fmt',
        goFiles: ['print.go'],
        importPath: 'fmt',
        imports: ['errors'],
        name: 'fmt',
        standard: true,
      },
    ],
    frontendAnalysisInput: {
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'asyncify',
        buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      modulePath: 'example.com/app',
      optimizeFlag: '-Oz',
      entryFile: '/tmp/bridge/main.go',
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        artifactOutputPath: '/tmp/bridge/out.wasm',
      },
      sourceSelection: {
        program: ['/tmp/bridge/main.go'],
        allCompile: [
          '/tmp/bridge/helper/helper.go',
          '/tmp/bridge/main.go',
          '/tmp/tinygo-root/src/fmt/print.go',
        ],
      },
      packageGraph: [
        {
          depOnly: false,
          dir: '/tmp/bridge',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: ['example.com/app/helper'],
          modulePath: 'example.com/app',
          name: 'main',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/tmp/bridge/helper',
          files: { goFiles: ['helper.go'] },
          importPath: 'example.com/app/helper',
          imports: ['fmt'],
          modulePath: 'example.com/app',
          name: 'helper',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/tmp/tinygo-root/src/fmt',
          files: { goFiles: ['print.go'] },
          importPath: 'fmt',
          imports: ['errors'],
          modulePath: '',
          name: 'fmt',
          standard: true,
        },
      ],
    },
    frontendAnalysis: {
      entryFile: '/tmp/bridge/main.go',
      compileUnitManifestPath: '/tmp/bridge/tinygo-compile-unit.json',
      allCompileFiles: [
        '/tmp/bridge/helper/helper.go',
        '/tmp/bridge/main.go',
        '/tmp/tinygo-root/src/fmt/print.go',
      ],
      compileGroups: [
        {
          name: 'program',
          files: ['/tmp/bridge/main.go'],
        },
        {
          name: 'all-compile',
          files: [
            '/tmp/bridge/helper/helper.go',
            '/tmp/bridge/main.go',
            '/tmp/tinygo-root/src/fmt/print.go',
          ],
        },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          packageName: 'main',
          packageDir: '/tmp/bridge',
          files: ['/tmp/bridge/main.go'],
        },
        {
          kind: 'imported',
          importPath: 'example.com/app/helper',
          packageName: 'helper',
          packageDir: '/tmp/bridge/helper',
          files: ['/tmp/bridge/helper/helper.go'],
        },
        {
          kind: 'stdlib',
          importPath: 'fmt',
          packageName: 'fmt',
          packageDir: '/tmp/tinygo-root/src/fmt',
          files: ['/tmp/tinygo-root/src/fmt/print.go'],
        },
      ],
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
      },
    },
    frontendRealAdapter: {
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'asyncify',
        buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      entryFile: '/tmp/bridge/main.go',
      compileUnitManifestPath: '/tmp/bridge/tinygo-compile-unit.json',
      allCompileFiles: [
        '/tmp/bridge/helper/helper.go',
        '/tmp/bridge/main.go',
        '/tmp/tinygo-root/src/fmt/print.go',
      ],
      compileGroups: [
        {
          name: 'program',
          files: ['/tmp/bridge/main.go'],
        },
        {
          name: 'all-compile',
          files: [
            '/tmp/bridge/helper/helper.go',
            '/tmp/bridge/main.go',
            '/tmp/tinygo-root/src/fmt/print.go',
          ],
        },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          packageName: 'main',
          packageDir: '/tmp/bridge',
          files: ['/tmp/bridge/main.go'],
        },
        {
          kind: 'imported',
          importPath: 'example.com/app/helper',
          packageName: 'helper',
          packageDir: '/tmp/bridge/helper',
          files: ['/tmp/bridge/helper/helper.go'],
        },
        {
          kind: 'stdlib',
          importPath: 'fmt',
          packageName: 'fmt',
          packageDir: '/tmp/tinygo-root/src/fmt',
          files: ['/tmp/tinygo-root/src/fmt/print.go'],
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: '/tmp/bridge',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: ['example.com/app/helper'],
          name: 'main',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/tmp/bridge/helper',
          files: { goFiles: ['helper.go'] },
          importPath: 'example.com/app/helper',
          imports: ['fmt'],
          name: 'helper',
          standard: false,
        },
        {
          depOnly: true,
          dir: '/tmp/tinygo-root/src/fmt',
          files: { goFiles: ['print.go'] },
          importPath: 'fmt',
          imports: ['errors'],
          name: 'fmt',
          standard: true,
        },
      ],
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
      },
    },
    target: 'wasm',
    toolchain: {
      rootPath: '/tmp/tinygo-root',
      version: 'tinygo version 0.40.1',
    },
  })

  assert.equal(verification.artifactOutputPath, '/working/out.wasm')
  assert.equal(verification.entryFile, '/workspace/main.go')
  assert.deepEqual(verification.entryPackage, {
    dir: '/workspace',
    goFiles: ['main.go'],
    importPath: 'example.com/app',
    imports: ['example.com/app/helper'],
    name: 'main',
  })
  assert.deepEqual(verification.packageGraph, [
    {
      dir: '/workspace',
      goFiles: ['main.go'],
      importPath: 'example.com/app',
      imports: ['example.com/app/helper'],
      name: 'main',
    },
    {
      dir: '/workspace/helper',
      goFiles: ['helper.go'],
      importPath: 'example.com/app/helper',
      imports: ['fmt'],
      name: 'helper',
    },
    {
      dir: '/working/.tinygo-root/src/fmt',
      goFiles: ['print.go'],
      importPath: 'fmt',
      imports: ['errors'],
      name: 'fmt',
      standard: true,
    },
  ])
  assert.deepEqual(verification.toolchain, {
    rootPath: '/working/.tinygo-root',
    version: 'tinygo version 0.40.1',
  })
  assert.deepEqual(verification.frontendAnalysisInput, {
    buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    modulePath: 'example.com/app',
    optimizeFlag: '-Oz',
    entryFile: '/workspace/main.go',
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      program: ['/workspace/main.go'],
      allCompile: [
        '/workspace/helper/helper.go',
        '/workspace/main.go',
        '/working/.tinygo-root/src/fmt/print.go',
      ],
    },
    packageGraph: [
      {
        depOnly: false,
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'example.com/app',
        imports: ['example.com/app/helper'],
        modulePath: 'example.com/app',
        name: 'main',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/workspace/helper',
        files: { goFiles: ['helper.go'] },
        importPath: 'example.com/app/helper',
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
        imports: ['errors'],
        modulePath: '',
        name: 'fmt',
        standard: true,
      },
    ],
  })
  assert.deepEqual(verification.frontendAnalysis, {
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    allCompileFiles: [
      '/workspace/helper/helper.go',
      '/workspace/main.go',
      '/working/.tinygo-root/src/fmt/print.go',
    ],
    compileGroups: [
      {
        name: 'program',
        files: ['/workspace/main.go'],
      },
      {
        name: 'all-compile',
        files: [
          '/workspace/helper/helper.go',
          '/workspace/main.go',
          '/working/.tinygo-root/src/fmt/print.go',
        ],
      },
    ],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
      {
        kind: 'imported',
        importPath: 'example.com/app/helper',
        packageName: 'helper',
        packageDir: '/workspace/helper',
        files: ['/workspace/helper/helper.go'],
      },
      {
        kind: 'stdlib',
        importPath: 'fmt',
        packageName: 'fmt',
        packageDir: '/working/.tinygo-root/src/fmt',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
      },
    ],
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
    },
  })
  assert.deepEqual(verification.frontendRealAdapter, {
    buildContext: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      goos: 'js',
      goarch: 'wasm',
      gc: 'precise',
      scheduler: 'asyncify',
      buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
      modulePath: 'example.com/app',
    },
    entryFile: '/workspace/main.go',
    compileUnitManifestPath: '/working/tinygo-compile-unit.json',
    allCompileFiles: [
      '/workspace/helper/helper.go',
      '/workspace/main.go',
      '/working/.tinygo-root/src/fmt/print.go',
    ],
    compileGroups: [
      {
        name: 'program',
        files: ['/workspace/main.go'],
      },
      {
        name: 'all-compile',
        files: [
          '/workspace/helper/helper.go',
          '/workspace/main.go',
          '/working/.tinygo-root/src/fmt/print.go',
        ],
      },
    ],
    compileUnits: [
      {
        kind: 'program',
        importPath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
      },
      {
        kind: 'imported',
        importPath: 'example.com/app/helper',
        packageName: 'helper',
        packageDir: '/workspace/helper',
        files: ['/workspace/helper/helper.go'],
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
        dir: '/workspace',
        files: { goFiles: ['main.go'] },
        importPath: 'example.com/app',
        imports: ['example.com/app/helper'],
        name: 'main',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/workspace/helper',
        files: { goFiles: ['helper.go'] },
        importPath: 'example.com/app/helper',
        imports: ['fmt'],
        name: 'helper',
        standard: false,
      },
      {
        depOnly: true,
        dir: '/working/.tinygo-root/src/fmt',
        files: { goFiles: ['print.go'] },
        importPath: 'fmt',
        imports: ['errors'],
        name: 'fmt',
        standard: true,
      },
    ],
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
    },
  })
  assert.deepEqual(verification.realFrontendAnalysis, verification.frontendRealAdapter)
})

test('normalizeTinyGoDriverBridgeManifestForBrowser rejects divergent realFrontendAnalysis aliases when frontendRealAdapter is present', () => {
  assert.throws(() => normalizeTinyGoDriverBridgeManifestForBrowser({
    artifactOutputPath: '/tmp/bridge/out.wasm',
    entryFile: '/tmp/bridge/main.go',
    frontendRealAdapter: {
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'asyncify',
        buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      entryFile: '/tmp/bridge/main.go',
      compileUnitManifestPath: '/tmp/bridge/tinygo-compile-unit.json',
      allCompileFiles: ['/tmp/bridge/main.go'],
      compileGroups: [
        {
          name: 'program',
          files: ['/tmp/bridge/main.go'],
        },
        {
          name: 'all-compile',
          files: ['/tmp/bridge/main.go'],
        },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          packageName: 'main',
          packageDir: '/tmp/bridge',
          files: ['/tmp/bridge/main.go'],
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: '/tmp/bridge',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: [],
          name: 'main',
          standard: false,
        },
      ],
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
      },
    },
    realFrontendAnalysis: {
      buildContext: {
        target: 'wasip1',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'wasip1',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'tasks',
        buildTags: ['gc.precise', 'scheduler.tasks', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      entryFile: '/tmp/bridge/main.go',
      compileUnitManifestPath: '/tmp/bridge/tinygo-compile-unit.json',
      allCompileFiles: ['/tmp/bridge/main.go'],
      compileGroups: [
        {
          name: 'program',
          files: ['/tmp/bridge/main.go'],
        },
        {
          name: 'all-compile',
          files: ['/tmp/bridge/main.go'],
        },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          packageName: 'main',
          packageDir: '/tmp/bridge',
          files: ['/tmp/bridge/main.go'],
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: '/tmp/bridge',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: [],
          name: 'main',
          standard: false,
        },
      ],
      toolchain: {
        target: 'wasip1',
        llvmTarget: 'wasm32-unknown-wasi',
      },
    },
    target: 'wasm',
    toolchain: {
      rootPath: '/tmp/tinygo-root',
      version: 'tinygo version 0.40.1',
    },
  }), /frontendRealAdapter did not match realFrontendAnalysis alias/)
})

test('normalizeTinyGoDriverBridgeManifestForBrowser promotes alias-only realFrontendAnalysis input into frontendRealAdapter', () => {
  const verification = normalizeTinyGoDriverBridgeManifestForBrowser({
    artifactOutputPath: '/tmp/bridge/out.wasm',
    entryFile: '/tmp/bridge/main.go',
    realFrontendAnalysis: {
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'asyncify',
        buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      entryFile: '/tmp/bridge/main.go',
      compileUnitManifestPath: '/tmp/bridge/tinygo-compile-unit.json',
      allCompileFiles: ['/tmp/bridge/main.go'],
      compileGroups: [
        {
          name: 'program',
          files: ['/tmp/bridge/main.go'],
        },
        {
          name: 'all-compile',
          files: ['/tmp/bridge/main.go'],
        },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          packageName: 'main',
          packageDir: '/tmp/bridge',
          files: ['/tmp/bridge/main.go'],
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: '/tmp/bridge',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: [],
          name: 'main',
          standard: false,
        },
      ],
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
      },
    },
    target: 'wasm',
    toolchain: {
      rootPath: '/tmp/tinygo-root',
      version: 'tinygo version 0.40.1',
    },
  })

  assert.deepEqual(verification.frontendRealAdapter, verification.realFrontendAnalysis)
  assert.equal(verification.frontendRealAdapter?.entryFile, '/workspace/main.go')
  assert.equal(verification.frontendRealAdapter?.compileUnitManifestPath, '/working/tinygo-compile-unit.json')
})

test('normalizeTinyGoDriverBridgeManifestForBrowser rewrites frontendAnalysis toolchain output paths for browser workdirs', () => {
  const verification = normalizeTinyGoDriverBridgeManifestForBrowser({
    artifactOutputPath: '/tmp/bridge/out.wasm',
    entryFile: '/tmp/bridge/main.go',
    frontendAnalysis: {
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'asyncify',
        buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      entryFile: '/tmp/bridge/main.go',
      compileUnitManifestPath: '/tmp/bridge/tinygo-compile-unit.json',
      allCompileFiles: ['/tmp/bridge/main.go'],
      compileGroups: [
        {
          name: 'program',
          files: ['/tmp/bridge/main.go'],
        },
        {
          name: 'all-compile',
          files: ['/tmp/bridge/main.go'],
        },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          packageName: 'main',
          packageDir: '/tmp/bridge',
          files: ['/tmp/bridge/main.go'],
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: '/tmp/bridge',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: [],
          name: 'main',
          standard: false,
        },
      ],
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        linker: 'wasm-ld',
        cflags: ['-mbulk-memory'],
        ldflags: ['--stack-first', '--no-entry'],
        translationUnitPath: '/tmp/bridge/tinygo-bootstrap.c',
        objectOutputPath: '/tmp/bridge/tinygo-bootstrap.o',
        artifactOutputPath: '/tmp/bridge/out.wasm',
      },
    },
    target: 'wasm',
    toolchain: {
      rootPath: '/tmp/tinygo-root',
      version: 'tinygo version 0.40.1',
    },
  })

  assert.deepEqual(verification.frontendAnalysis?.toolchain, {
    target: 'wasm',
    llvmTarget: 'wasm32-unknown-wasi',
    linker: 'wasm-ld',
    cflags: ['-mbulk-memory'],
    ldflags: ['--stack-first', '--no-entry'],
    translationUnitPath: '/working/tinygo-bootstrap.c',
    objectOutputPath: '/working/tinygo-bootstrap.o',
    artifactOutputPath: '/working/out.wasm',
  })
})

test('normalizeTinyGoDriverBridgeManifestForBrowser rewrites frontendRealAdapter toolchain output paths for browser workdirs', () => {
  const verification = normalizeTinyGoDriverBridgeManifestForBrowser({
    artifactOutputPath: '/tmp/bridge/out.wasm',
    entryFile: '/tmp/bridge/main.go',
    frontendRealAdapter: {
      optimizeFlag: '-Oz',
      buildContext: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        goos: 'js',
        goarch: 'wasm',
        gc: 'precise',
        scheduler: 'asyncify',
        buildTags: ['gc.precise', 'scheduler.asyncify', 'tinygo.wasm'],
        modulePath: 'example.com/app',
      },
      entryFile: '/tmp/bridge/main.go',
      compileUnitManifestPath: '/tmp/bridge/tinygo-compile-unit.json',
      allCompileFiles: ['/tmp/bridge/main.go'],
      compileGroups: [
        {
          name: 'program',
          files: ['/tmp/bridge/main.go'],
        },
        {
          name: 'all-compile',
          files: ['/tmp/bridge/main.go'],
        },
      ],
      compileUnits: [
        {
          kind: 'program',
          importPath: 'example.com/app',
          packageName: 'main',
          packageDir: '/tmp/bridge',
          files: ['/tmp/bridge/main.go'],
        },
      ],
      packageGraph: [
        {
          depOnly: false,
          dir: '/tmp/bridge',
          files: { goFiles: ['main.go'] },
          importPath: 'example.com/app',
          imports: [],
          name: 'main',
          standard: false,
        },
      ],
      toolchain: {
        target: 'wasm',
        llvmTarget: 'wasm32-unknown-wasi',
        linker: 'wasm-ld',
        cflags: ['-mbulk-memory'],
        ldflags: ['--stack-first', '--no-entry'],
        translationUnitPath: '/tmp/bridge/tinygo-bootstrap.c',
        objectOutputPath: '/tmp/bridge/tinygo-bootstrap.o',
        artifactOutputPath: '/tmp/bridge/out.wasm',
      },
    },
    target: 'wasm',
    toolchain: {
      rootPath: '/tmp/tinygo-root',
      version: 'tinygo version 0.40.1',
    },
  })

  assert.equal(verification.frontendRealAdapter?.optimizeFlag, '-Oz')
  assert.deepEqual(verification.frontendRealAdapter?.toolchain, {
    target: 'wasm',
    llvmTarget: 'wasm32-unknown-wasi',
    linker: 'wasm-ld',
    cflags: ['-mbulk-memory'],
    ldflags: ['--stack-first', '--no-entry'],
    translationUnitPath: '/working/tinygo-bootstrap.c',
    objectOutputPath: '/working/tinygo-bootstrap.o',
    artifactOutputPath: '/working/out.wasm',
  })
})

test('verifyIntermediateManifestAgainstCompileUnitManifest accepts a resolved intermediate manifest', () => {
  const verification = verifyIntermediateManifestAgainstCompileUnitManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    materializedFiles: [
      '/working/.tinygo-root/src/device/arm/arm.go',
      '/working/.tinygo-root/src/fmt/print.go',
      '/working/.tinygo-root/src/runtime/runtime.go',
      '/working/.tinygo-root/targets/wasm.json',
      '/working/tinygo-bootstrap.c',
      '/working/tinygo-compile-unit.json',
    ],
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
    compileUnits: [
      { kind: 'program', importPath: 'command-line-arguments', modulePath: '', packageName: 'main', packageDir: '/workspace', files: ['/workspace/main.go'] },
      { kind: 'imported', importPath: 'example.com/app/lib', modulePath: '', packageName: 'helper', packageDir: '/workspace/lib', files: ['/workspace/lib/helper.go'] },
      { kind: 'stdlib', importPath: 'fmt', modulePath: '', packageName: 'fmt', packageDir: '/working/.tinygo-root/src/fmt', files: ['/working/.tinygo-root/src/fmt/print.go'] },
    ],
    sourceSelection: {
      allCompile: [
        '/working/.tinygo-root/src/fmt/print.go',
        '/workspace/lib/helper.go',
        '/workspace/main.go',
      ],
    },
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      linker: 'wasm-ld',
      cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
      ldflags: ['--stack-first', '--no-demangle'],
      translationUnitPath: '/working/tinygo-bootstrap.c',
      objectOutputPath: '/working/tinygo-bootstrap.o',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      targetAssets: ['/working/.tinygo-root/targets/wasm.json'],
      runtimeSupport: ['/working/.tinygo-root/src/device/arm/arm.go', '/working/.tinygo-root/src/runtime/runtime.go'],
      program: ['/workspace/main.go'],
      imported: ['/workspace/lib/helper.go'],
      stdlib: ['/working/.tinygo-root/src/fmt/print.go'],
      allCompile: [
        '/working/.tinygo-root/src/fmt/print.go',
        '/workspace/lib/helper.go',
        '/workspace/main.go',
      ],
    },
    compileUnits: [
      { kind: 'program', importPath: 'command-line-arguments', modulePath: '', packageName: 'main', packageDir: '/workspace', files: ['/workspace/main.go'] },
      { kind: 'imported', importPath: 'example.com/app/lib', modulePath: '', packageName: 'helper', packageDir: '/workspace/lib', files: ['/workspace/lib/helper.go'] },
      { kind: 'stdlib', importPath: 'fmt', modulePath: '', packageName: 'fmt', packageDir: '/working/.tinygo-root/src/fmt', files: ['/working/.tinygo-root/src/fmt/print.go'] },
    ],
  })

  assert.equal(verification.toolchain.target, 'wasm')
  assert.equal(verification.sourceSelection.program.length, 1)
  assert.equal(verification.sourceSelection.imported.length, 1)
  assert.equal(verification.sourceSelection.stdlib.length, 1)
  assert.deepEqual(verification.compileUnits, [
    { kind: 'program', importPath: 'command-line-arguments', modulePath: '', packageName: 'main', packageDir: '/workspace', files: ['/workspace/main.go'] },
    { kind: 'imported', importPath: 'example.com/app/lib', modulePath: '', packageName: 'helper', packageDir: '/workspace/lib', files: ['/workspace/lib/helper.go'] },
    { kind: 'stdlib', importPath: 'fmt', modulePath: '', packageName: 'fmt', packageDir: '/working/.tinygo-root/src/fmt', files: ['/working/.tinygo-root/src/fmt/print.go'] },
  ])
})

test('verifyIntermediateManifestAgainstCompileUnitManifest rejects mismatched intermediate toolchain', () => {
  assert.throws(() => verifyIntermediateManifestAgainstCompileUnitManifest({
    entryFile: '/workspace/main.go',
    materializedFiles: [
      '/working/.tinygo-root/targets/wasm.json',
      '/working/tinygo-bootstrap.c',
      '/working/tinygo-compile-unit.json',
    ],
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      allCompile: ['/workspace/main.go'],
    },
  }, {
    entryFile: '/workspace/main.go',
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      linker: 'clang',
      cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
      ldflags: ['--stack-first', '--no-demangle'],
      translationUnitPath: '/working/tinygo-bootstrap.c',
      objectOutputPath: '/working/tinygo-bootstrap.o',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      targetAssets: ['/working/.tinygo-root/targets/wasm.json'],
      runtimeSupport: [],
      program: ['/workspace/main.go'],
      imported: [],
      stdlib: [],
      allCompile: ['/workspace/main.go'],
    },
    compileUnits: [
      { kind: 'program', packageDir: '/workspace/lib', files: ['/workspace/main.go'] },
    ],
  }), /frontend intermediate toolchain did not match compile unit manifest/)
})

test('verifyIntermediateManifestAgainstCompileUnitManifest rejects mismatched intermediate compile units', () => {
  assert.throws(() => verifyIntermediateManifestAgainstCompileUnitManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    materializedFiles: [
      '/working/.tinygo-root/src/device/arm/arm.go',
      '/working/.tinygo-root/src/fmt/print.go',
      '/working/.tinygo-root/src/runtime/runtime.go',
      '/working/.tinygo-root/targets/wasm.json',
      '/working/tinygo-bootstrap.c',
      '/working/tinygo-compile-unit.json',
    ],
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      allCompile: [
        '/working/.tinygo-root/src/fmt/print.go',
        '/workspace/lib/helper.go',
        '/workspace/main.go',
      ],
    },
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      linker: 'wasm-ld',
      cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
      ldflags: ['--stack-first', '--no-demangle'],
      translationUnitPath: '/working/tinygo-bootstrap.c',
      objectOutputPath: '/working/tinygo-bootstrap.o',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      targetAssets: ['/working/.tinygo-root/targets/wasm.json'],
      runtimeSupport: ['/working/.tinygo-root/src/device/arm/arm.go', '/working/.tinygo-root/src/runtime/runtime.go'],
      program: ['/workspace/main.go'],
      imported: ['/workspace/lib/helper.go'],
      stdlib: ['/working/.tinygo-root/src/fmt/print.go'],
      allCompile: [
        '/working/.tinygo-root/src/fmt/print.go',
        '/workspace/lib/helper.go',
        '/workspace/main.go',
      ],
    },
    compileUnits: [
      { kind: 'program', packageDir: '/workspace', files: ['/workspace/main.go'] },
      { kind: 'imported', packageDir: '/workspace/lib', files: ['/workspace/lib/helper.go'] },
      { kind: 'stdlib', packageDir: '/working/.tinygo-root/src/unsafe', files: ['/working/.tinygo-root/src/fmt/print.go'] },
    ],
  }), /frontend intermediate compile units did not match compile unit manifest/)
})

test('verifyLoweringManifestAgainstIntermediateManifest accepts a normalized lowering manifest', () => {
  const verification = verifyLoweringManifestAgainstIntermediateManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      linker: 'wasm-ld',
      cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
      ldflags: ['--stack-first', '--no-demangle'],
      translationUnitPath: '/working/tinygo-bootstrap.c',
      objectOutputPath: '/working/tinygo-bootstrap.o',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      targetAssets: ['/working/.tinygo-root/targets/wasm.json'],
      runtimeSupport: ['/working/.tinygo-root/src/device/arm/arm.go', '/working/.tinygo-root/src/runtime/runtime.go'],
      program: ['/workspace/main.go'],
      imported: ['/workspace/lib/helper.go'],
      stdlib: ['/working/.tinygo-root/src/fmt/print.go'],
      allCompile: [
        '/working/.tinygo-root/src/fmt/print.go',
        '/workspace/lib/helper.go',
        '/workspace/main.go',
      ],
    },
    compileUnits: [
      { kind: 'program', importPath: 'command-line-arguments', packageName: 'main', packageDir: '/workspace', files: ['/workspace/main.go'] },
      { kind: 'imported', importPath: 'example.com/app/lib', packageName: 'helper', packageDir: '/workspace/lib', files: ['/workspace/lib/helper.go'] },
      { kind: 'stdlib', importPath: 'fmt', packageName: 'fmt', packageDir: '/working/.tinygo-root/src/fmt', files: ['/working/.tinygo-root/src/fmt/print.go'] },
    ],
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      linker: 'wasm-ld',
      cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
      ldflags: ['--stack-first', '--no-demangle'],
      translationUnitPath: '/working/tinygo-bootstrap.c',
      objectOutputPath: '/working/tinygo-bootstrap.o',
      artifactOutputPath: '/working/out.wasm',
    },
    support: {
      targetAssets: ['/working/.tinygo-root/targets/wasm.json'],
      runtimeSupport: ['/working/.tinygo-root/src/device/arm/arm.go', '/working/.tinygo-root/src/runtime/runtime.go'],
    },
    compileUnits: [
      { kind: 'program', importPath: 'command-line-arguments', packageName: 'main', packageDir: '/workspace', files: ['/workspace/main.go'] },
      { kind: 'imported', importPath: 'example.com/app/lib', packageName: 'helper', packageDir: '/workspace/lib', files: ['/workspace/lib/helper.go'] },
      { kind: 'stdlib', importPath: 'fmt', packageName: 'fmt', packageDir: '/working/.tinygo-root/src/fmt', files: ['/working/.tinygo-root/src/fmt/print.go'] },
    ],
  })

  assert.deepEqual(verification.support, {
    targetAssets: ['/working/.tinygo-root/targets/wasm.json'],
    runtimeSupport: ['/working/.tinygo-root/src/device/arm/arm.go', '/working/.tinygo-root/src/runtime/runtime.go'],
  })
  assert.equal(verification.compileUnits.length, 3)
})

test('verifyLoweringManifestAgainstIntermediateManifest rejects mismatched compile units', () => {
  assert.throws(() => verifyLoweringManifestAgainstIntermediateManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      linker: 'wasm-ld',
      cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
      ldflags: ['--stack-first', '--no-demangle'],
      translationUnitPath: '/working/tinygo-bootstrap.c',
      objectOutputPath: '/working/tinygo-bootstrap.o',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      targetAssets: ['/working/.tinygo-root/targets/wasm.json'],
      runtimeSupport: ['/working/.tinygo-root/src/device/arm/arm.go', '/working/.tinygo-root/src/runtime/runtime.go'],
      program: ['/workspace/main.go'],
      imported: ['/workspace/lib/helper.go'],
      stdlib: ['/working/.tinygo-root/src/fmt/print.go'],
      allCompile: [
        '/working/.tinygo-root/src/fmt/print.go',
        '/workspace/lib/helper.go',
        '/workspace/main.go',
      ],
    },
    compileUnits: [
      { kind: 'program', importPath: 'command-line-arguments', packageName: 'main', packageDir: '/workspace', files: ['/workspace/main.go'] },
      { kind: 'imported', importPath: 'example.com/app/lib', packageName: 'helper', packageDir: '/workspace/lib', files: ['/workspace/lib/helper.go'] },
      { kind: 'stdlib', importPath: 'fmt', packageName: 'fmt', packageDir: '/working/.tinygo-root/src/fmt', files: ['/working/.tinygo-root/src/fmt/print.go'] },
    ],
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      linker: 'wasm-ld',
      cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
      ldflags: ['--stack-first', '--no-demangle'],
      translationUnitPath: '/working/tinygo-bootstrap.c',
      objectOutputPath: '/working/tinygo-bootstrap.o',
      artifactOutputPath: '/working/out.wasm',
    },
    support: {
      targetAssets: ['/working/.tinygo-root/targets/wasm.json'],
      runtimeSupport: ['/working/.tinygo-root/src/device/arm/arm.go', '/working/.tinygo-root/src/runtime/runtime.go'],
    },
    compileUnits: [
      { kind: 'program', packageDir: '/workspace/lib', files: ['/workspace/main.go'] },
    ],
  }), /frontend lowering compile units did not match intermediate manifest/)
})

test('verifyWorkItemsManifestAgainstLoweringManifest accepts a normalized work-item graph', () => {
  const verification = verifyWorkItemsManifestAgainstLoweringManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      linker: 'wasm-ld',
      cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
      ldflags: ['--stack-first', '--no-demangle'],
      translationUnitPath: '/working/tinygo-bootstrap.c',
      objectOutputPath: '/working/tinygo-bootstrap.o',
      artifactOutputPath: '/working/out.wasm',
    },
    support: {
      targetAssets: ['/working/.tinygo-root/targets/wasm.json'],
      runtimeSupport: ['/working/.tinygo-root/src/device/arm/arm.go', '/working/.tinygo-root/src/runtime/runtime.go'],
    },
    compileUnits: [
      { kind: 'program', importPath: 'command-line-arguments', imports: ['example.com/app/lib'], modulePath: 'example.com/app', depOnly: false, packageName: 'main', packageDir: '/workspace', files: ['/workspace/main.go'], standard: false },
      { kind: 'imported', importPath: 'example.com/app/lib', imports: ['fmt'], modulePath: 'example.com/app', depOnly: true, packageName: 'helper', packageDir: '/workspace/lib', files: ['/workspace/lib/helper.go'], standard: false },
      { kind: 'stdlib', importPath: 'fmt', imports: ['errors', 'io'], modulePath: '', depOnly: true, packageName: 'fmt', packageDir: '/working/.tinygo-root/src/fmt', files: ['/working/.tinygo-root/src/fmt/print.go'], standard: true },
    ],
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      linker: 'wasm-ld',
      cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
      ldflags: ['--stack-first', '--no-demangle'],
      translationUnitPath: '/working/tinygo-bootstrap.c',
      objectOutputPath: '/working/tinygo-bootstrap.o',
      artifactOutputPath: '/working/out.wasm',
    },
    workItems: [
      { id: 'program-000', kind: 'program', importPath: 'command-line-arguments', imports: ['example.com/app/lib'], modulePath: 'example.com/app', depOnly: false, packageName: 'main', packageDir: '/workspace', files: ['/workspace/main.go'], bitcodeOutputPath: '/working/tinygo-work/program-000.bc', standard: false },
      { id: 'imported-000', kind: 'imported', importPath: 'example.com/app/lib', imports: ['fmt'], modulePath: 'example.com/app', depOnly: true, packageName: 'helper', packageDir: '/workspace/lib', files: ['/workspace/lib/helper.go'], bitcodeOutputPath: '/working/tinygo-work/imported-000.bc', standard: false },
      { id: 'stdlib-000', kind: 'stdlib', importPath: 'fmt', imports: ['errors', 'io'], modulePath: '', depOnly: true, packageName: 'fmt', packageDir: '/working/.tinygo-root/src/fmt', files: ['/working/.tinygo-root/src/fmt/print.go'], bitcodeOutputPath: '/working/tinygo-work/stdlib-000.bc', standard: true },
    ],
  })

  assert.equal(verification.workItems.length, 3)
  assert.equal(verification.workItems[0]?.bitcodeOutputPath, '/working/tinygo-work/program-000.bc')
  assert.equal(verification.workItems[0]?.modulePath, 'example.com/app')
  assert.deepEqual(verification.toolchain.ldflags, ['--stack-first', '--no-demangle'])
})

test('verifyWorkItemsManifestAgainstLoweringManifest rejects mismatched work-item graphs', () => {
  assert.throws(() => verifyWorkItemsManifestAgainstLoweringManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      linker: 'wasm-ld',
      cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
      ldflags: ['--stack-first', '--no-demangle'],
      translationUnitPath: '/working/tinygo-bootstrap.c',
      objectOutputPath: '/working/tinygo-bootstrap.o',
      artifactOutputPath: '/working/out.wasm',
    },
    support: {
      targetAssets: ['/working/.tinygo-root/targets/wasm.json'],
      runtimeSupport: ['/working/.tinygo-root/src/device/arm/arm.go', '/working/.tinygo-root/src/runtime/runtime.go'],
    },
    compileUnits: [
      { kind: 'program', importPath: 'command-line-arguments', imports: ['example.com/app/lib'], depOnly: false, packageName: 'main', packageDir: '/workspace', files: ['/workspace/main.go'], standard: false },
      { kind: 'imported', importPath: 'example.com/app/lib', imports: ['fmt'], depOnly: true, packageName: 'helper', packageDir: '/workspace/lib', files: ['/workspace/lib/helper.go'], standard: false },
    ],
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      linker: 'wasm-ld',
      cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
      ldflags: ['--stack-first', '--no-demangle'],
      translationUnitPath: '/working/tinygo-bootstrap.c',
      objectOutputPath: '/working/tinygo-bootstrap.o',
      artifactOutputPath: '/working/out.wasm',
    },
    workItems: [
      { id: 'program-000', kind: 'program', importPath: 'command-line-arguments', imports: ['example.com/app/lib'], depOnly: false, packageName: 'main', packageDir: '/workspace', files: ['/workspace/main.go'], bitcodeOutputPath: '/working/tinygo-work/program-001.bc', standard: false },
      { id: 'imported-000', kind: 'imported', importPath: 'example.com/app/lib', imports: ['fmt'], depOnly: true, packageName: 'helper', packageDir: '/workspace/lib', files: ['/workspace/lib/helper.go'], bitcodeOutputPath: '/working/tinygo-work/imported-000.bc', standard: false },
    ],
  }), /frontend work items did not match lowering manifest/)
})

test('verifyLoweringPlanAgainstWorkItemsManifest accepts a normalized lowering plan', () => {
  const verification = verifyLoweringPlanAgainstWorkItemsManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      linker: 'wasm-ld',
      cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
      ldflags: ['--stack-first', '--no-demangle'],
      translationUnitPath: '/working/tinygo-bootstrap.c',
      objectOutputPath: '/working/tinygo-bootstrap.o',
      artifactOutputPath: '/working/out.wasm',
    },
    workItems: [
      { id: 'program-000', kind: 'program', importPath: 'command-line-arguments', imports: ['example.com/app/lib'], modulePath: 'example.com/app', depOnly: false, packageName: 'main', packageDir: '/workspace', files: ['/workspace/main.go'], bitcodeOutputPath: '/working/tinygo-work/program-000.bc', standard: false },
      { id: 'imported-000', kind: 'imported', importPath: 'example.com/app/lib', imports: ['fmt'], modulePath: 'example.com/app', depOnly: true, packageName: 'helper', packageDir: '/workspace/lib', files: ['/workspace/lib/helper.go'], bitcodeOutputPath: '/working/tinygo-work/imported-000.bc', standard: false },
      { id: 'stdlib-000', kind: 'stdlib', importPath: 'fmt', imports: ['errors', 'io'], modulePath: '', depOnly: true, packageName: 'fmt', packageDir: '/working/.tinygo-root/src/fmt', files: ['/working/.tinygo-root/src/fmt/print.go'], bitcodeOutputPath: '/working/tinygo-work/stdlib-000.bc', standard: true },
    ],
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    compileJobs: [
      {
        id: 'program-000',
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['example.com/app/lib'],
        modulePath: 'example.com/app',
        depOnly: false,
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
        id: 'imported-000',
        kind: 'imported',
        importPath: 'example.com/app/lib',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        depOnly: true,
        packageName: 'helper',
        packageDir: '/workspace/lib',
        files: ['/workspace/lib/helper.go'],
        bitcodeOutputPath: '/working/tinygo-work/imported-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
        optimizeFlag: '-Oz',
        standard: false,
      },
      {
        id: 'stdlib-000',
        kind: 'stdlib',
        importPath: 'fmt',
        imports: ['errors', 'io'],
        modulePath: '',
        depOnly: true,
        packageName: 'fmt',
        packageDir: '/working/.tinygo-root/src/fmt',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
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
      bitcodeInputs: [
        '/working/tinygo-work/program-000.bc',
        '/working/tinygo-work/imported-000.bc',
        '/working/tinygo-work/stdlib-000.bc',
      ],
    },
    executionLinkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle'],
      artifactOutputPath: '/working/out.wasm',
      bitcodeInputs: [
        '/working/tinygo-work/program-000.bc',
        '/working/tinygo-work/imported-000.bc',
        '/working/tinygo-work/stdlib-000.bc',
      ],
    },
  })

  assert.equal(verification.compileJobs.length, 3)
  assert.equal(verification.linkJob.artifactOutputPath, '/working/out.wasm')
  assert.deepEqual(verification.executionLinkJob?.ldflags, ['--stack-first', '--no-demangle'])
  assert.equal(verification.compileJobs[0]?.modulePath, 'example.com/app')
})

test('verifyLoweringPlanAgainstWorkItemsManifest rejects mismatched compile jobs', () => {
  assert.throws(() => verifyLoweringPlanAgainstWorkItemsManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    toolchain: {
      target: 'wasm',
      llvmTarget: 'wasm32-unknown-wasi',
      linker: 'wasm-ld',
      cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
      ldflags: ['--stack-first', '--no-demangle'],
      translationUnitPath: '/working/tinygo-bootstrap.c',
      objectOutputPath: '/working/tinygo-bootstrap.o',
      artifactOutputPath: '/working/out.wasm',
    },
    workItems: [
      { id: 'program-000', kind: 'program', importPath: 'command-line-arguments', imports: ['example.com/app/lib'], depOnly: false, packageName: 'main', packageDir: '/workspace', files: ['/workspace/main.go'], bitcodeOutputPath: '/working/tinygo-work/program-000.bc', standard: false },
    ],
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    compileJobs: [
      {
        id: 'program-000',
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['example.com/app/lib'],
        depOnly: false,
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-001.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
        optimizeFlag: '-Oz',
        standard: false,
      },
    ],
    linkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle', '--no-entry', '--export-all'],
      artifactOutputPath: '/working/out.wasm',
      bitcodeInputs: ['/working/tinygo-work/program-001.bc'],
    },
  }), /frontend lowering plan compile jobs did not match work items manifest/)
})

test('verifyCommandBatchAgainstLoweringPlanAndLoweredSourcesManifest accepts a normalized command batch', () => {
  const verification = verifyCommandBatchAgainstLoweringPlanAndLoweredSourcesManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    compileJobs: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
        optimizeFlag: '-Oz',
      },
      {
        id: 'stdlib-000',
        kind: 'stdlib',
        packageDir: '/working/.tinygo-root/src/fmt',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
        bitcodeOutputPath: '/working/tinygo-work/stdlib-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
        optimizeFlag: '-Oz',
      },
    ],
    linkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle', '--no-entry', '--export-all'],
      artifactOutputPath: '/working/out.wasm',
      bitcodeInputs: ['/working/tinygo-work/program-000.bc', '/working/tinygo-work/stdlib-000.bc'],
    },
    executionLinkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle'],
      artifactOutputPath: '/working/out.wasm',
      bitcodeInputs: ['/working/tinygo-work/program-000.bc', '/working/tinygo-work/stdlib-000.bc'],
    },
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    units: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-000.c',
      },
      {
        id: 'stdlib-000',
        kind: 'stdlib',
        importPath: 'fmt',
        packageName: 'fmt',
        packageDir: '/working/.tinygo-root/src/fmt',
        sourceFiles: ['/working/.tinygo-root/src/fmt/print.go'],
        loweredSourcePath: '/working/tinygo-lowered/stdlib-000.c',
      },
    ],
  }, {
    compileCommands: [
      {
        argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext', '-emit-llvm', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-work/program-000.bc'],
        cwd: '/working',
      },
      {
        argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext', '-emit-llvm', '-c', '/working/tinygo-lowered/stdlib-000.c', '-o', '/working/tinygo-work/stdlib-000.bc'],
        cwd: '/working',
      },
    ],
    linkCommand: {
      argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '/working/tinygo-work/program-000.bc', '/working/tinygo-work/stdlib-000.bc', '-o', '/working/out.wasm'],
      cwd: '/working',
    },
  })

  assert.equal(verification.compileCommands.length, 2)
  assert.equal(verification.linkCommand.cwd, '/working')
})

test('verifyBackendInputManifestAgainstLoweringPlanAndLoweredSourcesManifest accepts a normalized backend input', () => {
  const verification = verifyBackendInputManifestAgainstLoweringPlanAndLoweredSourcesManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    compileJobs: [
      {
        id: 'program-000',
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        depOnly: false,
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
        optimizeFlag: '-Oz',
        standard: false,
      },
    ],
    linkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle', '--no-entry', '--export-all'],
      artifactOutputPath: '/working/out.wasm',
      bitcodeInputs: ['/working/tinygo-work/program-000.bc'],
    },
    executionLinkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle'],
      artifactOutputPath: '/working/out.wasm',
      bitcodeInputs: ['/working/tinygo-work/program-000.bc'],
    },
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    units: [
      {
        id: 'program-000',
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        depOnly: false,
        packageName: 'main',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-000.c',
        standard: false,
      },
    ],
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    compileJobs: [
      {
        id: 'program-000',
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        depOnly: false,
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
        optimizeFlag: '-Oz',
        standard: false,
      },
    ],
    linkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle', '--no-entry', '--export-all'],
      artifactOutputPath: '/working/out.wasm',
    },
    executionLinkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle'],
      artifactOutputPath: '/working/out.wasm',
    },
  })

  assert.equal(verification.compileJobs.length, 1)
  assert.equal(verification.loweredUnits.length, 1)
  assert.equal(verification.linkJob.artifactOutputPath, '/working/out.wasm')
  assert.deepEqual(verification.executionLinkJob?.ldflags, ['--stack-first', '--no-demangle'])
  assert.equal(verification.loweredUnits[0]?.modulePath, 'example.com/app')
})

test('verifyBackendInputManifestAgainstLoweringPlanAndLoweredSourcesManifest rejects mismatched derived lowered units', () => {
  assert.throws(() => verifyBackendInputManifestAgainstLoweringPlanAndLoweredSourcesManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    compileJobs: [
      {
        id: 'program-000',
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory'],
        optimizeFlag: '-Oz',
      },
    ],
    linkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle', '--no-entry', '--export-all'],
      artifactOutputPath: '/working/out.wasm',
      bitcodeInputs: ['/working/tinygo-work/program-000.bc'],
    },
    executionLinkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle'],
      artifactOutputPath: '/working/out.wasm',
      bitcodeInputs: ['/working/tinygo-work/program-000.bc'],
    },
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    units: [
      {
        id: 'program-001',
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        depOnly: false,
        packageName: 'main',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-001.c',
        standard: false,
      },
    ],
  }, {
    entryFile: '/workspace/main.go',
    compileJobs: [
      {
        id: 'program-000',
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        depOnly: false,
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory'],
        optimizeFlag: '-Oz',
        standard: false,
      },
    ],
    linkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle', '--no-entry', '--export-all'],
      artifactOutputPath: '/working/out.wasm',
    },
    executionLinkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle'],
      artifactOutputPath: '/working/out.wasm',
    },
  }), /frontend backend input did not match lowering plan and lowered sources manifests/)
})

test('verifyCommandBatchAgainstLoweringPlanAndLoweredSourcesManifest rejects mismatched compile commands', () => {
  assert.throws(() => verifyCommandBatchAgainstLoweringPlanAndLoweredSourcesManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    compileJobs: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
        optimizeFlag: '-Oz',
      },
    ],
    linkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle', '--no-entry', '--export-all'],
      artifactOutputPath: '/working/out.wasm',
    },
    executionLinkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle'],
      artifactOutputPath: '/working/out.wasm',
    },
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    units: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-000.c',
      },
    ],
  }, {
    compileCommands: [
      {
        argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-emit-llvm', '-c', '/working/tinygo-lowered/program-001.c', '-o', '/working/tinygo-work/program-001.bc'],
        cwd: '/working',
      },
    ],
    linkCommand: {
      argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '--no-entry', '--export-all', '/working/tinygo-work/program-001.bc', '-o', '/working/out.wasm'],
      cwd: '/working',
    },
  }), /frontend command batch compile commands did not match lowering plan and lowered sources manifests/)
})

test('verifyCommandBatchAgainstBackendInputManifest accepts a normalized backend-owned command batch', () => {
  const verification = verifyCommandBatchAgainstBackendInputManifest({
    entryFile: '/workspace/main.go',
    compileJobs: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
        optimizeFlag: '-Oz',
      },
    ],
    linkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle', '--no-entry', '--export-all'],
      artifactOutputPath: '/working/out.wasm',
    },
    executionLinkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle'],
      artifactOutputPath: '/working/out.wasm',
    },
  }, {
    compileCommands: [
      {
        argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext', '-emit-llvm', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-work/program-000.bc'],
        cwd: '/working',
      },
    ],
    linkCommand: {
      argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '/working/tinygo-work/program-000.bc', '-o', '/working/out.wasm'],
      cwd: '/working',
    },
  })

  assert.equal(verification.compileCommands.length, 1)
  assert.equal(verification.linkCommand.cwd, '/working')
})

test('verifyBackendResultManifestAgainstBackendInputAndLoweredBitcodeManifest accepts a normalized backend result', () => {
  const verification = verifyBackendResultManifestAgainstBackendInputAndLoweredBitcodeManifest({
    entryFile: '/workspace/main.go',
    compileJobs: [
      {
        id: 'program-000',
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory'],
        optimizeFlag: '-Oz',
      },
    ],
    linkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle', '--no-entry', '--export-all'],
      artifactOutputPath: '/working/out.wasm',
    },
    executionLinkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle'],
      artifactOutputPath: '/working/out.wasm',
    },
  }, {
    bitcodeFiles: ['/working/tinygo-work/program-000.bc'],
  }, {
    ok: true,
    generatedFiles: [
      {
        path: '/working/tinygo-lowered-sources.json',
        contents: JSON.stringify({
          entryFile: '/workspace/main.go',
          optimizeFlag: '-Oz',
          units: [
            {
              id: 'program-000',
              kind: 'program',
              importPath: 'command-line-arguments',
              imports: ['fmt'],
              modulePath: 'example.com/app',
              packageName: 'main',
              packageDir: '/workspace',
              sourceFiles: ['/workspace/main.go'],
              loweredSourcePath: '/working/tinygo-lowered/program-000.c',
            },
          ],
        }),
      },
      {
        path: '/working/tinygo-lowered-bitcode.json',
        contents: JSON.stringify({
          bitcodeFiles: ['/working/tinygo-work/program-000.bc'],
        }),
      },
      {
        path: '/working/tinygo-lowered/program-000.c',
        contents: '/* lowered */',
      },
      {
        path: '/working/tinygo-lowered-ir.json',
        contents: JSON.stringify({
          entryFile: '/workspace/main.go',
          optimizeFlag: '-Oz',
          units: [
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
              functions: [
                {
                  name: 'main',
                  exported: false,
                  method: false,
                  main: true,
                  init: false,
                  parameters: 0,
                  results: 0,
                },
              ],
              types: [],
              constants: [],
              variables: [],
              declarations: [
                {
                  kind: 'function',
                  name: 'main',
                  exported: false,
                  method: false,
                },
              ],
              placeholderBlocks: [
                {
                  stage: 'function',
                  index: 0,
                  value: 'function:main:0:0:1:0:0:0',
                  signature: 'main:0:0:1:0:0:0',
                },
                {
                  stage: 'declaration',
                  index: 0,
                  value: 'declaration:function:main:0:0',
                  signature: 'function:main:0:0',
                },
              ],
              loweringBlocks: [
                {
                  stage: 'function',
                  index: 0,
                  value: 'tinygo_lower_unit_begin("program-000", "program", "main", 1);tinygo_lower_function_begin("main", "main");tinygo_emit_function_index(0);tinygo_emit_function_flags(0, 0, 1, 0);tinygo_emit_function_signature(0, 0);tinygo_emit_function_stream("main:0:0:1:0:0:0");tinygo_lower_function_end();tinygo_lower_unit_end()',
                },
                {
                  stage: 'declaration',
                  index: 0,
                  value: 'tinygo_lower_unit_begin("program-000", "program", "main", 1);tinygo_lower_declaration_begin("main", "function", "main");tinygo_emit_declaration_index(0);tinygo_emit_declaration_flags(0, 0);tinygo_emit_declaration_signature("function:main:0:0");tinygo_lower_declaration_end();tinygo_lower_unit_end()',
                },
              ],
            },
          ],
        }),
      },
      {
        path: '/working/tinygo-lowered-command-batch.json',
        contents: JSON.stringify({
          compileCommands: [
            {
              argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-lowered/program-000.o'],
              cwd: '/working',
            },
          ],
          linkCommand: {
            argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '--no-entry', '--export-all', '/working/tinygo-lowered/program-000.o', '-o', '/working/tinygo-lowered-out.wasm'],
            cwd: '/working',
          },
        }),
      },
      {
        path: '/working/tinygo-lowered-artifact.json',
        contents: JSON.stringify({
          artifactOutputPath: '/working/tinygo-lowered-out.wasm',
          objectFiles: ['/working/tinygo-lowered/program-000.o'],
        }),
      },
      {
        path: '/working/tinygo-command-artifact.json',
        contents: JSON.stringify({
          artifactOutputPath: '/working/out.wasm',
          artifactKind: 'execution',
          bitcodeFiles: ['/working/tinygo-work/program-000.bc'],
          entrypoint: 'main',
          runnable: true,
        }),
      },
      {
        path: '/working/tinygo-command-batch.json',
        contents: JSON.stringify({
          compileCommands: [
            {
              argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-emit-llvm', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-work/program-000.bc'],
              cwd: '/working',
            },
          ],
          linkCommand: {
            argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '--no-entry', '--export=main', '/working/tinygo-work/program-000.bc', '-o', '/working/out.wasm'],
            cwd: '/working',
          },
        }),
      },
    ],
  })

  assert.equal(verification.loweredIR.units[0]?.packageName, 'main')
  assert.equal(verification.loweredIR.units[0]?.modulePath, 'example.com/app')
  assert.equal(verification.commandArtifact.artifactOutputPath, '/working/out.wasm')
  assert.equal(verification.commandBatch.compileCommands.length, 1)
  assert.equal(verification.generatedFiles[0]?.path, '/working/tinygo-lowered-sources.json')
  assert.equal(verification.generatedFiles[3]?.path, '/working/tinygo-lowered-ir.json')
  assert.equal(verification.loweredCommandBatch.compileCommands.length, 1)
  assert.equal(verification.loweredArtifact.objectFiles[0], '/working/tinygo-lowered/program-000.o')
})

test('verifyBackendResultManifestAgainstBackendInputAndLoweredBitcodeManifest rejects placeholder blocks without signatures', () => {
  assert.throws(() => verifyBackendResultManifestAgainstBackendInputAndLoweredBitcodeManifest({
    entryFile: '/workspace/main.go',
    compileJobs: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory'],
        optimizeFlag: '-Oz',
      },
    ],
    linkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle', '--no-entry', '--export-all'],
      artifactOutputPath: '/working/out.wasm',
    },
  }, {
    bitcodeFiles: ['/working/tinygo-work/program-000.bc'],
  }, {
    ok: true,
    generatedFiles: [
      {
        path: '/working/tinygo-lowered-sources.json',
        contents: JSON.stringify({
          entryFile: '/workspace/main.go',
          optimizeFlag: '-Oz',
          units: [
            {
              id: 'program-000',
              kind: 'program',
              packageDir: '/workspace',
              sourceFiles: ['/workspace/main.go'],
              loweredSourcePath: '/working/tinygo-lowered/program-000.c',
            },
          ],
        }),
      },
      {
        path: '/working/tinygo-lowered-bitcode.json',
        contents: JSON.stringify({
          bitcodeFiles: ['/working/tinygo-work/program-000.bc'],
        }),
      },
      {
        path: '/working/tinygo-lowered/program-000.c',
        contents: '/* lowered */',
      },
      {
        path: '/working/tinygo-lowered-ir.json',
        contents: JSON.stringify({
          entryFile: '/workspace/main.go',
          optimizeFlag: '-Oz',
          units: [
            {
              id: 'program-000',
              kind: 'program',
              packageDir: '/workspace',
              sourceFiles: ['/workspace/main.go'],
              loweredSourcePath: '/working/tinygo-lowered/program-000.c',
              packageName: 'main',
              imports: [],
              functions: [
                {
                  name: 'main',
                  exported: false,
                  method: false,
                  main: true,
                  init: false,
                  parameters: 0,
                  results: 0,
                },
              ],
              types: [],
              constants: [],
              variables: [],
              declarations: [
                {
                  kind: 'function',
                  name: 'main',
                  exported: false,
                  method: false,
                },
              ],
              placeholderBlocks: [
                {
                  stage: 'function',
                  index: 0,
                  value: 'function:main:0:0:1:0:0:0',
                },
                {
                  stage: 'declaration',
                  index: 0,
                  value: 'declaration:function:main:0:0',
                },
              ],
              loweringBlocks: [
                {
                  stage: 'function',
                  index: 0,
                  value: 'tinygo_lower_unit_begin("program-000", "program", "main", 1);tinygo_lower_function_begin("main", "main");tinygo_emit_function_index(0);tinygo_emit_function_flags(0, 0, 1, 0);tinygo_emit_function_signature(0, 0);tinygo_emit_function_stream("main:0:0:1:0:0:0");tinygo_lower_function_end();tinygo_lower_unit_end()',
                },
                {
                  stage: 'declaration',
                  index: 0,
                  value: 'tinygo_lower_unit_begin("program-000", "program", "main", 1);tinygo_lower_declaration_begin("main", "function", "main");tinygo_emit_declaration_index(0);tinygo_emit_declaration_flags(0, 0);tinygo_emit_declaration_signature("function:main:0:0");tinygo_lower_declaration_end();tinygo_lower_unit_end()',
                },
              ],
            },
          ],
        }),
      },
      {
        path: '/working/tinygo-lowered-command-batch.json',
        contents: JSON.stringify({
          compileCommands: [
            {
              argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-lowered/program-000.o'],
              cwd: '/working',
            },
          ],
          linkCommand: {
            argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '--no-entry', '--export-all', '/working/tinygo-lowered/program-000.o', '-o', '/working/tinygo-lowered-out.wasm'],
            cwd: '/working',
          },
        }),
      },
      {
        path: '/working/tinygo-lowered-artifact.json',
        contents: JSON.stringify({
          artifactOutputPath: '/working/tinygo-lowered-out.wasm',
          objectFiles: ['/working/tinygo-lowered/program-000.o'],
        }),
      },
      {
        path: '/working/tinygo-command-artifact.json',
        contents: JSON.stringify({
          artifactOutputPath: '/working/out.wasm',
          bitcodeFiles: ['/working/tinygo-work/program-000.bc'],
        }),
      },
      {
        path: '/working/tinygo-command-batch.json',
        contents: JSON.stringify({
          compileCommands: [
            {
              argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-emit-llvm', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-work/program-000.bc'],
              cwd: '/working',
            },
          ],
          linkCommand: {
            argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '--no-entry', '--export-all', '/working/tinygo-work/program-000.bc', '-o', '/working/out.wasm'],
            cwd: '/working',
          },
        }),
      },
    ],
  }), /frontend backend result did not match backend input manifest/)
})

test('verifyBackendResultManifestAgainstBackendInputAndLoweredBitcodeManifest rejects lowered IR declarations that do not match symbol summaries', () => {
  assert.throws(() => verifyBackendResultManifestAgainstBackendInputAndLoweredBitcodeManifest({
    entryFile: '/workspace/main.go',
    compileJobs: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory'],
        optimizeFlag: '-Oz',
      },
    ],
    linkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle', '--no-entry', '--export-all'],
      artifactOutputPath: '/working/out.wasm',
    },
  }, {
    bitcodeFiles: ['/working/tinygo-work/program-000.bc'],
  }, {
    ok: true,
    generatedFiles: [
      {
        path: '/working/tinygo-lowered-sources.json',
        contents: JSON.stringify({
          entryFile: '/workspace/main.go',
          optimizeFlag: '-Oz',
          units: [
            {
              id: 'program-000',
              kind: 'program',
              packageDir: '/workspace',
              sourceFiles: ['/workspace/main.go'],
              loweredSourcePath: '/working/tinygo-lowered/program-000.c',
            },
          ],
        }),
      },
      {
        path: '/working/tinygo-lowered-bitcode.json',
        contents: JSON.stringify({
          bitcodeFiles: ['/working/tinygo-work/program-000.bc'],
        }),
      },
      {
        path: '/working/tinygo-lowered/program-000.c',
        contents: '/* lowered */',
      },
      {
        path: '/working/tinygo-lowered-ir.json',
        contents: JSON.stringify({
          entryFile: '/workspace/main.go',
          optimizeFlag: '-Oz',
          units: [
            {
              id: 'program-000',
              kind: 'program',
              packageDir: '/workspace',
              sourceFiles: ['/workspace/main.go'],
              loweredSourcePath: '/working/tinygo-lowered/program-000.c',
              packageName: 'main',
              imports: [],
              functions: [
                {
                  name: 'main',
                  exported: false,
                  method: false,
                  main: true,
                  init: false,
                  parameters: 0,
                  results: 0,
                },
              ],
              types: [],
              constants: [],
              variables: [],
              declarations: [
                {
                  kind: 'function',
                  name: 'helper',
                  exported: false,
                  method: false,
                },
              ],
            },
          ],
        }),
      },
      {
        path: '/working/tinygo-lowered-command-batch.json',
        contents: JSON.stringify({
          compileCommands: [
            {
              argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-lowered/program-000.o'],
              cwd: '/working',
            },
          ],
          linkCommand: {
            argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '--no-entry', '--export-all', '/working/tinygo-lowered/program-000.o', '-o', '/working/tinygo-lowered-out.wasm'],
            cwd: '/working',
          },
        }),
      },
      {
        path: '/working/tinygo-lowered-artifact.json',
        contents: JSON.stringify({
          artifactOutputPath: '/working/tinygo-lowered-out.wasm',
          objectFiles: ['/working/tinygo-lowered/program-000.o'],
        }),
      },
      {
        path: '/working/tinygo-command-artifact.json',
        contents: JSON.stringify({
          artifactOutputPath: '/working/out.wasm',
          bitcodeFiles: ['/working/tinygo-work/program-000.bc'],
        }),
      },
      {
        path: '/working/tinygo-command-batch.json',
        contents: JSON.stringify({
          compileCommands: [
            {
              argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-emit-llvm', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-work/program-000.bc'],
              cwd: '/working',
            },
          ],
          linkCommand: {
            argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '--no-entry', '--export-all', '/working/tinygo-work/program-000.bc', '-o', '/working/out.wasm'],
            cwd: '/working',
          },
        }),
      },
    ],
  }), /frontend backend result did not match backend input manifest/)
})

test('verifyBackendResultManifestAgainstBackendInputAndLoweredBitcodeManifest rejects lowered IR lowering blocks that do not match symbol summaries', () => {
  assert.throws(() => verifyBackendResultManifestAgainstBackendInputAndLoweredBitcodeManifest({
    entryFile: '/workspace/main.go',
    compileJobs: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory'],
        optimizeFlag: '-Oz',
      },
    ],
    linkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle', '--no-entry', '--export-all'],
      artifactOutputPath: '/working/out.wasm',
    },
  }, {
    bitcodeFiles: ['/working/tinygo-work/program-000.bc'],
  }, {
    ok: true,
    generatedFiles: [
      {
        path: '/working/tinygo-lowered-sources.json',
        contents: JSON.stringify({
          entryFile: '/workspace/main.go',
          optimizeFlag: '-Oz',
          units: [
            {
              id: 'program-000',
              kind: 'program',
              packageDir: '/workspace',
              sourceFiles: ['/workspace/main.go'],
              loweredSourcePath: '/working/tinygo-lowered/program-000.c',
            },
          ],
        }),
      },
      {
        path: '/working/tinygo-lowered-bitcode.json',
        contents: JSON.stringify({
          bitcodeFiles: ['/working/tinygo-work/program-000.bc'],
        }),
      },
      {
        path: '/working/tinygo-lowered/program-000.c',
        contents: '/* lowered */',
      },
      {
        path: '/working/tinygo-lowered-ir.json',
        contents: JSON.stringify({
          entryFile: '/workspace/main.go',
          optimizeFlag: '-Oz',
          units: [
            {
              id: 'program-000',
              kind: 'program',
              packageDir: '/workspace',
              sourceFiles: ['/workspace/main.go'],
              loweredSourcePath: '/working/tinygo-lowered/program-000.c',
              packageName: 'main',
              imports: [],
              functions: [
                {
                  name: 'main',
                  exported: false,
                  method: false,
                  main: true,
                  init: false,
                  parameters: 0,
                  results: 0,
                },
              ],
              types: [],
              constants: [],
              variables: [],
              declarations: [
                {
                  kind: 'function',
                  name: 'main',
                  exported: false,
                  method: false,
                },
              ],
              placeholderBlocks: [
                {
                  stage: 'function',
                  index: 0,
                  value: 'function:main:0:0:1:0:0:0',
                  signature: 'main:0:0:1:0:0:0',
                },
                {
                  stage: 'declaration',
                  index: 0,
                  value: 'declaration:function:main:0:0',
                  signature: 'function:main:0:0',
                },
              ],
              loweringBlocks: [],
            },
          ],
        }),
      },
      {
        path: '/working/tinygo-lowered-command-batch.json',
        contents: JSON.stringify({
          compileCommands: [
            {
              argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-lowered/program-000.o'],
              cwd: '/working',
            },
          ],
          linkCommand: {
            argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '--no-entry', '--export-all', '/working/tinygo-lowered/program-000.o', '-o', '/working/tinygo-lowered-out.wasm'],
            cwd: '/working',
          },
        }),
      },
      {
        path: '/working/tinygo-lowered-artifact.json',
        contents: JSON.stringify({
          artifactOutputPath: '/working/tinygo-lowered-out.wasm',
          objectFiles: ['/working/tinygo-lowered/program-000.o'],
        }),
      },
      {
        path: '/working/tinygo-command-artifact.json',
        contents: JSON.stringify({
          artifactOutputPath: '/working/out.wasm',
          bitcodeFiles: ['/working/tinygo-work/program-000.bc'],
        }),
      },
      {
        path: '/working/tinygo-command-batch.json',
        contents: JSON.stringify({
          compileCommands: [
            {
              argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-emit-llvm', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-work/program-000.bc'],
              cwd: '/working',
            },
          ],
          linkCommand: {
            argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '--no-entry', '--export-all', '/working/tinygo-work/program-000.bc', '-o', '/working/out.wasm'],
            cwd: '/working',
          },
        }),
      },
    ],
  }), /frontend backend result did not match backend input manifest/)
})

test('verifyBackendResultManifestAgainstBackendInputAndLoweredBitcodeManifest rejects mismatched backend generated files', () => {
  assert.throws(() => verifyBackendResultManifestAgainstBackendInputAndLoweredBitcodeManifest({
    entryFile: '/workspace/main.go',
    compileJobs: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory'],
      },
    ],
    linkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle', '--no-entry', '--export-all'],
      artifactOutputPath: '/working/out.wasm',
    },
  }, {
    bitcodeFiles: ['/working/tinygo-work/program-000.bc'],
  }, {
    ok: true,
    generatedFiles: [
      {
        path: '/working/other.json',
        contents: '{}',
      },
    ],
  }), /frontend backend result did not match backend input manifest/)
})

test('verifyCommandArtifactManifestAgainstBackendInputAndLoweredBitcodeManifest accepts a normalized backend-owned final command artifact', () => {
  const verification = verifyCommandArtifactManifestAgainstBackendInputAndLoweredBitcodeManifest({
    entryFile: '/workspace/main.go',
    compileJobs: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory'],
        optimizeFlag: '-Oz',
      },
    ],
    linkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle', '--no-entry', '--export-all'],
      artifactOutputPath: '/working/out.wasm',
    },
  }, {
    bitcodeFiles: ['/working/tinygo-work/program-000.bc'],
  }, {
    artifactOutputPath: '/working/out.wasm',
    artifactKind: 'probe',
    bitcodeFiles: ['/working/tinygo-work/program-000.bc'],
    entrypoint: null,
    reason: 'missing-wasi-entrypoint',
    runnable: false,
  })

  assert.equal(verification.artifactOutputPath, '/working/out.wasm')
  assert.equal(verification.artifactKind, 'probe')
  assert.deepEqual(verification.bitcodeFiles, ['/working/tinygo-work/program-000.bc'])
  assert.equal(verification.entrypoint, null)
  assert.equal(verification.reason, 'missing-wasi-entrypoint')
  assert.equal(verification.runnable, false)
})

test('verifyCommandArtifactManifestAgainstBackendInputAndLoweredBitcodeManifest accepts a runnable backend-owned final command artifact', () => {
  const verification = verifyCommandArtifactManifestAgainstBackendInputAndLoweredBitcodeManifest({
    entryFile: '/workspace/main.go',
    compileJobs: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory'],
        optimizeFlag: '-Oz',
      },
    ],
    linkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle', '--no-entry', '--export-all'],
      artifactOutputPath: '/working/out.wasm',
    },
  }, {
    bitcodeFiles: ['/working/tinygo-work/program-000.bc'],
  }, {
    artifactOutputPath: '/working/out.wasm',
    artifactKind: 'execution',
    bitcodeFiles: ['/working/tinygo-work/program-000.bc'],
    entrypoint: 'main',
    runnable: true,
  })

  assert.equal(verification.artifactOutputPath, '/working/out.wasm')
  assert.equal(verification.artifactKind, 'execution')
  assert.deepEqual(verification.bitcodeFiles, ['/working/tinygo-work/program-000.bc'])
  assert.equal(verification.entrypoint, 'main')
  assert.equal(verification.reason, undefined)
  assert.equal(verification.runnable, true)
})

test('verifyCommandArtifactManifestAgainstCommandBatchAndLoweredBitcodeManifest accepts a normalized final command artifact', () => {
  const verification = verifyCommandArtifactManifestAgainstCommandBatchAndLoweredBitcodeManifest({
    compileCommands: [
      {
        argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-emit-llvm', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-work/program-000.bc'],
        cwd: '/working',
      },
      {
        argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-emit-llvm', '-c', '/working/tinygo-lowered/stdlib-000.c', '-o', '/working/tinygo-work/stdlib-000.bc'],
        cwd: '/working',
      },
    ],
    linkCommand: {
      argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '--no-entry', '--export-all', '/working/tinygo-work/program-000.bc', '/working/tinygo-work/stdlib-000.bc', '-o', '/working/out.wasm'],
      cwd: '/working',
    },
  }, {
    bitcodeFiles: [
      '/working/tinygo-work/program-000.bc',
      '/working/tinygo-work/stdlib-000.bc',
    ],
  }, {
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

  assert.equal(verification.artifactOutputPath, '/working/out.wasm')
  assert.equal(verification.artifactKind, 'probe')
  assert.deepEqual(verification.bitcodeFiles, [
    '/working/tinygo-work/program-000.bc',
    '/working/tinygo-work/stdlib-000.bc',
  ])
  assert.equal(verification.entrypoint, null)
  assert.equal(verification.reason, 'missing-wasi-entrypoint')
  assert.equal(verification.runnable, false)
})

test('verifyCommandArtifactManifestAgainstCommandBatchAndLoweredBitcodeManifest accepts a runnable final command artifact', () => {
  const verification = verifyCommandArtifactManifestAgainstCommandBatchAndLoweredBitcodeManifest({
    compileCommands: [
      {
        argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-emit-llvm', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-work/program-000.bc'],
        cwd: '/working',
      },
    ],
    linkCommand: {
      argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '--no-entry', '--export-all', '/working/tinygo-work/program-000.bc', '-o', '/working/out.wasm'],
      cwd: '/working',
    },
  }, {
    bitcodeFiles: [
      '/working/tinygo-work/program-000.bc',
    ],
  }, {
    artifactOutputPath: '/working/out.wasm',
    artifactKind: 'execution',
    bitcodeFiles: [
      '/working/tinygo-work/program-000.bc',
    ],
    entrypoint: 'main',
    runnable: true,
  })

  assert.equal(verification.artifactOutputPath, '/working/out.wasm')
  assert.equal(verification.artifactKind, 'execution')
  assert.deepEqual(verification.bitcodeFiles, ['/working/tinygo-work/program-000.bc'])
  assert.equal(verification.entrypoint, 'main')
  assert.equal(verification.reason, undefined)
  assert.equal(verification.runnable, true)
})

test('verifyCommandArtifactManifestAgainstCommandBatchAndLoweredBitcodeManifest rejects mismatched final command artifact', () => {
  assert.throws(() => verifyCommandArtifactManifestAgainstCommandBatchAndLoweredBitcodeManifest({
    compileCommands: [
      {
        argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-emit-llvm', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-work/program-000.bc'],
        cwd: '/working',
      },
    ],
    linkCommand: {
      argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '--no-entry', '--export-all', '/working/tinygo-work/program-000.bc', '-o', '/working/out.wasm'],
      cwd: '/working',
    },
  }, {
    bitcodeFiles: [
      '/working/tinygo-work/program-000.bc',
    ],
  }, {
    artifactOutputPath: '/working/out-alt.wasm',
    bitcodeFiles: [
      '/working/tinygo-work/program-000.bc',
    ],
  }), /frontend command artifact manifest did not match command batch and lowered bitcode manifest/)
})

test('buildLoweredBitcodeCompileCommandsFromLoweringPlanAndLoweredSourcesManifest derives executable lowered-source llvm commands', () => {
  const compileCommands = buildLoweredBitcodeCompileCommandsFromLoweringPlanAndLoweredSourcesManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    compileJobs: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
        optimizeFlag: '-Oz',
      },
      {
        id: 'stdlib-000',
        kind: 'stdlib',
        packageDir: '/working/.tinygo-root/src/fmt',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
        bitcodeOutputPath: '/working/tinygo-work/stdlib-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
        optimizeFlag: '-Oz',
      },
    ],
    linkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle', '--no-entry', '--export-all'],
      artifactOutputPath: '/working/out.wasm',
      bitcodeInputs: ['/working/tinygo-work/program-000.bc', '/working/tinygo-work/stdlib-000.bc'],
    },
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    units: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-000.c',
      },
      {
        id: 'stdlib-000',
        kind: 'stdlib',
        importPath: 'fmt',
        packageName: 'fmt',
        packageDir: '/working/.tinygo-root/src/fmt',
        sourceFiles: ['/working/.tinygo-root/src/fmt/print.go'],
        loweredSourcePath: '/working/tinygo-lowered/stdlib-000.c',
      },
    ],
  })

  assert.deepEqual(compileCommands, [
    {
      argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext', '-emit-llvm', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-work/program-000.bc'],
      cwd: '/working',
    },
    {
      argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext', '-emit-llvm', '-c', '/working/tinygo-lowered/stdlib-000.c', '-o', '/working/tinygo-work/stdlib-000.bc'],
      cwd: '/working',
    },
  ])
})

test('buildLoweredBitcodeCompileCommandsFromLoweringPlanAndLoweredSourcesManifest rejects mismatched lowering jobs', () => {
  assert.throws(() => buildLoweredBitcodeCompileCommandsFromLoweringPlanAndLoweredSourcesManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    compileJobs: [
      {
        id: 'program-001',
        kind: 'program',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-001.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory'],
        optimizeFlag: '-Oz',
      },
    ],
    linkJob: {
      linker: 'wasm-ld',
      ldflags: ['--stack-first', '--no-demangle', '--no-entry', '--export-all'],
      artifactOutputPath: '/working/out.wasm',
      bitcodeInputs: ['/working/tinygo-work/program-001.bc'],
    },
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    units: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-000.c',
      },
    ],
  }), /frontend lowered bitcode compile commands did not match lowering plan and lowered sources manifests/)
})

test('verifyLoweredBitcodeManifestAgainstLoweringPlanAndLoweredSourcesManifest accepts normalized lowered bitcode outputs', () => {
  const verification = verifyLoweredBitcodeManifestAgainstLoweringPlanAndLoweredSourcesManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    compileJobs: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory'],
        optimizeFlag: '-Oz',
      },
      {
        id: 'stdlib-000',
        kind: 'stdlib',
        packageDir: '/working/.tinygo-root/src/fmt',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
        bitcodeOutputPath: '/working/tinygo-work/stdlib-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory'],
        optimizeFlag: '-Oz',
      },
    ],
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    units: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-000.c',
      },
      {
        id: 'stdlib-000',
        kind: 'stdlib',
        importPath: 'fmt',
        packageName: 'fmt',
        packageDir: '/working/.tinygo-root/src/fmt',
        sourceFiles: ['/working/.tinygo-root/src/fmt/print.go'],
        loweredSourcePath: '/working/tinygo-lowered/stdlib-000.c',
      },
    ],
  }, {
    bitcodeFiles: [
      '/working/tinygo-work/program-000.bc',
      '/working/tinygo-work/stdlib-000.bc',
    ],
  })

  assert.deepEqual(verification.bitcodeFiles, [
    '/working/tinygo-work/program-000.bc',
    '/working/tinygo-work/stdlib-000.bc',
  ])
})

test('verifyLoweredBitcodeManifestAgainstLoweringPlanAndLoweredSourcesManifest rejects mismatched lowered bitcode outputs', () => {
  assert.throws(() => verifyLoweredBitcodeManifestAgainstLoweringPlanAndLoweredSourcesManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    compileJobs: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
        llvmTarget: 'wasm32-unknown-wasi',
        cflags: ['-mbulk-memory'],
        optimizeFlag: '-Oz',
      },
    ],
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    units: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-000.c',
      },
    ],
  }, {
    bitcodeFiles: [
      '/working/tinygo-work/program-001.bc',
    ],
  }), /frontend lowered bitcode manifest did not match lowering plan and lowered sources manifests/)
})

test('verifyLoweredSourcesManifestAgainstWorkItemsManifest accepts deterministic lowered source units', () => {
  const verification = verifyLoweredSourcesManifestAgainstWorkItemsManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    workItems: [
      {
        id: 'program-000',
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
      },
      {
        id: 'stdlib-000',
        kind: 'stdlib',
        importPath: 'fmt',
        imports: [],
        modulePath: '',
        packageName: 'fmt',
        packageDir: '/working/.tinygo-root/src/fmt',
        files: ['/working/.tinygo-root/src/fmt/print.go'],
        bitcodeOutputPath: '/working/tinygo-work/stdlib-000.bc',
      },
    ],
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    units: [
      {
        id: 'program-000',
        kind: 'program',
        importPath: 'command-line-arguments',
        imports: ['fmt'],
        modulePath: 'example.com/app',
        packageName: 'main',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-000.c',
      },
      {
        id: 'stdlib-000',
        kind: 'stdlib',
        importPath: 'fmt',
        imports: [],
        modulePath: '',
        packageName: 'fmt',
        packageDir: '/working/.tinygo-root/src/fmt',
        sourceFiles: ['/working/.tinygo-root/src/fmt/print.go'],
        loweredSourcePath: '/working/tinygo-lowered/stdlib-000.c',
      },
    ],
  })

  assert.equal(verification.units.length, 2)
  assert.equal(verification.units[1]?.loweredSourcePath, '/working/tinygo-lowered/stdlib-000.c')
  assert.equal(verification.units[0]?.modulePath, 'example.com/app')
})

test('verifyLoweredSourcesManifestAgainstWorkItemsManifest rejects mismatched lowered units', () => {
  assert.throws(() => verifyLoweredSourcesManifestAgainstWorkItemsManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    workItems: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        files: ['/workspace/main.go'],
        bitcodeOutputPath: '/working/tinygo-work/program-000.bc',
      },
    ],
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    units: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-001.c',
      },
    ],
  }), /frontend lowered sources did not match work items manifest/)
})

test('verifyLoweredCommandBatchAgainstCompileUnitAndLoweredSourcesManifest accepts executable lowered-source commands', () => {
  const verification = verifyLoweredCommandBatchAgainstCompileUnitAndLoweredSourcesManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      allCompile: ['/workspace/main.go'],
    },
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    units: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-000.c',
      },
      {
        id: 'stdlib-000',
        kind: 'stdlib',
        packageDir: '/working/.tinygo-root/src/fmt',
        sourceFiles: ['/working/.tinygo-root/src/fmt/print.go'],
        loweredSourcePath: '/working/tinygo-lowered/stdlib-000.c',
      },
    ],
  }, {
    compileCommands: [
      {
        argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-lowered/program-000.o'],
        cwd: '/working',
      },
      {
        argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext', '-c', '/working/tinygo-lowered/stdlib-000.c', '-o', '/working/tinygo-lowered/stdlib-000.o'],
        cwd: '/working',
      },
    ],
    linkCommand: {
      argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '--no-entry', '--export-all', '/working/tinygo-lowered/program-000.o', '/working/tinygo-lowered/stdlib-000.o', '-o', '/working/tinygo-lowered-out.wasm'],
      cwd: '/working',
    },
  })

  assert.equal(verification.compileCommands.length, 2)
  assert.equal(verification.linkCommand.argv.at(-1), '/working/tinygo-lowered-out.wasm')
})

test('verifyLoweredCommandBatchAgainstCompileUnitAndLoweredSourcesManifest rejects mismatched lowered command batches', () => {
  assert.throws(() => verifyLoweredCommandBatchAgainstCompileUnitAndLoweredSourcesManifest({
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    toolchain: {
      target: 'wasm',
      artifactOutputPath: '/working/out.wasm',
    },
    sourceSelection: {
      allCompile: ['/workspace/main.go'],
    },
  }, {
    entryFile: '/workspace/main.go',
    optimizeFlag: '-Oz',
    units: [
      {
        id: 'program-000',
        kind: 'program',
        packageDir: '/workspace',
        sourceFiles: ['/workspace/main.go'],
        loweredSourcePath: '/working/tinygo-lowered/program-000.c',
      },
    ],
  }, {
    compileCommands: [
      {
        argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-lowered/program-001.o'],
        cwd: '/working',
      },
    ],
    linkCommand: {
      argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '/working/tinygo-lowered/program-001.o', '-o', '/working/tinygo-lowered-out.wasm'],
      cwd: '/working',
    },
  }), /frontend lowered command batch compile commands did not match compile-unit and lowered sources manifests/)
})

test('verifyLoweredArtifactManifestAgainstLoweredCommandBatchManifest accepts normalized lowered artifact metadata', () => {
  const verification = verifyLoweredArtifactManifestAgainstLoweredCommandBatchManifest({
    compileCommands: [
      {
        argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-lowered/program-000.o'],
        cwd: '/working',
      },
      {
        argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext', '-c', '/working/tinygo-lowered/stdlib-000.c', '-o', '/working/tinygo-lowered/stdlib-000.o'],
        cwd: '/working',
      },
    ],
    linkCommand: {
      argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '--no-entry', '--export-all', '/working/tinygo-lowered/program-000.o', '/working/tinygo-lowered/stdlib-000.o', '-o', '/working/tinygo-lowered-out.wasm'],
      cwd: '/working',
    },
  }, {
    artifactOutputPath: '/working/tinygo-lowered-out.wasm',
    artifactKind: 'probe',
    entrypoint: null,
    objectFiles: ['/working/tinygo-lowered/program-000.o', '/working/tinygo-lowered/stdlib-000.o'],
    reason: 'missing-wasi-entrypoint',
    runnable: false,
  })

  assert.equal(verification.artifactOutputPath, '/working/tinygo-lowered-out.wasm')
  assert.equal(verification.artifactKind, 'probe')
  assert.equal(verification.entrypoint, null)
  assert.equal(verification.objectFiles.length, 2)
  assert.equal(verification.reason, 'missing-wasi-entrypoint')
  assert.equal(verification.runnable, false)
})

test('verifyLoweredArtifactManifestAgainstLoweredCommandBatchManifest accepts runnable lowered artifact metadata', () => {
  const verification = verifyLoweredArtifactManifestAgainstLoweredCommandBatchManifest({
    compileCommands: [
      {
        argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-lowered/program-000.o'],
        cwd: '/working',
      },
    ],
    linkCommand: {
      argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '--no-entry', '--export-all', '/working/tinygo-lowered/program-000.o', '-o', '/working/tinygo-lowered-out.wasm'],
      cwd: '/working',
    },
  }, {
    artifactOutputPath: '/working/tinygo-lowered-out.wasm',
    artifactKind: 'execution',
    entrypoint: 'main',
    objectFiles: ['/working/tinygo-lowered/program-000.o'],
    runnable: true,
  })

  assert.equal(verification.artifactOutputPath, '/working/tinygo-lowered-out.wasm')
  assert.equal(verification.artifactKind, 'execution')
  assert.equal(verification.entrypoint, 'main')
  assert.equal(verification.objectFiles.length, 1)
  assert.equal(verification.reason, undefined)
  assert.equal(verification.runnable, true)
})

test('verifyLoweredArtifactManifestAgainstLoweredCommandBatchManifest rejects mismatched lowered artifact metadata', () => {
  assert.throws(() => verifyLoweredArtifactManifestAgainstLoweredCommandBatchManifest({
    compileCommands: [
      {
        argv: ['/usr/bin/clang', '--target=wasm32-unknown-wasi', '-Oz', '-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext', '-c', '/working/tinygo-lowered/program-000.c', '-o', '/working/tinygo-lowered/program-000.o'],
        cwd: '/working',
      },
    ],
    linkCommand: {
      argv: ['/usr/bin/wasm-ld', '--stack-first', '--no-demangle', '--no-entry', '--export-all', '/working/tinygo-lowered/program-000.o', '-o', '/working/tinygo-lowered-out.wasm'],
      cwd: '/working',
    },
  }, {
    artifactOutputPath: '/working/out.wasm',
    objectFiles: ['/working/tinygo-lowered/program-000.o'],
  }), /frontend lowered artifact manifest did not match lowered command batch manifest/)
})
