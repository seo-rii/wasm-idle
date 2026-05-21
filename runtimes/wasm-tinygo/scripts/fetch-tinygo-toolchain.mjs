import { spawnSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'

import { resolveTinyGoToolchainPaths, toolchainIsReady } from './tinygo-toolchain-paths.mjs'

const runArchiveExtractor = ({ command, args, description, env }) => {
  const extract = spawnSync(command, args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (extract.error) {
    throw new Error(`TinyGo archive extraction failed: ${description} is not available (${extract.error.message})`)
  }
  if (extract.status !== 0) {
    const details = [extract.stdout, extract.stderr].join('').trim()
    throw new Error(
      details === ''
        ? `TinyGo archive extraction failed with ${description} (exit ${extract.status ?? 1})`
        : `TinyGo archive extraction failed with ${description}: ${details}`,
    )
  }
}

const extractArchive = async (paths) => {
  await rm(paths.extractDir, { recursive: true, force: true })
  await mkdir(paths.extractDir, { recursive: true })

  if (paths.archiveType === 'deb') {
    runArchiveExtractor({
      command: process.env.WASM_TINYGO_DPKG_DEB_BIN ?? 'dpkg-deb',
      args: ['-x', paths.archivePath, paths.extractDir],
      description: 'dpkg-deb',
    })
    return
  }
  if (paths.archiveType === 'tar.gz') {
    runArchiveExtractor({
      command: process.env.WASM_TINYGO_TAR_BIN ?? 'tar',
      args: ['-xzf', paths.archivePath, '-C', paths.extractDir],
      description: 'tar',
    })
    return
  }
  if (paths.archiveType === 'zip') {
    if (paths.platform === 'win32') {
      runArchiveExtractor({
        command: process.env.WASM_TINYGO_POWERSHELL_BIN ?? 'powershell.exe',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Expand-Archive -LiteralPath $env:WASM_TINYGO_ARCHIVE_PATH -DestinationPath $env:WASM_TINYGO_EXTRACT_DIR -Force',
        ],
        description: 'PowerShell Expand-Archive',
        env: {
          WASM_TINYGO_ARCHIVE_PATH: paths.archivePath,
          WASM_TINYGO_EXTRACT_DIR: paths.extractDir,
        },
      })
      return
    }
    runArchiveExtractor({
      command: process.env.WASM_TINYGO_UNZIP_BIN ?? 'unzip',
      args: ['-q', paths.archivePath, '-d', paths.extractDir],
      description: 'unzip',
    })
    return
  }

  throw new Error(`unsupported TinyGo archive type: ${paths.archiveType}`)
}

export const ensureTinyGoToolchainReady = async () => {
  const paths = resolveTinyGoToolchainPaths()

  await mkdir(paths.cacheDir, { recursive: true })

  if (!(await toolchainIsReady(paths))) {
    const archiveTempPath = `${paths.archivePath}.download`
    if (!process.env.WASM_TINYGO_TINYGO_ARCHIVE_PATH) {
      const response = await fetch(paths.releaseUrl)
      if (!response.ok || !response.body) {
        throw new Error(`TinyGo release fetch failed: ${response.status} ${response.statusText}`)
      }
      await rm(archiveTempPath, { force: true })
      await pipeline(Readable.fromWeb(response.body), createWriteStream(archiveTempPath))
      await rename(archiveTempPath, paths.archivePath)
    }

    await extractArchive(paths)
  }

  if (!(await toolchainIsReady(paths))) {
    throw new Error(`TinyGo toolchain is incomplete under ${paths.extractDir}`)
  }

  await writeFile(paths.manifestPath, `${JSON.stringify({
    archiveType: paths.archiveType,
    archivePath: paths.archivePath,
    binPath: paths.binPath,
    releaseUrl: paths.releaseUrl,
    rootPath: paths.rootPath,
    version: paths.version,
  }, null, 2)}
`)

  return paths
}

const run = async () => {
  const paths = await ensureTinyGoToolchainReady()
  console.log(`Prepared TinyGo ${paths.version}`)
  console.log(`tinygo binary: ${paths.binPath}`)
  console.log(`TINYGOROOT: ${paths.rootPath}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await run()
}
