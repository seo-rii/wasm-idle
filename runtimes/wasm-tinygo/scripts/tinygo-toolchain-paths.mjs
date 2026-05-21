import path from 'node:path'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const archiveTypeFromName = (value) => {
  if (!value) {
    return null
  }
  if (value.endsWith('.tar.gz') || value.endsWith('.tgz')) {
    return 'tar.gz'
  }
  if (value.endsWith('.zip')) {
    return 'zip'
  }
  if (value.endsWith('.deb')) {
    return 'deb'
  }
  return null
}

const releaseFileNameFromUrl = (value) => {
  if (!value) {
    return null
  }
  try {
    return path.basename(new URL(value).pathname)
  } catch {
    return path.basename(value)
  }
}

const defaultArchiveTypeByPlatform = {
  darwin: 'tar.gz',
  linux: 'tar.gz',
  win32: 'zip',
}

const defaultArchitecturesByArchiveType = {
  deb: {
    arm: 'armhf',
    arm64: 'arm64',
    x64: 'amd64',
  },
  'tar.gz': {
    arm: 'arm',
    arm64: 'arm64',
    x64: 'amd64',
  },
  zip: {
    x64: 'amd64',
  },
}

const buildDefaultArchiveFileName = ({ archiveType, arch, platform, version }) => {
  if (archiveType === 'deb') {
    return `tinygo_${version}_${arch}.deb`
  }
  if (archiveType === 'tar.gz') {
    if (platform === 'darwin') {
      return `tinygo${version}.darwin-${arch}.tar.gz`
    }
    if (platform === 'linux') {
      return `tinygo${version}.linux-${arch}.tar.gz`
    }
  }
  if (archiveType === 'zip' && platform === 'win32') {
    return `tinygo${version}.windows-${arch}.zip`
  }
  throw new Error(`unsupported TinyGo release archive for platform=${platform} archiveType=${archiveType} arch=${arch}`)
}

const buildDefaultLayout = ({ archiveType, extractDir, platform }) => {
  if (archiveType === 'deb') {
    return {
      binPath: path.join(extractDir, 'usr', 'local', 'bin', 'tinygo'),
      rootPath: path.join(extractDir, 'usr', 'local', 'lib', 'tinygo'),
    }
  }
  if (archiveType === 'tar.gz' || archiveType === 'zip') {
    return {
      binPath: path.join(extractDir, 'tinygo', 'bin', platform === 'win32' ? 'tinygo.exe' : 'tinygo'),
      rootPath: path.join(extractDir, 'tinygo'),
    }
  }
  throw new Error(`unsupported TinyGo archive type: ${archiveType}`)
}

export const resolveTinyGoToolchainPaths = () => {
  const platform = process.env.WASM_TINYGO_TINYGO_PLATFORM ?? process.platform
  const version = process.env.WASM_TINYGO_TINYGO_VERSION ?? '0.40.1'
  const releaseUrlOverride = process.env.WASM_TINYGO_TINYGO_RELEASE_URL ?? null
  const archivePathOverride = process.env.WASM_TINYGO_TINYGO_ARCHIVE_PATH ?? null
  const archiveType =
    process.env.WASM_TINYGO_TINYGO_ARCHIVE_TYPE ??
    archiveTypeFromName(archivePathOverride) ??
    archiveTypeFromName(releaseFileNameFromUrl(releaseUrlOverride)) ??
    defaultArchiveTypeByPlatform[platform]
  if (!archiveType) {
    throw new Error(`unsupported TinyGo release platform=${platform}`)
  }
  const defaultArchitectures = defaultArchitecturesByArchiveType[archiveType]
  const arch = process.env.WASM_TINYGO_TINYGO_ARCH ?? defaultArchitectures?.[process.arch]
  if (!arch) {
    throw new Error(`unsupported TinyGo release architecture for platform=${platform} archiveType=${archiveType} process.arch=${process.arch}`)
  }
  const cacheDir = process.env.WASM_TINYGO_TINYGO_CACHE_DIR ?? path.join(rootDir, '.cache', 'tinygo-toolchain')
  const archiveFileName =
    releaseFileNameFromUrl(archivePathOverride) ??
    releaseFileNameFromUrl(releaseUrlOverride) ??
    buildDefaultArchiveFileName({ archiveType, arch, platform, version })
  const archivePath = archivePathOverride ?? path.join(cacheDir, archiveFileName)
  const extractDir = process.env.WASM_TINYGO_TINYGO_EXTRACT_DIR ?? path.join(cacheDir, 'extract')
  const defaultLayout = buildDefaultLayout({ archiveType, extractDir, platform })
  const binPath = process.env.WASM_TINYGO_TINYGO_BIN ?? defaultLayout.binPath
  const rootPath = process.env.WASM_TINYGO_TINYGOROOT ?? defaultLayout.rootPath
  const manifestPath = path.join(cacheDir, 'toolchain.json')
  const releaseUrl = releaseUrlOverride ?? `https://github.com/tinygo-org/tinygo/releases/download/v${version}/${archiveFileName}`

  return {
    archiveType,
    archiveFileName,
    archivePath,
    arch,
    binPath,
    cacheDir,
    extractDir,
    manifestPath,
    platform,
    releaseUrl,
    rootDir,
    rootPath,
    version,
  }
}

export const toolchainIsReady = async (paths) => {
  for (const filePath of [
    paths.binPath,
    path.join(paths.rootPath, 'src', 'runtime', 'internal', 'sys', 'zversion.go'),
    path.join(paths.rootPath, 'src', 'device', 'arm', 'arm.go'),
  ]) {
    try {
      await access(filePath, constants.F_OK)
    } catch {
      return false
    }
  }
  return true
}
