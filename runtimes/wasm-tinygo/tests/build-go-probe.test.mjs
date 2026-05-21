import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('build-go-probe uses a repo-local GOCACHE by default', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-build-go-probe-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const fakeBinDir = path.join(tempDir, 'bin')
  await mkdir(fakeBinDir, { recursive: true })
  const fakeGoPath = path.join(fakeBinDir, 'go')
  await writeFile(fakeGoPath, `#!/bin/sh
set -eu
printf '%s\n%s\n%s\n' "$GOCACHE" "$GOOS" "$GOARCH" > "$WASM_TINYGO_FAKE_GO_ENV_OUTPUT"
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    out="$arg"
  fi
  prev="$arg"
done
mkdir -p "$(dirname "$out")"
printf 'fake-wasm' > "$out"
`)
  await chmod(fakeGoPath, 0o755)

  const envOutputPath = path.join(tempDir, 'go-env.txt')
  const outputPath = path.join(tempDir, 'public', 'tools', 'go-probe.wasm')
  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/build-go-probe.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
      GOCACHE: '',
      WASM_TINYGO_FAKE_GO_ENV_OUTPUT: envOutputPath,
      WASM_TINYGO_GO_PROBE_OUTPUT_PATH: outputPath,
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
  const [goCache, goos, goarch] = (await readFile(envOutputPath, 'utf8')).trimEnd().split('\n')
  assert.equal(goCache, path.join(cwd, '.cache', 'go-build'))
  assert.equal(goos, 'wasip1')
  assert.equal(goarch, 'wasm')
  assert.equal(await readFile(outputPath, 'utf8'), 'fake-wasm')
})
