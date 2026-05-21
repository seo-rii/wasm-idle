import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { compileTinyGoHostSource, compileTinyGoHostWorkspace } from '../scripts/tinygo-host-compiler.mjs'

test('compileTinyGoHostSource builds a single-file TinyGo source through the reusable host helper', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-host-helper-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeTinyGoDir = path.join(tempDir, 'bin')
  const fakeTinyGoLogPath = path.join(tempDir, 'tinygo-log.txt')
  await mkdir(fakeTinyGoDir, { recursive: true })
  const fakeTinyGoPath = path.join(fakeTinyGoDir, 'tinygo')
  await writeFile(fakeTinyGoPath, `#!/bin/sh
set -eu
printf '%s\\n%s\\n%s\\n' "$TINYGOROOT" "$(pwd)" "$*" >> "$WASM_TINYGO_FAKE_TINYGO_LOG"
if [ "$1" = "info" ]; then
  cat <<'EOF'
LLVM triple:       wasm32-unknown-wasi
GOOS:              wasip1
GOARCH:            wasm
build tags:        tinygo.wasm tinygo purego gc.precise scheduler.tasks
garbage collector: precise
scheduler:         tasks
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

  const previousEnv = {
    WASM_TINYGO_FAKE_TINYGO_LOG: process.env.WASM_TINYGO_FAKE_TINYGO_LOG,
    WASM_TINYGO_TINYGOROOT: process.env.WASM_TINYGO_TINYGOROOT,
    WASM_TINYGO_TINYGO_BIN: process.env.WASM_TINYGO_TINYGO_BIN,
  }
  process.env.WASM_TINYGO_FAKE_TINYGO_LOG = fakeTinyGoLogPath
  process.env.WASM_TINYGO_TINYGOROOT = fakeTinyGoRoot
  process.env.WASM_TINYGO_TINYGO_BIN = fakeTinyGoPath
  t.after(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key]
        continue
      }
      process.env[key] = value
    }
  })

  const result = await compileTinyGoHostSource({
    optimize: 'z',
    outputPath: path.join(tempDir, 'artifacts', 'main.wasm'),
    panic: 'trap',
    scheduler: 'tasks',
    source: 'package main\n\nfunc main() {}\n',
    target: 'wasip1',
    workDir: path.join(tempDir, 'workspace'),
  })

  const invocations = (await readFile(fakeTinyGoLogPath, 'utf8')).trimEnd().split('\n')
  assert.equal(invocations[0], fakeTinyGoRoot)
  assert.equal(invocations[1], path.join(tempDir, 'workspace'))
  assert.match(invocations[2], /build -target wasip1 -opt z -scheduler tasks -panic trap -o .*main\.wasm .*main\.go$/)
  assert.equal(invocations[3], fakeTinyGoRoot)
  assert.equal(invocations[4], path.join(tempDir, 'workspace'))
  assert.equal(invocations[5], 'info -target wasip1 -scheduler tasks')
  assert.equal(result.toolchain.binPath, fakeTinyGoPath)
  assert.equal(result.toolchain.rootPath, fakeTinyGoRoot)
  assert.equal(result.targetInfo.scheduler, 'tasks')
  assert.deepEqual(result.targetInfo.buildTags, ['tinygo.wasm', 'tinygo', 'purego', 'gc.precise', 'scheduler.tasks'])
  assert.deepEqual(result.artifact.bytes, Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]))
  assert.equal(result.artifact.entrypoint, null)
  assert.equal(await readFile(result.entryPath, 'utf8'), 'package main\n\nfunc main() {}\n')
})

test('compileTinyGoHostWorkspace builds a multi-file TinyGo workspace through the reusable host helper', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-host-workspace-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeTinyGoDir = path.join(tempDir, 'bin')
  const fakeTinyGoLogPath = path.join(tempDir, 'tinygo-log.txt')
  await mkdir(fakeTinyGoDir, { recursive: true })
  const fakeTinyGoPath = path.join(fakeTinyGoDir, 'tinygo')
  await writeFile(fakeTinyGoPath, `#!/bin/sh
set -eu
printf '%s\\n%s\\n%s\\n' "$TINYGOROOT" "$(pwd)" "$*" >> "$WASM_TINYGO_FAKE_TINYGO_LOG"
if [ "$1" = "info" ]; then
  cat <<'EOF'
LLVM triple:       wasm32-unknown-wasi
GOOS:              wasip1
GOARCH:            wasm
build tags:        tinygo.wasm tinygo purego gc.precise scheduler.asyncify
garbage collector: precise
scheduler:         asyncify
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

  const previousEnv = {
    WASM_TINYGO_FAKE_TINYGO_LOG: process.env.WASM_TINYGO_FAKE_TINYGO_LOG,
    WASM_TINYGO_TINYGOROOT: process.env.WASM_TINYGO_TINYGOROOT,
    WASM_TINYGO_TINYGO_BIN: process.env.WASM_TINYGO_TINYGO_BIN,
  }
  process.env.WASM_TINYGO_FAKE_TINYGO_LOG = fakeTinyGoLogPath
  process.env.WASM_TINYGO_TINYGOROOT = fakeTinyGoRoot
  process.env.WASM_TINYGO_TINYGO_BIN = fakeTinyGoPath
  t.after(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key]
        continue
      }
      process.env[key] = value
    }
  })

  const result = await compileTinyGoHostWorkspace({
    files: {
      'go.mod': 'module example.com/browserprobe\n\ngo 1.22\n',
      'helper/helper.go': 'package helper\n\nfunc Answer() int { return 42 }\n',
      'main.go': 'package main\n\nimport "example.com/browserprobe/helper"\n\nfunc main() { _ = helper.Answer() }\n',
    },
    optimize: 'z',
    outputPath: path.join(tempDir, 'artifacts', 'main.wasm'),
    panic: 'trap',
    scheduler: 'asyncify',
    target: 'wasip1',
    workDir: path.join(tempDir, 'workspace'),
  })

  const invocations = (await readFile(fakeTinyGoLogPath, 'utf8')).trimEnd().split('\n')
  assert.equal(invocations[0], fakeTinyGoRoot)
  assert.equal(invocations[1], path.join(tempDir, 'workspace'))
  assert.match(invocations[2], /build -target wasip1 -opt z -scheduler asyncify -panic trap -o .*main\.wasm .*main\.go$/)
  assert.equal(invocations[3], fakeTinyGoRoot)
  assert.equal(invocations[4], path.join(tempDir, 'workspace'))
  assert.equal(invocations[5], 'info -target wasip1 -scheduler asyncify')
  assert.equal(await readFile(path.join(tempDir, 'workspace', 'go.mod'), 'utf8'), 'module example.com/browserprobe\n\ngo 1.22\n')
  assert.equal(await readFile(path.join(tempDir, 'workspace', 'helper', 'helper.go'), 'utf8'), 'package helper\n\nfunc Answer() int { return 42 }\n')
  assert.equal(result.entryPath, path.join(tempDir, 'workspace', 'main.go'))
  assert.equal(result.targetInfo.scheduler, 'asyncify')
  assert.deepEqual(result.artifact.bytes, Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]))
})

test('probe-tinygo-host builds a wasm artifact with the configured tinygo binary', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-host-probe-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeTinyGoDir = path.join(tempDir, 'bin')
  const fakeTinyGoLogPath = path.join(tempDir, 'tinygo-log.txt')
  await mkdir(fakeTinyGoDir, { recursive: true })
  const fakeTinyGoPath = path.join(fakeTinyGoDir, 'tinygo')
  await writeFile(fakeTinyGoPath, `#!/bin/sh
set -eu
if [ "$1" = "info" ]; then
  cat <<'EOF'
LLVM triple:       wasm32-unknown-wasi
GOOS:              wasip1
GOARCH:            wasm
build tags:        tinygo.wasm tinygo purego gc.precise scheduler.asyncify
garbage collector: precise
scheduler:         asyncify
EOF
  exit 0
fi
printf '%s\n%s\n' "$TINYGOROOT" "$*" > "$WASM_TINYGO_FAKE_TINYGO_LOG"
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
  const outputPath = path.join(tempDir, 'artifacts', 'main.wasm')
  const manifestPath = path.join(tempDir, 'artifacts', 'tinygo-host-probe.json')
  const workDir = path.join(tempDir, 'work')
  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/probe-tinygo-host.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_FAKE_TINYGO_LOG: fakeTinyGoLogPath,
      WASM_TINYGO_HOST_PROBE_MANIFEST_PATH: manifestPath,
      WASM_TINYGO_HOST_PROBE_OUTPUT_PATH: outputPath,
      WASM_TINYGO_HOST_PROBE_SKIP_RUNTIME: '1',
      WASM_TINYGO_HOST_PROBE_WORK_DIR: workDir,
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
  const [tinygoRoot, invocation] = (await readFile(fakeTinyGoLogPath, 'utf8')).trimEnd().split('\n')
  assert.equal(tinygoRoot, fakeTinyGoRoot)
  assert.match(invocation, new RegExp(`build -target wasip1 -o ${outputPath.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.match(invocation, /main\.go$/)
  assert.deepEqual(await readFile(outputPath), Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]))
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.toolchain.binPath, fakeTinyGoPath)
  assert.equal(manifest.toolchain.rootPath, fakeTinyGoRoot)
  assert.equal(manifest.target, 'wasip1')
  assert.deepEqual(manifest.command, [fakeTinyGoPath, 'build', '-target', 'wasip1', '-o', outputPath, path.join(workDir, 'main.go')])
  assert.equal(manifest.artifact.path, outputPath)
  assert.equal(manifest.runtime.executed, false)
  assert.equal(manifest.runtime.exitCode, null)
  assert.deepEqual(manifest.runtime.logs, [])
  assert.deepEqual(manifest.targetInfo, {
    buildTags: ['tinygo.wasm', 'tinygo', 'purego', 'gc.precise', 'scheduler.asyncify'],
    gc: 'precise',
    goarch: 'wasm',
    goos: 'wasip1',
    llvmTriple: 'wasm32-unknown-wasi',
    scheduler: 'asyncify',
  })
})

test('probe-tinygo-host consumes a tinygo-style request file when provided', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-host-probe-request-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeTinyGoDir = path.join(tempDir, 'bin')
  const fakeTinyGoLogPath = path.join(tempDir, 'tinygo-log.txt')
  await mkdir(fakeTinyGoDir, { recursive: true })
const fakeTinyGoPath = path.join(fakeTinyGoDir, 'tinygo')
  await writeFile(fakeTinyGoPath, `#!/bin/sh
set -eu
printf '%s\n%s\n%s\n' "$TINYGOROOT" "$(pwd)" "$*" >> "$WASM_TINYGO_FAKE_TINYGO_LOG"
if [ "$1" = "info" ]; then
  cat <<'EOF'
LLVM triple:       wasm32-unknown-wasi
GOOS:              wasip1
GOARCH:            wasm
build tags:        tinygo.wasm tinygo purego gc.precise scheduler.tasks
garbage collector: precise
scheduler:         tasks
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
  const outputPath = path.join(workspaceDir, 'request-out.wasm')
  const requestPath = path.join(workspaceDir, 'tinygo-request.json')
  await writeFile(entryPath, 'package main\n\nfunc main() {}\n')
  await writeFile(requestPath, JSON.stringify({
    command: 'build',
    entry: entryPath,
    output: outputPath,
    optimize: 'z',
    panic: 'trap',
    scheduler: 'tasks',
    target: 'wasip1',
  }))

  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/probe-tinygo-host.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_FAKE_TINYGO_LOG: fakeTinyGoLogPath,
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
  const invocations = (await readFile(fakeTinyGoLogPath, 'utf8')).trimEnd().split('\n')
  assert.equal(invocations[0], fakeTinyGoRoot)
  assert.equal(invocations[1], workspaceDir)
  assert.match(invocations[2], new RegExp(`build -target wasip1 -opt z -scheduler tasks -panic trap -o ${outputPath.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')} ${entryPath.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
  assert.equal(invocations[3], fakeTinyGoRoot)
  assert.equal(invocations[4], workspaceDir)
  assert.equal(invocations[5], 'info -target wasip1 -scheduler tasks')
  const manifest = JSON.parse(await readFile(path.join(workspaceDir, 'tinygo-host-probe.json'), 'utf8'))
  assert.equal(manifest.targetInfo.scheduler, 'tasks')
  assert.deepEqual(manifest.targetInfo.buildTags, ['tinygo.wasm', 'tinygo', 'purego', 'gc.precise', 'scheduler.tasks'])
})
