import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { classifyTinyGoCompilerBlockers } from '../scripts/build-tinygo-compiler.mjs'
import { patchTinyGoSourceForWasi } from '../scripts/patch-tinygo-wasi.mjs'

test('build-tinygo-compiler builds a tinygo compiler wasm from repo source', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-compiler-build-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const sourceRoot = path.join(tempDir, 'tinygo')
  const mainDir = path.join(sourceRoot, 'cmd', 'tinygo')
  await mkdir(mainDir, { recursive: true })
  await writeFile(
    path.join(sourceRoot, 'go.mod'),
    `module example.com/tinygo

go 1.22
`,
  )
  await writeFile(
    path.join(mainDir, 'main.go'),
    `package main

func main() {
  println("tinygo-wasm-ok")
}
`,
  )

  const outputPath = path.join(tempDir, 'tinygo-compiler.wasm')
  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/build-tinygo-compiler.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_SOURCE_ROOT: sourceRoot,
      WASM_TINYGO_COMPILER_MAIN_PATH: 'cmd/tinygo',
      WASM_TINYGO_COMPILER_OUTPUT_PATH: outputPath,
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
  const wasmBytes = await readFile(outputPath)
  assert.equal(wasmBytes[0], 0x00)
  assert.equal(wasmBytes[1], 0x61)
  assert.equal(wasmBytes[2], 0x73)
  assert.equal(wasmBytes[3], 0x6d)
})

test('build-tinygo-compiler builds the cmd/tinygo-wasi entry when selected', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-compiler-wasi-default-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const sourceRoot = path.join(tempDir, 'tinygo')
  const mainDir = path.join(sourceRoot, 'cmd', 'tinygo-wasi')
  await mkdir(mainDir, { recursive: true })
  await writeFile(
    path.join(sourceRoot, 'go.mod'),
    `module example.com/tinygo

go 1.22
`,
  )
  await writeFile(
    path.join(mainDir, 'main.go'),
    `package main

func main() {
  println("tinygo-wasi-ok")
}
`,
  )

  const outputPath = path.join(tempDir, 'tinygo-compiler.wasm')
  const manifestPath = path.join(tempDir, 'tinygo-compiler.json')
  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/build-tinygo-compiler.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_SOURCE_ROOT: sourceRoot,
      WASM_TINYGO_COMPILER_MAIN_PATH: 'cmd/tinygo-wasi',
      WASM_TINYGO_COMPILER_OUTPUT_PATH: outputPath,
      WASM_TINYGO_COMPILER_MANIFEST_PATH: manifestPath,
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
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.buildMode, 'direct')
  assert.equal(manifest.artifactKind, 'compiler')
})

test('patch-tinygo-wasi generates a browser-specific tinygo command', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-browser-entry-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const sourceRoot = path.join(tempDir, 'tinygo')
  await mkdir(sourceRoot, { recursive: true })
  await writeFile(
    path.join(sourceRoot, 'go.mod'),
    `module github.com/tinygo-org/tinygo

go 1.22
`,
  )
  await mkdir(path.join(sourceRoot, 'builder'), { recursive: true })
  await mkdir(path.join(sourceRoot, 'goenv'), { recursive: true })
  await mkdir(path.join(sourceRoot, 'loader'), { recursive: true })
  await writeFile(
    path.join(sourceRoot, 'goenv', 'goenv.go'),
    `package goenv

import (
\t"os"
\t"runtime"
\t"strings"
\t"sync"

\t"tinygo.org/x/go-llvm"
)

var goEnvVars struct {
\tGOPATH    string
\tGOROOT    string
\tGOVERSION string
}

var goEnvVarsOnce sync.Once

func readGoEnvVars() error {
\tgoEnvVarsOnce.Do(func() {
\t\tgoEnvVars.GOVERSION = "go1.24.0"
\t})
\treturn nil
}

func llvmMajor() string {
\treturn strings.Split(llvm.Version, ".")[0]
}

func hostGOOS() string {
\treturn runtime.GOOS + os.Getenv("GOOS") + llvmMajor()
}
`,
  )
  await writeFile(
    path.join(sourceRoot, 'builder', 'build.go'),
    `package builder

import "github.com/gofrs/flock"

func lock(path string) error {
	return flock.New(path).Lock()
}
`,
  )
  await writeFile(
    path.join(sourceRoot, 'builder', 'commands.go'),
    `package builder

import (
\t"strings"

\t"tinygo.org/x/go-llvm"
)

func llvmCommandVersionMajor() string {
\treturn strings.Split(llvm.Version, ".")[0]
}
`,
  )
  await writeFile(
    path.join(sourceRoot, 'builder', 'cc.go'),
    `package builder

import "tinygo.org/x/go-llvm"

var llvmVersion = llvm.Version
`,
  )
  await writeFile(
    path.join(sourceRoot, 'loader', 'loader.go'),
    `package loader

import "github.com/tinygo-org/tinygo/cgo"

var _ = cgo.Process
`,
  )

  const patch = await patchTinyGoSourceForWasi(sourceRoot)
  assert.equal(patch.commandPath, './cmd/tinygo-browser')

  const browserEntryPath = path.join(sourceRoot, 'cmd', 'tinygo-browser', 'main.go')
  const browserEntrySource = await readFile(browserEntryPath, 'utf8')
  const patchedBuilderSource = await readFile(path.join(sourceRoot, 'builder', 'build.go'), 'utf8')
  const patchedBuilderCommandsSource = await readFile(path.join(sourceRoot, 'builder', 'commands.go'), 'utf8')
  const patchedBuilderCCSource = await readFile(path.join(sourceRoot, 'builder', 'cc.go'), 'utf8')
  const patchedGoenvSource = await readFile(path.join(sourceRoot, 'goenv', 'goenv.go'), 'utf8')
  const patchedLoaderSource = await readFile(path.join(sourceRoot, 'loader', 'loader.go'), 'utf8')
  const builderLLVMDefaultSource = await readFile(path.join(sourceRoot, 'builder', 'llvm_version_default.go'), 'utf8')
  const builderLLVMWasip1Source = await readFile(path.join(sourceRoot, 'builder', 'llvm_version_wasip1.go'), 'utf8')
  const goenvLLVMDefaultSource = await readFile(path.join(sourceRoot, 'goenv', 'llvm_version_default.go'), 'utf8')
  const goenvLLVMWasip1Source = await readFile(path.join(sourceRoot, 'goenv', 'llvm_version_wasip1.go'), 'utf8')
  const flockStubSource = await readFile(path.join(sourceRoot, 'wasmbridge', 'flock', 'flock.go'), 'utf8')
  const cgoStubSource = await readFile(path.join(sourceRoot, 'wasmbridge', 'cgo', 'cgo.go'), 'utf8')
  assert.match(browserEntrySource, /package main/)
  assert.match(browserEntrySource, /github\.com\/tinygo-org\/tinygo\/builder/)
  assert.match(browserEntrySource, /github\.com\/tinygo-org\/tinygo\/compileopts/)
  assert.match(patchedBuilderSource, /github\.com\/tinygo-org\/tinygo\/wasmbridge\/flock/)
  assert.match(patchedBuilderCommandsSource, /llvmVersionMajor\(\)/)
  assert.doesNotMatch(patchedBuilderCommandsSource, /tinygo\.org\/x\/go-llvm/)
  assert.doesNotMatch(patchedBuilderCommandsSource, /"strings"/)
  assert.match(patchedBuilderCCSource, /llvmVersion\(\)/)
  assert.doesNotMatch(patchedBuilderCCSource, /tinygo\.org\/x\/go-llvm/)
  assert.match(patchedGoenvSource, /llvmVersionMajor\(\)/)
  assert.doesNotMatch(patchedGoenvSource, /tinygo\.org\/x\/go-llvm/)
  assert.doesNotMatch(patchedGoenvSource, /"strings"/)
  assert.match(patchedLoaderSource, /github\.com\/tinygo-org\/tinygo\/wasmbridge\/cgo/)
  assert.match(builderLLVMDefaultSource, /tinygo\.org\/x\/go-llvm/)
  assert.match(builderLLVMWasip1Source, /return "20"/)
  assert.match(goenvLLVMDefaultSource, /tinygo\.org\/x\/go-llvm/)
  assert.match(goenvLLVMWasip1Source, /return "20"/)
  assert.match(flockStubSource, /func New\(string\) \*Flock/)
  assert.match(cgoStubSource, /func Process\(files \[\]\*ast\.File, dir, importPath string, fset \*token\.FileSet/)
  assert.doesNotMatch(browserEntrySource, /go\.bug\.st\/serial/)
  assert.doesNotMatch(browserEntrySource, /github\.com\/mattn\/go-tty/)
  assert.doesNotMatch(browserEntrySource, /serial\/enumerator/)
  assert.doesNotMatch(browserEntrySource, /wasmbridge\/(driver|tinygobackend|tinygofrontend)/)
})

test('patch-tinygo-wasi refreshes an existing copied backend bridge file', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-browser-entry-refresh-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const sourceRoot = path.join(tempDir, 'tinygo')
  const staleBridgeDir = path.join(sourceRoot, 'wasmbridge', 'tinygobackend')
  await mkdir(staleBridgeDir, { recursive: true })
  await writeFile(
    path.join(sourceRoot, 'go.mod'),
    `module github.com/tinygo-org/tinygo

go 1.22
`,
  )
  await writeFile(path.join(staleBridgeDir, 'backend.go'), 'package tinygobackend\n\nconst stale = true\n')

  await patchTinyGoSourceForWasi(sourceRoot)

  const localBackendSource = await readFile(new URL('../internal/tinygobackend/backend.go', import.meta.url), 'utf8')
  const copiedBackendSource = await readFile(path.join(staleBridgeDir, 'backend.go'), 'utf8')
  assert.equal(copiedBackendSource, localBackendSource)
})

test('build-tinygo-compiler refreshes a stale backend bridge copy before compiling', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-compiler-refresh-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const sourceRoot = path.join(tempDir, 'tinygo')
  const mainDir = path.join(sourceRoot, 'cmd', 'tinygo-wasi')
  const staleBridgeDir = path.join(sourceRoot, 'wasmbridge', 'tinygobackend')
  await mkdir(mainDir, { recursive: true })
  await mkdir(staleBridgeDir, { recursive: true })
  await writeFile(
    path.join(sourceRoot, 'go.mod'),
    `module github.com/tinygo-org/tinygo

go 1.22
`,
  )
  await writeFile(
    path.join(mainDir, 'main.go'),
    `package main

func main() {
  println("tinygo-wasi-ok")
}
`,
  )
  await writeFile(path.join(staleBridgeDir, 'backend.go'), 'package tinygobackend\n\nconst stale = true\n')

  const outputPath = path.join(tempDir, 'tinygo-compiler.wasm')
  const manifestPath = path.join(tempDir, 'tinygo-compiler.json')
  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/build-tinygo-compiler.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_SOURCE_ROOT: sourceRoot,
      WASM_TINYGO_COMPILER_MAIN_PATH: 'cmd/tinygo-wasi',
      WASM_TINYGO_COMPILER_OUTPUT_PATH: outputPath,
      WASM_TINYGO_COMPILER_MANIFEST_PATH: manifestPath,
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
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.buildMode, 'direct')
  const localBackendSource = await readFile(new URL('../internal/tinygobackend/backend.go', import.meta.url), 'utf8')
  const copiedBackendSource = await readFile(path.join(staleBridgeDir, 'backend.go'), 'utf8')
  assert.equal(copiedBackendSource, localBackendSource)
})

test('build-tinygo-compiler refreshes a stale tinygo-wasi probe entry before direct compilation', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-compiler-entry-refresh-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const sourceRoot = path.join(tempDir, 'tinygo')
  const mainDir = path.join(sourceRoot, 'cmd', 'tinygo-wasi')
  await mkdir(mainDir, { recursive: true })
  await writeFile(
    path.join(sourceRoot, 'go.mod'),
    `module github.com/tinygo-org/tinygo

go 1.22
`,
  )
  await writeFile(
    path.join(mainDir, 'main.go'),
    `package main

func main() {
  println("stale-tinygo-wasi-entry")
}
`,
  )

  const outputPath = path.join(tempDir, 'tinygo-compiler.wasm')
  const manifestPath = path.join(tempDir, 'tinygo-compiler.json')
  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/build-tinygo-compiler.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_SOURCE_ROOT: sourceRoot,
      WASM_TINYGO_COMPILER_MAIN_PATH: 'cmd/tinygo-wasi',
      WASM_TINYGO_COMPILER_OUTPUT_PATH: outputPath,
      WASM_TINYGO_COMPILER_MANIFEST_PATH: manifestPath,
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
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.buildMode, 'direct')
  const refreshedEntrySource = await readFile(path.join(mainDir, 'main.go'), 'utf8')
  assert.doesNotMatch(refreshedEntrySource, /stale-tinygo-wasi-entry/)
  assert.match(refreshedEntrySource, /wasmbridge\/tinygofrontend/)
  assert.match(refreshedEntrySource, /ExecuteAdapterPaths/)
})

test('build-tinygo-compiler retries the original main package after wasi patching before using a custom browser entry', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-compiler-patched-direct-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const sourceRoot = path.join(tempDir, 'tinygo')
  await mkdir(path.join(sourceRoot, 'builder'), { recursive: true })
  await mkdir(path.join(sourceRoot, 'compileopts'), { recursive: true })
  await mkdir(path.join(sourceRoot, 'goenv'), { recursive: true })
  await mkdir(path.join(sourceRoot, 'loader'), { recursive: true })
  await writeFile(
    path.join(sourceRoot, 'go.mod'),
    `module github.com/tinygo-org/tinygo

go 1.22
`,
  )
  await writeFile(
    path.join(sourceRoot, 'main.go'),
    `package main

import (
\t"github.com/tinygo-org/tinygo/builder"
\t"github.com/tinygo-org/tinygo/compileopts"
\t"github.com/tinygo-org/tinygo/goenv"
)

func main() {
\t_, _ = builder.NewConfig(&compileopts.Options{})
\tprintln(goenv.HostGOOS())
}
`,
  )
  await writeFile(
    path.join(sourceRoot, 'compileopts', 'compileopts.go'),
    `package compileopts

type Options struct{}

type Config struct {
\tOptions *Options
}
`,
  )
  await writeFile(
    path.join(sourceRoot, 'goenv', 'goenv.go'),
    `package goenv

import (
\t"os"
\t"runtime"
\t"strings"
\t"sync"

\t"tinygo.org/x/go-llvm"
)

var goEnvVars struct {
\tGOPATH    string
\tGOROOT    string
\tGOVERSION string
}

var goEnvVarsOnce sync.Once

func readGoEnvVars() error {
\tgoEnvVarsOnce.Do(func() {
\t\tgoEnvVars.GOVERSION = "go1.24.0"
\t})
\treturn nil
}

func HostGOOS() string {
\treturn runtime.GOOS + os.Getenv("GOOS") + strings.Split(llvm.Version, ".")[0]
}
`,
  )
  await writeFile(
    path.join(sourceRoot, 'loader', 'loader.go'),
    `package loader

import "github.com/tinygo-org/tinygo/cgo"

var _ = cgo.Process

func Load() {}
`,
  )
  await writeFile(
    path.join(sourceRoot, 'builder', 'build.go'),
    `package builder

import (
\t"github.com/gofrs/flock"
\t"github.com/tinygo-org/tinygo/compileopts"
\t"github.com/tinygo-org/tinygo/loader"
)

func NewConfig(options *compileopts.Options) (*compileopts.Config, error) {
\tloader.Load()
\tlock := flock.New("tinygo.lock")
\t_ = lock
\treturn &compileopts.Config{Options: options}, nil
}
`,
  )

  const outputPath = path.join(tempDir, 'tinygo-compiler.wasm')
  const manifestPath = path.join(tempDir, 'tinygo-compiler.json')
  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/build-tinygo-compiler.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_SOURCE_ROOT: sourceRoot,
      WASM_TINYGO_COMPILER_MAIN_PATH: '.',
      WASM_TINYGO_COMPILER_OUTPUT_PATH: outputPath,
      WASM_TINYGO_COMPILER_MANIFEST_PATH: manifestPath,
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
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.buildMode, 'patched-upstream-direct')
  assert.equal(manifest.artifactKind, 'compiler')
  assert.equal(manifest.patchedDirectFailureReason, null)
  assert.ok(Array.isArray(manifest.blockers))
  assert.ok(manifest.blockers.includes('flock'))
  assert.ok(manifest.blockers.includes('go-llvm'))
  assert.ok(manifest.blockers.includes('tinygo-cgo'))
})

test('build-tinygo-compiler keeps a patched browser entry distinct from a real compiler build', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-compiler-browser-fallback-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const sourceRoot = path.join(tempDir, 'tinygo')
  await mkdir(path.join(sourceRoot, 'builder'), { recursive: true })
  await mkdir(path.join(sourceRoot, 'compileopts'), { recursive: true })
  await mkdir(path.join(sourceRoot, 'loader'), { recursive: true })
  await writeFile(
    path.join(sourceRoot, 'go.mod'),
    `module github.com/tinygo-org/tinygo

go 1.22
`,
  )
  await writeFile(
    path.join(sourceRoot, 'main.go'),
    `package main

import _ "go.bug.st/serial"

func main() {}
`,
  )
  await writeFile(
    path.join(sourceRoot, 'compileopts', 'compileopts.go'),
    `package compileopts

import "time"

type TestConfig struct{}

type Options struct {
	GOOS            string
	GOARCH          string
	GOARM           string
	GOMIPS          string
	Target          string
	BuildMode       string
	StackSize       uint64
	Opt             string
	GC              string
	PanicStrategy   string
	Scheduler       string
	Serial          string
	Work            bool
	InterpTimeout   time.Duration
	PrintIR         bool
	DumpSSA         bool
	VerifyIR        bool
	SkipDWARF       bool
	Semaphore       chan struct{}
	Debug           bool
	Nobounds        bool
	PrintSizes      string
	PrintStacks     bool
	Tags            []string
	TestConfig      TestConfig
	GlobalValues    map[string]map[string]string
	Programmer      string
	OpenOCDCommands []string
	LLVMFeatures    string
	Monitor         bool
	BaudRate        int
	Timeout         time.Duration
	WITPackage      string
	WITWorld        string
	GoCompatibility bool
	PrintCommands   func(string, ...string)
}

type Config struct {
	Options *Options
}

func (o *Options) Verify() error {
	return nil
}

func (c *Config) DefaultBinaryExtension() string {
	return ".wasm"
}
`,
  )
  await writeFile(
    path.join(sourceRoot, 'loader', 'loader.go'),
    `package loader

import "github.com/tinygo-org/tinygo/cgo"

var _ = cgo.Process

func Load() {}
`,
  )
  await writeFile(
    path.join(sourceRoot, 'builder', 'build.go'),
    `package builder

import (
	"github.com/gofrs/flock"
	"github.com/tinygo-org/tinygo/compileopts"
	"github.com/tinygo-org/tinygo/loader"
)

type BuildResult struct {
	Binary  string
	MainDir string
}

func NewConfig(options *compileopts.Options) (*compileopts.Config, error) {
	return &compileopts.Config{Options: options}, nil
}

func Build(pkgName, outpath, tmpdir string, config *compileopts.Config) (BuildResult, error) {
	loader.Load()
	lock := flock.New(tmpdir + "/tinygo.lock")
	if err := lock.Lock(); err != nil {
		return BuildResult{}, err
	}
	return BuildResult{}, nil
}
`,
  )

  const outputPath = path.join(tempDir, 'tinygo-compiler.wasm')
  const manifestPath = path.join(tempDir, 'tinygo-compiler.json')
  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/build-tinygo-compiler.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_SOURCE_ROOT: sourceRoot,
      WASM_TINYGO_COMPILER_MAIN_PATH: '.',
      WASM_TINYGO_COMPILER_OUTPUT_PATH: outputPath,
      WASM_TINYGO_COMPILER_MANIFEST_PATH: manifestPath,
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
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.buildMode, 'patched-browser-entry')
  assert.equal(manifest.artifactKind, 'bootstrap')
  assert.deepEqual(manifest.blockers, ['serial'])
  assert.match(manifest.fallbackReason ?? '', /go\.bug\.st\/serial/)
})

test('build-tinygo-compiler reports go-llvm as the remaining blocker after wasi patching', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-compiler-go-llvm-frontier-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const sourceRoot = path.join(tempDir, 'tinygo')
  await mkdir(path.join(sourceRoot, 'builder'), { recursive: true })
  await mkdir(path.join(sourceRoot, 'compileopts'), { recursive: true })
  await mkdir(path.join(sourceRoot, 'loader'), { recursive: true })
  await writeFile(
    path.join(sourceRoot, 'go.mod'),
    `module github.com/tinygo-org/tinygo

go 1.22
`,
  )
  await writeFile(
    path.join(sourceRoot, 'main.go'),
    `package main

import _ "go.bug.st/serial"

func main() {}
`,
  )
  await writeFile(
    path.join(sourceRoot, 'compileopts', 'compileopts.go'),
    `package compileopts

import "time"

type TestConfig struct{}

type Options struct {
	GOOS            string
	GOARCH          string
	GOARM           string
	GOMIPS          string
	Target          string
	BuildMode       string
	StackSize       uint64
	Opt             string
	GC              string
	PanicStrategy   string
	Scheduler       string
	Serial          string
	Work            bool
	InterpTimeout   time.Duration
	PrintIR         bool
	DumpSSA         bool
	VerifyIR        bool
	SkipDWARF       bool
	Semaphore       chan struct{}
	Debug           bool
	Nobounds        bool
	PrintSizes      string
	PrintStacks     bool
	Tags            []string
	TestConfig      TestConfig
	GlobalValues    map[string]map[string]string
	Programmer      string
	OpenOCDCommands []string
	LLVMFeatures    string
	Monitor         bool
	BaudRate        int
	Timeout         time.Duration
	WITPackage      string
	WITWorld        string
	GoCompatibility bool
	PrintCommands   func(string, ...string)
}

type Config struct {
	Options *Options
}

func (o *Options) Verify() error {
	return nil
}

func (c *Config) DefaultBinaryExtension() string {
	return ".wasm"
}
`,
  )
  await writeFile(
    path.join(sourceRoot, 'loader', 'loader.go'),
    `package loader

import "github.com/tinygo-org/tinygo/cgo"

var _ = cgo.Process

func Load() {}
`,
  )
  await writeFile(
    path.join(sourceRoot, 'builder', 'build.go'),
    `package builder

import (
	"github.com/gofrs/flock"
	"github.com/tinygo-org/tinygo/compileopts"
	"github.com/tinygo-org/tinygo/loader"
	"tinygo.org/x/go-llvm"
)

var _ = llvm.Version

type BuildResult struct {
	Binary  string
	MainDir string
}

func NewConfig(options *compileopts.Options) (*compileopts.Config, error) {
	return &compileopts.Config{Options: options}, nil
}

func Build(pkgName, outpath, tmpdir string, config *compileopts.Config) (BuildResult, error) {
	loader.Load()
	lock := flock.New(tmpdir + "/tinygo.lock")
	if err := lock.Lock(); err != nil {
		return BuildResult{}, err
	}
	return BuildResult{}, nil
}
`,
  )

  const outputPath = path.join(tempDir, 'tinygo-compiler.wasm')
  const manifestPath = path.join(tempDir, 'tinygo-compiler.json')
  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/build-tinygo-compiler.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_SOURCE_ROOT: sourceRoot,
      WASM_TINYGO_COMPILER_MAIN_PATH: '.',
      WASM_TINYGO_COMPILER_OUTPUT_PATH: outputPath,
      WASM_TINYGO_COMPILER_MANIFEST_PATH: manifestPath,
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
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.buildMode, 'patched-go-llvm-frontier')
  assert.equal(manifest.artifactKind, 'bootstrap')
  assert.deepEqual(manifest.blockers, ['go-llvm'])
  assert.match(manifest.patchedEntryFailureReason ?? '', /tinygo\.org\/x\/go-llvm/)
  assert.doesNotMatch(manifest.patchedEntryFailureReason ?? '', /github\.com\/gofrs\/flock/)
  assert.doesNotMatch(manifest.patchedEntryFailureReason ?? '', /github\.com\/tinygo-org\/tinygo\/cgo/)
})

test('build-tinygo-compiler can directly build the synced tinygo wasi probe entry', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-compiler-fallback-'))
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const sourceRoot = path.join(tempDir, 'tinygo')
  await mkdir(sourceRoot, { recursive: true })
  await writeFile(
    path.join(sourceRoot, 'go.mod'),
    `module github.com/tinygo-org/tinygo

go 1.22
`,
  )

  const outputPath = path.join(tempDir, 'tinygo-compiler.wasm')
  const manifestPath = path.join(tempDir, 'tinygo-compiler.json')
  const cwd = new URL('..', import.meta.url).pathname
  const scriptPath = new URL('../scripts/build-tinygo-compiler.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      WASM_TINYGO_SOURCE_ROOT: sourceRoot,
      WASM_TINYGO_COMPILER_MAIN_PATH: 'cmd/tinygo-wasi',
      WASM_TINYGO_COMPILER_OUTPUT_PATH: outputPath,
      WASM_TINYGO_COMPILER_MANIFEST_PATH: manifestPath,
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
  const wasmBytes = await readFile(outputPath)
  assert.equal(wasmBytes[0], 0x00)
  assert.equal(wasmBytes[1], 0x61)
  assert.equal(wasmBytes[2], 0x73)
  assert.equal(wasmBytes[3], 0x6d)

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.buildMode, 'direct')
  assert.equal(manifest.artifactKind, 'compiler')
  assert.deepEqual(manifest.blockers, [])
  assert.equal(manifest.fallbackReason, null)
})

test('classifyTinyGoCompilerBlockers identifies the current upstream wasi blockers', () => {
  const blockers = classifyTinyGoCompilerBlockers(`
# go.bug.st/serial/enumerator
enumerator.go:31:9: undefined: nativeGetDetailedPortsList
# github.com/mattn/go-tty
tty_unix.go:18:15: undefined: unix.Termios
# github.com/gofrs/flock
flock_unix.go:57:20: undefined: syscall.Flock
# tinygo.org/x/go-llvm
string.go:17:9: undefined: TypeKind
llvm_dep.go:18:7: undefined: run_build_sh
# github.com/tinygo-org/tinygo/cgo
cgo/cgo.go:61:21: undefined: clangCursor
`)
  assert.deepEqual(blockers, ['serial', 'tty', 'flock', 'go-llvm', 'tinygo-cgo'])
})
