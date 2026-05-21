import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { ConsoleStdout, File, OpenFile, WASI, WASIProcExit } from '@bjorn3/browser_wasi_shim'

import { ensureTinyGoToolchainReady } from './fetch-tinygo-toolchain.mjs'

const detectEntrypoint = (wasmBytes) => {
  const exportNames = WebAssembly.Module.exports(new WebAssembly.Module(wasmBytes)).map((entry) => entry.name)
  if (exportNames.includes('_start')) {
    return '_start'
  }
  if (exportNames.includes('_initialize')) {
    return '_initialize'
  }
  return null
}

const resolveTargetInfo = ({ stdout }) => {
  const targetInfo = {
    buildTags: [],
    gc: '',
    goarch: '',
    goos: '',
    llvmTriple: '',
    scheduler: '',
  }
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }
    if (trimmed.startsWith('LLVM triple:')) {
      targetInfo.llvmTriple = trimmed.slice('LLVM triple:'.length).trim()
      continue
    }
    if (trimmed.startsWith('GOOS:')) {
      targetInfo.goos = trimmed.slice('GOOS:'.length).trim()
      continue
    }
    if (trimmed.startsWith('GOARCH:')) {
      targetInfo.goarch = trimmed.slice('GOARCH:'.length).trim()
      continue
    }
    if (trimmed.startsWith('build tags:')) {
      targetInfo.buildTags = trimmed.slice('build tags:'.length).trim().split(/\s+/).filter(Boolean)
      continue
    }
    if (trimmed.startsWith('garbage collector:')) {
      targetInfo.gc = trimmed.slice('garbage collector:'.length).trim()
      continue
    }
    if (trimmed.startsWith('scheduler:')) {
      targetInfo.scheduler = trimmed.slice('scheduler:'.length).trim()
    }
  }
  return targetInfo
}

const spawnTinyGo = ({ argv, commandCwd, goCachePath, paths }) => {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: commandCwd,
    env: {
      ...process.env,
      GOCACHE: goCachePath,
      PATH: `${path.dirname(paths.binPath)}${path.delimiter}${process.env.PATH ?? ''}`,
      TINYGOROOT: paths.rootPath,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    throw new Error([result.stdout, result.stderr].join('').trim() || `tinygo command failed: ${argv.join(' ')}`)
  }
  return result
}

const writeWorkspaceFiles = async ({ files, workDir }) => {
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length === 0) {
    throw new Error('TinyGo host compile requires at least one workspace file')
  }
  for (const [relativePath, contents] of Object.entries(files)) {
    if (typeof relativePath !== 'string' || relativePath.trim() === '' || relativePath.startsWith('/')) {
      throw new Error('TinyGo host compile requires relative workspace file paths')
    }
    if (typeof contents !== 'string') {
      throw new Error(`TinyGo host compile requires string file contents for ${relativePath}`)
    }
    const absolutePath = path.join(workDir, relativePath)
    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, contents)
  }
}

export const compileTinyGoHostWorkspace = async ({
  files,
  entryFileName = 'main.go',
  optimize = 'z',
  outputPath = '',
  panic = 'trap',
  scheduler = 'none',
  target = 'wasip1',
  workDir = '',
}) => {
  const paths = await ensureTinyGoToolchainReady()
  const resolvedWorkDir = workDir || await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-host-compile-'))
  const entryPath = path.join(resolvedWorkDir, entryFileName)
  const resolvedOutputPath = outputPath || path.join(resolvedWorkDir, 'main.wasm')
  const goCachePath = process.env.GOCACHE ?? path.join(paths.rootDir, '.cache', 'tinygo-go-build')

  await mkdir(resolvedWorkDir, { recursive: true })
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true })
  await mkdir(goCachePath, { recursive: true })
  await writeWorkspaceFiles({ files, workDir: resolvedWorkDir })
  const commandCwd = await findGoModuleRoot(entryPath)

  const buildCommand = [paths.binPath, 'build', '-target', target]
  if (optimize) {
    buildCommand.push('-opt', optimize)
  }
  if (scheduler) {
    buildCommand.push('-scheduler', scheduler)
  }
  if (panic) {
    buildCommand.push('-panic', panic)
  }
  buildCommand.push('-o', resolvedOutputPath, entryPath)
  spawnTinyGo({
    argv: buildCommand,
    commandCwd,
    goCachePath,
    paths,
  })

  const infoCommand = [paths.binPath, 'info', '-target', target]
  if (scheduler) {
    infoCommand.push('-scheduler', scheduler)
  }
  const tinyGoInfo = spawnTinyGo({
    argv: infoCommand,
    commandCwd,
    goCachePath,
    paths,
  })
  const artifactBytes = await readFile(resolvedOutputPath)
  const artifactStats = await stat(resolvedOutputPath)

  return {
    artifact: {
      bytes: artifactBytes,
      entrypoint: detectEntrypoint(artifactBytes),
      path: resolvedOutputPath,
      size: artifactStats.size,
    },
    command: buildCommand,
    entryPath,
    target,
    targetInfo: resolveTargetInfo(tinyGoInfo),
    toolchain: {
      binPath: paths.binPath,
      rootPath: paths.rootPath,
      version: paths.version,
    },
    workDir: resolvedWorkDir,
  }
}

export const compileTinyGoHostSource = async ({
  source,
  entryFileName = 'main.go',
  optimize = 'z',
  outputPath = '',
  panic = 'trap',
  scheduler = 'none',
  target = 'wasip1',
  workDir = '',
}) => {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new Error('TinyGo host compile requires a non-empty source string')
  }

  return await compileTinyGoHostWorkspace({
    files: {
      [entryFileName]: source,
    },
    entryFileName,
    optimize,
    outputPath,
    panic,
    scheduler,
    target,
    workDir,
  })
}

export const findGoModuleRoot = async (entryPath) => {
  let commandCwd = path.dirname(entryPath)
  let searchDir = commandCwd
  for (;;) {
    try {
      await access(path.join(searchDir, 'go.mod'))
      commandCwd = searchDir
      break
    } catch {
      const parentDir = path.dirname(searchDir)
      if (parentDir === searchDir) {
        break
      }
      searchDir = parentDir
    }
  }
  return commandCwd
}

export const buildTinyGoHostProbe = async ({
  expectedRuntimeLogs = null,
  outputPath = '',
  request = null,
  skipRuntime = false,
  workDir = '',
}) => {
  const paths = await ensureTinyGoToolchainReady()
  const resolvedWorkDir = workDir || await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-host-probe-'))
  const target = request?.target ?? 'wasip1'
  const mainPath = request?.entry ?? path.join(resolvedWorkDir, 'main.go')
  const resolvedOutputPath = outputPath || request?.output || path.join(resolvedWorkDir, 'main.wasm')
  const goCachePath = process.env.GOCACHE ?? path.join(paths.rootDir, '.cache', 'tinygo-go-build')
  let commandCwd = resolvedWorkDir

  await mkdir(resolvedWorkDir, { recursive: true })
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true })
  await mkdir(goCachePath, { recursive: true })
  if (!request) {
    await writeFile(mainPath, `package main

import "fmt"

func main() {
\tfmt.Println("tinygo-ok")
}
`)
  } else if (request.entry) {
    commandCwd = await findGoModuleRoot(request.entry)
  }

  const command = [paths.binPath, 'build', '-target', target]
  if (request?.optimize) {
    command.push('-opt', request.optimize)
  }
  if (request?.scheduler) {
    command.push('-scheduler', request.scheduler)
  }
  if (request?.panic) {
    command.push('-panic', request.panic)
  }
  command.push('-o', resolvedOutputPath, mainPath)
  spawnTinyGo({
    argv: command,
    commandCwd,
    goCachePath,
    paths,
  })

  const artifactStats = await stat(resolvedOutputPath)
  const infoCommand = [paths.binPath, 'info', '-target', target]
  if (request?.scheduler) {
    infoCommand.push('-scheduler', request.scheduler)
  }
  const targetInfo = resolveTargetInfo(spawnTinyGo({
    argv: infoCommand,
    commandCwd,
    goCachePath,
    paths,
  }))
  const runtime = {
    executed: false,
    exitCode: null,
    logs: [],
  }

  if (!skipRuntime && target === 'wasip1') {
    const logs = []
    const wasi = new WASI(['tinygo-host-probe'], [], [
      new OpenFile(new File([])),
      ConsoleStdout.lineBuffered((line) => logs.push(`stdout ${line}`)),
      ConsoleStdout.lineBuffered((line) => logs.push(`stderr ${line}`)),
    ])
    const wasmBytes = await readFile(resolvedOutputPath)
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

    if (exitCode !== 0) {
      throw new Error(`TinyGo host probe exited with code ${exitCode}`)
    }
    if (expectedRuntimeLogs && JSON.stringify(logs) !== JSON.stringify(expectedRuntimeLogs)) {
      throw new Error(`TinyGo host probe runtime logs did not match expectation: ${JSON.stringify(logs)}`)
    }
    runtime.executed = true
    runtime.exitCode = exitCode
    runtime.logs = logs
  } else if (!skipRuntime) {
    runtime.reason = 'runtime execution is only supported for wasip1 host probes'
  }

  return {
    artifact: {
      path: resolvedOutputPath,
      size: artifactStats.size,
    },
    command,
    runtime,
    target,
    targetInfo,
    toolchain: {
      binPath: paths.binPath,
      rootPath: paths.rootPath,
      version: paths.version,
    },
    workDir: resolvedWorkDir,
  }
}
