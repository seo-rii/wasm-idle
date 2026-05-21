package tinygoplanner

import (
	"encoding/json"
	"fmt"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"wasm-tinygo/internal/tinygoroot"
	"wasm-tinygo/internal/tinygotarget"
)

type Request struct {
	Planner              string
	Target               string
	Output               string
	OptimizeFlag         string
	Scheduler            string
	PanicStrategy        string
	EntryPath            string
	ModulePath           string
	PackageFiles         []string
	ImportedPackageFiles []string
	CompileUnits         []CompileUnit
	Imports              []string
	StdlibImports        []string
	BuildTags            []string
	Profile              tinygotarget.Profile
}

type CompileUnit struct {
	Kind        string
	ImportPath  string
	Imports     []string
	ModulePath  string
	DepOnly     bool
	PackageName string
	PackageDir  string
	Files       []string
	Standard    bool
}

type GeneratedFile struct {
	Path     string
	Contents string
}

type ToolInvocation struct {
	Argv []string
	Cwd  string
}

type Result struct {
	Mode        string
	Artifact    string
	Plan        []ToolInvocation
	Files       []GeneratedFile
	Diagnostics []string
}

const smokeSource = `static int checksum(int seed) {
    return ((seed * 13) ^ 0x2a) - 5;
}

int main(void) {
    return checksum(4) != 125;
}
`

var stdlibPackageFiles = map[string][]string{
	"errors":  {"/working/.tinygo-root/src/errors/errors.go"},
	"fmt":     {"/working/.tinygo-root/src/fmt/print.go"},
	"io":      {"/working/.tinygo-root/src/io/io.go"},
	"runtime": {"/working/.tinygo-root/src/runtime/runtime.go"},
	"unsafe":  {"/working/.tinygo-root/src/unsafe/unsafe.go"},
}

var stdlibPackageDependencies = map[string][]string{
	"fmt": {"errors", "io", "runtime", "unsafe"},
}

func PlanBuild(request Request) (Result, error) {
	compileInputName := "smoke.c"
	compileObjectName := "smoke.o"
	mode := "bootstrap-c-smoke"
	files := []GeneratedFile{
		{
			Path:     "/working/smoke.c",
			Contents: smokeSource,
		},
	}
	diagnostics := []string{
		"bootstrap driver planned a C smoke build while TinyGo frontend integration is still in progress",
	}
	if request.Planner == "tinygo" {
		compileInputName = "tinygo-bootstrap.c"
		compileObjectName = "tinygo-bootstrap.o"
		panicStrategy := request.PanicStrategy
		if panicStrategy == "" {
			panicStrategy = "print"
		}
		mode = "tinygo-bootstrap"
		diagnostics = []string{
			fmt.Sprintf("tinygo-style planner validated target=%s optimize=%s scheduler=%s panic=%s", request.Target, request.OptimizeFlag, request.Scheduler, panicStrategy),
			"tinygo planner now lowers compileInputs into a frontend handoff that regenerates the bootstrap C translation unit until TinyGo internals are wired in",
		}
		files = []GeneratedFile{}
		targetName := request.Target
		if targetName == "" {
			targetName = request.Profile.Name
		}
		if targetName == "" {
			targetName = "wasm"
		}
		wantedTinyGoRootPaths := map[string]struct{}{
			"/targets/" + targetName + ".json":      {},
			"/src/runtime/internal/sys/zversion.go": {},
			"/src/device/arm/arm.go":                {},
		}
		for _, path := range request.Profile.ExtraFiles {
			wantedTinyGoRootPaths["/"+strings.TrimPrefix(path, "/")] = struct{}{}
		}
		for _, flag := range request.Profile.LDFlags {
			index := strings.Index(flag, "{root}")
			if index < 0 {
				continue
			}
			path := strings.TrimPrefix(flag[index+len("{root}"):], "")
			if path == "" {
				continue
			}
			wantedTinyGoRootPaths[path] = struct{}{}
		}
		stdlibImports := append([]string{}, request.StdlibImports...)
		sort.Strings(stdlibImports)
		pendingStdlibPackages := append([]string{}, stdlibImports...)
		seenStdlibPackages := map[string]struct{}{}
		stdlibPackageFileSet := map[string]struct{}{}
		for len(pendingStdlibPackages) > 0 {
			packagePath := pendingStdlibPackages[0]
			pendingStdlibPackages = pendingStdlibPackages[1:]
			if _, seen := seenStdlibPackages[packagePath]; seen {
				continue
			}
			seenStdlibPackages[packagePath] = struct{}{}
			for _, path := range stdlibPackageFiles[packagePath] {
				stdlibPackageFileSet[path] = struct{}{}
			}
			for _, dependency := range stdlibPackageDependencies[packagePath] {
				pendingStdlibPackages = append(pendingStdlibPackages, dependency)
			}
		}
		stdlibCompileFiles := make([]string, 0, len(stdlibPackageFileSet))
		for path := range stdlibPackageFileSet {
			stdlibCompileFiles = append(stdlibCompileFiles, path)
			wantedTinyGoRootPaths[strings.TrimPrefix(path, tinygoroot.RootDir)] = struct{}{}
		}
		sort.Strings(stdlibCompileFiles)
		for _, file := range tinygoroot.Files() {
			relativePath := strings.TrimPrefix(file.Path, tinygoroot.RootDir)
			if _, ok := wantedTinyGoRootPaths[relativePath]; !ok {
				continue
			}
			files = append(files, GeneratedFile{
				Path:     file.Path,
				Contents: file.Contents,
			})
		}
		targetAssetFileSet := map[string]struct{}{}
		runtimeSupportFileSet := map[string]struct{}{}
		for _, file := range files {
			if strings.HasPrefix(file.Path, tinygoroot.RootDir+"/targets/") {
				targetAssetFileSet[file.Path] = struct{}{}
				continue
			}
			if _, ok := stdlibPackageFileSet[file.Path]; ok {
				continue
			}
			runtimeSupportFileSet[file.Path] = struct{}{}
		}
		targetAssetFiles := make([]string, 0, len(targetAssetFileSet))
		for path := range targetAssetFileSet {
			targetAssetFiles = append(targetAssetFiles, path)
		}
		runtimeSupportFiles := make([]string, 0, len(runtimeSupportFileSet))
		for path := range runtimeSupportFileSet {
			runtimeSupportFiles = append(runtimeSupportFiles, path)
		}
		packageFiles := append([]string{}, request.PackageFiles...)
		importedPackageFiles := append([]string{}, request.ImportedPackageFiles...)
		allCompileFileSet := map[string]struct{}{}
		for _, path := range packageFiles {
			allCompileFileSet[path] = struct{}{}
		}
		for _, path := range importedPackageFiles {
			allCompileFileSet[path] = struct{}{}
		}
		for _, path := range stdlibCompileFiles {
			allCompileFileSet[path] = struct{}{}
		}
		allCompileFiles := make([]string, 0, len(allCompileFileSet))
		for path := range allCompileFileSet {
			allCompileFiles = append(allCompileFiles, path)
		}
		sort.Strings(packageFiles)
		sort.Strings(importedPackageFiles)
		sort.Strings(targetAssetFiles)
		sort.Strings(runtimeSupportFiles)
		sort.Strings(allCompileFiles)
		buildTags := append([]string{}, request.BuildTags...)
		sort.Strings(buildTags)
		frontendInput := struct {
			BuildTags    []string `json:"buildTags"`
			BuildContext struct {
				Target     string   `json:"target"`
				LLVMTarget string   `json:"llvmTarget"`
				GOOS       string   `json:"goos"`
				GOARCH     string   `json:"goarch"`
				GC         string   `json:"gc"`
				Scheduler  string   `json:"scheduler"`
				BuildTags  []string `json:"buildTags"`
				ModulePath string   `json:"modulePath"`
			} `json:"buildContext"`
			ModulePath   string `json:"modulePath"`
			PackageGraph []struct {
				DepOnly bool   `json:"depOnly"`
				Dir     string `json:"dir"`
				Files   struct {
					GoFiles []string `json:"goFiles"`
				} `json:"files"`
				ImportPath string   `json:"importPath"`
				Imports    []string `json:"imports"`
				ModulePath string   `json:"modulePath"`
				Name       string   `json:"name"`
				Standard   bool     `json:"standard"`
			} `json:"packageGraph"`
			OptimizeFlag string `json:"optimizeFlag"`
			EntryFile    string `json:"entryFile"`
			CompileUnits []struct {
				Kind        string   `json:"kind"`
				ImportPath  string   `json:"importPath"`
				Imports     []string `json:"imports,omitempty"`
				ModulePath  string   `json:"modulePath"`
				DepOnly     bool     `json:"depOnly"`
				PackageName string   `json:"packageName"`
				PackageDir  string   `json:"packageDir"`
				Files       []string `json:"files"`
				Standard    bool     `json:"standard"`
			} `json:"compileUnits"`
			Toolchain struct {
				Target              string   `json:"target"`
				LLVMTarget          string   `json:"llvmTarget,omitempty"`
				Linker              string   `json:"linker,omitempty"`
				CFlags              []string `json:"cflags,omitempty"`
				LDFlags             []string `json:"ldflags,omitempty"`
				TranslationUnitPath string   `json:"translationUnitPath,omitempty"`
				ObjectOutputPath    string   `json:"objectOutputPath,omitempty"`
				ArtifactOutputPath  string   `json:"artifactOutputPath"`
			} `json:"toolchain"`
			SourceSelection struct {
				TargetAssets   []string `json:"targetAssets,omitempty"`
				RuntimeSupport []string `json:"runtimeSupport,omitempty"`
				Program        []string `json:"program,omitempty"`
				Imported       []string `json:"imported,omitempty"`
				AllCompile     []string `json:"allCompile"`
			} `json:"sourceSelection"`
		}{
			BuildTags:  buildTags,
			ModulePath: request.ModulePath,
			PackageGraph: []struct {
				DepOnly bool   `json:"depOnly"`
				Dir     string `json:"dir"`
				Files   struct {
					GoFiles []string `json:"goFiles"`
				} `json:"files"`
				ImportPath string   `json:"importPath"`
				Imports    []string `json:"imports"`
				ModulePath string   `json:"modulePath"`
				Name       string   `json:"name"`
				Standard   bool     `json:"standard"`
			}{},
			OptimizeFlag: request.OptimizeFlag,
			EntryFile:    request.EntryPath,
			CompileUnits: []struct {
				Kind        string   `json:"kind"`
				ImportPath  string   `json:"importPath"`
				Imports     []string `json:"imports,omitempty"`
				ModulePath  string   `json:"modulePath"`
				DepOnly     bool     `json:"depOnly"`
				PackageName string   `json:"packageName"`
				PackageDir  string   `json:"packageDir"`
				Files       []string `json:"files"`
				Standard    bool     `json:"standard"`
			}{},
			Toolchain: struct {
				Target              string   `json:"target"`
				LLVMTarget          string   `json:"llvmTarget,omitempty"`
				Linker              string   `json:"linker,omitempty"`
				CFlags              []string `json:"cflags,omitempty"`
				LDFlags             []string `json:"ldflags,omitempty"`
				TranslationUnitPath string   `json:"translationUnitPath,omitempty"`
				ObjectOutputPath    string   `json:"objectOutputPath,omitempty"`
				ArtifactOutputPath  string   `json:"artifactOutputPath"`
			}{
				Target:             request.Target,
				ArtifactOutputPath: request.Output,
			},
			SourceSelection: struct {
				TargetAssets   []string `json:"targetAssets,omitempty"`
				RuntimeSupport []string `json:"runtimeSupport,omitempty"`
				Program        []string `json:"program,omitempty"`
				Imported       []string `json:"imported,omitempty"`
				AllCompile     []string `json:"allCompile"`
			}{
				AllCompile: allCompileFiles,
			},
		}
		frontendInput.BuildContext.Target = request.Target
		frontendInput.BuildContext.LLVMTarget = request.Profile.LLVMTarget
		frontendInput.BuildContext.GOOS = request.Profile.GOOS
		frontendInput.BuildContext.GOARCH = request.Profile.GOARCH
		frontendInput.BuildContext.GC = request.Profile.GC
		frontendInput.BuildContext.Scheduler = request.Scheduler
		frontendInput.BuildContext.BuildTags = append([]string{}, buildTags...)
		frontendInput.BuildContext.ModulePath = request.ModulePath
		if len(request.CompileUnits) != 0 {
			for _, compileUnit := range request.CompileUnits {
				unitFiles := append([]string{}, compileUnit.Files...)
				sort.Strings(unitFiles)
				unitImports := append([]string{}, compileUnit.Imports...)
				sort.Strings(unitImports)
				frontendInput.CompileUnits = append(frontendInput.CompileUnits, struct {
					Kind        string   `json:"kind"`
					ImportPath  string   `json:"importPath"`
					Imports     []string `json:"imports,omitempty"`
					ModulePath  string   `json:"modulePath"`
					DepOnly     bool     `json:"depOnly"`
					PackageName string   `json:"packageName"`
					PackageDir  string   `json:"packageDir"`
					Files       []string `json:"files"`
					Standard    bool     `json:"standard"`
				}{
					Kind:        compileUnit.Kind,
					ImportPath:  compileUnit.ImportPath,
					Imports:     unitImports,
					ModulePath:  compileUnit.ModulePath,
					DepOnly:     compileUnit.DepOnly,
					PackageName: compileUnit.PackageName,
					PackageDir:  compileUnit.PackageDir,
					Files:       unitFiles,
					Standard:    compileUnit.Standard,
				})
			}
		} else if len(importedPackageFiles) != 0 {
			return Result{}, fmt.Errorf("compile units are required when imported package files are present")
		} else if len(packageFiles) != 0 {
			programImports := append([]string{}, request.Imports...)
			sort.Strings(programImports)
			frontendInput.CompileUnits = append(frontendInput.CompileUnits, struct {
				Kind        string   `json:"kind"`
				ImportPath  string   `json:"importPath"`
				Imports     []string `json:"imports,omitempty"`
				ModulePath  string   `json:"modulePath"`
				DepOnly     bool     `json:"depOnly"`
				PackageName string   `json:"packageName"`
				PackageDir  string   `json:"packageDir"`
				Files       []string `json:"files"`
				Standard    bool     `json:"standard"`
			}{
				Kind:        "program",
				ImportPath:  "command-line-arguments",
				Imports:     programImports,
				ModulePath:  request.ModulePath,
				DepOnly:     false,
				PackageName: "main",
				PackageDir:  filepath.Dir(request.EntryPath),
				Files:       append([]string{}, packageFiles...),
				Standard:    false,
			})
		}
		resolvedStdlibImports := make([]string, 0, len(seenStdlibPackages))
		for packagePath := range seenStdlibPackages {
			resolvedStdlibImports = append(resolvedStdlibImports, packagePath)
		}
		sort.Strings(resolvedStdlibImports)
		for _, packagePath := range resolvedStdlibImports {
			unitFiles := append([]string{}, stdlibPackageFiles[packagePath]...)
			sort.Strings(unitFiles)
			if len(unitFiles) == 0 {
				continue
			}
			frontendInput.CompileUnits = append(frontendInput.CompileUnits, struct {
				Kind        string   `json:"kind"`
				ImportPath  string   `json:"importPath"`
				Imports     []string `json:"imports,omitempty"`
				ModulePath  string   `json:"modulePath"`
				DepOnly     bool     `json:"depOnly"`
				PackageName string   `json:"packageName"`
				PackageDir  string   `json:"packageDir"`
				Files       []string `json:"files"`
				Standard    bool     `json:"standard"`
			}{
				Kind:        "stdlib",
				ImportPath:  packagePath,
				ModulePath:  "",
				DepOnly:     true,
				PackageName: path.Base(packagePath),
				PackageDir:  filepath.Dir(unitFiles[0]),
				Files:       unitFiles,
				Standard:    true,
			})
		}
		compileUnitModulePaths := map[string]string{}
		for _, compileUnit := range request.CompileUnits {
			compileUnitModulePaths[compileUnit.ImportPath] = compileUnit.ModulePath
		}
		for _, compileUnit := range frontendInput.CompileUnits {
			goFiles := make([]string, 0, len(compileUnit.Files))
			for _, file := range compileUnit.Files {
				if compileUnit.PackageDir != "" && strings.HasPrefix(file, compileUnit.PackageDir+"/") {
					goFiles = append(goFiles, strings.TrimPrefix(file, compileUnit.PackageDir+"/"))
					continue
				}
				goFiles = append(goFiles, filepath.Base(file))
			}
			sort.Strings(goFiles)
			frontendInput.PackageGraph = append(frontendInput.PackageGraph, struct {
				DepOnly bool   `json:"depOnly"`
				Dir     string `json:"dir"`
				Files   struct {
					GoFiles []string `json:"goFiles"`
				} `json:"files"`
				ImportPath string   `json:"importPath"`
				Imports    []string `json:"imports"`
				ModulePath string   `json:"modulePath"`
				Name       string   `json:"name"`
				Standard   bool     `json:"standard"`
			}{
				DepOnly: compileUnit.DepOnly,
				Dir:     compileUnit.PackageDir,
				Files: struct {
					GoFiles []string `json:"goFiles"`
				}{GoFiles: goFiles},
				ImportPath: compileUnit.ImportPath,
				Imports:    append([]string{}, compileUnit.Imports...),
				ModulePath: func() string {
					if compileUnit.Standard {
						return ""
					}
					if modulePath, ok := compileUnitModulePaths[compileUnit.ImportPath]; ok {
						return modulePath
					}
					return request.ModulePath
				}(),
				Name:     compileUnit.PackageName,
				Standard: compileUnit.Standard,
			})
		}
		frontendInputSource, err := json.Marshal(frontendInput)
		if err != nil {
			return Result{}, err
		}
		files = append(files, GeneratedFile{
			Path:     "/working/tinygo-frontend-input.json",
			Contents: string(frontendInputSource),
		})
		materializedFileSet := map[string]struct{}{
			"/working/tinygo-bootstrap.json":      {},
			"/working/tinygo-frontend-input.json": {},
		}
		for _, file := range files {
			materializedFileSet[file.Path] = struct{}{}
		}
		materializedFiles := make([]string, 0, len(materializedFileSet))
		for path := range materializedFileSet {
			materializedFiles = append(materializedFiles, path)
		}
		sort.Strings(materializedFiles)
		manifest, err := json.Marshal(struct {
			TinyGoRoot           string   `json:"tinygoRoot,omitempty"`
			EntryPath            string   `json:"entryPath,omitempty"`
			PackageFiles         []string `json:"packageFiles,omitempty"`
			ImportedPackageFiles []string `json:"importedPackageFiles,omitempty"`
			Imports              []string `json:"imports,omitempty"`
			StdlibImports        []string `json:"stdlibImports,omitempty"`
			StdlibPackageFiles   []string `json:"stdlibPackageFiles,omitempty"`
			BuildTags            []string `json:"buildTags,omitempty"`
			CompileInputs        struct {
				EntryFile            string   `json:"entryFile"`
				PackageFiles         []string `json:"packageFiles"`
				ImportedPackageFiles []string `json:"importedPackageFiles"`
				StdlibPackageFiles   []string `json:"stdlibPackageFiles"`
			} `json:"compileInputs,omitempty"`
			BootstrapDispatch struct {
				TargetAssetFiles    []string `json:"targetAssetFiles"`
				RuntimeSupportFiles []string `json:"runtimeSupportFiles"`
				MaterializedFiles   []string `json:"materializedFiles"`
			} `json:"bootstrapDispatch,omitempty"`
		}{
			CompileInputs: struct {
				EntryFile            string   `json:"entryFile"`
				PackageFiles         []string `json:"packageFiles"`
				ImportedPackageFiles []string `json:"importedPackageFiles"`
				StdlibPackageFiles   []string `json:"stdlibPackageFiles"`
			}{
				EntryFile:            request.EntryPath,
				PackageFiles:         packageFiles,
				ImportedPackageFiles: importedPackageFiles,
				StdlibPackageFiles:   stdlibCompileFiles,
			},
			BootstrapDispatch: struct {
				TargetAssetFiles    []string `json:"targetAssetFiles"`
				RuntimeSupportFiles []string `json:"runtimeSupportFiles"`
				MaterializedFiles   []string `json:"materializedFiles"`
			}{
				TargetAssetFiles:    targetAssetFiles,
				RuntimeSupportFiles: runtimeSupportFiles,
				MaterializedFiles:   materializedFiles,
			},
		})
		if err != nil {
			return Result{}, err
		}
		files = append(files, GeneratedFile{
			Path:     "/working/tinygo-bootstrap.json",
			Contents: string(manifest),
		})
	}

	compileArgv := []string{
		"/usr/bin/clang",
		"--target=" + request.Profile.LLVMTarget,
		request.OptimizeFlag,
	}
	compileArgv = append(compileArgv, request.Profile.CFlags...)
	compileArgv = append(compileArgv, "-c", compileInputName, "-o", compileObjectName)

	linkArgv := []string{"/usr/bin/" + request.Profile.Linker}
	linkArgv = append(linkArgv, request.Profile.LinkerFlags()...)
	linkArgv = append(linkArgv, "--no-entry", "--export-all", compileObjectName, "-o", request.Output)

	return Result{
		Mode:     mode,
		Artifact: request.Output,
		Plan: []ToolInvocation{
			{
				Argv: compileArgv,
				Cwd:  "/working",
			},
			{
				Argv: linkArgv,
				Cwd:  "/working",
			},
		},
		Files:       files,
		Diagnostics: diagnostics,
	}, nil
}
