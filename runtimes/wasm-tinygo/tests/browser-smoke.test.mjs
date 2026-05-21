import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

import { normalizeTinyGoDriverBridgeManifestForBrowser } from '../src/compile-unit.ts'

const stripAnsi = (value) => value.replace(/\u001B\[[0-9;]*m/g, '')
const mark = (label) => process.stderr.write(`[browser-smoke] ${label}\n`)

test('browser smoke completes TinyGo bootstrap flow through test hooks', { timeout: 600000 }, async (t) => {
  const browserWorkspaceFiles = {
    'go.mod': `module example.com/browserprobe

go 1.22
`,
    'helper/helper.go': `package helper

import "fmt"

func Run() {
\tfmt.Println("browser-ok")
}
`,
    'main.go': `package main

import "example.com/browserprobe/helper"

func main() {
\thelper.Run()
}
`,
  }
  const invalidBrowserWorkspaceFiles = {
    ...browserWorkspaceFiles,
    'main.go': `package main

import "example.com/browserprobe/missing"

func main() {
\tmissing.Run()
}
`,
  }
  const staticBrowserWorkspaceFiles = {
    'go.mod': `module example.com/staticprobe

go 1.22
`,
    'main.go': `package main

import "fmt"

var bonus int
const baseLabel = "factorial_plus_bonus"
const allowBonus = true
const skipPenalty bool = false
var switchOffset int

func label(n int) string {
\tswitch labelTag := baseLabel; labelTag {
\tcase "factorial_plus_bonus":
\t\treturn baseLabel
\tdefault:
\t\treturn "even_input"
\t}
}

func factorial(n int) int {
\tif n <= 1 {
\t\treturn 1
\t}
\treturn n * factorial(n-1)
}

func adjust(total int) int {
\tswitchOffset = total - total
\tbonus += len(baseLabel) - 17
\treturn switchOffset
}

func main() {
\tvar total int
\tconst inputValue = 5
\ttotal = factorial(inputValue)
\tif readyTotal := total; allowBonus && !skipPenalty && readyTotal > 0 {
\t\ttotal += adjust(total)
\t\ttotal += bonus
\t}
\tfmt.Printf("%s=%d input=%d\\n", label(inputValue), total, inputValue)
}
`,
  }
  const staticImportedWorkspaceFiles = {
    'go.mod': `module example.com/staticimport

go 1.22
`,
    'helper/helper.go': `package helper

import "fmt"

var Bonus = 3
const InputLabel = "helper_input"
const OutputLabel = "imported_total"
const ApplyBonus = true
const SkipReport bool = false
var Adjustment int

func Factorial(n int) int {
\tif n <= 1 {
\t\treturn 1
\t}
\treturn n * Factorial(n-1)
}

func Sum(n int) int {
\ttotal := 0
\tfor i := 1; ; i += 1 {
\t\tif i > n {
\t\t\tbreak
\t\t}
\t\tif i == 0 {
\t\t\tcontinue
\t\t}
\t\ttotal += i
\t}
\treturn total
}

func Report(n int) {
\tfmt.Printf("%s=%d\\n", InputLabel, n)
}

func Label(n int) string {
\tswitch labelTag := OutputLabel; labelTag {
\tcase "imported_total":
\t\treturn OutputLabel
\tdefault:
\t\treturn "none"
\t}
}

func Total(n int) int {
\tif !SkipReport {
\t\tReport(n)
\t}
\tif OutputLabel != "imported_total" {
\t\treturn 0
\t}
\ttotal := Factorial(n) + Sum(2)
\tif ApplyBonus || false {
\t\tif labelLen := len(OutputLabel); labelLen > 0 {
\t\t\tBonus += labelLen - 14
\t\t}
\t\tconst adjustmentBase = 3
\t\tAdjustment += Bonus - adjustmentBase
\t\ttotal += Adjustment
\t\treturn total
\t}
\treturn Factorial(n)
}
`,
    'main.go': `package main

import (
\t"fmt"

\t"example.com/staticimport/helper"
)

func main() {
\tfmt.Printf("%s=%d input=%d\\n", helper.Label(5), helper.Total(5), 5)
}
`,
  }
  const unsupportedStaticLanguageWorkspaceFiles = {
    'go.mod': `module example.com/unsupportedstatic

go 1.22
`,
    'main.go': `package main

type Task interface {
\tRun()
}

type App struct{}

func (App) Run() {}

func main() {
\tvar task Task = App{}
\t_ = task
}
`,
  }
  let previewPort
  try {
    previewPort = await new Promise((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') {
          reject(new Error('browser smoke failed to resolve a preview port'))
          return
        }
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve(address.port)
        })
      })
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      message.includes('listen EPERM') ||
      message.includes('operation not permitted') ||
      message.includes('Operation not permitted')
    ) {
      t.skip(`browser smoke skipped: loopback listen is not permitted in this sandbox\n${message}`)
      return
    }
    throw error
  }
  if (typeof previewPort !== 'number') {
    throw new Error(`browser smoke failed to reserve a preview port: ${String(previewPort)}`)
  }

  const cwd = new URL('..', import.meta.url)
  const bridgeWorkDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-browser-bridge-'))
  t.after(async () => {
    await rm(bridgeWorkDir, { recursive: true, force: true })
  })
  const bridgeEntryPath = path.join(bridgeWorkDir, 'main.go')
  const bridgeOutputPath = path.join(bridgeWorkDir, 'out.wasm')
  const bridgeRequestPath = path.join(bridgeWorkDir, 'tinygo-request.json')
  const bridgeManifestPath = path.join(bridgeWorkDir, 'tinygo-driver-bridge.json')
  await mkdir(path.join(bridgeWorkDir, 'helper'), { recursive: true })
  await writeFile(path.join(bridgeWorkDir, 'go.mod'), browserWorkspaceFiles['go.mod'])
  await writeFile(path.join(bridgeWorkDir, 'helper', 'helper.go'), browserWorkspaceFiles['helper/helper.go'])
  await writeFile(bridgeEntryPath, browserWorkspaceFiles['main.go'])
  await writeFile(bridgeRequestPath, `${JSON.stringify({
    command: 'build',
    planner: 'tinygo',
    entry: bridgeEntryPath,
    optimize: 'z',
    output: bridgeOutputPath,
    panic: 'trap',
    scheduler: 'asyncify',
    target: 'wasm',
  }, null, 2)}
`)
  const bridge = spawn('npm', ['run', 'probe:tinygo-driver-bridge'], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_DRIVER_BRIDGE_MANIFEST_PATH: bridgeManifestPath,
      WASM_TINYGO_DRIVER_BRIDGE_REQUEST_PATH: bridgeRequestPath,
      WASM_TINYGO_DRIVER_BRIDGE_WORK_DIR: bridgeWorkDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let bridgeOutput = ''
  bridge.stdout.on('data', (chunk) => {
    bridgeOutput += chunk.toString()
  })
  bridge.stderr.on('data', (chunk) => {
    bridgeOutput += chunk.toString()
  })
  const bridgeExitCode = await new Promise((resolve, reject) => {
    bridge.once('error', reject)
    bridge.once('exit', resolve)
  })
  assert.equal(bridgeExitCode, 0, bridgeOutput)
  const driverBridgeManifest = normalizeTinyGoDriverBridgeManifestForBrowser(
    JSON.parse(await readFile(bridgeManifestPath, 'utf8')),
  )
  const { frontendRealAdapter, ...aliasOnlyDriverBridgeManifest } = driverBridgeManifest
  aliasOnlyDriverBridgeManifest.realFrontendAnalysis = driverBridgeManifest.frontendRealAdapter
  const driftedAnalysisInputBridgeManifest = JSON.parse(JSON.stringify(driverBridgeManifest))
  driftedAnalysisInputBridgeManifest.frontendAnalysisInput.buildContext.target = 'mismatch-target'
  const driftedFrontendProbeAnalysisInputBridgeManifest = JSON.parse(JSON.stringify(driverBridgeManifest))
  const driftedFrontendProbeProgramPackage =
    driftedFrontendProbeAnalysisInputBridgeManifest.frontendAnalysisInput.packageGraph.find(
      (packageInfo) => !packageInfo.standard && !packageInfo.depOnly,
    )
  assert.ok(driftedFrontendProbeProgramPackage)
  driftedFrontendProbeProgramPackage.imports = ['fmt']
  const driftedDriverBridgeManifest = JSON.parse(JSON.stringify(driverBridgeManifest))
  driftedDriverBridgeManifest.frontendAnalysis = JSON.parse(JSON.stringify(driverBridgeManifest.frontendRealAdapter))
  driftedDriverBridgeManifest.frontendAnalysis.buildContext.target = 'mismatch-target'
  assert.equal(driverBridgeManifest.frontendAnalysis, undefined)
  assert.ok((driverBridgeManifest.packageGraph?.length ?? 0) >= 1)
  assert.match(driverBridgeManifest.toolchain?.version ?? '', /0\.40\.1/)

  const build = spawn('npm', ['run', 'build'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let buildOutput = ''
  build.stdout.on('data', (chunk) => {
    buildOutput += chunk.toString()
  })
  build.stderr.on('data', (chunk) => {
    buildOutput += chunk.toString()
  })
  const buildExitCode = await new Promise((resolve, reject) => {
    build.once('error', reject)
    build.once('exit', resolve)
  })
  assert.equal(buildExitCode, 0, buildOutput)

  let preview
  try {
    preview = spawn(
      process.execPath,
      [
        new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname,
        'preview',
        '--host',
        '127.0.0.1',
        '--port',
        String(previewPort),
        '--strictPort',
      ],
      {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      message.includes('listen EPERM') ||
      message.includes('operation not permitted') ||
      message.includes('Operation not permitted')
    ) {
      t.skip(`browser smoke skipped: preview server is not permitted in this sandbox\n${message}`)
      return
    }
    throw error
  }
  const previewExited = new Promise((resolve, reject) => {
    preview.once('error', reject)
    preview.once('exit', resolve)
  })
  t.after(async () => {
    if (preview.exitCode === null && preview.signalCode === null) {
      preview.kill('SIGTERM')
      await Promise.race([previewExited.catch(() => {}), delay(2000)])
    }
    if (preview.exitCode === null && preview.signalCode === null) {
      preview.kill('SIGKILL')
    }
    await previewExited.catch(() => {})
  })

  let previewOutput = ''
  let previewUrl = ''
  preview.stdout.on('data', (chunk) => {
    previewOutput += chunk.toString()
    const matchedUrl = stripAnsi(previewOutput).match(/http:\/\/127\.0\.0\.1:(\d+)\//)
    if (matchedUrl) {
      previewUrl = matchedUrl[0]
    }
  })
  preview.stderr.on('data', (chunk) => {
    previewOutput += chunk.toString()
    const matchedUrl = stripAnsi(previewOutput).match(/http:\/\/127\.0\.0\.1:(\d+)\//)
    if (matchedUrl) {
      previewUrl = matchedUrl[0]
    }
  })

  let previewReady = false
  for (let index = 0; index < 120; index += 1) {
    if (previewUrl !== '') {
      previewReady = true
      break
    }
    await delay(500)
  }
  if (
    !previewReady &&
    (previewOutput.includes('listen EPERM') ||
      previewOutput.includes('operation not permitted') ||
      previewOutput.includes('Operation not permitted'))
  ) {
    t.skip(`browser smoke skipped: preview server is not permitted in this sandbox\n${stripAnsi(previewOutput)}`)
    return
  }
  assert.equal(previewReady, true, stripAnsi(previewOutput))
  assert.notEqual(previewUrl, '', stripAnsi(previewOutput))

  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      message.includes('Operation not permitted') ||
      message.includes('operation not permitted') ||
      message.includes('setsockopt') ||
      message.includes('sandbox_host_linux.cc')
    ) {
      t.skip(`browser smoke skipped: Chromium launch is not permitted in this sandbox\n${message}`)
      return
    }
    throw error
  }
  t.after(async () => {
    await browser.close()
  })

  const context = await browser.newContext()
  await context.addCookies([
    {
      name: 'dev_bypass_waf',
      value: 'seorii_bypass_token_is_this',
      domain: '127.0.0.1',
      path: '/',
    },
  ])
  await context.addInitScript(() => {
    window.__codexUnhandledRejections = []
    window.addEventListener('unhandledrejection', (event) => {
      window.__codexUnhandledRejections.push(
        event.reason instanceof Error ? event.reason.message : String(event.reason),
      )
    })
  })

  let page = await context.newPage()
  let gotoError = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(previewUrl, { waitUntil: 'load', timeout: 120000 })
      gotoError = null
      break
    } catch (error) {
      gotoError = error
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('Page crashed') || attempt === 2) {
        throw error
      }
      await page.close().catch(() => {})
      await delay(500)
      page = await context.newPage()
    }
  }
  if (gotoError) {
    throw gotoError
  }
  const pageErrors = []
  page.on('pageerror', (error) => {
    pageErrors.push(error instanceof Error ? error.message : String(error))
  })
  const dispatchResetLog = async () => {
    await page.evaluate(() => {
      document.querySelector('[data-action="reset"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }
  await page.waitForFunction(
    () =>
      typeof window.__wasmTinygoTestHooks?.boot === 'function' &&
      typeof window.__wasmTinygoTestHooks?.runUpstreamProbe === 'function' &&
      typeof window.__wasmTinygoTestHooks?.runUpstreamFrontendProbe === 'function' &&
      typeof window.__wasmTinygoTestHooks?.readFrontendAnalysisInputManifest === 'function' &&
      typeof window.__wasmTinygoTestHooks?.setBuildRequestOverrides === 'function' &&
      typeof window.__wasmTinygoTestHooks?.setDriverBridgeManifest === 'function' &&
      typeof window.__wasmTinygoTestHooks?.setWorkspaceFiles === 'function',
    null,
    { timeout: 120000 },
  )

  const upstreamProbe = await page.evaluate(() => window.__wasmTinygoTestHooks.runUpstreamProbe())
  assert.equal(upstreamProbe.requestedTarget, 'wasip1')
  assert.equal(upstreamProbe.resolvedGoos, 'wasip1')
  assert.equal(upstreamProbe.resolvedGoarch, 'wasm')
  assert.equal(upstreamProbe.triple, 'wasm32-unknown-wasi')
  assert.equal(Array.isArray(upstreamProbe.buildTags), true)
  assert.equal(upstreamProbe.buildTags.includes('tinygo.wasm'), true)
  assert.equal(upstreamProbe.scheduler, 'asyncify')
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), browserWorkspaceFiles)
  await page.evaluate((manifest) => window.__wasmTinygoTestHooks.setDriverBridgeManifest(manifest), driverBridgeManifest)
  const frontendProbe = await page.evaluate(() => window.__wasmTinygoTestHooks.runUpstreamFrontendProbe())
  assert.equal(frontendProbe.requestedTarget, 'wasip1')
  assert.equal(frontendProbe.mainImportPath, driverBridgeManifest.entryPackage?.importPath ?? 'command-line-arguments')
  assert.equal(frontendProbe.mainPackageName, driverBridgeManifest.entryPackage?.name ?? 'main')
  assert.equal(frontendProbe.packageCount > 1, true)
  assert.deepEqual(frontendProbe.imports, driverBridgeManifest.entryPackage?.imports ?? [])
  assert.equal(Array.isArray(frontendProbe.packages), true)
  assert.equal(frontendProbe.packages.length, frontendProbe.packageCount)
  assert.deepEqual(
    frontendProbe.packages.find((pkg) => pkg.importPath === (driverBridgeManifest.entryPackage?.importPath ?? 'command-line-arguments')),
    {
      importPath: driverBridgeManifest.entryPackage?.importPath ?? 'command-line-arguments',
      name: driverBridgeManifest.entryPackage?.name ?? 'main',
      fileCount: 1,
      imports: driverBridgeManifest.entryPackage?.imports ?? [],
    },
  )
  assert.equal(
    frontendProbe.packages.some((pkg) => pkg.importPath === 'example.com/browserprobe/helper'),
    true,
  )
  assert.equal(
    frontendProbe.packages.some((pkg) => pkg.importPath === 'fmt'),
    true,
  )
  const expectedFrontendAnalysisInputManifest = {
    ...driverBridgeManifest.frontendAnalysisInput,
    upstreamFrontendProbe: frontendProbe,
  }

  await page.evaluate(() => window.__wasmTinygoTestHooks.setBuildRequestOverrides({ scheduler: 'asyncify' }))
  await page.evaluate(() => window.__wasmTinygoTestHooks.boot())
  await page.evaluate(() => window.__wasmTinygoTestHooks.plan())
  await page.evaluate(() => window.__wasmTinygoTestHooks.execute())

  const frontendAnalysisInputManifest = await page.evaluate(
    () => window.__wasmTinygoTestHooks.readFrontendAnalysisInputManifest(),
  )
  const buildArtifact = await page.evaluate(() => {
    const artifact = window.__wasmTinygoTestHooks.readBuildArtifact()
    if (!artifact) {
      return null
    }
    return {
      path: artifact.path,
      byteLength: artifact.bytes.length,
      artifactKind: artifact.artifactKind,
      runnable: artifact.runnable,
      entrypoint: artifact.entrypoint,
      reason: artifact.reason,
    }
  })
  const phases = await page.locator('[data-phase]').allTextContents()
  const activity = await page.locator('#terminal-output').textContent()
  const sourcePreview = await page.locator('.source-panel').first().textContent()

  assert.match(phases.join('\n'), /emception worker\s+ready/)
  assert.match(phases.join('\n'), /build driver plan\s+\d+ steps/)
  assert.match(phases.join('\n'), /build execution\s+[\d,]+ bytes/)
  assert.match(phases.join('\n'), /front-end verification\s+verified/)
  assert.match(buildArtifact?.path ?? '', /\/(?:main|out)\.wasm$/)
  assert.equal(buildArtifact?.byteLength > 0, true)
  assert.equal(buildArtifact?.artifactKind, 'execution')
  assert.equal(buildArtifact?.runnable, true)
  assert.match(buildArtifact?.entrypoint ?? '', /^(?:_(?:start|initialize)|main)$/)
  assert.equal(buildArtifact?.reason, undefined)
  assert.deepEqual(frontendAnalysisInputManifest, expectedFrontendAnalysisInputManifest)
  assert.match(activity ?? '', /backend source=bridge host artifact target=wasip1 runnable=true path=\/working\/out\.wasm/)
  assert.match(activity ?? '', /bridge host artifact command=.*tinygo.* build -target wasip1 .* -o .*tinygo-bridge-execution\.wasm/)
  assert.match(activity ?? '', /patched upstream TinyGo WASI probe verified target=wasip1 triple=wasm32-unknown-wasi scheduler=asyncify/)
  assert.match(activity ?? '', /patched upstream TinyGo WASI frontend probe matched analysis input packages=[1-9]\d* main=example\.com\/browserprobe/)
  assert.match(activity ?? '', /patched upstream TinyGo WASI frontend probe matched frontend analysis packages=[1-9]\d* main=example\.com\/browserprobe/)
  assert.match(activity ?? '', /patched upstream TinyGo WASI frontend probe matched frontend real adapter packages=[1-9]\d* main=example\.com\/browserprobe/)
  assert.match(activity ?? '', /tinygo compiler module loaded from tools\/tinygo-compiler\.wasm \(mode=direct\)/)
  assert.match(activity ?? '', /frontend final artifact source=bridge host artifact target=wasip1 output=\/working\/out\.wasm/)
  assert.match(activity ?? '', /frontend lowered verification skipped: bridge host artifact bypassed synthetic backend lowering/)
  assert.match(activity ?? '', /frontend final artifact compiled module=ok/)
  assert.match(activity ?? '', /execution artifact ready: .*\/(?:main|out)\.wasm \([\d,]+ bytes\)/)
  assert.match(activity ?? '', /execution artifact entrypoint=(?:_(?:start|initialize)|main)/)
  assert.match(activity ?? '', /browser-ok/)
  assert.match(activity ?? '', /execution artifact completed exitCode=0/)
  assert.match(activity ?? '', /driver tinygo-style planner validated target=wasm optimize=-Oz scheduler=asyncify panic=trap/)
  assert.match(activity ?? '', /frontend input bridge verified target=wasm llvm=wasm32-unknown-wasi scheduler=asyncify packages=[1-9]\d*/)
  assert.match(activity ?? '', /frontend analysis input bridge verified target=wasm llvm=wasm32-unknown-wasi scheduler=asyncify packages=[1-9]\d*/)
  assert.match(activity ?? '', /frontend analysis input source=bridge/)
  assert.match(activity ?? '', /frontend analysis input upstream frontend probe source=browser/)
  assert.match(activity ?? '', /frontend analysis verified target=wasm llvm=wasm32-unknown-wasi groups=6 compileUnits=[1-9]\d* allCompile=[1-9]\d*/)
  assert.match(activity ?? '', /frontend build mode=frontend/)
  assert.match(activity ?? '', /frontend build source=real-adapter/)
  assert.match(activity ?? '', /frontend real adapter verified target=wasm llvm=wasm32-unknown-wasi groups=4 compileUnits=[1-9]\d* allCompile=[1-9]\d*/)
  assert.match(activity ?? '', /frontend real adapter bridge verified target=wasm llvm=wasm32-unknown-wasi groups=4 compileUnits=[1-9]\d* allCompile=[1-9]\d* alias=direct source=canonical/)
  assert.match(activity ?? '', /frontend real adapter source=bridge/)
  assert.match(activity ?? '', /frontend real adapter seam verified target=wasm llvm=wasm32-unknown-wasi groups=4 compileUnits=[1-9]\d* allCompile=[1-9]\d* alias=direct/)
  assert.match(activity ?? '', /frontend analysis tinygo frontend prepared analysis handoff/)
  assert.match(activity ?? '', /frontend bridge verified target=wasm llvm=wasm32-unknown-wasi program=main imports=1 packages=[1-9]\d*/)
  assert.match(activity ?? '', /frontend bridge coverage compileUnits=[1-9]\d* graphPackages=[1-9]\d* coveredPackages=[1-9]\d*\/[1-9]\d* compileUnitFiles=[1-9]\d* coveredFiles=[1-9]\d*\/[1-9]\d* depOnly=[1-9]\d* standard=[1-9]\d* local=2 alias=direct/)
  assert.match(activity ?? '', /frontend bridge toolchain version=.*0\.40\.1/)
  assert.doesNotMatch(activity ?? '', /frontend analysis bridge verified/)
  assert.doesNotMatch(activity ?? '', /frontend real adapter tinygo frontend prepared real adapter handoff/)
  assert.doesNotMatch(activity ?? '', /backend materialize \/working\/tinygo-lowered-/)
  assert.doesNotMatch(activity ?? '', /backend lowered ir units=/)
  assert.doesNotMatch(activity ?? '', /frontend lowered bitcode ready count=/)
  assert.doesNotMatch(activity ?? '', /frontend lowered objects ready count=/)
  assert.doesNotMatch(activity ?? '', /frontend bootstrap tool plan skipped: backend lowering is active/)
  assert.doesNotMatch(activity ?? '', /\$ \/usr\/bin\/wasm-ld .*\/working\/tinygo-work\/.*\.bc .* -o \/working\/out\.wasm/)
  assert.doesNotMatch(activity ?? '', /\$ \/usr\/bin\/clang .*tinygo-bootstrap\.c .* -o .*tinygo-bootstrap\.o/)
  assert.doesNotMatch(activity ?? '', /build artifact execution blocked: bootstrap artifact has no WASI entrypoint/)
  assert.doesNotMatch(activity ?? '', /bootstrap exports checksum=/)
  assert.doesNotMatch(activity ?? '', /bootstrap exports manifestBytes=/)
  assert.doesNotMatch(activity ?? '', /frontend input target=/)
  assert.doesNotMatch(sourcePreview ?? '', /\/working\/tinygo-bootstrap\.json/)
  assert.doesNotMatch(sourcePreview ?? '', /\/working\/tinygo-frontend-input\.json/)

  await dispatchResetLog()
  const resetFrontendAnalysisInputManifest = await page.evaluate(
    () => window.__wasmTinygoTestHooks.readFrontendAnalysisInputManifest(),
  )
  const resetPhases = await page.locator('[data-phase]').allTextContents()
  const resetActivity = await page.locator('#terminal-output').textContent()
  assert.equal(resetFrontendAnalysisInputManifest, null)
  assert.match(resetPhases.join('\n'), /emception worker\s+idle/)
  assert.match(resetPhases.join('\n'), /build driver plan\s+idle/)
  assert.match(resetPhases.join('\n'), /build execution\s+idle/)
  assert.match(resetPhases.join('\n'), /front-end verification\s+idle/)
  assert.match(resetActivity ?? '', /log cleared/)

  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), browserWorkspaceFiles)
  await page.evaluate(
    (manifest) => window.__wasmTinygoTestHooks.setDriverBridgeManifest(manifest),
    driftedFrontendProbeAnalysisInputBridgeManifest,
  )
  const driftedFrontendProbeError = await page.evaluate(async () => {
    try {
      await window.__wasmTinygoTestHooks.runUpstreamFrontendProbe()
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  })
  assert.match(
    driftedFrontendProbeError ?? '',
    /upstream frontend probe package summaries did not match frontend analysis input/,
  )
  await dispatchResetLog()

  await page.evaluate(() => {
    window.__codexHookBootPromise = window.__wasmTinygoTestHooks.boot()
  })
  await page.waitForFunction(
    () =>
      document.querySelector('[data-action="plan"]')?.disabled === true &&
      document.querySelector('[data-action="execute"]')?.disabled === true &&
      document.querySelector('[data-action="reset"]')?.disabled === true,
    null,
    { timeout: 120000 },
  )
  const hookBootLockedState = await page.evaluate(() => ({
    plan: document.querySelector('[data-action="plan"]')?.disabled ?? null,
    execute: document.querySelector('[data-action="execute"]')?.disabled ?? null,
    reset: document.querySelector('[data-action="reset"]')?.disabled ?? null,
  }))
  const hookBootPlanError = await page.evaluate(async () => {
    try {
      await window.__wasmTinygoTestHooks.plan()
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  })
  await page.evaluate(async () => await window.__codexHookBootPromise)
  const hookBootUnlockedState = await page.evaluate(() => ({
    plan: document.querySelector('[data-action="plan"]')?.disabled ?? null,
    execute: document.querySelector('[data-action="execute"]')?.disabled ?? null,
    reset: document.querySelector('[data-action="reset"]')?.disabled ?? null,
  }))
  assert.deepEqual(hookBootLockedState, { plan: true, execute: true, reset: true })
  assert.match(hookBootPlanError ?? '', /wasm-tinygo test hook action already running: booting/)
  assert.deepEqual(hookBootUnlockedState, { plan: false, execute: false, reset: false })
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), browserWorkspaceFiles)
  const redundantReadyBootStatuses = await page.evaluate(async () => {
    const settled = await Promise.allSettled([
      window.__wasmTinygoTestHooks.boot(),
      window.__wasmTinygoTestHooks.plan(),
    ])
    return settled.map((result) => {
      if (result.status === 'fulfilled') {
        return 'fulfilled'
      }
      return result.reason instanceof Error ? result.reason.message : String(result.reason)
    })
  })
  const redundantReadyBootPhases = await page.locator('[data-phase]').allTextContents()
  assert.deepEqual(redundantReadyBootStatuses, ['fulfilled', 'fulfilled'])
  assert.match(redundantReadyBootPhases.join('\n'), /build driver plan\s+\d+ steps/)
  await page.evaluate(() => window.__wasmTinygoTestHooks.setBuildRequestOverrides({ scheduler: 'asyncify' }))
  await page.evaluate((manifest) => window.__wasmTinygoTestHooks.setDriverBridgeManifest(manifest), driverBridgeManifest)
  const redundantReadyExecuteStatuses = await page.evaluate(async () => {
    const settled = await Promise.allSettled([
      window.__wasmTinygoTestHooks.boot(),
      window.__wasmTinygoTestHooks.execute(),
    ])
    return settled.map((result) => {
      if (result.status === 'fulfilled') {
        return 'fulfilled'
      }
      return result.reason instanceof Error ? result.reason.message : String(result.reason)
    })
  })
  const redundantReadyExecuteFrontendAnalysisInputManifest = await page.evaluate(
    () => window.__wasmTinygoTestHooks.readFrontendAnalysisInputManifest(),
  )
  const redundantReadyExecutePhases = await page.locator('[data-phase]').allTextContents()
  const redundantReadyExecuteActivity = await page.locator('#terminal-output').textContent()
  assert.deepEqual(redundantReadyExecuteStatuses, ['fulfilled', 'fulfilled'])
  assert.deepEqual(redundantReadyExecuteFrontendAnalysisInputManifest, expectedFrontendAnalysisInputManifest)
  assert.match(redundantReadyExecutePhases.join('\n'), /build execution\s+[\d,]+ bytes/)
  assert.match(redundantReadyExecutePhases.join('\n'), /front-end verification\s+verified/)
  assert.match(redundantReadyExecuteActivity ?? '', /frontend analysis input source=bridge/)

  await dispatchResetLog()
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), browserWorkspaceFiles)
  await page.evaluate(() => {
    window.__codexHookPlanPromise = window.__wasmTinygoTestHooks.plan()
  })
  await page.waitForFunction(
    () =>
      document.querySelector('[data-action="plan"]')?.disabled === true &&
      document.querySelector('[data-action="execute"]')?.disabled === true &&
      document.querySelector('[data-action="reset"]')?.disabled === true,
    null,
    { timeout: 120000 },
  )
  const hookPlanLockedState = await page.evaluate(() => ({
    plan: document.querySelector('[data-action="plan"]')?.disabled ?? null,
    execute: document.querySelector('[data-action="execute"]')?.disabled ?? null,
    reset: document.querySelector('[data-action="reset"]')?.disabled ?? null,
  }))
  await page.evaluate(async () => await window.__codexHookPlanPromise)
  const hookPlanUnlockedState = await page.evaluate(() => ({
    plan: document.querySelector('[data-action="plan"]')?.disabled ?? null,
    execute: document.querySelector('[data-action="execute"]')?.disabled ?? null,
    reset: document.querySelector('[data-action="reset"]')?.disabled ?? null,
  }))
  assert.deepEqual(hookPlanLockedState, { plan: true, execute: true, reset: true })
  assert.deepEqual(hookPlanUnlockedState, { plan: false, execute: false, reset: false })

  await dispatchResetLog()
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), browserWorkspaceFiles)
  const busyUiPlanPageErrorStart = pageErrors.length
  await page.evaluate(() => {
    window.__codexUnhandledRejections = []
  })
  await page.evaluate(() => {
    document.querySelector('[data-action="plan"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    document.querySelector('[data-action="plan"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForFunction(
    () => !document.querySelector('[data-action="plan"]')?.disabled,
    null,
    { timeout: 120000 },
  )
  const busyUiPlanPhases = await page.locator('[data-phase]').allTextContents()
  const busyUiPlanActivity = await page.locator('#terminal-output').textContent()
  const busyUiPlanUnhandledRejections = await page.evaluate(() => window.__codexUnhandledRejections)
  assert.deepEqual(pageErrors.slice(busyUiPlanPageErrorStart), [])
  assert.deepEqual(busyUiPlanUnhandledRejections, [])
  assert.match(busyUiPlanPhases.join('\n'), /build driver plan\s+\d+ steps/)
  assert.doesNotMatch(busyUiPlanActivity ?? '', /build driver failed:/)

  await dispatchResetLog()
  await page.evaluate(() => {
    window.__codexUnhandledRejections = []
  })
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), invalidBrowserWorkspaceFiles)
  await page.evaluate(() => {
    document.querySelector('[data-action="plan"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForFunction(
    () => !document.querySelector('[data-action="plan"]')?.disabled,
    null,
    { timeout: 120000 },
  )
  const failingUiPlanUnhandledRejections = await page.evaluate(() => window.__codexUnhandledRejections)
  const failingUiPlanPhases = await page.locator('[data-phase]').allTextContents()
  const failingUiPlanActivity = await page.locator('#terminal-output').textContent()
  assert.deepEqual(failingUiPlanUnhandledRejections, [])
  assert.match(failingUiPlanPhases.join('\n'), /build driver plan\s+failed/)
  assert.match(failingUiPlanActivity ?? '', /build driver failed:/)
  assert.match(failingUiPlanActivity ?? '', /local module import package not found/)

  await dispatchResetLog()
  const failingUiExecutePageErrorStart = pageErrors.length
  await page.evaluate(() => {
    window.__codexUnhandledRejections = []
  })
  await page.evaluate(() => window.__wasmTinygoTestHooks.setBuildRequestOverrides({ scheduler: 'asyncify' }))
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), browserWorkspaceFiles)
  await page.evaluate((manifest) => window.__wasmTinygoTestHooks.setDriverBridgeManifest(manifest), driftedAnalysisInputBridgeManifest)
  await page.evaluate(() => window.__wasmTinygoTestHooks.boot())
  await page.evaluate(() => {
    document.querySelector('[data-action="execute"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForFunction(
    () => !document.querySelector('[data-action="execute"]')?.disabled,
    null,
    { timeout: 120000 },
  )
  const failingUiExecuteUnhandledRejections = await page.evaluate(() => window.__codexUnhandledRejections)
  const failingUiExecutePhases = await page.locator('[data-phase]').allTextContents()
  const failingUiExecuteActivity = await page.locator('#terminal-output').textContent()
  assert.deepEqual(pageErrors.slice(failingUiExecutePageErrorStart), [])
  assert.deepEqual(failingUiExecuteUnhandledRejections, [])
  assert.match(failingUiExecutePhases.join('\n'), /build execution\s+failed/)
  assert.match(failingUiExecutePhases.join('\n'), /front-end verification\s+failed/)
  assert.match(failingUiExecuteActivity ?? '', /build execution failed: frontend analysis input did not match real TinyGo driver bridge/)

  await dispatchResetLog()
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), browserWorkspaceFiles)
  const mixedPlanMutationError = await page.evaluate(async (workspaceFiles) => {
    document.querySelector('[data-action="plan"]')?.click()
    let mutationError = null
    try {
      window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles)
    } catch (error) {
      mutationError = error instanceof Error ? error.message : String(error)
    }
    while (document.querySelector('[data-action="plan"]')?.disabled) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return mutationError
  }, invalidBrowserWorkspaceFiles)
  const mixedPlanMutationPhases = await page.locator('[data-phase]').allTextContents()
  const mixedPlanMutationActivity = await page.locator('#terminal-output').textContent()
  assert.match(mixedPlanMutationError ?? '', /wasm-tinygo test hook action already running: planning/)
  assert.match(mixedPlanMutationPhases.join('\n'), /build driver plan\s+\d+ steps/)
  assert.doesNotMatch(mixedPlanMutationActivity ?? '', /build driver failed:/)

  await dispatchResetLog()
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), browserWorkspaceFiles)
  const concurrentPlanMutationError = await page.evaluate(async (workspaceFiles) => {
    const planPromise = window.__wasmTinygoTestHooks.plan()
    let mutationError = null
    try {
      window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles)
    } catch (error) {
      mutationError = error instanceof Error ? error.message : String(error)
    }
    await planPromise
    return mutationError
  }, invalidBrowserWorkspaceFiles)
  assert.match(concurrentPlanMutationError ?? '', /wasm-tinygo test hook action already running: planning/)

  await dispatchResetLog()
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), browserWorkspaceFiles)
  await page.evaluate(() => window.__wasmTinygoTestHooks.plan())
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), invalidBrowserWorkspaceFiles)
  await page.evaluate(() => window.__wasmTinygoTestHooks.execute())

  const invalidatedPlanFrontendAnalysisInputManifest = await page.evaluate(
    () => window.__wasmTinygoTestHooks.readFrontendAnalysisInputManifest(),
  )
  const invalidatedPlanPhases = await page.locator('[data-phase]').allTextContents()
  const invalidatedPlanActivity = await page.locator('#terminal-output').textContent()
  assert.equal(invalidatedPlanFrontendAnalysisInputManifest, null)
  assert.match(invalidatedPlanPhases.join('\n'), /build driver plan\s+failed/)
  assert.match(invalidatedPlanPhases.join('\n'), /build execution\s+failed/)
  assert.match(invalidatedPlanActivity ?? '', /build driver failed:/)
  assert.match(invalidatedPlanActivity ?? '', /local module import package not found/)

  await dispatchResetLog()
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), browserWorkspaceFiles)
  await page.evaluate((manifest) => window.__wasmTinygoTestHooks.setDriverBridgeManifest(manifest), driverBridgeManifest)
  await page.evaluate(() => window.__wasmTinygoTestHooks.plan())
  await page.evaluate(() => window.__wasmTinygoTestHooks.setBuildRequestOverrides({ scheduler: 'asyncify' }))
  const invalidatedOverrideResetPhases = await page.locator('[data-phase]').allTextContents()
  assert.match(invalidatedOverrideResetPhases.join('\n'), /emception worker\s+idle/)
  assert.match(invalidatedOverrideResetPhases.join('\n'), /build driver plan\s+idle/)
  assert.match(invalidatedOverrideResetPhases.join('\n'), /build execution\s+idle/)
  assert.match(invalidatedOverrideResetPhases.join('\n'), /front-end verification\s+idle/)
  await page.evaluate(() => window.__wasmTinygoTestHooks.execute())

  const invalidatedOverridePhases = await page.locator('[data-phase]').allTextContents()
  const invalidatedOverrideActivity = await page.locator('#terminal-output').textContent()
  assert.match(invalidatedOverridePhases.join('\n'), /build execution\s+[\d,]+ bytes/)
  assert.match(invalidatedOverridePhases.join('\n'), /front-end verification\s+verified/)
  assert.match(invalidatedOverrideActivity ?? '', /driver tinygo-style planner validated target=wasm optimize=-Oz scheduler=asyncify panic=trap/)

  await dispatchResetLog()
  mark('ui execute mutation start')
  await page.evaluate(() => window.__wasmTinygoTestHooks.setBuildRequestOverrides({ scheduler: 'asyncify' }))
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), browserWorkspaceFiles)
  await page.evaluate((manifest) => window.__wasmTinygoTestHooks.setDriverBridgeManifest(manifest), driverBridgeManifest)
  await page.evaluate(() => window.__wasmTinygoTestHooks.boot())
  const uiExecuteMutationError = await page.evaluate(async (workspaceFiles) => {
    document.querySelector('[data-action="execute"]')?.click()
    let mutationError = null
    try {
      window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles)
    } catch (error) {
      mutationError = error instanceof Error ? error.message : String(error)
    }
    while (document.querySelector('[data-action="execute"]')?.disabled) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return mutationError
  }, invalidBrowserWorkspaceFiles)
  await page.waitForFunction(
    () => /verified|failed/.test(document.querySelector('[data-phase="verify"] .phase-value')?.textContent ?? ''),
    null,
    { timeout: 120000 },
  )
  const uiExecuteMutationPhases = await page.locator('[data-phase]').allTextContents()
  assert.match(uiExecuteMutationError ?? '', /wasm-tinygo test hook action already running: executing/)
  assert.match(uiExecuteMutationPhases.join('\n'), /build driver plan\s+\d+ steps/)
  assert.match(uiExecuteMutationPhases.join('\n'), /build execution\s+[\d,]+ bytes/)
  assert.match(uiExecuteMutationPhases.join('\n'), /front-end verification\s+verified/)
  mark('ui execute mutation complete')

  await dispatchResetLog()
  mark('repeated execute start')
  await page.evaluate(() => window.__wasmTinygoTestHooks.setBuildRequestOverrides({ scheduler: 'asyncify' }))
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), browserWorkspaceFiles)
  await page.evaluate((manifest) => window.__wasmTinygoTestHooks.setDriverBridgeManifest(manifest), driverBridgeManifest)
  await page.evaluate(() => window.__wasmTinygoTestHooks.boot())
  await page.evaluate(() => window.__wasmTinygoTestHooks.execute())
  await page.evaluate(() => window.__wasmTinygoTestHooks.execute())
  const repeatedExecuteFrontendAnalysisInputManifest = await page.evaluate(
    () => window.__wasmTinygoTestHooks.readFrontendAnalysisInputManifest(),
  )
  const repeatedExecutePhases = await page.locator('[data-phase]').allTextContents()
  const repeatedExecuteActivity = await page.locator('#terminal-output').textContent()
  assert.deepEqual(repeatedExecuteFrontendAnalysisInputManifest, expectedFrontendAnalysisInputManifest)
  assert.match(repeatedExecutePhases.join('\n'), /build execution\s+[\d,]+ bytes/)
  assert.match(repeatedExecutePhases.join('\n'), /front-end verification\s+verified/)
  assert.equal((repeatedExecuteActivity?.match(/frontend analysis input source=bridge/g) ?? []).length, 2)
  assert.equal((repeatedExecuteActivity?.match(/frontend final artifact compiled module=ok/g) ?? []).length, 2)
  assert.doesNotMatch(repeatedExecuteActivity ?? '', /build execution failed: FS error/)
  mark('repeated execute complete')

  await dispatchResetLog()
  mark('concurrent execute start')
  const concurrentExecuteStatuses = await page.evaluate(async ({ workspaceFiles, manifest }) => {
    window.__wasmTinygoTestHooks.setBuildRequestOverrides({ scheduler: 'asyncify' })
    window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles)
    window.__wasmTinygoTestHooks.setDriverBridgeManifest(manifest)
    await window.__wasmTinygoTestHooks.boot()
    const settled = await Promise.allSettled([
      window.__wasmTinygoTestHooks.execute(),
      window.__wasmTinygoTestHooks.execute(),
    ])
    return settled.map((result) => {
      if (result.status === 'fulfilled') {
        return 'fulfilled'
      }
      return result.reason instanceof Error ? result.reason.message : String(result.reason)
    })
  }, { workspaceFiles: browserWorkspaceFiles, manifest: driverBridgeManifest })
  const concurrentExecutePhases = await page.locator('[data-phase]').allTextContents()
  const concurrentExecuteActivity = await page.locator('#terminal-output').textContent()
  assert.deepEqual(concurrentExecuteStatuses, ['fulfilled', 'wasm-tinygo test hook action already running: executing'])
  assert.match(concurrentExecutePhases.join('\n'), /build execution\s+[\d,]+ bytes/)
  assert.match(concurrentExecutePhases.join('\n'), /front-end verification\s+verified/)
  assert.doesNotMatch(concurrentExecuteActivity ?? '', /build execution failed: FS error/)
  mark('concurrent execute complete')

  await dispatchResetLog()
  mark('delayed invalidation start')
  await page.evaluate(() => window.__wasmTinygoTestHooks.setBuildRequestOverrides({ scheduler: 'asyncify' }))
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), browserWorkspaceFiles)
  await page.evaluate((manifest) => window.__wasmTinygoTestHooks.setDriverBridgeManifest(manifest), driverBridgeManifest)
  await page.evaluate(() => window.__wasmTinygoTestHooks.boot())
  const delayedUiExecuteMutationError = await page.evaluate((workspaceFiles) => new Promise((resolve) => {
    document.querySelector('[data-action="execute"]')?.click()
    setTimeout(() => {
      try {
        window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles)
        resolve(null)
      } catch (error) {
        resolve(error instanceof Error ? error.message : String(error))
      }
    }, 0)
  }), invalidBrowserWorkspaceFiles)
  await page.waitForFunction(
    () => !document.querySelector('[data-action="execute"]')?.disabled,
    null,
    { timeout: 120000 },
  )

  const delayedInvalidationFrontendAnalysisInputManifest = await page.evaluate(
    () => window.__wasmTinygoTestHooks.readFrontendAnalysisInputManifest(),
  )
  const delayedInvalidationPhases = await page.locator('[data-phase]').allTextContents()
  const delayedInvalidationActivity = await page.locator('#terminal-output').textContent()
  assert.match(delayedUiExecuteMutationError ?? '', /wasm-tinygo test hook action already running: executing/)
  assert.deepEqual(delayedInvalidationFrontendAnalysisInputManifest, expectedFrontendAnalysisInputManifest)
  assert.match(delayedInvalidationPhases.join('\n'), /build execution\s+[\d,]+ bytes/)
  assert.match(delayedInvalidationPhases.join('\n'), /front-end verification\s+verified/)
  assert.match(delayedInvalidationActivity ?? '', /frontend analysis input source=bridge/)
  assert.doesNotMatch(delayedInvalidationActivity ?? '', /build driver failed:/)

  await dispatchResetLog()
  await page.evaluate(() => window.__wasmTinygoTestHooks.setBuildRequestOverrides({ scheduler: 'asyncify' }))
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), browserWorkspaceFiles)
  await page.evaluate((manifest) => window.__wasmTinygoTestHooks.setDriverBridgeManifest(manifest), driverBridgeManifest)
  await page.evaluate(() => window.__wasmTinygoTestHooks.boot())
  const forcedResetBaselineActivity = await page.locator('#terminal-output').textContent()
  await page.evaluate(() => {
    document.querySelector('[data-action="execute"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    document.querySelector('[data-action="reset"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForFunction(
    () => !document.querySelector('[data-action="execute"]')?.disabled,
    null,
    { timeout: 120000 },
  )

  const forcedResetFrontendAnalysisInputManifest = await page.evaluate(
    () => window.__wasmTinygoTestHooks.readFrontendAnalysisInputManifest(),
  )
  const forcedResetPhases = await page.locator('[data-phase]').allTextContents()
  const forcedResetActivity = await page.locator('#terminal-output').textContent()
  assert.deepEqual(forcedResetFrontendAnalysisInputManifest, expectedFrontendAnalysisInputManifest)
  assert.match(forcedResetPhases.join('\n'), /emception worker\s+ready/)
  assert.match(forcedResetPhases.join('\n'), /build execution\s+[\d,]+ bytes/)
  assert.match(forcedResetPhases.join('\n'), /front-end verification\s+verified/)
  assert.equal(forcedResetActivity?.startsWith(forcedResetBaselineActivity ?? ''), true)
  assert.match(forcedResetActivity ?? '', /frontend analysis input source=bridge/)

  await page.goto(previewUrl, { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction(
    () =>
      typeof window.__wasmTinygoTestHooks?.boot === 'function' &&
      typeof window.__wasmTinygoTestHooks?.setBuildRequestOverrides === 'function' &&
      typeof window.__wasmTinygoTestHooks?.setDriverBridgeManifest === 'function' &&
      typeof window.__wasmTinygoTestHooks?.setWorkspaceFiles === 'function',
    null,
    { timeout: 120000 },
  )
  await page.evaluate(() => window.__wasmTinygoTestHooks.setBuildRequestOverrides({ scheduler: 'asyncify' }))
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), browserWorkspaceFiles)
  await page.evaluate((manifest) => window.__wasmTinygoTestHooks.setDriverBridgeManifest(manifest), aliasOnlyDriverBridgeManifest)
  await page.evaluate(() => window.__wasmTinygoTestHooks.boot())
  await page.evaluate(() => window.__wasmTinygoTestHooks.plan())
  await page.evaluate(() => window.__wasmTinygoTestHooks.execute())

  const aliasOnlyActivity = await page.locator('#terminal-output').textContent()
  assert.match(aliasOnlyActivity ?? '', /frontend real adapter bridge verified target=wasm llvm=wasm32-unknown-wasi groups=4 compileUnits=[1-9]\d* allCompile=[1-9]\d* alias=direct source=compat-alias/)
  assert.match(aliasOnlyActivity ?? '', /patched upstream TinyGo WASI frontend probe matched frontend real adapter packages=[1-9]\d* main=example\.com\/browserprobe/)

  await page.goto(previewUrl, { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction(
    () =>
      typeof window.__wasmTinygoTestHooks?.boot === 'function' &&
      typeof window.__wasmTinygoTestHooks?.setBuildRequestOverrides === 'function' &&
      typeof window.__wasmTinygoTestHooks?.setDriverBridgeManifest === 'function' &&
      typeof window.__wasmTinygoTestHooks?.setWorkspaceFiles === 'function',
    null,
    { timeout: 120000 },
  )
  await page.evaluate(() => window.__wasmTinygoTestHooks.setBuildRequestOverrides({ scheduler: 'asyncify' }))
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), browserWorkspaceFiles)
  await page.evaluate((manifest) => window.__wasmTinygoTestHooks.setDriverBridgeManifest(manifest), driftedAnalysisInputBridgeManifest)
  await page.evaluate(() => window.__wasmTinygoTestHooks.boot())
  await page.evaluate(() => window.__wasmTinygoTestHooks.plan())
  await page.evaluate(() => window.__wasmTinygoTestHooks.execute())

  const driftedAnalysisInputPhases = await page.locator('[data-phase]').allTextContents()
  const driftedAnalysisInputActivity = await page.locator('#terminal-output').textContent()
  assert.match(driftedAnalysisInputPhases.join('\n'), /build execution\s+failed/)
  assert.match(driftedAnalysisInputPhases.join('\n'), /front-end verification\s+failed/)
  assert.match(driftedAnalysisInputActivity ?? '', /build execution failed: frontend analysis input did not match real TinyGo driver bridge/)
  await page.evaluate((manifest) => window.__wasmTinygoTestHooks.setDriverBridgeManifest(manifest), driverBridgeManifest)
  await page.evaluate(() => window.__wasmTinygoTestHooks.execute())
  const recoveredFrontendAnalysisInputManifest = await page.evaluate(
    () => window.__wasmTinygoTestHooks.readFrontendAnalysisInputManifest(),
  )
  const recoveredPhases = await page.locator('[data-phase]').allTextContents()
  const recoveredActivity = await page.locator('#terminal-output').textContent()
  assert.deepEqual(
    recoveredFrontendAnalysisInputManifest,
    expectedFrontendAnalysisInputManifest,
    JSON.stringify({ recoveredPhases, recoveredActivity }),
  )
  assert.match(recoveredPhases.join('\n'), /build execution\s+[\d,]+ bytes/)
  assert.match(recoveredPhases.join('\n'), /front-end verification\s+verified/)
  assert.match(recoveredActivity ?? '', /build execution failed: frontend analysis input did not match real TinyGo driver bridge/)
  assert.match(recoveredActivity ?? '', /frontend analysis input source=bridge/)

  await page.goto(previewUrl, { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction(
    () =>
      typeof window.__wasmTinygoTestHooks?.boot === 'function' &&
      typeof window.__wasmTinygoTestHooks?.setBuildRequestOverrides === 'function' &&
      typeof window.__wasmTinygoTestHooks?.setDriverBridgeManifest === 'function' &&
      typeof window.__wasmTinygoTestHooks?.setWorkspaceFiles === 'function',
    null,
    { timeout: 120000 },
  )
  await page.evaluate(() => window.__wasmTinygoTestHooks.setBuildRequestOverrides({ scheduler: 'asyncify' }))
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), browserWorkspaceFiles)
  await page.evaluate((manifest) => window.__wasmTinygoTestHooks.setDriverBridgeManifest(manifest), driftedDriverBridgeManifest)
  await page.evaluate(() => window.__wasmTinygoTestHooks.boot())
  await page.evaluate(() => window.__wasmTinygoTestHooks.plan())
  await page.evaluate(() => window.__wasmTinygoTestHooks.execute())

  const driftedPhases = await page.locator('[data-phase]').allTextContents()
  const driftedActivity = await page.locator('#terminal-output').textContent()
  assert.match(driftedPhases.join('\n'), /build execution\s+failed/)
  assert.match(driftedPhases.join('\n'), /front-end verification\s+failed/)
  assert.match(driftedActivity ?? '', /build execution failed: frontend analysis buildContext did not match real TinyGo analysis adapter/)

  await page.route('**/api/tinygo/compile', (route) => route.fulfill({ status: 404, body: 'not found' }))
  await page.goto(previewUrl, { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction(
    () =>
      typeof window.__wasmTinygoTestHooks?.boot === 'function' &&
      typeof window.__wasmTinygoTestHooks?.readBuildArtifact === 'function' &&
      typeof window.__wasmTinygoTestHooks?.setBuildRequestOverrides === 'function' &&
      typeof window.__wasmTinygoTestHooks?.setDriverBridgeManifest === 'function' &&
      typeof window.__wasmTinygoTestHooks?.setWorkspaceFiles === 'function',
    null,
    { timeout: 120000 },
  )
  await page.evaluate(() => window.__wasmTinygoTestHooks.setBuildRequestOverrides({ scheduler: 'asyncify' }))
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), browserWorkspaceFiles)
  await page.evaluate((manifest) => window.__wasmTinygoTestHooks.setDriverBridgeManifest(manifest), driverBridgeManifest)
  await page.evaluate(() => window.__wasmTinygoTestHooks.boot())
  await page.evaluate(() => window.__wasmTinygoTestHooks.plan())
  await page.evaluate(() => window.__wasmTinygoTestHooks.execute())

  const staticFallbackArtifact = await page.evaluate(() => {
    const artifact = window.__wasmTinygoTestHooks.readBuildArtifact()
    if (!artifact) {
      return null
    }
    return {
      path: artifact.path,
      artifactKind: artifact.artifactKind,
      runnable: artifact.runnable,
      entrypoint: artifact.entrypoint,
      reason: artifact.reason,
    }
  })
  const staticFallbackPhases = await page.locator('[data-phase]').allTextContents()
  const staticFallbackActivity = await page.locator('#terminal-output').textContent()
  assert.match(staticFallbackPhases.join('\n'), /build execution\s+[\d,]+ bytes/)
  assert.match(staticFallbackPhases.join('\n'), /front-end verification\s+verified/)
  assert.match(staticFallbackArtifact?.path ?? '', /\/working\/out\.wasm$/)
  assert.equal(staticFallbackArtifact?.artifactKind, 'execution')
  assert.equal(staticFallbackArtifact?.runnable, true)
  assert.match(staticFallbackArtifact?.entrypoint ?? '', /^(?:_(?:start|initialize)|main)$/)
  assert.equal(staticFallbackArtifact?.reason, undefined)
  assert.match(staticFallbackActivity ?? '', /execution artifact ready: \/working\/out\.wasm \([\d,]+ bytes\)/)
  assert.match(staticFallbackActivity ?? '', /execution artifact entrypoint=(?:_(?:start|initialize)|main)/)
  assert.match(staticFallbackActivity ?? '', /browser-ok/)
  assert.match(staticFallbackActivity ?? '', /execution artifact completed exitCode=0/)
  assert.doesNotMatch(staticFallbackActivity ?? '', /tinygo host compile ready:/)

  await page.goto(previewUrl, { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction(
    () =>
      typeof window.__wasmTinygoTestHooks?.boot === 'function' &&
      typeof window.__wasmTinygoTestHooks?.readBuildArtifact === 'function' &&
      typeof window.__wasmTinygoTestHooks?.setBuildRequestOverrides === 'function' &&
      typeof window.__wasmTinygoTestHooks?.setDriverBridgeManifest === 'function' &&
      typeof window.__wasmTinygoTestHooks?.setWorkspaceFiles === 'function',
    null,
    { timeout: 120000 },
  )
  await page.evaluate(() => window.__wasmTinygoTestHooks.setBuildRequestOverrides({ scheduler: 'asyncify' }))
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), staticBrowserWorkspaceFiles)
  await page.evaluate(() => window.__wasmTinygoTestHooks.setDriverBridgeManifest(null))
  await page.evaluate(() => window.__wasmTinygoTestHooks.boot())
  await page.evaluate(() => window.__wasmTinygoTestHooks.plan())
  await page.evaluate(() => window.__wasmTinygoTestHooks.execute())

  const staticExecutionArtifact = await page.evaluate(() => {
    const artifact = window.__wasmTinygoTestHooks.readBuildArtifact()
    if (!artifact) {
      return null
    }
    return {
      path: artifact.path,
      artifactKind: artifact.artifactKind,
      runnable: artifact.runnable,
      entrypoint: artifact.entrypoint,
      reason: artifact.reason,
    }
  })
  const staticExecutionPhases = await page.locator('[data-phase]').allTextContents()
  const staticExecutionActivity = await page.locator('#terminal-output').textContent()
  assert.match(staticExecutionPhases.join('\n'), /build execution\s+[\d,]+ bytes/)
  assert.match(staticExecutionPhases.join('\n'), /front-end verification\s+verified/)
  assert.match(staticExecutionArtifact?.path ?? '', /\/working\/out\.wasm$/)
  assert.equal(staticExecutionArtifact?.artifactKind, 'execution')
  assert.equal(staticExecutionArtifact?.runnable, true)
  assert.equal(staticExecutionArtifact?.entrypoint, 'main')
  assert.equal(staticExecutionArtifact?.reason, undefined)
  assert.match(staticExecutionActivity ?? '', /build artifact ready: \/working\/out\.wasm \([\d,]+ bytes\)/)
  assert.match(staticExecutionActivity ?? '', /execution artifact ready: \/working\/out\.wasm \([\d,]+ bytes\)/)
  assert.match(staticExecutionActivity ?? '', /execution artifact entrypoint=main/)
  assert.match(staticExecutionActivity ?? '', /factorial_plus_bonus=123 input=5/)
  assert.match(staticExecutionActivity ?? '', /execution artifact completed exitCode=0/)
  assert.match(staticExecutionActivity ?? '', /frontend analysis tinygo frontend prepared analysis handoff/)
  assert.match(staticExecutionActivity ?? '', /frontend analysis verified target=wasm llvm=wasm32-unknown-wasi groups=6 compileUnits=[1-9]\d* allCompile=[1-9]\d*/)
  assert.match(staticExecutionActivity ?? '', /frontend real adapter tinygo frontend prepared real adapter handoff/)
  assert.match(staticExecutionActivity ?? '', /frontend real adapter source=analysis/)
  assert.doesNotMatch(staticExecutionActivity ?? '', /artifact probe failed:/)
  assert.doesNotMatch(staticExecutionActivity ?? '', /tinygo host compile ready:/)
  assert.doesNotMatch(staticExecutionActivity ?? '', /build artifact execution blocked:/)
  assert.doesNotMatch(staticExecutionActivity ?? '', /\.exec\.wasm/)

  await page.evaluate(() => window.__wasmTinygoTestHooks.reset())
  await page.evaluate(() => window.__wasmTinygoTestHooks.setBuildRequestOverrides({ scheduler: 'asyncify' }))
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), staticImportedWorkspaceFiles)
  await page.evaluate(() => window.__wasmTinygoTestHooks.setDriverBridgeManifest(null))
  await page.evaluate(() => window.__wasmTinygoTestHooks.boot())
  await page.evaluate(() => window.__wasmTinygoTestHooks.plan())
  await page.evaluate(() => window.__wasmTinygoTestHooks.execute())

  const staticImportedArtifact = await page.evaluate(() => {
    const artifact = window.__wasmTinygoTestHooks.readBuildArtifact()
    if (!artifact) {
      return null
    }
    return {
      path: artifact.path,
      artifactKind: artifact.artifactKind,
      runnable: artifact.runnable,
      entrypoint: artifact.entrypoint,
      reason: artifact.reason,
    }
  })
  const staticImportedPhases = await page.locator('[data-phase]').allTextContents()
  const staticImportedActivity = await page.locator('#terminal-output').textContent()
  assert.match(staticImportedPhases.join('\n'), /build execution\s+[\d,]+ bytes/)
  assert.match(staticImportedPhases.join('\n'), /front-end verification\s+verified/)
  assert.match(staticImportedArtifact?.path ?? '', /\/working\/out\.wasm$/)
  assert.equal(staticImportedArtifact?.artifactKind, 'execution')
  assert.equal(staticImportedArtifact?.runnable, true)
  assert.equal(staticImportedArtifact?.entrypoint, 'main')
  assert.equal(staticImportedArtifact?.reason, undefined)
  assert.match(staticImportedActivity ?? '', /helper_input=5/)
  assert.match(staticImportedActivity ?? '', /imported_total=123 input=5/)
  assert.match(staticImportedActivity ?? '', /execution artifact completed exitCode=0/)
  assert.match(staticImportedActivity ?? '', /frontend analysis tinygo frontend prepared analysis handoff/)
  assert.match(staticImportedActivity ?? '', /frontend analysis verified target=wasm llvm=wasm32-unknown-wasi groups=6 compileUnits=[1-9]\d* allCompile=[1-9]\d*/)
  assert.match(staticImportedActivity ?? '', /frontend real adapter tinygo frontend prepared real adapter handoff/)
  assert.match(staticImportedActivity ?? '', /frontend real adapter source=analysis/)
  assert.doesNotMatch(staticImportedActivity ?? '', /tinygo host compile ready:/)

  await page.evaluate(() => window.__wasmTinygoTestHooks.reset())
  await page.evaluate(() => window.__wasmTinygoTestHooks.setBuildRequestOverrides({ scheduler: 'asyncify' }))
  await page.evaluate(
    (workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles),
    unsupportedStaticLanguageWorkspaceFiles,
  )
  await page.evaluate(() => window.__wasmTinygoTestHooks.setDriverBridgeManifest(null))
  await page.evaluate(() => window.__wasmTinygoTestHooks.boot())
  await page.evaluate(() => window.__wasmTinygoTestHooks.plan())
  await page.evaluate(() => window.__wasmTinygoTestHooks.execute())

  const unsupportedStaticLanguagePhases = await page.locator('[data-phase]').allTextContents()
  const unsupportedStaticLanguageActivity = await page.locator('#terminal-output').textContent()
  assert.match(unsupportedStaticLanguagePhases.join('\n'), /build execution\s+failed/)
  assert.match(
    unsupportedStaticLanguageActivity ?? '',
    /pure-browser execution unsupported features=methods, struct types, interface types/,
  )
  assert.match(
    unsupportedStaticLanguageActivity ?? '',
    /build execution failed: pure-browser fallback does not support methods, struct types, interface types; use the host-assisted bridge for this program/,
  )
  assert.doesNotMatch(unsupportedStaticLanguageActivity ?? '', /attempting browser-side relink to produce a runnable execution artifact/)

  await page.evaluate(() => window.__wasmTinygoTestHooks.reset())
  await page.evaluate(() => window.__wasmTinygoTestHooks.setBuildRequestOverrides({ scheduler: 'asyncify', target: 'bogus-target' }))
  await page.evaluate((workspaceFiles) => window.__wasmTinygoTestHooks.setWorkspaceFiles(workspaceFiles), staticBrowserWorkspaceFiles)
  await page.evaluate(() => window.__wasmTinygoTestHooks.setDriverBridgeManifest(null))
  await page.evaluate(() => window.__wasmTinygoTestHooks.boot())
  await page.evaluate(() => window.__wasmTinygoTestHooks.execute())

  const unsupportedTargetPhases = await page.locator('[data-phase]').allTextContents()
  const unsupportedTargetActivity = await page.locator('#terminal-output').textContent()
  assert.match(unsupportedTargetPhases.join('\n'), /build execution\s+failed/)
  assert.match(unsupportedTargetPhases.join('\n'), /build driver plan\s+failed/)
  assert.match(unsupportedTargetActivity ?? '', /build driver failed: unsupported target: "bogus-target"/)
  await page.unroute('**/api/tinygo/compile')
})
