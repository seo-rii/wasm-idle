import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('fetch-emception-worker reuses an existing worker file when download fails', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-fetch-worker-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const outputPath = path.join(tempDir, 'public', 'vendor', 'emception', 'emception.worker.js')
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, 'existing-worker\n')

  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/fetch-emception-worker.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_EMCEPTION_WORKER_URL: 'http://127.0.0.1:9/emception.worker.bundle.worker.js',
      WASM_TINYGO_EMCEPTION_OUTPUT_PATH: outputPath,
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
  assert.equal(await readFile(outputPath, 'utf8'), 'existing-worker\n')
})

test('fetch-emception-worker downloads the worker and referenced runtime assets into the local vendor directory', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-fetch-worker-assets-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const outputPath = path.join(tempDir, 'public', 'vendor', 'emception', 'emception.worker.js')
  const assetBodies = {
    'tool.wasm': Buffer.from([0x00, 0x61, 0x73, 0x6d]),
    'libsupport.a': Buffer.from('support archive\n'),
    'cache-package.br': Buffer.from('brotli payload\n'),
  }
  const workerSource = [
    'before',
    'e.exports=t.p+"tool.wasm"',
    'e.exports=t.p+"libsupport.a"',
    'e.exports=t.p+"cache-package.br"',
    'if(!e)throw new Error("Automatic publicPath is not supported in this browser");e=e.replace(/#.*$/,"").replace(/\\?.*$/,"").replace(/\\/[^\\/]+$/,"/"),__webpack_require__.p=e',
    'this.ready=this.#e(e,r,{onrunprocess:t,...a});',
    'globalThis.emception=Hn,i(Hn)',
  ].join('\n')

  const server = createServer((request, response) => {
    if (request.url === '/emception.worker.bundle.worker.js') {
      response.writeHead(200, { 'content-type': 'application/javascript' })
      response.end(workerSource)
      return
    }
    const assetName = request.url?.slice(1) ?? ''
    const assetBody = assetBodies[assetName]
    if (assetBody) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.end(assetBody)
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

  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/fetch-emception-worker.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_EMCEPTION_WORKER_URL: `http://127.0.0.1:${address.port}/emception.worker.bundle.worker.js`,
      WASM_TINYGO_EMCEPTION_OUTPUT_PATH: outputPath,
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
  const workerOutput = await readFile(outputPath, 'utf8')
  assert.match(workerOutput, /__webpack_require__\.p=new URL\("\.\/",self\.location\.href\)\.href/)
  assert.ok(workerOutput.includes('e.exports=t.p+"cache-package.brotli"'))
  assert.deepEqual(await readFile(path.join(path.dirname(outputPath), 'tool.wasm')), assetBodies['tool.wasm'])
  assert.equal(await readFile(path.join(path.dirname(outputPath), 'libsupport.a'), 'utf8'), 'support archive\n')
  assert.equal(await readFile(path.join(path.dirname(outputPath), 'cache-package.brotli'), 'utf8'), 'brotli payload\n')
})
