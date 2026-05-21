import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ensureTinyGoSourceReady } from './fetch-tinygo-source.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const BRIDGE_DIRECTORIES = [
  'internal/driver',
  'internal/tinygobackend',
  'internal/tinygobootstrap',
  'internal/tinygofrontend',
  'internal/tinygoplanner',
  'internal/tinygoroot',
  'internal/tinygotarget',
]

const PROBE_COMMAND_SOURCE = path.join(rootDir, 'cmd', 'go-probe', 'main.go')

const GOENV_LLVM_DEFAULT_SOURCE = `//go:build !wasip1

package goenv

import (
\t"strings"

\t"tinygo.org/x/go-llvm"
)

func llvmVersionMajor() string {
\treturn strings.Split(llvm.Version, ".")[0]
}
`

const GOENV_LLVM_WASIP1_SOURCE = `//go:build wasip1

package goenv

import "os"

func llvmVersionMajor() string {
\tif major := os.Getenv("TINYGO_LLVM_VERSION_MAJOR"); major != "" {
\t\treturn major
\t}
\treturn "20"
}
`

const BUILDER_LLVM_DEFAULT_SOURCE = `//go:build !wasip1

package builder

import (
\t"strings"

\t"tinygo.org/x/go-llvm"
)

func llvmVersionMajor() string {
\treturn strings.Split(llvm.Version, ".")[0]
}

func llvmVersion() string {
\treturn llvm.Version
}
`

const BUILDER_LLVM_WASIP1_SOURCE = `//go:build wasip1

package builder

import "os"

func llvmVersionMajor() string {
\tif major := os.Getenv("TINYGO_LLVM_VERSION_MAJOR"); major != "" {
\t\treturn major
\t}
\treturn "20"
}

func llvmVersion() string {
\tif version := os.Getenv("TINYGO_LLVM_VERSION"); version != "" {
\t\treturn version
\t}
\treturn "20.0.0"
}
`

const readModulePath = async (sourceRoot) => {
  const goMod = await readFile(path.join(sourceRoot, 'go.mod'), 'utf8')
  const matched = goMod.match(/^module\s+(.+)$/m)
  if (!matched) {
    throw new Error(`TinyGo source at ${sourceRoot} is missing a module declaration`)
  }
  return matched[1].trim()
}

const rewriteImports = (source, modulePath) =>
  source.replaceAll('"wasm-tinygo/internal/', `"${modulePath}/wasmbridge/`)

export const syncTinyGoBridgeSources = async (sourceRoot) => {
  const modulePath = await readModulePath(sourceRoot)
  const bridgeRoot = path.join(sourceRoot, 'wasmbridge')
  await mkdir(bridgeRoot, { recursive: true })
  const probeCommandDir = path.join(sourceRoot, 'cmd', 'tinygo-wasi')

  const copiedFiles = []
  for (const directory of BRIDGE_DIRECTORIES) {
    const sourceDir = path.join(rootDir, directory)
    const targetDir = path.join(bridgeRoot, directory.replace(/^internal\//, ''))
    await cp(sourceDir, targetDir, { recursive: true, force: true })
  }

  for (const directory of BRIDGE_DIRECTORIES) {
    const targetDir = path.join(bridgeRoot, directory.replace(/^internal\//, ''))
    const stack = [targetDir]
    while (stack.length > 0) {
      const currentDir = stack.pop()
      const names = await readdir(currentDir, { withFileTypes: true })
      for (const entry of names) {
        const entryPath = path.join(currentDir, entry.name)
        if (entry.isDirectory()) {
          stack.push(entryPath)
          continue
        }
        if (!entry.isFile() || !entry.name.endsWith('.go')) {
          continue
        }
        const contents = await readFile(entryPath, 'utf8')
        await writeFile(entryPath, rewriteImports(contents, modulePath))
        copiedFiles.push(entryPath)
      }
    }
  }

  await mkdir(probeCommandDir, { recursive: true })
  const probeCommandSource = await readFile(PROBE_COMMAND_SOURCE, 'utf8')
  const probeCommandPath = path.join(probeCommandDir, 'main.go')
  await writeFile(probeCommandPath, rewriteImports(probeCommandSource, modulePath))
  copiedFiles.push(probeCommandPath)

  return {
    copiedFileCount: copiedFiles.length,
    modulePath,
    sourceRoot,
  }
}

const patchGoenvForWasi = async (sourceRoot) => {
  const goenvPath = path.join(sourceRoot, 'goenv', 'goenv.go')
  let original
  try {
    original = await readFile(goenvPath, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return 0
    }
    throw error
  }
  const withoutLLVMImport = original.replace('\n\t"tinygo.org/x/go-llvm"', '')
  if (withoutLLVMImport === original) {
    return 0
  }
  let patched = withoutLLVMImport.replaceAll('strings.Split(llvm.Version, ".")[0]', 'llvmVersionMajor()')
  if (patched === withoutLLVMImport) {
    throw new Error('failed to patch TinyGo goenv.go: llvm version lookup not found')
  }
  if (!patched.includes('strings.')) {
    patched = patched
      .replace('\n\t"strings"', '')
      .replace('import "strings"\n', '')
      .replace(/import \(\n\s*\)/m, '')
  }
  const goEnvGuardTarget = 'goEnvVarsOnce.Do(func() {'
  if (patched.includes(goEnvGuardTarget)) {
    patched = patched.replace(
      goEnvGuardTarget,
      `${goEnvGuardTarget}
\t\tif runtime.GOOS == "wasip1" {
\t\t\tgoEnvVars.GOPATH = os.Getenv("GOPATH")
\t\t\tgoEnvVars.GOROOT = os.Getenv("GOROOT")
\t\t\tgoEnvVars.GOVERSION = os.Getenv("GOVERSION")
\t\t\tif goEnvVars.GOVERSION == "" {
\t\t\t\tgoEnvVars.GOVERSION = "go1.24.0"
\t\t\t}
\t\t\treturn
\t\t}`,
    )
  }
  await writeFile(goenvPath, patched)
  await writeFile(path.join(sourceRoot, 'goenv', 'llvm_version_default.go'), GOENV_LLVM_DEFAULT_SOURCE)
  await writeFile(path.join(sourceRoot, 'goenv', 'llvm_version_wasip1.go'), GOENV_LLVM_WASIP1_SOURCE)
  return 3
}

const patchBuilderLLVMVersionForWasi = async (sourceRoot) => {
  const builderDir = path.join(sourceRoot, 'builder')
  let patchedFiles = 0
  for (const fileName of ['commands.go', 'cc.go']) {
    const filePath = path.join(builderDir, fileName)
    let original
    try {
      original = await readFile(filePath, 'utf8')
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        continue
      }
      throw error
    }
    const withoutLLVMImport = original
      .replace('\n\t"tinygo.org/x/go-llvm"', '')
      .replace('import "tinygo.org/x/go-llvm"\n', '')
    let patched = withoutLLVMImport
      .replaceAll('strings.Split(llvm.Version, ".")[0]', 'llvmVersionMajor()')
      .replaceAll('llvm.Version', 'llvmVersion()')
    if (!patched.includes('strings.')) {
      patched = patched
        .replace('\n\t"strings"', '')
        .replace('import "strings"\n', '')
        .replace(/import \(\n\s*\)/m, '')
    }
    if (patched === original) {
      continue
    }
    await writeFile(filePath, patched)
    patchedFiles += 1
  }
  if (patchedFiles === 0) {
    return 0
  }
  await writeFile(path.join(builderDir, 'llvm_version_default.go'), BUILDER_LLVM_DEFAULT_SOURCE)
  await writeFile(path.join(builderDir, 'llvm_version_wasip1.go'), BUILDER_LLVM_WASIP1_SOURCE)
  return patchedFiles + 2
}

export const patchTinyGoSourceForWasi = async (sourceRoot) => {
  const { copiedFileCount, modulePath } = await syncTinyGoBridgeSources(sourceRoot)
  const bridgeRoot = path.join(sourceRoot, 'wasmbridge')

  const flockStubDir = path.join(bridgeRoot, 'flock')
  await mkdir(flockStubDir, { recursive: true })
  await writeFile(
    path.join(flockStubDir, 'flock.go'),
    `package flock

type Flock struct{}

func New(string) *Flock {
	return &Flock{}
}

func (f *Flock) Lock() error {
	return nil
}

func (f *Flock) Close() error {
	return nil
}
`,
  )
  const cgoStubDir = path.join(bridgeRoot, 'cgo')
  await mkdir(cgoStubDir, { recursive: true })
  await writeFile(
    path.join(cgoStubDir, 'cgo.go'),
    `package cgo

import (
	"errors"
	"go/ast"
	"go/token"
)

func Process(files []*ast.File, dir, importPath string, fset *token.FileSet, cflags []string, goos string) ([]*ast.File, []string, []string, []string, map[string][]byte, []error) {
	if len(files) != 0 {
		return nil, nil, nil, nil, nil, []error{errors.New("tinygo wasm compiler patch does not support CGo packages")}
	}
	return nil, nil, nil, nil, nil, nil
}
`,
  )

  const builderBuildPath = path.join(sourceRoot, 'builder', 'build.go')
  let patchedBuilderFiles = 0
  try {
    const builderBuildSource = await readFile(builderBuildPath, 'utf8')
    if (builderBuildSource.includes('"github.com/gofrs/flock"')) {
      await writeFile(
        builderBuildPath,
        builderBuildSource.replaceAll('"github.com/gofrs/flock"', `"${modulePath}/wasmbridge/flock"`),
      )
      patchedBuilderFiles += 1
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      patchedBuilderFiles = 0
    } else {
      throw error
    }
  }
  const loaderPath = path.join(sourceRoot, 'loader', 'loader.go')
  let patchedLoaderFiles = 0
  try {
    const loaderSource = await readFile(loaderPath, 'utf8')
    if (loaderSource.includes('"github.com/tinygo-org/tinygo/cgo"')) {
      await writeFile(loaderPath, loaderSource.replaceAll('"github.com/tinygo-org/tinygo/cgo"', `"${modulePath}/wasmbridge/cgo"`))
      patchedLoaderFiles += 1
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      patchedLoaderFiles = 0
    } else {
      throw error
    }
  }
  const patchedGoenvFiles = await patchGoenvForWasi(sourceRoot)
  const patchedBuilderLLVMFiles = await patchBuilderLLVMVersionForWasi(sourceRoot)

  const browserCommandDir = path.join(sourceRoot, 'cmd', 'tinygo-browser')
  await mkdir(browserCommandDir, { recursive: true })
  await writeFile(
    path.join(browserCommandDir, 'main.go'),
    `package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"${modulePath}/builder"
	"${modulePath}/compileopts"
)

func copyFile(src, dst string) error {
	source, err := os.Open(src)
	if err != nil {
		return err
	}
	defer source.Close()

	st, err := source.Stat()
	if err != nil {
		return err
	}

	destination, err := os.OpenFile(dst, os.O_RDWR|os.O_CREATE|os.O_TRUNC, st.Mode())
	if err != nil {
		return err
	}
	defer destination.Close()

	_, err = io.Copy(destination, source)
	return err
}

func buildPackage(pkgName, outpath string, config *compileopts.Config) error {
	tmpdir, err := os.MkdirTemp("", "tinygo-browser")
	if err != nil {
		return err
	}
	if !config.Options.Work {
		defer os.RemoveAll(tmpdir)
	}

	result, err := builder.Build(pkgName, outpath, tmpdir, config)
	if err != nil {
		return err
	}

	if result.Binary == "" {
		return nil
	}

	if outpath == "" {
		if strings.HasSuffix(pkgName, ".go") {
			outpath = filepath.Base(pkgName[:len(pkgName)-3]) + config.DefaultBinaryExtension()
		} else {
			outpath = filepath.Base(result.MainDir) + config.DefaultBinaryExtension()
		}
	}

	if err := os.Rename(result.Binary, outpath); err != nil {
		return copyFile(result.Binary, outpath)
	}

	return nil
}

func printCommand(cmd string, args ...string) {
	command := append([]string{cmd}, args...)
	for i, arg := range command {
		const specialChars = "~\`#$&*()\\\\|[]{};'\\\"<>?! "
		if strings.ContainsAny(arg, specialChars) {
			command[i] = "'" + strings.ReplaceAll(arg, "'", "'\\\\''") + "'"
		}
	}
	fmt.Fprintln(os.Stderr, strings.Join(command, " "))
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: tinygo-browser build [flags] [package]")
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(1)
	}

	command := os.Args[1]
	if command != "build" {
		fmt.Fprintf(os.Stderr, "unsupported tinygo-browser command %q\\n", command)
		usage()
		os.Exit(1)
	}

	flags := flag.NewFlagSet("build", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)

	opt := flags.String("opt", "z", "optimization level")
	gc := flags.String("gc", "", "garbage collector")
	panicStrategy := flags.String("panic", "print", "panic strategy")
	scheduler := flags.String("scheduler", "", "scheduler")
	serial := flags.String("serial", "", "serial mode")
	work := flags.Bool("work", false, "keep the temporary work directory")
	interpTimeout := flags.Duration("interp-timeout", 180*time.Second, "interp optimization pass timeout")
	tagsValue := flags.String("tags", "", "space-separated build tags")
	target := flags.String("target", "", "target name")
	buildMode := flags.String("buildmode", "", "build mode")
	parallelism := flags.Int("p", runtime.GOMAXPROCS(0), "parallel build jobs")
	nodebug := flags.Bool("no-debug", false, "strip debug information")
	nobounds := flags.Bool("nobounds", false, "disable bounds checks")
	programmer := flags.String("programmer", "", "programmer name")
	llvmFeatures := flags.String("llvm-features", "", "comma separated LLVM features")
	printCommands := flags.Bool("x", false, "print commands")
	gocompatibility := flags.Bool("go-compatibility", true, "enable Go compatibility checks")
	outpath := flags.String("o", "", "output path")

	if err := flags.Parse(os.Args[2:]); err != nil {
		os.Exit(1)
	}

	pkgName := "."
	if flags.NArg() == 1 {
		pkgName = filepath.ToSlash(flags.Arg(0))
	} else if flags.NArg() > 1 {
		fmt.Fprintln(os.Stderr, "build only accepts a single positional argument")
		usage()
		os.Exit(1)
	}

	queueSize := *parallelism
	if queueSize < 1 {
		queueSize = 1
	}

	options := &compileopts.Options{
		GOOS:            os.Getenv("GOOS"),
		GOARCH:          os.Getenv("GOARCH"),
		GOARM:           os.Getenv("GOARM"),
		GOMIPS:          os.Getenv("GOMIPS"),
		Target:          *target,
		BuildMode:       *buildMode,
		Opt:             *opt,
		GC:              *gc,
		PanicStrategy:   *panicStrategy,
		Scheduler:       *scheduler,
		Serial:          *serial,
		Work:            *work,
		InterpTimeout:   *interpTimeout,
		Semaphore:       make(chan struct{}, queueSize),
		Debug:           !*nodebug,
		Nobounds:        *nobounds,
		Tags:            strings.Fields(*tagsValue),
		Programmer:      *programmer,
		LLVMFeatures:    *llvmFeatures,
		GoCompatibility: *gocompatibility,
	}
	if *printCommands {
		options.PrintCommands = printCommand
	}

	if err := options.Verify(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	if filepath.Ext(*outpath) == ".wasm" && options.GOARCH != "wasm" && options.Target == "" {
		fmt.Fprintln(os.Stderr, "you appear to want to build a wasm file, but have not specified either a target flag, or the GOARCH/GOOS to use.")
		os.Exit(1)
	}

	config, err := builder.NewConfig(options)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	if err := buildPackage(pkgName, *outpath, config); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
`,
  )

  const commandDir = path.join(sourceRoot, 'cmd', 'tinygo-wasi')
  await mkdir(commandDir, { recursive: true })
  const commandSource = await readFile(PROBE_COMMAND_SOURCE, 'utf8')
  await writeFile(path.join(commandDir, 'main.go'), rewriteImports(commandSource, modulePath))

  return {
    commandPath: './cmd/tinygo-browser',
    probeCommandPath: './cmd/tinygo-wasi',
    copiedFileCount:
      copiedFileCount + patchedBuilderFiles + patchedLoaderFiles + patchedGoenvFiles + patchedBuilderLLVMFiles + 4,
    modulePath,
    sourceRoot,
  }
}

const run = async () => {
  const source = await ensureTinyGoSourceReady()
  const result = await patchTinyGoSourceForWasi(source.rootPath)
  console.log(`Patched TinyGo source for WASI at ${result.sourceRoot}`)
  console.log(`tinygo browser command: ${result.commandPath}`)
  console.log(`tinygo probe command: ${result.probeCommandPath}`)
  console.log(`copied files: ${result.copiedFileCount}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await run()
}
