export type CompileUnitToolInvocation = {
  argv: string[]
  cwd: string
}

export type TinyGoCompileUnitManifest = {
  entryFile?: string
  optimizeFlag?: string
  materializedFiles?: string[]
  toolchain?: {
    target?: string
    llvmTarget?: string
    linker?: string
    cflags?: string[]
    ldflags?: string[]
    translationUnitPath?: string
    objectOutputPath?: string
    artifactOutputPath?: string
  }
  sourceSelection?: {
    targetAssets?: string[]
    runtimeSupport?: string[]
    program?: string[]
    imported?: string[]
    stdlib?: string[]
    allCompile?: string[]
  }
  compileUnits?: Array<{
    kind?: string
    importPath?: string
    imports?: string[]
    modulePath?: string
    depOnly?: boolean
    packageName?: string
    packageDir?: string
    files?: string[]
    standard?: boolean
  }>
}

export type TinyGoCompileRequestContract = {
  entryFile?: string
  compileUnitManifestPath?: string
  target?: string
  llvmTarget?: string
  linker?: string
  cflags?: string[]
  ldflags?: string[]
  translationUnitPath?: string
  objectOutputPath?: string
  artifactOutputPath?: string
  targetAssetFiles?: string[]
  runtimeSupportFiles?: string[]
  programFiles?: string[]
  importedPackageFiles?: string[]
  stdlibPackageFiles?: string[]
  allCompileFiles?: string[]
  toolPlan?: CompileUnitToolInvocation[]
}

export type TinyGoFrontendInputManifest = {
  buildTags?: string[]
  buildContext?: {
    target?: string
    llvmTarget?: string
    goos?: string
    goarch?: string
    gc?: string
    scheduler?: string
    buildTags?: string[]
    modulePath?: string
  }
  modulePath?: string
  optimizeFlag?: string
  entryFile?: string
  toolchain?: {
    target?: string
    llvmTarget?: string
    linker?: string
    cflags?: string[]
    ldflags?: string[]
    translationUnitPath?: string
    objectOutputPath?: string
    artifactOutputPath?: string
  }
  sourceSelection?: {
    targetAssets?: string[]
    runtimeSupport?: string[]
    program?: string[]
    imported?: string[]
    stdlib?: string[]
    allCompile?: string[]
  }
  compileUnits?: Array<{
    kind?: string
    importPath?: string
    imports?: string[]
    modulePath?: string
    depOnly?: boolean
    packageName?: string
    packageDir?: string
    files?: string[]
    standard?: boolean
  }>
  packageGraph?: Array<{
    depOnly?: boolean
    dir?: string
    files?: {
      goFiles?: string[]
    }
    importPath?: string
    imports?: string[]
    modulePath?: string
    name?: string
    standard?: boolean
  }>
  upstreamFrontendProbe?: TinyGoUpstreamFrontendProbeResult
}

export type TinyGoFrontendAnalysisManifest = {
  buildContext?: {
    target?: string
    llvmTarget?: string
    goos?: string
    goarch?: string
    gc?: string
    scheduler?: string
    buildTags?: string[]
    modulePath?: string
  }
  optimizeFlag?: string
  entryFile?: string
  compileUnitManifestPath?: string
  allCompileFiles?: string[]
  compileGroups?: Array<{
    name?: string
    files?: string[]
  }>
  compileUnits?: Array<{
    kind?: string
    importPath?: string
    imports?: string[]
    modulePath?: string
    depOnly?: boolean
    packageName?: string
    packageDir?: string
    files?: string[]
    standard?: boolean
  }>
  toolchain?: {
    target?: string
    llvmTarget?: string
    linker?: string
    cflags?: string[]
    ldflags?: string[]
    translationUnitPath?: string
    objectOutputPath?: string
    artifactOutputPath?: string
  }
  packageGraph?: Array<{
    depOnly?: boolean
    dir?: string
    files?: {
      goFiles?: string[]
    }
    importPath?: string
    imports?: string[]
    modulePath?: string
    name?: string
    standard?: boolean
  }>
  upstreamFrontendProbe?: TinyGoUpstreamFrontendProbeResult
}

export type TinyGoIntermediateManifest = {
  entryFile?: string
  optimizeFlag?: string
  toolchain?: {
    target?: string
    llvmTarget?: string
    linker?: string
    cflags?: string[]
    ldflags?: string[]
    translationUnitPath?: string
    objectOutputPath?: string
    artifactOutputPath?: string
  }
  sourceSelection?: {
    targetAssets?: string[]
    runtimeSupport?: string[]
    program?: string[]
    imported?: string[]
    stdlib?: string[]
    allCompile?: string[]
  }
  compileUnits?: Array<{
    kind?: string
    importPath?: string
    imports?: string[]
    modulePath?: string
    depOnly?: boolean
    packageName?: string
    packageDir?: string
    files?: string[]
    standard?: boolean
  }>
}

export type TinyGoLoweringManifest = {
  entryFile?: string
  optimizeFlag?: string
  toolchain?: {
    target?: string
    llvmTarget?: string
    linker?: string
    cflags?: string[]
    ldflags?: string[]
    translationUnitPath?: string
    objectOutputPath?: string
    artifactOutputPath?: string
  }
  support?: {
    targetAssets?: string[]
    runtimeSupport?: string[]
  }
  compileUnits?: Array<{
    kind?: string
    importPath?: string
    imports?: string[]
    modulePath?: string
    depOnly?: boolean
    packageName?: string
    packageDir?: string
    files?: string[]
    standard?: boolean
  }>
}

export type TinyGoWorkItemsManifest = {
  entryFile?: string
  optimizeFlag?: string
  toolchain?: {
    target?: string
    llvmTarget?: string
    linker?: string
    cflags?: string[]
    ldflags?: string[]
    translationUnitPath?: string
    objectOutputPath?: string
    artifactOutputPath?: string
  }
  workItems?: Array<{
    id?: string
    kind?: string
    importPath?: string
    imports?: string[]
    depOnly?: boolean
    modulePath?: string
    packageName?: string
    packageDir?: string
    files?: string[]
    bitcodeOutputPath?: string
    standard?: boolean
  }>
}

export type TinyGoLoweredSourcesManifest = {
  entryFile?: string
  optimizeFlag?: string
  units?: Array<{
    id?: string
    kind?: string
    importPath?: string
    imports?: string[]
    depOnly?: boolean
    modulePath?: string
    packageName?: string
    packageDir?: string
    sourceFiles?: string[]
    loweredSourcePath?: string
    standard?: boolean
  }>
}

export type TinyGoLoweredIRManifest = {
  entryFile?: string
  optimizeFlag?: string
  units?: Array<{
    id?: string
    kind?: string
    importPath?: string
    modulePath?: string
    packageDir?: string
    sourceFiles?: string[]
    loweredSourcePath?: string
    packageName?: string
    imports?: Array<{
      path?: string
      alias?: string
    }>
    functions?: Array<{
      name?: string
      exported?: boolean
      method?: boolean
      main?: boolean
      init?: boolean
      parameters?: number
      results?: number
    }>
    types?: Array<{
      name?: string
      exported?: boolean
      kind?: string
    }>
    constants?: Array<{
      name?: string
      exported?: boolean
    }>
    variables?: Array<{
      name?: string
      exported?: boolean
    }>
    declarations?: Array<{
      kind?: string
      name?: string
      exported?: boolean
      method?: boolean
    }>
    placeholderBlocks?: Array<{
      stage?: string
      index?: number
      value?: string
      signature?: string
    }>
    loweringBlocks?: Array<{
      stage?: string
      index?: number
      value?: string
    }>
  }>
}

export type TinyGoLoweredBitcodeManifest = {
  bitcodeFiles?: string[]
}

export type TinyGoLoweredArtifactManifest = {
  artifactOutputPath?: string
  artifactKind?: 'probe' | 'bootstrap' | 'execution'
  entrypoint?: '_start' | '_initialize' | 'main' | null
  objectFiles?: string[]
  reason?: 'bootstrap-artifact' | 'missing-wasi-entrypoint'
  runnable?: boolean
}

export type TinyGoCommandArtifactManifest = {
  artifactOutputPath?: string
  artifactKind?: 'probe' | 'bootstrap' | 'execution'
  bitcodeFiles?: string[]
  entrypoint?: '_start' | '_initialize' | 'main' | null
  reason?: 'bootstrap-artifact' | 'missing-wasi-entrypoint'
  runnable?: boolean
}

export type TinyGoLoweringPlanManifest = {
  entryFile?: string
  optimizeFlag?: string
  compileJobs?: Array<{
    id?: string
    kind?: string
    importPath?: string
    imports?: string[]
    depOnly?: boolean
    modulePath?: string
    packageName?: string
    packageDir?: string
    files?: string[]
    bitcodeOutputPath?: string
    llvmTarget?: string
    cflags?: string[]
    optimizeFlag?: string
    standard?: boolean
  }>
  linkJob?: {
    linker?: string
    ldflags?: string[]
    artifactOutputPath?: string
    bitcodeInputs?: string[]
  }
  executionLinkJob?: {
    linker?: string
    ldflags?: string[]
    artifactOutputPath?: string
    bitcodeInputs?: string[]
  }
}

export type TinyGoBackendInputManifest = {
  entryFile?: string
  optimizeFlag?: string
  compileJobs?: Array<{
    id?: string
    kind?: string
    importPath?: string
    imports?: string[]
    depOnly?: boolean
    modulePath?: string
    packageName?: string
    packageDir?: string
    files?: string[]
    bitcodeOutputPath?: string
    llvmTarget?: string
    cflags?: string[]
    optimizeFlag?: string
    standard?: boolean
  }>
  linkJob?: {
    linker?: string
    ldflags?: string[]
    artifactOutputPath?: string
    bitcodeInputs?: string[]
  }
  executionLinkJob?: {
    linker?: string
    ldflags?: string[]
    artifactOutputPath?: string
    bitcodeInputs?: string[]
  }
  loweredUnits?: Array<{
    id?: string
    kind?: string
    importPath?: string
    imports?: string[]
    depOnly?: boolean
    modulePath?: string
    packageName?: string
    packageDir?: string
    sourceFiles?: string[]
    loweredSourcePath?: string
    standard?: boolean
  }>
}

export type TinyGoBackendResultManifest = {
  ok?: boolean
  generatedFiles?: Array<{
    path: string
    contents: string
  }>
  diagnostics?: string[]
}

export type TinyGoCommandBatchManifest = {
  compileCommands?: Array<{
    argv?: string[]
    cwd?: string
  }>
  linkCommand?: {
    argv?: string[]
    cwd?: string
  }
}

export type TinyGoHostProbeManifest = {
  artifact?: {
    path?: string
    size?: number
  }
  command?: string[]
  runtime?: {
    executed?: boolean
    exitCode?: number | null
    logs?: string[]
    reason?: string
  }
  target?: string
  targetInfo?: {
    buildTags?: string[]
    gc?: string
    goarch?: string
    goos?: string
    llvmTriple?: string
    scheduler?: string
  }
  toolchain?: {
    binPath?: string
    rootPath?: string
    version?: string
  }
  workDir?: string
}

export type TinyGoDriverMetadataContract = {
  buildTags?: string[]
  entry?: string
  gc?: string
  goarch?: string
  goos?: string
  llvmTarget?: string
  optimize?: string
  output?: string
  panicStrategy?: string
  scheduler?: string
  target?: string
}

export type TinyGoDriverBridgeManifest = {
  artifactOutputPath?: string
  driverBuildTags?: string[]
  entryFile?: string
  entryPackage?: {
    depOnly?: boolean
    dir?: string
    goFiles?: string[]
    importPath?: string
    imports?: string[]
    modulePath?: string
    name?: string
    standard?: boolean
  }
  gc?: string
  goarch?: string
  goos?: string
  hostBuildTags?: string[]
  llvmTriple?: string
  packageGraph?: Array<{
    depOnly?: boolean
    dir?: string
    goFiles?: string[]
    importPath?: string
    imports?: string[]
    modulePath?: string
    name?: string
    standard?: boolean
  }>
  upstreamFrontendProbe?: TinyGoUpstreamFrontendProbeResult
  frontendAnalysisInput?: TinyGoFrontendInputManifest
  frontendAnalysis?: TinyGoFrontendAnalysisManifest
  frontendRealAdapter?: TinyGoFrontendAnalysisManifest
  realFrontendAnalysis?: TinyGoFrontendAnalysisManifest
  hostArtifact?: {
    artifactKind?: 'probe' | 'bootstrap' | 'execution'
    bytesBase64?: string
    command?: string[]
    entrypoint?: '_start' | '_initialize' | 'main' | null
    logs?: string[]
    path?: string
    reason?: 'bootstrap-artifact' | 'missing-wasi-entrypoint'
    runnable?: boolean
    size?: number
    target?: string
  }
  scheduler?: string
  target?: string
  toolchain?: {
    binPath?: string
    rootPath?: string
    version?: string
  }
}

export type TinyGoUpstreamFrontendProbeResult = {
  requestedTarget?: string
  mainImportPath?: string
  mainPackageName?: string
  packageCount?: number
  fileCount?: number
  declarationCount?: number
  imports?: string[]
  packages?: Array<{
    importPath?: string
    name?: string
    fileCount?: number
    imports?: string[]
  }>
}

export const normalizeTinyGoDriverBridgeManifestForBrowser = (
  manifest: TinyGoDriverBridgeManifest,
  options?: {
    browserArtifactOutputPath?: string
    browserEntryFile?: string
    browserTinyGoRoot?: string
    browserWorkspaceRoot?: string
    hostTinyGoRoot?: string
    hostWorkspaceRoot?: string
  },
): TinyGoDriverBridgeManifest => {
  const browserWorkspaceRoot = options?.browserWorkspaceRoot ?? '/workspace'
  const browserTinyGoRoot = options?.browserTinyGoRoot ?? '/working/.tinygo-root'
  let hostWorkspaceRoot = options?.hostWorkspaceRoot ?? manifest.entryPackage?.dir ?? ''
  if (hostWorkspaceRoot === '') {
    const entryFile = manifest.entryFile ?? ''
    const entryFileSlashIndex = entryFile.lastIndexOf('/')
    if (entryFileSlashIndex > 0) {
      hostWorkspaceRoot = entryFile.slice(0, entryFileSlashIndex)
    }
  }
  const hostTinyGoRoot = options?.hostTinyGoRoot ?? manifest.toolchain?.rootPath ?? ''
  let browserEntryFile = options?.browserEntryFile ?? ''
  if (browserEntryFile === '') {
    const entryFile = manifest.entryFile ?? ''
    if (
      entryFile !== '' &&
      hostWorkspaceRoot !== '' &&
      (entryFile === hostWorkspaceRoot || entryFile.startsWith(`${hostWorkspaceRoot}/`))
    ) {
      browserEntryFile = `${browserWorkspaceRoot}${entryFile.slice(hostWorkspaceRoot.length)}`
    } else if (entryFile !== '') {
      const entryFileSlashIndex = entryFile.lastIndexOf('/')
      browserEntryFile = `${browserWorkspaceRoot}/${entryFileSlashIndex >= 0 ? entryFile.slice(entryFileSlashIndex + 1) : entryFile}`
    } else {
      browserEntryFile = `${browserWorkspaceRoot}/main.go`
    }
  }
  let browserArtifactOutputPath = options?.browserArtifactOutputPath ?? ''
  if (browserArtifactOutputPath === '') {
    const artifactOutputPath = manifest.artifactOutputPath ?? ''
    if (artifactOutputPath !== '') {
      const artifactOutputPathSlashIndex = artifactOutputPath.lastIndexOf('/')
      browserArtifactOutputPath = `/working/${artifactOutputPathSlashIndex >= 0 ? artifactOutputPath.slice(artifactOutputPathSlashIndex + 1) : artifactOutputPath}`
    } else {
      browserArtifactOutputPath = '/working/out.wasm'
    }
  }
  const normalizedPackageGraph = (manifest.packageGraph ?? []).map((packageInfo) => {
    let packageDir = packageInfo.dir ?? ''
    if (
      packageDir !== '' &&
      hostWorkspaceRoot !== '' &&
      (packageDir === hostWorkspaceRoot || packageDir.startsWith(`${hostWorkspaceRoot}/`))
    ) {
      packageDir = `${browserWorkspaceRoot}${packageDir.slice(hostWorkspaceRoot.length)}`
    } else if (
      packageDir !== '' &&
      hostTinyGoRoot !== '' &&
      (packageDir === hostTinyGoRoot || packageDir.startsWith(`${hostTinyGoRoot}/`))
    ) {
      packageDir = `${browserTinyGoRoot}${packageDir.slice(hostTinyGoRoot.length)}`
    }
    return {
      ...packageInfo,
      dir: packageDir,
    }
  })
  let normalizedEntryPackage = manifest.entryPackage
  if (normalizedEntryPackage) {
    let packageDir = normalizedEntryPackage.dir ?? ''
    if (
      packageDir !== '' &&
      hostWorkspaceRoot !== '' &&
      (packageDir === hostWorkspaceRoot || packageDir.startsWith(`${hostWorkspaceRoot}/`))
    ) {
      packageDir = `${browserWorkspaceRoot}${packageDir.slice(hostWorkspaceRoot.length)}`
    } else if (
      packageDir !== '' &&
      hostTinyGoRoot !== '' &&
      (packageDir === hostTinyGoRoot || packageDir.startsWith(`${hostTinyGoRoot}/`))
    ) {
      packageDir = `${browserTinyGoRoot}${packageDir.slice(hostTinyGoRoot.length)}`
    }
    normalizedEntryPackage = {
      ...normalizedEntryPackage,
      dir: packageDir,
    }
  }
  let normalizedToolchain = manifest.toolchain
  if (normalizedToolchain) {
    let rootPath = normalizedToolchain.rootPath ?? ''
    if (
      rootPath !== '' &&
      hostTinyGoRoot !== '' &&
      (rootPath === hostTinyGoRoot || rootPath.startsWith(`${hostTinyGoRoot}/`))
    ) {
      rootPath = `${browserTinyGoRoot}${rootPath.slice(hostTinyGoRoot.length)}`
    }
    normalizedToolchain = {
      ...normalizedToolchain,
      rootPath,
    }
  }
  let normalizedFrontendAnalysisInput = manifest.frontendAnalysisInput
  if (normalizedFrontendAnalysisInput) {
    let inputEntryFile = normalizedFrontendAnalysisInput.entryFile ?? ''
    if (
      inputEntryFile !== '' &&
      hostWorkspaceRoot !== '' &&
      (inputEntryFile === hostWorkspaceRoot || inputEntryFile.startsWith(`${hostWorkspaceRoot}/`))
    ) {
      inputEntryFile = `${browserWorkspaceRoot}${inputEntryFile.slice(hostWorkspaceRoot.length)}`
    } else if (inputEntryFile !== '') {
      const inputEntryFileSlashIndex = inputEntryFile.lastIndexOf('/')
      inputEntryFile = `${browserWorkspaceRoot}/${inputEntryFileSlashIndex >= 0 ? inputEntryFile.slice(inputEntryFileSlashIndex + 1) : inputEntryFile}`
    }
    let inputToolchain = normalizedFrontendAnalysisInput.toolchain
    if (inputToolchain) {
      let artifactOutputPath = inputToolchain.artifactOutputPath ?? ''
      if (inputToolchain.artifactOutputPath !== undefined && artifactOutputPath !== '') {
        const artifactOutputPathSlashIndex = artifactOutputPath.lastIndexOf('/')
        artifactOutputPath = `/working/${artifactOutputPathSlashIndex >= 0 ? artifactOutputPath.slice(artifactOutputPathSlashIndex + 1) : artifactOutputPath}`
      }
      let translationUnitPath = inputToolchain.translationUnitPath ?? ''
      if (inputToolchain.translationUnitPath !== undefined && translationUnitPath !== '') {
        const translationUnitPathSlashIndex = translationUnitPath.lastIndexOf('/')
        translationUnitPath = `/working/${translationUnitPathSlashIndex >= 0 ? translationUnitPath.slice(translationUnitPathSlashIndex + 1) : translationUnitPath}`
      }
      let objectOutputPath = inputToolchain.objectOutputPath ?? ''
      if (inputToolchain.objectOutputPath !== undefined && objectOutputPath !== '') {
        const objectOutputPathSlashIndex = objectOutputPath.lastIndexOf('/')
        objectOutputPath = `/working/${objectOutputPathSlashIndex >= 0 ? objectOutputPath.slice(objectOutputPathSlashIndex + 1) : objectOutputPath}`
      }
      inputToolchain = {
        ...inputToolchain,
        ...(inputToolchain.artifactOutputPath !== undefined ? { artifactOutputPath } : {}),
        ...(inputToolchain.objectOutputPath !== undefined ? { objectOutputPath } : {}),
        ...(inputToolchain.translationUnitPath !== undefined ? { translationUnitPath } : {}),
      }
    }
    let inputSourceSelection = normalizedFrontendAnalysisInput.sourceSelection
    if (inputSourceSelection) {
      inputSourceSelection = {
        ...inputSourceSelection,
        ...(inputSourceSelection.targetAssets !== undefined ? {
          targetAssets: inputSourceSelection.targetAssets.map((filePath) => {
            if (
              filePath !== '' &&
              hostWorkspaceRoot !== '' &&
              (filePath === hostWorkspaceRoot || filePath.startsWith(`${hostWorkspaceRoot}/`))
            ) {
              return `${browserWorkspaceRoot}${filePath.slice(hostWorkspaceRoot.length)}`
            }
            if (
              filePath !== '' &&
              hostTinyGoRoot !== '' &&
              (filePath === hostTinyGoRoot || filePath.startsWith(`${hostTinyGoRoot}/`))
            ) {
              return `${browserTinyGoRoot}${filePath.slice(hostTinyGoRoot.length)}`
            }
            return filePath
          }),
        } : {}),
        ...(inputSourceSelection.runtimeSupport !== undefined ? {
          runtimeSupport: inputSourceSelection.runtimeSupport.map((filePath) => {
            if (
              filePath !== '' &&
              hostWorkspaceRoot !== '' &&
              (filePath === hostWorkspaceRoot || filePath.startsWith(`${hostWorkspaceRoot}/`))
            ) {
              return `${browserWorkspaceRoot}${filePath.slice(hostWorkspaceRoot.length)}`
            }
            if (
              filePath !== '' &&
              hostTinyGoRoot !== '' &&
              (filePath === hostTinyGoRoot || filePath.startsWith(`${hostTinyGoRoot}/`))
            ) {
              return `${browserTinyGoRoot}${filePath.slice(hostTinyGoRoot.length)}`
            }
            return filePath
          }),
        } : {}),
        ...(inputSourceSelection.program !== undefined ? {
          program: inputSourceSelection.program.map((filePath) => {
            if (
              filePath !== '' &&
              hostWorkspaceRoot !== '' &&
              (filePath === hostWorkspaceRoot || filePath.startsWith(`${hostWorkspaceRoot}/`))
            ) {
              return `${browserWorkspaceRoot}${filePath.slice(hostWorkspaceRoot.length)}`
            }
            if (
              filePath !== '' &&
              hostTinyGoRoot !== '' &&
              (filePath === hostTinyGoRoot || filePath.startsWith(`${hostTinyGoRoot}/`))
            ) {
              return `${browserTinyGoRoot}${filePath.slice(hostTinyGoRoot.length)}`
            }
            return filePath
          }),
        } : {}),
        ...(inputSourceSelection.imported !== undefined ? {
          imported: inputSourceSelection.imported.map((filePath) => {
            if (
              filePath !== '' &&
              hostWorkspaceRoot !== '' &&
              (filePath === hostWorkspaceRoot || filePath.startsWith(`${hostWorkspaceRoot}/`))
            ) {
              return `${browserWorkspaceRoot}${filePath.slice(hostWorkspaceRoot.length)}`
            }
            if (
              filePath !== '' &&
              hostTinyGoRoot !== '' &&
              (filePath === hostTinyGoRoot || filePath.startsWith(`${hostTinyGoRoot}/`))
            ) {
              return `${browserTinyGoRoot}${filePath.slice(hostTinyGoRoot.length)}`
            }
            return filePath
          }),
        } : {}),
        ...(inputSourceSelection.stdlib !== undefined ? {
          stdlib: inputSourceSelection.stdlib.map((filePath) => {
            if (
              filePath !== '' &&
              hostWorkspaceRoot !== '' &&
              (filePath === hostWorkspaceRoot || filePath.startsWith(`${hostWorkspaceRoot}/`))
            ) {
              return `${browserWorkspaceRoot}${filePath.slice(hostWorkspaceRoot.length)}`
            }
            if (
              filePath !== '' &&
              hostTinyGoRoot !== '' &&
              (filePath === hostTinyGoRoot || filePath.startsWith(`${hostTinyGoRoot}/`))
            ) {
              return `${browserTinyGoRoot}${filePath.slice(hostTinyGoRoot.length)}`
            }
            return filePath
          }),
        } : {}),
        ...(inputSourceSelection.allCompile !== undefined ? {
          allCompile: inputSourceSelection.allCompile.map((filePath) => {
            if (
              filePath !== '' &&
              hostWorkspaceRoot !== '' &&
              (filePath === hostWorkspaceRoot || filePath.startsWith(`${hostWorkspaceRoot}/`))
            ) {
              return `${browserWorkspaceRoot}${filePath.slice(hostWorkspaceRoot.length)}`
            }
            if (
              filePath !== '' &&
              hostTinyGoRoot !== '' &&
              (filePath === hostTinyGoRoot || filePath.startsWith(`${hostTinyGoRoot}/`))
            ) {
              return `${browserTinyGoRoot}${filePath.slice(hostTinyGoRoot.length)}`
            }
            return filePath
          }),
        } : {}),
      }
    }
    const packageGraph = (normalizedFrontendAnalysisInput.packageGraph ?? []).map((packageInfo) => {
      let packageDir = packageInfo.dir ?? ''
      if (
        packageDir !== '' &&
        hostWorkspaceRoot !== '' &&
        (packageDir === hostWorkspaceRoot || packageDir.startsWith(`${hostWorkspaceRoot}/`))
      ) {
        packageDir = `${browserWorkspaceRoot}${packageDir.slice(hostWorkspaceRoot.length)}`
      } else if (
        packageDir !== '' &&
        hostTinyGoRoot !== '' &&
        (packageDir === hostTinyGoRoot || packageDir.startsWith(`${hostTinyGoRoot}/`))
      ) {
        packageDir = `${browserTinyGoRoot}${packageDir.slice(hostTinyGoRoot.length)}`
      }
      return {
        ...packageInfo,
        dir: packageDir,
      }
    })
    normalizedFrontendAnalysisInput = {
      ...normalizedFrontendAnalysisInput,
      entryFile: inputEntryFile,
      ...(inputToolchain !== undefined ? { toolchain: inputToolchain } : {}),
      ...(inputSourceSelection !== undefined ? { sourceSelection: inputSourceSelection } : {}),
      ...(normalizedFrontendAnalysisInput.packageGraph !== undefined ? { packageGraph } : {}),
    }
  }
  let normalizedFrontendAnalysis = manifest.frontendAnalysis
  if (normalizedFrontendAnalysis) {
    let analysisEntryFile = normalizedFrontendAnalysis.entryFile ?? ''
    if (
      analysisEntryFile !== '' &&
      hostWorkspaceRoot !== '' &&
      (analysisEntryFile === hostWorkspaceRoot || analysisEntryFile.startsWith(`${hostWorkspaceRoot}/`))
    ) {
      analysisEntryFile = `${browserWorkspaceRoot}${analysisEntryFile.slice(hostWorkspaceRoot.length)}`
    } else if (analysisEntryFile !== '') {
      const analysisEntryFileSlashIndex = analysisEntryFile.lastIndexOf('/')
      analysisEntryFile = `${browserWorkspaceRoot}/${analysisEntryFileSlashIndex >= 0 ? analysisEntryFile.slice(analysisEntryFileSlashIndex + 1) : analysisEntryFile}`
    }
    let compileUnitManifestPath = normalizedFrontendAnalysis.compileUnitManifestPath ?? ''
    if (
      compileUnitManifestPath !== '' &&
      hostTinyGoRoot !== '' &&
      (compileUnitManifestPath === hostTinyGoRoot || compileUnitManifestPath.startsWith(`${hostTinyGoRoot}/`))
    ) {
      compileUnitManifestPath = `${browserTinyGoRoot}${compileUnitManifestPath.slice(hostTinyGoRoot.length)}`
    } else if (compileUnitManifestPath !== '') {
      const compileUnitManifestPathSlashIndex = compileUnitManifestPath.lastIndexOf('/')
      compileUnitManifestPath = `/working/${compileUnitManifestPathSlashIndex >= 0 ? compileUnitManifestPath.slice(compileUnitManifestPathSlashIndex + 1) : compileUnitManifestPath}`
    }
    const allCompileFiles = (normalizedFrontendAnalysis.allCompileFiles ?? []).map((filePath) => {
      if (
        filePath !== '' &&
        hostWorkspaceRoot !== '' &&
        (filePath === hostWorkspaceRoot || filePath.startsWith(`${hostWorkspaceRoot}/`))
      ) {
        return `${browserWorkspaceRoot}${filePath.slice(hostWorkspaceRoot.length)}`
      }
      if (
        filePath !== '' &&
        hostTinyGoRoot !== '' &&
        (filePath === hostTinyGoRoot || filePath.startsWith(`${hostTinyGoRoot}/`))
      ) {
        return `${browserTinyGoRoot}${filePath.slice(hostTinyGoRoot.length)}`
      }
      return filePath
    })
    const compileGroups = (normalizedFrontendAnalysis.compileGroups ?? []).map((compileGroup) => ({
      ...compileGroup,
      files: (compileGroup.files ?? []).map((filePath) => {
        if (
          filePath !== '' &&
          hostWorkspaceRoot !== '' &&
          (filePath === hostWorkspaceRoot || filePath.startsWith(`${hostWorkspaceRoot}/`))
        ) {
          return `${browserWorkspaceRoot}${filePath.slice(hostWorkspaceRoot.length)}`
        }
        if (
          filePath !== '' &&
          hostTinyGoRoot !== '' &&
          (filePath === hostTinyGoRoot || filePath.startsWith(`${hostTinyGoRoot}/`))
        ) {
          return `${browserTinyGoRoot}${filePath.slice(hostTinyGoRoot.length)}`
        }
        return filePath
      }),
    }))
    const compileUnits = (normalizedFrontendAnalysis.compileUnits ?? []).map((compileUnit) => {
      let packageDir = compileUnit.packageDir ?? ''
      if (
        packageDir !== '' &&
        hostWorkspaceRoot !== '' &&
        (packageDir === hostWorkspaceRoot || packageDir.startsWith(`${hostWorkspaceRoot}/`))
      ) {
        packageDir = `${browserWorkspaceRoot}${packageDir.slice(hostWorkspaceRoot.length)}`
      } else if (
        packageDir !== '' &&
        hostTinyGoRoot !== '' &&
        (packageDir === hostTinyGoRoot || packageDir.startsWith(`${hostTinyGoRoot}/`))
      ) {
        packageDir = `${browserTinyGoRoot}${packageDir.slice(hostTinyGoRoot.length)}`
      }
      return {
        ...compileUnit,
        packageDir,
        files: (compileUnit.files ?? []).map((filePath) => {
          if (
            filePath !== '' &&
            hostWorkspaceRoot !== '' &&
            (filePath === hostWorkspaceRoot || filePath.startsWith(`${hostWorkspaceRoot}/`))
          ) {
            return `${browserWorkspaceRoot}${filePath.slice(hostWorkspaceRoot.length)}`
          }
          if (
            filePath !== '' &&
            hostTinyGoRoot !== '' &&
            (filePath === hostTinyGoRoot || filePath.startsWith(`${hostTinyGoRoot}/`))
          ) {
            return `${browserTinyGoRoot}${filePath.slice(hostTinyGoRoot.length)}`
          }
          return filePath
        }),
      }
    })
    const packageGraph = (normalizedFrontendAnalysis.packageGraph ?? []).map((packageInfo) => {
      let packageDir = packageInfo.dir ?? ''
      if (
        packageDir !== '' &&
        hostWorkspaceRoot !== '' &&
        (packageDir === hostWorkspaceRoot || packageDir.startsWith(`${hostWorkspaceRoot}/`))
      ) {
        packageDir = `${browserWorkspaceRoot}${packageDir.slice(hostWorkspaceRoot.length)}`
      } else if (
        packageDir !== '' &&
        hostTinyGoRoot !== '' &&
        (packageDir === hostTinyGoRoot || packageDir.startsWith(`${hostTinyGoRoot}/`))
      ) {
        packageDir = `${browserTinyGoRoot}${packageDir.slice(hostTinyGoRoot.length)}`
      }
      return {
        ...packageInfo,
        dir: packageDir,
      }
    })
    let analysisToolchain = normalizedFrontendAnalysis.toolchain
    if (analysisToolchain) {
      let artifactOutputPath = analysisToolchain.artifactOutputPath ?? ''
      if (analysisToolchain.artifactOutputPath !== undefined && artifactOutputPath !== '') {
        const artifactOutputPathSlashIndex = artifactOutputPath.lastIndexOf('/')
        artifactOutputPath = `/working/${artifactOutputPathSlashIndex >= 0 ? artifactOutputPath.slice(artifactOutputPathSlashIndex + 1) : artifactOutputPath}`
      }
      let translationUnitPath = analysisToolchain.translationUnitPath ?? ''
      if (analysisToolchain.translationUnitPath !== undefined && translationUnitPath !== '') {
        const translationUnitPathSlashIndex = translationUnitPath.lastIndexOf('/')
        translationUnitPath = `/working/${translationUnitPathSlashIndex >= 0 ? translationUnitPath.slice(translationUnitPathSlashIndex + 1) : translationUnitPath}`
      }
      let objectOutputPath = analysisToolchain.objectOutputPath ?? ''
      if (analysisToolchain.objectOutputPath !== undefined && objectOutputPath !== '') {
        const objectOutputPathSlashIndex = objectOutputPath.lastIndexOf('/')
        objectOutputPath = `/working/${objectOutputPathSlashIndex >= 0 ? objectOutputPath.slice(objectOutputPathSlashIndex + 1) : objectOutputPath}`
      }
      analysisToolchain = {
        ...analysisToolchain,
        ...(analysisToolchain.artifactOutputPath !== undefined ? { artifactOutputPath } : {}),
        ...(analysisToolchain.objectOutputPath !== undefined ? { objectOutputPath } : {}),
        ...(analysisToolchain.translationUnitPath !== undefined ? { translationUnitPath } : {}),
      }
    }
    normalizedFrontendAnalysis = {
      ...normalizedFrontendAnalysis,
      entryFile: analysisEntryFile,
      compileUnitManifestPath,
      allCompileFiles,
      compileGroups,
      compileUnits,
      ...(analysisToolchain !== undefined ? { toolchain: analysisToolchain } : {}),
      ...(normalizedFrontendAnalysis.packageGraph !== undefined ? { packageGraph } : {}),
    }
  }
  let normalizedFrontendRealAdapter = manifest.frontendRealAdapter ?? manifest.realFrontendAnalysis
  if (normalizedFrontendRealAdapter) {
    let analysisEntryFile = normalizedFrontendRealAdapter.entryFile ?? ''
    if (
      analysisEntryFile !== '' &&
      hostWorkspaceRoot !== '' &&
      (analysisEntryFile === hostWorkspaceRoot || analysisEntryFile.startsWith(`${hostWorkspaceRoot}/`))
    ) {
      analysisEntryFile = `${browserWorkspaceRoot}${analysisEntryFile.slice(hostWorkspaceRoot.length)}`
    } else if (analysisEntryFile !== '') {
      const analysisEntryFileSlashIndex = analysisEntryFile.lastIndexOf('/')
      analysisEntryFile = `${browserWorkspaceRoot}/${analysisEntryFileSlashIndex >= 0 ? analysisEntryFile.slice(analysisEntryFileSlashIndex + 1) : analysisEntryFile}`
    }
    let compileUnitManifestPath = normalizedFrontendRealAdapter.compileUnitManifestPath ?? ''
    if (
      compileUnitManifestPath !== '' &&
      hostTinyGoRoot !== '' &&
      (compileUnitManifestPath === hostTinyGoRoot || compileUnitManifestPath.startsWith(`${hostTinyGoRoot}/`))
    ) {
      compileUnitManifestPath = `${browserTinyGoRoot}${compileUnitManifestPath.slice(hostTinyGoRoot.length)}`
    } else if (compileUnitManifestPath !== '') {
      const compileUnitManifestPathSlashIndex = compileUnitManifestPath.lastIndexOf('/')
      compileUnitManifestPath = `/working/${compileUnitManifestPathSlashIndex >= 0 ? compileUnitManifestPath.slice(compileUnitManifestPathSlashIndex + 1) : compileUnitManifestPath}`
    }
    const allCompileFiles = (normalizedFrontendRealAdapter.allCompileFiles ?? []).map((filePath) => {
      if (
        filePath !== '' &&
        hostWorkspaceRoot !== '' &&
        (filePath === hostWorkspaceRoot || filePath.startsWith(`${hostWorkspaceRoot}/`))
      ) {
        return `${browserWorkspaceRoot}${filePath.slice(hostWorkspaceRoot.length)}`
      }
      if (
        filePath !== '' &&
        hostTinyGoRoot !== '' &&
        (filePath === hostTinyGoRoot || filePath.startsWith(`${hostTinyGoRoot}/`))
      ) {
        return `${browserTinyGoRoot}${filePath.slice(hostTinyGoRoot.length)}`
      }
      return filePath
    })
    const compileGroups = (normalizedFrontendRealAdapter.compileGroups ?? []).map((compileGroup) => ({
      ...compileGroup,
      files: (compileGroup.files ?? []).map((filePath) => {
        if (
          filePath !== '' &&
          hostWorkspaceRoot !== '' &&
          (filePath === hostWorkspaceRoot || filePath.startsWith(`${hostWorkspaceRoot}/`))
        ) {
          return `${browserWorkspaceRoot}${filePath.slice(hostWorkspaceRoot.length)}`
        }
        if (
          filePath !== '' &&
          hostTinyGoRoot !== '' &&
          (filePath === hostTinyGoRoot || filePath.startsWith(`${hostTinyGoRoot}/`))
        ) {
          return `${browserTinyGoRoot}${filePath.slice(hostTinyGoRoot.length)}`
        }
        return filePath
      }),
    }))
    const compileUnits = (normalizedFrontendRealAdapter.compileUnits ?? []).map((compileUnit) => {
      let packageDir = compileUnit.packageDir ?? ''
      if (
        packageDir !== '' &&
        hostWorkspaceRoot !== '' &&
        (packageDir === hostWorkspaceRoot || packageDir.startsWith(`${hostWorkspaceRoot}/`))
      ) {
        packageDir = `${browserWorkspaceRoot}${packageDir.slice(hostWorkspaceRoot.length)}`
      } else if (
        packageDir !== '' &&
        hostTinyGoRoot !== '' &&
        (packageDir === hostTinyGoRoot || packageDir.startsWith(`${hostTinyGoRoot}/`))
      ) {
        packageDir = `${browserTinyGoRoot}${packageDir.slice(hostTinyGoRoot.length)}`
      }
      return {
        ...compileUnit,
        packageDir,
        files: (compileUnit.files ?? []).map((filePath) => {
          if (
            filePath !== '' &&
            hostWorkspaceRoot !== '' &&
            (filePath === hostWorkspaceRoot || filePath.startsWith(`${hostWorkspaceRoot}/`))
          ) {
            return `${browserWorkspaceRoot}${filePath.slice(hostWorkspaceRoot.length)}`
          }
          if (
            filePath !== '' &&
            hostTinyGoRoot !== '' &&
            (filePath === hostTinyGoRoot || filePath.startsWith(`${hostTinyGoRoot}/`))
          ) {
            return `${browserTinyGoRoot}${filePath.slice(hostTinyGoRoot.length)}`
          }
          return filePath
        }),
      }
    })
    const packageGraph = (normalizedFrontendRealAdapter.packageGraph ?? []).map((packageInfo) => {
      let packageDir = packageInfo.dir ?? ''
      if (
        packageDir !== '' &&
        hostWorkspaceRoot !== '' &&
        (packageDir === hostWorkspaceRoot || packageDir.startsWith(`${hostWorkspaceRoot}/`))
      ) {
        packageDir = `${browserWorkspaceRoot}${packageDir.slice(hostWorkspaceRoot.length)}`
      } else if (
        packageDir !== '' &&
        hostTinyGoRoot !== '' &&
        (packageDir === hostTinyGoRoot || packageDir.startsWith(`${hostTinyGoRoot}/`))
      ) {
        packageDir = `${browserTinyGoRoot}${packageDir.slice(hostTinyGoRoot.length)}`
      }
      return {
        ...packageInfo,
        dir: packageDir,
      }
    })
    let realAdapterToolchain = normalizedFrontendRealAdapter.toolchain
    if (realAdapterToolchain) {
      let artifactOutputPath = realAdapterToolchain.artifactOutputPath ?? ''
      if (realAdapterToolchain.artifactOutputPath !== undefined && artifactOutputPath !== '') {
        const artifactOutputPathSlashIndex = artifactOutputPath.lastIndexOf('/')
        artifactOutputPath = `/working/${artifactOutputPathSlashIndex >= 0 ? artifactOutputPath.slice(artifactOutputPathSlashIndex + 1) : artifactOutputPath}`
      }
      let translationUnitPath = realAdapterToolchain.translationUnitPath ?? ''
      if (realAdapterToolchain.translationUnitPath !== undefined && translationUnitPath !== '') {
        const translationUnitPathSlashIndex = translationUnitPath.lastIndexOf('/')
        translationUnitPath = `/working/${translationUnitPathSlashIndex >= 0 ? translationUnitPath.slice(translationUnitPathSlashIndex + 1) : translationUnitPath}`
      }
      let objectOutputPath = realAdapterToolchain.objectOutputPath ?? ''
      if (realAdapterToolchain.objectOutputPath !== undefined && objectOutputPath !== '') {
        const objectOutputPathSlashIndex = objectOutputPath.lastIndexOf('/')
        objectOutputPath = `/working/${objectOutputPathSlashIndex >= 0 ? objectOutputPath.slice(objectOutputPathSlashIndex + 1) : objectOutputPath}`
      }
      realAdapterToolchain = {
        ...realAdapterToolchain,
        ...(realAdapterToolchain.artifactOutputPath !== undefined ? { artifactOutputPath } : {}),
        ...(realAdapterToolchain.objectOutputPath !== undefined ? { objectOutputPath } : {}),
        ...(realAdapterToolchain.translationUnitPath !== undefined ? { translationUnitPath } : {}),
      }
    }
    normalizedFrontendRealAdapter = {
      ...normalizedFrontendRealAdapter,
      entryFile: analysisEntryFile,
      compileUnitManifestPath,
      allCompileFiles,
      compileGroups,
      compileUnits,
      ...(realAdapterToolchain !== undefined ? { toolchain: realAdapterToolchain } : {}),
      ...(normalizedFrontendRealAdapter.packageGraph !== undefined ? { packageGraph } : {}),
    }
  }
  if (manifest.frontendRealAdapter && manifest.realFrontendAnalysis) {
    const normalizedLegacyFrontendRealAnalysis = normalizeTinyGoDriverBridgeManifestForBrowser({
      ...manifest,
      frontendRealAdapter: undefined,
      realFrontendAnalysis: manifest.realFrontendAnalysis,
    }).frontendRealAdapter
    if (JSON.stringify(normalizedFrontendRealAdapter ?? null) !== JSON.stringify(normalizedLegacyFrontendRealAnalysis ?? null)) {
      throw new Error('frontendRealAdapter did not match realFrontendAnalysis alias')
    }
  }
  return {
    ...manifest,
    artifactOutputPath: browserArtifactOutputPath,
    entryFile: browserEntryFile,
    entryPackage: normalizedEntryPackage,
    frontendAnalysisInput: normalizedFrontendAnalysisInput,
    frontendAnalysis: normalizedFrontendAnalysis,
    frontendRealAdapter: normalizedFrontendRealAdapter,
    realFrontendAnalysis: normalizedFrontendRealAdapter,
    packageGraph: normalizedPackageGraph,
    toolchain: normalizedToolchain,
  }
}

const verifyUpstreamFrontendProbeAgainstPackageGraph = (
  manifest: TinyGoUpstreamFrontendProbeResult,
  packageGraph: Array<{
    files?: {
      goFiles?: string[]
    }
    importPath?: string
    imports?: string[]
    name?: string
  }>,
  entryPackage: {
    importPath?: string
    imports?: string[]
    name?: string
  },
  mismatchMessage: string,
  options?: {
    allowPartialPackageGraph?: boolean
    allowPartialFileSelection?: boolean
  },
) => {
  const packages = manifest.packages ?? []
  if ((manifest.packageCount ?? 0) !== packages.length) {
    throw new Error(mismatchMessage)
  }
  const packageSummaryByImportPath = new Map(
    packages
      .map((packageInfo) => [packageInfo.importPath ?? '', packageInfo] as const)
      .filter(([importPath]) => importPath !== ''),
  )
  if (packageSummaryByImportPath.size !== packages.length) {
    throw new Error(mismatchMessage)
  }
  const entryImportPath = entryPackage.importPath ?? 'command-line-arguments'
  const mainPackageName = entryPackage.name ?? 'main'
  if (
    (manifest.mainImportPath ?? '') !== entryImportPath ||
    (manifest.mainPackageName ?? '') !== mainPackageName
  ) {
    throw new Error(mismatchMessage)
  }
  const expectedEntryImports = [...(entryPackage.imports ?? [])].sort()
  const actualEntryImports = [...(manifest.imports ?? [])].sort()
  if (expectedEntryImports.length !== actualEntryImports.length) {
    throw new Error(mismatchMessage)
  }
  for (const [index, importPath] of expectedEntryImports.entries()) {
    if (actualEntryImports[index] !== importPath) {
      throw new Error(mismatchMessage)
    }
  }

  const graphPackages = packageGraph.filter((packageInfo) => (packageInfo.importPath ?? '') !== '')
  if (!(options?.allowPartialPackageGraph ?? false) && graphPackages.length !== packages.length) {
    throw new Error(mismatchMessage)
  }
  for (const packageInfo of graphPackages) {
    const importPath = packageInfo.importPath ?? ''
    const packageSummary = packageSummaryByImportPath.get(importPath)
    if (!packageSummary) {
      throw new Error(mismatchMessage)
    }
    if ((packageInfo.name ?? '') !== '' && (packageSummary.name ?? '') !== packageInfo.name) {
      throw new Error(mismatchMessage)
    }
    const expectedFileCount = importPath === 'unsafe'
      ? 0
      : (packageInfo.files?.goFiles ?? []).length
    const actualFileCount = packageSummary.fileCount ?? 0
    if (options?.allowPartialFileSelection ?? false) {
      if (actualFileCount < expectedFileCount) {
        throw new Error(mismatchMessage)
      }
    } else if (actualFileCount !== expectedFileCount) {
      throw new Error(mismatchMessage)
    }
    const expectedImports = [...(packageInfo.imports ?? [])].sort()
    const actualImports = [...(packageSummary.imports ?? [])].sort()
    if (expectedImports.length !== actualImports.length) {
      throw new Error(mismatchMessage)
    }
    for (const [index, dependencyImportPath] of expectedImports.entries()) {
      if (actualImports[index] !== dependencyImportPath) {
        throw new Error(mismatchMessage)
      }
    }
  }

  return {
    entryImportPath,
    graphPackageCount: graphPackages.length,
    mainPackageName,
  }
}

export const verifyUpstreamFrontendProbeAgainstDriverBridgeManifest = (
  manifest: TinyGoUpstreamFrontendProbeResult,
  bridgeManifest: TinyGoDriverBridgeManifest,
) =>
  verifyUpstreamFrontendProbeAgainstPackageGraph(
    manifest,
    (bridgeManifest.packageGraph ?? []).map((packageInfo) => ({
      files: {
        goFiles: packageInfo.goFiles ?? [],
      },
      importPath: packageInfo.importPath,
      imports: packageInfo.imports,
      name: packageInfo.name,
    })),
    bridgeManifest.entryPackage ?? {},
    'upstream frontend probe package summaries did not match real TinyGo driver bridge',
  )

export const verifyUpstreamFrontendProbeAgainstFrontendAnalysisInputManifest = (
  manifest: TinyGoUpstreamFrontendProbeResult,
  frontendAnalysisInputManifest?: TinyGoFrontendInputManifest,
) => {
  const packageGraph = frontendAnalysisInputManifest?.packageGraph ?? []
  const programPackages = packageGraph.filter((packageInfo) => !packageInfo.standard && !packageInfo.depOnly)
  if (programPackages.length !== 1) {
    throw new Error('upstream frontend probe package summaries did not match frontend analysis input')
  }
  return verifyUpstreamFrontendProbeAgainstPackageGraph(
    manifest,
    packageGraph,
    {
      importPath: programPackages[0].importPath,
      imports: programPackages[0].imports,
      name: programPackages[0].name,
    },
    'upstream frontend probe package summaries did not match frontend analysis input',
    {
      allowPartialFileSelection: true,
      allowPartialPackageGraph: true,
    },
  )
}

const verifyUpstreamFrontendProbeAgainstFrontendPackageGraphManifest = (
  manifest: TinyGoUpstreamFrontendProbeResult,
  frontendManifest: TinyGoFrontendAnalysisManifest | undefined,
  mismatchMessage: string,
) => {
  const packageGraph = frontendManifest?.packageGraph ?? []
  const programPackages = packageGraph.filter((packageInfo) => !packageInfo.standard && !packageInfo.depOnly)
  if (programPackages.length !== 1) {
    throw new Error(mismatchMessage)
  }
  return verifyUpstreamFrontendProbeAgainstPackageGraph(
    manifest,
    packageGraph,
    {
      importPath: programPackages[0].importPath,
      imports: programPackages[0].imports,
      name: programPackages[0].name,
    },
    mismatchMessage,
    {
      allowPartialFileSelection: true,
      allowPartialPackageGraph: true,
    },
  )
}

export const verifyUpstreamFrontendProbeAgainstFrontendAnalysisManifest = (
  manifest: TinyGoUpstreamFrontendProbeResult,
  frontendAnalysisManifest?: TinyGoFrontendAnalysisManifest,
) =>
  verifyUpstreamFrontendProbeAgainstFrontendPackageGraphManifest(
    manifest,
    frontendAnalysisManifest,
    'upstream frontend probe package summaries did not match frontend analysis',
  )

export const verifyUpstreamFrontendProbeAgainstFrontendRealAdapterManifest = (
  manifest: TinyGoUpstreamFrontendProbeResult,
  frontendRealAdapterManifest?: TinyGoFrontendAnalysisManifest,
) =>
  verifyUpstreamFrontendProbeAgainstFrontendPackageGraphManifest(
    manifest,
    frontendRealAdapterManifest,
    'upstream frontend probe package summaries did not match frontend real adapter',
  )

const defaultTargetProfiles: Record<string, { llvmTarget: string; linker: string; cflags: string[]; ldflags: string[] }> = {
  wasm: {
    llvmTarget: 'wasm32-unknown-wasi',
    linker: 'wasm-ld',
    cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
    ldflags: ['--stack-first', '--no-demangle'],
  },
  wasip1: {
    llvmTarget: 'wasm32-unknown-wasi',
    linker: 'wasm-ld',
    cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
    ldflags: ['--stack-first', '--no-demangle'],
  },
}

const normalizeCompileUnitToolchain = (manifest: TinyGoCompileUnitManifest) => {
  const target = manifest.toolchain?.target ?? ''
  const profile = target === '' ? undefined : defaultTargetProfiles[target]
  const llvmTarget = manifest.toolchain?.llvmTarget ?? profile?.llvmTarget ?? ''
  const linker = manifest.toolchain?.linker ?? profile?.linker ?? ''
  const cflags = manifest.toolchain?.cflags ?? profile?.cflags ?? []
  const ldflags = manifest.toolchain?.ldflags ?? profile?.ldflags ?? []
  const translationUnitPath = manifest.toolchain?.translationUnitPath ?? '/working/tinygo-bootstrap.c'
  const objectOutputPath = manifest.toolchain?.objectOutputPath ?? '/working/tinygo-bootstrap.o'
  const artifactOutputPath = manifest.toolchain?.artifactOutputPath ?? ''

  if (target === '' || llvmTarget === '' || linker === '' || artifactOutputPath === '') {
    throw new Error('frontend compile unit toolchain was incomplete')
  }

  return {
    target,
    llvmTarget,
    linker,
    cflags,
    ldflags,
    translationUnitPath,
    objectOutputPath,
    artifactOutputPath,
  }
}

const normalizeProbeLdflags = (ldflags: string[]) => {
  const probeLdflags = [...ldflags]
  for (const flag of ['--no-entry', '--export-all']) {
    if (!probeLdflags.includes(flag)) {
      probeLdflags.push(flag)
    }
  }
  return probeLdflags
}

const normalizePackageFactsByKind = (
  kind: string,
  depOnly?: boolean,
  standard?: boolean,
) => {
  let normalizedDepOnly = depOnly ?? false
  let normalizedStandard = standard ?? false
  if (kind === 'program') {
    normalizedDepOnly = false
    normalizedStandard = false
  } else if (kind === 'imported') {
    normalizedDepOnly = true
    normalizedStandard = false
  } else if (kind === 'stdlib') {
    normalizedDepOnly = true
    normalizedStandard = true
  }
  return {
    depOnly: normalizedDepOnly,
    standard: normalizedStandard,
  }
}

const isTinyGoRootStdlibPackage = (
  kind: string,
  packageDir: string,
  standard: boolean,
) => standard || kind === 'stdlib' || packageDir.startsWith('/working/.tinygo-root/')

const importsMatchForFrontendBridge = (
  manifestImports: string[],
  bridgeImports: string[],
  allowSubset: boolean,
) => {
  const normalizedManifestImports = [...manifestImports].sort()
  const normalizedBridgeImports = [...bridgeImports].sort()
  if (allowSubset) {
    const bridgeImportSet = new Set(normalizedBridgeImports)
    return normalizedManifestImports.every((importPath) => bridgeImportSet.has(importPath))
  }
  if (normalizedManifestImports.length !== normalizedBridgeImports.length) {
    return false
  }
  for (const [index, importPath] of normalizedManifestImports.entries()) {
    if (normalizedBridgeImports[index] !== importPath) {
      return false
    }
  }
  return true
}

export const buildToolPlanFromCompileUnitManifest = (
  manifest: TinyGoCompileUnitManifest,
): CompileUnitToolInvocation[] => {
  const normalizedToolchain = normalizeCompileUnitToolchain(manifest)
  const translationUnitPath = normalizedToolchain.translationUnitPath
  const objectOutputPath = normalizedToolchain.objectOutputPath
  const artifactOutputPath = normalizedToolchain.artifactOutputPath
  const translationUnitPathIndex = translationUnitPath.lastIndexOf('/')
  const objectOutputPathIndex = objectOutputPath.lastIndexOf('/')
  const compileCwd = translationUnitPathIndex > 0 ? translationUnitPath.slice(0, translationUnitPathIndex) : '/working'
  const linkCwd = objectOutputPathIndex > 0 ? objectOutputPath.slice(0, objectOutputPathIndex) : compileCwd
  const translationUnitName = translationUnitPathIndex >= 0 ? translationUnitPath.slice(translationUnitPathIndex + 1) : translationUnitPath
  const objectOutputName = objectOutputPathIndex >= 0 ? objectOutputPath.slice(objectOutputPathIndex + 1) : objectOutputPath

  return [
    {
      argv: [
        '/usr/bin/clang',
        `--target=${normalizedToolchain.llvmTarget}`,
        ...(manifest.optimizeFlag ? [manifest.optimizeFlag] : []),
        ...normalizedToolchain.cflags,
        '-c',
        translationUnitName,
        '-o',
        objectOutputName,
      ],
      cwd: compileCwd,
    },
    {
      argv: [
        `/usr/bin/${normalizedToolchain.linker}`,
        ...normalizeProbeLdflags(normalizedToolchain.ldflags),
        objectOutputName,
        '-o',
        artifactOutputPath,
      ],
      cwd: linkCwd,
    },
  ]
}

export const verifyTinyGoHostProbeManifestAgainstDriverMetadata = (
  manifest: TinyGoHostProbeManifest,
  driverMetadata: TinyGoDriverMetadataContract,
) => {
  const command = manifest.command ?? []
  if (command.length < 6) {
    throw new Error('real TinyGo host probe command was incomplete')
  }
  const target = manifest.target ?? ''
  const targetInfo = manifest.targetInfo ?? {}
  if (target === '' || targetInfo.llvmTriple === undefined) {
    throw new Error('real TinyGo host probe target facts were incomplete')
  }
  if (driverMetadata.target !== undefined && target !== driverMetadata.target) {
    throw new Error('real TinyGo host probe target did not match driver metadata')
  }
  if (driverMetadata.output !== undefined && (manifest.artifact?.path ?? '') !== driverMetadata.output) {
    throw new Error('real TinyGo host probe artifact path did not match driver metadata')
  }

  let optimizeValue = driverMetadata.optimize ?? ''
  if (optimizeValue === '-O0') {
    optimizeValue = '0'
  } else if (optimizeValue === '-O1') {
    optimizeValue = '1'
  } else if (optimizeValue === '-O2') {
    optimizeValue = '2'
  } else if (optimizeValue === '-O3') {
    optimizeValue = '3'
  } else if (optimizeValue === '-Os') {
    optimizeValue = 's'
  } else if (optimizeValue === '-Oz') {
    optimizeValue = 'z'
  }
  if (command[1] !== 'build' || command[2] !== '-target' || command[3] !== target) {
    throw new Error('real TinyGo host probe command did not match driver metadata')
  }
  const commandArgs = command.slice(1)
  const optimizeFlagIndex = commandArgs.indexOf('-opt')
  const commandOptimize =
    optimizeFlagIndex < 0 || optimizeFlagIndex + 1 >= commandArgs.length ? undefined : commandArgs[optimizeFlagIndex + 1]
  if (commandOptimize !== undefined && optimizeValue !== '' && commandOptimize !== optimizeValue) {
    throw new Error('real TinyGo host probe command did not match driver metadata')
  }
  const schedulerFlagIndex = commandArgs.indexOf('-scheduler')
  const commandScheduler =
    schedulerFlagIndex < 0 || schedulerFlagIndex + 1 >= commandArgs.length
      ? undefined
      : commandArgs[schedulerFlagIndex + 1]
  if (
    commandScheduler !== undefined &&
    driverMetadata.scheduler !== undefined &&
    driverMetadata.scheduler !== '' &&
    commandScheduler !== driverMetadata.scheduler
  ) {
    throw new Error('real TinyGo host probe command did not match driver metadata')
  }
  const panicFlagIndex = commandArgs.indexOf('-panic')
  const commandPanicStrategy =
    panicFlagIndex < 0 || panicFlagIndex + 1 >= commandArgs.length ? undefined : commandArgs[panicFlagIndex + 1]
  if (
    commandPanicStrategy !== undefined &&
    driverMetadata.panicStrategy !== undefined &&
    driverMetadata.panicStrategy !== '' &&
    commandPanicStrategy !== driverMetadata.panicStrategy
  ) {
    throw new Error('real TinyGo host probe command did not match driver metadata')
  }
  const outputFlagIndex = commandArgs.indexOf('-o')
  if (
    outputFlagIndex < 0 ||
    outputFlagIndex + 2 >= commandArgs.length ||
    commandArgs[outputFlagIndex + 1] !== (driverMetadata.output ?? manifest.artifact?.path ?? '') ||
    commandArgs[commandArgs.length - 1] !== (driverMetadata.entry ?? command[command.length - 1] ?? '')
  ) {
    throw new Error('real TinyGo host probe command did not match driver metadata')
  }

  if (
    (driverMetadata.llvmTarget !== undefined && targetInfo.llvmTriple !== driverMetadata.llvmTarget) ||
    (driverMetadata.goos !== undefined && targetInfo.goos !== driverMetadata.goos) ||
    (driverMetadata.goarch !== undefined && targetInfo.goarch !== driverMetadata.goarch) ||
    (driverMetadata.gc !== undefined && targetInfo.gc !== driverMetadata.gc) ||
    (driverMetadata.scheduler !== undefined && targetInfo.scheduler !== driverMetadata.scheduler)
  ) {
    throw new Error('real TinyGo host probe target facts did not match driver metadata')
  }

  const actualBuildTags = new Set(targetInfo.buildTags ?? [])
  for (const buildTag of driverMetadata.buildTags ?? []) {
    if (!actualBuildTags.has(buildTag)) {
      throw new Error('real TinyGo host probe build tags did not cover driver metadata')
    }
  }

  return {
    artifactOutputPath: manifest.artifact?.path ?? '',
    commandArgv: command,
    driverBuildTags: [...(driverMetadata.buildTags ?? [])].sort(),
    entryFile: driverMetadata.entry ?? command[command.length - 1] ?? '',
    gc: targetInfo.gc ?? '',
    goarch: targetInfo.goarch ?? '',
    goos: targetInfo.goos ?? '',
    hostBuildTags: [...(targetInfo.buildTags ?? [])].sort(),
    llvmTriple: targetInfo.llvmTriple ?? '',
    scheduler: targetInfo.scheduler ?? '',
    target,
  }
}

export const verifyFrontendInputManifestAgainstDriverBridgeManifest = (
  manifest: TinyGoFrontendInputManifest,
  bridgeManifest: TinyGoDriverBridgeManifest,
) => {
  const compileUnits = manifest.compileUnits ?? []
  const packageGraph = manifest.packageGraph ?? []
  const buildTags = [...(manifest.buildTags ?? [])].sort()
  const buildContext = manifest.buildContext ?? {}
  const buildContextBuildTags = [...(buildContext.buildTags ?? [])].sort()

  if (
    (buildContext.target ?? '') === '' ||
    (buildContext.llvmTarget ?? '') === '' ||
    (buildContext.goos ?? '') === '' ||
    (buildContext.goarch ?? '') === '' ||
    (buildContext.gc ?? '') === '' ||
    (buildContext.scheduler ?? '') === ''
  ) {
    throw new Error('frontend input build context was incomplete')
  }
  if ((manifest.modulePath ?? '') !== (buildContext.modulePath ?? '')) {
    throw new Error('frontend input build context did not match top-level modulePath')
  }
  if (buildTags.length !== buildContextBuildTags.length) {
    throw new Error('frontend input build context did not match top-level buildTags')
  }
  for (const [index, buildTag] of buildTags.entries()) {
    if (buildContextBuildTags[index] !== buildTag) {
      throw new Error('frontend input build context did not match top-level buildTags')
    }
  }
  if (
    (bridgeManifest.target ?? '') !== '' &&
    (buildContext.target ?? '') !== bridgeManifest.target
  ) {
    throw new Error('frontend input build context did not match real TinyGo driver bridge')
  }
  if (
    (bridgeManifest.llvmTriple ?? '') !== '' &&
    (buildContext.llvmTarget ?? '') !== bridgeManifest.llvmTriple
  ) {
    throw new Error('frontend input build context did not match real TinyGo driver bridge')
  }
  if ((bridgeManifest.goos ?? '') !== '' && (buildContext.goos ?? '') !== bridgeManifest.goos) {
    throw new Error('frontend input build context did not match real TinyGo driver bridge')
  }
  if ((bridgeManifest.goarch ?? '') !== '' && (buildContext.goarch ?? '') !== bridgeManifest.goarch) {
    throw new Error('frontend input build context did not match real TinyGo driver bridge')
  }
  if ((bridgeManifest.gc ?? '') !== '' && (buildContext.gc ?? '') !== bridgeManifest.gc) {
    throw new Error('frontend input build context did not match real TinyGo driver bridge')
  }
  if (
    (bridgeManifest.scheduler ?? '') !== '' &&
    (buildContext.scheduler ?? '') !== bridgeManifest.scheduler
  ) {
    throw new Error('frontend input build context did not match real TinyGo driver bridge')
  }

  const driverBuildTags = [...(bridgeManifest.driverBuildTags ?? [])].sort()
  if (driverBuildTags.length !== 0) {
    if (driverBuildTags.length !== buildTags.length) {
      throw new Error('frontend input build context did not match real TinyGo driver bridge')
    }
    for (const [index, buildTag] of buildTags.entries()) {
      if (driverBuildTags[index] !== buildTag) {
        throw new Error('frontend input build context did not match real TinyGo driver bridge')
      }
    }
  } else {
    const hostBuildTags = new Set(bridgeManifest.hostBuildTags ?? [])
    for (const buildTag of buildTags) {
      if (!hostBuildTags.has(buildTag)) {
        throw new Error('frontend input build context did not match real TinyGo driver bridge')
      }
    }
  }

  if (packageGraph.length !== compileUnits.length) {
    throw new Error('frontend input package graph did not match compile units')
  }
  const packageGraphByImportPath = new Map(
    packageGraph
      .map((packageInfo) => [packageInfo.importPath ?? '', packageInfo] as const)
      .filter(([importPath]) => importPath !== ''),
  )
  if (packageGraphByImportPath.size !== packageGraph.length) {
    throw new Error('frontend input package graph did not match compile units')
  }
  for (const compileUnit of compileUnits) {
    const compileUnitImportPath = compileUnit.importPath ?? ''
    const packageInfo = packageGraphByImportPath.get(compileUnitImportPath)
    if (!packageInfo) {
      throw new Error('frontend input package graph did not match compile units')
    }
    const normalizedPackageFacts = normalizePackageFactsByKind(
      compileUnit.kind ?? '',
      compileUnit.depOnly,
      compileUnit.standard,
    )
    if (
      (packageInfo.dir ?? '') !== (compileUnit.packageDir ?? '') ||
      (packageInfo.name ?? '') !== (compileUnit.packageName ?? '') ||
      (packageInfo.modulePath ?? '') !== (compileUnit.modulePath ?? '') ||
      (packageInfo.depOnly ?? false) !== normalizedPackageFacts.depOnly ||
      (packageInfo.standard ?? false) !== normalizedPackageFacts.standard
    ) {
      throw new Error('frontend input package graph did not match compile units')
    }
    const packageImports = [...(packageInfo.imports ?? [])].sort()
    const compileUnitImports = [...(compileUnit.imports ?? [])].sort()
    if (packageImports.length !== compileUnitImports.length) {
      throw new Error('frontend input package graph did not match compile units')
    }
    for (const [index, importPath] of compileUnitImports.entries()) {
      if (packageImports[index] !== importPath) {
        throw new Error('frontend input package graph did not match compile units')
      }
    }
    const packageGoFiles = [...(packageInfo.files?.goFiles ?? [])].sort()
    const compileUnitGoFiles = [...(compileUnit.files ?? [])]
      .map((file) => {
        const packageDir = compileUnit.packageDir ?? ''
        if (packageDir !== '' && file.startsWith(`${packageDir}/`)) {
          return file.slice(packageDir.length + 1)
        }
        const slashIndex = file.lastIndexOf('/')
        return slashIndex >= 0 ? file.slice(slashIndex + 1) : file
      })
      .sort()
    if (packageGoFiles.length !== compileUnitGoFiles.length) {
      throw new Error('frontend input package graph did not match compile units')
    }
    for (const [index, goFile] of compileUnitGoFiles.entries()) {
      if (packageGoFiles[index] !== goFile) {
        throw new Error('frontend input package graph did not match compile units')
      }
    }
  }

  const compileUnitVerification = verifyCompileUnitManifestAgainstDriverBridgeManifest({
    entryFile: manifest.entryFile,
    optimizeFlag: manifest.optimizeFlag,
    toolchain: manifest.toolchain,
    sourceSelection: manifest.sourceSelection,
    compileUnits: manifest.compileUnits,
  }, bridgeManifest)

  return {
    ...compileUnitVerification,
    buildTags,
    gc: buildContext.gc ?? '',
    goarch: buildContext.goarch ?? '',
    goos: buildContext.goos ?? '',
    graphPackageCount: packageGraph.length,
    llvmTarget: buildContext.llvmTarget ?? compileUnitVerification.llvmTarget,
    modulePath: buildContext.modulePath ?? '',
    scheduler: buildContext.scheduler ?? '',
    target: buildContext.target ?? compileUnitVerification.target,
  }
}

export const verifyFrontendAnalysisInputManifestAgainstDriverBridgeManifest = (
  manifest: TinyGoFrontendInputManifest,
  bridgeManifest: TinyGoDriverBridgeManifest,
) => {
  if ((manifest.compileUnits ?? []).length !== 0) {
    throw new Error('frontend analysis input compileUnits are not supported')
  }
  const bridgeAnalysisInput = bridgeManifest.frontendAnalysisInput
  if (!bridgeAnalysisInput) {
    throw new Error('real TinyGo driver bridge frontend analysis input was missing')
  }
  if ((bridgeAnalysisInput.compileUnits ?? []).length !== 0) {
    throw new Error('real TinyGo driver bridge frontend analysis input compileUnits are not supported')
  }

  const synthesizeCompileUnits = (inputManifest: TinyGoFrontendInputManifest) =>
    (inputManifest.packageGraph ?? []).map((packageInfo) => {
      const packageDir = packageInfo.dir ?? ''
      const goFiles = packageInfo.files?.goFiles ?? []
      return {
        kind: packageInfo.standard ? 'stdlib' : (packageInfo.depOnly ? 'imported' : 'program'),
        importPath: packageInfo.importPath ?? '',
        imports: [...(packageInfo.imports ?? [])],
        modulePath: packageInfo.modulePath ?? '',
        depOnly: packageInfo.depOnly,
        packageName: packageInfo.name ?? '',
        packageDir,
        files: goFiles.map((goFile) => packageDir === '' ? goFile : `${packageDir.replace(/\/$/, '')}/${goFile}`),
        standard: packageInfo.standard,
      }
    })

  let verification: ReturnType<typeof verifyFrontendInputManifestAgainstDriverBridgeManifest>
  try {
    verification = verifyFrontendInputManifestAgainstDriverBridgeManifest({
      ...manifest,
      compileUnits: synthesizeCompileUnits(manifest),
    }, {
      ...bridgeManifest,
      driverBuildTags: bridgeAnalysisInput.buildContext?.buildTags ?? bridgeAnalysisInput.buildTags ?? bridgeManifest.driverBuildTags,
      entryFile: bridgeAnalysisInput.entryFile ?? bridgeManifest.entryFile,
      packageGraph: (bridgeAnalysisInput.packageGraph ?? []).map((packageInfo) => ({
        depOnly: packageInfo.depOnly,
        dir: packageInfo.dir,
        goFiles: packageInfo.files?.goFiles ?? [],
        importPath: packageInfo.importPath,
        imports: packageInfo.imports,
        modulePath: packageInfo.modulePath,
        name: packageInfo.name,
        standard: packageInfo.standard,
      })),
      target: bridgeAnalysisInput.buildContext?.target ?? bridgeAnalysisInput.toolchain?.target ?? bridgeManifest.target,
      llvmTriple:
        bridgeAnalysisInput.buildContext?.llvmTarget ??
        bridgeAnalysisInput.toolchain?.llvmTarget ??
        bridgeManifest.llvmTriple,
      goos: bridgeAnalysisInput.buildContext?.goos ?? bridgeManifest.goos,
      goarch: bridgeAnalysisInput.buildContext?.goarch ?? bridgeManifest.goarch,
      gc: bridgeAnalysisInput.buildContext?.gc ?? bridgeManifest.gc,
      scheduler: bridgeAnalysisInput.buildContext?.scheduler ?? bridgeManifest.scheduler,
    })
  } catch (error) {
    if (error instanceof Error) {
      throw new Error('frontend analysis input did not match real TinyGo driver bridge')
    }
    throw error
  }

  const manifestBuildTags = [...(manifest.buildTags ?? [])].sort()
  const bridgeBuildTags = [...(bridgeAnalysisInput.buildTags ?? [])].sort()
  if (manifestBuildTags.length !== bridgeBuildTags.length) {
    throw new Error('frontend analysis input did not match real TinyGo driver bridge')
  }
  for (const [index, buildTag] of manifestBuildTags.entries()) {
    if (bridgeBuildTags[index] !== buildTag) {
      throw new Error('frontend analysis input did not match real TinyGo driver bridge')
    }
  }
  const manifestBuildContext = manifest.buildContext ?? {}
  const bridgeBuildContext = bridgeAnalysisInput.buildContext ?? {}
  const manifestBuildContextBuildTags = [...(manifestBuildContext.buildTags ?? [])].sort()
  const bridgeBuildContextBuildTags = [...(bridgeBuildContext.buildTags ?? [])].sort()
  if (
    (manifestBuildContext.target ?? '') !== (bridgeBuildContext.target ?? '') ||
    (manifestBuildContext.llvmTarget ?? '') !== (bridgeBuildContext.llvmTarget ?? '') ||
    (manifestBuildContext.goos ?? '') !== (bridgeBuildContext.goos ?? '') ||
    (manifestBuildContext.goarch ?? '') !== (bridgeBuildContext.goarch ?? '') ||
    (manifestBuildContext.gc ?? '') !== (bridgeBuildContext.gc ?? '') ||
    (manifestBuildContext.scheduler ?? '') !== (bridgeBuildContext.scheduler ?? '') ||
    (manifestBuildContext.modulePath ?? '') !== (bridgeBuildContext.modulePath ?? '')
  ) {
    throw new Error('frontend analysis input did not match real TinyGo driver bridge')
  }
  if (manifestBuildContextBuildTags.length !== bridgeBuildContextBuildTags.length) {
    throw new Error('frontend analysis input did not match real TinyGo driver bridge')
  }
  for (const [index, buildTag] of manifestBuildContextBuildTags.entries()) {
    if (bridgeBuildContextBuildTags[index] !== buildTag) {
      throw new Error('frontend analysis input did not match real TinyGo driver bridge')
    }
  }
  if (
    (manifest.modulePath ?? '') !== (bridgeAnalysisInput.modulePath ?? '') ||
    (manifest.optimizeFlag ?? '') !== (bridgeAnalysisInput.optimizeFlag ?? '') ||
    (manifest.entryFile ?? '') !== (bridgeAnalysisInput.entryFile ?? '')
  ) {
    throw new Error('frontend analysis input did not match real TinyGo driver bridge')
  }
  const manifestToolchain = manifest.toolchain ?? {}
  const bridgeToolchain = bridgeAnalysisInput.toolchain ?? {}
  if (
    (manifestToolchain.target ?? '') !== (bridgeToolchain.target ?? '') ||
    (
      (manifestToolchain.llvmTarget ?? '') !== '' &&
      (bridgeToolchain.llvmTarget ?? '') !== '' &&
      (manifestToolchain.llvmTarget ?? '') !== (bridgeToolchain.llvmTarget ?? '')
    ) ||
    (manifestToolchain.linker ?? '') !== (bridgeToolchain.linker ?? '') ||
    JSON.stringify(manifestToolchain.cflags ?? []) !== JSON.stringify(bridgeToolchain.cflags ?? []) ||
    JSON.stringify(manifestToolchain.ldflags ?? []) !== JSON.stringify(bridgeToolchain.ldflags ?? []) ||
    (manifestToolchain.translationUnitPath ?? '') !== (bridgeToolchain.translationUnitPath ?? '') ||
    (manifestToolchain.objectOutputPath ?? '') !== (bridgeToolchain.objectOutputPath ?? '') ||
    (manifestToolchain.artifactOutputPath ?? '') !== (bridgeToolchain.artifactOutputPath ?? '')
  ) {
    throw new Error('frontend analysis input did not match real TinyGo driver bridge')
  }
  const manifestSourceSelection = manifest.sourceSelection ?? {}
  const bridgeSourceSelection = bridgeAnalysisInput.sourceSelection ?? {}
  for (const selectionField of ['targetAssets', 'runtimeSupport', 'program', 'imported', 'stdlib', 'allCompile'] as const) {
    const manifestSelection = [...(manifestSourceSelection[selectionField] ?? [])].sort()
    const bridgeSelection = [...(bridgeSourceSelection[selectionField] ?? [])].sort()
    if (manifestSelection.length !== bridgeSelection.length) {
      throw new Error('frontend analysis input did not match real TinyGo driver bridge')
    }
    for (const [index, filePath] of manifestSelection.entries()) {
      if (bridgeSelection[index] !== filePath) {
        throw new Error('frontend analysis input did not match real TinyGo driver bridge')
      }
    }
  }
  if (Object.keys(manifestSourceSelection).length !== Object.keys(bridgeSourceSelection).length) {
    throw new Error('frontend analysis input did not match real TinyGo driver bridge')
  }
  return {
    buildTags: verification.buildTags,
    gc: verification.gc,
    goarch: verification.goarch,
    goos: verification.goos,
    graphPackageCount: verification.graphPackageCount,
    llvmTarget: verification.llvmTarget,
    modulePath: verification.modulePath,
    scheduler: verification.scheduler,
    target: verification.target,
  }
}

export const verifyFrontendAnalysisAgainstDriverBridgeManifest = (
  manifest: TinyGoFrontendAnalysisManifest,
  bridgeManifest: TinyGoDriverBridgeManifest,
) => {
  const bridgeAnalysis = bridgeManifest.frontendAnalysis
  if (!bridgeAnalysis) {
    throw new Error('real TinyGo driver bridge frontend analysis was missing')
  }

  const manifestTarget = manifest.toolchain?.target ?? ''
  const bridgeTarget = bridgeAnalysis.toolchain?.target ?? bridgeManifest.target ?? ''
  if (bridgeTarget === '' || manifestTarget === '' || manifestTarget !== bridgeTarget) {
    throw new Error('frontend analysis target did not match real TinyGo driver bridge')
  }
  const manifestLLVMTarget = manifest.toolchain?.llvmTarget ?? ''
  const bridgeLLVMTarget = bridgeAnalysis.toolchain?.llvmTarget ?? bridgeManifest.llvmTriple ?? ''
  if (bridgeLLVMTarget === '' || manifestLLVMTarget === '' || manifestLLVMTarget !== bridgeLLVMTarget) {
    throw new Error('frontend analysis llvmTarget did not match real TinyGo driver bridge')
  }
  const buildContext = manifest.buildContext ?? {}
  const bridgeBuildContext = bridgeAnalysis.buildContext ?? {}
  const manifestBuildContextBuildTags = [...(buildContext.buildTags ?? [])].sort()
  const bridgeBuildContextBuildTags = [...(bridgeBuildContext.buildTags ?? bridgeManifest.driverBuildTags ?? [])].sort()
  if (
    (buildContext.target ?? '') !== '' ||
    (buildContext.llvmTarget ?? '') !== '' ||
    (buildContext.goos ?? '') !== '' ||
    (buildContext.goarch ?? '') !== '' ||
    (buildContext.gc ?? '') !== '' ||
    (buildContext.scheduler ?? '') !== '' ||
    manifestBuildContextBuildTags.length !== 0 ||
    (buildContext.modulePath ?? '') !== '' ||
    (bridgeBuildContext.target ?? '') !== '' ||
    (bridgeBuildContext.llvmTarget ?? '') !== '' ||
    (bridgeBuildContext.goos ?? '') !== '' ||
    (bridgeBuildContext.goarch ?? '') !== '' ||
    (bridgeBuildContext.gc ?? '') !== '' ||
    (bridgeBuildContext.scheduler ?? '') !== '' ||
    bridgeBuildContextBuildTags.length !== 0 ||
    (bridgeBuildContext.modulePath ?? '') !== ''
  ) {
    if (
      (buildContext.target ?? '') !== (bridgeBuildContext.target ?? bridgeManifest.target ?? '') ||
      (buildContext.llvmTarget ?? '') !== (bridgeBuildContext.llvmTarget ?? bridgeManifest.llvmTriple ?? '') ||
      (buildContext.goos ?? '') !== (bridgeBuildContext.goos ?? bridgeManifest.goos ?? '') ||
      (buildContext.goarch ?? '') !== (bridgeBuildContext.goarch ?? bridgeManifest.goarch ?? '') ||
      (buildContext.gc ?? '') !== (bridgeBuildContext.gc ?? bridgeManifest.gc ?? '') ||
      (buildContext.scheduler ?? '') !== (bridgeBuildContext.scheduler ?? bridgeManifest.scheduler ?? '')
    ) {
      throw new Error('frontend analysis buildContext did not match real TinyGo driver bridge')
    }
    if ((bridgeBuildContext.modulePath ?? '') !== '' && (buildContext.modulePath ?? '') !== (bridgeBuildContext.modulePath ?? '')) {
      throw new Error('frontend analysis buildContext did not match real TinyGo driver bridge')
    }
    if (bridgeBuildContextBuildTags.length !== manifestBuildContextBuildTags.length) {
      throw new Error('frontend analysis buildContext did not match real TinyGo driver bridge')
    }
    for (const [index, buildTag] of manifestBuildContextBuildTags.entries()) {
      if (bridgeBuildContextBuildTags[index] !== buildTag) {
        throw new Error('frontend analysis buildContext did not match real TinyGo driver bridge')
      }
    }
  }
  if ((manifest.entryFile ?? '') !== (bridgeAnalysis.entryFile ?? '')) {
    throw new Error('frontend analysis entryFile did not match real TinyGo driver bridge')
  }
  if ((manifest.compileUnitManifestPath ?? '') !== (bridgeAnalysis.compileUnitManifestPath ?? '')) {
    throw new Error('frontend analysis compileUnitManifestPath did not match real TinyGo driver bridge')
  }

  const allCompileFiles = [...(manifest.allCompileFiles ?? [])].sort()
  const bridgeAllCompileFiles = [...(bridgeAnalysis.allCompileFiles ?? [])].sort()
  if (allCompileFiles.length !== bridgeAllCompileFiles.length) {
    throw new Error('frontend analysis allCompileFiles did not match real TinyGo driver bridge')
  }
  for (const [index, filePath] of allCompileFiles.entries()) {
    if (bridgeAllCompileFiles[index] !== filePath) {
      throw new Error('frontend analysis allCompileFiles did not match real TinyGo driver bridge')
    }
  }

  const compileGroups = manifest.compileGroups ?? []
  const bridgeCompileGroups = bridgeAnalysis.compileGroups ?? []
  if (compileGroups.length !== bridgeCompileGroups.length) {
    throw new Error('frontend analysis compileGroups did not match real TinyGo driver bridge')
  }
  for (const [index, compileGroup] of compileGroups.entries()) {
    const bridgeCompileGroup = bridgeCompileGroups[index]
    if (!bridgeCompileGroup || (compileGroup.name ?? '') !== (bridgeCompileGroup.name ?? '')) {
      throw new Error('frontend analysis compileGroups did not match real TinyGo driver bridge')
    }
    const compileGroupFiles = [...(compileGroup.files ?? [])].sort()
    const bridgeCompileGroupFiles = [...(bridgeCompileGroup.files ?? [])].sort()
    if (compileGroupFiles.length !== bridgeCompileGroupFiles.length) {
      throw new Error('frontend analysis compileGroups did not match real TinyGo driver bridge')
    }
    for (const [fileIndex, filePath] of compileGroupFiles.entries()) {
      if (bridgeCompileGroupFiles[fileIndex] !== filePath) {
        throw new Error('frontend analysis compileGroups did not match real TinyGo driver bridge')
      }
    }
  }

  const compileUnits = manifest.compileUnits ?? []
  const bridgeCompileUnits = bridgeAnalysis.compileUnits ?? []
  if (compileUnits.length !== bridgeCompileUnits.length) {
    throw new Error('frontend analysis compileUnits did not match real TinyGo driver bridge')
  }
  const bridgeCompileUnitsByImportPath = new Map(
    bridgeCompileUnits
      .filter((compileUnit) => (compileUnit.importPath ?? '') !== '')
      .map((compileUnit) => [compileUnit.importPath ?? '', compileUnit] as const),
  )
  if (bridgeCompileUnitsByImportPath.size !== bridgeCompileUnits.length) {
    throw new Error('frontend analysis compileUnits did not match real TinyGo driver bridge')
  }
  const matchedBridgeCompileUnitImportPaths = new Set<string>()
  for (const compileUnit of compileUnits) {
    const compileUnitImportPath = compileUnit.importPath ?? ''
    let bridgeCompileUnit = bridgeCompileUnitsByImportPath.get(compileUnitImportPath)
    let bridgeCompileUnitImportPath = compileUnitImportPath
    if (!bridgeCompileUnit && (compileUnit.kind ?? '') === 'program') {
      if (compileUnitImportPath === 'command-line-arguments') {
        bridgeCompileUnitImportPath = bridgeManifest.entryPackage?.importPath ?? ''
        bridgeCompileUnit = bridgeCompileUnitImportPath === '' ? undefined : bridgeCompileUnitsByImportPath.get(bridgeCompileUnitImportPath)
      } else if (compileUnitImportPath === (bridgeManifest.entryPackage?.importPath ?? '')) {
        bridgeCompileUnitImportPath = 'command-line-arguments'
        bridgeCompileUnit = bridgeCompileUnitsByImportPath.get(bridgeCompileUnitImportPath)
      }
    }
    if (!bridgeCompileUnit) {
      throw new Error('frontend analysis compileUnits did not match real TinyGo driver bridge')
    }
    const normalizedCompileUnitFacts = normalizePackageFactsByKind(
      compileUnit.kind ?? '',
      compileUnit.depOnly,
      compileUnit.standard,
    )
    const normalizedBridgeCompileUnitFacts = normalizePackageFactsByKind(
      bridgeCompileUnit.kind ?? '',
      bridgeCompileUnit.depOnly,
      bridgeCompileUnit.standard,
    )
    const compileUnitImportPathMatches =
      compileUnitImportPath === (bridgeCompileUnit.importPath ?? '') ||
      (
        (compileUnit.kind ?? '') === 'program' &&
        (
          (
            compileUnitImportPath === 'command-line-arguments' &&
            (bridgeCompileUnit.importPath ?? '') === (bridgeManifest.entryPackage?.importPath ?? '')
          ) ||
          (
            compileUnitImportPath === (bridgeManifest.entryPackage?.importPath ?? '') &&
            (bridgeCompileUnit.importPath ?? '') === 'command-line-arguments'
          )
        )
      )
    if (
      (compileUnit.kind ?? '') !== (bridgeCompileUnit.kind ?? '') ||
      !compileUnitImportPathMatches ||
      (compileUnit.modulePath ?? '') !== (bridgeCompileUnit.modulePath ?? '') ||
      (compileUnit.packageName ?? '') !== (bridgeCompileUnit.packageName ?? '') ||
      (compileUnit.packageDir ?? '') !== (bridgeCompileUnit.packageDir ?? '') ||
      normalizedCompileUnitFacts.depOnly !== normalizedBridgeCompileUnitFacts.depOnly ||
      normalizedCompileUnitFacts.standard !== normalizedBridgeCompileUnitFacts.standard
    ) {
      throw new Error('frontend analysis compileUnits did not match real TinyGo driver bridge')
    }
    const compileUnitImports = [...(compileUnit.imports ?? [])]
    const bridgeCompileUnitImports = [...(bridgeCompileUnit.imports ?? [])]
    if (
      !importsMatchForFrontendBridge(
        compileUnitImports,
        bridgeCompileUnitImports,
        isTinyGoRootStdlibPackage(
          compileUnit.kind ?? '',
          compileUnit.packageDir ?? '',
          normalizedCompileUnitFacts.standard || normalizedBridgeCompileUnitFacts.standard,
        ),
      )
    ) {
      throw new Error('frontend analysis compileUnits did not match real TinyGo driver bridge')
    }
    const compileUnitFiles = [...(compileUnit.files ?? [])].sort()
    const bridgeCompileUnitFiles = [...(bridgeCompileUnit.files ?? [])].sort()
    if (compileUnitFiles.length !== bridgeCompileUnitFiles.length) {
      throw new Error('frontend analysis compileUnits did not match real TinyGo driver bridge')
    }
    for (const [fileIndex, filePath] of compileUnitFiles.entries()) {
      if (bridgeCompileUnitFiles[fileIndex] !== filePath) {
        throw new Error('frontend analysis compileUnits did not match real TinyGo driver bridge')
      }
    }
    matchedBridgeCompileUnitImportPaths.add(bridgeCompileUnitImportPath)
  }
  if (matchedBridgeCompileUnitImportPaths.size !== bridgeCompileUnitsByImportPath.size) {
    throw new Error('frontend analysis compileUnits did not match real TinyGo driver bridge')
  }
  const packageGraph = manifest.packageGraph ?? []
  const bridgePackageGraph = bridgeAnalysis.packageGraph ?? bridgeManifest.packageGraph ?? []
  if (packageGraph.length !== bridgePackageGraph.length) {
    throw new Error('frontend analysis packageGraph did not match real TinyGo driver bridge')
  }
  const bridgePackageGraphByImportPath = new Map(
    bridgePackageGraph
      .filter((packageInfo) => (packageInfo.importPath ?? '') !== '')
      .map((packageInfo) => [packageInfo.importPath ?? '', packageInfo] as const),
  )
  if (bridgePackageGraphByImportPath.size !== bridgePackageGraph.length) {
    throw new Error('frontend analysis packageGraph did not match real TinyGo driver bridge')
  }
  const matchedBridgeImportPaths = new Set<string>()
  for (const packageInfo of packageGraph) {
    const packageImportPath = packageInfo.importPath ?? ''
    let bridgePackageInfo = bridgePackageGraphByImportPath.get(packageImportPath)
    let bridgeImportPath = packageImportPath
    if (!bridgePackageInfo && packageImportPath === 'command-line-arguments' && !(packageInfo.depOnly ?? false)) {
      bridgeImportPath = bridgeManifest.entryPackage?.importPath ?? ''
      bridgePackageInfo = bridgeImportPath === '' ? undefined : bridgePackageGraphByImportPath.get(bridgeImportPath)
    }
    if (!bridgePackageInfo) {
      throw new Error('frontend analysis packageGraph did not match real TinyGo driver bridge')
    }
    if (
      (packageInfo.dir ?? '') !== (bridgePackageInfo.dir ?? '') ||
      (packageInfo.name ?? '') !== (bridgePackageInfo.name ?? '') ||
      (packageInfo.modulePath ?? '') !== (bridgePackageInfo.modulePath ?? '') ||
      Boolean(packageInfo.depOnly) !== Boolean(bridgePackageInfo.depOnly) ||
      Boolean(packageInfo.standard) !== Boolean(bridgePackageInfo.standard)
    ) {
      throw new Error('frontend analysis packageGraph did not match real TinyGo driver bridge')
    }
    const packageImports = [...(packageInfo.imports ?? [])]
    const bridgePackageImports = [...(bridgePackageInfo.imports ?? [])]
    if (
      !importsMatchForFrontendBridge(
        packageImports,
        bridgePackageImports,
        isTinyGoRootStdlibPackage(
          packageInfo.standard ? 'stdlib' : '',
          packageInfo.dir ?? '',
          Boolean(packageInfo.standard) || Boolean(bridgePackageInfo.standard),
        ),
      )
    ) {
      throw new Error('frontend analysis packageGraph did not match real TinyGo driver bridge')
    }
    const packageGoFiles = [...(packageInfo.files?.goFiles ?? [])].sort()
    let bridgePackageGoFiles: string[] = []
    if ('files' in bridgePackageInfo) {
      bridgePackageGoFiles = [...(bridgePackageInfo.files?.goFiles ?? [])].sort()
    }
    if (bridgePackageGoFiles.length === 0 && 'goFiles' in bridgePackageInfo) {
      bridgePackageGoFiles = [...(bridgePackageInfo.goFiles ?? [])].sort()
    }
    if (packageGoFiles.length !== bridgePackageGoFiles.length) {
      throw new Error('frontend analysis packageGraph did not match real TinyGo driver bridge')
    }
    for (const [fileIndex, goFile] of packageGoFiles.entries()) {
      if (bridgePackageGoFiles[fileIndex] !== goFile) {
        throw new Error('frontend analysis packageGraph did not match real TinyGo driver bridge')
      }
    }
    matchedBridgeImportPaths.add(bridgeImportPath)
  }
  if (matchedBridgeImportPaths.size !== bridgePackageGraphByImportPath.size) {
    throw new Error('frontend analysis packageGraph did not match real TinyGo driver bridge')
  }
  const programCompileUnit = compileUnits.find((compileUnit) => (compileUnit.kind ?? '') === 'program')
  const programImportPath = programCompileUnit?.importPath ?? ''
  const programImportAlias = programImportPath === '' ? '' : (programImportPath === 'command-line-arguments' ? 'synthetic' : 'direct')

  return {
    allCompileCount: allCompileFiles.length,
    compileGroupCount: compileGroups.length,
    compileUnitCount: compileUnits.length,
    compileUnitManifestPath: manifest.compileUnitManifestPath ?? '',
    entryFile: manifest.entryFile ?? '',
    gc: buildContext.gc ?? '',
    goarch: buildContext.goarch ?? '',
    goos: buildContext.goos ?? '',
    graphPackageCount: packageGraph.length,
    llvmTarget: manifestLLVMTarget,
    programImportAlias,
    programImportPath,
    scheduler: buildContext.scheduler ?? '',
    target: manifestTarget,
  }
}

export const verifyFrontendAnalysisAgainstRealDriverBridgeManifest = (
  manifest: TinyGoFrontendAnalysisManifest,
  bridgeManifest: TinyGoDriverBridgeManifest,
) => {
  const realAnalysis = bridgeManifest.frontendRealAdapter ?? bridgeManifest.realFrontendAnalysis
  if (!realAnalysis) {
    throw new Error('real TinyGo analysis adapter was missing')
  }

  const manifestTarget = manifest.toolchain?.target ?? ''
  const realTarget = realAnalysis.toolchain?.target ?? bridgeManifest.target ?? ''
  if (realTarget === '' || manifestTarget === '' || manifestTarget !== realTarget) {
    throw new Error('frontend analysis target did not match real TinyGo analysis adapter')
  }
  const manifestLLVMTarget = manifest.toolchain?.llvmTarget ?? ''
  const realLLVMTarget = realAnalysis.toolchain?.llvmTarget ?? bridgeManifest.llvmTriple ?? ''
  if (realLLVMTarget === '' || manifestLLVMTarget === '' || manifestLLVMTarget !== realLLVMTarget) {
    throw new Error('frontend analysis llvmTarget did not match real TinyGo analysis adapter')
  }
  const buildContext = manifest.buildContext ?? {}
  const realBuildContext = realAnalysis.buildContext ?? {}
  const manifestBuildContextBuildTags = [...(buildContext.buildTags ?? [])].sort()
  const realBuildContextBuildTags = [...(realBuildContext.buildTags ?? bridgeManifest.driverBuildTags ?? [])].sort()
  if (
    (buildContext.target ?? '') !== '' ||
    (buildContext.llvmTarget ?? '') !== '' ||
    (buildContext.goos ?? '') !== '' ||
    (buildContext.goarch ?? '') !== '' ||
    (buildContext.gc ?? '') !== '' ||
    (buildContext.scheduler ?? '') !== '' ||
    manifestBuildContextBuildTags.length !== 0 ||
    (buildContext.modulePath ?? '') !== '' ||
    (realBuildContext.target ?? '') !== '' ||
    (realBuildContext.llvmTarget ?? '') !== '' ||
    (realBuildContext.goos ?? '') !== '' ||
    (realBuildContext.goarch ?? '') !== '' ||
    (realBuildContext.gc ?? '') !== '' ||
    (realBuildContext.scheduler ?? '') !== '' ||
    realBuildContextBuildTags.length !== 0 ||
    (realBuildContext.modulePath ?? '') !== ''
  ) {
    if (
      (buildContext.target ?? '') !== (realBuildContext.target ?? bridgeManifest.target ?? '') ||
      (buildContext.llvmTarget ?? '') !== (realBuildContext.llvmTarget ?? bridgeManifest.llvmTriple ?? '') ||
      (buildContext.goos ?? '') !== (realBuildContext.goos ?? bridgeManifest.goos ?? '') ||
      (buildContext.goarch ?? '') !== (realBuildContext.goarch ?? bridgeManifest.goarch ?? '') ||
      (buildContext.gc ?? '') !== (realBuildContext.gc ?? bridgeManifest.gc ?? '') ||
      (buildContext.scheduler ?? '') !== (realBuildContext.scheduler ?? bridgeManifest.scheduler ?? '')
    ) {
      throw new Error('frontend analysis buildContext did not match real TinyGo analysis adapter')
    }
    if ((realBuildContext.modulePath ?? '') !== '' && (buildContext.modulePath ?? '') !== (realBuildContext.modulePath ?? '')) {
      throw new Error('frontend analysis buildContext did not match real TinyGo analysis adapter')
    }
    if (realBuildContextBuildTags.length !== manifestBuildContextBuildTags.length) {
      throw new Error('frontend analysis buildContext did not match real TinyGo analysis adapter')
    }
    for (const [index, buildTag] of manifestBuildContextBuildTags.entries()) {
      if (realBuildContextBuildTags[index] !== buildTag) {
        throw new Error('frontend analysis buildContext did not match real TinyGo analysis adapter')
      }
    }
  }
  if ((manifest.entryFile ?? '') !== (realAnalysis.entryFile ?? '')) {
    throw new Error('frontend analysis entryFile did not match real TinyGo analysis adapter')
  }
  if ((manifest.compileUnitManifestPath ?? '') !== (realAnalysis.compileUnitManifestPath ?? '')) {
    throw new Error('frontend analysis compileUnitManifestPath did not match real TinyGo analysis adapter')
  }
  if (
    ((manifest.optimizeFlag ?? '') !== '' || (realAnalysis.optimizeFlag ?? '') !== '') &&
    (manifest.optimizeFlag ?? '') !== (realAnalysis.optimizeFlag ?? '')
  ) {
    throw new Error('frontend analysis optimizeFlag did not match real TinyGo analysis adapter')
  }
  const manifestToolchain = manifest.toolchain ?? {}
  const realToolchain = realAnalysis.toolchain ?? {}
  if (
    (manifestToolchain.linker ?? '') !== '' ||
    (manifestToolchain.cflags?.length ?? 0) !== 0 ||
    (manifestToolchain.ldflags?.length ?? 0) !== 0 ||
    (manifestToolchain.translationUnitPath ?? '') !== '' ||
    (manifestToolchain.objectOutputPath ?? '') !== '' ||
    (manifestToolchain.artifactOutputPath ?? '') !== '' ||
    (realToolchain.linker ?? '') !== '' ||
    (realToolchain.cflags?.length ?? 0) !== 0 ||
    (realToolchain.ldflags?.length ?? 0) !== 0 ||
    (realToolchain.translationUnitPath ?? '') !== '' ||
    (realToolchain.objectOutputPath ?? '') !== '' ||
    (realToolchain.artifactOutputPath ?? '') !== ''
  ) {
    if (
      (manifestToolchain.linker ?? '') !== (realToolchain.linker ?? '') ||
      JSON.stringify(manifestToolchain.cflags ?? []) !== JSON.stringify(realToolchain.cflags ?? []) ||
      JSON.stringify(manifestToolchain.ldflags ?? []) !== JSON.stringify(realToolchain.ldflags ?? []) ||
      (manifestToolchain.translationUnitPath ?? '') !== (realToolchain.translationUnitPath ?? '') ||
      (manifestToolchain.objectOutputPath ?? '') !== (realToolchain.objectOutputPath ?? '') ||
      (manifestToolchain.artifactOutputPath ?? '') !== (realToolchain.artifactOutputPath ?? '')
    ) {
      throw new Error('frontend analysis toolchain did not match real TinyGo analysis adapter')
    }
  }

  const allCompileFiles = [...(manifest.allCompileFiles ?? [])].sort()
  const realAllCompileFiles = [...(realAnalysis.allCompileFiles ?? [])].sort()
  if (allCompileFiles.length !== realAllCompileFiles.length) {
    throw new Error('frontend analysis allCompileFiles did not match real TinyGo analysis adapter')
  }
  for (const [index, filePath] of allCompileFiles.entries()) {
    if (realAllCompileFiles[index] !== filePath) {
      throw new Error('frontend analysis allCompileFiles did not match real TinyGo analysis adapter')
    }
  }

  const compileUnits = manifest.compileUnits ?? []
  const realCompileUnits = realAnalysis.compileUnits ?? []
  if (compileUnits.length !== realCompileUnits.length) {
    throw new Error('frontend analysis compileUnits did not match real TinyGo analysis adapter')
  }

  const selectedCompileGroupNames = ['program', 'imported', 'stdlib', 'all-compile']
  const compileGroupsByName = new Map(
    (manifest.compileGroups ?? [])
      .filter((compileGroup) => selectedCompileGroupNames.includes(compileGroup.name ?? ''))
      .map((compileGroup) => [compileGroup.name ?? '', compileGroup]),
  )
  if (!compileGroupsByName.has('program')) {
    compileGroupsByName.set('program', {
      name: 'program',
      files: compileUnits
        .filter((compileUnit) => (compileUnit.kind ?? '') === 'program')
        .flatMap((compileUnit) => compileUnit.files ?? []),
    })
  }
  if (!compileGroupsByName.has('imported')) {
    compileGroupsByName.set('imported', {
      name: 'imported',
      files: compileUnits
        .filter((compileUnit) => (compileUnit.kind ?? '') === 'imported')
        .flatMap((compileUnit) => compileUnit.files ?? []),
    })
  }
  if (!compileGroupsByName.has('stdlib')) {
    compileGroupsByName.set('stdlib', {
      name: 'stdlib',
      files: compileUnits
        .filter((compileUnit) => (compileUnit.kind ?? '') === 'stdlib')
        .flatMap((compileUnit) => compileUnit.files ?? []),
    })
  }
  if (!compileGroupsByName.has('all-compile')) {
    compileGroupsByName.set('all-compile', {
      name: 'all-compile',
      files: manifest.allCompileFiles ?? [],
    })
  }
  const realCompileGroupsByName = new Map(
    (realAnalysis.compileGroups ?? [])
      .filter((compileGroup) => selectedCompileGroupNames.includes(compileGroup.name ?? ''))
      .map((compileGroup) => [compileGroup.name ?? '', compileGroup]),
  )
  if (!realCompileGroupsByName.has('program')) {
    realCompileGroupsByName.set('program', {
      name: 'program',
      files: realCompileUnits
        .filter((compileUnit) => (compileUnit.kind ?? '') === 'program')
        .flatMap((compileUnit) => compileUnit.files ?? []),
    })
  }
  if (!realCompileGroupsByName.has('imported')) {
    realCompileGroupsByName.set('imported', {
      name: 'imported',
      files: realCompileUnits
        .filter((compileUnit) => (compileUnit.kind ?? '') === 'imported')
        .flatMap((compileUnit) => compileUnit.files ?? []),
    })
  }
  if (!realCompileGroupsByName.has('stdlib')) {
    realCompileGroupsByName.set('stdlib', {
      name: 'stdlib',
      files: realCompileUnits
        .filter((compileUnit) => (compileUnit.kind ?? '') === 'stdlib')
        .flatMap((compileUnit) => compileUnit.files ?? []),
    })
  }
  if (!realCompileGroupsByName.has('all-compile')) {
    realCompileGroupsByName.set('all-compile', {
      name: 'all-compile',
      files: realAnalysis.allCompileFiles ?? [],
    })
  }
  for (const compileGroupName of selectedCompileGroupNames) {
    const compileGroup = compileGroupsByName.get(compileGroupName)
    const realCompileGroup = realCompileGroupsByName.get(compileGroupName)
    if (!compileGroup || !realCompileGroup) {
      throw new Error('frontend analysis compileGroups did not match real TinyGo analysis adapter')
    }
    const compileGroupFiles = [...(compileGroup.files ?? [])].sort()
    const realCompileGroupFiles = [...(realCompileGroup.files ?? [])].sort()
    if (compileGroupFiles.length !== realCompileGroupFiles.length) {
      throw new Error('frontend analysis compileGroups did not match real TinyGo analysis adapter')
    }
    for (const [index, filePath] of compileGroupFiles.entries()) {
      if (realCompileGroupFiles[index] !== filePath) {
        throw new Error('frontend analysis compileGroups did not match real TinyGo analysis adapter')
      }
    }
  }
  const manifestProgramCompileUnit = compileUnits.find((compileUnit) => (compileUnit.kind ?? '') === 'program')
  const realProgramCompileUnit = realCompileUnits.find((compileUnit) => (compileUnit.kind ?? '') === 'program')
  if (!manifestProgramCompileUnit || !realProgramCompileUnit) {
    throw new Error('frontend analysis compileUnits did not match real TinyGo analysis adapter')
  }
  let programImportAlias = 'direct'
  if ((manifestProgramCompileUnit.importPath ?? '') !== (realProgramCompileUnit.importPath ?? '')) {
    if ((manifestProgramCompileUnit.importPath ?? '') === 'command-line-arguments') {
      programImportAlias = 'synthetic'
    } else {
      throw new Error('frontend analysis program package did not match real TinyGo analysis adapter')
    }
  }
  const normalizedManifestProgramFacts = normalizePackageFactsByKind(
    manifestProgramCompileUnit.kind ?? '',
    manifestProgramCompileUnit.depOnly,
    manifestProgramCompileUnit.standard,
  )
  const normalizedRealProgramFacts = normalizePackageFactsByKind(
    realProgramCompileUnit.kind ?? '',
    realProgramCompileUnit.depOnly,
    realProgramCompileUnit.standard,
  )
  if (
    (manifestProgramCompileUnit.modulePath ?? '') !== (realProgramCompileUnit.modulePath ?? '') ||
    (manifestProgramCompileUnit.packageName ?? '') !== (realProgramCompileUnit.packageName ?? '') ||
    (manifestProgramCompileUnit.packageDir ?? '') !== (realProgramCompileUnit.packageDir ?? '') ||
    normalizedManifestProgramFacts.depOnly !== normalizedRealProgramFacts.depOnly ||
    normalizedManifestProgramFacts.standard !== normalizedRealProgramFacts.standard
  ) {
    throw new Error('frontend analysis program package did not match real TinyGo analysis adapter')
  }
  const manifestProgramFiles = [...(manifestProgramCompileUnit.files ?? [])].sort()
  const realProgramFiles = [...(realProgramCompileUnit.files ?? [])].sort()
  if (manifestProgramFiles.length !== realProgramFiles.length) {
    throw new Error('frontend analysis program package did not match real TinyGo analysis adapter')
  }
  for (const [index, filePath] of manifestProgramFiles.entries()) {
    if (realProgramFiles[index] !== filePath) {
      throw new Error('frontend analysis program package did not match real TinyGo analysis adapter')
    }
  }
  const manifestProgramImports = [...(manifestProgramCompileUnit.imports ?? [])].sort()
  const realProgramImports = [...(realProgramCompileUnit.imports ?? [])].sort()
  if (manifestProgramImports.length !== realProgramImports.length) {
    throw new Error('frontend analysis program package did not match real TinyGo analysis adapter')
  }
  for (const [index, importPath] of manifestProgramImports.entries()) {
    if (realProgramImports[index] !== importPath) {
      throw new Error('frontend analysis program package did not match real TinyGo analysis adapter')
    }
  }

  const realCompileUnitsByImportPath = new Map(
    realCompileUnits
      .filter((compileUnit) => (compileUnit.kind ?? '') !== 'program')
      .map((compileUnit) => [compileUnit.importPath ?? '', compileUnit] as const)
      .filter(([importPath]) => importPath !== ''),
  )
  for (const compileUnit of compileUnits) {
    if ((compileUnit.kind ?? '') === 'program') {
      continue
    }
    const realCompileUnit = realCompileUnitsByImportPath.get(compileUnit.importPath ?? '')
    if (!realCompileUnit) {
      throw new Error('frontend analysis compileUnits did not match real TinyGo analysis adapter')
    }
    const normalizedCompileUnitFacts = normalizePackageFactsByKind(
      compileUnit.kind ?? '',
      compileUnit.depOnly,
      compileUnit.standard,
    )
    const normalizedRealCompileUnitFacts = normalizePackageFactsByKind(
      realCompileUnit.kind ?? '',
      realCompileUnit.depOnly,
      realCompileUnit.standard,
    )
    if (
      (compileUnit.kind ?? '') !== (realCompileUnit.kind ?? '') ||
      (compileUnit.modulePath ?? '') !== (realCompileUnit.modulePath ?? '') ||
      (compileUnit.packageName ?? '') !== (realCompileUnit.packageName ?? '') ||
      (compileUnit.packageDir ?? '') !== (realCompileUnit.packageDir ?? '') ||
      normalizedCompileUnitFacts.depOnly !== normalizedRealCompileUnitFacts.depOnly ||
      normalizedCompileUnitFacts.standard !== normalizedRealCompileUnitFacts.standard
    ) {
      throw new Error('frontend analysis compileUnits did not match real TinyGo analysis adapter')
    }
    const compileUnitFiles = [...(compileUnit.files ?? [])].sort()
    const realCompileUnitFiles = [...(realCompileUnit.files ?? [])].sort()
    if (compileUnitFiles.length !== realCompileUnitFiles.length) {
      throw new Error('frontend analysis compileUnits did not match real TinyGo analysis adapter')
    }
    for (const [index, filePath] of compileUnitFiles.entries()) {
      if (realCompileUnitFiles[index] !== filePath) {
        throw new Error('frontend analysis compileUnits did not match real TinyGo analysis adapter')
      }
    }
    const compileUnitImports = [...(compileUnit.imports ?? [])]
    const realCompileUnitImports = [...(realCompileUnit.imports ?? [])]
    if (
      !importsMatchForFrontendBridge(
        compileUnitImports,
        realCompileUnitImports,
        isTinyGoRootStdlibPackage(
          compileUnit.kind ?? '',
          compileUnit.packageDir ?? '',
          normalizedCompileUnitFacts.standard || normalizedRealCompileUnitFacts.standard,
        ),
      )
    ) {
      throw new Error('frontend analysis compileUnits did not match real TinyGo analysis adapter')
    }
  }
  const packageGraph = manifest.packageGraph ?? []
  const realPackageGraph = realAnalysis.packageGraph ?? bridgeManifest.packageGraph ?? []
  if (packageGraph.length !== realPackageGraph.length) {
    throw new Error('frontend analysis packageGraph did not match real TinyGo analysis adapter')
  }
  const realPackageGraphByImportPath = new Map(
    realPackageGraph
      .filter((packageInfo) => (packageInfo.importPath ?? '') !== '')
      .map((packageInfo) => [packageInfo.importPath ?? '', packageInfo] as const),
  )
  if (realPackageGraphByImportPath.size !== realPackageGraph.length) {
    throw new Error('frontend analysis packageGraph did not match real TinyGo analysis adapter')
  }
  const matchedRealImportPaths = new Set<string>()
  for (const packageInfo of packageGraph) {
    const packageImportPath = packageInfo.importPath ?? ''
    let realPackageInfo = realPackageGraphByImportPath.get(packageImportPath)
    let realImportPath = packageImportPath
    if (!realPackageInfo && packageImportPath === 'command-line-arguments' && !(packageInfo.depOnly ?? false)) {
      const realProgramCompileUnit = (realAnalysis.compileUnits ?? []).find((compileUnit) => (compileUnit.kind ?? '') === 'program')
      realImportPath = realProgramCompileUnit?.importPath ?? ''
      realPackageInfo = realImportPath === '' ? undefined : realPackageGraphByImportPath.get(realImportPath)
    }
    if (!realPackageInfo) {
      throw new Error('frontend analysis packageGraph did not match real TinyGo analysis adapter')
    }
    if (
      (packageInfo.dir ?? '') !== (realPackageInfo.dir ?? '') ||
      (packageInfo.name ?? '') !== (realPackageInfo.name ?? '') ||
      (packageInfo.modulePath ?? '') !== (realPackageInfo.modulePath ?? '') ||
      Boolean(packageInfo.depOnly) !== Boolean(realPackageInfo.depOnly) ||
      Boolean(packageInfo.standard) !== Boolean(realPackageInfo.standard)
    ) {
      throw new Error('frontend analysis packageGraph did not match real TinyGo analysis adapter')
    }
    const packageImports = [...(packageInfo.imports ?? [])]
    const realPackageImports = [...(realPackageInfo.imports ?? [])]
    if (
      !importsMatchForFrontendBridge(
        packageImports,
        realPackageImports,
        isTinyGoRootStdlibPackage(
          packageInfo.standard ? 'stdlib' : '',
          packageInfo.dir ?? '',
          Boolean(packageInfo.standard) || Boolean(realPackageInfo.standard),
        ),
      )
    ) {
      throw new Error('frontend analysis packageGraph did not match real TinyGo analysis adapter')
    }
    const packageGoFiles = [...(packageInfo.files?.goFiles ?? [])].sort()
    let realPackageGoFiles: string[] = []
    if ('files' in realPackageInfo) {
      realPackageGoFiles = [...(realPackageInfo.files?.goFiles ?? [])].sort()
    }
    if (realPackageGoFiles.length === 0 && 'goFiles' in realPackageInfo) {
      realPackageGoFiles = [...(realPackageInfo.goFiles ?? [])].sort()
    }
    if (packageGoFiles.length !== realPackageGoFiles.length) {
      throw new Error('frontend analysis packageGraph did not match real TinyGo analysis adapter')
    }
    for (const [index, goFile] of packageGoFiles.entries()) {
      if (realPackageGoFiles[index] !== goFile) {
        throw new Error('frontend analysis packageGraph did not match real TinyGo analysis adapter')
      }
    }
    matchedRealImportPaths.add(realImportPath)
  }
  if (matchedRealImportPaths.size !== realPackageGraphByImportPath.size) {
    throw new Error('frontend analysis packageGraph did not match real TinyGo analysis adapter')
  }

  return {
    allCompileCount: allCompileFiles.length,
    compileGroupCount: selectedCompileGroupNames.length,
    compileUnitCount: compileUnits.length,
    entryFile: manifest.entryFile ?? '',
    gc: buildContext.gc ?? '',
    goarch: buildContext.goarch ?? '',
    goos: buildContext.goos ?? '',
    graphPackageCount: packageGraph.length,
    llvmTarget: manifestLLVMTarget,
    programImportAlias,
    scheduler: buildContext.scheduler ?? '',
    target: manifestTarget,
  }
}

export const verifyFrontendRealAdapterAgainstFrontendAnalysis = (
  manifest: TinyGoFrontendAnalysisManifest,
  analysisManifest: TinyGoFrontendAnalysisManifest,
) => verifyFrontendAnalysisAgainstRealDriverBridgeManifest(analysisManifest, {
  driverBuildTags: manifest.buildContext?.buildTags ?? analysisManifest.buildContext?.buildTags ?? [],
  frontendRealAdapter: manifest,
  gc: manifest.buildContext?.gc ?? analysisManifest.buildContext?.gc ?? '',
  goarch: manifest.buildContext?.goarch ?? analysisManifest.buildContext?.goarch ?? '',
  goos: manifest.buildContext?.goos ?? analysisManifest.buildContext?.goos ?? '',
  llvmTriple:
    manifest.toolchain?.llvmTarget ??
    manifest.buildContext?.llvmTarget ??
    analysisManifest.toolchain?.llvmTarget ??
    analysisManifest.buildContext?.llvmTarget ??
    '',
  scheduler: manifest.buildContext?.scheduler ?? analysisManifest.buildContext?.scheduler ?? '',
  target:
    manifest.toolchain?.target ??
    manifest.buildContext?.target ??
    analysisManifest.toolchain?.target ??
    analysisManifest.buildContext?.target ??
    '',
})

export const verifyCompileUnitManifestAgainstDriverBridgeManifest = (
  manifest: TinyGoCompileUnitManifest,
  bridgeManifest: TinyGoDriverBridgeManifest,
) => {
  const compileUnits = manifest.compileUnits ?? []
  const normalizedToolchain = normalizeCompileUnitToolchain(manifest)
  if ((bridgeManifest.target ?? '') === '' || (bridgeManifest.llvmTriple ?? '') === '') {
    throw new Error('real TinyGo driver bridge target facts were incomplete')
  }
  if (normalizedToolchain.target !== bridgeManifest.target) {
    throw new Error('frontend compile unit target did not match real TinyGo driver bridge')
  }
  if (normalizedToolchain.llvmTarget !== bridgeManifest.llvmTriple) {
    throw new Error('frontend compile unit target did not match real TinyGo driver bridge')
  }
  if ((bridgeManifest.artifactOutputPath ?? '') !== '' && normalizedToolchain.artifactOutputPath !== bridgeManifest.artifactOutputPath) {
    throw new Error('frontend compile unit artifact output did not match real TinyGo driver bridge')
  }
  if ((bridgeManifest.entryFile ?? '') !== '' && manifest.entryFile !== bridgeManifest.entryFile) {
    throw new Error('frontend compile unit entry file did not match real TinyGo driver bridge')
  }

  const programCompileUnits = compileUnits.filter((compileUnit) => compileUnit.kind === 'program')
  if (programCompileUnits.length !== 1) {
    throw new Error('frontend compile unit program package did not match real TinyGo driver bridge')
  }
  const programCompileUnit = programCompileUnits[0]
  const programFiles = [...(programCompileUnit.files ?? [])].sort()
  const sourceSelectionProgram = [...(manifest.sourceSelection?.program ?? programFiles)].sort()
  if (JSON.stringify(programFiles) !== JSON.stringify(sourceSelectionProgram)) {
    throw new Error('frontend compile unit program package did not match real TinyGo driver bridge')
  }

  const bridgeEntryPackage = bridgeManifest.entryPackage ?? {}
  const bridgeEntryGoFiles = ((bridgeEntryPackage.goFiles ?? []).map((file) => {
    if ((bridgeEntryPackage.dir ?? '') === '') {
      return file
    }
    return `${(bridgeEntryPackage.dir ?? '').replace(/\/$/, '')}/${file}`
  })).sort()
  if (
    (bridgeEntryPackage.importPath ?? '') !== '' &&
    (programCompileUnit.importPath ?? '') !== bridgeEntryPackage.importPath &&
    (programCompileUnit.importPath ?? '') !== 'command-line-arguments'
  ) {
    throw new Error('frontend compile unit program package did not match real TinyGo driver bridge')
  }
  if ((bridgeEntryPackage.name ?? '') !== '' && (programCompileUnit.packageName ?? '') !== bridgeEntryPackage.name) {
    throw new Error('frontend compile unit program package did not match real TinyGo driver bridge')
  }
  if ((bridgeEntryPackage.dir ?? '') !== '' && (programCompileUnit.packageDir ?? '') !== bridgeEntryPackage.dir) {
    throw new Error('frontend compile unit program package did not match real TinyGo driver bridge')
  }
  if ((bridgeEntryPackage.modulePath ?? '') !== '' && (programCompileUnit.modulePath ?? '') !== (bridgeEntryPackage.modulePath ?? '')) {
    throw new Error('frontend compile unit program package did not match real TinyGo driver bridge')
  }
  if (
    typeof programCompileUnit.depOnly === 'boolean' &&
    typeof bridgeEntryPackage.depOnly === 'boolean' &&
    programCompileUnit.depOnly !== bridgeEntryPackage.depOnly
  ) {
    throw new Error('frontend compile unit program package did not match real TinyGo driver bridge')
  }
  if (
    typeof programCompileUnit.standard === 'boolean' &&
    typeof bridgeEntryPackage.standard === 'boolean' &&
    programCompileUnit.standard !== bridgeEntryPackage.standard
  ) {
    throw new Error('frontend compile unit program package did not match real TinyGo driver bridge')
  }
  if (bridgeEntryGoFiles.length !== 0 && JSON.stringify(programFiles) !== JSON.stringify(bridgeEntryGoFiles)) {
    throw new Error('frontend compile unit program package did not match real TinyGo driver bridge')
  }
  const compileUnitFileCount = compileUnits.reduce((count, compileUnit) => count + (compileUnit.files ?? []).length, 0)
  const bridgeFileKeys = new Set<string>()
  for (const goFile of bridgeEntryPackage.goFiles ?? []) {
    const bridgeEntryImportPath = bridgeEntryPackage.importPath ?? programCompileUnit.importPath ?? 'command-line-arguments'
    bridgeFileKeys.add(`${bridgeEntryImportPath}\u0000${goFile}`)
  }
  for (const packageInfo of bridgeManifest.packageGraph ?? []) {
    const packageImportPath = packageInfo.importPath ?? ''
    if (packageImportPath === '') {
      continue
    }
    for (const goFile of packageInfo.goFiles ?? []) {
      bridgeFileKeys.add(`${packageImportPath}\u0000${goFile}`)
    }
  }
  let coveredFileCount = bridgeEntryGoFiles.length !== 0 ? programFiles.length : 0
  const compileUnitImportPaths = compileUnits
    .filter((compileUnit) => compileUnit.kind !== 'program')
    .map((compileUnit) => compileUnit.importPath ?? '')
    .filter((importPath) => importPath !== '')
    .sort()
  const bridgeEntryImports = [...(bridgeEntryPackage.imports ?? [])].sort()
  const availableCompileUnitImports = new Set(compileUnitImportPaths)
  for (const importPath of bridgeEntryImports) {
    if (!availableCompileUnitImports.has(importPath)) {
      throw new Error('frontend compile unit imports did not cover real TinyGo driver bridge imports')
    }
  }
  const bridgePackageGraphImportPaths = [...new Set((bridgeManifest.packageGraph ?? [])
    .map((packageInfo) => packageInfo.importPath ?? '')
    .filter((importPath) => importPath !== '' && importPath !== (bridgeEntryPackage.importPath ?? '')))].sort()
  if (bridgePackageGraphImportPaths.length !== 0) {
    const availableBridgePackages = new Map(
      (bridgeManifest.packageGraph ?? [])
        .map((packageInfo) => [packageInfo.importPath ?? '', packageInfo] as const)
        .filter(([importPath]) => importPath !== ''),
    )
    for (const compileUnit of compileUnits.filter((candidate) => candidate.kind !== 'program')) {
      const compileUnitImportPath = compileUnit.importPath ?? ''
      if (compileUnitImportPath === '') {
        throw new Error('frontend compile unit package graph did not match real TinyGo driver bridge')
      }
      const bridgePackage = availableBridgePackages.get(compileUnitImportPath)
      if (!bridgePackage) {
        throw new Error('frontend compile unit package graph did not match real TinyGo driver bridge')
      }
      if (Array.isArray(compileUnit.imports)) {
        const compileUnitDirectImports = [...compileUnit.imports].sort()
        const bridgePackageDirectImports = [...(bridgePackage.imports ?? [])].sort()
        if ((compileUnit.kind ?? '') === 'stdlib' || (compileUnit.packageDir ?? '').startsWith('/working/.tinygo-root/')) {
          const availableBridgeImports = new Set(bridgePackageDirectImports)
          for (const importPath of compileUnitDirectImports) {
            if (!availableBridgeImports.has(importPath)) {
              throw new Error('frontend compile unit package graph did not match real TinyGo driver bridge')
            }
          }
        } else if (JSON.stringify(compileUnitDirectImports) !== JSON.stringify(bridgePackageDirectImports)) {
          throw new Error('frontend compile unit package graph did not match real TinyGo driver bridge')
        }
      }
      if ((bridgePackage.name ?? '') !== '' && (compileUnit.packageName ?? '') !== bridgePackage.name) {
        throw new Error('frontend compile unit package graph did not match real TinyGo driver bridge')
      }
      if ((bridgePackage.modulePath ?? '') !== '' && (compileUnit.modulePath ?? '') !== (bridgePackage.modulePath ?? '')) {
        throw new Error('frontend compile unit package graph did not match real TinyGo driver bridge')
      }
      if (
        typeof compileUnit.depOnly === 'boolean' &&
        typeof bridgePackage.depOnly === 'boolean' &&
        compileUnit.depOnly !== bridgePackage.depOnly
      ) {
        throw new Error('frontend compile unit package graph did not match real TinyGo driver bridge')
      }
      if (
        typeof compileUnit.standard === 'boolean' &&
        typeof bridgePackage.standard === 'boolean' &&
        compileUnit.standard !== bridgePackage.standard
      ) {
        throw new Error('frontend compile unit package graph did not match real TinyGo driver bridge')
      }
      if (
        (compileUnit.packageDir ?? '') !== '' &&
        !(compileUnit.packageDir ?? '').startsWith('/working/.tinygo-root/') &&
        (bridgePackage.dir ?? '') !== '' &&
        (compileUnit.packageDir ?? '') !== bridgePackage.dir
      ) {
        throw new Error('frontend compile unit package graph did not match real TinyGo driver bridge')
      }
      if (
        !(compileUnit.packageDir ?? '').startsWith('/working/.tinygo-root/') &&
        Array.isArray(compileUnit.files) &&
        Array.isArray(bridgePackage.goFiles) &&
        (bridgePackage.dir ?? '') !== '' &&
        bridgePackage.goFiles.length !== 0
      ) {
        const bridgePackageFiles = bridgePackage.goFiles
          .map((file) => `${(bridgePackage.dir ?? '').replace(/\/$/, '')}/${file}`)
          .sort()
        const compileUnitFiles = [...compileUnit.files].sort()
        if (JSON.stringify(compileUnitFiles) !== JSON.stringify(bridgePackageFiles)) {
          throw new Error('frontend compile unit package graph did not match real TinyGo driver bridge')
        }
        coveredFileCount += compileUnit.files.length
      } else if (Array.isArray(compileUnit.files) && Array.isArray(bridgePackage.goFiles) && bridgePackage.goFiles.length !== 0) {
        const bridgePackageFileNames = new Set(bridgePackage.goFiles)
        const compileUnitFileNames = compileUnit.files
          .map((file) => {
            const slashIndex = file.lastIndexOf('/')
            return slashIndex >= 0 ? file.slice(slashIndex + 1) : file
          })
          .sort()
        for (const fileName of compileUnitFileNames) {
          if (!bridgePackageFileNames.has(fileName)) {
            throw new Error('frontend compile unit package graph did not match real TinyGo driver bridge')
          }
        }
        coveredFileCount += compileUnit.files.length
      }
    }
  }
  const bridgeGraphPackages = bridgeManifest.packageGraph ?? []
  const graphPackageCount =
    bridgeGraphPackages.length !== 0
      ? bridgeGraphPackages.length
      : ((bridgeEntryPackage.importPath ?? '') !== '' ? 1 : 0) + bridgePackageGraphImportPaths.length
  const programImportAlias =
    (programCompileUnit.importPath ?? '') === 'command-line-arguments' &&
    (bridgeEntryPackage.importPath ?? '') !== '' &&
    (programCompileUnit.importPath ?? '') !== bridgeEntryPackage.importPath
      ? 'synthetic'
      : 'direct'

  return {
    artifactOutputPath: normalizedToolchain.artifactOutputPath,
    bridgeEntryGoFiles,
    bridgeEntryImportPath: bridgeEntryPackage.importPath ?? '',
    bridgeEntryImports,
    bridgeEntryPackageDir: bridgeEntryPackage.dir ?? '',
    bridgeEntryPackageName: bridgeEntryPackage.name ?? '',
    bridgeFileCount: bridgeFileKeys.size,
    bridgePackageCount: bridgePackageGraphImportPaths.length,
    bridgePackageGraphImportPaths,
    compileUnitCount: compileUnits.length,
    compileUnitFileCount,
    compileUnitImportPaths,
    coveredFileCount,
    coveredPackageCount: compileUnitImportPaths.length,
    depOnlyPackageCount: bridgeGraphPackages.filter((packageInfo) => packageInfo.depOnly === true).length,
    entryFile: manifest.entryFile ?? '',
    graphPackageCount,
    llvmTarget: normalizedToolchain.llvmTarget,
    localPackageCount: compileUnits.filter((compileUnit) => (compileUnit.kind ?? '') !== 'stdlib').length,
    programImportAlias,
    programFiles,
    programImportPath: programCompileUnit.importPath ?? '',
    programPackageDir: programCompileUnit.packageDir ?? '',
    programPackageName: programCompileUnit.packageName ?? '',
    standardPackageCount: bridgeGraphPackages.filter((packageInfo) => packageInfo.standard === true).length,
    target: normalizedToolchain.target,
  }
}

export const verifyCompileUnitManifestAgainstCompileRequest = (
  manifest: TinyGoCompileUnitManifest,
  compileRequest: TinyGoCompileRequestContract,
) => {
  const rawManifest = manifest as Record<string, unknown>
  for (const field of [
    'target',
    'llvmTarget',
    'linker',
    'cflags',
    'ldflags',
    'translationUnitPath',
    'objectOutputPath',
    'artifactOutputPath',
  ]) {
    if (field in rawManifest) {
      throw new Error('frontend compile unit legacy top-level toolchain fields are not supported')
    }
  }
  for (const field of [
    'programFiles',
    'importedPackageFiles',
    'stdlibPackageFiles',
    'allCompileFiles',
    'targetAssetFiles',
    'runtimeSupportFiles',
  ]) {
    if (field in rawManifest) {
      throw new Error('frontend compile unit legacy top-level source-file groups are not supported')
    }
  }
  const normalizedToolchain = normalizeCompileUnitToolchain(manifest)
  if (compileRequest.entryFile !== undefined && manifest.entryFile !== compileRequest.entryFile) {
    throw new Error('frontend compile unit entry file did not match compile request')
  }

  if (
    (compileRequest.cflags !== undefined && JSON.stringify(normalizedToolchain.cflags) !== JSON.stringify(compileRequest.cflags)) ||
    (compileRequest.ldflags !== undefined && JSON.stringify(normalizedToolchain.ldflags) !== JSON.stringify(compileRequest.ldflags)) ||
    (compileRequest.target !== undefined && normalizedToolchain.target !== compileRequest.target) ||
    (compileRequest.llvmTarget !== undefined && normalizedToolchain.llvmTarget !== compileRequest.llvmTarget) ||
    (compileRequest.linker !== undefined && normalizedToolchain.linker !== compileRequest.linker) ||
    (compileRequest.translationUnitPath !== undefined &&
      normalizedToolchain.translationUnitPath !== compileRequest.translationUnitPath) ||
    (compileRequest.objectOutputPath !== undefined &&
      normalizedToolchain.objectOutputPath !== compileRequest.objectOutputPath) ||
    (compileRequest.artifactOutputPath !== undefined &&
      normalizedToolchain.artifactOutputPath !== compileRequest.artifactOutputPath)
  ) {
    throw new Error('frontend compile unit toolchain did not match compile request')
  }

  if (
    typeof manifest.entryFile !== 'string' ||
    manifest.entryFile === '' ||
    !Array.isArray(manifest.sourceSelection?.allCompile) ||
    !Array.isArray(manifest.materializedFiles)
  ) {
    throw new Error('frontend compile unit source selection was missing normalized compile inputs')
  }

  const materializedFiles = manifest.materializedFiles
  const allCompileFiles = manifest.sourceSelection.allCompile
  const entryPackageDir = manifest.entryFile.slice(0, manifest.entryFile.lastIndexOf('/')) || '.'
  const compileUnits =
    Array.isArray(manifest.compileUnits) && manifest.compileUnits.length !== 0
      ? manifest.compileUnits.map((compileUnit) => ({
          kind: compileUnit.kind ?? '',
          importPath: compileUnit.importPath ?? '',
          ...(Array.isArray(compileUnit.imports) ? { imports: [...compileUnit.imports] } : {}),
          modulePath: compileUnit.modulePath ?? '',
          ...(typeof compileUnit.depOnly === 'boolean' ? { depOnly: compileUnit.depOnly } : {}),
          packageName: compileUnit.packageName ?? '',
          packageDir: compileUnit.packageDir ?? '',
          files: compileUnit.files ?? [],
          ...(typeof compileUnit.standard === 'boolean' ? { standard: compileUnit.standard } : {}),
        }))
      : []
  const programFiles: string[] = []
  const importedPackageFiles: string[] = []
  const stdlibPackageFiles: string[] = []
  if (compileUnits.length !== 0) {
    const allCompileFileSet = new Set(allCompileFiles)
    const seenCompileFiles = new Set<string>()
    for (const compileUnit of compileUnits) {
      if (
        compileUnit.kind === '' ||
        compileUnit.importPath === '' ||
        compileUnit.packageName === '' ||
        compileUnit.packageDir === '' ||
        !Array.isArray(compileUnit.files) ||
        compileUnit.files.length === 0 ||
        (compileUnit.imports !== undefined &&
          (!Array.isArray(compileUnit.imports) || compileUnit.imports.some((importPath) => importPath === '')))
      ) {
        throw new Error('frontend compile unit source selection was missing normalized compile inputs')
      }
      for (const filePath of compileUnit.files) {
        const slashIndex = filePath.lastIndexOf('/')
        const fileDir = slashIndex > 0 ? filePath.slice(0, slashIndex) : ''
        if (fileDir !== compileUnit.packageDir || !allCompileFileSet.has(filePath) || seenCompileFiles.has(filePath)) {
          throw new Error('frontend compile unit source selection was missing normalized compile inputs')
        }
        seenCompileFiles.add(filePath)
      }
      if (compileUnit.kind === 'program') {
        programFiles.push(...compileUnit.files)
        continue
      }
      if (compileUnit.kind === 'imported') {
        importedPackageFiles.push(...compileUnit.files)
        continue
      }
      if (compileUnit.kind === 'stdlib') {
        stdlibPackageFiles.push(...compileUnit.files)
        continue
      }
      throw new Error('frontend compile unit source selection was missing normalized compile inputs')
    }
    if (seenCompileFiles.size !== allCompileFiles.length || !programFiles.includes(manifest.entryFile)) {
      throw new Error('frontend compile unit source selection was missing normalized compile inputs')
    }
  } else {
    stdlibPackageFiles.push(
      ...(Array.isArray(manifest.sourceSelection?.stdlib)
        ? manifest.sourceSelection.stdlib
        : allCompileFiles.filter((filePath) => {
            return filePath.startsWith('/working/.tinygo-root/src/')
          })),
    )
    importedPackageFiles.push(
      ...(Array.isArray(manifest.sourceSelection?.imported)
        ? manifest.sourceSelection.imported
        : allCompileFiles.filter((filePath) => {
            if (stdlibPackageFiles.includes(filePath)) {
              return false
            }
            const slashIndex = filePath.lastIndexOf('/')
            const fileDir = slashIndex > 0 ? filePath.slice(0, slashIndex) : ''
            return fileDir !== entryPackageDir
          })),
    )
    programFiles.push(
      ...(Array.isArray(manifest.sourceSelection?.program)
        ? manifest.sourceSelection.program
        : allCompileFiles.filter((filePath) => {
            if (importedPackageFiles.includes(filePath) || stdlibPackageFiles.includes(filePath)) {
              return false
            }
            const slashIndex = filePath.lastIndexOf('/')
            const fileDir = slashIndex > 0 ? filePath.slice(0, slashIndex) : ''
            return fileDir === entryPackageDir
          })),
    )
  }
  const targetAssetFiles = Array.isArray(manifest.sourceSelection?.targetAssets)
    ? manifest.sourceSelection.targetAssets
    : materializedFiles.filter((filePath) => filePath.startsWith('/working/.tinygo-root/targets/'))
  const generatedFileSet = new Set<string>([
    normalizedToolchain.translationUnitPath,
    '/working/tinygo-compile-unit.json',
  ])
  const stdlibFileSet = new Set<string>(stdlibPackageFiles)
  const targetAssetSet = new Set<string>(targetAssetFiles)
  const runtimeSupportFiles = Array.isArray(manifest.sourceSelection?.runtimeSupport)
    ? manifest.sourceSelection.runtimeSupport
    : materializedFiles.filter((filePath) => {
        if (generatedFileSet.has(filePath) || stdlibFileSet.has(filePath) || targetAssetSet.has(filePath)) {
          return false
        }
        return true
      })

  if (
    (compileRequest.targetAssetFiles !== undefined &&
      JSON.stringify(targetAssetFiles) !== JSON.stringify(compileRequest.targetAssetFiles)) ||
    (compileRequest.runtimeSupportFiles !== undefined &&
      JSON.stringify(runtimeSupportFiles) !== JSON.stringify(compileRequest.runtimeSupportFiles)) ||
    (compileRequest.programFiles !== undefined && JSON.stringify(programFiles) !== JSON.stringify(compileRequest.programFiles)) ||
    (compileRequest.importedPackageFiles !== undefined &&
      JSON.stringify(importedPackageFiles) !== JSON.stringify(compileRequest.importedPackageFiles)) ||
    (compileRequest.stdlibPackageFiles !== undefined &&
      JSON.stringify(stdlibPackageFiles) !== JSON.stringify(compileRequest.stdlibPackageFiles)) ||
    (compileRequest.allCompileFiles !== undefined &&
      JSON.stringify(allCompileFiles) !== JSON.stringify(compileRequest.allCompileFiles))
  ) {
    throw new Error('frontend compile unit source selection did not match compile request')
  }

  const toolPlan = buildToolPlanFromCompileUnitManifest(manifest)
  if (compileRequest.toolPlan?.length && JSON.stringify(toolPlan) !== JSON.stringify(compileRequest.toolPlan)) {
    throw new Error('frontend compile unit tool plan did not match compile request')
  }

  if (compileUnits.length === 0) {
    compileUnits.push({
      kind: 'program',
      importPath: 'command-line-arguments',
      modulePath: '',
      packageName: 'main',
      packageDir: entryPackageDir,
      files: [...programFiles],
    })
    for (const [kind, files] of [
      ['imported', importedPackageFiles],
      ['stdlib', stdlibPackageFiles],
    ] as const) {
      const groupedFiles = new Map<string, string[]>()
      for (const filePath of files) {
        const slashIndex = filePath.lastIndexOf('/')
        const packageDir = slashIndex > 0 ? filePath.slice(0, slashIndex) : ''
        const packageFiles = groupedFiles.get(packageDir)
        if (packageFiles) {
          packageFiles.push(filePath)
          continue
        }
        groupedFiles.set(packageDir, [filePath])
      }
      const packageDirs = [...groupedFiles.keys()].sort()
      for (const packageDir of packageDirs) {
        const packageName = packageDir.slice(packageDir.lastIndexOf('/') + 1) || packageDir
        compileUnits.push({
          kind,
          importPath: packageName,
          modulePath: '',
          packageName,
          packageDir,
          files: groupedFiles.get(packageDir) ?? [],
        })
      }
    }
  }

  return {
    toolPlan,
    toolchain: normalizedToolchain,
    sourceSelection: {
      targetAssets: targetAssetFiles,
      runtimeSupport: runtimeSupportFiles,
      program: programFiles,
      imported: importedPackageFiles,
      stdlib: stdlibPackageFiles,
      allCompile: allCompileFiles,
    },
    compileUnits,
    summary: {
      programCount: programFiles.length,
      importedCount: importedPackageFiles.length,
      stdlibCount: stdlibPackageFiles.length,
      allCompileCount: allCompileFiles.length,
    },
  }
}

export const verifyIntermediateManifestAgainstCompileUnitManifest = (
  compileUnitManifest: TinyGoCompileUnitManifest,
  intermediateManifest: TinyGoIntermediateManifest,
) => {
  const compileUnitVerification = verifyCompileUnitManifestAgainstCompileRequest(compileUnitManifest, {})

  if (compileUnitManifest.entryFile !== intermediateManifest.entryFile) {
    throw new Error('frontend intermediate entry file did not match compile unit manifest')
  }
  if ((compileUnitManifest.optimizeFlag ?? '') !== (intermediateManifest.optimizeFlag ?? '')) {
    throw new Error('frontend intermediate optimize flag did not match compile unit manifest')
  }
  if (JSON.stringify(compileUnitVerification.toolchain) !== JSON.stringify(intermediateManifest.toolchain ?? {})) {
    throw new Error('frontend intermediate toolchain did not match compile unit manifest')
  }
  if (JSON.stringify(compileUnitVerification.sourceSelection) !== JSON.stringify(intermediateManifest.sourceSelection ?? {})) {
    throw new Error('frontend intermediate source selection did not match compile unit manifest')
  }
  if (JSON.stringify(compileUnitVerification.compileUnits) !== JSON.stringify(intermediateManifest.compileUnits ?? [])) {
    throw new Error('frontend intermediate compile units did not match compile unit manifest')
  }

  return compileUnitVerification
}

export const verifyLoweringManifestAgainstIntermediateManifest = (
  intermediateManifest: TinyGoIntermediateManifest,
  loweringManifest: TinyGoLoweringManifest,
) => {
  if ((intermediateManifest.entryFile ?? '') !== (loweringManifest.entryFile ?? '')) {
    throw new Error('frontend lowering entry file did not match intermediate manifest')
  }
  if ((intermediateManifest.optimizeFlag ?? '') !== (loweringManifest.optimizeFlag ?? '')) {
    throw new Error('frontend lowering optimize flag did not match intermediate manifest')
  }
  if (JSON.stringify(intermediateManifest.toolchain ?? {}) !== JSON.stringify(loweringManifest.toolchain ?? {})) {
    throw new Error('frontend lowering toolchain did not match intermediate manifest')
  }

  const support = {
    targetAssets: intermediateManifest.sourceSelection?.targetAssets ?? [],
    runtimeSupport: intermediateManifest.sourceSelection?.runtimeSupport ?? [],
  }
  if (JSON.stringify(support) !== JSON.stringify(loweringManifest.support ?? {})) {
    throw new Error('frontend lowering support files did not match intermediate manifest')
  }
  if (JSON.stringify(intermediateManifest.compileUnits ?? []) !== JSON.stringify(loweringManifest.compileUnits ?? [])) {
    throw new Error('frontend lowering compile units did not match intermediate manifest')
  }

  return {
    toolchain: intermediateManifest.toolchain ?? {},
    support,
    compileUnits: intermediateManifest.compileUnits ?? [],
  }
}

export const verifyWorkItemsManifestAgainstLoweringManifest = (
  loweringManifest: TinyGoLoweringManifest,
  workItemsManifest: TinyGoWorkItemsManifest,
) => {
  if ((loweringManifest.entryFile ?? '') !== (workItemsManifest.entryFile ?? '')) {
    throw new Error('frontend work items entry file did not match lowering manifest')
  }
  if ((loweringManifest.optimizeFlag ?? '') !== (workItemsManifest.optimizeFlag ?? '')) {
    throw new Error('frontend work items optimize flag did not match lowering manifest')
  }
  if (JSON.stringify(loweringManifest.toolchain ?? {}) !== JSON.stringify(workItemsManifest.toolchain ?? {})) {
    throw new Error('frontend work items toolchain did not match lowering manifest')
  }

  const kindIndexes = new Map<string, number>()
  const workItems = (loweringManifest.compileUnits ?? []).map((compileUnit) => {
    const kind = compileUnit.kind ?? ''
    const kindIndex = kindIndexes.get(kind) ?? 0
    kindIndexes.set(kind, kindIndex + 1)
    const id = `${kind}-${String(kindIndex).padStart(3, '0')}`
    const packageFacts = normalizePackageFactsByKind(kind, compileUnit.depOnly, compileUnit.standard)
    return {
      id,
      kind,
      importPath: compileUnit.importPath ?? '',
      imports: Array.isArray(compileUnit.imports) ? [...compileUnit.imports] : [],
      depOnly: packageFacts.depOnly,
      modulePath: compileUnit.modulePath ?? '',
      packageName: compileUnit.packageName ?? '',
      packageDir: compileUnit.packageDir ?? '',
      files: compileUnit.files ?? [],
      bitcodeOutputPath: `/working/tinygo-work/${id}.bc`,
      standard: packageFacts.standard,
    }
  })
  const normalizedWorkItems = (workItemsManifest.workItems ?? []).map((workItem) => {
    const packageFacts = normalizePackageFactsByKind(workItem.kind ?? '', workItem.depOnly, workItem.standard)
    return {
      id: workItem.id ?? '',
      kind: workItem.kind ?? '',
      importPath: workItem.importPath ?? '',
      imports: Array.isArray(workItem.imports) ? [...workItem.imports] : [],
      depOnly: packageFacts.depOnly,
      modulePath: workItem.modulePath ?? '',
      packageName: workItem.packageName ?? '',
      packageDir: workItem.packageDir ?? '',
      files: workItem.files ?? [],
      bitcodeOutputPath: workItem.bitcodeOutputPath ?? '',
      standard: packageFacts.standard,
    }
  })
  if (JSON.stringify(workItems) !== JSON.stringify(normalizedWorkItems)) {
    throw new Error('frontend work items did not match lowering manifest')
  }

  return {
    toolchain: loweringManifest.toolchain ?? {},
    workItems,
  }
}

export const verifyLoweredSourcesManifestAgainstWorkItemsManifest = (
  workItemsManifest: TinyGoWorkItemsManifest,
  loweredSourcesManifest: TinyGoLoweredSourcesManifest,
) => {
  if ((workItemsManifest.entryFile ?? '') !== (loweredSourcesManifest.entryFile ?? '')) {
    throw new Error('frontend lowered sources entry file did not match work items manifest')
  }
  if ((workItemsManifest.optimizeFlag ?? '') !== (loweredSourcesManifest.optimizeFlag ?? '')) {
    throw new Error('frontend lowered sources optimize flag did not match work items manifest')
  }

  const units = (workItemsManifest.workItems ?? []).map((workItem) => {
    const packageFacts = normalizePackageFactsByKind(workItem.kind ?? '', workItem.depOnly, workItem.standard)
    return {
      id: workItem.id ?? '',
      kind: workItem.kind ?? '',
      importPath: workItem.importPath ?? '',
      imports: Array.isArray(workItem.imports) ? [...workItem.imports] : [],
      depOnly: packageFacts.depOnly,
      modulePath: workItem.modulePath ?? '',
      packageName: workItem.packageName ?? '',
      packageDir: workItem.packageDir ?? '',
      sourceFiles: workItem.files ?? [],
      loweredSourcePath: `/working/tinygo-lowered/${workItem.id ?? ''}.c`,
      standard: packageFacts.standard,
    }
  })
  const normalizedUnits = (loweredSourcesManifest.units ?? []).map((unit) => {
    const packageFacts = normalizePackageFactsByKind(unit.kind ?? '', unit.depOnly, unit.standard)
    return {
      id: unit.id ?? '',
      kind: unit.kind ?? '',
      importPath: unit.importPath ?? '',
      imports: Array.isArray(unit.imports) ? [...unit.imports] : [],
      depOnly: packageFacts.depOnly,
      modulePath: unit.modulePath ?? '',
      packageName: unit.packageName ?? '',
      packageDir: unit.packageDir ?? '',
      sourceFiles: unit.sourceFiles ?? [],
      loweredSourcePath: unit.loweredSourcePath ?? '',
      standard: packageFacts.standard,
    }
  })
  if (JSON.stringify(units) !== JSON.stringify(normalizedUnits)) {
    throw new Error('frontend lowered sources did not match work items manifest')
  }

  return {
    units,
  }
}

export const verifyLoweredCommandBatchAgainstCompileUnitAndLoweredSourcesManifest = (
  compileUnitManifest: TinyGoCompileUnitManifest,
  loweredSourcesManifest: TinyGoLoweredSourcesManifest,
  commandBatchManifest: TinyGoCommandBatchManifest,
) => {
  if ((compileUnitManifest.entryFile ?? '') !== (loweredSourcesManifest.entryFile ?? '')) {
    throw new Error('frontend lowered command batch entry file did not match compile-unit and lowered sources manifests')
  }
  if ((compileUnitManifest.optimizeFlag ?? '') !== (loweredSourcesManifest.optimizeFlag ?? '')) {
    throw new Error('frontend lowered command batch optimize flag did not match compile-unit and lowered sources manifests')
  }

  const normalizedToolchain = normalizeCompileUnitToolchain(compileUnitManifest)
  const compileCommands = (loweredSourcesManifest.units ?? []).map((unit) => {
    const loweredSourcePath = unit.loweredSourcePath ?? ''
    const objectOutputPath = loweredSourcePath.endsWith('.c') ? `${loweredSourcePath.slice(0, -2)}.o` : `${loweredSourcePath}.o`
    return {
      argv: [
        '/usr/bin/clang',
        `--target=${normalizedToolchain.llvmTarget}`,
        ...(compileUnitManifest.optimizeFlag ? [compileUnitManifest.optimizeFlag] : []),
        ...normalizedToolchain.cflags,
        '-c',
        loweredSourcePath,
        '-o',
        objectOutputPath,
      ],
      cwd: '/working',
    }
  })
  if (JSON.stringify(compileCommands) !== JSON.stringify(commandBatchManifest.compileCommands ?? [])) {
    throw new Error('frontend lowered command batch compile commands did not match compile-unit and lowered sources manifests')
  }

  const linkCommand = {
    argv: [
      `/usr/bin/${normalizedToolchain.linker}`,
      ...normalizeProbeLdflags(normalizedToolchain.ldflags),
      ...(loweredSourcesManifest.units ?? []).map((unit) => {
        const loweredSourcePath = unit.loweredSourcePath ?? ''
        return loweredSourcePath.endsWith('.c') ? `${loweredSourcePath.slice(0, -2)}.o` : `${loweredSourcePath}.o`
      }),
      '-o',
      '/working/tinygo-lowered-out.wasm',
    ],
    cwd: '/working',
  }
  if (JSON.stringify(linkCommand) !== JSON.stringify(commandBatchManifest.linkCommand ?? {})) {
    throw new Error('frontend lowered command batch link command did not match compile-unit and lowered sources manifests')
  }

  return {
    compileCommands,
    linkCommand,
  }
}

export const verifyLoweredArtifactManifestAgainstLoweredCommandBatchManifest = (
  commandBatchManifest: TinyGoCommandBatchManifest,
  loweredArtifactManifest: TinyGoLoweredArtifactManifest,
) => {
  const linkArgv = commandBatchManifest.linkCommand?.argv ?? []
  const artifactOutputPath = linkArgv.length >= 2 ? linkArgv[linkArgv.length - 1] ?? '' : ''
  const objectFiles = (commandBatchManifest.compileCommands ?? []).map((command) => {
    const argv = command.argv ?? []
    return argv.length >= 2 ? argv[argv.length - 1] ?? '' : ''
  })

  if (artifactOutputPath !== (loweredArtifactManifest.artifactOutputPath ?? '')) {
    throw new Error('frontend lowered artifact manifest did not match lowered command batch manifest')
  }
  if (JSON.stringify(objectFiles) !== JSON.stringify(loweredArtifactManifest.objectFiles ?? [])) {
    throw new Error('frontend lowered artifact manifest did not match lowered command batch manifest')
  }
  const artifactFacts = (() => {
    const artifactKind = loweredArtifactManifest.artifactKind ?? 'probe'
    const entrypoint = loweredArtifactManifest.entrypoint ?? null
    const reason = loweredArtifactManifest.reason
    const runnable = loweredArtifactManifest.runnable ?? false
    if (artifactKind === 'execution') {
      if (entrypoint !== '_start' && entrypoint !== '_initialize' && entrypoint !== 'main') {
        throw new Error('frontend lowered artifact manifest did not match lowered command batch manifest')
      }
      if (reason !== undefined) {
        throw new Error('frontend lowered artifact manifest did not match lowered command batch manifest')
      }
      if (runnable !== true) {
        throw new Error('frontend lowered artifact manifest did not match lowered command batch manifest')
      }
      return {
        artifactKind: 'execution' as const,
        entrypoint,
        reason: undefined,
        runnable: true,
      }
    }
    if (artifactKind !== 'probe') {
      throw new Error('frontend lowered artifact manifest did not match lowered command batch manifest')
    }
    if (entrypoint !== null) {
      throw new Error('frontend lowered artifact manifest did not match lowered command batch manifest')
    }
    if ((reason ?? 'missing-wasi-entrypoint') !== 'missing-wasi-entrypoint') {
      throw new Error('frontend lowered artifact manifest did not match lowered command batch manifest')
    }
    if (runnable !== false) {
      throw new Error('frontend lowered artifact manifest did not match lowered command batch manifest')
    }
    return {
      artifactKind: 'probe' as const,
      entrypoint: null,
      reason: 'missing-wasi-entrypoint' as const,
      runnable: false,
    }
  })()

  return {
    artifactOutputPath,
    artifactKind: artifactFacts.artifactKind,
    entrypoint: artifactFacts.entrypoint,
    objectFiles,
    reason: artifactFacts.reason,
    runnable: artifactFacts.runnable,
  }
}

export const verifyLoweringPlanAgainstWorkItemsManifest = (
  workItemsManifest: TinyGoWorkItemsManifest,
  loweringPlanManifest: TinyGoLoweringPlanManifest,
) => {
  if ((workItemsManifest.entryFile ?? '') !== (loweringPlanManifest.entryFile ?? '')) {
    throw new Error('frontend lowering plan entry file did not match work items manifest')
  }
  if ((workItemsManifest.optimizeFlag ?? '') !== (loweringPlanManifest.optimizeFlag ?? '')) {
    throw new Error('frontend lowering plan optimize flag did not match work items manifest')
  }

  const compileJobs = (workItemsManifest.workItems ?? []).map((workItem) => {
    const packageFacts = normalizePackageFactsByKind(workItem.kind ?? '', workItem.depOnly, workItem.standard)
    return {
      id: workItem.id ?? '',
      kind: workItem.kind ?? '',
      importPath: workItem.importPath ?? '',
      imports: Array.isArray(workItem.imports) ? [...workItem.imports] : [],
      depOnly: packageFacts.depOnly,
      modulePath: workItem.modulePath ?? '',
      packageName: workItem.packageName ?? '',
      packageDir: workItem.packageDir ?? '',
      files: workItem.files ?? [],
      bitcodeOutputPath: workItem.bitcodeOutputPath ?? '',
      llvmTarget: 'wasm32-unknown-wasi',
      cflags: ['-mbulk-memory', '-mnontrapping-fptoint', '-mno-multivalue', '-mno-reference-types', '-msign-ext'],
      optimizeFlag: workItemsManifest.optimizeFlag ?? '',
      standard: packageFacts.standard,
    }
  })
  const normalizedCompileJobs = (loweringPlanManifest.compileJobs ?? []).map((compileJob) => {
    const packageFacts = normalizePackageFactsByKind(compileJob.kind ?? '', compileJob.depOnly, compileJob.standard)
    return {
      id: compileJob.id ?? '',
      kind: compileJob.kind ?? '',
      importPath: compileJob.importPath ?? '',
      imports: Array.isArray(compileJob.imports) ? [...compileJob.imports] : [],
      depOnly: packageFacts.depOnly,
      modulePath: compileJob.modulePath ?? '',
      packageName: compileJob.packageName ?? '',
      packageDir: compileJob.packageDir ?? '',
      files: compileJob.files ?? [],
      bitcodeOutputPath: compileJob.bitcodeOutputPath ?? '',
      llvmTarget: compileJob.llvmTarget ?? '',
      cflags: compileJob.cflags ?? [],
      optimizeFlag: compileJob.optimizeFlag ?? '',
      standard: packageFacts.standard,
    }
  })
  if (JSON.stringify(compileJobs) !== JSON.stringify(normalizedCompileJobs)) {
    throw new Error('frontend lowering plan compile jobs did not match work items manifest')
  }

  const workItemsToolchain = workItemsManifest.toolchain ?? {}
  const linkJob = {
    linker: workItemsToolchain.linker ?? 'wasm-ld',
    ldflags: normalizeProbeLdflags(workItemsToolchain.ldflags ?? []),
    artifactOutputPath: workItemsToolchain.artifactOutputPath ?? '/working/out.wasm',
    bitcodeInputs: compileJobs.map((job) => job.bitcodeOutputPath),
  }
  if (JSON.stringify(linkJob) !== JSON.stringify(loweringPlanManifest.linkJob ?? {})) {
    throw new Error('frontend lowering plan link job did not match work items manifest')
  }
  const executionLinkJob = {
    linker: workItemsToolchain.linker ?? 'wasm-ld',
    ldflags: workItemsToolchain.ldflags ?? [],
    artifactOutputPath: workItemsToolchain.artifactOutputPath ?? '/working/out.wasm',
    bitcodeInputs: compileJobs.map((job) => job.bitcodeOutputPath),
  }
  if (JSON.stringify(executionLinkJob) !== JSON.stringify(loweringPlanManifest.executionLinkJob ?? {})) {
    throw new Error('frontend lowering plan execution link job did not match work items manifest')
  }

  return {
    compileJobs,
    linkJob,
    executionLinkJob,
  }
}

const deriveLoweredUnitsFromBackendInputManifest = (
  backendInputManifest: TinyGoBackendInputManifest,
  errorMessage: string,
) => {
  const loweredUnits = (backendInputManifest.compileJobs ?? []).map((compileJob) => {
    const id = compileJob.id ?? ''
    const kind = compileJob.kind ?? ''
    const importPath = compileJob.importPath ?? ''
    const packageFacts = normalizePackageFactsByKind(kind, compileJob.depOnly, compileJob.standard)
    const packageName = compileJob.packageName ?? ''
    const packageDir = compileJob.packageDir ?? ''
    const sourceFiles = compileJob.files ?? []
    if (id === '' || kind === '' || packageDir === '' || sourceFiles.length === 0) {
      throw new Error(errorMessage)
    }
    return {
      id,
      kind,
      importPath,
      imports: Array.isArray(compileJob.imports) ? [...compileJob.imports] : [],
      depOnly: packageFacts.depOnly,
      modulePath: compileJob.modulePath ?? '',
      packageName,
      packageDir,
      sourceFiles,
      loweredSourcePath: `/working/tinygo-lowered/${id}.c`,
      standard: packageFacts.standard,
    }
  })
  const normalizedLoweredUnits = (backendInputManifest.loweredUnits ?? []).map((loweredUnit) => {
    const packageFacts = normalizePackageFactsByKind(loweredUnit.kind ?? '', loweredUnit.depOnly, loweredUnit.standard)
    return {
      id: loweredUnit.id ?? '',
      kind: loweredUnit.kind ?? '',
      importPath: loweredUnit.importPath ?? '',
      imports: Array.isArray(loweredUnit.imports) ? [...loweredUnit.imports] : [],
      depOnly: packageFacts.depOnly,
      modulePath: loweredUnit.modulePath ?? '',
      packageName: loweredUnit.packageName ?? '',
      packageDir: loweredUnit.packageDir ?? '',
      sourceFiles: loweredUnit.sourceFiles ?? [],
      loweredSourcePath: loweredUnit.loweredSourcePath ?? '',
      standard: packageFacts.standard,
    }
  })
  if (
    backendInputManifest.loweredUnits !== undefined &&
    JSON.stringify(loweredUnits) !== JSON.stringify(normalizedLoweredUnits)
  ) {
    throw new Error(errorMessage)
  }
  return loweredUnits
}

const deriveLinkBitcodeInputsFromBackendInputManifest = (
  backendInputManifest: TinyGoBackendInputManifest,
  errorMessage: string,
) => {
  const bitcodeInputs = (backendInputManifest.compileJobs ?? []).map((compileJob) => {
    const bitcodeOutputPath = compileJob.bitcodeOutputPath ?? ''
    if (bitcodeOutputPath === '') {
      throw new Error(errorMessage)
    }
    return bitcodeOutputPath
  })
  if (
    backendInputManifest.linkJob?.bitcodeInputs !== undefined &&
    JSON.stringify(bitcodeInputs) !== JSON.stringify(backendInputManifest.linkJob?.bitcodeInputs ?? [])
  ) {
    throw new Error(errorMessage)
  }
  return bitcodeInputs
}

const deriveExecutionLinkBitcodeInputsFromBackendInputManifest = (
  backendInputManifest: TinyGoBackendInputManifest,
  errorMessage: string,
) => {
  if (backendInputManifest.executionLinkJob === undefined) {
    return deriveLinkBitcodeInputsFromBackendInputManifest(backendInputManifest, errorMessage)
  }
  const bitcodeInputs = (backendInputManifest.compileJobs ?? []).map((compileJob) => {
    const bitcodeOutputPath = compileJob.bitcodeOutputPath ?? ''
    if (bitcodeOutputPath === '') {
      throw new Error(errorMessage)
    }
    return bitcodeOutputPath
  })
  if (
    backendInputManifest.executionLinkJob?.bitcodeInputs !== undefined &&
    JSON.stringify(bitcodeInputs) !== JSON.stringify(backendInputManifest.executionLinkJob?.bitcodeInputs ?? [])
  ) {
    throw new Error(errorMessage)
  }
  return bitcodeInputs
}

const deriveOptimizeFlagFromBackendInputManifest = (
  backendInputManifest: TinyGoBackendInputManifest,
  errorMessage: string,
) => {
  const optimizeFlag = (backendInputManifest.compileJobs ?? []).reduce<string | null>((derived, compileJob) => {
    const current = compileJob.optimizeFlag ?? ''
    if (derived === null || derived === current) {
      return current
    }
    throw new Error(errorMessage)
  }, null) ?? ''
  if (
    backendInputManifest.optimizeFlag !== undefined &&
    optimizeFlag !== (backendInputManifest.optimizeFlag ?? '')
  ) {
    throw new Error(errorMessage)
  }
  return optimizeFlag
}

export const verifyBackendInputManifestAgainstLoweringPlanAndLoweredSourcesManifest = (
  loweringPlanManifest: TinyGoLoweringPlanManifest,
  loweredSourcesManifest: TinyGoLoweredSourcesManifest,
  backendInputManifest: TinyGoBackendInputManifest,
) => {
  if ((loweringPlanManifest.entryFile ?? '') !== (backendInputManifest.entryFile ?? '')) {
    throw new Error('frontend backend input did not match lowering plan and lowered sources manifests')
  }
  if (
    (loweringPlanManifest.optimizeFlag ?? '') !==
    deriveOptimizeFlagFromBackendInputManifest(
      backendInputManifest,
      'frontend backend input did not match lowering plan and lowered sources manifests',
    )
  ) {
    throw new Error('frontend backend input did not match lowering plan and lowered sources manifests')
  }
  const normalizedLoweringPlanCompileJobs = (loweringPlanManifest.compileJobs ?? []).map((compileJob) => {
    const packageFacts = normalizePackageFactsByKind(compileJob.kind ?? '', compileJob.depOnly, compileJob.standard)
    return {
      id: compileJob.id ?? '',
      kind: compileJob.kind ?? '',
      importPath: compileJob.importPath ?? '',
      imports: Array.isArray(compileJob.imports) ? [...compileJob.imports] : [],
      depOnly: packageFacts.depOnly,
      modulePath: compileJob.modulePath ?? '',
      packageName: compileJob.packageName ?? '',
      packageDir: compileJob.packageDir ?? '',
      files: compileJob.files ?? [],
      bitcodeOutputPath: compileJob.bitcodeOutputPath ?? '',
      llvmTarget: compileJob.llvmTarget ?? '',
      cflags: compileJob.cflags ?? [],
      optimizeFlag: compileJob.optimizeFlag ?? '',
      standard: packageFacts.standard,
    }
  })
  const normalizedBackendInputCompileJobs = (backendInputManifest.compileJobs ?? []).map((compileJob) => {
    const packageFacts = normalizePackageFactsByKind(compileJob.kind ?? '', compileJob.depOnly, compileJob.standard)
    return {
      id: compileJob.id ?? '',
      kind: compileJob.kind ?? '',
      importPath: compileJob.importPath ?? '',
      imports: Array.isArray(compileJob.imports) ? [...compileJob.imports] : [],
      depOnly: packageFacts.depOnly,
      modulePath: compileJob.modulePath ?? '',
      packageName: compileJob.packageName ?? '',
      packageDir: compileJob.packageDir ?? '',
      files: compileJob.files ?? [],
      bitcodeOutputPath: compileJob.bitcodeOutputPath ?? '',
      llvmTarget: compileJob.llvmTarget ?? '',
      cflags: compileJob.cflags ?? [],
      optimizeFlag: compileJob.optimizeFlag ?? '',
      standard: packageFacts.standard,
    }
  })
  if (JSON.stringify(normalizedLoweringPlanCompileJobs) !== JSON.stringify(normalizedBackendInputCompileJobs)) {
    throw new Error('frontend backend input did not match lowering plan and lowered sources manifests')
  }
  const linkJob = {
    linker: backendInputManifest.linkJob?.linker ?? '',
    ldflags: backendInputManifest.linkJob?.ldflags ?? [],
    artifactOutputPath: backendInputManifest.linkJob?.artifactOutputPath ?? '',
    bitcodeInputs: deriveLinkBitcodeInputsFromBackendInputManifest(
      backendInputManifest,
      'frontend backend input did not match lowering plan and lowered sources manifests',
    ),
  }
  if (JSON.stringify(loweringPlanManifest.linkJob ?? {}) !== JSON.stringify(linkJob)) {
    throw new Error('frontend backend input did not match lowering plan and lowered sources manifests')
  }
  const executionLinkJob = {
    linker: backendInputManifest.executionLinkJob?.linker ?? '',
    ldflags: backendInputManifest.executionLinkJob?.ldflags ?? [],
    artifactOutputPath: backendInputManifest.executionLinkJob?.artifactOutputPath ?? '',
    bitcodeInputs: deriveExecutionLinkBitcodeInputsFromBackendInputManifest(
      backendInputManifest,
      'frontend backend input did not match lowering plan and lowered sources manifests',
    ),
  }
  if (JSON.stringify(loweringPlanManifest.executionLinkJob ?? {}) !== JSON.stringify(executionLinkJob)) {
    throw new Error('frontend backend input did not match lowering plan and lowered sources manifests')
  }
  const loweredUnits = deriveLoweredUnitsFromBackendInputManifest(
    backendInputManifest,
    'frontend backend input did not match lowering plan and lowered sources manifests',
  )
  const normalizedLoweredSourceUnits = (loweredSourcesManifest.units ?? []).map((unit) => {
    const packageFacts = normalizePackageFactsByKind(unit.kind ?? '', unit.depOnly, unit.standard)
    return {
      id: unit.id ?? '',
      kind: unit.kind ?? '',
      importPath: unit.importPath ?? '',
      imports: Array.isArray(unit.imports) ? [...unit.imports] : [],
      depOnly: packageFacts.depOnly,
      modulePath: unit.modulePath ?? '',
      packageName: unit.packageName ?? '',
      packageDir: unit.packageDir ?? '',
      sourceFiles: unit.sourceFiles ?? [],
      loweredSourcePath: unit.loweredSourcePath ?? '',
      standard: packageFacts.standard,
    }
  })
  if (JSON.stringify(normalizedLoweredSourceUnits) !== JSON.stringify(loweredUnits)) {
    throw new Error('frontend backend input did not match lowering plan and lowered sources manifests')
  }

  return {
    compileJobs: backendInputManifest.compileJobs ?? [],
    linkJob,
    executionLinkJob,
    loweredUnits,
  }
}

export const verifyCommandBatchAgainstLoweringPlanAndLoweredSourcesManifest = (
  loweringPlanManifest: TinyGoLoweringPlanManifest,
  loweredSourcesManifest: TinyGoLoweredSourcesManifest,
  commandBatchManifest: TinyGoCommandBatchManifest,
) => {
  const compileCommands = buildLoweredBitcodeCompileCommandsFromLoweringPlanAndLoweredSourcesManifest(
    loweringPlanManifest,
    loweredSourcesManifest,
  )
  if (JSON.stringify(compileCommands) !== JSON.stringify(commandBatchManifest.compileCommands ?? [])) {
    throw new Error('frontend command batch compile commands did not match lowering plan and lowered sources manifests')
  }

  const linkJob = loweringPlanManifest.executionLinkJob ?? loweringPlanManifest.linkJob ?? {}
  const linkCommand = {
    argv: [
      `/usr/bin/${linkJob.linker ?? ''}`,
      ...(linkJob.ldflags ?? []),
      ...(linkJob.bitcodeInputs ?? []),
      '-o',
      linkJob.artifactOutputPath ?? '',
    ],
    cwd: '/working',
  }
  if (JSON.stringify(linkCommand) !== JSON.stringify(commandBatchManifest.linkCommand ?? {})) {
    throw new Error('frontend command batch link command did not match lowering plan manifest')
  }

  return {
    compileCommands,
    linkCommand,
  }
}

export const verifyCommandBatchAgainstBackendInputManifest = (
  backendInputManifest: TinyGoBackendInputManifest,
  commandBatchManifest: TinyGoCommandBatchManifest,
  commandArtifactManifest?: TinyGoCommandArtifactManifest,
) => {
  const loweredUnitsByID = new Map(
    deriveLoweredUnitsFromBackendInputManifest(
      backendInputManifest,
      'frontend command batch did not match backend input manifest',
    ).map((unit) => [unit.id ?? '', unit]),
  )
  const compileCommands = (backendInputManifest.compileJobs ?? []).map((compileJob) => {
    const loweredUnit = loweredUnitsByID.get(compileJob.id ?? '')
    if (
      !loweredUnit ||
      (compileJob.kind ?? '') !== (loweredUnit.kind ?? '') ||
      (compileJob.packageDir ?? '') !== (loweredUnit.packageDir ?? '') ||
      JSON.stringify(compileJob.files ?? []) !== JSON.stringify(loweredUnit.sourceFiles ?? []) ||
      typeof loweredUnit.loweredSourcePath !== 'string' ||
      loweredUnit.loweredSourcePath === '' ||
      typeof compileJob.llvmTarget !== 'string' ||
      compileJob.llvmTarget === '' ||
      typeof compileJob.bitcodeOutputPath !== 'string' ||
      compileJob.bitcodeOutputPath === ''
    ) {
      throw new Error('frontend command batch did not match backend input manifest')
    }
    return {
      argv: [
        '/usr/bin/clang',
        `--target=${compileJob.llvmTarget}`,
        ...((compileJob.optimizeFlag ?? '') === '' ? [] : [compileJob.optimizeFlag ?? '']),
        ...(compileJob.cflags ?? []),
        '-emit-llvm',
        '-c',
        loweredUnit.loweredSourcePath,
        '-o',
        compileJob.bitcodeOutputPath,
      ],
      cwd: '/working',
    }
  })
  if (JSON.stringify(compileCommands) !== JSON.stringify(commandBatchManifest.compileCommands ?? [])) {
    throw new Error('frontend command batch did not match backend input manifest')
  }

  const linkJob = backendInputManifest.executionLinkJob ?? backendInputManifest.linkJob ?? {}
  const ldflags = [...(linkJob.ldflags ?? [])]
  if (commandArtifactManifest?.runnable === true && commandArtifactManifest.entrypoint === 'main') {
    const hasNoEntry = ldflags.includes('--no-entry')
    const hasMainExport = ldflags.includes('--export=main') || ldflags.includes('--export-all')
    if (!hasNoEntry) {
      ldflags.push('--no-entry')
    }
    if (!hasMainExport) {
      ldflags.push('--export=main')
    }
  }
  const linkCommand = {
    argv: [
      `/usr/bin/${linkJob.linker ?? ''}`,
      ...ldflags,
      ...deriveExecutionLinkBitcodeInputsFromBackendInputManifest(
        backendInputManifest,
        'frontend command batch did not match backend input manifest',
      ),
      '-o',
      linkJob.artifactOutputPath ?? '',
    ],
    cwd: '/working',
  }
  if (JSON.stringify(linkCommand) !== JSON.stringify(commandBatchManifest.linkCommand ?? {})) {
    throw new Error('frontend command batch did not match backend input manifest')
  }

  return {
    compileCommands,
    linkCommand,
  }
}

export const verifyBackendResultManifestAgainstBackendInputAndLoweredBitcodeManifest = (
  backendInputManifest: TinyGoBackendInputManifest,
  loweredBitcodeManifest: TinyGoLoweredBitcodeManifest,
  backendResultManifest: TinyGoBackendResultManifest,
) => {
  if (backendResultManifest.ok !== true) {
    throw new Error('frontend backend result did not match backend input manifest')
  }
  const loweredUnits = deriveLoweredUnitsFromBackendInputManifest(
    backendInputManifest,
    'frontend backend result did not match backend input manifest',
  )
  const expectedGeneratedFilePaths = [
    '/working/tinygo-lowered-sources.json',
    '/working/tinygo-lowered-bitcode.json',
    ...loweredUnits.map((loweredUnit) => loweredUnit.loweredSourcePath),
    '/working/tinygo-lowered-ir.json',
    '/working/tinygo-lowered-command-batch.json',
    '/working/tinygo-lowered-artifact.json',
    '/working/tinygo-command-artifact.json',
    '/working/tinygo-command-batch.json',
  ]
  if (
    JSON.stringify((backendResultManifest.generatedFiles ?? []).map((file) => file.path ?? '')) !==
    JSON.stringify(expectedGeneratedFilePaths)
  ) {
    throw new Error('frontend backend result did not match backend input manifest')
  }
  if ((backendResultManifest.generatedFiles ?? []).length < 2) {
    throw new Error('frontend backend result did not match backend input manifest')
  }
  let loweredSourcesManifest: TinyGoLoweredSourcesManifest
  let loweredBitcodeManifestFromResult: TinyGoLoweredBitcodeManifest
  let loweredIRManifest: TinyGoLoweredIRManifest
  let loweredCommandBatchManifest: TinyGoCommandBatchManifest
  let loweredArtifactManifest: TinyGoLoweredArtifactManifest
  let commandArtifactManifest: TinyGoCommandArtifactManifest
  let commandBatchManifest: TinyGoCommandBatchManifest
  try {
    loweredSourcesManifest = JSON.parse(
      backendResultManifest.generatedFiles?.[0]?.contents ?? '{}',
    ) as TinyGoLoweredSourcesManifest
    loweredBitcodeManifestFromResult = JSON.parse(
      backendResultManifest.generatedFiles?.[1]?.contents ?? '{}',
    ) as TinyGoLoweredBitcodeManifest
    loweredIRManifest = JSON.parse(
      backendResultManifest.generatedFiles?.[(backendResultManifest.generatedFiles?.length ?? 0) - 5]?.contents ?? '{}',
    ) as TinyGoLoweredIRManifest
    loweredCommandBatchManifest = JSON.parse(
      backendResultManifest.generatedFiles?.[(backendResultManifest.generatedFiles?.length ?? 0) - 4]?.contents ?? '{}',
    ) as TinyGoCommandBatchManifest
    loweredArtifactManifest = JSON.parse(
      backendResultManifest.generatedFiles?.[(backendResultManifest.generatedFiles?.length ?? 0) - 3]?.contents ?? '{}',
    ) as TinyGoLoweredArtifactManifest
    commandArtifactManifest = JSON.parse(
      backendResultManifest.generatedFiles?.[(backendResultManifest.generatedFiles?.length ?? 0) - 2]?.contents ?? '{}',
    ) as TinyGoCommandArtifactManifest
    commandBatchManifest = JSON.parse(
      backendResultManifest.generatedFiles?.[(backendResultManifest.generatedFiles?.length ?? 0) - 1]?.contents ?? '{}',
    ) as TinyGoCommandBatchManifest
  } catch {
    throw new Error('frontend backend result did not match backend input manifest')
  }
  if ((backendInputManifest.entryFile ?? '') !== (loweredSourcesManifest.entryFile ?? '')) {
    throw new Error('frontend backend result did not match backend input manifest')
  }
  if (
    deriveOptimizeFlagFromBackendInputManifest(
      backendInputManifest,
      'frontend backend result did not match backend input manifest',
    ) !== (loweredSourcesManifest.optimizeFlag ?? '')
  ) {
    throw new Error('frontend backend result did not match backend input manifest')
  }
  const normalizedLoweredSourceUnits = (loweredSourcesManifest.units ?? []).map((unit) => {
    const packageFacts = normalizePackageFactsByKind(unit.kind ?? '', unit.depOnly, unit.standard)
    return {
      id: unit.id ?? '',
      kind: unit.kind ?? '',
      importPath: unit.importPath ?? '',
      imports: Array.isArray(unit.imports) ? [...unit.imports] : [],
      depOnly: packageFacts.depOnly,
      modulePath: unit.modulePath ?? '',
      packageName: unit.packageName ?? '',
      packageDir: unit.packageDir ?? '',
      sourceFiles: unit.sourceFiles ?? [],
      loweredSourcePath: unit.loweredSourcePath ?? '',
      standard: packageFacts.standard,
    }
  })
  if (JSON.stringify(loweredUnits) !== JSON.stringify(normalizedLoweredSourceUnits)) {
    throw new Error('frontend backend result did not match backend input manifest')
  }
  if ((backendInputManifest.entryFile ?? '') !== (loweredIRManifest.entryFile ?? '')) {
    throw new Error('frontend backend result did not match backend input manifest')
  }
  if (
    deriveOptimizeFlagFromBackendInputManifest(
      backendInputManifest,
      'frontend backend result did not match backend input manifest',
    ) !== (loweredIRManifest.optimizeFlag ?? '')
  ) {
    throw new Error('frontend backend result did not match backend input manifest')
  }
  if (
    JSON.stringify((loweredIRManifest.units ?? []).map((unit) => ({
      id: unit.id ?? '',
      kind: unit.kind ?? '',
      importPath: unit.importPath ?? '',
      modulePath: unit.modulePath ?? '',
      packageName: unit.packageName ?? '',
      packageDir: unit.packageDir ?? '',
      sourceFiles: unit.sourceFiles ?? [],
      loweredSourcePath: unit.loweredSourcePath ?? '',
    }))) !== JSON.stringify(loweredUnits.map((unit) => ({
      id: unit.id,
      kind: unit.kind,
      importPath: unit.importPath,
      modulePath: unit.modulePath,
      packageName: unit.packageName,
      packageDir: unit.packageDir,
      sourceFiles: unit.sourceFiles,
      loweredSourcePath: unit.loweredSourcePath,
    })))
  ) {
    throw new Error('frontend backend result did not match backend input manifest')
  }
  for (const unit of loweredIRManifest.units ?? []) {
    if (
      typeof unit.packageName !== 'string' ||
      !Array.isArray(unit.imports) ||
      !Array.isArray(unit.functions) ||
      !Array.isArray(unit.types) ||
      !Array.isArray(unit.constants) ||
      !Array.isArray(unit.variables) ||
      !Array.isArray(unit.declarations) ||
      !Array.isArray(unit.placeholderBlocks) ||
      !Array.isArray(unit.loweringBlocks)
    ) {
      throw new Error('frontend backend result did not match backend input manifest')
    }
    const functionDeclarations = (unit.declarations ?? [])
      .filter((declaration) => (declaration?.kind ?? '') === 'function')
      .map((declaration) => ({
        kind: declaration.kind ?? '',
        name: declaration.name ?? '',
        exported: declaration.exported ?? false,
        method: declaration.method ?? false,
      }))
    if (
      JSON.stringify(functionDeclarations) !==
      JSON.stringify((unit.functions ?? []).map((fn) => ({
        kind: 'function',
        name: fn.name ?? '',
        exported: fn.exported ?? false,
        method: fn.method ?? false,
      })))
    ) {
      throw new Error('frontend backend result did not match backend input manifest')
    }
    const typeDeclarations = (unit.declarations ?? [])
      .filter((declaration) => (declaration?.kind ?? '') === 'type')
      .map((declaration) => ({
        kind: declaration.kind ?? '',
        name: declaration.name ?? '',
        exported: declaration.exported ?? false,
        method: declaration.method ?? false,
      }))
    if (
      JSON.stringify(typeDeclarations) !==
      JSON.stringify((unit.types ?? []).map((typed) => ({
        kind: 'type',
        name: typed.name ?? '',
        exported: typed.exported ?? false,
        method: false,
      })))
    ) {
      throw new Error('frontend backend result did not match backend input manifest')
    }
    const constantDeclarations = (unit.declarations ?? [])
      .filter((declaration) => (declaration?.kind ?? '') === 'const')
      .map((declaration) => ({
        kind: declaration.kind ?? '',
        name: declaration.name ?? '',
        exported: declaration.exported ?? false,
        method: declaration.method ?? false,
      }))
    if (
      JSON.stringify(constantDeclarations) !==
      JSON.stringify((unit.constants ?? []).map((constant) => ({
        kind: 'const',
        name: constant.name ?? '',
        exported: constant.exported ?? false,
        method: false,
      })))
    ) {
      throw new Error('frontend backend result did not match backend input manifest')
    }
    const variableDeclarations = (unit.declarations ?? [])
      .filter((declaration) => (declaration?.kind ?? '') === 'var')
      .map((declaration) => ({
        kind: declaration.kind ?? '',
        name: declaration.name ?? '',
        exported: declaration.exported ?? false,
        method: declaration.method ?? false,
      }))
    if (
      JSON.stringify(variableDeclarations) !==
      JSON.stringify((unit.variables ?? []).map((variable) => ({
        kind: 'var',
        name: variable.name ?? '',
        exported: variable.exported ?? false,
        method: false,
      })))
    ) {
      throw new Error('frontend backend result did not match backend input manifest')
    }
    if (
      (unit.declarations ?? []).length !==
      (unit.functions ?? []).length + (unit.types ?? []).length + (unit.constants ?? []).length + (unit.variables ?? []).length
    ) {
      throw new Error('frontend backend result did not match backend input manifest')
    }
    const expectedPlaceholderBlocks: Array<{
      stage: string
      index: number
      value: string
      signature: string
    }> = []
    for (const [importIndex, loweredImport] of (unit.imports ?? []).entries()) {
      const importAlias = loweredImport.alias ?? ''
      const importPath = loweredImport.path ?? ''
      expectedPlaceholderBlocks.push({
        stage: 'import',
        index: importIndex,
        value: importAlias !== '' ? `import:${importAlias}=${importPath}` : `import:${importPath}`,
        signature: importAlias !== '' ? `${importAlias}=${importPath}` : importPath,
      })
    }
    for (const [functionIndex, loweredFunction] of (unit.functions ?? []).entries()) {
      expectedPlaceholderBlocks.push({
        stage: 'function',
        index: functionIndex,
        value: [
          'function',
          loweredFunction.name ?? '',
          (loweredFunction.exported ?? false) ? '1' : '0',
          (loweredFunction.method ?? false) ? '1' : '0',
          (loweredFunction.main ?? false) ? '1' : '0',
          (loweredFunction.init ?? false) ? '1' : '0',
          `${loweredFunction.parameters ?? 0}`,
          `${loweredFunction.results ?? 0}`,
        ].join(':'),
        signature: [
          loweredFunction.name ?? '',
          (loweredFunction.exported ?? false) ? '1' : '0',
          (loweredFunction.method ?? false) ? '1' : '0',
          (loweredFunction.main ?? false) ? '1' : '0',
          (loweredFunction.init ?? false) ? '1' : '0',
          `${loweredFunction.parameters ?? 0}`,
          `${loweredFunction.results ?? 0}`,
        ].join(':'),
      })
    }
    for (const [declarationIndex, declaration] of (unit.declarations ?? []).entries()) {
      expectedPlaceholderBlocks.push({
        stage: 'declaration',
        index: declarationIndex,
        value: [
          'declaration',
          declaration.kind ?? '',
          declaration.name ?? '',
          (declaration.exported ?? false) ? '1' : '0',
          (declaration.method ?? false) ? '1' : '0',
        ].join(':'),
        signature: [
          declaration.kind ?? '',
          declaration.name ?? '',
          (declaration.exported ?? false) ? '1' : '0',
          (declaration.method ?? false) ? '1' : '0',
        ].join(':'),
      })
    }
    if (
      JSON.stringify((unit.placeholderBlocks ?? []).map((block) => ({
        stage: block.stage ?? '',
        index: block.index ?? 0,
        value: block.value ?? '',
        signature: block.signature ?? '',
      }))) !== JSON.stringify(expectedPlaceholderBlocks)
    ) {
      throw new Error('frontend backend result did not match backend input manifest')
    }
    const expectedLoweringBlocks: Array<{
      stage: string
      index: number
      value: string
    }> = []
    const unitLoweringPrefix = `tinygo_lower_unit_begin(${JSON.stringify(unit.id ?? '')}, ${JSON.stringify(unit.kind ?? '')}, ${JSON.stringify(unit.packageName ?? '')}, ${(unit.sourceFiles ?? []).length});`
    const unitLoweringSuffix = 'tinygo_lower_unit_end()'
    for (const [importIndex, loweredImport] of (unit.imports ?? []).entries()) {
      const importAlias = loweredImport.alias ?? ''
      const importPath = loweredImport.path ?? ''
      const importSignature = importAlias !== '' ? `${importAlias}=${importPath}` : importPath
      expectedLoweringBlocks.push({
        stage: 'import',
        index: importIndex,
        value: `${unitLoweringPrefix}tinygo_lower_import_begin();tinygo_emit_import_index(${importIndex});tinygo_emit_import_alias(${JSON.stringify(importAlias)});tinygo_emit_import_path(${JSON.stringify(importPath)});tinygo_emit_import_signature(${JSON.stringify(importSignature)});tinygo_lower_import_end();${unitLoweringSuffix}`,
      })
    }
    for (const [functionIndex, loweredFunction] of (unit.functions ?? []).entries()) {
      const functionSignature = [
        loweredFunction.name ?? '',
        (loweredFunction.exported ?? false) ? '1' : '0',
        (loweredFunction.method ?? false) ? '1' : '0',
        (loweredFunction.main ?? false) ? '1' : '0',
        (loweredFunction.init ?? false) ? '1' : '0',
        `${loweredFunction.parameters ?? 0}`,
        `${loweredFunction.results ?? 0}`,
      ].join(':')
      expectedLoweringBlocks.push({
        stage: 'function',
        index: functionIndex,
        value: `${unitLoweringPrefix}tinygo_lower_function_begin(${JSON.stringify(unit.packageName ?? '')}, ${JSON.stringify(loweredFunction.name ?? '')});tinygo_emit_function_index(${functionIndex});tinygo_emit_function_flags(${(loweredFunction.exported ?? false) ? 1 : 0}, ${(loweredFunction.method ?? false) ? 1 : 0}, ${(loweredFunction.main ?? false) ? 1 : 0}, ${(loweredFunction.init ?? false) ? 1 : 0});tinygo_emit_function_signature(${loweredFunction.parameters ?? 0}, ${loweredFunction.results ?? 0});tinygo_emit_function_stream(${JSON.stringify(functionSignature)});tinygo_lower_function_end();${unitLoweringSuffix}`,
      })
    }
    for (const [declarationIndex, declaration] of (unit.declarations ?? []).entries()) {
      const declarationSignature = [
        declaration.kind ?? '',
        declaration.name ?? '',
        (declaration.exported ?? false) ? '1' : '0',
        (declaration.method ?? false) ? '1' : '0',
      ].join(':')
      expectedLoweringBlocks.push({
        stage: 'declaration',
        index: declarationIndex,
        value: `${unitLoweringPrefix}tinygo_lower_declaration_begin(${JSON.stringify(unit.packageName ?? '')}, ${JSON.stringify(declaration.kind ?? '')}, ${JSON.stringify(declaration.name ?? '')});tinygo_emit_declaration_index(${declarationIndex});tinygo_emit_declaration_flags(${(declaration.exported ?? false) ? 1 : 0}, ${(declaration.method ?? false) ? 1 : 0});tinygo_emit_declaration_signature(${JSON.stringify(declarationSignature)});tinygo_lower_declaration_end();${unitLoweringSuffix}`,
      })
    }
    if (
      JSON.stringify((unit.loweringBlocks ?? []).map((block) => ({
        stage: block.stage ?? '',
        index: block.index ?? 0,
        value: block.value ?? '',
      }))) !== JSON.stringify(expectedLoweringBlocks)
    ) {
      throw new Error('frontend backend result did not match backend input manifest')
    }
  }
  if (JSON.stringify(loweredBitcodeManifest.bitcodeFiles ?? []) !== JSON.stringify(loweredBitcodeManifestFromResult.bitcodeFiles ?? [])) {
    throw new Error('frontend backend result did not match backend input manifest')
  }

  return {
    generatedFiles: backendResultManifest.generatedFiles ?? [],
    loweredSources: loweredSourcesManifest,
    loweredIR: loweredIRManifest,
    loweredBitcodeManifest: {
      bitcodeFiles: loweredBitcodeManifestFromResult.bitcodeFiles ?? [],
    },
    loweredCommandBatch: verifyLoweredCommandBatchAgainstCompileUnitAndLoweredSourcesManifest(
      {
        entryFile: backendInputManifest.entryFile,
        optimizeFlag: deriveOptimizeFlagFromBackendInputManifest(
          backendInputManifest,
          'frontend backend result did not match backend input manifest',
        ),
        toolchain: {
          target: 'wasm',
          llvmTarget: backendInputManifest.compileJobs?.[0]?.llvmTarget,
          linker: backendInputManifest.linkJob?.linker,
          cflags: backendInputManifest.compileJobs?.[0]?.cflags,
          ldflags: backendInputManifest.linkJob?.ldflags,
          artifactOutputPath: backendInputManifest.linkJob?.artifactOutputPath,
        },
      },
      loweredSourcesManifest,
      loweredCommandBatchManifest,
    ),
    loweredArtifact: verifyLoweredArtifactManifestAgainstLoweredCommandBatchManifest(
      loweredCommandBatchManifest,
      loweredArtifactManifest,
    ),
    commandArtifact: verifyCommandArtifactManifestAgainstBackendInputAndLoweredBitcodeManifest(
      backendInputManifest,
      loweredBitcodeManifest,
      commandArtifactManifest,
    ),
    commandBatch: verifyCommandBatchAgainstBackendInputManifest(
      backendInputManifest,
      commandBatchManifest,
      commandArtifactManifest,
    ),
  }
}

export const buildLoweredBitcodeCompileCommandsFromLoweringPlanAndLoweredSourcesManifest = (
  loweringPlanManifest: TinyGoLoweringPlanManifest,
  loweredSourcesManifest: TinyGoLoweredSourcesManifest,
): CompileUnitToolInvocation[] => {
  if ((loweringPlanManifest.entryFile ?? '') !== (loweredSourcesManifest.entryFile ?? '')) {
    throw new Error('frontend lowered bitcode compile commands did not match lowering plan and lowered sources manifests')
  }
  if ((loweringPlanManifest.optimizeFlag ?? '') !== (loweredSourcesManifest.optimizeFlag ?? '')) {
    throw new Error('frontend lowered bitcode compile commands did not match lowering plan and lowered sources manifests')
  }

  const loweredSourceUnitsByID = new Map(
    (loweredSourcesManifest.units ?? []).map((unit) => [unit.id ?? '', unit]),
  )
  const compileCommands = (loweringPlanManifest.compileJobs ?? []).map((compileJob) => {
    const loweredSourceUnit = loweredSourceUnitsByID.get(compileJob.id ?? '')
    if (
      !loweredSourceUnit ||
      (compileJob.kind ?? '') !== (loweredSourceUnit.kind ?? '') ||
      (compileJob.packageDir ?? '') !== (loweredSourceUnit.packageDir ?? '') ||
      JSON.stringify(compileJob.files ?? []) !== JSON.stringify(loweredSourceUnit.sourceFiles ?? []) ||
      typeof loweredSourceUnit.loweredSourcePath !== 'string' ||
      loweredSourceUnit.loweredSourcePath === '' ||
      typeof compileJob.llvmTarget !== 'string' ||
      compileJob.llvmTarget === '' ||
      typeof compileJob.bitcodeOutputPath !== 'string' ||
      compileJob.bitcodeOutputPath === ''
    ) {
      throw new Error('frontend lowered bitcode compile commands did not match lowering plan and lowered sources manifests')
    }
    return {
      argv: [
        '/usr/bin/clang',
        `--target=${compileJob.llvmTarget}`,
        ...((compileJob.optimizeFlag ?? '') === '' ? [] : [compileJob.optimizeFlag ?? '']),
        ...(compileJob.cflags ?? []),
        '-emit-llvm',
        '-c',
        loweredSourceUnit.loweredSourcePath,
        '-o',
        compileJob.bitcodeOutputPath,
      ],
      cwd: '/working',
    }
  })

  if (compileCommands.length !== (loweredSourcesManifest.units ?? []).length) {
    throw new Error('frontend lowered bitcode compile commands did not match lowering plan and lowered sources manifests')
  }

  return compileCommands
}

export const verifyLoweredBitcodeManifestAgainstLoweringPlanAndLoweredSourcesManifest = (
  loweringPlanManifest: TinyGoLoweringPlanManifest,
  loweredSourcesManifest: TinyGoLoweredSourcesManifest,
  loweredBitcodeManifest: TinyGoLoweredBitcodeManifest,
) => {
  const bitcodeFiles = buildLoweredBitcodeCompileCommandsFromLoweringPlanAndLoweredSourcesManifest(
    loweringPlanManifest,
    loweredSourcesManifest,
  ).map((command) => command.argv[command.argv.length - 1] ?? '')

  if (JSON.stringify(bitcodeFiles) !== JSON.stringify(loweredBitcodeManifest.bitcodeFiles ?? [])) {
    throw new Error('frontend lowered bitcode manifest did not match lowering plan and lowered sources manifests')
  }

  return {
    bitcodeFiles,
  }
}

export const verifyCommandArtifactManifestAgainstCommandBatchAndLoweredBitcodeManifest = (
  commandBatchManifest: TinyGoCommandBatchManifest,
  loweredBitcodeManifest: TinyGoLoweredBitcodeManifest,
  commandArtifactManifest: TinyGoCommandArtifactManifest,
) => {
  const linkArgv = commandBatchManifest.linkCommand?.argv ?? []
  const artifactOutputPath = linkArgv.length >= 2 ? linkArgv[linkArgv.length - 1] ?? '' : ''
  if (artifactOutputPath !== (commandArtifactManifest.artifactOutputPath ?? '')) {
    throw new Error('frontend command artifact manifest did not match command batch and lowered bitcode manifest')
  }
  if (JSON.stringify(loweredBitcodeManifest.bitcodeFiles ?? []) !== JSON.stringify(commandArtifactManifest.bitcodeFiles ?? [])) {
    throw new Error('frontend command artifact manifest did not match command batch and lowered bitcode manifest')
  }
  const artifactFacts = (() => {
    const artifactKind = commandArtifactManifest.artifactKind ?? 'probe'
    const entrypoint = commandArtifactManifest.entrypoint ?? null
    const reason = commandArtifactManifest.reason
    const runnable = commandArtifactManifest.runnable ?? false
    if (artifactKind === 'execution') {
      if (entrypoint !== '_start' && entrypoint !== '_initialize' && entrypoint !== 'main') {
        throw new Error('frontend command artifact manifest did not match command batch and lowered bitcode manifest')
      }
      if (reason !== undefined) {
        throw new Error('frontend command artifact manifest did not match command batch and lowered bitcode manifest')
      }
      if (runnable !== true) {
        throw new Error('frontend command artifact manifest did not match command batch and lowered bitcode manifest')
      }
      return {
        artifactKind: 'execution' as const,
        entrypoint,
        reason: undefined,
        runnable: true,
      }
    }
    if (artifactKind !== 'probe') {
      throw new Error('frontend command artifact manifest did not match command batch and lowered bitcode manifest')
    }
    if (entrypoint !== null) {
      throw new Error('frontend command artifact manifest did not match command batch and lowered bitcode manifest')
    }
    if ((reason ?? 'missing-wasi-entrypoint') !== 'missing-wasi-entrypoint') {
      throw new Error('frontend command artifact manifest did not match command batch and lowered bitcode manifest')
    }
    if (runnable !== false) {
      throw new Error('frontend command artifact manifest did not match command batch and lowered bitcode manifest')
    }
    return {
      artifactKind: 'probe' as const,
      entrypoint: null,
      reason: 'missing-wasi-entrypoint' as const,
      runnable: false,
    }
  })()
  return {
    artifactOutputPath,
    artifactKind: artifactFacts.artifactKind,
    bitcodeFiles: loweredBitcodeManifest.bitcodeFiles ?? [],
    entrypoint: artifactFacts.entrypoint,
    reason: artifactFacts.reason,
    runnable: artifactFacts.runnable,
  }
}

export const verifyCommandArtifactManifestAgainstBackendInputAndLoweredBitcodeManifest = (
  backendInputManifest: TinyGoBackendInputManifest,
  loweredBitcodeManifest: TinyGoLoweredBitcodeManifest,
  commandArtifactManifest: TinyGoCommandArtifactManifest,
) => {
  const artifactOutputPath =
    backendInputManifest.executionLinkJob?.artifactOutputPath ?? backendInputManifest.linkJob?.artifactOutputPath ?? ''
  if (artifactOutputPath !== (commandArtifactManifest.artifactOutputPath ?? '')) {
    throw new Error('frontend command artifact manifest did not match backend input and lowered bitcode manifest')
  }
  if (
    JSON.stringify(
      backendInputManifest.executionLinkJob !== undefined
        ? (backendInputManifest.executionLinkJob.bitcodeInputs ?? loweredBitcodeManifest.bitcodeFiles ?? [])
        : (backendInputManifest.linkJob?.bitcodeInputs ?? loweredBitcodeManifest.bitcodeFiles ?? []),
    ) !== JSON.stringify(commandArtifactManifest.bitcodeFiles ?? [])
  ) {
    throw new Error('frontend command artifact manifest did not match backend input and lowered bitcode manifest')
  }
  const artifactFacts = (() => {
    const artifactKind = commandArtifactManifest.artifactKind ?? 'probe'
    const entrypoint = commandArtifactManifest.entrypoint ?? null
    const reason = commandArtifactManifest.reason
    const runnable = commandArtifactManifest.runnable ?? false
    if (artifactKind === 'execution') {
      if (entrypoint !== '_start' && entrypoint !== '_initialize' && entrypoint !== 'main') {
        throw new Error('frontend command artifact manifest did not match backend input and lowered bitcode manifest')
      }
      if (reason !== undefined) {
        throw new Error('frontend command artifact manifest did not match backend input and lowered bitcode manifest')
      }
      if (runnable !== true) {
        throw new Error('frontend command artifact manifest did not match backend input and lowered bitcode manifest')
      }
      return {
        artifactKind: 'execution' as const,
        entrypoint,
        reason: undefined,
        runnable: true,
      }
    }
    if (artifactKind !== 'probe') {
      throw new Error('frontend command artifact manifest did not match backend input and lowered bitcode manifest')
    }
    if (entrypoint !== null) {
      throw new Error('frontend command artifact manifest did not match backend input and lowered bitcode manifest')
    }
    if ((reason ?? 'missing-wasi-entrypoint') !== 'missing-wasi-entrypoint') {
      throw new Error('frontend command artifact manifest did not match backend input and lowered bitcode manifest')
    }
    if (runnable !== false) {
      throw new Error('frontend command artifact manifest did not match backend input and lowered bitcode manifest')
    }
    return {
      artifactKind: 'probe' as const,
      entrypoint: null,
      reason: 'missing-wasi-entrypoint' as const,
      runnable: false,
    }
  })()
  return {
    artifactOutputPath,
    artifactKind: artifactFacts.artifactKind,
    bitcodeFiles: loweredBitcodeManifest.bitcodeFiles ?? [],
    entrypoint: artifactFacts.entrypoint,
    reason: artifactFacts.reason,
    runnable: artifactFacts.runnable,
  }
}
