import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ensureTinyGoSourceReady } from './fetch-tinygo-source.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const goenvLLVMDefaultSource = `//go:build !wasip1

package goenv

import (
\t"strings"

\t"tinygo.org/x/go-llvm"
)

func llvmVersionMajor() string {
\treturn strings.Split(llvm.Version, ".")[0]
}
`

const goenvLLVMWasip1Source = `//go:build wasip1

package goenv

import "os"

func llvmVersionMajor() string {
\tif major := os.Getenv("TINYGO_LLVM_VERSION_MAJOR"); major != "" {
\t\treturn major
\t}
\treturn "20"
}
`

const tinyGoWasiProbeMainSource = `package main

import (
\t"encoding/json"
\t"fmt"
\t"os"

\t"github.com/tinygo-org/tinygo/compileopts"
)

type probeResult struct {
\tRequestedTarget string   \`json:"requestedTarget"\`
\tResolvedGOOS    string   \`json:"resolvedGoos"\`
\tResolvedGOARCH  string   \`json:"resolvedGoarch"\`
\tTriple          string   \`json:"triple"\`
\tBuildTags       []string \`json:"buildTags"\`
\tGC              string   \`json:"gc"\`
\tScheduler       string   \`json:"scheduler"\`
\tLinker          string   \`json:"linker"\`
}

func main() {
\ttargetName := os.Getenv("TINYGO_WASI_TARGET")
\tif targetName == "" {
\t\ttargetName = "wasip1"
\t}

\toptions := &compileopts.Options{
\t\tTarget: targetName,
\t\tGOOS:   "wasip1",
\t\tGOARCH: "wasm",
\t\tOpt:    "z",
\t}
\tif err := options.Verify(); err != nil {
\t\tfmt.Fprintln(os.Stderr, err)
\t\tos.Exit(1)
\t}

\ttarget, err := compileopts.LoadTarget(options)
\tif err != nil {
\t\tfmt.Fprintln(os.Stderr, err)
\t\tos.Exit(1)
\t}

\tconfig := &compileopts.Config{
\t\tOptions: options,
\t\tTarget:  target,
\t}

\tpayload := probeResult{
\t\tRequestedTarget: targetName,
\t\tResolvedGOOS:    config.GOOS(),
\t\tResolvedGOARCH:  config.GOARCH(),
\t\tTriple:          config.Triple(),
\t\tBuildTags:       config.BuildTags(),
\t\tGC:              config.GC(),
\t\tScheduler:       config.Scheduler(),
\t\tLinker:          target.Linker,
\t}

\tencoder := json.NewEncoder(os.Stdout)
\tencoder.SetIndent("", "  ")
\tif err := encoder.Encode(payload); err != nil {
\t\tfmt.Fprintln(os.Stderr, err)
\t\tos.Exit(1)
\t}
}
`

const tinyGoWasiFrontendProbeMainSource = `package main

import (
\t"encoding/json"
\t"fmt"
\t"go/types"
\t"os"

\t"github.com/tinygo-org/tinygo/compileopts"
\t"github.com/tinygo-org/tinygo/loader"
)

type frontendProbePackage struct {
\tImportPath string   \`json:"importPath"\`
\tName       string   \`json:"name"\`
\tFileCount  int      \`json:"fileCount"\`
\tImports    []string \`json:"imports"\`
}

type frontendProbeResult struct {
\tRequestedTarget  string   \`json:"requestedTarget"\`
\tMainImportPath   string   \`json:"mainImportPath"\`
\tMainPackageName  string   \`json:"mainPackageName"\`
\tPackageCount     int      \`json:"packageCount"\`
\tFileCount        int      \`json:"fileCount"\`
\tDeclarationCount int      \`json:"declarationCount"\`
\tImports          []string \`json:"imports"\`
\tPackages         []frontendProbePackage \`json:"packages"\`
}

func main() {
\ttargetName := os.Getenv("TINYGO_WASI_TARGET")
\tif targetName == "" {
\t\ttargetName = "wasip1"
\t}
\tpackageJSONPath := os.Getenv("TINYGO_WASI_PACKAGE_JSON_PATH")
\tif packageJSONPath == "" {
\t\tfmt.Fprintln(os.Stderr, "missing TINYGO_WASI_PACKAGE_JSON_PATH")
\t\tos.Exit(1)
\t}
\tworkingDir := os.Getenv("TINYGO_WASI_WORKING_DIR")
\tif workingDir == "" {
\t\tworkingDir = "/workspace"
\t}

\toptions := &compileopts.Options{
\t\tTarget: targetName,
\t\tGOOS:   "wasip1",
\t\tGOARCH: "wasm",
\t\tOpt:    "z",
\t}
\tif err := options.Verify(); err != nil {
\t\tfmt.Fprintln(os.Stderr, err)
\t\tos.Exit(1)
\t}

\ttarget, err := compileopts.LoadTarget(options)
\tif err != nil {
\t\tfmt.Fprintln(os.Stderr, err)
\t\tos.Exit(1)
\t}
\tconfig := &compileopts.Config{
\t\tOptions:        options,
\t\tTarget:         target,
\t\tGoMinorVersion: 24,
\t}

\tpackageJSONBytes, err := os.ReadFile(packageJSONPath)
\tif err != nil {
\t\tfmt.Fprintln(os.Stderr, err)
\t\tos.Exit(1)
\t}
\tvar packages []loader.PackageJSON
\tif err := json.Unmarshal(packageJSONBytes, &packages); err != nil {
\t\tfmt.Fprintln(os.Stderr, err)
\t\tos.Exit(1)
\t}

\tprogram, err := loader.LoadFromPackageJSON(config, packages, types.Config{
\t\tSizes: types.SizesFor("gc", "wasm"),
\t}, workingDir)
\tif err != nil {
\t\tfmt.Fprintln(os.Stderr, err)
\t\tos.Exit(1)
\t}
\tif err := program.Parse(); err != nil {
\t\tfmt.Fprintln(os.Stderr, err)
\t\tos.Exit(1)
\t}

\tmainPkg := program.MainPkg()
\tfileCount := len(mainPkg.Files)
\tdeclarationCount := 0
\tfor _, file := range mainPkg.Files {
\t\tdeclarationCount += len(file.Decls)
\t}
\tpackagesSummary := make([]frontendProbePackage, 0, len(program.Sorted()))
\tfor _, pkg := range program.Sorted() {
\t\tpackagesSummary = append(packagesSummary, frontendProbePackage{
\t\t\tImportPath: pkg.ImportPath,
\t\t\tName:       pkg.Name,
\t\t\tFileCount:  len(pkg.Files),
\t\t\tImports:    append([]string{}, pkg.Imports...),
\t\t})
\t}

\tpayload := frontendProbeResult{
\t\tRequestedTarget:  targetName,
\t\tMainImportPath:   mainPkg.ImportPath,
\t\tMainPackageName:  mainPkg.Name,
\t\tPackageCount:     len(program.Sorted()),
\t\tFileCount:        fileCount,
\t\tDeclarationCount: declarationCount,
\t\tImports:          append([]string{}, mainPkg.Imports...),
\t\tPackages:         packagesSummary,
\t}

\tencoder := json.NewEncoder(os.Stdout)
\tencoder.SetIndent("", "  ")
\tif err := encoder.Encode(payload); err != nil {
\t\tfmt.Fprintln(os.Stderr, err)
\t\tos.Exit(1)
\t}
}
`

const cgoProcessWasip1Source = `//go:build wasip1

package cgo

import (
\t"go/ast"
\t"go/scanner"
\t"go/token"
)

func Process(files []*ast.File, dir, importPath string, fset *token.FileSet, cflags []string, goos string) ([]*ast.File, []string, []string, []string, map[string][]byte, []error) {
\tfor _, file := range files {
\t\tfor _, importSpec := range file.Imports {
\t\t\tif importSpec.Path != nil && importSpec.Path.Value == "\\"C\\"" {
\t\t\t\treturn nil, nil, nil, nil, nil, []error{
\t\t\t\t\tscanner.Error{
\t\t\t\t\t\tPos: fset.Position(importSpec.Pos()),
\t\t\t\t\t\tMsg: "cgo is not supported in TinyGo WASI frontend probe",
\t\t\t\t\t},
\t\t\t\t}
\t\t\t}
\t\t}
\t}
\treturn nil, nil, nil, nil, nil, nil
}
`

const loaderLoadFromPackageJSONWasip1Source = `//go:build wasip1

package loader

import (
\t"errors"
\t"go/ast"
\t"go/token"
\t"go/types"
\t"strings"

\t"github.com/tinygo-org/tinygo/compileopts"
\t"github.com/tinygo-org/tinygo/goenv"
)

func LoadFromPackageJSON(config *compileopts.Config, packages []PackageJSON, typeChecker types.Config, workingDir string) (*Program, error) {
\tif len(packages) == 0 {
\t\treturn nil, errors.New("no package JSON supplied")
\t}
\tif workingDir == "" {
\t\tworkingDir = packages[len(packages)-1].Dir
\t}
\tp := &Program{
\t\tconfig:      config,
\t\ttypeChecker: typeChecker,
\t\tgoroot:      goenv.Get("TINYGOROOT"),
\t\tworkingDir:  workingDir,
\t\tPackages:    make(map[string]*Package),
\t\tfset:        token.NewFileSet(),
\t}

\tfor _, packageJSON := range packages {
\t\tpkg := &Package{
\t\t\tPackageJSON: packageJSON,
\t\t\tprogram:     p,
\t\t\tFileHashes:  make(map[string][]byte),
\t\t\tEmbedGlobals: make(map[string][]*EmbedFile),
\t\t\tinfo: types.Info{
\t\t\t\tTypes:      make(map[ast.Expr]types.TypeAndValue),
\t\t\t\tInstances:  make(map[*ast.Ident]types.Instance),
\t\t\t\tDefs:       make(map[*ast.Ident]types.Object),
\t\t\t\tUses:       make(map[*ast.Ident]types.Object),
\t\t\t\tImplicits:  make(map[ast.Node]types.Object),
\t\t\t\tScopes:     make(map[ast.Node]*types.Scope),
\t\t\t\tSelections: make(map[*ast.SelectorExpr]*types.Selection),
\t\t\t},
\t\t}
\t\tif config.TestConfig.CompileTestBinary {
\t\t\tif pkg.ForTest != "" && strings.HasSuffix(pkg.ImportPath, " ["+pkg.ForTest+".test]") {
\t\t\t\tnewImportPath := pkg.ImportPath[:len(pkg.ImportPath)-len(" ["+pkg.ForTest+".test]")]
\t\t\t\tif _, ok := p.Packages[newImportPath]; ok {
\t\t\t\t\tdelete(p.Packages, newImportPath)
\t\t\t\t\tfor i, sortedPkg := range p.sorted {
\t\t\t\t\t\tif sortedPkg.ImportPath == newImportPath {
\t\t\t\t\t\t\tp.sorted = append(p.sorted[:i], p.sorted[i+1:]...)
\t\t\t\t\t\t\tbreak
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t}
\t\t\t\tpkg.ImportPath = newImportPath
\t\t\t}
\t\t}
\t\tp.sorted = append(p.sorted, pkg)
\t\tp.Packages[pkg.ImportPath] = pkg
\t}

\tif config.TestConfig.CompileTestBinary && !strings.HasSuffix(p.sorted[len(p.sorted)-1].ImportPath, ".test") {
\t\treturn p, NoTestFilesError{p.sorted[len(p.sorted)-1].ImportPath}
\t}

\treturn p, nil
}
`

const patchGoenv = async (patchedRoot) => {
  const goenvPath = path.join(patchedRoot, 'goenv', 'goenv.go')
  const original = await readFile(goenvPath, 'utf8')
  let patched = original
  if (patched.includes('\n\t"tinygo.org/x/go-llvm"')) {
    patched = patched.replace('\n\t"tinygo.org/x/go-llvm"', '')
  }
  if (patched.includes('strings.Split(llvm.Version, ".")[0]')) {
    patched = patched.replaceAll('strings.Split(llvm.Version, ".")[0]', 'llvmVersionMajor()')
  } else if (!patched.includes('llvmVersionMajor()')) {
    throw new Error('failed to patch TinyGo goenv.go: llvm version lookup not found')
  }
  const goEnvGuardTarget = 'goEnvVarsOnce.Do(func() {'
  if (!patched.includes(goEnvGuardTarget)) {
    throw new Error('failed to patch TinyGo goenv.go: go env guard target not found')
  }
  if (!patched.includes('if runtime.GOOS == "wasip1" {')) {
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
  await writeFile(path.join(patchedRoot, 'goenv', 'llvm_version_default.go'), goenvLLVMDefaultSource)
  await writeFile(path.join(patchedRoot, 'goenv', 'llvm_version_wasip1.go'), goenvLLVMWasip1Source)
}

const patchCgoForWasip1 = async (patchedRoot) => {
  const cgoDir = path.join(patchedRoot, 'cgo')
  const fileNames = ['cgo.go', 'cgo_go122.go', 'const.go', 'security.go', 'sync.go']
  for (const fileName of fileNames) {
    const filePath = path.join(cgoDir, fileName)
    const original = await readFile(filePath, 'utf8')
    if (original.startsWith('//go:build')) {
      const patched = original.replace(/^\/\/go:build (.+)$/m, '//go:build !wasip1 && $1')
      await writeFile(filePath, patched)
      continue
    }
    await writeFile(filePath, `//go:build !wasip1\n\n${original}`)
  }
  await writeFile(path.join(cgoDir, 'process_wasip1.go'), cgoProcessWasip1Source)
}

const patchLoaderForWasip1 = async (patchedRoot) => {
  await writeFile(path.join(patchedRoot, 'loader', 'loadjson_wasip1.go'), loaderLoadFromPackageJSONWasip1Source)
}

const writeCommand = async (patchedRoot, commandName, source) => {
  const commandDir = path.join(patchedRoot, 'cmd', commandName)
  await mkdir(commandDir, { recursive: true })
  await writeFile(path.join(commandDir, 'main.go'), source)
}

const preparePatchedSource = async ({ cacheDir, patches }) => {
  const source = await ensureTinyGoSourceReady()
  const patchedRoot = cacheDir
  const stagedRoot = `${cacheDir}.next-${process.pid}-${Date.now()}`
  const staleRoot = `${cacheDir}.stale-${process.pid}-${Date.now()}`
  await rm(stagedRoot, { recursive: true, force: true })
  await cp(source.rootPath, stagedRoot, { recursive: true })
  let movedExistingCache = false
  let swappedStagedCache = false
  try {
    for (const patch of patches) {
      await patch(stagedRoot)
    }
    try {
      await rename(patchedRoot, staleRoot)
      movedExistingCache = true
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
      }
    }
    try {
      await rename(stagedRoot, patchedRoot)
      swappedStagedCache = true
    } catch (error) {
      if (movedExistingCache) {
        await rename(staleRoot, patchedRoot).catch(() => {})
      }
      throw error
    }
  } finally {
    if (!swappedStagedCache) {
      await rm(stagedRoot, { recursive: true, force: true })
    }
    if (movedExistingCache) {
      await rm(staleRoot, { recursive: true, force: true }).catch(() => {})
    }
  }
  return {
    patchedRoot,
    sourceRef: source.sourceRef,
    sourceUrl: source.sourceUrl,
    sourceVersion: source.sourceVersion,
  }
}

export const prepareTinyGoWasiProbeSource = async () =>
  await preparePatchedSource({
    cacheDir:
      process.env.WASM_TINYGO_WASI_PROBE_SOURCE_ROOT ??
      path.join(rootDir, '.cache', 'tinygo-src-wasi-probe'),
    patches: [
      patchGoenv,
      async (patchedRoot) => {
        await writeCommand(patchedRoot, 'tinygo-wasi-probe', tinyGoWasiProbeMainSource)
      },
    ],
  })

export const prepareTinyGoWasiFrontendProbeSource = async () =>
  await preparePatchedSource({
    cacheDir:
      process.env.WASM_TINYGO_WASI_FRONTEND_PROBE_SOURCE_ROOT ??
      path.join(rootDir, '.cache', 'tinygo-src-wasi-frontend-probe'),
    patches: [
      patchGoenv,
      patchCgoForWasip1,
      patchLoaderForWasip1,
      async (patchedRoot) => {
        await writeCommand(patchedRoot, 'tinygo-wasi-frontend-probe', tinyGoWasiFrontendProbeMainSource)
      },
    ],
  })

const run = async () => {
  const result = await prepareTinyGoWasiProbeSource()
  console.log(`Prepared TinyGo WASI probe source at ${path.relative(rootDir, result.patchedRoot)}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await run()
}
