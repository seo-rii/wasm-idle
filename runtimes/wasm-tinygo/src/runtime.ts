import { ConsoleStdout, Directory, File, OpenFile, PreopenDirectory, WASI, WASIProcExit } from '@bjorn3/browser_wasi_shim'
import * as Comlink from 'comlink'
import {
  type TinyGoRuntimeAssetLoader,
  type TinyGoRuntimeAssetPackReference,
  type TinyGoRuntimeAssetProgress,
  loadRuntimeAssetBytes,
  resolveRuntimeAssetUrl,
} from './runtime-assets'
export type {
  TinyGoRuntimeAssetProgress,
  TinyGoRuntimeAssetProgressCallback,
} from './runtime-assets'
import {
  readTinyGoBootstrapManifest,
  verifyTinyGoBootstrapArtifactExpectation,
} from './bootstrap-exports'
import {
  materializeGeneratedFiles,
  selectBootstrapDispatchFiles,
  type EmceptionWritableFileSystem,
  type GeneratedFile,
} from './emception-files'
import {
  verifyTinyGoLoweredArtifactExports,
  verifyTinyGoLoweredBitcodeFiles,
  verifyTinyGoFinalArtifactFile,
  verifyTinyGoLoweredObjectFiles,
} from './lowered-exports'
import {
  verifyBackendResultManifestAgainstBackendInputAndLoweredBitcodeManifest,
  verifyBackendInputManifestAgainstLoweringPlanAndLoweredSourcesManifest,
  verifyCompileUnitManifestAgainstDriverBridgeManifest,
  verifyFrontendAnalysisAgainstDriverBridgeManifest,
  verifyFrontendAnalysisInputManifestAgainstDriverBridgeManifest,
  verifyFrontendAnalysisAgainstRealDriverBridgeManifest,
  verifyFrontendRealAdapterAgainstFrontendAnalysis,
  verifyFrontendInputManifestAgainstDriverBridgeManifest,
  verifyLoweredBitcodeManifestAgainstLoweringPlanAndLoweredSourcesManifest,
  verifyLoweredSourcesManifestAgainstWorkItemsManifest,
  verifyLoweringManifestAgainstIntermediateManifest,
  verifyLoweringPlanAgainstWorkItemsManifest,
  verifyIntermediateManifestAgainstCompileUnitManifest,
  verifyCompileUnitManifestAgainstCompileRequest,
  verifyUpstreamFrontendProbeAgainstFrontendAnalysisManifest,
  verifyUpstreamFrontendProbeAgainstFrontendRealAdapterManifest,
  verifyUpstreamFrontendProbeAgainstFrontendAnalysisInputManifest,
  verifyUpstreamFrontendProbeAgainstDriverBridgeManifest,
  verifyWorkItemsManifestAgainstLoweringManifest,
  type TinyGoBackendInputManifest,
  type TinyGoBackendResultManifest,
  type TinyGoCompileUnitManifest,
  type TinyGoDriverBridgeManifest,
  type TinyGoFrontendAnalysisManifest,
  type TinyGoFrontendInputManifest,
  type TinyGoIntermediateManifest,
  type TinyGoLoweredBitcodeManifest,
  type TinyGoLoweredIRManifest,
  type TinyGoLoweringManifest,
  type TinyGoLoweredSourcesManifest,
  type TinyGoLoweringPlanManifest,
  type TinyGoUpstreamFrontendProbeResult,
  type TinyGoWorkItemsManifest,
} from './compile-unit'

export type EmceptionRunResult = {
  returncode: number
  stdout: string
  stderr: string
}

export type TinyGoBuildTarget = 'wasm' | 'wasip1' | 'wasip2' | 'wasip3'

export type TinyGoBuildRequest = {
  command: 'build'
  planner?: 'bootstrap' | 'tinygo'
  entry: string
  output: string
  target: TinyGoBuildTarget
  optimize?: string
  scheduler?: 'none' | 'tasks' | 'asyncify'
  panic?: 'print' | 'trap'
}

export type TinyGoBuildRequestOverrides = Partial<Pick<TinyGoBuildRequest, 'optimize' | 'panic' | 'scheduler' | 'target'>>

export type TinyGoBuildPlanInputs = {
  buildRequestOverrides: TinyGoBuildRequestOverrides | null
  workspaceFiles: Record<string, string> | null
}

type TinyGoRuntimeAction = 'booting' | 'planning' | 'executing' | 'upstream-probe' | 'upstream-frontend-probe'

export type ToolInvocation = {
  argv: string[]
  cwd: string
}

export type TinyGoBuildResult = {
  ok: boolean
  mode?: string
  artifact?: string
  plan: ToolInvocation[]
  files: GeneratedFile[]
  diagnostics: string[]
}

type TinyGoFrontEndResult = {
  ok: boolean
  generatedFiles?: GeneratedFile[]
  diagnostics: string[]
}

type TinyGoFrontEndAnalysisResult = {
  ok: boolean
  analysis?: TinyGoFrontendAnalysisManifest
  diagnostics: string[]
}

type TinyGoFrontEndAdapterResult = {
  ok: boolean
  adapter?: TinyGoFrontendAnalysisManifest
  diagnostics: string[]
}

type EmceptionFileSystemBridge = {
  exists(path: string): Promise<boolean>
  readFile(path: string, options?: { encoding?: string }): Promise<string | Uint8Array>
  unlink(path: string): Promise<void>
  writeFile(path: string, contents: string): Promise<void>
}

type EmceptionBridge = {
  init(): Promise<void>
  mkdir(path: string): Promise<void>
  run(command: string): Promise<EmceptionRunResult>
  _run_process_impl(argv: string[], options?: { cwd?: string }): Promise<EmceptionRunResult>
  fileSystem: EmceptionFileSystemBridge
  onstdout: unknown
  onstderr: unknown
  onprocessstart: unknown
}

export type PhaseTone = 'idle' | 'running' | 'success' | 'error'
export type TinyGoRuntimePhase = 'toolchain' | 'smoke' | 'probe' | 'verify'

export type TinyGoBuildArtifact = {
  path: string
  bytes: Uint8Array
  artifactKind: 'probe' | 'bootstrap' | 'execution'
  runnable: boolean
  entrypoint: '_start' | '_initialize' | 'main' | null
  reason?: 'bootstrap-artifact' | 'missing-wasi-entrypoint'
}

type TinyGoCompilerManifest = {
  buildMode?: string
  artifactKind?: 'compiler' | 'bootstrap'
  blockers?: string[]
}

export type TinyGoUpstreamProbeResult = {
  requestedTarget: string
  resolvedGoos: string
  resolvedGoarch: string
  triple: string
  buildTags: string[]
  gc: string
  scheduler: string
  linker: string
}
export type { TinyGoUpstreamFrontendProbeResult } from './compile-unit'

export type TinyGoTestHooks = {
  boot(): Promise<void>
  plan(): Promise<TinyGoBuildResult>
  execute(): Promise<void>
  runUpstreamProbe(): Promise<TinyGoUpstreamProbeResult>
  runUpstreamFrontendProbe(): Promise<TinyGoUpstreamFrontendProbeResult>
  reset(): void
  readActivityLog(): string
  readBuildArtifact(): TinyGoBuildArtifact | null
  readFrontendAnalysisInputManifest(): TinyGoFrontendInputManifest | null
  setBuildRequestOverrides(overrides: TinyGoBuildRequestOverrides | null): void
  setDriverBridgeManifest(manifest: TinyGoDriverBridgeManifest | null): void
  setWorkspaceFiles(files: Record<string, string> | null): void
}

export type TinyGoRuntime = TinyGoTestHooks & {
  dispose(): void
}

type TinyGoRuntimeLogEntry = {
  line: string
  message: string
  tone: Exclude<PhaseTone, 'idle'> | 'idle'
}

type TinyGoHostCompileResponse = {
  artifact?: {
    artifactKind?: 'probe' | 'bootstrap' | 'execution'
    bytesBase64?: string
    entrypoint?: '_start' | '_initialize' | 'main' | null
    path?: string
    reason?: 'bootstrap-artifact' | 'missing-wasi-entrypoint'
    runnable?: boolean
  }
  error?: string
  logs?: string[]
}

export type TinyGoRuntimeOptions = {
  assetBaseUrl: string
  assetLoader?: TinyGoRuntimeAssetLoader
  assetPacks?: TinyGoRuntimeAssetPackReference[]
  rustRuntimeBaseUrl?: string
  rustRuntimeAssetPacks?: TinyGoRuntimeAssetPackReference[]
  bootstrapGoEntrySource?: string
  hostCompileUrl?: string
  onProgress?: (progress: TinyGoRuntimeAssetProgress) => void
  initialLogMessages?: Array<{ message: string; tone?: Exclude<PhaseTone, 'idle'> | 'idle' }>
  onControlsLockedChange?: (locked: boolean) => void
  onLogAppended?: (entry: TinyGoRuntimeLogEntry) => void
  onLogReset?: () => void
  onPhaseChange?: (phase: TinyGoRuntimePhase, label: string, tone: PhaseTone) => void
  now?: () => Date
}

export type TinyGoBrowserRuntime = TinyGoRuntime

export type TinyGoBrowserRuntimeOptions = {
  baseUrl: string
  assetLoader?: TinyGoRuntimeAssetLoader
  assetPacks?: TinyGoRuntimeAssetPackReference[]
  rustRuntimeBaseUrl?: string
  rustRuntimeAssetPacks?: TinyGoRuntimeAssetPackReference[]
  bootstrapGoEntrySource?: string
  hostCompileUrl?: string
  onProgress?: (progress: TinyGoRuntimeAssetProgress) => void
  initialLogs?: string[]
  onActivityLogChange?: (activityLog: string, tone: Exclude<PhaseTone, 'idle'> | 'idle') => void
  onControlsLockedChange?: (locked: boolean) => void
  onPhaseChange?: (phase: TinyGoRuntimePhase, label: string, tone: PhaseTone) => void
  now?: () => Date
}

export const DEFAULT_TINYGO_BOOTSTRAP_GO_ENTRY_SOURCE = `package main

func main() {}
`

const cloneJsonValue = <T>(value: T) => JSON.parse(JSON.stringify(value)) as T

const buildDirectoryContentsFromTextEntries = (entries: Record<string, string>, textEncoder: TextEncoder) => {
  const root = new Map<string, File | Directory>()
  for (const [relativePath, contents] of Object.entries(entries)) {
    const parts = relativePath.split('/').filter(Boolean)
    let currentDirectory = root
    for (const [index, part] of parts.entries()) {
      if (index === parts.length - 1) {
        currentDirectory.set(part, new File(textEncoder.encode(contents)))
        continue
      }
      const existing = currentDirectory.get(part)
      if (existing instanceof Directory) {
        currentDirectory = existing.contents as unknown as Map<string, File | Directory>
        continue
      }
      const directory = new Directory(new Map())
      currentDirectory.set(part, directory)
      currentDirectory = directory.contents as unknown as Map<string, File | Directory>
    }
  }
  return root
}

const normalizeAssetBaseUrl = (assetBaseUrl: string) =>
  assetBaseUrl.endsWith('/') ? assetBaseUrl : `${assetBaseUrl}/`

const describePureBrowserFallbackFailure = (
  requestedBuildTarget: TinyGoBuildTarget,
  loweredIRVerification: TinyGoLoweredIRManifest | null,
) => {
  if (requestedBuildTarget !== 'wasm' && requestedBuildTarget !== 'wasip1') {
    return {
      errorLine: `pure-browser runnable execution currently supports wasm and wasip1 only; requested target ${requestedBuildTarget} requires the host-assisted bridge`,
      logLine: `pure-browser execution unsupported target=${requestedBuildTarget}: runnable fallback only supports wasm/wasip1`,
    }
  }
  if (!Array.isArray(loweredIRVerification?.units)) {
    return null
  }
  const userUnits = loweredIRVerification.units.filter((unit) => (unit.kind ?? '') === 'program' || (unit.kind ?? '') === 'imported')
  if (userUnits.length === 0) {
    return null
  }
  const blockers: string[] = []
  const addBlocker = (label: string) => {
    if (!blockers.includes(label)) {
      blockers.push(label)
    }
  }
  if (userUnits.some((unit) => (unit.functions ?? []).some((functionInfo) => functionInfo.method))) {
    addBlocker('methods')
  }
  if (userUnits.some((unit) => (unit.types ?? []).some((typeInfo) => (typeInfo.kind ?? '') === 'struct'))) {
    addBlocker('struct types')
  }
  if (userUnits.some((unit) => (unit.types ?? []).some((typeInfo) => (typeInfo.kind ?? '') === 'interface'))) {
    addBlocker('interface types')
  }
  if (userUnits.some((unit) => (unit.types ?? []).some((typeInfo) => (typeInfo.kind ?? '') === 'map'))) {
    addBlocker('map types')
  }
  if (userUnits.some((unit) => (unit.types ?? []).some((typeInfo) => (typeInfo.kind ?? '') === 'chan'))) {
    addBlocker('channel types')
  }
  if (userUnits.some((unit) => (unit.types ?? []).some((typeInfo) => (typeInfo.kind ?? '') === 'array'))) {
    addBlocker('array types')
  }
  if (userUnits.some((unit) => (unit.types ?? []).some((typeInfo) => (typeInfo.kind ?? '') === 'slice'))) {
    addBlocker('slice types')
  }
  if (userUnits.some((unit) => (unit.types ?? []).some((typeInfo) => (typeInfo.kind ?? '') === 'pointer'))) {
    addBlocker('pointer types')
  }
  if (userUnits.some((unit) => (unit.variables ?? []).length > 0)) {
    addBlocker('package-level vars')
  }
  if (blockers.length === 0) {
    return null
  }
  const preview = blockers.slice(0, 4).join(', ')
  const summary = blockers.length > 4 ? `${preview} (+${blockers.length - 4} more)` : preview
  return {
    errorLine: `pure-browser fallback does not support ${summary}; use the host-assisted bridge for this program`,
    logLine: `pure-browser execution unsupported features=${summary}`,
  }
}

export const createTinyGoRuntime = (options: TinyGoRuntimeOptions): TinyGoRuntime => {
  const assetBaseUrl = normalizeAssetBaseUrl(options.assetBaseUrl)
  const rustRuntimeBaseUrl = normalizeAssetBaseUrl(options.rustRuntimeBaseUrl ?? assetBaseUrl)
  const textEncoder = new TextEncoder()
  const textDecoder = new TextDecoder()
  const bootstrapGoEntrySource = options.bootstrapGoEntrySource ?? DEFAULT_TINYGO_BOOTSTRAP_GO_ENTRY_SOURCE

  let emceptionWorker: Worker | null = null
  let emception: EmceptionBridge | null = null
  let bootPromise: Promise<EmceptionBridge> | null = null
  let runtimeWorkingTreeDirty = false
  let lastBuildResult: TinyGoBuildResult | null = null
  let lastBuildArtifactPath: string | null = null
  let lastBuildArtifactBytes: Uint8Array | null = null
  let lastBuildArtifactKind: 'probe' | 'bootstrap' | 'execution' = 'execution'
  let lastBuildArtifactEntrypoint: '_start' | '_initialize' | 'main' | null = null
  let lastBuildArtifactRunnable = false
  let lastBuildArtifactReason: 'bootstrap-artifact' | 'missing-wasi-entrypoint' | undefined
  let lastFrontendAnalysisInputManifest: TinyGoFrontendInputManifest | null = null
  let injectedBuildRequestOverrides: TinyGoBuildRequestOverrides | null = null
  let injectedDriverBridgeManifest: TinyGoDriverBridgeManifest | null = null
  let injectedWorkspaceFiles: Record<string, string> | null = null
  let activeAction: TinyGoRuntimeAction | null = null
  let buildStateVersion = 0
  let activityLog = ''
  let compilerManifestPromise: Promise<TinyGoCompilerManifest | null> | null = null
  let rustRuntimeManifestLoaded = false

  const setControlsLocked = (locked: boolean) => {
    options.onControlsLockedChange?.(locked)
  }

  const setPhase = (phase: TinyGoRuntimePhase, label: string, tone: PhaseTone) => {
    options.onPhaseChange?.(phase, label, tone)
  }

  const appendLog = (message: string, tone: Exclude<PhaseTone, 'idle'> | 'idle' = 'idle') => {
    const stamp = (options.now?.() ?? new Date()).toLocaleTimeString('ko-KR', { hour12: false })
    const line = `[${stamp}] ${message}\n`
    activityLog += line
    options.onLogAppended?.({ line, message, tone })
  }

  const clearActivityLog = () => {
    activityLog = ''
    options.onLogReset?.()
  }

  const resolveAssetUrl = (assetPath: string) => new URL(assetPath, assetBaseUrl).toString()

  const resolveWorkerUrl = async (assetPath: string) =>
    await resolveRuntimeAssetUrl({
      assetPath,
      assetUrl: resolveAssetUrl(assetPath),
      label: assetPath,
      loader: options.assetLoader,
    })

  const loadAssetBytes = async (assetPath: string, label: string) =>
    await loadRuntimeAssetBytes({
      assetPath,
      assetUrl: resolveAssetUrl(assetPath),
      label,
      loader: options.assetLoader,
      packs: options.assetPacks ?? null,
      assetBaseUrl,
      onProgress: options.onProgress,
    })

  const loadCompilerManifest = async (): Promise<TinyGoCompilerManifest | null> => {
    if (compilerManifestPromise === null) {
      compilerManifestPromise = (async () => {
        try {
          const manifestBytes = await loadAssetBytes('tools/tinygo-compiler.json', 'tinygo-compiler.json')
          return JSON.parse(textDecoder.decode(manifestBytes)) as TinyGoCompilerManifest
        } catch {
          return null
        }
      })()
    }
    return await compilerManifestPromise
  }

  const loadCompilerModuleBytes = async () => {
    try {
      const compilerManifest = await loadCompilerManifest()
      const compilerBytes = await loadAssetBytes('tools/tinygo-compiler.wasm', 'tinygo-compiler.wasm')
      if (compilerManifest?.artifactKind === 'compiler') {
        appendLog(
          `tinygo compiler module loaded from tools/tinygo-compiler.wasm (mode=${compilerManifest.buildMode ?? 'direct'})`,
          'success',
        )
      } else {
        const compilerBuildMode = compilerManifest?.buildMode ?? 'unknown'
        const blockers =
          Array.isArray(compilerManifest?.blockers) && compilerManifest.blockers.length > 0
            ? ` blockers=${compilerManifest.blockers.join(',')}`
            : ''
        appendLog(
          `tinygo bootstrap module loaded from tools/tinygo-compiler.wasm (mode=${compilerBuildMode}${blockers})`,
          'success',
        )
      }
      return compilerBytes
    } catch (error) {
      appendLog('tinygo compiler module fallback to tools/go-probe.wasm', 'idle')
      return await loadAssetBytes('tools/go-probe.wasm', 'go-probe.wasm')
    }
  }

  const loadRustRuntimeAssetBytes = async (assetPath: string, label: string) =>
    await loadRuntimeAssetBytes({
      assetPath,
      assetUrl: new URL(assetPath, rustRuntimeBaseUrl).toString(),
      label,
      loader: options.assetLoader,
      packs: options.rustRuntimeAssetPacks ?? null,
      assetBaseUrl: rustRuntimeBaseUrl,
      onProgress: options.onProgress,
    })

  const toArrayBuffer = (bytes: Uint8Array) =>
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

  const runUpstreamProbe = async (): Promise<TinyGoUpstreamProbeResult> => {
    const [probeBytes, targetSource, zversionSource, armSource] = await Promise.all([
      loadAssetBytes('tools/tinygo-upstream-probe.wasm', 'tinygo-upstream-probe.wasm'),
      loadAssetBytes('tools/tinygo-upstream-probe/targets/wasip1.json', 'tinygo-upstream-probe target wasip1.json'),
      loadAssetBytes('tools/tinygo-upstream-probe/src/runtime/internal/sys/zversion.go', 'tinygo-upstream-probe zversion.go'),
      loadAssetBytes('tools/tinygo-upstream-probe/src/device/arm/arm.go', 'tinygo-upstream-probe arm.go'),
    ])
    const stdoutLines: string[] = []
    const stderrLines: string[] = []
    const tinygoRoot = new PreopenDirectory(
      '/tinygo-root',
      buildDirectoryContentsFromTextEntries(
        {
          'targets/wasip1.json': textDecoder.decode(targetSource),
          'src/runtime/internal/sys/zversion.go': textDecoder.decode(zversionSource),
          'src/device/arm/arm.go': textDecoder.decode(armSource),
        },
        textEncoder,
      ),
    )
    const stdout = ConsoleStdout.lineBuffered((line) => stdoutLines.push(line))
    const stderr = ConsoleStdout.lineBuffered((line) => stderrLines.push(line))
    const wasi = new WASI(
      ['tinygo-upstream-probe'],
      ['TINYGOROOT=/tinygo-root', 'TINYGO_WASI_TARGET=wasip1'],
      [new OpenFile(new File([])), stdout, stderr, tinygoRoot],
    )
    const instance = await instantiateWasiModule(probeBytes, {
      wasi_snapshot_preview1: wasi.wasiImport,
    })

    let exitCode = 0
    try {
      exitCode = wasi.start(instance as { exports: { memory: WebAssembly.Memory; _start: () => unknown } })
    } catch (error) {
      if (error instanceof WASIProcExit) {
        exitCode = error.code
      } else {
        throw error
      }
    }

    if (exitCode !== 0) {
      throw new Error(
        stderrLines.join('\n').trim() ||
          stdoutLines.join('\n').trim() ||
          `tinygo upstream probe exited with code ${exitCode}`,
      )
    }
    if (stderrLines.length) {
      throw new Error(stderrLines.join('\n'))
    }

    return JSON.parse(stdoutLines.join('\n')) as TinyGoUpstreamProbeResult
  }

  const verifyAndLogUpstreamFrontendProbe = (
    result: TinyGoUpstreamFrontendProbeResult,
    options?: {
      verifyAnalysisInput?: boolean
      verifyDriverBridge?: boolean
      frontendAnalysisManifest?: TinyGoFrontendAnalysisManifest | null
      frontendRealAdapterManifest?: TinyGoFrontendAnalysisManifest | null
    },
  ) => {
    const driverBridgeManifest =
      injectedDriverBridgeManifest === null ? null : cloneJsonValue(injectedDriverBridgeManifest)
    if ((options?.verifyDriverBridge ?? true) && driverBridgeManifest?.packageGraph?.length) {
      const bridgeVerification = verifyUpstreamFrontendProbeAgainstDriverBridgeManifest(result, driverBridgeManifest)
      appendLog(
        `patched upstream TinyGo WASI frontend probe matched driver bridge packages=${bridgeVerification.graphPackageCount} main=${bridgeVerification.entryImportPath}`,
        'success',
      )
    }
    if ((options?.verifyAnalysisInput ?? true) && driverBridgeManifest?.frontendAnalysisInput?.packageGraph?.length) {
      const analysisInputVerification = verifyUpstreamFrontendProbeAgainstFrontendAnalysisInputManifest(
        result,
        driverBridgeManifest.frontendAnalysisInput,
      )
      appendLog(
        `patched upstream TinyGo WASI frontend probe matched analysis input packages=${analysisInputVerification.graphPackageCount} main=${analysisInputVerification.entryImportPath}`,
        'success',
      )
    }
    if (options?.frontendAnalysisManifest?.packageGraph?.length) {
      const frontendAnalysisVerification = verifyUpstreamFrontendProbeAgainstFrontendAnalysisManifest(
        result,
        options.frontendAnalysisManifest,
      )
      appendLog(
        `patched upstream TinyGo WASI frontend probe matched frontend analysis packages=${frontendAnalysisVerification.graphPackageCount} main=${frontendAnalysisVerification.entryImportPath}`,
        'success',
      )
    }
    if (options?.frontendRealAdapterManifest?.packageGraph?.length) {
      const frontendRealAdapterVerification = verifyUpstreamFrontendProbeAgainstFrontendRealAdapterManifest(
        result,
        options.frontendRealAdapterManifest,
      )
      appendLog(
        `patched upstream TinyGo WASI frontend probe matched frontend real adapter packages=${frontendRealAdapterVerification.graphPackageCount} main=${frontendRealAdapterVerification.entryImportPath}`,
        'success',
      )
    }
  }

  const runUpstreamFrontendProbe = async (
    frontendAnalysisManifest?: TinyGoFrontendAnalysisManifest | null,
    frontendRealAdapterManifest?: TinyGoFrontendAnalysisManifest | null,
  ): Promise<TinyGoUpstreamFrontendProbeResult> => {
    const browserTinyGoRoot = '/working/.tinygo-root'
    const driverBridgeManifest =
      injectedDriverBridgeManifest === null ? null : cloneJsonValue(injectedDriverBridgeManifest)
    const workspaceFiles = injectedWorkspaceFiles ?? { 'main.go': bootstrapGoEntrySource }
    const goModSource = workspaceFiles['go.mod'] ?? ''
    let modulePathFromGoMod = ''
    let goVersionFromGoMod = ''
    if (goModSource !== '') {
      for (const line of goModSource.split('\n')) {
        const trimmed = line.trim()
        if (modulePathFromGoMod === '' && trimmed.startsWith('module ')) {
          modulePathFromGoMod = trimmed.slice('module '.length).trim()
          continue
        }
        if (goVersionFromGoMod === '' && trimmed.startsWith('go ')) {
          goVersionFromGoMod = trimmed.slice('go '.length).trim()
          continue
        }
        if (modulePathFromGoMod !== '' && goVersionFromGoMod !== '') {
          break
        }
      }
    }
    const buildContextModulePath = driverBridgeManifest?.frontendAnalysisInput?.buildContext?.modulePath ?? ''
    const resolvedModulePath = modulePathFromGoMod || buildContextModulePath
    const resolvedGoVersion = goVersionFromGoMod || '1.22'
    const normalizePackageDirForProbe = (packageInfo: {
      dir?: string
      importPath?: string
      standard?: boolean
    }) => {
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
    const packageList = driverBridgeManifest?.packageGraph?.length
      ? driverBridgeManifest.packageGraph.map((packageInfo) => {
        const dir = normalizePackageDirForProbe(packageInfo)
        const importPath = packageInfo.importPath ?? ''
        const name = packageInfo.name ?? (importPath !== '' ? importPath.split('/').pop() ?? 'main' : 'main')
        const goFiles = (packageInfo.goFiles ?? []).map((filePath: string) => {
          const slashIndex = filePath.lastIndexOf('/')
          return slashIndex >= 0 ? filePath.slice(slashIndex + 1) : filePath
        })
        const imports = packageInfo.imports ?? []
        const modulePath = packageInfo.modulePath ?? resolvedModulePath
        const isWorkspacePackage = dir.startsWith('/workspace')
        return {
          DepOnly: packageInfo.depOnly ?? false,
          Dir: dir,
          ImportPath: importPath,
          Name: name,
          Root: isWorkspacePackage ? '/workspace' : '',
          Module: isWorkspacePackage && modulePath !== '' ? {
            Path: modulePath,
            Main: true,
            Dir: '/workspace',
            GoMod: '/workspace/go.mod',
            GoVersion: resolvedGoVersion,
          } : undefined,
          GoFiles: goFiles,
          CgoFiles: [],
          CFiles: [],
          EmbedFiles: [],
          Imports: imports,
          ImportMap: {},
          Standard: packageInfo.standard ?? false,
        }
      })
      : (() => {
        const goFiles = Object.keys(workspaceFiles).filter((filePath) => filePath.endsWith('.go') && !filePath.includes('/'))
        return [
          {
            Dir: '/workspace',
            ImportPath: 'command-line-arguments',
            Name: 'main',
            Root: '/workspace',
            Module: resolvedModulePath !== '' ? {
              Path: resolvedModulePath,
              Main: true,
              Dir: '/workspace',
              GoMod: '/workspace/go.mod',
              GoVersion: resolvedGoVersion,
            } : undefined,
            GoFiles: goFiles.length ? goFiles : ['main.go'],
            CgoFiles: [],
            CFiles: [],
            EmbedFiles: [],
            Imports: [],
            ImportMap: {},
          },
        ]
      })()
    const packageListSource = `${JSON.stringify(packageList, null, 2)}\n`
    const [probeBytes, targetSource] = await Promise.all([
      loadAssetBytes('tools/tinygo-upstream-frontend-probe.wasm', 'tinygo-upstream-frontend-probe.wasm'),
      loadAssetBytes(
        'tools/tinygo-upstream-frontend-probe/targets/wasip1.json',
        'tinygo-upstream-frontend-probe target wasip1.json',
      ),
    ])
    const tinygoRootEntries: Record<string, string> = {
      'targets/wasip1.json': textDecoder.decode(targetSource),
    }
    const requiredTinyGoRootFiles = new Set<string>([
      'src/runtime/internal/sys/zversion.go',
      'src/device/arm/arm.go',
    ])
    for (const packageInfo of driverBridgeManifest?.packageGraph ?? []) {
      const packageDir = normalizePackageDirForProbe(packageInfo)
      if (!packageDir.startsWith(`${browserTinyGoRoot}/`)) {
        continue
      }
      const assetDir = packageDir.slice(`${browserTinyGoRoot}/`.length)
      for (const goFile of packageInfo.goFiles ?? []) {
        requiredTinyGoRootFiles.add(`${assetDir}/${goFile}`.replace(/\\/g, '/'))
      }
    }
    const tinygoRootFileReads = await Promise.all(
      [...requiredTinyGoRootFiles].sort().map(async (relativeAssetPath) => [
        relativeAssetPath,
        textDecoder.decode(
          await loadAssetBytes(
            `tools/tinygo-upstream-frontend-probe/goroot/${relativeAssetPath}`,
            `tinygo-upstream-frontend-probe ${relativeAssetPath}`,
          ),
        ),
      ] as const),
    )
    for (const [relativeAssetPath, contents] of tinygoRootFileReads) {
      tinygoRootEntries[relativeAssetPath] = contents
    }
    const stdoutLines: string[] = []
    const stderrLines: string[] = []
    const tinygoRoot = new PreopenDirectory(
      browserTinyGoRoot,
      buildDirectoryContentsFromTextEntries(tinygoRootEntries, textEncoder),
    )
    const workspace = new PreopenDirectory(
      '/workspace',
      buildDirectoryContentsFromTextEntries(
        {
          ...workspaceFiles,
          'package-list.json': packageListSource,
        },
        textEncoder,
      ),
    )
    const stdout = ConsoleStdout.lineBuffered((line) => stdoutLines.push(line))
    const stderr = ConsoleStdout.lineBuffered((line) => stderrLines.push(line))
    const wasi = new WASI(
      ['tinygo-upstream-frontend-probe'],
      [
        `TINYGOROOT=${browserTinyGoRoot}`,
        'TINYGO_WASI_TARGET=wasip1',
        'TINYGO_WASI_WORKING_DIR=/workspace',
        'TINYGO_WASI_PACKAGE_JSON_PATH=/workspace/package-list.json',
        'GOROOT=/go-root',
        'GOVERSION=go1.24.0',
      ],
      [new OpenFile(new File([])), stdout, stderr, tinygoRoot, workspace],
    )
    const instance = await instantiateWasiModule(probeBytes, {
      wasi_snapshot_preview1: wasi.wasiImport,
    })

    let exitCode = 0
    try {
      exitCode = wasi.start(instance as { exports: { memory: WebAssembly.Memory; _start: () => unknown } })
    } catch (error) {
      if (error instanceof WASIProcExit) {
        exitCode = error.code
      } else {
        throw error
      }
    }

    if (exitCode !== 0) {
      throw new Error(`upstream frontend probe exited with code ${exitCode}: ${stderrLines.join('\n')}`)
    }
    if (stderrLines.length) {
      throw new Error(stderrLines.join('\n'))
    }

    const result = JSON.parse(stdoutLines.join('\n')) as TinyGoUpstreamFrontendProbeResult
    verifyAndLogUpstreamFrontendProbe(result, {
      frontendAnalysisManifest,
      frontendRealAdapterManifest,
    })
    return result
  }

  void loadRustRuntimeAssetBytes('runtime-manifest.v3.json', 'wasm-rust runtime manifest')

  const instantiateWasiModule = async (
    bytes: Uint8Array,
    imports: WebAssembly.Imports,
  ): Promise<WebAssembly.Instance> => {
    const instantiated = (await WebAssembly.instantiate(
      toArrayBuffer(bytes),
      imports,
    )) as unknown
    if (instantiated instanceof WebAssembly.Instance) {
      return instantiated
    }
    return (instantiated as WebAssembly.WebAssemblyInstantiatedSource).instance
  }

  const disposeEmceptionRuntime = () => {
    emceptionWorker?.terminate()
    emceptionWorker = null
    emception = null
    bootPromise = null
    runtimeWorkingTreeDirty = false
  }

  const invalidateCachedBuildState = () => {
    buildStateVersion += 1
    lastBuildResult = null
    lastBuildArtifactPath = null
    lastBuildArtifactBytes = null
    lastBuildArtifactEntrypoint = null
    lastBuildArtifactRunnable = false
    lastBuildArtifactReason = undefined
    lastFrontendAnalysisInputManifest = null
  }

  const resetPhasesToIdle = () => {
    setPhase('toolchain', 'idle', 'idle')
    setPhase('probe', 'idle', 'idle')
    setPhase('smoke', 'idle', 'idle')
    setPhase('verify', 'idle', 'idle')
  }

  const ensureActionIdle = () => {
    if (activeAction !== null) {
      throw new Error(`wasm-tinygo test hook action already running: ${activeAction}`)
    }
  }

  const runWithAction = async <T>(action: TinyGoRuntimeAction, run: () => Promise<T>) => {
    ensureActionIdle()
    activeAction = action
    try {
      return await run()
    } finally {
      activeAction = null
    }
  }

  const ensureEmception = async () => {
    if (emception) {
      return emception
    }

    if (bootPromise) {
      return bootPromise
    }

    bootPromise = (async () => {
      setControlsLocked(true)
      setPhase('toolchain', 'booting', 'running')
      if (!rustRuntimeManifestLoaded && options.rustRuntimeAssetPacks?.length) {
        appendLog('Fetching wasm-rust runtime manifest', 'running')
        const manifestBytes = await loadRustRuntimeAssetBytes(
          'runtime-manifest.v3.json',
          'wasm-rust runtime manifest',
        )
        const manifestText = textDecoder.decode(manifestBytes)
        try {
          const manifest = JSON.parse(manifestText) as { version?: string }
          appendLog(`wasm-rust runtime manifest loaded${manifest.version ? ` version=${manifest.version}` : ''}`, 'success')
        } catch (error) {
          appendLog(
            `wasm-rust runtime manifest parse failed: ${error instanceof Error ? error.message : String(error)}`,
            'error',
          )
          throw error
        }
        rustRuntimeManifestLoaded = true
      }
      appendLog('Fetching patched emception worker', 'running')

      const workerUrl = await resolveWorkerUrl('vendor/emception/emception.worker.js')
      emceptionWorker = new Worker(workerUrl, { type: 'classic', name: 'emception-worker' })
      emception = Comlink.wrap<unknown>(emceptionWorker) as unknown as EmceptionBridge

      ;(emception as unknown as Record<string, unknown>).onstdout = Comlink.proxy(async (line: string) => {
        appendLog(line, 'running')
      })
      ;(emception as unknown as Record<string, unknown>).onstderr = Comlink.proxy(async (line: string) => {
        appendLog(line, 'error')
      })
      ;(emception as unknown as Record<string, unknown>).onprocessstart = Comlink.proxy(async (argv: string[]) => {
        appendLog(`spawn ${argv.join(' ')}`, 'running')
      })
      await emception.init()
      runtimeWorkingTreeDirty = false
      setPhase('toolchain', 'ready', 'success')
      appendLog('emception toolchain is ready', 'success')
      setControlsLocked(false)

      return emception
    })().catch((error) => {
      setPhase('toolchain', 'failed', 'error')
      setControlsLocked(false)
      disposeEmceptionRuntime()
      appendLog(`emception boot failed: ${error instanceof Error ? error.message : String(error)}`, 'error')
      throw error
    })

    return bootPromise
  }

  const planBuild = async (
    inputs: TinyGoBuildPlanInputs = {
      buildRequestOverrides: injectedBuildRequestOverrides,
      workspaceFiles: injectedWorkspaceFiles,
    },
  ) => {
    const buildStateVersionAtStart = buildStateVersion
    try {
      setPhase('probe', 'planning', 'running')
      appendLog('Writing /workspace/tinygo-request.json', 'running')

      const request: TinyGoBuildRequest = {
        command: 'build',
        planner: 'tinygo',
        entry: '/workspace/main.go',
        output: '/working/out.wasm',
        target: 'wasm',
        optimize: 'z',
        scheduler: 'tasks',
        panic: 'trap',
        ...(inputs.buildRequestOverrides ?? {}),
      }
      const workspaceFiles = {
        ...(inputs.workspaceFiles ?? { 'main.go': bootstrapGoEntrySource }),
        'tinygo-request.json': JSON.stringify(request),
      }
      const workspace = new PreopenDirectory('/workspace', buildDirectoryContentsFromTextEntries(workspaceFiles, textEncoder))
      const stdout = ConsoleStdout.lineBuffered((line) => appendLog(`driver ${line}`, 'running'))
      const stderr = ConsoleStdout.lineBuffered((line) => appendLog(`driver ${line}`, 'error'))
      const wasi = new WASI(
        ['tinygo-driver'],
        ['WASM_TINYGO_MODE=driver'],
        [new OpenFile(new File([])), stdout, stderr, workspace],
      )
      const moduleBytes = await loadCompilerModuleBytes()
      const instance = await instantiateWasiModule(moduleBytes, {
        wasi_snapshot_preview1: wasi.wasiImport,
      })

      let driverExitCode = 0
      try {
        driverExitCode = wasi.start(instance as { exports: { memory: WebAssembly.Memory; _start: () => unknown } })
      } catch (error) {
        if (error instanceof WASIProcExit) {
          driverExitCode = error.code
        } else {
          throw error
        }
      }

      const resultNode = workspace.dir.contents.get('tinygo-result.json')
      if (!(resultNode instanceof File)) {
        throw new Error(`tinygo driver did not write /workspace/tinygo-result.json (exit ${driverExitCode})`)
      }

      const result = JSON.parse(textDecoder.decode(resultNode.data)) as TinyGoBuildResult
      if (!result.ok) {
        throw new Error(result.diagnostics.join('; ') || `tinygo driver returned a failed result (exit ${driverExitCode})`)
      }

      if (buildStateVersionAtStart === buildStateVersion) {
        lastBuildResult = result
        setPhase('probe', `${result.plan.length} steps`, 'success')
        appendLog(`driver mode ${result.mode ?? 'unknown'}`, 'idle')
        appendLog(`driver planned ${result.plan.length} step(s) for ${result.artifact ?? '/working/out.wasm'}`, 'success')
        appendLog(`driver workspace files=${Object.keys(workspaceFiles).length - 1}`, 'idle')
        for (const diagnostic of result.diagnostics) {
          appendLog(`driver ${diagnostic}`, 'idle')
        }
      }

      return result
    } catch (error) {
      if (buildStateVersionAtStart === buildStateVersion) {
        setPhase('probe', 'failed', 'error')
        appendLog(`build driver failed: ${error instanceof Error ? error.message : String(error)}`, 'error')
      }
      throw error
    }
  }

  const executeBuildPlan = async () => {
    if (emception && runtimeWorkingTreeDirty) {
      disposeEmceptionRuntime()
    }
    const runtime = await ensureEmception()
    runtimeWorkingTreeDirty = false
    const buildStateVersionAtStart = buildStateVersion

    try {
      setControlsLocked(true)
      lastBuildArtifactPath = null
      lastBuildArtifactBytes = null
      lastFrontendAnalysisInputManifest = null
      const buildRequestOverrides =
        injectedBuildRequestOverrides === null ? null : cloneJsonValue(injectedBuildRequestOverrides)
      const requestedBuildTarget = buildRequestOverrides?.target ?? 'wasm'
      const driverBridgeManifest =
        injectedDriverBridgeManifest === null ? null : cloneJsonValue(injectedDriverBridgeManifest)
      const workspaceFiles = injectedWorkspaceFiles === null ? null : cloneJsonValue(injectedWorkspaceFiles)
      const result =
        lastBuildResult ??
        await planBuild({
          buildRequestOverrides,
          workspaceFiles,
        })
      const fileSystem = runtime.fileSystem
      const writableFileSystem: EmceptionWritableFileSystem = {
        exists: (path) => fileSystem.exists(path),
        mkdir: (path) => runtime.mkdir(path),
        unlink: (path) => fileSystem.unlink(path),
        writeFile: (path, contents) => fileSystem.writeFile(path, contents),
      }
      const plannerManifestSource = result.files.find((file) => file.path === '/working/tinygo-bootstrap.json')?.contents
      const frontendInputSource = result.files.find((file) => file.path === '/working/tinygo-frontend-input.json')?.contents
      const filesToMaterialize = plannerManifestSource
        ? selectBootstrapDispatchFiles(result.files, plannerManifestSource)
        : result.files
      let frontendResult: TinyGoFrontEndResult | null = null
      let frontendBootstrapArtifactExpectationSource: string | null = null
      let frontendToolPlan: ToolInvocation[] | null = null
      let frontendLoweredSourcesManifest: TinyGoLoweredSourcesManifest | null = null
      let frontendLoweredIRVerification: ReturnType<typeof verifyBackendResultManifestAgainstBackendInputAndLoweredBitcodeManifest>['loweredIR'] | null = null
      let frontendLoweredArtifactVerification: ReturnType<typeof verifyBackendResultManifestAgainstBackendInputAndLoweredBitcodeManifest>['loweredArtifact'] | null = null
      let frontendLoweredBitcodeManifestVerification: ReturnType<typeof verifyLoweredBitcodeManifestAgainstLoweringPlanAndLoweredSourcesManifest> | null = null
      let frontendCommandArtifactVerification: ReturnType<typeof verifyBackendResultManifestAgainstBackendInputAndLoweredBitcodeManifest>['commandArtifact'] | null = null
      let frontendLoweredBitcodeCompileCommands: ToolInvocation[] | null = null
      let frontendCompileUnitVerification: ReturnType<typeof verifyCompileUnitManifestAgainstCompileRequest> | null = null
      let frontendBootstrapArtifactBytes: Uint8Array | null = null
      let bridgedHostArtifact:
        | {
            artifactKind: 'probe' | 'bootstrap' | 'execution'
            bytes: Uint8Array
            entrypoint: '_start' | '_initialize' | 'main' | null
            path: string
            reason?: 'bootstrap-artifact' | 'missing-wasi-entrypoint'
            runnable: boolean
            target?: string
          }
        | null = null
      let artifactProbeVerified = false

      setPhase('smoke', 'executing', 'running')
      setPhase('verify', 'probing', 'running')
      for (const file of filesToMaterialize) {
        appendLog(`materialize ${file.path}`, 'running')
      }
      await materializeGeneratedFiles(writableFileSystem, filesToMaterialize)
      if (frontendInputSource) {
        const parsedFrontendInputManifest = JSON.parse(frontendInputSource) as TinyGoFrontendInputManifest
        const { compileUnits: _frontendAnalysisCompileUnits, ...frontendAnalysisInputManifestBase } = parsedFrontendInputManifest
        let upstreamFrontendProbeResult: TinyGoUpstreamFrontendProbeResult | null = null
        let frontendAnalysisInputManifest: TinyGoFrontendInputManifest = {
          ...frontendAnalysisInputManifestBase,
        }
        if (driverBridgeManifest) {
          const frontendInputVerification = verifyFrontendInputManifestAgainstDriverBridgeManifest(
            parsedFrontendInputManifest,
            driverBridgeManifest,
          )
          appendLog(
            `frontend input bridge verified target=${frontendInputVerification.target} llvm=${frontendInputVerification.llvmTarget} scheduler=${frontendInputVerification.scheduler} packages=${frontendInputVerification.graphPackageCount}`,
            'success',
          )
          if (driverBridgeManifest.frontendAnalysisInput) {
            const frontendAnalysisInputVerification = verifyFrontendAnalysisInputManifestAgainstDriverBridgeManifest(
              frontendAnalysisInputManifest,
              driverBridgeManifest,
            )
            appendLog(
              `frontend analysis input bridge verified target=${frontendAnalysisInputVerification.target} llvm=${frontendAnalysisInputVerification.llvmTarget} scheduler=${frontendAnalysisInputVerification.scheduler} packages=${frontendAnalysisInputVerification.graphPackageCount}`,
              'success',
            )
            frontendAnalysisInputManifest = JSON.parse(
              JSON.stringify(driverBridgeManifest.frontendAnalysisInput),
            ) as TinyGoFrontendInputManifest
            appendLog('frontend analysis input source=bridge', 'success')
          }
        }
        if (driverBridgeManifest?.upstreamFrontendProbe) {
          upstreamFrontendProbeResult = JSON.parse(
            JSON.stringify(driverBridgeManifest.upstreamFrontendProbe),
          ) as TinyGoUpstreamFrontendProbeResult
          verifyAndLogUpstreamFrontendProbe(upstreamFrontendProbeResult)
          appendLog('frontend analysis input upstream frontend probe source=bridge', 'success')
        } else if (driverBridgeManifest?.packageGraph?.length) {
          upstreamFrontendProbeResult = await runUpstreamFrontendProbe(null, null)
          appendLog('frontend analysis input upstream frontend probe source=browser', 'success')
        }
        if (upstreamFrontendProbeResult) {
          frontendAnalysisInputManifest = {
            ...frontendAnalysisInputManifest,
            upstreamFrontendProbe: upstreamFrontendProbeResult,
          }
        }
        if (buildStateVersionAtStart === buildStateVersion) {
          lastFrontendAnalysisInputManifest = JSON.parse(
            JSON.stringify(frontendAnalysisInputManifest),
          ) as TinyGoFrontendInputManifest
        }
        appendLog('run frontend handoff consumer', 'running')
        const workingContents = new Map<string, File | Directory>()
        for (const file of filesToMaterialize) {
          if (!file.path.startsWith('/working/')) {
            continue
          }
          const parts = file.path.replace('/working/', '').split('/').filter(Boolean)
          let currentDirectory = workingContents
          for (const [index, part] of parts.entries()) {
            if (index === parts.length - 1) {
              currentDirectory.set(part, new File(textEncoder.encode(file.contents)))
              continue
            }
            const existing = currentDirectory.get(part)
            if (existing instanceof Directory) {
              currentDirectory = existing.contents as unknown as Map<string, File | Directory>
              continue
            }
            const directory = new Directory(new Map())
            currentDirectory.set(part, directory)
            currentDirectory = directory.contents as unknown as Map<string, File | Directory>
          }
        }
        const working = new PreopenDirectory('/working', workingContents)
        working.dir.contents.set(
          'tinygo-frontend-analysis-input.json',
          new File(textEncoder.encode(JSON.stringify(frontendAnalysisInputManifest, null, 2))),
        )
        const frontendModuleBytes = await loadCompilerModuleBytes()
        let frontendAnalysisManifest: TinyGoFrontendAnalysisManifest | null = null
        let frontendRealAdapterManifest: TinyGoFrontendAnalysisManifest | null = null
        const bridgeFrontendAnalysisManifest = driverBridgeManifest?.frontendAnalysis
        const bridgeFrontendRealAdapterManifest =
          driverBridgeManifest?.frontendRealAdapter ?? driverBridgeManifest?.realFrontendAnalysis
        if (!bridgeFrontendAnalysisManifest) {
          const frontendAnalysisStdout = ConsoleStdout.lineBuffered((line) => appendLog(`frontend analysis ${line}`, 'running'))
          const frontendAnalysisStderr = ConsoleStdout.lineBuffered((line) => appendLog(`frontend analysis ${line}`, 'error'))
          const frontendAnalysisWasi = new WASI(
            ['tinygo-frontend-analysis'],
            [
              'WASM_TINYGO_MODE=frontend-analysis',
              'WASM_TINYGO_FRONTEND_INPUT_PATH=/working/tinygo-frontend-analysis-input.json',
              'WASM_TINYGO_FRONTEND_ANALYSIS_PATH=/working/tinygo-frontend-analysis.json',
            ],
            [new OpenFile(new File([])), frontendAnalysisStdout, frontendAnalysisStderr, working],
          )
          const frontendAnalysisInstance = await instantiateWasiModule(frontendModuleBytes, {
            wasi_snapshot_preview1: frontendAnalysisWasi.wasiImport,
          })
          let frontendAnalysisExitCode = 0
          try {
            frontendAnalysisExitCode = frontendAnalysisWasi.start(frontendAnalysisInstance as { exports: { memory: WebAssembly.Memory; _start: () => unknown } })
          } catch (error) {
            if (error instanceof WASIProcExit) {
              frontendAnalysisExitCode = error.code
            } else {
              throw error
            }
          }
          const frontendAnalysisResultNode = working.dir.contents.get('tinygo-frontend-analysis.json')
          if (!(frontendAnalysisResultNode instanceof File)) {
            throw new Error(`tinygo frontend-analysis did not write /working/tinygo-frontend-analysis.json (exit ${frontendAnalysisExitCode})`)
          }
          const frontendAnalysisResult = JSON.parse(textDecoder.decode(frontendAnalysisResultNode.data)) as TinyGoFrontEndAnalysisResult
          if (!frontendAnalysisResult.ok || !frontendAnalysisResult.analysis) {
            throw new Error(frontendAnalysisResult.diagnostics.join('; ') || `tinygo frontend-analysis returned a failed result (exit ${frontendAnalysisExitCode})`)
          }
          if (frontendAnalysisResult.analysis.toolchain?.target !== parsedFrontendInputManifest.toolchain?.target) {
            throw new Error('frontend analysis target did not match frontend input')
          }
          if (frontendAnalysisResult.analysis.toolchain?.llvmTarget !== parsedFrontendInputManifest.buildContext?.llvmTarget) {
            throw new Error('frontend analysis llvmTarget did not match frontend input')
          }
          if (frontendAnalysisResult.analysis.compileUnitManifestPath !== '/working/tinygo-compile-unit.json') {
            throw new Error('frontend analysis did not preserve the compile unit manifest path')
          }
          if (upstreamFrontendProbeResult && !frontendAnalysisResult.analysis.upstreamFrontendProbe) {
            throw new Error('frontend analysis did not preserve upstream frontend probe facts')
          }
          frontendAnalysisManifest = frontendAnalysisResult.analysis
          appendLog(
            `frontend analysis verified target=${frontendAnalysisManifest.toolchain?.target ?? 'unknown'} llvm=${frontendAnalysisManifest.toolchain?.llvmTarget ?? 'unknown'} groups=${frontendAnalysisManifest.compileGroups?.length ?? 0} compileUnits=${frontendAnalysisManifest.compileUnits?.length ?? 0} allCompile=${frontendAnalysisManifest.allCompileFiles?.length ?? 0}`,
            'success',
          )
        }
        if (bridgeFrontendRealAdapterManifest && driverBridgeManifest) {
          const realFrontendAnalysisSource = driverBridgeManifest.frontendRealAdapter ? 'canonical' : 'compat-alias'
          if (bridgeFrontendAnalysisManifest) {
            const frontendAnalysisVerification = verifyFrontendAnalysisAgainstDriverBridgeManifest(
              bridgeFrontendAnalysisManifest,
              driverBridgeManifest,
            )
            appendLog(
              `frontend analysis bridge verified target=${frontendAnalysisVerification.target} llvm=${frontendAnalysisVerification.llvmTarget} groups=${frontendAnalysisVerification.compileGroupCount} compileUnits=${frontendAnalysisVerification.compileUnitCount} allCompile=${frontendAnalysisVerification.allCompileCount} alias=${frontendAnalysisVerification.programImportAlias} program=${frontendAnalysisVerification.programImportPath}`,
              'success',
            )
            frontendAnalysisManifest = JSON.parse(
              JSON.stringify(bridgeFrontendAnalysisManifest),
            ) as TinyGoFrontendAnalysisManifest
            appendLog(
              `frontend analysis verified target=${frontendAnalysisManifest.toolchain?.target ?? 'unknown'} llvm=${frontendAnalysisManifest.toolchain?.llvmTarget ?? 'unknown'} groups=${frontendAnalysisManifest.compileGroups?.length ?? 0} compileUnits=${frontendAnalysisManifest.compileUnits?.length ?? 0} allCompile=${frontendAnalysisManifest.allCompileFiles?.length ?? 0}`,
              'success',
            )
          }
          frontendRealAdapterManifest = JSON.parse(
            JSON.stringify(bridgeFrontendRealAdapterManifest),
          ) as TinyGoFrontendAnalysisManifest
          const realFrontendAnalysisVerification = verifyFrontendAnalysisAgainstRealDriverBridgeManifest(
            frontendRealAdapterManifest,
            driverBridgeManifest,
          )
          appendLog(
            `frontend real adapter bridge verified target=${realFrontendAnalysisVerification.target} llvm=${realFrontendAnalysisVerification.llvmTarget} groups=${realFrontendAnalysisVerification.compileGroupCount} compileUnits=${realFrontendAnalysisVerification.compileUnitCount} allCompile=${realFrontendAnalysisVerification.allCompileCount} alias=${realFrontendAnalysisVerification.programImportAlias} source=${realFrontendAnalysisSource}`,
            'success',
          )
          appendLog(
            `frontend real adapter verified target=${frontendRealAdapterManifest.toolchain?.target ?? 'unknown'} llvm=${frontendRealAdapterManifest.toolchain?.llvmTarget ?? 'unknown'} groups=${frontendRealAdapterManifest.compileGroups?.length ?? 0} compileUnits=${frontendRealAdapterManifest.compileUnits?.length ?? 0} allCompile=${frontendRealAdapterManifest.allCompileFiles?.length ?? 0}`,
            'success',
          )
          if (frontendAnalysisManifest) {
            const frontendRealAdapterSeamVerification = verifyFrontendRealAdapterAgainstFrontendAnalysis(
              frontendRealAdapterManifest,
              frontendAnalysisManifest,
            )
            appendLog(
              `frontend real adapter seam verified target=${frontendRealAdapterSeamVerification.target} llvm=${frontendRealAdapterSeamVerification.llvmTarget} groups=${frontendRealAdapterSeamVerification.compileGroupCount} compileUnits=${frontendRealAdapterSeamVerification.compileUnitCount} allCompile=${frontendRealAdapterSeamVerification.allCompileCount} alias=${frontendRealAdapterSeamVerification.programImportAlias}`,
              'success',
            )
            working.dir.contents.set(
              'tinygo-frontend-analysis.json',
              new File(textEncoder.encode(JSON.stringify({
                ok: true,
                analysis: frontendAnalysisManifest,
                diagnostics: [],
              } satisfies TinyGoFrontEndAnalysisResult, null, 2))),
            )
          }
          working.dir.contents.set(
            'tinygo-frontend-real-adapter.json',
            new File(textEncoder.encode(JSON.stringify({
              ok: true,
              adapter: frontendRealAdapterManifest,
              diagnostics: [],
            } satisfies TinyGoFrontEndAdapterResult, null, 2))),
          )
          appendLog('frontend real adapter source=bridge', 'success')
        } else {
          const frontendRealAdapterMode = frontendAnalysisManifest
            ? 'frontend-real-adapter-analysis'
            : 'frontend-real-adapter'
          const frontendRealAdapterStdout = ConsoleStdout.lineBuffered((line) => appendLog(`frontend real adapter ${line}`, 'running'))
          const frontendRealAdapterStderr = ConsoleStdout.lineBuffered((line) => appendLog(`frontend real adapter ${line}`, 'error'))
          const frontendRealAdapterWasi = new WASI(
            ['tinygo-frontend-real-adapter'],
            [
              `WASM_TINYGO_MODE=${frontendRealAdapterMode}`,
              'WASM_TINYGO_FRONTEND_INPUT_PATH=/working/tinygo-frontend-input.json',
              'WASM_TINYGO_FRONTEND_ANALYSIS_PATH=/working/tinygo-frontend-analysis.json',
            ],
            [new OpenFile(new File([])), frontendRealAdapterStdout, frontendRealAdapterStderr, working],
          )
          const frontendRealAdapterInstance = await instantiateWasiModule(frontendModuleBytes, {
            wasi_snapshot_preview1: frontendRealAdapterWasi.wasiImport,
          })
          let frontendRealAdapterExitCode = 0
          try {
            frontendRealAdapterExitCode = frontendRealAdapterWasi.start(frontendRealAdapterInstance as { exports: { memory: WebAssembly.Memory; _start: () => unknown } })
          } catch (error) {
            if (error instanceof WASIProcExit) {
              frontendRealAdapterExitCode = error.code
            } else {
              throw error
            }
          }
          const frontendRealAdapterResultNode = working.dir.contents.get('tinygo-frontend-real-adapter.json')
          if (!(frontendRealAdapterResultNode instanceof File)) {
            throw new Error(`tinygo frontend-real-adapter did not write /working/tinygo-frontend-real-adapter.json (exit ${frontendRealAdapterExitCode})`)
          }
          const frontendRealAdapterResult = JSON.parse(textDecoder.decode(frontendRealAdapterResultNode.data)) as TinyGoFrontEndAdapterResult
          if (!frontendRealAdapterResult.ok || !frontendRealAdapterResult.adapter) {
            throw new Error(frontendRealAdapterResult.diagnostics.join('; ') || `tinygo frontend-real-adapter returned a failed result (exit ${frontendRealAdapterExitCode})`)
          }
          if (frontendRealAdapterResult.adapter.toolchain?.target !== parsedFrontendInputManifest.toolchain?.target) {
            throw new Error('frontend real adapter target did not match frontend input')
          }
          if (frontendRealAdapterResult.adapter.toolchain?.llvmTarget !== parsedFrontendInputManifest.buildContext?.llvmTarget) {
            throw new Error('frontend real adapter llvmTarget did not match frontend input')
          }
          if (frontendRealAdapterResult.adapter.compileUnitManifestPath !== '/working/tinygo-compile-unit.json') {
            throw new Error('frontend real adapter did not preserve the compile unit manifest path')
          }
          if ((frontendRealAdapterResult.adapter.compileUnits?.length ?? 0) !== (parsedFrontendInputManifest.compileUnits?.length ?? 0)) {
            throw new Error('frontend real adapter compile unit count did not match frontend input')
          }
          if ((frontendRealAdapterResult.adapter.allCompileFiles?.length ?? 0) !== (parsedFrontendInputManifest.sourceSelection?.allCompile?.length ?? 0)) {
            throw new Error('frontend real adapter all-compile count did not match frontend input')
          }
          appendLog(
            `frontend real adapter verified target=${frontendRealAdapterResult.adapter.toolchain?.target ?? 'unknown'} llvm=${frontendRealAdapterResult.adapter.toolchain?.llvmTarget ?? 'unknown'} groups=${frontendRealAdapterResult.adapter.compileGroups?.length ?? 0} compileUnits=${frontendRealAdapterResult.adapter.compileUnits?.length ?? 0} allCompile=${frontendRealAdapterResult.adapter.allCompileFiles?.length ?? 0}`,
            'success',
          )
          if (driverBridgeManifest?.frontendRealAdapter || driverBridgeManifest?.realFrontendAnalysis) {
            const realFrontendAnalysisSource = driverBridgeManifest?.frontendRealAdapter ? 'canonical' : 'compat-alias'
            const realFrontendAnalysisVerification = verifyFrontendAnalysisAgainstRealDriverBridgeManifest(
              frontendRealAdapterResult.adapter,
              driverBridgeManifest,
            )
            appendLog(
              `frontend real adapter bridge verified target=${realFrontendAnalysisVerification.target} llvm=${realFrontendAnalysisVerification.llvmTarget} groups=${realFrontendAnalysisVerification.compileGroupCount} compileUnits=${realFrontendAnalysisVerification.compileUnitCount} allCompile=${realFrontendAnalysisVerification.allCompileCount} alias=${realFrontendAnalysisVerification.programImportAlias} source=${realFrontendAnalysisSource}`,
              'success',
            )
          }
          frontendRealAdapterManifest = frontendRealAdapterResult.adapter
          appendLog(`frontend real adapter source=${frontendAnalysisManifest ? 'analysis' : 'input'}`, 'success')
        }
        const frontendStdout = ConsoleStdout.lineBuffered((line) => appendLog(`frontend ${line}`, 'running'))
        const frontendStderr = ConsoleStdout.lineBuffered((line) => appendLog(`frontend ${line}`, 'error'))
        if (
          driverBridgeManifest?.packageGraph?.length &&
          (
            frontendAnalysisManifest?.packageGraph?.length ||
            frontendRealAdapterManifest?.packageGraph?.length
          )
        ) {
          if (upstreamFrontendProbeResult) {
            verifyAndLogUpstreamFrontendProbe(upstreamFrontendProbeResult, {
              verifyAnalysisInput: false,
              verifyDriverBridge: false,
              frontendAnalysisManifest,
              frontendRealAdapterManifest,
            })
          } else {
            upstreamFrontendProbeResult = await runUpstreamFrontendProbe(frontendAnalysisManifest, frontendRealAdapterManifest)
          }
        }
        appendLog('frontend build mode=frontend', 'success')
        appendLog('frontend build source=real-adapter', 'success')
        const frontendWasi = new WASI(
          ['tinygo-frontend'],
          ['WASM_TINYGO_MODE=frontend'],
          [new OpenFile(new File([])), frontendStdout, frontendStderr, working],
        )
        const frontendInstance = await instantiateWasiModule(frontendModuleBytes, {
          wasi_snapshot_preview1: frontendWasi.wasiImport,
        })
        let frontendExitCode = 0
        try {
          frontendExitCode = frontendWasi.start(frontendInstance as { exports: { memory: WebAssembly.Memory; _start: () => unknown } })
        } catch (error) {
          if (error instanceof WASIProcExit) {
            frontendExitCode = error.code
          } else {
            throw error
          }
        }
        const frontendResultNode = working.dir.contents.get('tinygo-frontend-result.json')
        if (!(frontendResultNode instanceof File)) {
          throw new Error(`tinygo frontend did not write /working/tinygo-frontend-result.json (exit ${frontendExitCode})`)
        }
        frontendResult = JSON.parse(textDecoder.decode(frontendResultNode.data)) as TinyGoFrontEndResult
        if (!frontendResult.ok) {
          throw new Error(frontendResult.diagnostics.join('; ') || `tinygo frontend returned a failed result (exit ${frontendExitCode})`)
        }
        if (frontendResult.generatedFiles?.length) {
          for (const file of frontendResult.generatedFiles) {
            appendLog(`frontend materialize ${file.path}`, 'running')
          }
          await materializeGeneratedFiles(writableFileSystem, frontendResult.generatedFiles)
        }
        const compileUnitManifest = frontendResult.generatedFiles?.find((file) => file.path === '/working/tinygo-compile-unit.json')
        if (!compileUnitManifest) {
          throw new Error('frontend generated files did not include /working/tinygo-compile-unit.json')
        }
        const intermediateManifest = frontendResult.generatedFiles?.find((file) => file.path === '/working/tinygo-intermediate.json')
        if (!intermediateManifest) {
          throw new Error('frontend generated files did not include /working/tinygo-intermediate.json')
        }
        const loweringManifest = frontendResult.generatedFiles?.find((file) => file.path === '/working/tinygo-lowering-input.json')
        if (!loweringManifest) {
          throw new Error('frontend generated files did not include /working/tinygo-lowering-input.json')
        }
        const workItemsManifest = frontendResult.generatedFiles?.find((file) => file.path === '/working/tinygo-work-items.json')
        if (!workItemsManifest) {
          throw new Error('frontend generated files did not include /working/tinygo-work-items.json')
        }
        const loweringPlanManifest = frontendResult.generatedFiles?.find((file) => file.path === '/working/tinygo-lowering-plan.json')
        if (!loweringPlanManifest) {
          throw new Error('frontend generated files did not include /working/tinygo-lowering-plan.json')
        }
        const backendInputManifest = frontendResult.generatedFiles?.find((file) => file.path === '/working/tinygo-backend-input.json')
        if (!backendInputManifest) {
          throw new Error('frontend generated files did not include /working/tinygo-backend-input.json')
        }
        appendLog(`frontend request manifest=${compileUnitManifest.path}`, 'idle')
        const parsedCompileUnitManifest = JSON.parse(compileUnitManifest.contents) as TinyGoCompileUnitManifest
        const compileUnitVerification = verifyCompileUnitManifestAgainstCompileRequest(parsedCompileUnitManifest, {})
        frontendCompileUnitVerification = compileUnitVerification
        const parsedIntermediateManifest = JSON.parse(intermediateManifest.contents) as TinyGoIntermediateManifest
        const intermediateVerification = verifyIntermediateManifestAgainstCompileUnitManifest(
          parsedCompileUnitManifest,
          parsedIntermediateManifest,
        )
        const parsedLoweringManifest = JSON.parse(loweringManifest.contents) as TinyGoLoweringManifest
        const loweringVerification = verifyLoweringManifestAgainstIntermediateManifest(
          parsedIntermediateManifest,
          parsedLoweringManifest,
        )
        const parsedWorkItemsManifest = JSON.parse(workItemsManifest.contents) as TinyGoWorkItemsManifest
        const workItemsVerification = verifyWorkItemsManifestAgainstLoweringManifest(
          parsedLoweringManifest,
          parsedWorkItemsManifest,
        )
        const parsedLoweredSourcesManifest: TinyGoLoweredSourcesManifest = {
          entryFile: parsedWorkItemsManifest.entryFile,
          optimizeFlag: parsedWorkItemsManifest.optimizeFlag,
          units: (parsedWorkItemsManifest.workItems ?? []).map((workItem) => ({
            ...(() => {
              const kind = workItem.kind ?? ''
              if (kind === 'program') {
                return { depOnly: false, standard: false }
              }
              if (kind === 'imported') {
                return { depOnly: true, standard: false }
              }
              if (kind === 'stdlib') {
                return { depOnly: true, standard: true }
              }
              return {
                ...(typeof workItem.depOnly === 'boolean' ? { depOnly: workItem.depOnly } : {}),
                ...(typeof workItem.standard === 'boolean' ? { standard: workItem.standard } : {}),
              }
            })(),
            id: workItem.id ?? '',
            kind: workItem.kind ?? '',
            importPath: workItem.importPath ?? '',
            imports: Array.isArray(workItem.imports) ? [...workItem.imports] : [],
            modulePath: workItem.modulePath ?? '',
            packageName: workItem.packageName ?? '',
            packageDir: workItem.packageDir ?? '',
            sourceFiles: workItem.files ?? [],
            loweredSourcePath: `/working/tinygo-lowered/${workItem.id ?? ''}.c`,
          })),
        }
        frontendLoweredSourcesManifest = parsedLoweredSourcesManifest
        const loweredSourcesVerification = verifyLoweredSourcesManifestAgainstWorkItemsManifest(
          parsedWorkItemsManifest,
          parsedLoweredSourcesManifest,
        )
        const parsedLoweringPlanManifest = JSON.parse(loweringPlanManifest.contents) as TinyGoLoweringPlanManifest
        const loweringPlanVerification = verifyLoweringPlanAgainstWorkItemsManifest(
          parsedWorkItemsManifest,
          parsedLoweringPlanManifest,
        )
        const parsedBackendInputManifest = JSON.parse(backendInputManifest.contents) as TinyGoBackendInputManifest
        const backendInputVerification = verifyBackendInputManifestAgainstLoweringPlanAndLoweredSourcesManifest(
          parsedLoweringPlanManifest,
          parsedLoweredSourcesManifest,
          parsedBackendInputManifest,
        )
        frontendBootstrapArtifactExpectationSource = compileUnitManifest.contents
        appendLog(
          `frontend intermediate target=${intermediateVerification.toolchain.target} targetAssets=${intermediateVerification.sourceSelection.targetAssets.length} runtime=${intermediateVerification.sourceSelection.runtimeSupport.length} program=${intermediateVerification.sourceSelection.program.length} imported=${intermediateVerification.sourceSelection.imported.length} stdlib=${intermediateVerification.sourceSelection.stdlib.length} compileUnits=${intermediateVerification.compileUnits.length}`,
          'idle',
        )
        appendLog(
          `frontend lowering targetAssets=${loweringVerification.support.targetAssets.length} runtime=${loweringVerification.support.runtimeSupport.length} compileUnits=${loweringVerification.compileUnits.length}`,
          'idle',
        )
        appendLog(
          `frontend work items count=${workItemsVerification.workItems.length} last=${workItemsVerification.workItems.length === 0 ? 'none' : workItemsVerification.workItems[workItemsVerification.workItems.length - 1]?.bitcodeOutputPath ?? 'none'}`,
          'idle',
        )
        appendLog(
          `frontend lowered sources count=${loweredSourcesVerification.units.length} last=${loweredSourcesVerification.units.length === 0 ? 'none' : loweredSourcesVerification.units[loweredSourcesVerification.units.length - 1]?.loweredSourcePath ?? 'none'}`,
          'idle',
        )
        appendLog(
          `frontend lowering plan compileJobs=${loweringPlanVerification.compileJobs.length} linkInputs=${loweringPlanVerification.linkJob.bitcodeInputs.length}`,
          'idle',
        )
        appendLog(
          `frontend backend input compileJobs=${backendInputVerification.compileJobs.length} loweredUnits=${backendInputVerification.loweredUnits.length}`,
          'idle',
        )
        if (
          parsedCompileUnitManifest.toolchain?.translationUnitPath &&
          !frontendResult.generatedFiles?.some(
            (file) => file.path === parsedCompileUnitManifest.toolchain?.translationUnitPath,
          )
        ) {
          throw new Error(
            `frontend generated files did not include ${parsedCompileUnitManifest.toolchain.translationUnitPath}`,
          )
        }
        frontendToolPlan = compileUnitVerification.toolPlan
        appendLog(
          `frontend groups program=${compileUnitVerification.summary.programCount} imported=${compileUnitVerification.summary.importedCount} stdlib=${compileUnitVerification.summary.stdlibCount} all=${compileUnitVerification.summary.allCompileCount}`,
          'idle',
        )
        appendLog(
          `frontend compile unit tu=${parsedCompileUnitManifest.toolchain?.translationUnitPath ?? '/working/tinygo-bootstrap.c'} object=${parsedCompileUnitManifest.toolchain?.objectOutputPath ?? '/working/tinygo-bootstrap.o'} output=${parsedCompileUnitManifest.toolchain?.artifactOutputPath ?? 'unknown'} all=${parsedCompileUnitManifest.sourceSelection?.allCompile?.length ?? 0}`,
          'idle',
        )
        appendLog(
          `frontend compile unit program=${compileUnitVerification.summary.programCount} imported=${compileUnitVerification.summary.importedCount} stdlib=${compileUnitVerification.summary.stdlibCount} all=${compileUnitVerification.summary.allCompileCount}`,
          'idle',
        )
        if (driverBridgeManifest) {
          const bridgeVerification = verifyCompileUnitManifestAgainstDriverBridgeManifest(
            parsedCompileUnitManifest,
            driverBridgeManifest,
          )
          appendLog(
            `frontend bridge verified target=${bridgeVerification.target} llvm=${bridgeVerification.llvmTarget} program=${bridgeVerification.programPackageName ?? 'unknown'} imports=${bridgeVerification.bridgeEntryImports.length} packages=${bridgeVerification.bridgePackageGraphImportPaths.length}`,
            'success',
          )
          appendLog(
            `frontend bridge coverage compileUnits=${bridgeVerification.compileUnitCount} graphPackages=${bridgeVerification.graphPackageCount} coveredPackages=${bridgeVerification.coveredPackageCount}/${bridgeVerification.bridgePackageCount} compileUnitFiles=${bridgeVerification.compileUnitFileCount} coveredFiles=${bridgeVerification.coveredFileCount}/${bridgeVerification.bridgeFileCount} depOnly=${bridgeVerification.depOnlyPackageCount} standard=${bridgeVerification.standardPackageCount} local=${bridgeVerification.localPackageCount} alias=${bridgeVerification.programImportAlias}`,
            'idle',
          )
          if ((driverBridgeManifest.toolchain?.version ?? '') !== '') {
            appendLog(`frontend bridge toolchain version=${driverBridgeManifest.toolchain?.version ?? ''}`, 'idle')
          }
        }
        if (frontendToolPlan?.length) {
          appendLog(`frontend tool plan ${frontendToolPlan.length} step(s)`, 'idle')
        }
        if (driverBridgeManifest?.hostArtifact?.bytesBase64) {
          const hostArtifactBytes = Uint8Array.from(
            atob(driverBridgeManifest.hostArtifact.bytesBase64),
            (char) => char.charCodeAt(0),
          )
          const hostArtifactExportNames = WebAssembly.Module.exports(
            new WebAssembly.Module(hostArtifactBytes),
          ).map((entry) => entry.name)
          const hostArtifactEntrypoint = driverBridgeManifest.hostArtifact.entrypoint ?? (
            hostArtifactExportNames.includes('_start')
              ? '_start'
              : hostArtifactExportNames.includes('_initialize')
                ? '_initialize'
                : hostArtifactExportNames.includes('main')
                  ? 'main'
                  : null
          )
          bridgedHostArtifact = {
            artifactKind: driverBridgeManifest.hostArtifact.artifactKind ?? 'execution',
            bytes: hostArtifactBytes,
            entrypoint: hostArtifactEntrypoint,
            path:
              frontendRealAdapterManifest?.toolchain?.artifactOutputPath ??
              frontendAnalysisManifest?.toolchain?.artifactOutputPath ??
              result.artifact ??
              driverBridgeManifest.hostArtifact.path ??
              '/working/out.wasm',
            reason:
              hostArtifactEntrypoint === null
                ? (driverBridgeManifest.hostArtifact.reason ?? 'missing-wasi-entrypoint')
                : driverBridgeManifest.hostArtifact.reason,
            runnable: driverBridgeManifest.hostArtifact.runnable ?? (hostArtifactEntrypoint !== null),
            target: driverBridgeManifest.hostArtifact.target,
          }
          for (const line of driverBridgeManifest.hostArtifact.logs ?? []) {
            appendLog(line, 'success')
          }
          if ((driverBridgeManifest.hostArtifact.command ?? []).length !== 0) {
            appendLog(`bridge host artifact command=${(driverBridgeManifest.hostArtifact.command ?? []).join(' ')}`, 'idle')
          }
          appendLog(
            `backend source=bridge host artifact target=${bridgedHostArtifact.target ?? 'unknown'} runnable=${bridgedHostArtifact.runnable} path=${bridgedHostArtifact.path}`,
            bridgedHostArtifact.runnable ? 'success' : 'idle',
          )
        } else {
          appendLog('run backend handoff consumer', 'running')
          const backendWorkingContents = new Map<string, File | Directory>()
          const backendWorkspaceContents = buildDirectoryContentsFromTextEntries(
            workspaceFiles ?? { 'main.go': bootstrapGoEntrySource },
            textEncoder,
          )
          for (const file of [...filesToMaterialize, ...(frontendResult.generatedFiles ?? [])]) {
            if (!file.path.startsWith('/working/')) {
              continue
            }
            const parts = file.path.replace('/working/', '').split('/').filter(Boolean)
            let currentDirectory = backendWorkingContents
            for (const [index, part] of parts.entries()) {
              if (index === parts.length - 1) {
                currentDirectory.set(part, new File(textEncoder.encode(file.contents)))
                continue
              }
              const existing = currentDirectory.get(part)
              if (existing instanceof Directory) {
                currentDirectory = existing.contents as unknown as Map<string, File | Directory>
                continue
              }
              const directory = new Directory(new Map())
              currentDirectory.set(part, directory)
              currentDirectory = directory.contents as unknown as Map<string, File | Directory>
            }
          }
          const backendWorking = new PreopenDirectory('/working', backendWorkingContents)
          const backendWorkspace = new PreopenDirectory('/workspace', backendWorkspaceContents)
          const backendStdout = ConsoleStdout.lineBuffered((line) => appendLog(`backend ${line}`, 'running'))
          const backendStderr = ConsoleStdout.lineBuffered((line) => appendLog(`backend ${line}`, 'error'))
          const backendWasi = new WASI(
            ['tinygo-backend'],
            ['WASM_TINYGO_MODE=backend'],
            [new OpenFile(new File([])), backendStdout, backendStderr, backendWorking, backendWorkspace],
          )
          const backendInstance = await instantiateWasiModule(frontendModuleBytes, {
            wasi_snapshot_preview1: backendWasi.wasiImport,
          })
          let backendExitCode = 0
          try {
            backendExitCode = backendWasi.start(backendInstance as { exports: { memory: WebAssembly.Memory; _start: () => unknown } })
          } catch (error) {
            if (error instanceof WASIProcExit) {
              backendExitCode = error.code
            } else {
              throw error
            }
          }
          const backendResultNode = backendWorking.dir.contents.get('tinygo-backend-result.json')
          if (!(backendResultNode instanceof File)) {
            throw new Error(`tinygo backend did not write /working/tinygo-backend-result.json (exit ${backendExitCode})`)
          }
          const backendResult = JSON.parse(textDecoder.decode(backendResultNode.data)) as TinyGoBackendResultManifest
          if (!backendResult.ok) {
            throw new Error((backendResult.diagnostics ?? []).join('; ') || `tinygo backend returned a failed result (exit ${backendExitCode})`)
          }
          const backendResultVerification = verifyBackendResultManifestAgainstBackendInputAndLoweredBitcodeManifest(
            parsedBackendInputManifest,
            {
              bitcodeFiles: backendInputVerification.compileJobs.map((compileJob) => compileJob.bitcodeOutputPath ?? ''),
            } as TinyGoLoweredBitcodeManifest,
            backendResult,
          )
          frontendLoweredBitcodeManifestVerification = backendResultVerification.loweredBitcodeManifest
          if (backendResultVerification.generatedFiles.length) {
            for (const file of backendResultVerification.generatedFiles) {
              appendLog(`backend materialize ${file.path}`, 'running')
            }
            await materializeGeneratedFiles(writableFileSystem, backendResultVerification.generatedFiles)
          }
          const commandBatchVerification = backendResultVerification.commandBatch
          const loweredCommandBatchVerification = backendResultVerification.loweredCommandBatch
          const loweredArtifactVerification = backendResultVerification.loweredArtifact
          const commandArtifactVerification = backendResultVerification.commandArtifact
          const loweredIRVerification = backendResultVerification.loweredIR
          frontendLoweredIRVerification = loweredIRVerification
          frontendLoweredArtifactVerification = loweredArtifactVerification
          frontendCommandArtifactVerification = commandArtifactVerification
          frontendLoweredSourcesManifest = backendResultVerification.loweredSources
          appendLog(
            `backend lowered ir units=${loweredIRVerification.units?.length ?? 0} imports=${(loweredIRVerification.units ?? []).reduce((count, unit) => count + (unit.imports?.length ?? 0), 0)} functions=${(loweredIRVerification.units ?? []).reduce((count, unit) => count + (unit.functions?.length ?? 0), 0)} types=${(loweredIRVerification.units ?? []).reduce((count, unit) => count + (unit.types?.length ?? 0), 0)} consts=${(loweredIRVerification.units ?? []).reduce((count, unit) => count + (unit.constants?.length ?? 0), 0)} vars=${(loweredIRVerification.units ?? []).reduce((count, unit) => count + (unit.variables?.length ?? 0), 0)} decls=${(loweredIRVerification.units ?? []).reduce((count, unit) => count + (unit.declarations?.length ?? 0), 0)}`,
            'idle',
          )
          appendLog(
            `backend lowered command batch compile=${loweredCommandBatchVerification.compileCommands.length} linkArgv=${loweredCommandBatchVerification.linkCommand.argv.length}`,
            'idle',
          )
          appendLog(
            `backend lowered artifact objects=${loweredArtifactVerification.objectFiles.length} output=${loweredArtifactVerification.artifactOutputPath}`,
            'idle',
          )
          appendLog(
            `backend command batch compile=${commandBatchVerification.compileCommands.length} linkArgv=${commandBatchVerification.linkCommand.argv.length}`,
            'idle',
          )
          appendLog(
            `backend command artifact output=${commandArtifactVerification.artifactOutputPath} inputs=${commandArtifactVerification.bitcodeFiles.length}`,
            'idle',
          )
          appendLog(
            `backend lowered bitcode outputs=${backendResultVerification.loweredBitcodeManifest.bitcodeFiles.length} last=${backendResultVerification.loweredBitcodeManifest.bitcodeFiles.length === 0 ? 'none' : backendResultVerification.loweredBitcodeManifest.bitcodeFiles[backendResultVerification.loweredBitcodeManifest.bitcodeFiles.length - 1] ?? 'none'}`,
            'idle',
          )
          if (frontendToolPlan?.length) {
            appendLog('frontend bootstrap tool plan skipped: backend lowering is active', 'idle')
          }
          for (const step of [...loweredCommandBatchVerification.compileCommands, loweredCommandBatchVerification.linkCommand]) {
            appendLog(`$ ${step.argv.join(' ')}`, 'running')
            const stepResult = await runtime._run_process_impl(step.argv, { cwd: step.cwd })
            if (stepResult.returncode !== 0) {
              setPhase('smoke', 'failed', 'error')
              if (stepResult.stdout.trim() !== '') {
                appendLog(stepResult.stdout.trim(), 'error')
              }
              if (stepResult.stderr.trim() !== '') {
                appendLog(stepResult.stderr.trim(), 'error')
              }
              appendLog(`lowered build step failed with exit code ${stepResult.returncode}`, 'error')
              return
            }
          }
          const loweredBitcodeCompileCommands = commandBatchVerification.compileCommands
          frontendLoweredBitcodeCompileCommands = loweredBitcodeCompileCommands
          const loweredBitcodeOutputDirectories = new Set<string>()
          for (const step of loweredBitcodeCompileCommands) {
            const outputPath = step.argv[step.argv.length - 1] ?? ''
            const segments = outputPath.split('/').filter(Boolean)
            let currentPath = ''
            for (const [index, segment] of segments.entries()) {
              currentPath += `/${segment}`
              if (index === 0 || index === segments.length - 1 || loweredBitcodeOutputDirectories.has(currentPath)) {
                continue
              }
              try {
                await writableFileSystem.mkdir(currentPath)
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                if (!message.includes('exists')) {
                  throw error
                }
              }
              loweredBitcodeOutputDirectories.add(currentPath)
            }
          }
          for (const step of loweredBitcodeCompileCommands) {
            appendLog(`$ ${step.argv.join(' ')}`, 'running')
            const stepResult = await runtime._run_process_impl(step.argv, { cwd: step.cwd })
            if (stepResult.returncode !== 0) {
              setPhase('smoke', 'failed', 'error')
              if (stepResult.stdout.trim() !== '') {
                appendLog(stepResult.stdout.trim(), 'error')
              }
              if (stepResult.stderr.trim() !== '') {
                appendLog(stepResult.stderr.trim(), 'error')
              }
              appendLog(`lowered bitcode step failed with exit code ${stepResult.returncode}`, 'error')
              return
            }
          }
          appendLog(`$ ${commandBatchVerification.linkCommand.argv.join(' ')}`, 'running')
          const commandLinkResult = await runtime._run_process_impl(
            commandBatchVerification.linkCommand.argv,
            { cwd: commandBatchVerification.linkCommand.cwd },
          )
          if (commandLinkResult.returncode !== 0) {
            if (commandLinkResult.stdout.trim() !== '') {
              appendLog(commandLinkResult.stdout.trim(), 'error')
            }
            if (commandLinkResult.stderr.trim() !== '') {
              appendLog(commandLinkResult.stderr.trim(), 'error')
            }
            const pureBrowserFallbackFailure = describePureBrowserFallbackFailure(
              requestedBuildTarget,
              frontendLoweredIRVerification,
            )
            if (pureBrowserFallbackFailure) {
              appendLog(pureBrowserFallbackFailure.logLine, 'error')
              throw new Error(pureBrowserFallbackFailure.errorLine)
            }
            setPhase('smoke', 'failed', 'error')
            appendLog(`final artifact link failed with exit code ${commandLinkResult.returncode}`, 'error')
            return
          }
        }
      } else {
        for (const step of result.plan) {
          appendLog(`$ ${step.argv.join(' ')}`, 'running')
          const stepResult = await runtime._run_process_impl(step.argv, { cwd: step.cwd })
          if (stepResult.returncode !== 0) {
            setPhase('smoke', 'failed', 'error')
            if (stepResult.stdout.trim() !== '') {
              appendLog(stepResult.stdout.trim(), 'error')
            }
            if (stepResult.stderr.trim() !== '') {
              appendLog(stepResult.stderr.trim(), 'error')
            }
            appendLog(`build step failed with exit code ${stepResult.returncode}`, 'error')
            return
          }
        }
      }

      const artifactPath =
        bridgedHostArtifact?.path ??
        frontendCommandArtifactVerification?.artifactOutputPath ??
        result.artifact ??
        '/working/out.wasm'
      const artifact = bridgedHostArtifact?.bytes ?? await fileSystem.readFile(artifactPath)
      const artifactBytes = typeof artifact === 'string' ? textEncoder.encode(artifact) : artifact
      const size = artifactBytes.byteLength
      const exportNames = WebAssembly.Module.exports(
        new WebAssembly.Module(new Uint8Array(artifactBytes)),
      ).map((entry) => entry.name)
      const manifestArtifactKind = bridgedHostArtifact?.artifactKind ?? frontendCommandArtifactVerification?.artifactKind
      const hasBootstrapManifestExports =
        manifestArtifactKind === undefined &&
        exportNames.includes('tinygo_embedded_manifest_len') &&
        exportNames.includes('tinygo_embedded_manifest_ptr')
      lastBuildArtifactPath = artifactPath
      lastBuildArtifactBytes = new Uint8Array(artifactBytes)
      lastBuildArtifactKind = bridgedHostArtifact?.artifactKind ?? frontendCommandArtifactVerification?.artifactKind ?? (
        hasBootstrapManifestExports ? 'bootstrap' : 'execution'
      )
      lastBuildArtifactEntrypoint = bridgedHostArtifact?.entrypoint ?? frontendCommandArtifactVerification?.entrypoint ?? (
        hasBootstrapManifestExports
        ? null
        : exportNames.includes('_start')
          ? '_start'
          : exportNames.includes('main') && exportNames.includes('_initialize')
            ? '_initialize'
            : exportNames.includes('main')
              ? 'main'
              : null
      )
      lastBuildArtifactRunnable = bridgedHostArtifact?.runnable ?? frontendCommandArtifactVerification?.runnable ?? (lastBuildArtifactEntrypoint !== null)
      lastBuildArtifactReason = lastBuildArtifactRunnable
        ? undefined
        : bridgedHostArtifact?.reason ?? frontendCommandArtifactVerification?.reason ?? (
          hasBootstrapManifestExports
            ? 'bootstrap-artifact'
            : 'missing-wasi-entrypoint'
        )
      setPhase('smoke', `${size.toLocaleString()} bytes`, 'success')
      appendLog(`build artifact ready: ${artifactPath} (${size.toLocaleString()} bytes)`, 'success')
      if (!lastBuildArtifactRunnable) {
        appendLog(
          hasBootstrapManifestExports
            ? 'build artifact execution blocked: bootstrap artifact has no WASI entrypoint'
            : 'build artifact execution blocked: final artifact has no supported WASI entrypoint',
          'idle',
        )
      }
      if (frontendResult) {
        if (bridgedHostArtifact) {
          appendLog(
            `frontend final artifact source=bridge host artifact target=${bridgedHostArtifact.target ?? 'unknown'} output=${artifactPath}`,
            'success',
          )
          appendLog('frontend lowered verification skipped: bridge host artifact bypassed synthetic backend lowering', 'idle')
        } else {
          if (!frontendCommandArtifactVerification) {
            throw new Error('missing command artifact verification for final artifact output')
          }
          const finalArtifactVerification = verifyTinyGoFinalArtifactFile(frontendCommandArtifactVerification, {
            path: artifactPath,
            bytes: artifact,
          })
          appendLog(
            `frontend final artifact verified format=${finalArtifactVerification.format} output=${finalArtifactVerification.path}`,
            'success',
          )
          if (!frontendLoweredArtifactVerification) {
            throw new Error('missing lowered artifact verification for lowered object outputs')
          }
          const loweredObjectVerification = verifyTinyGoLoweredObjectFiles(
            frontendLoweredArtifactVerification,
            await Promise.all(frontendLoweredArtifactVerification.objectFiles.map(async (objectFile) => ({
              path: objectFile,
              bytes: await fileSystem.readFile(objectFile),
            }))),
          )
          appendLog(
            `frontend lowered objects ready count=${loweredObjectVerification.objectFiles.length} total=${loweredObjectVerification.totalBytes.toLocaleString()} bytes`,
            'success',
          )
          appendLog(
            `frontend lowered objects verified format=wasm count=${loweredObjectVerification.objectFiles.length}`,
            'success',
          )
          if (!frontendLoweredBitcodeCompileCommands) {
            throw new Error('missing lowered bitcode compile commands for lowered bitcode outputs')
          }
          if (!frontendLoweredBitcodeManifestVerification) {
            throw new Error('missing lowered bitcode manifest verification for lowered bitcode outputs')
          }
          const loweredBitcodeVerification = verifyTinyGoLoweredBitcodeFiles(
            frontendLoweredBitcodeManifestVerification.bitcodeFiles,
            await Promise.all(frontendLoweredBitcodeManifestVerification.bitcodeFiles.map(async (bitcodeFile) => ({
              path: bitcodeFile,
              bytes: await fileSystem.readFile(bitcodeFile),
            }))),
          )
          appendLog(
            `frontend lowered bitcode ready count=${loweredBitcodeVerification.bitcodeFiles.length} total=${loweredBitcodeVerification.totalBytes.toLocaleString()} bytes`,
            'success',
          )
          appendLog(
            `frontend lowered bitcode verified format=llvm-bc count=${loweredBitcodeVerification.bitcodeFiles.length}`,
            'success',
          )
          const loweredArtifact = await fileSystem.readFile('/working/tinygo-lowered-out.wasm')
          const loweredArtifactSize = typeof loweredArtifact === 'string' ? loweredArtifact.length : loweredArtifact.byteLength
          appendLog(`frontend lowered artifact ready: /working/tinygo-lowered-out.wasm (${loweredArtifactSize.toLocaleString()} bytes)`, 'success')
        }
      }
      try {
        appendLog('frontend final artifact compiled module=ok', 'success')
        if (lastBuildArtifactRunnable) {
          artifactProbeVerified = true
        } else {
          if (lastBuildArtifactKind !== 'bootstrap') {
            if (!frontendCommandArtifactVerification) {
              setPhase('verify', 'failed', 'error')
              appendLog('frontend bootstrap probe skipped: final artifact is not bootstrap', 'error')
              return
            }
            appendLog('frontend bootstrap probe skipped: final artifact is not bootstrap', 'idle')
            artifactProbeVerified = true
          } else {
          if (!frontendBootstrapArtifactBytes) {
            setPhase('verify', 'failed', 'error')
            appendLog('frontend bootstrap probe skipped: bootstrap artifact missing', 'error')
            return
          }
          const bootstrapArtifactBytes = frontendBootstrapArtifactBytes
          const bootstrapModule =
            (await WebAssembly.instantiate(
              bootstrapArtifactBytes as BufferSource,
              {},
            )) as WebAssembly.WebAssemblyInstantiatedSource
          const bootstrapInstance = bootstrapModule.instance
          const bootstrapVerification = frontendBootstrapArtifactExpectationSource
            ? verifyTinyGoBootstrapArtifactExpectation(
                frontendBootstrapArtifactExpectationSource,
                bootstrapInstance.exports as Record<string, unknown>,
              )
            : {
                ok: false,
                reason: 'missing frontend bootstrap expectation',
              }
          const bootstrapManifest = readTinyGoBootstrapManifest(bootstrapInstance.exports as Record<string, unknown>)
          if (bootstrapManifest) {
            const parsedBootstrapManifest = JSON.parse(bootstrapManifest) as {
              entryFile?: string
              allFileCount?: number
              materializedFiles?: string[]
              sourceSelection?: {
                allCompile?: string[]
              }
            }
            const bootstrapAllFileCount = Array.isArray(parsedBootstrapManifest.sourceSelection?.allCompile)
              ? parsedBootstrapManifest.sourceSelection.allCompile.length
              : parsedBootstrapManifest.allFileCount
            appendLog(
              `bootstrap manifest entry=${parsedBootstrapManifest.entryFile ?? 'unknown'} all=${bootstrapAllFileCount ?? 'unknown'}`,
              'idle',
            )
            if (Array.isArray(parsedBootstrapManifest.materializedFiles)) {
              appendLog(
                `bootstrap dispatch materialized=${parsedBootstrapManifest.materializedFiles.length}`,
                'idle',
              )
            }
            if (bootstrapVerification?.ok) {
              appendLog(
                `bootstrap roundtrip verified entry=${parsedBootstrapManifest.entryFile ?? 'unknown'} all=${bootstrapAllFileCount ?? 'unknown'}`,
                'success',
              )
              if (frontendResult) {
                if (!frontendLoweredSourcesManifest) {
                  throw new Error('missing lowered sources manifest for lowered artifact probe')
                }
                const loweredSourceFileContents: Record<string, string | Uint8Array> = {}
                for (const unit of frontendLoweredSourcesManifest.units ?? []) {
                  for (const sourceFile of unit.sourceFiles ?? []) {
                    if (loweredSourceFileContents[sourceFile] !== undefined) {
                      continue
                    }
                    try {
                      loweredSourceFileContents[sourceFile] = await fileSystem.readFile(sourceFile)
                    } catch (error) {
                      const workspaceRelativePath = sourceFile.startsWith('/workspace/')
                        ? sourceFile.slice('/workspace/'.length)
                        : ''
                      if (
                        workspaceRelativePath !== '' &&
                        workspaceFiles !== null &&
                        workspaceFiles[workspaceRelativePath] !== undefined
                      ) {
                        loweredSourceFileContents[sourceFile] = workspaceFiles[workspaceRelativePath]
                        continue
                      }
                      if (sourceFile === '/workspace/main.go') {
                        loweredSourceFileContents[sourceFile] = bootstrapGoEntrySource
                        continue
                      }
                      throw error
                    }
                  }
                }
                const loweredArtifact = await fileSystem.readFile('/working/tinygo-lowered-out.wasm')
                const loweredModuleBytes = typeof loweredArtifact === 'string' ? textEncoder.encode(loweredArtifact) : loweredArtifact
                const loweredModule =
                  (await WebAssembly.instantiate(
                    loweredModuleBytes as BufferSource,
                    {
                      wasi_snapshot_preview1: {
                        fd_read: () => 0,
                        fd_write: () => 0,
                      },
                      wasi_unstable: {
                        fd_read: () => 0,
                        fd_write: () => 0,
                      },
                    },
                  )) as WebAssembly.WebAssemblyInstantiatedSource
                const loweredVerification = verifyTinyGoLoweredArtifactExports(
                  loweredModule.instance,
                  frontendLoweredSourcesManifest,
                  loweredSourceFileContents,
                  frontendLoweredIRVerification ?? undefined,
                )
                appendLog(
                `frontend lowered probe verified units=${loweredVerification.units.length} kinds=${new Set(loweredVerification.units.map((unit) => unit.kindTag)).size} hashes=${new Set(loweredVerification.units.map((unit) => unit.sourceHash)).size} imports=${new Set(loweredVerification.units.map((unit) => unit.importCount)).size} importPaths=${new Set(loweredVerification.units.map((unit) => unit.importPathHash)).size} blankImports=${new Set(loweredVerification.units.map((unit) => unit.blankImportCount)).size} dotImports=${new Set(loweredVerification.units.map((unit) => unit.dotImportCount)).size} aliasedImports=${new Set(loweredVerification.units.map((unit) => unit.aliasedImportCount)).size} funcs=${new Set(loweredVerification.units.map((unit) => unit.functionCount)).size} funcNameHashes=${new Set(loweredVerification.units.map((unit) => unit.functionNameHash)).size} funcLiterals=${new Set(loweredVerification.units.map((unit) => unit.funcLiteralCount)).size} funcParameters=${new Set(loweredVerification.units.map((unit) => unit.funcParameterCount)).size} funcResults=${new Set(loweredVerification.units.map((unit) => unit.funcResultCount)).size} variadicParameters=${new Set(loweredVerification.units.map((unit) => unit.variadicParameterCount)).size} namedResults=${new Set(loweredVerification.units.map((unit) => unit.namedResultCount)).size} typeParameters=${new Set(loweredVerification.units.map((unit) => unit.typeParameterCount)).size} genericFunctions=${new Set(loweredVerification.units.map((unit) => unit.genericFunctionCount)).size} genericTypes=${new Set(loweredVerification.units.map((unit) => unit.genericTypeCount)).size} calls=${new Set(loweredVerification.units.map((unit) => unit.callExpressionCount)).size} builtinCalls=${new Set(loweredVerification.units.map((unit) => unit.builtinCallCount)).size} appendCalls=${new Set(loweredVerification.units.map((unit) => unit.appendCallCount)).size} lenCalls=${new Set(loweredVerification.units.map((unit) => unit.lenCallCount)).size} makeCalls=${new Set(loweredVerification.units.map((unit) => unit.makeCallCount)).size} capCalls=${new Set(loweredVerification.units.map((unit) => unit.capCallCount)).size} copyCalls=${new Set(loweredVerification.units.map((unit) => unit.copyCallCount)).size} panicCalls=${new Set(loweredVerification.units.map((unit) => unit.panicCallCount)).size} recoverCalls=${new Set(loweredVerification.units.map((unit) => unit.recoverCallCount)).size} newCalls=${new Set(loweredVerification.units.map((unit) => unit.newCallCount)).size} deleteCalls=${new Set(loweredVerification.units.map((unit) => unit.deleteCallCount)).size} compositeLiterals=${new Set(loweredVerification.units.map((unit) => unit.compositeLiteralCount)).size} selectorExpressions=${new Set(loweredVerification.units.map((unit) => unit.selectorExpressionCount)).size} selectorNameHashes=${new Set(loweredVerification.units.map((unit) => unit.selectorNameHash)).size} indexExpressions=${new Set(loweredVerification.units.map((unit) => unit.indexExpressionCount)).size} sliceExpressions=${new Set(loweredVerification.units.map((unit) => unit.sliceExpressionCount)).size} keyValueExpressions=${new Set(loweredVerification.units.map((unit) => unit.keyValueExpressionCount)).size} typeAssertions=${new Set(loweredVerification.units.map((unit) => unit.typeAssertionCount)).size} blankIdentifiers=${new Set(loweredVerification.units.map((unit) => unit.blankIdentifierCount)).size} blankAssignmentTargets=${new Set(loweredVerification.units.map((unit) => unit.blankAssignmentTargetCount)).size} unaryExpressions=${new Set(loweredVerification.units.map((unit) => unit.unaryExpressionCount)).size} binaryExpressions=${new Set(loweredVerification.units.map((unit) => unit.binaryExpressionCount)).size} sends=${new Set(loweredVerification.units.map((unit) => unit.sendStatementCount)).size} receives=${new Set(loweredVerification.units.map((unit) => unit.receiveExpressionCount)).size} assignments=${new Set(loweredVerification.units.map((unit) => unit.assignStatementCount)).size} defines=${new Set(loweredVerification.units.map((unit) => unit.defineStatementCount)).size} increments=${new Set(loweredVerification.units.map((unit) => unit.incStatementCount)).size} decrements=${new Set(loweredVerification.units.map((unit) => unit.decStatementCount)).size} returns=${new Set(loweredVerification.units.map((unit) => unit.returnStatementCount)).size} goStatements=${new Set(loweredVerification.units.map((unit) => unit.goStatementCount)).size} deferStatements=${new Set(loweredVerification.units.map((unit) => unit.deferStatementCount)).size} ifStatements=${new Set(loweredVerification.units.map((unit) => unit.ifStatementCount)).size} rangeStatements=${new Set(loweredVerification.units.map((unit) => unit.rangeStatementCount)).size} switchStatements=${new Set(loweredVerification.units.map((unit) => unit.switchStatementCount)).size} typeSwitchStatements=${new Set(loweredVerification.units.map((unit) => unit.typeSwitchStatementCount)).size} typeSwitchCases=${new Set(loweredVerification.units.map((unit) => unit.typeSwitchCaseClauseCount)).size} typeSwitchGuardNameHashes=${new Set(loweredVerification.units.map((unit) => unit.typeSwitchGuardNameHash)).size} typeSwitchCaseTypeHashes=${new Set(loweredVerification.units.map((unit) => unit.typeSwitchCaseTypeHash)).size} selectStatements=${new Set(loweredVerification.units.map((unit) => unit.selectStatementCount)).size} switchCases=${new Set(loweredVerification.units.map((unit) => unit.switchCaseClauseCount)).size} selectClauses=${new Set(loweredVerification.units.map((unit) => unit.selectCommClauseCount)).size} forStatements=${new Set(loweredVerification.units.map((unit) => unit.forStatementCount)).size} breakStatements=${new Set(loweredVerification.units.map((unit) => unit.breakStatementCount)).size} breakLabelNameHashes=${new Set(loweredVerification.units.map((unit) => unit.breakLabelNameHash)).size} continueStatements=${new Set(loweredVerification.units.map((unit) => unit.continueStatementCount)).size} continueLabelNameHashes=${new Set(loweredVerification.units.map((unit) => unit.continueLabelNameHash)).size} labels=${new Set(loweredVerification.units.map((unit) => unit.labeledStatementCount)).size} labelNameHashes=${new Set(loweredVerification.units.map((unit) => unit.labelNameHash)).size} gotos=${new Set(loweredVerification.units.map((unit) => unit.gotoStatementCount)).size} gotoLabelNameHashes=${new Set(loweredVerification.units.map((unit) => unit.gotoLabelNameHash)).size} fallthroughs=${new Set(loweredVerification.units.map((unit) => unit.fallthroughStatementCount)).size} methods=${new Set(loweredVerification.units.map((unit) => unit.methodCount)).size} methodNameHashes=${new Set(loweredVerification.units.map((unit) => unit.methodNameHash)).size} methodSignatureHashes=${new Set(loweredVerification.units.map((unit) => unit.methodSignatureHash)).size} exportedMethodNameHashes=${new Set(loweredVerification.units.map((unit) => unit.exportedMethodNameHash)).size} exportedMethodSignatureHashes=${new Set(loweredVerification.units.map((unit) => unit.exportedMethodSignatureHash)).size} exports=${new Set(loweredVerification.units.map((unit) => unit.exportedFunctionCount)).size} exportedFunctionNameHashes=${new Set(loweredVerification.units.map((unit) => unit.exportedFunctionNameHash)).size} types=${new Set(loweredVerification.units.map((unit) => unit.typeCount)).size} typeNameHashes=${new Set(loweredVerification.units.map((unit) => unit.typeNameHash)).size} exportedTypes=${new Set(loweredVerification.units.map((unit) => unit.exportedTypeCount)).size} exportedTypeNameHashes=${new Set(loweredVerification.units.map((unit) => unit.exportedTypeNameHash)).size} structs=${new Set(loweredVerification.units.map((unit) => unit.structTypeCount)).size} interfaces=${new Set(loweredVerification.units.map((unit) => unit.interfaceTypeCount)).size} mapTypes=${new Set(loweredVerification.units.map((unit) => unit.mapTypeCount)).size} chanTypes=${new Set(loweredVerification.units.map((unit) => unit.chanTypeCount)).size} sendOnlyChanTypes=${new Set(loweredVerification.units.map((unit) => unit.sendOnlyChanTypeCount)).size} receiveOnlyChanTypes=${new Set(loweredVerification.units.map((unit) => unit.receiveOnlyChanTypeCount)).size} arrayTypes=${new Set(loweredVerification.units.map((unit) => unit.arrayTypeCount)).size} sliceTypes=${new Set(loweredVerification.units.map((unit) => unit.sliceTypeCount)).size} pointerTypes=${new Set(loweredVerification.units.map((unit) => unit.pointerTypeCount)).size} structFields=${new Set(loweredVerification.units.map((unit) => unit.structFieldCount)).size} embeddedStructFields=${new Set(loweredVerification.units.map((unit) => unit.embeddedStructFieldCount)).size} taggedStructFields=${new Set(loweredVerification.units.map((unit) => unit.taggedStructFieldCount)).size} structFieldNameHashes=${new Set(loweredVerification.units.map((unit) => unit.structFieldNameHash)).size} structFieldTypeHashes=${new Set(loweredVerification.units.map((unit) => unit.structFieldTypeHash)).size} embeddedStructFieldTypeHashes=${new Set(loweredVerification.units.map((unit) => unit.embeddedStructFieldTypeHash)).size} taggedStructFieldTagHashes=${new Set(loweredVerification.units.map((unit) => unit.taggedStructFieldTagHash)).size} interfaceMethods=${new Set(loweredVerification.units.map((unit) => unit.interfaceMethodCount)).size} interfaceMethodNameHashes=${new Set(loweredVerification.units.map((unit) => unit.interfaceMethodNameHash)).size} interfaceMethodSignatureHashes=${new Set(loweredVerification.units.map((unit) => unit.interfaceMethodSignatureHash)).size} embeddedInterfaceMethods=${new Set(loweredVerification.units.map((unit) => unit.embeddedInterfaceMethodCount)).size} embeddedInterfaceMethodNameHashes=${new Set(loweredVerification.units.map((unit) => unit.embeddedInterfaceMethodNameHash)).size} consts=${new Set(loweredVerification.units.map((unit) => unit.constCount)).size} constNameHashes=${new Set(loweredVerification.units.map((unit) => unit.constNameHash)).size} vars=${new Set(loweredVerification.units.map((unit) => unit.varCount)).size} varNameHashes=${new Set(loweredVerification.units.map((unit) => unit.varNameHash)).size} exportedConsts=${new Set(loweredVerification.units.map((unit) => unit.exportedConstCount)).size} exportedConstNameHashes=${new Set(loweredVerification.units.map((unit) => unit.exportedConstNameHash)).size} exportedVars=${new Set(loweredVerification.units.map((unit) => unit.exportedVarCount)).size} exportedVarNameHashes=${new Set(loweredVerification.units.map((unit) => unit.exportedVarNameHash)).size} declarationCounts=${new Set(loweredVerification.units.map((unit) => unit.declarationCount)).size} declarationNameHashes=${new Set(loweredVerification.units.map((unit) => unit.declarationNameHash)).size} declarationSignatureHashes=${new Set(loweredVerification.units.map((unit) => unit.declarationSignatureHash)).size} declarationKindHashes=${new Set(loweredVerification.units.map((unit) => unit.declarationKindHash)).size} declarationExportedCounts=${new Set(loweredVerification.units.map((unit) => unit.declarationExportedCount)).size} declarationExportedNameHashes=${new Set(loweredVerification.units.map((unit) => unit.declarationExportedNameHash)).size} declarationExportedSignatureHashes=${new Set(loweredVerification.units.map((unit) => unit.declarationExportedSignatureHash)).size} declarationExportedKindHashes=${new Set(loweredVerification.units.map((unit) => unit.declarationExportedKindHash)).size} declarationMethodCounts=${new Set(loweredVerification.units.map((unit) => unit.declarationMethodCount)).size} declarationMethodNameHashes=${new Set(loweredVerification.units.map((unit) => unit.declarationMethodNameHash)).size} declarationMethodSignatureHashes=${new Set(loweredVerification.units.map((unit) => unit.declarationMethodSignatureHash)).size} declarationMethodKindHashes=${new Set(loweredVerification.units.map((unit) => unit.declarationMethodKindHash)).size} placeholderBlocks=${new Set(loweredVerification.units.map((unit) => unit.placeholderBlockCount)).size} placeholderBlockHashes=${new Set(loweredVerification.units.map((unit) => unit.placeholderBlockHash)).size} placeholderBlockSignatureHashes=${new Set(loweredVerification.units.map((unit) => unit.placeholderBlockSignatureHash)).size} placeholderBlockRuntimeHashes=${new Set(loweredVerification.units.map((unit) => unit.placeholderBlockRuntimeHash)).size} loweringBlocks=${new Set(loweredVerification.units.map((unit) => unit.loweringBlockCount)).size} loweringBlockHashes=${new Set(loweredVerification.units.map((unit) => unit.loweringBlockHash)).size} loweringBlockRuntimeHashes=${new Set(loweredVerification.units.map((unit) => unit.loweringBlockRuntimeHash)).size} mains=${new Set(loweredVerification.units.map((unit) => unit.mainCount)).size} inits=${new Set(loweredVerification.units.map((unit) => unit.initCount)).size}`,
                  'success',
                )
              }
              artifactProbeVerified = true
            } else if (bootstrapVerification) {
              setPhase('verify', 'failed', 'error')
              appendLog(
                `bootstrap verification failed: ${bootstrapVerification.reason} entry=${parsedBootstrapManifest.entryFile ?? 'unknown'} all=${bootstrapAllFileCount ?? 'unknown'}`,
                'error',
              )
            }
          } else if (bootstrapVerification) {
            setPhase('verify', 'failed', 'error')
            appendLog(
              `bootstrap verification failed: ${bootstrapVerification.reason}`,
              'error',
            )
          }
          }
        }
      } catch (error) {
        setPhase('verify', 'failed', 'error')
        appendLog(`artifact probe failed: ${error instanceof Error ? error.message : String(error)}`, 'error')
      }
      if (artifactProbeVerified) {
        setPhase('verify', 'verified', 'success')
      }
      let executionArtifactPath: string | null = null
      let executionArtifactBytes: Uint8Array | null = null
      let executionArtifactEntrypoint: '_start' | '_initialize' | 'main' | null = null
      let executionArtifactKind: 'probe' | 'bootstrap' | 'execution' = lastBuildArtifactKind
      let executionArtifactReason: 'bootstrap-artifact' | 'missing-wasi-entrypoint' | undefined = lastBuildArtifactReason
      if (artifactProbeVerified && lastBuildArtifactRunnable) {
        executionArtifactPath = artifactPath
        executionArtifactBytes = new Uint8Array(artifactBytes)
        executionArtifactEntrypoint = lastBuildArtifactEntrypoint
      }
      const canUseWasip1ExecutionFallback =
        requestedBuildTarget === 'wasm' || requestedBuildTarget === 'wasip1'
      const pureBrowserFallbackFailure = describePureBrowserFallbackFailure(
        requestedBuildTarget,
        frontendLoweredIRVerification,
      )
      if (
        artifactProbeVerified &&
        options.hostCompileUrl &&
        executionArtifactBytes === null &&
        canUseWasip1ExecutionFallback
      ) {
        const hostCompileResponse = await fetch(options.hostCompileUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            entryFileName: 'main.go',
            files: workspaceFiles ?? { 'main.go': bootstrapGoEntrySource },
            optimize: buildRequestOverrides?.optimize ?? 'z',
            panic: buildRequestOverrides?.panic ?? 'trap',
            scheduler: buildRequestOverrides?.scheduler ?? 'tasks',
            target: 'wasip1',
          }),
        })
        if (hostCompileResponse.ok) {
          const payload = (await hostCompileResponse.json()) as TinyGoHostCompileResponse
          const artifactBase64 = payload.artifact?.bytesBase64 ?? ''
          const hostArtifactPath = payload.artifact?.path ?? ''
          if (artifactBase64 === '' || hostArtifactPath === '') {
            throw new Error('TinyGo host compile did not return a wasm artifact')
          }
          const hostArtifactBytes = Uint8Array.from(atob(artifactBase64), (char) => char.charCodeAt(0))
          const hostArtifactExportNames = WebAssembly.Module.exports(
            new WebAssembly.Module(hostArtifactBytes),
          ).map((entry) => entry.name)
          const hostArtifactEntrypoint = payload.artifact?.entrypoint ?? (
            hostArtifactExportNames.includes('_start')
              ? '_start'
              : hostArtifactExportNames.includes('main') && hostArtifactExportNames.includes('_initialize')
                ? '_initialize'
                : hostArtifactExportNames.includes('main')
                  ? 'main'
                  : null
          )
          if (hostArtifactEntrypoint === null) {
            throw new Error('TinyGo host compile returned a wasm artifact without a supported entrypoint')
          }
          for (const line of payload.logs ?? []) {
            appendLog(line, 'success')
          }
          executionArtifactPath = hostArtifactPath
          executionArtifactBytes = new Uint8Array(hostArtifactBytes)
          executionArtifactEntrypoint = hostArtifactEntrypoint
          executionArtifactKind = payload.artifact?.artifactKind ?? 'execution'
          executionArtifactReason = payload.artifact?.reason
        }
        else if (
          hostCompileResponse.status !== 404 &&
          hostCompileResponse.status !== 405 &&
          hostCompileResponse.status !== 501
        ) {
          let hostCompileFailure = 'TinyGo host compile failed'
          const responseText = await hostCompileResponse.text()
          if (responseText.trim() !== '') {
            try {
              const payload = JSON.parse(responseText) as TinyGoHostCompileResponse
              if (typeof payload.error === 'string' && payload.error !== '') {
                hostCompileFailure = payload.error
              } else {
                hostCompileFailure = responseText.trim()
              }
            } catch {
              hostCompileFailure = responseText.trim()
            }
          }
          throw new Error(hostCompileFailure)
        } else if (frontendCommandArtifactVerification?.runnable === false) {
          appendLog(
            `build artifact execution blocked: backend emitted a probe-only final artifact at ${frontendCommandArtifactVerification.artifactOutputPath}`,
            'error',
          )
          appendLog(
            pureBrowserFallbackFailure
              ? 'host compile seam unavailable; browser-side fallback cannot recover the current program or target'
              : 'host compile seam unavailable; attempting browser-side relink to produce a runnable execution artifact',
            'error',
          )
        }
      } else if (
        artifactProbeVerified &&
        options.hostCompileUrl &&
        executionArtifactBytes === null &&
        !canUseWasip1ExecutionFallback
      ) {
        appendLog(
          `host compile seam skipped: ${requestedBuildTarget} cannot be replaced with a wasip1 execution artifact`,
          'error',
        )
      }
      if (
        artifactProbeVerified &&
        executionArtifactBytes === null &&
        !lastBuildArtifactRunnable &&
        pureBrowserFallbackFailure
      ) {
        appendLog(pureBrowserFallbackFailure.logLine, 'error')
        throw new Error(pureBrowserFallbackFailure.errorLine)
      }
      if (
        artifactProbeVerified &&
        frontendCompileUnitVerification &&
        frontendCommandArtifactVerification &&
        executionArtifactBytes === null &&
        !lastBuildArtifactRunnable &&
        canUseWasip1ExecutionFallback
      ) {
        const relinkedExecutionArtifactPath = artifactPath.endsWith('.wasm')
          ? `${artifactPath.slice(0, -'.wasm'.length)}.exec.wasm`
          : `${artifactPath}.exec.wasm`
        const executionLinkCommand = [
          `/usr/bin/${frontendCompileUnitVerification.toolchain.linker}`,
          ...frontendCompileUnitVerification.toolchain.ldflags,
          ...frontendCommandArtifactVerification.bitcodeFiles,
          '-o',
          relinkedExecutionArtifactPath,
        ]
        appendLog(`$ ${executionLinkCommand.join(' ')}`, 'running')
        const executionLinkResult = await runtime._run_process_impl(executionLinkCommand, { cwd: '/working' })
        if (executionLinkResult.returncode !== 0) {
          if (executionLinkResult.stdout.trim() !== '') {
            appendLog(executionLinkResult.stdout.trim(), 'error')
          }
          if (executionLinkResult.stderr.trim() !== '') {
            appendLog(executionLinkResult.stderr.trim(), 'error')
          }
          throw new Error(`execution artifact link failed with exit code ${executionLinkResult.returncode}`)
        }
        const relinkedExecutionArtifact = await fileSystem.readFile(relinkedExecutionArtifactPath)
        const relinkedExecutionArtifactBytes = typeof relinkedExecutionArtifact === 'string' ? textEncoder.encode(relinkedExecutionArtifact) : relinkedExecutionArtifact
        const executionArtifactExportNames = WebAssembly.Module.exports(
          new WebAssembly.Module(new Uint8Array(relinkedExecutionArtifactBytes)),
        ).map((entry) => entry.name)
        const relinkedExecutionArtifactEntrypoint = executionArtifactExportNames.includes('_start')
          ? '_start'
          : executionArtifactExportNames.includes('main') && executionArtifactExportNames.includes('_initialize')
            ? '_initialize'
            : executionArtifactExportNames.includes('main')
              ? 'main'
              : null
        if (relinkedExecutionArtifactEntrypoint === null) {
          throw new Error('execution artifact did not expose a supported WASI entrypoint')
        }
        executionArtifactPath = relinkedExecutionArtifactPath
        executionArtifactBytes = new Uint8Array(relinkedExecutionArtifactBytes)
        executionArtifactEntrypoint = relinkedExecutionArtifactEntrypoint
        executionArtifactKind = 'execution'
        executionArtifactReason = undefined
      }
      if (
        artifactProbeVerified &&
        executionArtifactPath !== null &&
        executionArtifactBytes !== null &&
        executionArtifactEntrypoint !== null
      ) {
        lastBuildArtifactPath = executionArtifactPath
        lastBuildArtifactBytes = new Uint8Array(executionArtifactBytes)
        lastBuildArtifactKind = executionArtifactKind
        lastBuildArtifactEntrypoint = executionArtifactEntrypoint
        lastBuildArtifactRunnable = true
        lastBuildArtifactReason = executionArtifactReason
        setPhase('smoke', `${executionArtifactBytes.byteLength.toLocaleString()} bytes`, 'success')
        appendLog(
          `execution artifact ready: ${executionArtifactPath} (${executionArtifactBytes.byteLength.toLocaleString()} bytes)`,
          'success',
        )
        appendLog(`execution artifact entrypoint=${executionArtifactEntrypoint}`, 'success')
        const executionStdout = ConsoleStdout.lineBuffered((line) => appendLog(line, 'success'))
        const executionStderr = ConsoleStdout.lineBuffered((line) => appendLog(line, 'error'))
        const executionWasi = new WASI(
          ['tinygo-browser-execution'],
          [],
          [new OpenFile(new File([])), executionStdout, executionStderr],
        )
        const { instance: executionInstance } = await WebAssembly.instantiate(executionArtifactBytes as BufferSource, {
          wasi_snapshot_preview1: executionWasi.wasiImport,
          wasi_unstable: executionWasi.wasiImport,
        })
        const executionExports = executionInstance.exports as Record<string, unknown>
        let executionExitCode = 0
        try {
          if (executionArtifactEntrypoint === '_start') {
            executionExitCode = executionWasi.start(
              executionInstance as { exports: { memory: WebAssembly.Memory; _start: () => unknown } },
            )
          } else {
            executionWasi.initialize(
              executionInstance as { exports: { memory: WebAssembly.Memory; _initialize?: () => unknown } },
            )
            if (typeof executionExports._initialize !== 'function' && typeof executionExports.__wasm_call_ctors === 'function') {
              ;(executionExports.__wasm_call_ctors as () => unknown)()
            }
            const mainResult =
              typeof executionExports.main === 'function'
                ? (executionExports.main as () => unknown)()
                : 0
            executionExitCode = typeof mainResult === 'number' ? mainResult : 0
          }
        } catch (error) {
          if (error instanceof WASIProcExit) {
            executionExitCode = error.code
          } else {
            throw error
          }
        }
        if (executionExitCode !== 0) {
          throw new Error(`execution artifact exited with code ${executionExitCode}`)
        }
        appendLog(`execution artifact completed exitCode=${executionExitCode}`, 'success')
      }
    } catch (error) {
      setPhase('smoke', 'failed', 'error')
      setPhase('verify', 'failed', 'error')
      appendLog(`build execution failed: ${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      runtimeWorkingTreeDirty = true
      setControlsLocked(false)
    }
  }

  const runtime: TinyGoRuntime = {
    boot: async () => {
      if (emception) {
        return
      }
      await runWithAction('booting', async () => {
        await ensureEmception()
      })
    },
    plan: async () =>
      runWithAction('planning', async () => {
        try {
          setControlsLocked(true)
          return cloneJsonValue(await planBuild())
        } finally {
          setControlsLocked(false)
        }
      }),
    execute: async () => {
      await runWithAction('executing', async () => {
        await executeBuildPlan()
      })
    },
    runUpstreamProbe: async () =>
      await runWithAction('upstream-probe', async () => {
        appendLog('running patched upstream TinyGo WASI probe', 'running')
        const result = await runUpstreamProbe()
        appendLog(
          `patched upstream TinyGo WASI probe verified target=${result.requestedTarget} triple=${result.triple} scheduler=${result.scheduler}`,
          'success',
        )
        return result
      }),
    runUpstreamFrontendProbe: async () =>
      await runWithAction('upstream-frontend-probe', async () => {
        appendLog('running patched upstream TinyGo WASI frontend probe', 'running')
        const result = await runUpstreamFrontendProbe()
        appendLog(
          `patched upstream TinyGo WASI frontend probe verified main=${result.mainImportPath} files=${result.fileCount}`,
          'success',
        )
        return result
      }),
    reset: () => {
      ensureActionIdle()
      disposeEmceptionRuntime()
      invalidateCachedBuildState()
      injectedBuildRequestOverrides = null
      injectedDriverBridgeManifest = null
      injectedWorkspaceFiles = null
      clearActivityLog()
      resetPhasesToIdle()
      appendLog('log cleared', 'idle')
    },
    dispose: () => {
      disposeEmceptionRuntime()
      invalidateCachedBuildState()
      injectedBuildRequestOverrides = null
      injectedDriverBridgeManifest = null
      injectedWorkspaceFiles = null
      clearActivityLog()
      resetPhasesToIdle()
    },
    readActivityLog: () => activityLog,
    readBuildArtifact: () => {
      if (lastBuildArtifactPath === null || lastBuildArtifactBytes === null) {
        return null
      }
      return {
        path: lastBuildArtifactPath,
        bytes: new Uint8Array(lastBuildArtifactBytes),
        artifactKind: lastBuildArtifactKind,
        runnable: lastBuildArtifactRunnable,
        entrypoint: lastBuildArtifactEntrypoint,
        reason: lastBuildArtifactReason,
      }
    },
    readFrontendAnalysisInputManifest: () => {
      if (lastFrontendAnalysisInputManifest === null) {
        return null
      }
      return cloneJsonValue(lastFrontendAnalysisInputManifest) as TinyGoFrontendInputManifest
    },
    setBuildRequestOverrides: (overrides) => {
      ensureActionIdle()
      invalidateCachedBuildState()
      injectedBuildRequestOverrides = overrides === null ? null : cloneJsonValue(overrides)
      setPhase('probe', 'idle', 'idle')
      setPhase('smoke', 'idle', 'idle')
      setPhase('verify', 'idle', 'idle')
    },
    setDriverBridgeManifest: (manifest) => {
      ensureActionIdle()
      invalidateCachedBuildState()
      injectedDriverBridgeManifest = manifest === null ? null : cloneJsonValue(manifest)
      setPhase('probe', 'idle', 'idle')
      setPhase('smoke', 'idle', 'idle')
      setPhase('verify', 'idle', 'idle')
    },
    setWorkspaceFiles: (files) => {
      ensureActionIdle()
      invalidateCachedBuildState()
      injectedWorkspaceFiles = files === null ? null : cloneJsonValue(files)
      setPhase('probe', 'idle', 'idle')
      setPhase('smoke', 'idle', 'idle')
      setPhase('verify', 'idle', 'idle')
    },
  }

  for (const entry of options.initialLogMessages ?? []) {
    appendLog(entry.message, entry.tone ?? 'idle')
  }

  return runtime
}

export const createTinyGoBrowserRuntime = (options: TinyGoBrowserRuntimeOptions): TinyGoBrowserRuntime => {
  let lastTone: Exclude<PhaseTone, 'idle'> | 'idle' = 'idle'
  let activityLog = ''

  const runtime = createTinyGoRuntime({
    assetBaseUrl: options.baseUrl,
    assetLoader: options.assetLoader,
    assetPacks: options.assetPacks,
    rustRuntimeBaseUrl: options.rustRuntimeBaseUrl,
    rustRuntimeAssetPacks: options.rustRuntimeAssetPacks,
    bootstrapGoEntrySource: options.bootstrapGoEntrySource,
    hostCompileUrl: options.hostCompileUrl,
    initialLogMessages: (options.initialLogs ?? []).map((message) => ({ message })),
    onControlsLockedChange: options.onControlsLockedChange,
    onPhaseChange: options.onPhaseChange,
    now: options.now,
    onLogReset: () => {
      activityLog = ''
      lastTone = 'idle'
      options.onActivityLogChange?.('', 'idle')
    },
    onLogAppended: (entry) => {
      activityLog += entry.line
      lastTone = entry.tone
      options.onActivityLogChange?.(activityLog, lastTone)
    },
  })

  return runtime
}
