import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { ensureTinyGoSourceReady } from '../scripts/fetch-tinygo-source.mjs'

const runGit = ({ args, cwd }) => {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.equal(result.status, 0, [result.stdout, result.stderr].join(''))
}

test('ensureTinyGoSourceReady removes a stale cache index.lock before retrying git fetch/checkout', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-source-lock-'))
  const remoteRepoPath = path.join(tempDir, 'remote.git')
  const worktreePath = path.join(tempDir, 'worktree')
  const cacheDir = path.join(tempDir, 'tinygo-src-cache')
  const previousSourceUrl = process.env.WASM_TINYGO_SOURCE_URL
  const previousSourceRef = process.env.WASM_TINYGO_SOURCE_REF
  const previousSourceVersion = process.env.WASM_TINYGO_SOURCE_VERSION
  const previousCacheDir = process.env.WASM_TINYGO_SOURCE_CACHE_DIR
  t.after(async () => {
    if (previousSourceUrl === undefined) {
      delete process.env.WASM_TINYGO_SOURCE_URL
    } else {
      process.env.WASM_TINYGO_SOURCE_URL = previousSourceUrl
    }
    if (previousSourceRef === undefined) {
      delete process.env.WASM_TINYGO_SOURCE_REF
    } else {
      process.env.WASM_TINYGO_SOURCE_REF = previousSourceRef
    }
    if (previousSourceVersion === undefined) {
      delete process.env.WASM_TINYGO_SOURCE_VERSION
    } else {
      process.env.WASM_TINYGO_SOURCE_VERSION = previousSourceVersion
    }
    if (previousCacheDir === undefined) {
      delete process.env.WASM_TINYGO_SOURCE_CACHE_DIR
    } else {
      process.env.WASM_TINYGO_SOURCE_CACHE_DIR = previousCacheDir
    }
    await rm(tempDir, { recursive: true, force: true })
  })

  await mkdir(worktreePath, { recursive: true })
  runGit({ args: ['init', '--bare', remoteRepoPath], cwd: tempDir })
  runGit({ args: ['init'], cwd: worktreePath })
  runGit({ args: ['config', 'user.name', 'Codex'], cwd: worktreePath })
  runGit({ args: ['config', 'user.email', 'codex@example.com'], cwd: worktreePath })
  await writeFile(path.join(worktreePath, 'README.md'), '# tinygo fixture\n')
  runGit({ args: ['add', 'README.md'], cwd: worktreePath })
  runGit({ args: ['commit', '-m', 'init'], cwd: worktreePath })
  runGit({ args: ['tag', 'v0.40.1'], cwd: worktreePath })
  runGit({ args: ['remote', 'add', 'origin', remoteRepoPath], cwd: worktreePath })
  runGit({ args: ['push', 'origin', 'HEAD:main', '--tags'], cwd: worktreePath })

  process.env.WASM_TINYGO_SOURCE_URL = remoteRepoPath
  process.env.WASM_TINYGO_SOURCE_REF = 'v0.40.1'
  process.env.WASM_TINYGO_SOURCE_VERSION = '0.40.1'
  process.env.WASM_TINYGO_SOURCE_CACHE_DIR = cacheDir

  const first = await ensureTinyGoSourceReady()
  await writeFile(path.join(cacheDir, '.git', 'index.lock'), 'stale lock\n')

  const second = await ensureTinyGoSourceReady()
  const readme = await readFile(path.join(cacheDir, 'README.md'), 'utf8')

  assert.equal(first.rootPath, cacheDir)
  assert.equal(second.rootPath, cacheDir)
  assert.equal(readme, '# tinygo fixture\n')
  await assert.rejects(stat(path.join(cacheDir, '.git', 'index.lock')))
})
