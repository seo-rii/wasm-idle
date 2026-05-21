import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildTinyGoHostProbe } from './tinygo-host-compiler.mjs'

const requestPath = process.env.WASM_TINYGO_HOST_PROBE_REQUEST_PATH
const request = requestPath ? JSON.parse(await readFile(requestPath, 'utf8')) : null
if (request?.command && request.command !== 'build') {
  throw new Error(`unsupported TinyGo host probe command: ${request.command}`)
}
const expectedRuntimeLogs = Array.isArray(request?.expectedRuntimeLogs)
  ? request.expectedRuntimeLogs.map((logLine) => String(logLine))
  : (!request ? ['stdout tinygo-ok'] : null)

const outputPath = process.env.WASM_TINYGO_HOST_PROBE_OUTPUT_PATH ?? request?.output ?? ''
const result = await buildTinyGoHostProbe({
  expectedRuntimeLogs,
  outputPath,
  request,
  skipRuntime: process.env.WASM_TINYGO_HOST_PROBE_SKIP_RUNTIME === '1',
  workDir: process.env.WASM_TINYGO_HOST_PROBE_WORK_DIR ?? '',
})
const manifestPath = process.env.WASM_TINYGO_HOST_PROBE_MANIFEST_PATH ?? path.join(path.dirname(result.artifact.path), 'tinygo-host-probe.json')

await writeFile(manifestPath, `${JSON.stringify(result, null, 2)}
`)

if (result.runtime.executed) {
  console.log(`Built and ran TinyGo wasm artifact at ${result.artifact.path}`)
} else {
  console.log(`Built TinyGo wasm artifact at ${result.artifact.path}`)
  if (result.runtime.reason) {
    console.log(`Skipped runtime execution for target ${result.target}`)
  }
}
