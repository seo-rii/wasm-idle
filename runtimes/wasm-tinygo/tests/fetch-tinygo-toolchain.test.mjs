import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { resolveTinyGoToolchainPaths } from '../scripts/tinygo-toolchain-paths.mjs'

const withEnv = (overrides, fn) => {
  const previous = new Map()
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key])
    if (value == null) {
      delete process.env[key]
      continue
    }
    process.env[key] = value
  }
  try {
    return fn()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key]
        continue
      }
      process.env[key] = value
    }
  }
}

test('fetch-tinygo-toolchain downloads and extracts a repo-local TinyGo release', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-fetch-toolchain-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeBinDir = path.join(tempDir, 'bin')
  await mkdir(fakeBinDir, { recursive: true })
  const fakeTarPath = path.join(fakeBinDir, 'tar')
  await writeFile(fakeTarPath, `#!/bin/sh
set -eu
if [ "$1" != "-xzf" ]; then
  echo "unexpected args: $*" >&2
  exit 1
fi
archive="$2"
if [ "$3" != "-C" ]; then
  echo "unexpected args: $*" >&2
  exit 1
fi
dest="$4"
mkdir -p "$dest/tinygo/bin" "$dest/tinygo/src/runtime/internal/sys" "$dest/tinygo/src/device/arm"
printf '#!/bin/sh\nexit 0\n' > "$dest/tinygo/bin/tinygo"
chmod +x "$dest/tinygo/bin/tinygo"
printf 'package sys\n' > "$dest/tinygo/src/runtime/internal/sys/zversion.go"
printf 'package arm\n' > "$dest/tinygo/src/device/arm/arm.go"
printf '%s\n%s\n' "$archive" "$dest" > "$WASM_TINYGO_FAKE_TAR_LOG"
`)
  await chmod(fakeTarPath, 0o755)

  const archiveBody = Buffer.from('fake tinygo archive\n')
  const server = createServer((request, response) => {
    if (request.url === '/tinygo0.40.1.linux-amd64.tar.gz') {
      response.writeHead(200, { 'content-type': 'application/gzip' })
      response.end(archiveBody)
      return
    }
    response.writeHead(404)
    response.end('missing')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('expected an inet server address')
  }

  const cacheDir = path.join(tempDir, '.cache', 'tinygo-toolchain')
  const tarLogPath = path.join(tempDir, 'tar-log.txt')
  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/fetch-tinygo-toolchain.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
      WASM_TINYGO_FAKE_TAR_LOG: tarLogPath,
      WASM_TINYGO_TINYGO_CACHE_DIR: cacheDir,
      WASM_TINYGO_TINYGO_RELEASE_URL: `http://127.0.0.1:${address.port}/tinygo0.40.1.linux-amd64.tar.gz`,
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
  const manifest = JSON.parse(await readFile(path.join(cacheDir, 'toolchain.json'), 'utf8'))
  assert.equal(manifest.version, '0.40.1')
  assert.equal(manifest.archiveType, 'tar.gz')
  assert.equal(manifest.archivePath, path.join(cacheDir, 'tinygo0.40.1.linux-amd64.tar.gz'))
  assert.equal(manifest.binPath, path.join(cacheDir, 'extract', 'tinygo', 'bin', 'tinygo'))
  assert.equal(manifest.rootPath, path.join(cacheDir, 'extract', 'tinygo'))
  const [archivePath, extractPath] = (await readFile(tarLogPath, 'utf8')).trimEnd().split('\n')
  assert.equal(archivePath, manifest.archivePath)
  assert.equal(extractPath, path.join(cacheDir, 'extract'))
  assert.equal(await readFile(manifest.archivePath, 'utf8'), archiveBody.toString())
})

test('fetch-tinygo-toolchain reports a clear error when the archive extractor is unavailable', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-fetch-toolchain-missing-extractor-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const cacheDir = path.join(tempDir, '.cache', 'tinygo-toolchain')
  const archivePath = path.join(cacheDir, 'tinygo0.40.1.linux-amd64.tar.gz')
  await mkdir(cacheDir, { recursive: true })
  await writeFile(archivePath, 'fake tinygo archive\n')

  const emptyPathDir = path.join(tempDir, 'empty-bin')
  await mkdir(emptyPathDir, { recursive: true })

  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/fetch-tinygo-toolchain.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      PATH: emptyPathDir,
      WASM_TINYGO_TINYGO_ARCHIVE_PATH: archivePath,
      WASM_TINYGO_TINYGO_CACHE_DIR: cacheDir,
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

  assert.notEqual(exitCode, 0, output)
  assert.match(output, /TinyGo archive extraction failed: tar is not available/)
})

test('fetch-tinygo-toolchain still supports explicit deb archive overrides', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-fetch-toolchain-deb-override-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const cacheDir = path.join(tempDir, '.cache', 'tinygo-toolchain')
  const archivePath = path.join(cacheDir, 'tinygo_0.40.1_amd64.deb')
  await mkdir(cacheDir, { recursive: true })
  await writeFile(archivePath, 'fake tinygo deb\n')

  const fakeBinDir = path.join(tempDir, 'bin')
  await mkdir(fakeBinDir, { recursive: true })
  const fakeDpkgDebPath = path.join(fakeBinDir, 'dpkg-deb')
  await writeFile(fakeDpkgDebPath, `#!/bin/sh
set -eu
if [ "$1" != "-x" ]; then
  echo "unexpected args: $*" >&2
  exit 1
fi
archive="$2"
dest="$3"
mkdir -p "$dest/usr/local/bin" "$dest/usr/local/lib/tinygo/src/runtime/internal/sys" "$dest/usr/local/lib/tinygo/src/device/arm"
printf '#!/bin/sh\nexit 0\n' > "$dest/usr/local/bin/tinygo"
chmod +x "$dest/usr/local/bin/tinygo"
printf 'package sys\n' > "$dest/usr/local/lib/tinygo/src/runtime/internal/sys/zversion.go"
printf 'package arm\n' > "$dest/usr/local/lib/tinygo/src/device/arm/arm.go"
printf '%s\n%s\n' "$archive" "$dest" > "$WASM_TINYGO_FAKE_DPKG_LOG"
`)
  await chmod(fakeDpkgDebPath, 0o755)

  const dpkgLogPath = path.join(tempDir, 'dpkg-log.txt')
  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/fetch-tinygo-toolchain.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
      WASM_TINYGO_FAKE_DPKG_LOG: dpkgLogPath,
      WASM_TINYGO_TINYGO_ARCHIVE_PATH: archivePath,
      WASM_TINYGO_TINYGO_CACHE_DIR: cacheDir,
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
  const manifest = JSON.parse(await readFile(path.join(cacheDir, 'toolchain.json'), 'utf8'))
  assert.equal(manifest.archiveType, 'deb')
  assert.equal(manifest.archivePath, archivePath)
  assert.equal(manifest.binPath, path.join(cacheDir, 'extract', 'usr', 'local', 'bin', 'tinygo'))
  assert.equal(manifest.rootPath, path.join(cacheDir, 'extract', 'usr', 'local', 'lib', 'tinygo'))
  const [loggedArchivePath, extractPath] = (await readFile(dpkgLogPath, 'utf8')).trimEnd().split('\n')
  assert.equal(loggedArchivePath, archivePath)
  assert.equal(extractPath, path.join(cacheDir, 'extract'))
})

test('resolveTinyGoToolchainPaths chooses archive layouts per platform', () => {
  const cacheDir = '/tmp/wasm-tinygo-cache'

  const linuxPaths = withEnv({
    WASM_TINYGO_TINYGO_PLATFORM: 'linux',
    WASM_TINYGO_TINYGO_ARCH: 'amd64',
    WASM_TINYGO_TINYGO_CACHE_DIR: cacheDir,
  }, () => resolveTinyGoToolchainPaths())
  assert.equal(linuxPaths.archiveType, 'tar.gz')
  assert.equal(linuxPaths.archiveFileName, 'tinygo0.40.1.linux-amd64.tar.gz')
  assert.equal(linuxPaths.binPath, path.join(cacheDir, 'extract', 'tinygo', 'bin', 'tinygo'))
  assert.equal(linuxPaths.rootPath, path.join(cacheDir, 'extract', 'tinygo'))

  const darwinPaths = withEnv({
    WASM_TINYGO_TINYGO_PLATFORM: 'darwin',
    WASM_TINYGO_TINYGO_ARCH: 'arm64',
    WASM_TINYGO_TINYGO_CACHE_DIR: cacheDir,
  }, () => resolveTinyGoToolchainPaths())
  assert.equal(darwinPaths.archiveType, 'tar.gz')
  assert.equal(darwinPaths.archiveFileName, 'tinygo0.40.1.darwin-arm64.tar.gz')
  assert.equal(darwinPaths.binPath, path.join(cacheDir, 'extract', 'tinygo', 'bin', 'tinygo'))
  assert.equal(darwinPaths.rootPath, path.join(cacheDir, 'extract', 'tinygo'))

  const windowsPaths = withEnv({
    WASM_TINYGO_TINYGO_PLATFORM: 'win32',
    WASM_TINYGO_TINYGO_ARCH: 'amd64',
    WASM_TINYGO_TINYGO_CACHE_DIR: cacheDir,
  }, () => resolveTinyGoToolchainPaths())
  assert.equal(windowsPaths.archiveType, 'zip')
  assert.equal(windowsPaths.archiveFileName, 'tinygo0.40.1.windows-amd64.zip')
  assert.equal(windowsPaths.binPath, path.join(cacheDir, 'extract', 'tinygo', 'bin', 'tinygo.exe'))
  assert.equal(windowsPaths.rootPath, path.join(cacheDir, 'extract', 'tinygo'))
})
