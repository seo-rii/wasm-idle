package driver

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/build/constraint"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"wasm-tinygo/internal/tinygoplanner"
	"wasm-tinygo/internal/tinygotarget"
)

type Request struct {
	Command   string `json:"command"`
	Planner   string `json:"planner,omitempty"`
	Entry     string `json:"entry"`
	Output    string `json:"output"`
	Target    string `json:"target"`
	Optimize  string `json:"optimize,omitempty"`
	Scheduler string `json:"scheduler,omitempty"`
	Panic     string `json:"panic,omitempty"`
}

type SourceFile struct {
	Path     string
	Contents []byte
}

type GeneratedFile struct {
	Path     string `json:"path"`
	Contents string `json:"contents"`
}

type ToolInvocation struct {
	Argv []string `json:"argv"`
	Cwd  string   `json:"cwd"`
}

type Metadata struct {
	Planner                string   `json:"planner"`
	LLVMTarget             string   `json:"llvmTarget"`
	GOOS                   string   `json:"goos"`
	GOARCH                 string   `json:"goarch"`
	GC                     string   `json:"gc"`
	Scheduler              string   `json:"scheduler"`
	PanicStrategy          string   `json:"panicStrategy"`
	Optimize               string   `json:"optimize"`
	BuildTags              []string `json:"buildTags"`
	ModulePath             string   `json:"modulePath,omitempty"`
	PackageFiles           []string `json:"packageFiles"`
	ImportedPackageFiles   []string `json:"importedPackageFiles"`
	Imports                []string `json:"imports"`
	StdlibImports          []string `json:"stdlibImports"`
	LocalModuleImports     []string `json:"localModuleImports"`
	WorkspaceModuleImports []string `json:"workspaceModuleImports"`
	ReplacedModuleImports  []string `json:"replacedModuleImports"`
	ExternalImports        []string `json:"externalImports"`
}

type Result struct {
	OK          bool             `json:"ok"`
	Mode        string           `json:"mode,omitempty"`
	Artifact    string           `json:"artifact,omitempty"`
	Plan        []ToolInvocation `json:"plan,omitempty"`
	Files       []GeneratedFile  `json:"files,omitempty"`
	Metadata    *Metadata        `json:"metadata,omitempty"`
	Diagnostics []string         `json:"diagnostics,omitempty"`
}

var knownFilenameGOOS = map[string]bool{
	"aix":       true,
	"android":   true,
	"darwin":    true,
	"dragonfly": true,
	"freebsd":   true,
	"hurd":      true,
	"illumos":   true,
	"ios":       true,
	"js":        true,
	"linux":     true,
	"netbsd":    true,
	"openbsd":   true,
	"plan9":     true,
	"solaris":   true,
	"wasip1":    true,
	"windows":   true,
}

var knownFilenameGOARCH = map[string]bool{
	"386":      true,
	"amd64":    true,
	"arm":      true,
	"arm64":    true,
	"loong64":  true,
	"mips":     true,
	"mips64":   true,
	"mips64le": true,
	"mipsle":   true,
	"ppc64":    true,
	"ppc64le":  true,
	"riscv64":  true,
	"s390x":    true,
	"sparc64":  true,
	"wasm":     true,
}

func parseModuleFileConfig(contents []byte) (string, map[string]string, map[string]string, error) {
	modulePath := ""
	replaceModules := map[string]string{}
	unsupportedReplaceModules := map[string]string{}
	inReplaceBlock := false
	for _, line := range strings.Split(string(contents), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "//") {
			continue
		}
		if trimmed == "replace (" {
			inReplaceBlock = true
			continue
		}
		if inReplaceBlock {
			if trimmed == ")" {
				inReplaceBlock = false
				continue
			}
			fields := strings.Fields(trimmed)
			arrow := -1
			for index, field := range fields {
				if field == "=>" {
					arrow = index
					break
				}
			}
			if arrow >= 1 && arrow+1 < len(fields) {
				newPath := strings.Trim(fields[arrow+1], "\"`")
				if strings.HasPrefix(newPath, ".") || filepath.IsAbs(newPath) {
					replaceModules[fields[0]] = newPath
				} else {
					unsupportedReplaceModules[fields[0]] = newPath
				}
			}
			continue
		}
		if strings.HasPrefix(trimmed, "module ") {
			fields := strings.Fields(trimmed)
			if len(fields) < 2 {
				return "", nil, nil, fmt.Errorf("invalid module directive")
			}
			modulePath = strings.Trim(fields[1], "\"`")
			continue
		}
		if !strings.HasPrefix(trimmed, "replace ") {
			continue
		}
		fields := strings.Fields(strings.TrimPrefix(trimmed, "replace "))
		arrow := -1
		for index, field := range fields {
			if field == "=>" {
				arrow = index
				break
			}
		}
		if arrow < 1 || arrow+1 >= len(fields) {
			return "", nil, nil, fmt.Errorf("invalid replace directive")
		}
		newPath := strings.Trim(fields[arrow+1], "\"`")
		if strings.HasPrefix(newPath, ".") || filepath.IsAbs(newPath) {
			replaceModules[fields[0]] = newPath
		} else {
			unsupportedReplaceModules[fields[0]] = newPath
		}
	}
	return modulePath, replaceModules, unsupportedReplaceModules, nil
}

func parseWorkFileConfig(contents []byte) ([]string, map[string]string, map[string]string, error) {
	usePaths := []string{}
	replaceModules := map[string]string{}
	unsupportedReplaceModules := map[string]string{}
	inUseBlock := false
	inReplaceBlock := false
	for _, line := range strings.Split(string(contents), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "//") {
			continue
		}
		if trimmed == "use (" {
			inUseBlock = true
			continue
		}
		if inUseBlock {
			if trimmed == ")" {
				inUseBlock = false
				continue
			}
			usePaths = append(usePaths, strings.Trim(trimmed, "\"`"))
			continue
		}
		if trimmed == "replace (" {
			inReplaceBlock = true
			continue
		}
		if inReplaceBlock {
			if trimmed == ")" {
				inReplaceBlock = false
				continue
			}
			fields := strings.Fields(trimmed)
			arrow := -1
			for index, field := range fields {
				if field == "=>" {
					arrow = index
					break
				}
			}
			if arrow >= 1 && arrow+1 < len(fields) {
				newPath := strings.Trim(fields[arrow+1], "\"`")
				if strings.HasPrefix(newPath, ".") || filepath.IsAbs(newPath) {
					replaceModules[fields[0]] = newPath
				} else {
					unsupportedReplaceModules[fields[0]] = newPath
				}
			}
			continue
		}
		if !strings.HasPrefix(trimmed, "use ") {
			if !strings.HasPrefix(trimmed, "replace ") {
				continue
			}
			fields := strings.Fields(strings.TrimPrefix(trimmed, "replace "))
			arrow := -1
			for index, field := range fields {
				if field == "=>" {
					arrow = index
					break
				}
			}
			if arrow >= 1 && arrow+1 < len(fields) {
				newPath := strings.Trim(fields[arrow+1], "\"`")
				if strings.HasPrefix(newPath, ".") || filepath.IsAbs(newPath) {
					replaceModules[fields[0]] = newPath
				} else {
					unsupportedReplaceModules[fields[0]] = newPath
				}
			}
			continue
		}
		usePaths = append(usePaths, strings.Trim(strings.TrimSpace(strings.TrimPrefix(trimmed, "use ")), "\"`"))
	}
	return usePaths, replaceModules, unsupportedReplaceModules, nil
}

func findUnsupportedReplaceImport(importPath string, workspaceUnsupportedReplaceModules map[string]string, unsupportedReplaceModules map[string]string) (string, bool) {
	longestPrefix := ""
	for prefix := range workspaceUnsupportedReplaceModules {
		if importPath != prefix && !strings.HasPrefix(importPath, prefix+"/") {
			continue
		}
		if len(prefix) < len(longestPrefix) {
			continue
		}
		longestPrefix = prefix
	}
	for prefix := range unsupportedReplaceModules {
		if importPath != prefix && !strings.HasPrefix(importPath, prefix+"/") {
			continue
		}
		if len(prefix) < len(longestPrefix) {
			continue
		}
		longestPrefix = prefix
	}
	return longestPrefix, longestPrefix != ""
}

func resolveImportRoot(importPath, modulePath, moduleRoot string, workspaceModules map[string]string, workspaceReplaceModules map[string]string, replaceModules map[string]string) (string, string, bool) {
	if modulePath != "" && (importPath == modulePath || strings.HasPrefix(importPath, modulePath+"/")) {
		dir := moduleRoot
		if importPath != modulePath {
			dir = filepath.Join(moduleRoot, filepath.FromSlash(strings.TrimPrefix(strings.TrimPrefix(importPath, modulePath), "/")))
		}
		return dir, "local", true
	}
	longestWorkspaceReplacePrefix := ""
	workspaceReplaceRoot := ""
	for prefix, path := range workspaceReplaceModules {
		if importPath != prefix && !strings.HasPrefix(importPath, prefix+"/") {
			continue
		}
		if len(prefix) < len(longestWorkspaceReplacePrefix) {
			continue
		}
		longestWorkspaceReplacePrefix = prefix
		workspaceReplaceRoot = path
	}
	if longestWorkspaceReplacePrefix != "" {
		dir := workspaceReplaceRoot
		if importPath != longestWorkspaceReplacePrefix {
			dir = filepath.Join(workspaceReplaceRoot, filepath.FromSlash(strings.TrimPrefix(strings.TrimPrefix(importPath, longestWorkspaceReplacePrefix), "/")))
		}
		return dir, "replace", true
	}
	longestWorkspacePrefix := ""
	workspaceRoot := ""
	for prefix, root := range workspaceModules {
		if importPath != prefix && !strings.HasPrefix(importPath, prefix+"/") {
			continue
		}
		if len(prefix) < len(longestWorkspacePrefix) {
			continue
		}
		longestWorkspacePrefix = prefix
		workspaceRoot = root
	}
	if longestWorkspacePrefix != "" {
		dir := workspaceRoot
		if importPath != longestWorkspacePrefix {
			dir = filepath.Join(workspaceRoot, filepath.FromSlash(strings.TrimPrefix(strings.TrimPrefix(importPath, longestWorkspacePrefix), "/")))
		}
		return dir, "workspace", true
	}
	longestPrefix := ""
	replaceRoot := ""
	for prefix, path := range replaceModules {
		if importPath != prefix && !strings.HasPrefix(importPath, prefix+"/") {
			continue
		}
		if len(prefix) < len(longestPrefix) {
			continue
		}
		longestPrefix = prefix
		replaceRoot = path
	}
	if longestPrefix == "" {
		return "", "", false
	}
	if !filepath.IsAbs(replaceRoot) {
		replaceRoot = filepath.Clean(filepath.Join(moduleRoot, filepath.FromSlash(replaceRoot)))
	}
	dir := replaceRoot
	if importPath != longestPrefix {
		dir = filepath.Join(replaceRoot, filepath.FromSlash(strings.TrimPrefix(strings.TrimPrefix(importPath, longestPrefix), "/")))
	}
	return dir, "replace", true
}

func Build(request Request, entrySource []byte) (Result, error) {
	return BuildPackage(request, []SourceFile{{
		Path:     request.Entry,
		Contents: entrySource,
	}})
}

func BuildPackage(request Request, files []SourceFile) (Result, error) {
	if request.Command != "build" {
		return Result{}, fmt.Errorf("unsupported command: %q", request.Command)
	}
	if request.Planner == "" {
		request.Planner = "tinygo"
	}
	if request.Planner != "bootstrap" && request.Planner != "tinygo" {
		return Result{}, fmt.Errorf("unsupported planner: %q", request.Planner)
	}
	if request.Entry == "" {
		return Result{}, fmt.Errorf("missing entry path")
	}
	if !strings.HasSuffix(request.Entry, ".go") {
		return Result{}, fmt.Errorf("entry path must point to a .go file")
	}
	if request.Target == "" {
		request.Target = "wasm"
	}
	if request.Output == "" {
		return Result{}, fmt.Errorf("missing output path")
	}
	if !strings.HasSuffix(request.Output, ".wasm") {
		return Result{}, fmt.Errorf("output path must end with .wasm")
	}

	optFlag := "-Oz"
	switch request.Optimize {
	case "", "z":
	case "0":
		optFlag = "-O0"
	case "1":
		optFlag = "-O1"
	case "2":
		optFlag = "-O2"
	case "3":
		optFlag = "-O3"
	case "s":
		optFlag = "-Os"
	default:
		return Result{}, fmt.Errorf("unsupported optimize level: %q", request.Optimize)
	}
	if request.Scheduler != "" && request.Scheduler != "none" && request.Scheduler != "tasks" && request.Scheduler != "asyncify" {
		return Result{}, fmt.Errorf("unsupported scheduler: %q", request.Scheduler)
	}
	if request.Panic != "" && request.Panic != "print" && request.Panic != "trap" {
		return Result{}, fmt.Errorf("unsupported panic strategy: %q", request.Panic)
	}
	profile, err := tinygotarget.Resolve(request.Target)
	if err != nil {
		return Result{}, err
	}
	scheduler := request.Scheduler
	if scheduler == "" {
		scheduler = profile.Scheduler
	}
	tagSet := map[string]bool{
		profile.GOOS:   true,
		profile.GOARCH: true,
		request.Target: true,
	}
	for _, tag := range profile.BuildTagsFor(scheduler) {
		tagSet[tag] = true
	}

	entryDir := filepath.Dir(request.Entry)
	modulePath := ""
	moduleRoot := ""
	replaceModules := map[string]string{}
	unsupportedReplaceModules := map[string]string{}
	workspaceRoot := ""
	workspaceUsePaths := []string{}
	workspaceReplaceModules := map[string]string{}
	workspaceUnsupportedReplaceModules := map[string]string{}
	for _, source := range files {
		if filepath.Base(source.Path) != "go.mod" {
			continue
		}
		rel, relErr := filepath.Rel(filepath.Dir(source.Path), entryDir)
		if relErr != nil {
			continue
		}
		if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		if len(filepath.Dir(source.Path)) < len(moduleRoot) {
			continue
		}
		parsedModulePath, parsedReplaceModules, parsedUnsupportedReplaceModules, parseErr := parseModuleFileConfig(source.Contents)
		if parseErr != nil {
			return Result{}, fmt.Errorf("parse module file %s: %w", source.Path, parseErr)
		}
		moduleRoot = filepath.Dir(source.Path)
		modulePath = parsedModulePath
		replaceModules = parsedReplaceModules
		unsupportedReplaceModules = parsedUnsupportedReplaceModules
	}
	for _, source := range files {
		if filepath.Base(source.Path) != "go.work" {
			continue
		}
		rel, relErr := filepath.Rel(filepath.Dir(source.Path), entryDir)
		if relErr != nil {
			continue
		}
		if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		if len(filepath.Dir(source.Path)) < len(workspaceRoot) {
			continue
		}
		parsedUsePaths, parsedWorkspaceReplaceModules, parsedWorkspaceUnsupportedReplaceModules, parseErr := parseWorkFileConfig(source.Contents)
		if parseErr != nil {
			return Result{}, fmt.Errorf("parse workspace file %s: %w", source.Path, parseErr)
		}
		workspaceRoot = filepath.Dir(source.Path)
		workspaceUsePaths = parsedUsePaths
		workspaceReplaceModules = map[string]string{}
		workspaceUnsupportedReplaceModules = parsedWorkspaceUnsupportedReplaceModules
		for prefix, path := range parsedWorkspaceReplaceModules {
			if filepath.IsAbs(path) {
				workspaceReplaceModules[prefix] = filepath.Clean(path)
			} else {
				workspaceReplaceModules[prefix] = filepath.Clean(filepath.Join(workspaceRoot, filepath.FromSlash(path)))
			}
		}
	}
	workspaceModules := map[string]string{}
	for _, usePath := range workspaceUsePaths {
		moduleDir := usePath
		if !filepath.IsAbs(moduleDir) {
			moduleDir = filepath.Clean(filepath.Join(workspaceRoot, filepath.FromSlash(usePath)))
		}
		goModPath := filepath.Join(moduleDir, "go.mod")
		for _, source := range files {
			if source.Path != goModPath {
				continue
			}
			usedModulePath, _, _, parseErr := parseModuleFileConfig(source.Contents)
			if parseErr != nil {
				return Result{}, fmt.Errorf("parse module file %s: %w", source.Path, parseErr)
			}
			if usedModulePath != "" {
				workspaceModules[usedModulePath] = moduleDir
			}
			break
		}
	}
	entryImportPath := ""
	if modulePath != "" && moduleRoot != "" {
		rel, relErr := filepath.Rel(moduleRoot, entryDir)
		if relErr == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			entryImportPath = modulePath
			if rel != "." {
				entryImportPath += "/" + filepath.ToSlash(rel)
			}
		}
	}
	packageFiles := make([]string, 0, len(files))
	importSet := map[string]struct{}{}
	stdlibImportSet := map[string]struct{}{}
	localModuleImportSet := map[string]struct{}{}
	workspaceModuleImportSet := map[string]struct{}{}
	replacedModuleImportSet := map[string]struct{}{}
	externalImportSet := map[string]struct{}{}
	importGraph := map[string]map[string]struct{}{}
	importGraphInDegree := map[string]int{}
	entryPackageImportSet := map[string]struct{}{}
	if entryImportPath != "" {
		importGraphInDegree[entryImportPath] = 0
	}
	var parsedFiles []*ast.File
	foundEntry := false
	sawEntryPath := false
	entryExcludedByConstraints := false
	for _, source := range files {
		name := filepath.Base(source.Path)
		if filepath.Dir(source.Path) != entryDir || !strings.HasSuffix(source.Path, ".go") {
			continue
		}
		if source.Path == request.Entry {
			sawEntryPath = true
		}
		if strings.HasPrefix(name, ".") || strings.HasPrefix(name, "_") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		stem := strings.TrimSuffix(name, ".go")
		parts := strings.Split(stem, "_")
		if len(parts) > 1 {
			last := parts[len(parts)-1]
			if len(parts) > 2 && knownFilenameGOOS[parts[len(parts)-2]] && knownFilenameGOARCH[last] {
				if parts[len(parts)-2] != profile.GOOS || last != profile.GOARCH {
					if source.Path == request.Entry {
						entryExcludedByConstraints = true
					}
					continue
				}
			} else if knownFilenameGOOS[last] {
				if last != profile.GOOS {
					if source.Path == request.Entry {
						entryExcludedByConstraints = true
					}
					continue
				}
			} else if knownFilenameGOARCH[last] {
				if last != profile.GOARCH {
					if source.Path == request.Entry {
						entryExcludedByConstraints = true
					}
					continue
				}
			}
		}
		included := true
		var goBuildExpr constraint.Expr
		var plusBuildExprs []constraint.Expr
		for _, line := range strings.Split(string(source.Contents), "\n") {
			line = strings.TrimSuffix(line, "\r")
			trimmed := strings.TrimSpace(line)
			if trimmed == "" {
				continue
			}
			if !strings.HasPrefix(trimmed, "//") {
				break
			}
			if constraint.IsGoBuild(trimmed) {
				expr, parseErr := constraint.Parse(trimmed)
				if parseErr != nil {
					return Result{}, fmt.Errorf("parse build constraint in %s: %w", source.Path, parseErr)
				}
				goBuildExpr = expr
				continue
			}
			if constraint.IsPlusBuild(trimmed) {
				expr, parseErr := constraint.Parse(trimmed)
				if parseErr != nil {
					return Result{}, fmt.Errorf("parse build constraint in %s: %w", source.Path, parseErr)
				}
				plusBuildExprs = append(plusBuildExprs, expr)
			}
		}
		if goBuildExpr != nil {
			included = goBuildExpr.Eval(func(tag string) bool {
				return tagSet[tag]
			})
		} else if len(plusBuildExprs) > 0 {
			for _, expr := range plusBuildExprs {
				if expr.Eval(func(tag string) bool {
					return tagSet[tag]
				}) {
					continue
				}
				included = false
				break
			}
		}
		if !included {
			if source.Path == request.Entry {
				entryExcludedByConstraints = true
			}
			continue
		}
		if source.Path == request.Entry {
			foundEntry = true
		}
		file, parseErr := parser.ParseFile(token.NewFileSet(), source.Path, source.Contents, parser.SkipObjectResolution)
		if parseErr != nil {
			return Result{}, fmt.Errorf("parse entry source: %w", parseErr)
		}
		parsedFiles = append(parsedFiles, file)
		packageFiles = append(packageFiles, source.Path)
		for _, imported := range file.Imports {
			path, unquoteErr := strconv.Unquote(imported.Path.Value)
			if unquoteErr != nil {
				return Result{}, fmt.Errorf("parse import path: %w", unquoteErr)
			}
			if strings.HasPrefix(path, ".") {
				return Result{}, fmt.Errorf("relative import is not supported yet: %q", path)
			}
			importSet[path] = struct{}{}
			entryPackageImportSet[path] = struct{}{}
			firstPathElement := path
			if cut := strings.IndexByte(path, '/'); cut >= 0 {
				firstPathElement = path[:cut]
			}
			if strings.Contains(firstPathElement, ".") {
				if _, unsupported := findUnsupportedReplaceImport(path, workspaceUnsupportedReplaceModules, unsupportedReplaceModules); unsupported {
					return Result{}, fmt.Errorf("non-local replace directive is not supported yet for import %q", path)
				}
				_, importKind, ok := resolveImportRoot(path, modulePath, moduleRoot, workspaceModules, workspaceReplaceModules, replaceModules)
				if ok {
					if importKind == "local" {
						localModuleImportSet[path] = struct{}{}
					} else if importKind == "workspace" {
						workspaceModuleImportSet[path] = struct{}{}
					} else {
						replacedModuleImportSet[path] = struct{}{}
					}
					if _, exists := importGraphInDegree[path]; !exists {
						importGraphInDegree[path] = 0
					}
					if entryImportPath != "" {
						if importGraph[entryImportPath] == nil {
							importGraph[entryImportPath] = map[string]struct{}{}
						}
						if _, exists := importGraph[entryImportPath][path]; !exists {
							importGraph[entryImportPath][path] = struct{}{}
							importGraphInDegree[path]++
						}
					}
					continue
				}
				externalImportSet[path] = struct{}{}
				continue
			}
			stdlibImportSet[path] = struct{}{}
		}
	}
	if !foundEntry {
		if sawEntryPath && entryExcludedByConstraints {
			return Result{}, fmt.Errorf("entry file is excluded by current target/build constraints")
		}
		return Result{}, fmt.Errorf("entry file not found in package files")
	}
	if len(parsedFiles) == 0 {
		return Result{}, fmt.Errorf("no Go files found for entry package")
	}

	packageName := ""
	hasMain := false
	for _, file := range parsedFiles {
		if file.Name == nil {
			return Result{}, fmt.Errorf("entry file must declare package main")
		}
		if packageName == "" {
			packageName = file.Name.Name
		} else if file.Name.Name != packageName {
			return Result{}, fmt.Errorf("all package files must declare the same package")
		}
		for _, decl := range file.Decls {
			funcDecl, ok := decl.(*ast.FuncDecl)
			if !ok || funcDecl.Recv != nil || funcDecl.Name == nil || funcDecl.Name.Name != "main" {
				continue
			}
			if funcDecl.Type == nil || funcDecl.Type.Params == nil || len(funcDecl.Type.Params.List) != 0 {
				return Result{}, fmt.Errorf("main function must not accept parameters")
			}
			if funcDecl.Type.Results != nil && len(funcDecl.Type.Results.List) != 0 {
				return Result{}, fmt.Errorf("main function must not return values")
			}
			hasMain = true
		}
	}
	if packageName != "main" {
		return Result{}, fmt.Errorf("entry file must declare package main")
	}
	if !hasMain {
		return Result{}, fmt.Errorf("entry file must define func main()")
	}
	sort.Strings(packageFiles)
	imports := make([]string, 0, len(importSet))
	for imported := range importSet {
		imports = append(imports, imported)
	}
	sort.Strings(imports)
	stdlibImports := make([]string, 0, len(stdlibImportSet))
	for imported := range stdlibImportSet {
		stdlibImports = append(stdlibImports, imported)
	}
	sort.Strings(stdlibImports)
	pendingPackageImports := make([]string, 0, len(localModuleImportSet)+len(workspaceModuleImportSet)+len(replacedModuleImportSet))
	for imported := range localModuleImportSet {
		pendingPackageImports = append(pendingPackageImports, imported)
	}
	for imported := range workspaceModuleImportSet {
		pendingPackageImports = append(pendingPackageImports, imported)
	}
	for imported := range replacedModuleImportSet {
		pendingPackageImports = append(pendingPackageImports, imported)
	}
	sort.Strings(pendingPackageImports)
	queuedPackageImports := map[string]struct{}{}
	queuedPackageKinds := map[string]string{}
	queuedPackageDirs := map[string]string{}
	for _, imported := range pendingPackageImports {
		queuedPackageImports[imported] = struct{}{}
		if dir, kind, ok := resolveImportRoot(imported, modulePath, moduleRoot, workspaceModules, workspaceReplaceModules, replaceModules); ok {
			queuedPackageKinds[imported] = kind
			queuedPackageDirs[imported] = dir
		}
	}
	processedPackageImports := map[string]struct{}{}
	importedPackageFiles := make([]string, 0, len(pendingPackageImports))
	importedCompileUnits := make([]tinygoplanner.CompileUnit, 0, len(pendingPackageImports))
	for len(pendingPackageImports) > 0 {
		imported := pendingPackageImports[0]
		pendingPackageImports = pendingPackageImports[1:]
		if _, alreadyProcessed := processedPackageImports[imported]; alreadyProcessed {
			continue
		}
		processedPackageImports[imported] = struct{}{}
		if _, exists := importGraphInDegree[imported]; !exists {
			importGraphInDegree[imported] = 0
		}
		dependencyDir := queuedPackageDirs[imported]
		importKind := queuedPackageKinds[imported]
		if dependencyDir == "" {
			var ok bool
			dependencyDir, importKind, ok = resolveImportRoot(imported, modulePath, moduleRoot, workspaceModules, workspaceReplaceModules, replaceModules)
			if !ok {
				continue
			}
		}
		dependencyModulePath := modulePath
		dependencyModuleRoot := moduleRoot
		dependencyReplaceModules := replaceModules
		if importKind == "workspace" {
			longestWorkspacePrefix := ""
			workspaceModuleRoot := ""
			for prefix, root := range workspaceModules {
				if imported != prefix && !strings.HasPrefix(imported, prefix+"/") {
					continue
				}
				if len(prefix) < len(longestWorkspacePrefix) {
					continue
				}
				longestWorkspacePrefix = prefix
				workspaceModuleRoot = root
			}
			if longestWorkspacePrefix != "" {
				dependencyModulePath = longestWorkspacePrefix
				dependencyModuleRoot = workspaceModuleRoot
				dependencyReplaceModules = map[string]string{}
				goModPath := filepath.Join(workspaceModuleRoot, "go.mod")
				for _, source := range files {
					if source.Path != goModPath {
						continue
					}
					parsedModulePath, parsedReplaceModules, parsedUnsupportedReplaceModules, parseErr := parseModuleFileConfig(source.Contents)
					if parseErr == nil {
						dependencyModulePath = parsedModulePath
						dependencyReplaceModules = parsedReplaceModules
						unsupportedReplaceModules = parsedUnsupportedReplaceModules
					}
					break
				}
			}
		}
		dependencyPackageName := ""
		dependencyPackageFiles := []string{}
		dependencyPackageImportSet := map[string]struct{}{}
		foundDependencyFiles := false
		foundDependencyCandidateFiles := false
		excludedDependencyFiles := false
		for _, source := range files {
			name := filepath.Base(source.Path)
			if filepath.Dir(source.Path) != dependencyDir || !strings.HasSuffix(source.Path, ".go") {
				continue
			}
			if strings.HasPrefix(name, ".") || strings.HasPrefix(name, "_") || strings.HasSuffix(name, "_test.go") {
				continue
			}
			foundDependencyCandidateFiles = true
			stem := strings.TrimSuffix(name, ".go")
			parts := strings.Split(stem, "_")
			if len(parts) > 1 {
				last := parts[len(parts)-1]
				if len(parts) > 2 && knownFilenameGOOS[parts[len(parts)-2]] && knownFilenameGOARCH[last] {
					if parts[len(parts)-2] != profile.GOOS || last != profile.GOARCH {
						excludedDependencyFiles = true
						continue
					}
				} else if knownFilenameGOOS[last] {
					if last != profile.GOOS {
						excludedDependencyFiles = true
						continue
					}
				} else if knownFilenameGOARCH[last] {
					if last != profile.GOARCH {
						excludedDependencyFiles = true
						continue
					}
				}
			}
			included := true
			var goBuildExpr constraint.Expr
			var plusBuildExprs []constraint.Expr
			for _, line := range strings.Split(string(source.Contents), "\n") {
				line = strings.TrimSuffix(line, "\r")
				trimmed := strings.TrimSpace(line)
				if trimmed == "" {
					continue
				}
				if !strings.HasPrefix(trimmed, "//") {
					break
				}
				if constraint.IsGoBuild(trimmed) {
					expr, parseErr := constraint.Parse(trimmed)
					if parseErr != nil {
						return Result{}, fmt.Errorf("parse build constraint in %s: %w", source.Path, parseErr)
					}
					goBuildExpr = expr
					continue
				}
				if constraint.IsPlusBuild(trimmed) {
					expr, parseErr := constraint.Parse(trimmed)
					if parseErr != nil {
						return Result{}, fmt.Errorf("parse build constraint in %s: %w", source.Path, parseErr)
					}
					plusBuildExprs = append(plusBuildExprs, expr)
				}
			}
			if goBuildExpr != nil {
				included = goBuildExpr.Eval(func(tag string) bool {
					return tagSet[tag]
				})
			} else if len(plusBuildExprs) > 0 {
				for _, expr := range plusBuildExprs {
					if expr.Eval(func(tag string) bool {
						return tagSet[tag]
					}) {
						continue
					}
					included = false
					break
				}
			}
			if !included {
				excludedDependencyFiles = true
				continue
			}
			file, parseErr := parser.ParseFile(token.NewFileSet(), source.Path, source.Contents, parser.SkipObjectResolution)
			if parseErr != nil {
				return Result{}, fmt.Errorf("parse imported package source: %w", parseErr)
			}
			if file.Name == nil {
				return Result{}, fmt.Errorf("%s module import %q has an unnamed package", importKind, imported)
			}
			if dependencyPackageName == "" {
				dependencyPackageName = file.Name.Name
			} else if file.Name.Name != dependencyPackageName {
				return Result{}, fmt.Errorf("%s module import %q must resolve to a single package", importKind, imported)
			}
			if file.Name.Name == "main" {
				return Result{}, fmt.Errorf("%s module import %q cannot resolve to package main", importKind, imported)
			}
			foundDependencyFiles = true
			importedPackageFiles = append(importedPackageFiles, source.Path)
			dependencyPackageFiles = append(dependencyPackageFiles, source.Path)
			for _, dependencyImport := range file.Imports {
				path, unquoteErr := strconv.Unquote(dependencyImport.Path.Value)
				if unquoteErr != nil {
					return Result{}, fmt.Errorf("parse import path: %w", unquoteErr)
				}
				if strings.HasPrefix(path, ".") {
					return Result{}, fmt.Errorf("relative import is not supported yet: %q", path)
				}
				importSet[path] = struct{}{}
				dependencyPackageImportSet[path] = struct{}{}
				firstPathElement := path
				if cut := strings.IndexByte(path, '/'); cut >= 0 {
					firstPathElement = path[:cut]
				}
				if strings.Contains(firstPathElement, ".") {
					if _, unsupported := findUnsupportedReplaceImport(path, workspaceUnsupportedReplaceModules, unsupportedReplaceModules); unsupported {
						return Result{}, fmt.Errorf("non-local replace directive is not supported yet for import %q", path)
					}
					resolvedDir, dependencyKind, ok := resolveImportRoot(path, dependencyModulePath, dependencyModuleRoot, workspaceModules, workspaceReplaceModules, dependencyReplaceModules)
					if ok {
						if dependencyKind == "local" && importKind == "workspace" {
							dependencyKind = "workspace"
						}
						if dependencyKind == "local" && importKind == "replace" {
							dependencyKind = "replace"
						}
						if dependencyKind == "local" {
							localModuleImportSet[path] = struct{}{}
						} else if dependencyKind == "workspace" {
							workspaceModuleImportSet[path] = struct{}{}
						} else {
							replacedModuleImportSet[path] = struct{}{}
						}
						if _, exists := importGraphInDegree[path]; !exists {
							importGraphInDegree[path] = 0
						}
						if importGraph[imported] == nil {
							importGraph[imported] = map[string]struct{}{}
						}
						if _, exists := importGraph[imported][path]; !exists {
							importGraph[imported][path] = struct{}{}
							importGraphInDegree[path]++
						}
						if _, alreadyQueued := queuedPackageImports[path]; !alreadyQueued {
							queuedPackageImports[path] = struct{}{}
							queuedPackageKinds[path] = dependencyKind
							queuedPackageDirs[path] = resolvedDir
							pendingPackageImports = append(pendingPackageImports, path)
						}
						continue
					}
					externalImportSet[path] = struct{}{}
					continue
				}
				stdlibImportSet[path] = struct{}{}
			}
		}
		if !foundDependencyFiles {
			if foundDependencyCandidateFiles && excludedDependencyFiles {
				return Result{}, fmt.Errorf("%s module import %q has no files matching current target/build constraints", importKind, imported)
			}
			if importKind == "replace" {
				return Result{}, fmt.Errorf("replaced module import package not found: %q", imported)
			}
			if importKind == "workspace" {
				return Result{}, fmt.Errorf("workspace module import package not found: %q", imported)
			}
			return Result{}, fmt.Errorf("local module import package not found: %q", imported)
		}
		sort.Strings(dependencyPackageFiles)
		dependencyPackageImports := make([]string, 0, len(dependencyPackageImportSet))
		for importPath := range dependencyPackageImportSet {
			dependencyPackageImports = append(dependencyPackageImports, importPath)
		}
		sort.Strings(dependencyPackageImports)
		importedCompileUnits = append(importedCompileUnits, tinygoplanner.CompileUnit{
			Kind:        "imported",
			ImportPath:  imported,
			Imports:     dependencyPackageImports,
			ModulePath:  dependencyModulePath,
			DepOnly:     true,
			PackageName: dependencyPackageName,
			PackageDir:  dependencyDir,
			Files:       append([]string{}, dependencyPackageFiles...),
			Standard:    false,
		})
	}
	nodes := make([]string, 0, len(importGraphInDegree))
	remainingInDegree := map[string]int{}
	for node, degree := range importGraphInDegree {
		nodes = append(nodes, node)
		remainingInDegree[node] = degree
	}
	sort.Strings(nodes)
	ready := make([]string, 0, len(nodes))
	for _, node := range nodes {
		if remainingInDegree[node] == 0 {
			ready = append(ready, node)
		}
	}
	for len(ready) > 0 {
		node := ready[0]
		ready = ready[1:]
		dependencies := make([]string, 0, len(importGraph[node]))
		for dependency := range importGraph[node] {
			dependencies = append(dependencies, dependency)
		}
		sort.Strings(dependencies)
		for _, dependency := range dependencies {
			remainingInDegree[dependency]--
			if remainingInDegree[dependency] == 0 {
				ready = append(ready, dependency)
				sort.Strings(ready)
			}
		}
	}
	cyclicImports := make([]string, 0, len(nodes))
	for _, node := range nodes {
		if remainingInDegree[node] > 0 {
			cyclicImports = append(cyclicImports, node)
		}
	}
	if len(cyclicImports) > 0 {
		return Result{}, fmt.Errorf("import cycle detected among local packages: %s", strings.Join(cyclicImports, ", "))
	}
	sort.Strings(importedPackageFiles)
	sort.Slice(importedCompileUnits, func(i, j int) bool {
		return importedCompileUnits[i].ImportPath < importedCompileUnits[j].ImportPath
	})
	localModuleImports := make([]string, 0, len(localModuleImportSet))
	for imported := range localModuleImportSet {
		localModuleImports = append(localModuleImports, imported)
	}
	sort.Strings(localModuleImports)
	workspaceModuleImports := make([]string, 0, len(workspaceModuleImportSet))
	for imported := range workspaceModuleImportSet {
		workspaceModuleImports = append(workspaceModuleImports, imported)
	}
	sort.Strings(workspaceModuleImports)
	replacedModuleImports := make([]string, 0, len(replacedModuleImportSet))
	for imported := range replacedModuleImportSet {
		replacedModuleImports = append(replacedModuleImports, imported)
	}
	sort.Strings(replacedModuleImports)
	stdlibImports = stdlibImports[:0]
	for imported := range stdlibImportSet {
		stdlibImports = append(stdlibImports, imported)
	}
	sort.Strings(stdlibImports)
	externalImports := make([]string, 0, len(externalImportSet))
	for imported := range externalImportSet {
		externalImports = append(externalImports, imported)
	}
	sort.Strings(externalImports)
	if len(externalImports) > 0 {
		return Result{}, fmt.Errorf("module resolution is not yet implemented for external imports: %s", strings.Join(externalImports, ", "))
	}
	programImportPath := entryImportPath
	if programImportPath == "" {
		programImportPath = "command-line-arguments"
	}
	programImports := make([]string, 0, len(entryPackageImportSet))
	for importPath := range entryPackageImportSet {
		programImports = append(programImports, importPath)
	}
	sort.Strings(programImports)
	compileUnits := []tinygoplanner.CompileUnit{{
		Kind:        "program",
		ImportPath:  programImportPath,
		Imports:     programImports,
		ModulePath:  modulePath,
		DepOnly:     false,
		PackageName: packageName,
		PackageDir:  entryDir,
		Files:       append([]string{}, packageFiles...),
		Standard:    false,
	}}
	compileUnits = append(compileUnits, importedCompileUnits...)

	plannerResult, err := tinygoplanner.PlanBuild(tinygoplanner.Request{
		Planner:              request.Planner,
		Target:               request.Target,
		Output:               request.Output,
		OptimizeFlag:         optFlag,
		Scheduler:            scheduler,
		PanicStrategy:        request.Panic,
		EntryPath:            request.Entry,
		ModulePath:           modulePath,
		PackageFiles:         append([]string{}, packageFiles...),
		ImportedPackageFiles: append([]string{}, importedPackageFiles...),
		CompileUnits:         compileUnits,
		Imports:              append([]string{}, imports...),
		StdlibImports:        append([]string{}, stdlibImports...),
		BuildTags:            profile.BuildTagsFor(scheduler),
		Profile:              profile,
	})
	if err != nil {
		return Result{}, err
	}
	plan := make([]ToolInvocation, 0, len(plannerResult.Plan))
	for _, step := range plannerResult.Plan {
		plan = append(plan, ToolInvocation{
			Argv: append([]string{}, step.Argv...),
			Cwd:  step.Cwd,
		})
	}
	filesToWrite := make([]GeneratedFile, 0, len(plannerResult.Files))
	for _, file := range plannerResult.Files {
		filesToWrite = append(filesToWrite, GeneratedFile{
			Path:     file.Path,
			Contents: file.Contents,
		})
	}
	mode := plannerResult.Mode
	diagnostics := append([]string{}, plannerResult.Diagnostics...)
	var metadata *Metadata
	if request.Planner == "tinygo" {
		panicStrategy := request.Panic
		if panicStrategy == "" {
			panicStrategy = "print"
		}
		metadata = &Metadata{
			Planner:                "tinygo",
			LLVMTarget:             profile.LLVMTarget,
			GOOS:                   profile.GOOS,
			GOARCH:                 profile.GOARCH,
			GC:                     profile.GC,
			Scheduler:              scheduler,
			PanicStrategy:          panicStrategy,
			Optimize:               optFlag,
			BuildTags:              profile.BuildTagsFor(scheduler),
			ModulePath:             modulePath,
			PackageFiles:           packageFiles,
			ImportedPackageFiles:   importedPackageFiles,
			Imports:                imports,
			StdlibImports:          stdlibImports,
			LocalModuleImports:     localModuleImports,
			WorkspaceModuleImports: workspaceModuleImports,
			ReplacedModuleImports:  replacedModuleImports,
			ExternalImports:        externalImports,
		}
	}

	return Result{
		OK:          true,
		Mode:        mode,
		Artifact:    request.Output,
		Plan:        plan,
		Files:       filesToWrite,
		Metadata:    metadata,
		Diagnostics: diagnostics,
	}, nil
}

func ExecutePaths(requestPath, resultPath string) error {
	requestData, err := os.ReadFile(requestPath)
	if err != nil {
		return err
	}

	var request Request
	if err := json.Unmarshal(requestData, &request); err != nil {
		return err
	}

	entrySource, err := os.ReadFile(request.Entry)
	if err != nil {
		result := Result{
			OK:          false,
			Diagnostics: []string{err.Error()},
		}
		resultData, marshalErr := json.Marshal(result)
		if marshalErr != nil {
			return marshalErr
		}
		if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
			return writeErr
		}
		return err
	}
	files := []SourceFile{{
		Path:     request.Entry,
		Contents: entrySource,
	}}
	loadedPaths := map[string]struct{}{
		request.Entry: {},
	}
	entries, err := os.ReadDir(filepath.Dir(request.Entry))
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") {
			continue
		}
		if strings.HasPrefix(entry.Name(), ".") || strings.HasPrefix(entry.Name(), "_") || strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		path := filepath.Join(filepath.Dir(request.Entry), entry.Name())
		if path == request.Entry {
			continue
		}
		contents, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		loadedPaths[path] = struct{}{}
		files = append(files, SourceFile{
			Path:     path,
			Contents: contents,
		})
	}
	modulePath := ""
	moduleRoot := ""
	replaceModules := map[string]string{}
	unsupportedReplaceModules := map[string]string{}
	workspaceRoot := ""
	workspaceUsePaths := []string{}
	workspaceReplaceModules := map[string]string{}
	workspaceUnsupportedReplaceModules := map[string]string{}
	currentDir := filepath.Dir(request.Entry)
	for {
		goModPath := filepath.Join(currentDir, "go.mod")
		contents, readErr := os.ReadFile(goModPath)
		if readErr == nil {
			parsedModulePath, parsedReplaceModules, parsedUnsupportedReplaceModules, parseErr := parseModuleFileConfig(contents)
			if parseErr == nil {
				modulePath = parsedModulePath
				moduleRoot = currentDir
				replaceModules = parsedReplaceModules
				unsupportedReplaceModules = parsedUnsupportedReplaceModules
			}
			files = append(files, SourceFile{
				Path:     goModPath,
				Contents: contents,
			})
			break
		}
		parentDir := filepath.Dir(currentDir)
		if parentDir == currentDir {
			break
		}
		currentDir = parentDir
	}
	currentDir = filepath.Dir(request.Entry)
	for {
		goWorkPath := filepath.Join(currentDir, "go.work")
		contents, readErr := os.ReadFile(goWorkPath)
		if readErr == nil {
			parsedUsePaths, parsedWorkspaceReplaceModules, parsedWorkspaceUnsupportedReplaceModules, parseErr := parseWorkFileConfig(contents)
			if parseErr == nil {
				workspaceRoot = currentDir
				workspaceUsePaths = parsedUsePaths
				workspaceReplaceModules = map[string]string{}
				workspaceUnsupportedReplaceModules = parsedWorkspaceUnsupportedReplaceModules
				for prefix, path := range parsedWorkspaceReplaceModules {
					if filepath.IsAbs(path) {
						workspaceReplaceModules[prefix] = filepath.Clean(path)
					} else {
						workspaceReplaceModules[prefix] = filepath.Clean(filepath.Join(workspaceRoot, filepath.FromSlash(path)))
					}
				}
			}
			files = append(files, SourceFile{
				Path:     goWorkPath,
				Contents: contents,
			})
			break
		}
		parentDir := filepath.Dir(currentDir)
		if parentDir == currentDir {
			break
		}
		currentDir = parentDir
	}
	workspaceModules := map[string]string{}
	for _, usePath := range workspaceUsePaths {
		moduleDir := usePath
		if !filepath.IsAbs(moduleDir) {
			moduleDir = filepath.Clean(filepath.Join(workspaceRoot, filepath.FromSlash(usePath)))
		}
		goModPath := filepath.Join(moduleDir, "go.mod")
		contents, readErr := os.ReadFile(goModPath)
		if readErr != nil {
			continue
		}
		if _, alreadyLoaded := loadedPaths[goModPath]; !alreadyLoaded {
			loadedPaths[goModPath] = struct{}{}
			files = append(files, SourceFile{
				Path:     goModPath,
				Contents: contents,
			})
		}
		usedModulePath, _, _, parseErr := parseModuleFileConfig(contents)
		if parseErr != nil {
			continue
		}
		if usedModulePath != "" {
			workspaceModules[usedModulePath] = moduleDir
		}
	}
	if modulePath != "" || len(replaceModules) > 0 || len(workspaceModules) > 0 {
		pendingPackageImports := []string{}
		queuedPackageImports := map[string]struct{}{}
		queuedPackageKinds := map[string]string{}
		queuedPackageDirs := map[string]string{}
		processedPackageImports := map[string]struct{}{}
		for _, source := range files {
			if filepath.Dir(source.Path) != filepath.Dir(request.Entry) || !strings.HasSuffix(source.Path, ".go") {
				continue
			}
			file, parseErr := parser.ParseFile(token.NewFileSet(), source.Path, source.Contents, parser.ImportsOnly)
			if parseErr != nil {
				continue
			}
			for _, imported := range file.Imports {
				path, unquoteErr := strconv.Unquote(imported.Path.Value)
				if unquoteErr != nil {
					continue
				}
				if _, unsupported := findUnsupportedReplaceImport(path, workspaceUnsupportedReplaceModules, unsupportedReplaceModules); unsupported {
					continue
				}
				dir, kind, ok := resolveImportRoot(path, modulePath, moduleRoot, workspaceModules, workspaceReplaceModules, replaceModules)
				if ok {
					if _, alreadyQueued := queuedPackageImports[path]; alreadyQueued {
						continue
					}
					queuedPackageImports[path] = struct{}{}
					queuedPackageKinds[path] = kind
					queuedPackageDirs[path] = dir
					pendingPackageImports = append(pendingPackageImports, path)
				}
			}
		}
		for len(pendingPackageImports) > 0 {
			imported := pendingPackageImports[0]
			pendingPackageImports = pendingPackageImports[1:]
			if _, alreadyProcessed := processedPackageImports[imported]; alreadyProcessed {
				continue
			}
			processedPackageImports[imported] = struct{}{}
			dependencyDir := queuedPackageDirs[imported]
			importKind := queuedPackageKinds[imported]
			if dependencyDir == "" {
				var ok bool
				dependencyDir, importKind, ok = resolveImportRoot(imported, modulePath, moduleRoot, workspaceModules, workspaceReplaceModules, replaceModules)
				if !ok {
					continue
				}
			}
			dependencyModulePath := modulePath
			dependencyModuleRoot := moduleRoot
			dependencyReplaceModules := replaceModules
			if importKind == "workspace" {
				longestWorkspacePrefix := ""
				workspaceModuleRoot := ""
				for prefix, root := range workspaceModules {
					if imported != prefix && !strings.HasPrefix(imported, prefix+"/") {
						continue
					}
					if len(prefix) < len(longestWorkspacePrefix) {
						continue
					}
					longestWorkspacePrefix = prefix
					workspaceModuleRoot = root
				}
				if longestWorkspacePrefix != "" {
					dependencyModulePath = longestWorkspacePrefix
					dependencyModuleRoot = workspaceModuleRoot
					dependencyReplaceModules = map[string]string{}
					goModPath := filepath.Join(workspaceModuleRoot, "go.mod")
					contents, readErr := os.ReadFile(goModPath)
					if readErr == nil {
						parsedModulePath, parsedReplaceModules, _, parseErr := parseModuleFileConfig(contents)
						if parseErr == nil {
							dependencyModulePath = parsedModulePath
							dependencyReplaceModules = parsedReplaceModules
						}
					}
				}
			}
			if importKind == "replace" {
				dependencyModulePath = ""
				dependencyModuleRoot = dependencyDir
				dependencyReplaceModules = map[string]string{}
				currentReplaceDir := dependencyDir
				for {
					goModPath := filepath.Join(currentReplaceDir, "go.mod")
					contents, readErr := os.ReadFile(goModPath)
					if readErr == nil {
						parsedModulePath, parsedReplaceModules, parsedUnsupportedReplaceModules, parseErr := parseModuleFileConfig(contents)
						if parseErr == nil {
							dependencyModulePath = parsedModulePath
							dependencyModuleRoot = currentReplaceDir
							dependencyReplaceModules = parsedReplaceModules
							unsupportedReplaceModules = parsedUnsupportedReplaceModules
						}
						break
					}
					parentDir := filepath.Dir(currentReplaceDir)
					if parentDir == currentReplaceDir {
						break
					}
					currentReplaceDir = parentDir
				}
			}
			entries, readDirErr := os.ReadDir(dependencyDir)
			if readDirErr != nil {
				continue
			}
			for _, entry := range entries {
				if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") {
					continue
				}
				path := filepath.Join(dependencyDir, entry.Name())
				if _, alreadyLoaded := loadedPaths[path]; alreadyLoaded {
					continue
				}
				contents, readErr := os.ReadFile(path)
				if readErr != nil {
					return readErr
				}
				loadedPaths[path] = struct{}{}
				files = append(files, SourceFile{
					Path:     path,
					Contents: contents,
				})
				file, parseErr := parser.ParseFile(token.NewFileSet(), path, contents, parser.ImportsOnly)
				if parseErr != nil {
					continue
				}
				for _, imported := range file.Imports {
					dependencyPath, unquoteErr := strconv.Unquote(imported.Path.Value)
					if unquoteErr != nil {
						continue
					}
					resolvedDir, dependencyKind, resolved := resolveImportRoot(dependencyPath, dependencyModulePath, dependencyModuleRoot, workspaceModules, workspaceReplaceModules, dependencyReplaceModules)
					if !resolved {
						continue
					}
					if dependencyKind == "local" && importKind == "workspace" {
						dependencyKind = "workspace"
					}
					if dependencyKind == "local" && importKind == "replace" {
						dependencyKind = "replace"
					}
					if _, alreadyQueued := queuedPackageImports[dependencyPath]; alreadyQueued {
						continue
					}
					queuedPackageImports[dependencyPath] = struct{}{}
					queuedPackageKinds[dependencyPath] = dependencyKind
					queuedPackageDirs[dependencyPath] = resolvedDir
					pendingPackageImports = append(pendingPackageImports, dependencyPath)
				}
			}
		}
	}

	result, buildErr := BuildPackage(request, files)
	if buildErr != nil {
		result = Result{
			OK:          false,
			Diagnostics: []string{buildErr.Error()},
		}
	}

	resultData, err := json.Marshal(result)
	if err != nil {
		return err
	}
	if err := os.WriteFile(resultPath, resultData, 0o644); err != nil {
		return err
	}

	return buildErr
}
