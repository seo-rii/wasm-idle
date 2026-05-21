package tinygofrontend

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"wasm-tinygo/internal/tinygobackend"
	"wasm-tinygo/internal/tinygobootstrap"
	"wasm-tinygo/internal/tinygoroot"
	"wasm-tinygo/internal/tinygotarget"
)

type UpstreamFrontendProbePackage struct {
	ImportPath string   `json:"importPath"`
	Name       string   `json:"name"`
	FileCount  int      `json:"fileCount"`
	Imports    []string `json:"imports"`
}

type UpstreamFrontendProbeResult struct {
	RequestedTarget  string                         `json:"requestedTarget"`
	MainImportPath   string                         `json:"mainImportPath"`
	MainPackageName  string                         `json:"mainPackageName"`
	PackageCount     int                            `json:"packageCount"`
	FileCount        int                            `json:"fileCount"`
	DeclarationCount int                            `json:"declarationCount"`
	Imports          []string                       `json:"imports"`
	Packages         []UpstreamFrontendProbePackage `json:"packages"`
}

type Input struct {
	BuildTags             []string                     `json:"buildTags"`
	BuildContext          BuildContext                 `json:"buildContext"`
	Toolchain             Toolchain                    `json:"toolchain"`
	Target                string                       `json:"target"`
	LLVMTarget            string                       `json:"llvmTarget"`
	Linker                string                       `json:"linker"`
	ModulePath            string                       `json:"modulePath"`
	PackageGraph          []PackageGraphPackage        `json:"packageGraph,omitempty"`
	UpstreamFrontendProbe *UpstreamFrontendProbeResult `json:"upstreamFrontendProbe,omitempty"`
	CFlags                []string                     `json:"cflags"`
	LDFlags               []string                     `json:"ldflags"`
	OptimizeFlag          string                       `json:"optimizeFlag"`
	EntryFile             string                       `json:"entryFile"`
	TranslationUnitPath   string                       `json:"translationUnitPath"`
	ObjectOutputPath      string                       `json:"objectOutputPath"`
	ArtifactOutputPath    string                       `json:"artifactOutputPath"`
	SourceSelection       SourceSelection              `json:"sourceSelection"`
	CompileUnits          []IntermediateCompileUnit    `json:"compileUnits,omitempty"`
	TargetAssetFiles      []string                     `json:"targetAssetFiles"`
	RuntimeSupportFiles   []string                     `json:"runtimeSupportFiles"`
	ProgramFiles          []string                     `json:"programFiles"`
	ImportedPackageFiles  []string                     `json:"importedPackageFiles"`
	StdlibPackageFiles    []string                     `json:"stdlibPackageFiles"`
	AllCompileFiles       []string                     `json:"allCompileFiles"`
}

type Toolchain struct {
	Target              string   `json:"target"`
	LLVMTarget          string   `json:"llvmTarget"`
	Linker              string   `json:"linker"`
	CFlags              []string `json:"cflags"`
	LDFlags             []string `json:"ldflags"`
	TranslationUnitPath string   `json:"translationUnitPath"`
	ObjectOutputPath    string   `json:"objectOutputPath"`
	ArtifactOutputPath  string   `json:"artifactOutputPath"`
}

type BuildContext struct {
	Target     string   `json:"target"`
	LLVMTarget string   `json:"llvmTarget"`
	GOOS       string   `json:"goos"`
	GOARCH     string   `json:"goarch"`
	GC         string   `json:"gc"`
	Scheduler  string   `json:"scheduler"`
	BuildTags  []string `json:"buildTags"`
	ModulePath string   `json:"modulePath"`
}

type PackageGraphFiles struct {
	GoFiles []string `json:"goFiles"`
}

type PackageGraphPackage struct {
	DepOnly    bool              `json:"depOnly"`
	Dir        string            `json:"dir"`
	Files      PackageGraphFiles `json:"files"`
	ImportPath string            `json:"importPath"`
	Imports    []string          `json:"imports"`
	ModulePath string            `json:"modulePath"`
	Name       string            `json:"name"`
	Standard   bool              `json:"standard"`
}

type SourceSelection struct {
	AllCompile []string `json:"allCompile"`
}

type GeneratedFile struct {
	Path     string `json:"path"`
	Contents string `json:"contents"`
}

type CompileGroup struct {
	Name  string   `json:"name"`
	Files []string `json:"files"`
}

type IntermediateSourceSelection struct {
	TargetAssets   []string `json:"targetAssets"`
	RuntimeSupport []string `json:"runtimeSupport"`
	Program        []string `json:"program"`
	Imported       []string `json:"imported"`
	Stdlib         []string `json:"stdlib"`
	AllCompile     []string `json:"allCompile"`
}

type IntermediateManifest struct {
	EntryFile       string                      `json:"entryFile"`
	BuildTags       []string                    `json:"buildTags"`
	ModulePath      string                      `json:"modulePath"`
	OptimizeFlag    string                      `json:"optimizeFlag,omitempty"`
	Toolchain       Toolchain                   `json:"toolchain"`
	SourceSelection IntermediateSourceSelection `json:"sourceSelection"`
	CompileUnits    []IntermediateCompileUnit   `json:"compileUnits"`
}

type IntermediateCompileUnit struct {
	Kind        string   `json:"kind"`
	ImportPath  string   `json:"importPath"`
	Imports     []string `json:"imports"`
	ModulePath  string   `json:"modulePath"`
	DepOnly     bool     `json:"depOnly"`
	PackageName string   `json:"packageName"`
	PackageDir  string   `json:"packageDir"`
	Files       []string `json:"files"`
	Standard    bool     `json:"standard"`
}

type LoweringSupport struct {
	TargetAssets   []string `json:"targetAssets"`
	RuntimeSupport []string `json:"runtimeSupport"`
}

type LoweringManifest struct {
	EntryFile    string                    `json:"entryFile"`
	BuildTags    []string                  `json:"buildTags"`
	ModulePath   string                    `json:"modulePath"`
	OptimizeFlag string                    `json:"optimizeFlag,omitempty"`
	Toolchain    Toolchain                 `json:"toolchain"`
	Support      LoweringSupport           `json:"support"`
	CompileUnits []IntermediateCompileUnit `json:"compileUnits"`
}

type WorkItem struct {
	ID                string   `json:"id"`
	Kind              string   `json:"kind"`
	ImportPath        string   `json:"importPath"`
	Imports           []string `json:"imports"`
	DepOnly           bool     `json:"depOnly"`
	ModulePath        string   `json:"modulePath"`
	PackageName       string   `json:"packageName"`
	PackageDir        string   `json:"packageDir"`
	Files             []string `json:"files"`
	BitcodeOutputPath string   `json:"bitcodeOutputPath"`
	Standard          bool     `json:"standard"`
}

type WorkItemsManifest struct {
	EntryFile    string     `json:"entryFile"`
	OptimizeFlag string     `json:"optimizeFlag,omitempty"`
	Toolchain    Toolchain  `json:"toolchain"`
	WorkItems    []WorkItem `json:"workItems"`
}

type LoweredBitcodeManifest struct {
	BitcodeFiles []string `json:"bitcodeFiles"`
}

type LoweringCompileJob struct {
	ID                string   `json:"id"`
	Kind              string   `json:"kind"`
	ImportPath        string   `json:"importPath"`
	Imports           []string `json:"imports"`
	DepOnly           bool     `json:"depOnly"`
	ModulePath        string   `json:"modulePath"`
	PackageName       string   `json:"packageName"`
	PackageDir        string   `json:"packageDir"`
	Files             []string `json:"files"`
	BitcodeOutputPath string   `json:"bitcodeOutputPath"`
	LLVMTarget        string   `json:"llvmTarget"`
	CFlags            []string `json:"cflags"`
	OptimizeFlag      string   `json:"optimizeFlag,omitempty"`
	Standard          bool     `json:"standard"`
}

type LoweringLinkJob struct {
	Linker             string   `json:"linker"`
	LDFlags            []string `json:"ldflags"`
	ArtifactOutputPath string   `json:"artifactOutputPath"`
	BitcodeInputs      []string `json:"bitcodeInputs"`
}

type LoweringPlanManifest struct {
	EntryFile        string               `json:"entryFile"`
	OptimizeFlag     string               `json:"optimizeFlag,omitempty"`
	CompileJobs      []LoweringCompileJob `json:"compileJobs"`
	LinkJob          LoweringLinkJob      `json:"linkJob"`
	ExecutionLinkJob *LoweringLinkJob     `json:"executionLinkJob,omitempty"`
}

type Result struct {
	OK             bool            `json:"ok"`
	GeneratedFiles []GeneratedFile `json:"generatedFiles,omitempty"`
	Diagnostics    []string        `json:"diagnostics,omitempty"`
}

type AnalysisResult struct {
	OK          bool      `json:"ok"`
	Analysis    *Analysis `json:"analysis,omitempty"`
	Diagnostics []string  `json:"diagnostics,omitempty"`
}

type AdapterToolchain struct {
	Target              string   `json:"target"`
	LLVMTarget          string   `json:"llvmTarget"`
	Linker              string   `json:"linker,omitempty"`
	CFlags              []string `json:"cflags,omitempty"`
	LDFlags             []string `json:"ldflags,omitempty"`
	TranslationUnitPath string   `json:"translationUnitPath,omitempty"`
	ObjectOutputPath    string   `json:"objectOutputPath,omitempty"`
	ArtifactOutputPath  string   `json:"artifactOutputPath,omitempty"`
}

type Adapter struct {
	BuildContext            BuildContext                 `json:"buildContext"`
	EntryFile               string                       `json:"entryFile"`
	OptimizeFlag            string                       `json:"optimizeFlag,omitempty"`
	CompileUnitManifestPath string                       `json:"compileUnitManifestPath"`
	AllCompileFiles         []string                     `json:"allCompileFiles"`
	CompileGroups           []CompileGroup               `json:"compileGroups"`
	CompileUnits            []IntermediateCompileUnit    `json:"compileUnits"`
	PackageGraph            []PackageGraphPackage        `json:"packageGraph"`
	UpstreamFrontendProbe   *UpstreamFrontendProbeResult `json:"upstreamFrontendProbe,omitempty"`
	Toolchain               AdapterToolchain             `json:"toolchain"`
}

type AdapterResult struct {
	OK          bool     `json:"ok"`
	Adapter     *Adapter `json:"adapter,omitempty"`
	Diagnostics []string `json:"diagnostics,omitempty"`
}

type Analysis struct {
	EntryFile               string                       `json:"entryFile"`
	BuildTags               []string                     `json:"buildTags"`
	BuildContext            BuildContext                 `json:"buildContext"`
	ModulePath              string                       `json:"modulePath"`
	PackageGraph            []PackageGraphPackage        `json:"packageGraph"`
	UpstreamFrontendProbe   *UpstreamFrontendProbeResult `json:"upstreamFrontendProbe,omitempty"`
	OptimizeFlag            string                       `json:"optimizeFlag,omitempty"`
	Toolchain               Toolchain                    `json:"toolchain"`
	TargetAssets            []string                     `json:"targetAssets"`
	RuntimeSupport          []string                     `json:"runtimeSupport"`
	ProgramFiles            []string                     `json:"programFiles"`
	ImportedFiles           []string                     `json:"importedFiles"`
	StdlibFiles             []string                     `json:"stdlibFiles"`
	AllCompileFiles         []string                     `json:"allCompileFiles"`
	CompileUnits            []IntermediateCompileUnit    `json:"compileUnits"`
	CompileGroups           []CompileGroup               `json:"compileGroups"`
	CompileUnitManifestPath string                       `json:"compileUnitManifestPath"`
	BootstrapInput          tinygobootstrap.Input        `json:"bootstrapInput"`
	IntermediateManifest    IntermediateManifest         `json:"intermediateManifest"`
	LoweringManifest        LoweringManifest             `json:"loweringManifest"`
	WorkItemsManifest       WorkItemsManifest            `json:"workItemsManifest"`
	LoweringPlanManifest    LoweringPlanManifest         `json:"loweringPlanManifest"`
	BackendInput            tinygobackend.Input          `json:"backendInput"`
}

func cloneUpstreamFrontendProbeResult(input *UpstreamFrontendProbeResult) *UpstreamFrontendProbeResult {
	if input == nil {
		return nil
	}
	clone := &UpstreamFrontendProbeResult{
		RequestedTarget:  input.RequestedTarget,
		MainImportPath:   input.MainImportPath,
		MainPackageName:  input.MainPackageName,
		PackageCount:     input.PackageCount,
		FileCount:        input.FileCount,
		DeclarationCount: input.DeclarationCount,
		Imports:          append([]string{}, input.Imports...),
		Packages:         make([]UpstreamFrontendProbePackage, 0, len(input.Packages)),
	}
	for _, packageInfo := range input.Packages {
		clone.Packages = append(clone.Packages, UpstreamFrontendProbePackage{
			ImportPath: packageInfo.ImportPath,
			Name:       packageInfo.Name,
			FileCount:  packageInfo.FileCount,
			Imports:    append([]string{}, packageInfo.Imports...),
		})
	}
	return clone
}

func Analyze(input Input) (Analysis, error) {
	if input.Toolchain.Target == "" &&
		input.Toolchain.LLVMTarget == "" &&
		input.Toolchain.Linker == "" &&
		len(input.Toolchain.CFlags) == 0 &&
		len(input.Toolchain.LDFlags) == 0 &&
		input.Toolchain.TranslationUnitPath == "" &&
		input.Toolchain.ObjectOutputPath == "" &&
		input.Toolchain.ArtifactOutputPath == "" {
		return Analysis{}, fmt.Errorf("toolchain is required")
	}
	if input.Target != "" || input.LLVMTarget != "" || input.Linker != "" ||
		input.TranslationUnitPath != "" || input.ObjectOutputPath != "" || input.ArtifactOutputPath != "" ||
		len(input.CFlags) != 0 || len(input.LDFlags) != 0 {
		return Analysis{}, fmt.Errorf("legacy top-level toolchain fields are not supported")
	}
	if len(input.TargetAssetFiles) != 0 || len(input.RuntimeSupportFiles) != 0 ||
		len(input.ProgramFiles) != 0 || len(input.ImportedPackageFiles) != 0 ||
		len(input.StdlibPackageFiles) != 0 || len(input.AllCompileFiles) != 0 {
		return Analysis{}, fmt.Errorf("legacy top-level source selection fields are not supported")
	}
	if input.Toolchain.Target == "" {
		return Analysis{}, fmt.Errorf("target is required")
	}
	buildTags := append([]string{}, input.BuildTags...)
	sort.Strings(buildTags)
	for _, tag := range buildTags {
		if tag == "" {
			return Analysis{}, fmt.Errorf("build tags must not contain empty values")
		}
	}
	buildContextProvided := input.BuildContext.Target != "" ||
		input.BuildContext.LLVMTarget != "" ||
		input.BuildContext.GOOS != "" ||
		input.BuildContext.GOARCH != "" ||
		input.BuildContext.GC != "" ||
		input.BuildContext.Scheduler != "" ||
		len(input.BuildContext.BuildTags) != 0 ||
		input.BuildContext.ModulePath != ""
	buildContextBuildTags := append([]string{}, input.BuildContext.BuildTags...)
	sort.Strings(buildContextBuildTags)
	resolvedScheduler := ""
	for _, tag := range buildTags {
		if strings.HasPrefix(tag, "scheduler.") {
			resolvedScheduler = strings.TrimPrefix(tag, "scheduler.")
			break
		}
	}
	if buildContextProvided {
		if input.BuildContext.Target != input.Toolchain.Target {
			return Analysis{}, fmt.Errorf("build context target must match toolchain target")
		}
		if input.BuildContext.ModulePath != input.ModulePath {
			return Analysis{}, fmt.Errorf("build context modulePath must match top-level modulePath")
		}
		if len(buildContextBuildTags) != len(buildTags) {
			return Analysis{}, fmt.Errorf("build context buildTags must match top-level buildTags")
		}
		for index := range buildTags {
			if buildContextBuildTags[index] != buildTags[index] {
				return Analysis{}, fmt.Errorf("build context buildTags must match top-level buildTags")
			}
		}
	}
	llvmTarget := input.Toolchain.LLVMTarget
	linker := input.Toolchain.Linker
	cflags := append([]string{}, input.Toolchain.CFlags...)
	ldflags := append([]string{}, input.Toolchain.LDFlags...)
	if input.EntryFile == "" {
		return Analysis{}, fmt.Errorf("entry file is required")
	}
	if input.Toolchain.ArtifactOutputPath == "" {
		return Analysis{}, fmt.Errorf("artifact output path is required")
	}
	translationUnitPath := input.Toolchain.TranslationUnitPath
	if translationUnitPath == "" {
		translationUnitPath = "/working/tinygo-bootstrap.c"
	}
	objectOutputPath := input.Toolchain.ObjectOutputPath
	if objectOutputPath == "" {
		objectOutputPath = "/working/tinygo-bootstrap.o"
	}
	if input.SourceSelection.AllCompile == nil {
		return Analysis{}, fmt.Errorf("source selection is required")
	}
	if len(input.CompileUnits) == 0 {
		if len(input.PackageGraph) == 0 {
			return Analysis{}, fmt.Errorf("compile units are required")
		}
		input.CompileUnits = make([]IntermediateCompileUnit, 0, len(input.PackageGraph))
		for _, packageInfo := range input.PackageGraph {
			kind := "program"
			if packageInfo.DepOnly {
				kind = "imported"
			}
			if packageInfo.Standard {
				kind = "stdlib"
			}
			unitFiles := make([]string, 0, len(packageInfo.Files.GoFiles))
			for _, goFile := range packageInfo.Files.GoFiles {
				unitFiles = append(unitFiles, filepath.Join(packageInfo.Dir, goFile))
			}
			sort.Strings(unitFiles)
			unitImports := append([]string{}, packageInfo.Imports...)
			sort.Strings(unitImports)
			modulePath := packageInfo.ModulePath
			if modulePath == "" && !packageInfo.Standard {
				modulePath = input.ModulePath
			}
			input.CompileUnits = append(input.CompileUnits, IntermediateCompileUnit{
				Kind:        kind,
				ImportPath:  packageInfo.ImportPath,
				Imports:     unitImports,
				ModulePath:  modulePath,
				DepOnly:     packageInfo.DepOnly,
				PackageName: packageInfo.Name,
				PackageDir:  packageInfo.Dir,
				Files:       unitFiles,
				Standard:    packageInfo.Standard,
			})
		}
	}
	if len(input.PackageGraph) != 0 {
		graphPackages := map[string]PackageGraphPackage{}
		programPackage := PackageGraphPackage{}
		programPackageFound := false
		for _, packageInfo := range input.PackageGraph {
			if packageInfo.ImportPath == "" {
				continue
			}
			graphPackages[packageInfo.ImportPath] = packageInfo
			if !programPackageFound && !packageInfo.DepOnly {
				programPackage = packageInfo
				programPackageFound = true
			}
		}
		normalizedCompileUnits := make([]IntermediateCompileUnit, 0, len(input.CompileUnits))
		for _, compileUnit := range input.CompileUnits {
			normalizedCompileUnit := compileUnit
			packageInfo, ok := graphPackages[normalizedCompileUnit.ImportPath]
			if normalizedCompileUnit.Kind == "program" && normalizedCompileUnit.ImportPath == "command-line-arguments" && !ok && programPackageFound {
				packageInfo = programPackage
				ok = true
				normalizedCompileUnit.ImportPath = packageInfo.ImportPath
			}
			if ok {
				expectedModulePath := packageInfo.ModulePath
				if expectedModulePath == "" && !packageInfo.Standard {
					expectedModulePath = input.ModulePath
				}
				expectedDepOnly := false
				expectedStandard := false
				switch normalizedCompileUnit.Kind {
				case "program":
					expectedDepOnly = false
					expectedStandard = false
				case "imported":
					expectedDepOnly = true
					expectedStandard = false
				case "stdlib":
					expectedDepOnly = true
					expectedStandard = true
				}
				if packageInfo.DepOnly != expectedDepOnly || packageInfo.Standard != expectedStandard {
					return Analysis{}, fmt.Errorf("compile unit %q depOnly/standard do not match package graph", normalizedCompileUnit.ImportPath)
				}
				if normalizedCompileUnit.PackageDir == "" {
					normalizedCompileUnit.PackageDir = packageInfo.Dir
				} else if normalizedCompileUnit.PackageDir != packageInfo.Dir {
					return Analysis{}, fmt.Errorf("compile unit %q packageDir does not match package graph", normalizedCompileUnit.ImportPath)
				}
				if normalizedCompileUnit.PackageName == "" {
					normalizedCompileUnit.PackageName = packageInfo.Name
				} else if normalizedCompileUnit.PackageName != packageInfo.Name {
					return Analysis{}, fmt.Errorf("compile unit %q packageName does not match package graph", normalizedCompileUnit.ImportPath)
				}
				if normalizedCompileUnit.ModulePath == "" {
					normalizedCompileUnit.ModulePath = expectedModulePath
				} else if normalizedCompileUnit.ModulePath != expectedModulePath {
					return Analysis{}, fmt.Errorf("compile unit %q modulePath does not match package graph", normalizedCompileUnit.ImportPath)
				}
				if len(normalizedCompileUnit.Files) == 0 {
					normalizedCompileUnit.Files = make([]string, 0, len(packageInfo.Files.GoFiles))
					for _, goFile := range packageInfo.Files.GoFiles {
						normalizedCompileUnit.Files = append(normalizedCompileUnit.Files, filepath.Join(packageInfo.Dir, goFile))
					}
				}
				if len(normalizedCompileUnit.Imports) == 0 {
					normalizedCompileUnit.Imports = append([]string{}, packageInfo.Imports...)
				} else {
					compileUnitImports := append([]string{}, normalizedCompileUnit.Imports...)
					sort.Strings(compileUnitImports)
					graphImports := append([]string{}, packageInfo.Imports...)
					sort.Strings(graphImports)
					if len(compileUnitImports) != len(graphImports) {
						return Analysis{}, fmt.Errorf("compile unit %q imports do not match package graph", normalizedCompileUnit.ImportPath)
					}
					for index := range compileUnitImports {
						if compileUnitImports[index] != graphImports[index] {
							return Analysis{}, fmt.Errorf("compile unit %q imports do not match package graph", normalizedCompileUnit.ImportPath)
						}
					}
				}
				normalizedCompileUnit.DepOnly = packageInfo.DepOnly
				normalizedCompileUnit.Standard = packageInfo.Standard
			}
			normalizedCompileUnits = append(normalizedCompileUnits, normalizedCompileUnit)
		}
		input.CompileUnits = normalizedCompileUnits
	}
	allCompileFileSet := map[string]struct{}{}
	for _, path := range input.SourceSelection.AllCompile {
		allCompileFileSet[path] = struct{}{}
	}
	seenCompileFiles := map[string]struct{}{}
	stdlibFiles := make([]string, 0, len(input.SourceSelection.AllCompile))
	programFiles := make([]string, 0, len(input.SourceSelection.AllCompile))
	importedFiles := make([]string, 0, len(input.SourceSelection.AllCompile))
	compileUnits := make([]IntermediateCompileUnit, 0, len(input.CompileUnits))
	for _, compileUnit := range input.CompileUnits {
		if compileUnit.Kind == "" {
			return Analysis{}, fmt.Errorf("compile unit kind is required")
		}
		if compileUnit.ImportPath == "" {
			return Analysis{}, fmt.Errorf("compile unit importPath is required")
		}
		if compileUnit.PackageName == "" {
			return Analysis{}, fmt.Errorf("compile unit packageName is required")
		}
		if compileUnit.PackageDir == "" {
			return Analysis{}, fmt.Errorf("compile unit packageDir is required")
		}
		if len(compileUnit.Files) == 0 {
			return Analysis{}, fmt.Errorf("compile unit files are required")
		}
		unitFiles := append([]string{}, compileUnit.Files...)
		unitImports := append([]string{}, compileUnit.Imports...)
		sort.Strings(unitImports)
		for _, importPath := range unitImports {
			if importPath == "" {
				return Analysis{}, fmt.Errorf("compile unit imports must not contain empty paths")
			}
		}
		depOnly := compileUnit.DepOnly
		standard := compileUnit.Standard
		modulePath := compileUnit.ModulePath
		switch compileUnit.Kind {
		case "program":
			depOnly = false
			standard = false
		case "imported":
			depOnly = true
			standard = false
		case "stdlib":
			depOnly = true
			standard = true
		}
		if modulePath == "" && !standard {
			modulePath = input.ModulePath
		}
		compileUnits = append(compileUnits, IntermediateCompileUnit{
			Kind:        compileUnit.Kind,
			ImportPath:  compileUnit.ImportPath,
			Imports:     unitImports,
			ModulePath:  modulePath,
			DepOnly:     depOnly,
			PackageName: compileUnit.PackageName,
			PackageDir:  compileUnit.PackageDir,
			Files:       unitFiles,
			Standard:    standard,
		})
		for _, path := range unitFiles {
			if filepath.Dir(path) != compileUnit.PackageDir {
				return Analysis{}, fmt.Errorf("compile unit files must stay inside packageDir")
			}
			if _, ok := allCompileFileSet[path]; !ok {
				return Analysis{}, fmt.Errorf("compile units must only reference allCompile files")
			}
			if _, ok := seenCompileFiles[path]; ok {
				return Analysis{}, fmt.Errorf("compile units must not repeat files")
			}
			seenCompileFiles[path] = struct{}{}
		}
		switch compileUnit.Kind {
		case "program":
			programFiles = append(programFiles, unitFiles...)
		case "imported":
			importedFiles = append(importedFiles, unitFiles...)
		case "stdlib":
			stdlibFiles = append(stdlibFiles, unitFiles...)
		default:
			return Analysis{}, fmt.Errorf("unsupported compile unit kind %q", compileUnit.Kind)
		}
	}
	if len(input.PackageGraph) != 0 {
		if len(input.PackageGraph) != len(compileUnits) {
			return Analysis{}, fmt.Errorf("package graph must match compile units")
		}
		graphPackages := map[string]PackageGraphPackage{}
		for _, packageInfo := range input.PackageGraph {
			if packageInfo.ImportPath == "" {
				return Analysis{}, fmt.Errorf("package graph must match compile units")
			}
			if _, ok := graphPackages[packageInfo.ImportPath]; ok {
				return Analysis{}, fmt.Errorf("package graph must match compile units")
			}
			graphPackages[packageInfo.ImportPath] = packageInfo
		}
		for _, compileUnit := range compileUnits {
			packageInfo, ok := graphPackages[compileUnit.ImportPath]
			expectedModulePath := packageInfo.ModulePath
			if expectedModulePath == "" && !packageInfo.Standard {
				expectedModulePath = input.ModulePath
			}
			if !ok ||
				packageInfo.Dir != compileUnit.PackageDir ||
				packageInfo.Name != compileUnit.PackageName ||
				expectedModulePath != compileUnit.ModulePath ||
				packageInfo.DepOnly != compileUnit.DepOnly ||
				packageInfo.Standard != compileUnit.Standard {
				return Analysis{}, fmt.Errorf("package graph must match compile units")
			}
			graphImports := append([]string{}, packageInfo.Imports...)
			sort.Strings(graphImports)
			if len(graphImports) != len(compileUnit.Imports) {
				return Analysis{}, fmt.Errorf("package graph must match compile units")
			}
			for index := range compileUnit.Imports {
				if graphImports[index] != compileUnit.Imports[index] {
					return Analysis{}, fmt.Errorf("package graph must match compile units")
				}
			}
			graphGoFiles := append([]string{}, packageInfo.Files.GoFiles...)
			sort.Strings(graphGoFiles)
			compileUnitGoFiles := make([]string, 0, len(compileUnit.Files))
			for _, path := range compileUnit.Files {
				if compileUnit.PackageDir != "" && strings.HasPrefix(path, compileUnit.PackageDir+"/") {
					compileUnitGoFiles = append(compileUnitGoFiles, strings.TrimPrefix(path, compileUnit.PackageDir+"/"))
					continue
				}
				compileUnitGoFiles = append(compileUnitGoFiles, filepath.Base(path))
			}
			sort.Strings(compileUnitGoFiles)
			if len(graphGoFiles) != len(compileUnitGoFiles) {
				return Analysis{}, fmt.Errorf("package graph must match compile units")
			}
			for index := range compileUnitGoFiles {
				if graphGoFiles[index] != compileUnitGoFiles[index] {
					return Analysis{}, fmt.Errorf("package graph must match compile units")
				}
			}
			delete(graphPackages, compileUnit.ImportPath)
		}
		if len(graphPackages) != 0 {
			return Analysis{}, fmt.Errorf("package graph must match compile units")
		}
	}
	if len(seenCompileFiles) != len(allCompileFileSet) {
		return Analysis{}, fmt.Errorf("compile units must cover every allCompile file")
	}
	entrySeen := false
	for _, path := range programFiles {
		if path == input.EntryFile {
			entrySeen = true
			break
		}
	}
	if !entrySeen {
		return Analysis{}, fmt.Errorf("entry file must be present in program files")
	}
	expectedCompileFiles := map[string]struct{}{}
	for _, group := range [][]string{
		programFiles,
		importedFiles,
		stdlibFiles,
	} {
		for _, path := range group {
			expectedCompileFiles[path] = struct{}{}
		}
	}
	for _, path := range input.SourceSelection.AllCompile {
		delete(expectedCompileFiles, path)
	}
	if len(expectedCompileFiles) != 0 {
		return Analysis{}, fmt.Errorf("all compile files must include every program/imported/stdlib file")
	}
	remainingCompileFiles := map[string]struct{}{}
	for _, path := range input.SourceSelection.AllCompile {
		remainingCompileFiles[path] = struct{}{}
	}
	for _, group := range [][]string{
		programFiles,
		importedFiles,
		stdlibFiles,
	} {
		for _, path := range group {
			delete(remainingCompileFiles, path)
		}
	}
	if len(remainingCompileFiles) != 0 {
		return Analysis{}, fmt.Errorf("all compile files contained files outside program/imported/stdlib groups")
	}
	profile, err := tinygotarget.Resolve(input.Toolchain.Target)
	if err != nil {
		return Analysis{}, err
	}
	if llvmTarget == "" {
		llvmTarget = profile.LLVMTarget
	}
	if linker == "" {
		linker = profile.Linker
	}
	if len(cflags) == 0 {
		cflags = append([]string{}, profile.CFlags...)
	}
	if len(ldflags) == 0 {
		ldflags = profile.LinkerFlags()
	}
	if buildContextProvided {
		if input.BuildContext.LLVMTarget != llvmTarget {
			return Analysis{}, fmt.Errorf("build context llvmTarget must match resolved toolchain")
		}
		if input.BuildContext.GOOS != profile.GOOS {
			return Analysis{}, fmt.Errorf("build context goos must match target/profile")
		}
		if input.BuildContext.GOARCH != profile.GOARCH {
			return Analysis{}, fmt.Errorf("build context goarch must match target/profile")
		}
		if input.BuildContext.GC != profile.GC {
			return Analysis{}, fmt.Errorf("build context gc must match target/profile")
		}
		if input.BuildContext.Scheduler != resolvedScheduler {
			return Analysis{}, fmt.Errorf("build context scheduler must match target/profile")
		}
	}
	wantedTinyGoRootPaths := map[string]struct{}{
		"/targets/" + profile.Name + ".json":    {},
		"/src/runtime/internal/sys/zversion.go": {},
		"/src/device/arm/arm.go":                {},
	}
	for _, path := range profile.ExtraFiles {
		wantedTinyGoRootPaths["/"+strings.TrimPrefix(path, "/")] = struct{}{}
	}
	for _, flag := range profile.LDFlags {
		index := strings.Index(flag, "{root}")
		if index < 0 {
			continue
		}
		path := flag[index+len("{root}"):]
		if path != "" {
			wantedTinyGoRootPaths[path] = struct{}{}
		}
	}
	targetAssetSet := map[string]struct{}{
		tinygoroot.RootDir + "/targets/" + profile.Name + ".json": {},
	}
	for path := range wantedTinyGoRootPaths {
		fullPath := tinygoroot.RootDir + "/" + strings.TrimPrefix(path, "/")
		if strings.HasPrefix(fullPath, tinygoroot.RootDir+"/targets/") {
			targetAssetSet[fullPath] = struct{}{}
		}
	}
	targetAssets := make([]string, 0, len(targetAssetSet))
	for path := range targetAssetSet {
		targetAssets = append(targetAssets, path)
	}
	sort.Strings(targetAssets)
	stdlibFileSet := map[string]struct{}{}
	for _, path := range stdlibFiles {
		stdlibFileSet[path] = struct{}{}
	}
	runtimeSupportSet := map[string]struct{}{}
	for _, file := range tinygoroot.Files() {
		relativePath := strings.TrimPrefix(file.Path, tinygoroot.RootDir)
		if _, ok := wantedTinyGoRootPaths[relativePath]; !ok {
			continue
		}
		if strings.HasPrefix(file.Path, tinygoroot.RootDir+"/targets/") {
			continue
		}
		if _, ok := stdlibFileSet[file.Path]; ok {
			continue
		}
		runtimeSupportSet[file.Path] = struct{}{}
	}
	runtimeSupport := make([]string, 0, len(runtimeSupportSet))
	for path := range runtimeSupportSet {
		runtimeSupport = append(runtimeSupport, path)
	}
	sort.Strings(runtimeSupport)
	if llvmTarget == "" {
		return Analysis{}, fmt.Errorf("llvm target is required")
	}
	if linker == "" {
		return Analysis{}, fmt.Errorf("linker is required")
	}
	compileGroups := []CompileGroup{
		{Name: "target-assets", Files: append([]string{}, targetAssets...)},
		{Name: "runtime-support", Files: append([]string{}, runtimeSupport...)},
		{Name: "program", Files: append([]string{}, programFiles...)},
		{Name: "imported", Files: append([]string{}, importedFiles...)},
		{Name: "stdlib", Files: append([]string{}, stdlibFiles...)},
		{Name: "all-compile", Files: append([]string{}, input.SourceSelection.AllCompile...)},
	}
	normalizedToolchain := Toolchain{
		Target:              input.Toolchain.Target,
		LLVMTarget:          llvmTarget,
		Linker:              linker,
		CFlags:              append([]string{}, cflags...),
		LDFlags:             append([]string{}, ldflags...),
		TranslationUnitPath: translationUnitPath,
		ObjectOutputPath:    objectOutputPath,
		ArtifactOutputPath:  input.Toolchain.ArtifactOutputPath,
	}
	compileUnitManifestPath := "/working/tinygo-compile-unit.json"
	normalizedPackageGraph := make([]PackageGraphPackage, 0, len(compileUnits))
	graphPackages := map[string]PackageGraphPackage{}
	programPackage := PackageGraphPackage{}
	programPackageFound := false
	for _, packageInfo := range input.PackageGraph {
		if packageInfo.ImportPath == "" {
			continue
		}
		graphPackages[packageInfo.ImportPath] = packageInfo
		if !programPackageFound && !packageInfo.DepOnly {
			programPackage = packageInfo
			programPackageFound = true
		}
	}
	for _, compileUnit := range compileUnits {
		goFiles := make([]string, 0, len(compileUnit.Files))
		for _, path := range compileUnit.Files {
			if compileUnit.PackageDir != "" && strings.HasPrefix(path, compileUnit.PackageDir+"/") {
				goFiles = append(goFiles, strings.TrimPrefix(path, compileUnit.PackageDir+"/"))
				continue
			}
			goFiles = append(goFiles, filepath.Base(path))
		}
		sort.Strings(goFiles)
		modulePath := ""
		if packageInfo, ok := graphPackages[compileUnit.ImportPath]; ok {
			modulePath = packageInfo.ModulePath
			if modulePath == "" && !packageInfo.Standard {
				modulePath = input.ModulePath
			}
		} else if compileUnit.Kind == "program" && compileUnit.ImportPath == "command-line-arguments" && programPackageFound {
			modulePath = programPackage.ModulePath
			if modulePath == "" && !programPackage.Standard {
				modulePath = input.ModulePath
			}
		} else if !compileUnit.Standard {
			modulePath = input.ModulePath
		}
		normalizedPackageGraph = append(normalizedPackageGraph, PackageGraphPackage{
			DepOnly:    compileUnit.DepOnly,
			Dir:        compileUnit.PackageDir,
			Files:      PackageGraphFiles{GoFiles: goFiles},
			ImportPath: compileUnit.ImportPath,
			Imports:    append([]string{}, compileUnit.Imports...),
			ModulePath: modulePath,
			Name:       compileUnit.PackageName,
			Standard:   compileUnit.Standard,
		})
	}
	upstreamFrontendProbe := cloneUpstreamFrontendProbeResult(input.UpstreamFrontendProbe)
	if upstreamFrontendProbe != nil {
		if upstreamFrontendProbe.PackageCount != 0 && upstreamFrontendProbe.PackageCount != len(upstreamFrontendProbe.Packages) {
			return Analysis{}, fmt.Errorf("upstream frontend probe packageCount does not match packages")
		}
		probePackages := map[string]UpstreamFrontendProbePackage{}
		for _, packageInfo := range upstreamFrontendProbe.Packages {
			if packageInfo.ImportPath == "" {
				return Analysis{}, fmt.Errorf("upstream frontend probe packages must include importPath")
			}
			if _, ok := probePackages[packageInfo.ImportPath]; ok {
				return Analysis{}, fmt.Errorf("upstream frontend probe packages must not repeat importPath %q", packageInfo.ImportPath)
			}
			probePackages[packageInfo.ImportPath] = packageInfo
		}
		if len(probePackages) < len(normalizedPackageGraph) {
			return Analysis{}, fmt.Errorf("upstream frontend probe package summaries did not match frontend analysis")
		}
		sortedStringSlicesMatch := func(left, right []string) bool {
			leftSorted := append([]string{}, left...)
			rightSorted := append([]string{}, right...)
			sort.Strings(leftSorted)
			sort.Strings(rightSorted)
			if len(leftSorted) != len(rightSorted) {
				return false
			}
			for index := range leftSorted {
				if leftSorted[index] != rightSorted[index] {
					return false
				}
			}
			return true
		}
		programPackage := PackageGraphPackage{}
		programPackageCount := 0
		for _, packageInfo := range normalizedPackageGraph {
			if packageInfo.ImportPath == "" {
				return Analysis{}, fmt.Errorf("upstream frontend probe package summaries did not match frontend analysis")
			}
			probePackage, ok := probePackages[packageInfo.ImportPath]
			if !ok {
				return Analysis{}, fmt.Errorf("upstream frontend probe package summaries did not match frontend analysis")
			}
			if packageInfo.Name != "" && probePackage.Name != "" && probePackage.Name != packageInfo.Name {
				return Analysis{}, fmt.Errorf("upstream frontend probe package summaries did not match frontend analysis")
			}
			expectedFileCount := len(packageInfo.Files.GoFiles)
			if packageInfo.ImportPath == "unsafe" {
				expectedFileCount = 0
			}
			if probePackage.FileCount < expectedFileCount {
				return Analysis{}, fmt.Errorf("upstream frontend probe package summaries did not match frontend analysis")
			}
			if !sortedStringSlicesMatch(packageInfo.Imports, probePackage.Imports) {
				return Analysis{}, fmt.Errorf("upstream frontend probe package summaries did not match frontend analysis")
			}
			if !packageInfo.DepOnly && !packageInfo.Standard {
				programPackage = packageInfo
				programPackageCount++
			}
		}
		if programPackageCount != 1 {
			return Analysis{}, fmt.Errorf("upstream frontend probe package summaries did not match frontend analysis")
		}
		if upstreamFrontendProbe.MainImportPath != "" && upstreamFrontendProbe.MainImportPath != programPackage.ImportPath {
			return Analysis{}, fmt.Errorf("upstream frontend probe package summaries did not match frontend analysis")
		}
		if upstreamFrontendProbe.MainPackageName != "" && upstreamFrontendProbe.MainPackageName != programPackage.Name {
			return Analysis{}, fmt.Errorf("upstream frontend probe package summaries did not match frontend analysis")
		}
		if !sortedStringSlicesMatch(programPackage.Imports, upstreamFrontendProbe.Imports) {
			return Analysis{}, fmt.Errorf("upstream frontend probe package summaries did not match frontend analysis")
		}
	}
	normalizedBuildContext := BuildContext{
		Target:     input.Toolchain.Target,
		LLVMTarget: llvmTarget,
		GOOS:       profile.GOOS,
		GOARCH:     profile.GOARCH,
		GC:         profile.GC,
		Scheduler:  resolvedScheduler,
		BuildTags:  append([]string{}, buildTags...),
		ModulePath: input.ModulePath,
	}
	materializedFileSet := map[string]struct{}{}
	for _, group := range [][]string{
		targetAssets,
		runtimeSupport,
		stdlibFiles,
	} {
		for _, path := range group {
			materializedFileSet[path] = struct{}{}
		}
	}
	materializedFiles := make([]string, 0, len(materializedFileSet)+2)
	for path := range materializedFileSet {
		materializedFiles = append(materializedFiles, path)
	}
	sort.Strings(materializedFiles)
	translationUnitMaterialized := false
	for _, path := range materializedFiles {
		if path == translationUnitPath {
			translationUnitMaterialized = true
			break
		}
	}
	if !translationUnitMaterialized {
		materializedFiles = append(materializedFiles, translationUnitPath)
	}
	compileUnitManifestMaterialized := false
	for _, path := range materializedFiles {
		if path == compileUnitManifestPath {
			compileUnitManifestMaterialized = true
			break
		}
	}
	if !compileUnitManifestMaterialized {
		materializedFiles = append(materializedFiles, compileUnitManifestPath)
	}
	compileUnitManifest := tinygobootstrap.CompileUnitManifest{
		EntryFile:         input.EntryFile,
		OptimizeFlag:      input.OptimizeFlag,
		MaterializedFiles: materializedFiles,
		Toolchain: tinygobootstrap.Toolchain{
			Target:             input.Toolchain.Target,
			ArtifactOutputPath: input.Toolchain.ArtifactOutputPath,
		},
		SourceSelection: tinygobootstrap.SourceSelection{
			AllCompile: append([]string{}, input.SourceSelection.AllCompile...),
		},
		CompileUnits: make([]tinygobootstrap.CompileUnit, 0, len(compileUnits)),
	}
	for _, compileUnit := range compileUnits {
		compileUnitManifest.CompileUnits = append(compileUnitManifest.CompileUnits, tinygobootstrap.CompileUnit{
			Kind:        compileUnit.Kind,
			ImportPath:  compileUnit.ImportPath,
			Imports:     append([]string{}, compileUnit.Imports...),
			ModulePath:  compileUnit.ModulePath,
			DepOnly:     compileUnit.DepOnly,
			PackageName: compileUnit.PackageName,
			PackageDir:  compileUnit.PackageDir,
			Files:       append([]string{}, compileUnit.Files...),
			Standard:    compileUnit.Standard,
		})
	}
	if input.Toolchain.LLVMTarget != "" {
		compileUnitManifest.Toolchain.LLVMTarget = llvmTarget
	}
	if input.Toolchain.Linker != "" {
		compileUnitManifest.Toolchain.Linker = linker
	}
	if len(input.Toolchain.CFlags) != 0 {
		compileUnitManifest.Toolchain.CFlags = cflags
	}
	if len(input.Toolchain.LDFlags) != 0 {
		compileUnitManifest.Toolchain.LDFlags = ldflags
	}
	if input.Toolchain.TranslationUnitPath != "" {
		compileUnitManifest.Toolchain.TranslationUnitPath = translationUnitPath
	}
	if input.Toolchain.ObjectOutputPath != "" {
		compileUnitManifest.Toolchain.ObjectOutputPath = objectOutputPath
	}
	intermediateLDFlags := append([]string{}, ldflags...)
	for _, flag := range []string{"--no-entry", "--export-all"} {
		present := false
		for _, existing := range intermediateLDFlags {
			if existing == flag {
				present = true
				break
			}
		}
		if !present {
			intermediateLDFlags = append(intermediateLDFlags, flag)
		}
	}
	intermediateManifest := IntermediateManifest{
		EntryFile:    input.EntryFile,
		BuildTags:    buildTags,
		ModulePath:   input.ModulePath,
		OptimizeFlag: input.OptimizeFlag,
		Toolchain: Toolchain{
			Target:              input.Toolchain.Target,
			LLVMTarget:          llvmTarget,
			Linker:              linker,
			CFlags:              append([]string{}, cflags...),
			LDFlags:             append([]string{}, ldflags...),
			TranslationUnitPath: translationUnitPath,
			ObjectOutputPath:    objectOutputPath,
			ArtifactOutputPath:  input.Toolchain.ArtifactOutputPath,
		},
		SourceSelection: IntermediateSourceSelection{
			TargetAssets:   append([]string{}, targetAssets...),
			RuntimeSupport: append([]string{}, runtimeSupport...),
			Program:        append([]string{}, programFiles...),
			Imported:       append([]string{}, importedFiles...),
			Stdlib:         append([]string{}, stdlibFiles...),
			AllCompile:     append([]string{}, input.SourceSelection.AllCompile...),
		},
		CompileUnits: compileUnits,
	}
	loweringManifest := LoweringManifest{
		EntryFile:    input.EntryFile,
		BuildTags:    buildTags,
		ModulePath:   input.ModulePath,
		OptimizeFlag: input.OptimizeFlag,
		Toolchain: Toolchain{
			Target:              input.Toolchain.Target,
			LLVMTarget:          llvmTarget,
			Linker:              linker,
			CFlags:              append([]string{}, cflags...),
			LDFlags:             append([]string{}, ldflags...),
			TranslationUnitPath: translationUnitPath,
			ObjectOutputPath:    objectOutputPath,
			ArtifactOutputPath:  input.Toolchain.ArtifactOutputPath,
		},
		Support: LoweringSupport{
			TargetAssets:   append([]string{}, targetAssets...),
			RuntimeSupport: append([]string{}, runtimeSupport...),
		},
		CompileUnits: compileUnits,
	}
	workItems := make([]WorkItem, 0, len(compileUnits))
	kindIndexes := map[string]int{}
	for _, compileUnit := range compileUnits {
		kindIndex := kindIndexes[compileUnit.Kind]
		kindIndexes[compileUnit.Kind] = kindIndex + 1
		workItemID := fmt.Sprintf("%s-%03d", compileUnit.Kind, kindIndex)
		workItems = append(workItems, WorkItem{
			ID:                workItemID,
			Kind:              compileUnit.Kind,
			ImportPath:        compileUnit.ImportPath,
			Imports:           append([]string{}, compileUnit.Imports...),
			DepOnly:           compileUnit.DepOnly,
			ModulePath:        compileUnit.ModulePath,
			PackageName:       compileUnit.PackageName,
			PackageDir:        compileUnit.PackageDir,
			Files:             append([]string{}, compileUnit.Files...),
			BitcodeOutputPath: "/working/tinygo-work/" + workItemID + ".bc",
			Standard:          compileUnit.Standard,
		})
	}
	workItemsManifest := WorkItemsManifest{
		EntryFile:    input.EntryFile,
		OptimizeFlag: input.OptimizeFlag,
		Toolchain: Toolchain{
			Target:              input.Toolchain.Target,
			LLVMTarget:          llvmTarget,
			Linker:              linker,
			CFlags:              append([]string{}, cflags...),
			LDFlags:             append([]string{}, ldflags...),
			TranslationUnitPath: translationUnitPath,
			ObjectOutputPath:    objectOutputPath,
			ArtifactOutputPath:  input.Toolchain.ArtifactOutputPath,
		},
		WorkItems: workItems,
	}
	compileJobs := make([]LoweringCompileJob, 0, len(workItems))
	for _, workItem := range workItems {
		compileJobs = append(compileJobs, LoweringCompileJob{
			ID:                workItem.ID,
			Kind:              workItem.Kind,
			ImportPath:        workItem.ImportPath,
			Imports:           append([]string{}, workItem.Imports...),
			DepOnly:           workItem.DepOnly,
			ModulePath:        workItem.ModulePath,
			PackageName:       workItem.PackageName,
			PackageDir:        workItem.PackageDir,
			Files:             append([]string{}, workItem.Files...),
			BitcodeOutputPath: workItem.BitcodeOutputPath,
			LLVMTarget:        llvmTarget,
			CFlags:            append([]string{}, cflags...),
			OptimizeFlag:      input.OptimizeFlag,
			Standard:          workItem.Standard,
		})
	}
	linkBitcodeInputs := make([]string, 0, len(workItems))
	for _, workItem := range workItems {
		linkBitcodeInputs = append(linkBitcodeInputs, workItem.BitcodeOutputPath)
	}
	loweringPlanManifest := LoweringPlanManifest{
		EntryFile:    input.EntryFile,
		OptimizeFlag: input.OptimizeFlag,
		CompileJobs:  compileJobs,
		LinkJob: LoweringLinkJob{
			Linker:             linker,
			LDFlags:            append([]string{}, intermediateLDFlags...),
			ArtifactOutputPath: input.Toolchain.ArtifactOutputPath,
			BitcodeInputs:      linkBitcodeInputs,
		},
		ExecutionLinkJob: &LoweringLinkJob{
			Linker:             linker,
			LDFlags:            append([]string{}, ldflags...),
			ArtifactOutputPath: input.Toolchain.ArtifactOutputPath,
			BitcodeInputs:      append([]string{}, linkBitcodeInputs...),
		},
	}
	backendCompileJobs := make([]tinygobackend.CompileJob, 0, len(compileJobs))
	for _, compileJob := range compileJobs {
		backendCompileJobs = append(backendCompileJobs, tinygobackend.CompileJob{
			ID:                compileJob.ID,
			Kind:              compileJob.Kind,
			ImportPath:        compileJob.ImportPath,
			Imports:           append([]string{}, compileJob.Imports...),
			DepOnly:           compileJob.DepOnly,
			ModulePath:        compileJob.ModulePath,
			PackageName:       compileJob.PackageName,
			PackageDir:        compileJob.PackageDir,
			Files:             append([]string{}, compileJob.Files...),
			BitcodeOutputPath: compileJob.BitcodeOutputPath,
			LLVMTarget:        compileJob.LLVMTarget,
			CFlags:            append([]string{}, compileJob.CFlags...),
			OptimizeFlag:      compileJob.OptimizeFlag,
			Standard:          compileJob.Standard,
		})
	}
	backendInput := tinygobackend.Input{
		EntryFile:   input.EntryFile,
		CompileJobs: backendCompileJobs,
		LinkJob: tinygobackend.LinkJob{
			Linker:             linker,
			LDFlags:            append([]string{}, intermediateLDFlags...),
			ArtifactOutputPath: input.Toolchain.ArtifactOutputPath,
		},
		ExecutionLinkJob: &tinygobackend.LinkJob{
			Linker:             linker,
			LDFlags:            append([]string{}, ldflags...),
			ArtifactOutputPath: input.Toolchain.ArtifactOutputPath,
		},
	}
	return Analysis{
		EntryFile:               input.EntryFile,
		BuildTags:               buildTags,
		BuildContext:            normalizedBuildContext,
		ModulePath:              input.ModulePath,
		PackageGraph:            normalizedPackageGraph,
		UpstreamFrontendProbe:   upstreamFrontendProbe,
		OptimizeFlag:            input.OptimizeFlag,
		Toolchain:               normalizedToolchain,
		TargetAssets:            append([]string{}, targetAssets...),
		RuntimeSupport:          append([]string{}, runtimeSupport...),
		ProgramFiles:            append([]string{}, programFiles...),
		ImportedFiles:           append([]string{}, importedFiles...),
		StdlibFiles:             append([]string{}, stdlibFiles...),
		AllCompileFiles:         append([]string{}, input.SourceSelection.AllCompile...),
		CompileUnits:            append([]IntermediateCompileUnit{}, compileUnits...),
		CompileGroups:           append([]CompileGroup{}, compileGroups...),
		CompileUnitManifestPath: compileUnitManifestPath,
		BootstrapInput: tinygobootstrap.Input{
			CompileUnitManifest: compileUnitManifest,
			OptimizeFlag:        input.OptimizeFlag,
		},
		IntermediateManifest: intermediateManifest,
		LoweringManifest:     loweringManifest,
		WorkItemsManifest:    workItemsManifest,
		LoweringPlanManifest: loweringPlanManifest,
		BackendInput:         backendInput,
	}, nil
}

func EmitSynthetic(analysis Analysis) (Result, error) {
	bootstrapOutput, err := tinygobootstrap.Generate(analysis.BootstrapInput)
	if err != nil {
		return Result{}, err
	}
	intermediateManifestContents, err := json.Marshal(analysis.IntermediateManifest)
	if err != nil {
		return Result{}, err
	}
	loweringManifestContents, err := json.Marshal(analysis.LoweringManifest)
	if err != nil {
		return Result{}, err
	}
	workItemsManifestContents, err := json.Marshal(analysis.WorkItemsManifest)
	if err != nil {
		return Result{}, err
	}
	loweringPlanManifestContents, err := json.Marshal(analysis.LoweringPlanManifest)
	if err != nil {
		return Result{}, err
	}
	backendInputManifestContents, err := json.Marshal(analysis.BackendInput)
	if err != nil {
		return Result{}, err
	}
	compileUnitManifestContents := []byte(bootstrapOutput.EmbeddedManifest)
	generatedFiles := []GeneratedFile{
		{
			Path:     analysis.Toolchain.TranslationUnitPath,
			Contents: bootstrapOutput.Source,
		},
		{
			Path:     analysis.CompileUnitManifestPath,
			Contents: string(compileUnitManifestContents),
		},
		{
			Path:     "/working/tinygo-intermediate.json",
			Contents: string(intermediateManifestContents),
		},
		{
			Path:     "/working/tinygo-lowering-input.json",
			Contents: string(loweringManifestContents),
		},
		{
			Path:     "/working/tinygo-work-items.json",
			Contents: string(workItemsManifestContents),
		},
	}
	generatedFiles = append(generatedFiles,
		GeneratedFile{
			Path:     "/working/tinygo-lowering-plan.json",
			Contents: string(loweringPlanManifestContents),
		},
		GeneratedFile{
			Path:     "/working/tinygo-backend-input.json",
			Contents: string(backendInputManifestContents),
		},
	)
	return Result{
		OK:             true,
		GeneratedFiles: generatedFiles,
		Diagnostics: []string{
			fmt.Sprintf("tinygo frontend prepared %d compile groups for %s", len(analysis.CompileGroups), analysis.Toolchain.Target),
		},
	}, nil
}

func BuildFromAnalysis(analysis Analysis) (Result, error) {
	return EmitSynthetic(analysis)
}

func Build(input Input) (Result, error) {
	analysis, err := Analyze(input)
	if err != nil {
		return Result{}, err
	}
	return BuildFromAnalysis(analysis)
}

func AdaptReal(analysis Analysis) (Adapter, error) {
	compileGroupsByName := map[string]CompileGroup{}
	for _, compileGroup := range analysis.CompileGroups {
		compileGroupsByName[compileGroup.Name] = CompileGroup{
			Name:  compileGroup.Name,
			Files: append([]string{}, compileGroup.Files...),
		}
	}
	compileGroups := []CompileGroup{}
	for _, compileGroupName := range []string{"program", "imported", "stdlib", "all-compile"} {
		compileGroup, ok := compileGroupsByName[compileGroupName]
		if !ok {
			return Adapter{}, fmt.Errorf("compile group %q is required", compileGroupName)
		}
		compileGroups = append(compileGroups, compileGroup)
	}
	compileUnits := append([]IntermediateCompileUnit{}, analysis.CompileUnits...)
	for _, packageInfo := range analysis.PackageGraph {
		if packageInfo.DepOnly || packageInfo.ImportPath == "" {
			continue
		}
		for index, compileUnit := range compileUnits {
			if compileUnit.Kind != "program" {
				continue
			}
			if compileUnit.ImportPath == "command-line-arguments" && packageInfo.ImportPath != "" {
				compileUnits[index].ImportPath = packageInfo.ImportPath
			}
			if len(compileUnit.Imports) == 0 && len(packageInfo.Imports) != 0 {
				compileUnits[index].Imports = append([]string{}, packageInfo.Imports...)
			}
			if compileUnit.ModulePath == "" && packageInfo.ModulePath != "" {
				compileUnits[index].ModulePath = packageInfo.ModulePath
			} else if compileUnit.ModulePath == "" && !packageInfo.Standard && analysis.BuildContext.ModulePath != "" {
				compileUnits[index].ModulePath = analysis.BuildContext.ModulePath
			}
			if compileUnit.PackageName == "" && packageInfo.Name != "" {
				compileUnits[index].PackageName = packageInfo.Name
			}
			break
		}
		break
	}
	return Adapter{
		BuildContext:            analysis.BuildContext,
		EntryFile:               analysis.EntryFile,
		OptimizeFlag:            analysis.OptimizeFlag,
		CompileUnitManifestPath: analysis.CompileUnitManifestPath,
		AllCompileFiles:         append([]string{}, analysis.AllCompileFiles...),
		CompileGroups:           compileGroups,
		CompileUnits:            compileUnits,
		PackageGraph:            append([]PackageGraphPackage{}, analysis.PackageGraph...),
		UpstreamFrontendProbe:   cloneUpstreamFrontendProbeResult(analysis.UpstreamFrontendProbe),
		Toolchain: AdapterToolchain{
			Target:              analysis.Toolchain.Target,
			LLVMTarget:          analysis.Toolchain.LLVMTarget,
			Linker:              analysis.Toolchain.Linker,
			CFlags:              append([]string{}, analysis.Toolchain.CFlags...),
			LDFlags:             append([]string{}, analysis.Toolchain.LDFlags...),
			TranslationUnitPath: analysis.Toolchain.TranslationUnitPath,
			ObjectOutputPath:    analysis.Toolchain.ObjectOutputPath,
			ArtifactOutputPath:  analysis.Toolchain.ArtifactOutputPath,
		},
	}, nil
}

func BuildRealAdapter(input Input) (Adapter, error) {
	normalizedInput := input
	if len(input.PackageGraph) != 0 {
		graphPackages := map[string]PackageGraphPackage{}
		programPackage := PackageGraphPackage{}
		programPackageFound := false
		for _, packageInfo := range input.PackageGraph {
			if packageInfo.ImportPath == "" {
				continue
			}
			graphPackages[packageInfo.ImportPath] = packageInfo
			if !programPackageFound && !packageInfo.DepOnly {
				programPackage = packageInfo
				programPackageFound = true
			}
		}
		normalizedInput.CompileUnits = make([]IntermediateCompileUnit, 0, len(input.CompileUnits))
		for _, compileUnit := range input.CompileUnits {
			normalizedCompileUnit := compileUnit
			packageInfo, ok := graphPackages[normalizedCompileUnit.ImportPath]
			if normalizedCompileUnit.Kind == "program" && normalizedCompileUnit.ImportPath == "command-line-arguments" && !ok && programPackageFound {
				packageInfo = programPackage
				ok = true
				normalizedCompileUnit.ImportPath = packageInfo.ImportPath
			}
			if !ok {
				return Adapter{}, fmt.Errorf("compile unit %q is missing from package graph", normalizedCompileUnit.ImportPath)
			}
			expectedDepOnly := false
			expectedStandard := false
			expectedModulePath := packageInfo.ModulePath
			if expectedModulePath == "" && !packageInfo.Standard {
				expectedModulePath = normalizedInput.ModulePath
			}
			switch normalizedCompileUnit.Kind {
			case "program":
				expectedDepOnly = false
				expectedStandard = false
			case "imported":
				expectedDepOnly = true
				expectedStandard = false
			case "stdlib":
				expectedDepOnly = true
				expectedStandard = true
			}
			if packageInfo.DepOnly != expectedDepOnly || packageInfo.Standard != expectedStandard {
				return Adapter{}, fmt.Errorf("compile unit %q depOnly/standard do not match package graph", normalizedCompileUnit.ImportPath)
			}
			if normalizedCompileUnit.PackageDir == "" {
				normalizedCompileUnit.PackageDir = packageInfo.Dir
			} else if normalizedCompileUnit.PackageDir != packageInfo.Dir {
				return Adapter{}, fmt.Errorf("compile unit %q packageDir does not match package graph", normalizedCompileUnit.ImportPath)
			}
			if normalizedCompileUnit.PackageName == "" {
				normalizedCompileUnit.PackageName = packageInfo.Name
			} else if normalizedCompileUnit.PackageName != packageInfo.Name {
				return Adapter{}, fmt.Errorf("compile unit %q packageName does not match package graph", normalizedCompileUnit.ImportPath)
			}
			if normalizedCompileUnit.ModulePath == "" {
				normalizedCompileUnit.ModulePath = expectedModulePath
			} else if normalizedCompileUnit.ModulePath != expectedModulePath {
				return Adapter{}, fmt.Errorf("compile unit %q modulePath does not match package graph", normalizedCompileUnit.ImportPath)
			}
			if len(normalizedCompileUnit.Files) == 0 {
				normalizedCompileUnit.Files = make([]string, 0, len(packageInfo.Files.GoFiles))
				for _, goFile := range packageInfo.Files.GoFiles {
					normalizedCompileUnit.Files = append(normalizedCompileUnit.Files, filepath.Join(packageInfo.Dir, goFile))
				}
			}
			if len(normalizedCompileUnit.Imports) == 0 {
				normalizedCompileUnit.Imports = append([]string{}, packageInfo.Imports...)
			} else {
				compileUnitImports := append([]string{}, normalizedCompileUnit.Imports...)
				sort.Strings(compileUnitImports)
				graphImports := append([]string{}, packageInfo.Imports...)
				sort.Strings(graphImports)
				if len(compileUnitImports) != len(graphImports) {
					return Adapter{}, fmt.Errorf("compile unit %q imports do not match package graph", normalizedCompileUnit.ImportPath)
				}
				for index := range compileUnitImports {
					if compileUnitImports[index] != graphImports[index] {
						return Adapter{}, fmt.Errorf("compile unit %q imports do not match package graph", normalizedCompileUnit.ImportPath)
					}
				}
			}
			normalizedCompileUnit.DepOnly = packageInfo.DepOnly
			normalizedCompileUnit.Standard = packageInfo.Standard
			normalizedInput.CompileUnits = append(normalizedInput.CompileUnits, normalizedCompileUnit)
		}
	}
	analysis, err := Analyze(normalizedInput)
	if err != nil {
		return Adapter{}, err
	}
	adapter, err := AdaptReal(analysis)
	if err != nil {
		return Adapter{}, err
	}
	return adapter, nil
}

func ExecuteAnalysisPaths(inputPath, resultPath string) error {
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		return err
	}

	var input Input
	if err := json.Unmarshal(inputData, &input); err != nil {
		return err
	}

	analysis, err := Analyze(input)
	if err != nil {
		failedResult := AnalysisResult{
			OK:          false,
			Diagnostics: []string{err.Error()},
		}
		resultData, marshalErr := json.Marshal(failedResult)
		if marshalErr != nil {
			return marshalErr
		}
		if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
			return writeErr
		}
		return err
	}

	resultData, err := json.Marshal(AnalysisResult{
		OK:       true,
		Analysis: &analysis,
		Diagnostics: []string{
			fmt.Sprintf("tinygo frontend prepared analysis handoff for %s", analysis.Toolchain.Target),
		},
	})
	if err != nil {
		return err
	}

	return os.WriteFile(resultPath, resultData, 0o644)
}

func ExecuteAnalysisBuildPaths(analysisPath, resultPath string) error {
	analysisData, err := os.ReadFile(analysisPath)
	if err != nil {
		return err
	}

	var analysisResult AnalysisResult
	if err := json.Unmarshal(analysisData, &analysisResult); err != nil {
		return err
	}
	if !analysisResult.OK || analysisResult.Analysis == nil {
		result := Result{
			OK:          false,
			Diagnostics: append([]string{}, analysisResult.Diagnostics...),
		}
		if len(result.Diagnostics) == 0 {
			result.Diagnostics = []string{"frontend analysis result is required"}
		}
		resultData, marshalErr := json.Marshal(result)
		if marshalErr != nil {
			return marshalErr
		}
		if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
			return writeErr
		}
		return fmt.Errorf("%s", result.Diagnostics[0])
	}

	result, err := BuildFromAnalysis(*analysisResult.Analysis)
	if err != nil {
		failedResult := Result{
			OK:          false,
			Diagnostics: []string{err.Error()},
		}
		resultData, marshalErr := json.Marshal(failedResult)
		if marshalErr != nil {
			return marshalErr
		}
		if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
			return writeErr
		}
		return err
	}

	result.Diagnostics = []string{
		fmt.Sprintf("tinygo frontend prepared bootstrap compile request for %s", analysisResult.Analysis.Toolchain.Target),
	}
	resultData, err := json.Marshal(result)
	if err != nil {
		return err
	}

	return os.WriteFile(resultPath, resultData, 0o644)
}

func ExecuteAdapterBuildPaths(analysisPath, adapterPath, resultPath string) error {
	adapterData, err := os.ReadFile(adapterPath)
	if err != nil {
		return err
	}

	var adapterResult AdapterResult
	if err := json.Unmarshal(adapterData, &adapterResult); err != nil {
		return err
	}
	if !adapterResult.OK || adapterResult.Adapter == nil {
		result := Result{
			OK:          false,
			Diagnostics: append([]string{}, adapterResult.Diagnostics...),
		}
		if len(result.Diagnostics) == 0 {
			result.Diagnostics = []string{"frontend real adapter result is required"}
		}
		resultData, marshalErr := json.Marshal(result)
		if marshalErr != nil {
			return marshalErr
		}
		if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
			return writeErr
		}
		return fmt.Errorf("%s", result.Diagnostics[0])
	}

	var analysisResult AnalysisResult
	analysisAvailable := false
	analysisData, err := os.ReadFile(analysisPath)
	if err == nil {
		analysisAvailable = true
		if err := json.Unmarshal(analysisData, &analysisResult); err != nil {
			return err
		}
		if !analysisResult.OK || analysisResult.Analysis == nil {
			result := Result{
				OK:          false,
				Diagnostics: append([]string{}, analysisResult.Diagnostics...),
			}
			if len(result.Diagnostics) == 0 {
				result.Diagnostics = []string{"frontend analysis result is required"}
			}
			resultData, marshalErr := json.Marshal(result)
			if marshalErr != nil {
				return marshalErr
			}
			if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
				return writeErr
			}
			return fmt.Errorf("%s", result.Diagnostics[0])
		}
	} else if !os.IsNotExist(err) {
		return err
	}

	if analysisAvailable {
		if adapterResult.Adapter.Toolchain.Target != analysisResult.Analysis.Toolchain.Target {
			result := Result{
				OK:          false,
				Diagnostics: []string{"frontend real adapter target did not match analysis"},
			}
			resultData, marshalErr := json.Marshal(result)
			if marshalErr != nil {
				return marshalErr
			}
			if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
				return writeErr
			}
			return fmt.Errorf("%s", result.Diagnostics[0])
		}
		if adapterResult.Adapter.Toolchain.LLVMTarget != analysisResult.Analysis.Toolchain.LLVMTarget {
			result := Result{
				OK:          false,
				Diagnostics: []string{"frontend real adapter llvmTarget did not match analysis"},
			}
			resultData, marshalErr := json.Marshal(result)
			if marshalErr != nil {
				return marshalErr
			}
			if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
				return writeErr
			}
			return fmt.Errorf("%s", result.Diagnostics[0])
		}
		if adapterResult.Adapter.CompileUnitManifestPath != analysisResult.Analysis.CompileUnitManifestPath {
			result := Result{
				OK:          false,
				Diagnostics: []string{"frontend real adapter compile unit manifest path did not match analysis"},
			}
			resultData, marshalErr := json.Marshal(result)
			if marshalErr != nil {
				return marshalErr
			}
			if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
				return writeErr
			}
			return fmt.Errorf("%s", result.Diagnostics[0])
		}
		if len(adapterResult.Adapter.CompileUnits) != len(analysisResult.Analysis.CompileUnits) {
			result := Result{
				OK:          false,
				Diagnostics: []string{"frontend real adapter compile unit count did not match analysis"},
			}
			resultData, marshalErr := json.Marshal(result)
			if marshalErr != nil {
				return marshalErr
			}
			if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
				return writeErr
			}
			return fmt.Errorf("%s", result.Diagnostics[0])
		}
		if len(adapterResult.Adapter.AllCompileFiles) != len(analysisResult.Analysis.AllCompileFiles) {
			result := Result{
				OK:          false,
				Diagnostics: []string{"frontend real adapter all-compile count did not match analysis"},
			}
			resultData, marshalErr := json.Marshal(result)
			if marshalErr != nil {
				return marshalErr
			}
			if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
				return writeErr
			}
			return fmt.Errorf("%s", result.Diagnostics[0])
		}
		if adapterResult.Adapter.OptimizeFlag != "" && adapterResult.Adapter.OptimizeFlag != analysisResult.Analysis.OptimizeFlag {
			result := Result{
				OK:          false,
				Diagnostics: []string{"frontend real adapter optimize flag did not match analysis"},
			}
			resultData, marshalErr := json.Marshal(result)
			if marshalErr != nil {
				return marshalErr
			}
			if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
				return writeErr
			}
			return fmt.Errorf("%s", result.Diagnostics[0])
		}
		if adapterResult.Adapter.Toolchain.ArtifactOutputPath != "" && adapterResult.Adapter.Toolchain.ArtifactOutputPath != analysisResult.Analysis.Toolchain.ArtifactOutputPath {
			result := Result{
				OK:          false,
				Diagnostics: []string{"frontend real adapter artifact output path did not match analysis"},
			}
			resultData, marshalErr := json.Marshal(result)
			if marshalErr != nil {
				return marshalErr
			}
			if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
				return writeErr
			}
			return fmt.Errorf("%s", result.Diagnostics[0])
		}
	}

	buildTags := append([]string{}, adapterResult.Adapter.BuildContext.BuildTags...)
	if len(buildTags) == 0 && analysisAvailable {
		buildTags = append([]string{}, analysisResult.Analysis.BuildTags...)
	}
	buildContext := adapterResult.Adapter.BuildContext
	if analysisAvailable {
		if buildContext.Target == "" {
			buildContext.Target = analysisResult.Analysis.BuildContext.Target
		}
		if buildContext.LLVMTarget == "" {
			buildContext.LLVMTarget = analysisResult.Analysis.BuildContext.LLVMTarget
		}
		if buildContext.GOOS == "" {
			buildContext.GOOS = analysisResult.Analysis.BuildContext.GOOS
		}
		if buildContext.GOARCH == "" {
			buildContext.GOARCH = analysisResult.Analysis.BuildContext.GOARCH
		}
		if buildContext.GC == "" {
			buildContext.GC = analysisResult.Analysis.BuildContext.GC
		}
		if buildContext.Scheduler == "" {
			buildContext.Scheduler = analysisResult.Analysis.BuildContext.Scheduler
		}
		if len(buildContext.BuildTags) == 0 {
			buildContext.BuildTags = append([]string{}, analysisResult.Analysis.BuildContext.BuildTags...)
		}
		if buildContext.ModulePath == "" {
			buildContext.ModulePath = analysisResult.Analysis.BuildContext.ModulePath
		}
	}
	modulePath := adapterResult.Adapter.BuildContext.ModulePath
	if modulePath == "" && analysisAvailable {
		modulePath = analysisResult.Analysis.ModulePath
	}
	entryFile := adapterResult.Adapter.EntryFile
	if entryFile == "" && analysisAvailable {
		entryFile = analysisResult.Analysis.EntryFile
	}
	optimizeFlag := adapterResult.Adapter.OptimizeFlag
	if optimizeFlag == "" && analysisAvailable {
		optimizeFlag = analysisResult.Analysis.OptimizeFlag
	}
	toolchain := Toolchain{
		Target:              adapterResult.Adapter.Toolchain.Target,
		LLVMTarget:          adapterResult.Adapter.Toolchain.LLVMTarget,
		Linker:              adapterResult.Adapter.Toolchain.Linker,
		CFlags:              append([]string{}, adapterResult.Adapter.Toolchain.CFlags...),
		LDFlags:             append([]string{}, adapterResult.Adapter.Toolchain.LDFlags...),
		TranslationUnitPath: adapterResult.Adapter.Toolchain.TranslationUnitPath,
		ObjectOutputPath:    adapterResult.Adapter.Toolchain.ObjectOutputPath,
		ArtifactOutputPath:  adapterResult.Adapter.Toolchain.ArtifactOutputPath,
	}
	if analysisAvailable {
		if toolchain.Target == "" {
			toolchain.Target = analysisResult.Analysis.Toolchain.Target
		}
		if toolchain.LLVMTarget == "" {
			toolchain.LLVMTarget = analysisResult.Analysis.Toolchain.LLVMTarget
		}
		if toolchain.Linker == "" {
			toolchain.Linker = analysisResult.Analysis.Toolchain.Linker
		}
		if len(toolchain.CFlags) == 0 {
			toolchain.CFlags = append([]string{}, analysisResult.Analysis.Toolchain.CFlags...)
		}
		if len(toolchain.LDFlags) == 0 {
			toolchain.LDFlags = append([]string{}, analysisResult.Analysis.Toolchain.LDFlags...)
		}
		if toolchain.TranslationUnitPath == "" {
			toolchain.TranslationUnitPath = analysisResult.Analysis.Toolchain.TranslationUnitPath
		}
		if toolchain.ObjectOutputPath == "" {
			toolchain.ObjectOutputPath = analysisResult.Analysis.Toolchain.ObjectOutputPath
		}
		if toolchain.ArtifactOutputPath == "" {
			toolchain.ArtifactOutputPath = analysisResult.Analysis.Toolchain.ArtifactOutputPath
		}
	}
	result, err := Build(Input{
		BuildTags:    buildTags,
		BuildContext: buildContext,
		Toolchain:    toolchain,
		ModulePath:   modulePath,
		PackageGraph: append([]PackageGraphPackage{}, adapterResult.Adapter.PackageGraph...),
		OptimizeFlag: optimizeFlag,
		EntryFile:    entryFile,
		SourceSelection: SourceSelection{
			AllCompile: append([]string{}, adapterResult.Adapter.AllCompileFiles...),
		},
		CompileUnits: append([]IntermediateCompileUnit{}, adapterResult.Adapter.CompileUnits...),
	})
	if err != nil {
		failedResult := Result{
			OK:          false,
			Diagnostics: []string{err.Error()},
		}
		resultData, marshalErr := json.Marshal(failedResult)
		if marshalErr != nil {
			return marshalErr
		}
		if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
			return writeErr
		}
		return err
	}

	result.Diagnostics = []string{
		fmt.Sprintf("tinygo frontend prepared bootstrap compile request for %s", toolchain.Target),
	}
	resultData, err := json.Marshal(result)
	if err != nil {
		return err
	}

	return os.WriteFile(resultPath, resultData, 0o644)
}

func ExecuteAnalysisResultPaths(analysisPath, resultPath string) error {
	return ExecuteAnalysisBuildPaths(analysisPath, resultPath)
}

func ExecuteResultPaths(inputPath, analysisPath, adapterPath, resultPath string) error {
	if _, err := os.Stat(adapterPath); err == nil {
		if _, analysisErr := os.Stat(analysisPath); os.IsNotExist(analysisErr) {
			inputData, err := os.ReadFile(inputPath)
			if err != nil {
				return err
			}

			var input Input
			if err := json.Unmarshal(inputData, &input); err != nil {
				return err
			}

			adapterData, err := os.ReadFile(adapterPath)
			if err != nil {
				return err
			}

			var adapterResult AdapterResult
			if err := json.Unmarshal(adapterData, &adapterResult); err != nil {
				return err
			}
			if !adapterResult.OK || adapterResult.Adapter == nil {
				result := Result{
					OK:          false,
					Diagnostics: append([]string{}, adapterResult.Diagnostics...),
				}
				if len(result.Diagnostics) == 0 {
					result.Diagnostics = []string{"frontend real adapter result is required"}
				}
				resultData, marshalErr := json.Marshal(result)
				if marshalErr != nil {
					return marshalErr
				}
				if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
					return writeErr
				}
				return fmt.Errorf("%s", result.Diagnostics[0])
			}

			adapter := adapterResult.Adapter
			if adapter.Toolchain.Target != "" && input.Toolchain.Target != "" && adapter.Toolchain.Target != input.Toolchain.Target {
				result := Result{
					OK:          false,
					Diagnostics: []string{"frontend real adapter target did not match input"},
				}
				resultData, marshalErr := json.Marshal(result)
				if marshalErr != nil {
					return marshalErr
				}
				if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
					return writeErr
				}
				return fmt.Errorf("%s", result.Diagnostics[0])
			}
			if adapter.Toolchain.LLVMTarget != "" && input.BuildContext.LLVMTarget != "" && adapter.Toolchain.LLVMTarget != input.BuildContext.LLVMTarget {
				result := Result{
					OK:          false,
					Diagnostics: []string{"frontend real adapter llvmTarget did not match input"},
				}
				resultData, marshalErr := json.Marshal(result)
				if marshalErr != nil {
					return marshalErr
				}
				if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
					return writeErr
				}
				return fmt.Errorf("%s", result.Diagnostics[0])
			}

			buildTags := append([]string{}, adapter.BuildContext.BuildTags...)
			if len(buildTags) == 0 {
				buildTags = append([]string{}, input.BuildTags...)
			}
			buildContext := adapter.BuildContext
			if buildContext.Target == "" {
				buildContext = input.BuildContext
			}
			modulePath := buildContext.ModulePath
			if modulePath == "" {
				modulePath = input.ModulePath
			}
			entryFile := adapter.EntryFile
			if entryFile == "" {
				entryFile = input.EntryFile
			}
			toolchain := input.Toolchain
			if toolchain.Target == "" {
				toolchain.Target = adapter.Toolchain.Target
			}
			if toolchain.LLVMTarget == "" {
				toolchain.LLVMTarget = adapter.Toolchain.LLVMTarget
			}
			result, err := Build(Input{
				BuildTags:    buildTags,
				BuildContext: buildContext,
				Toolchain:    toolchain,
				ModulePath:   modulePath,
				PackageGraph: append([]PackageGraphPackage{}, adapter.PackageGraph...),
				OptimizeFlag: input.OptimizeFlag,
				EntryFile:    entryFile,
				SourceSelection: SourceSelection{
					AllCompile: append([]string{}, adapter.AllCompileFiles...),
				},
				CompileUnits: append([]IntermediateCompileUnit{}, adapter.CompileUnits...),
			})
			if err != nil {
				failedResult := Result{
					OK:          false,
					Diagnostics: []string{err.Error()},
				}
				resultData, marshalErr := json.Marshal(failedResult)
				if marshalErr != nil {
					return marshalErr
				}
				if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
					return writeErr
				}
				return err
			}

			result.Diagnostics = []string{
				fmt.Sprintf("tinygo frontend prepared bootstrap compile request for %s", toolchain.Target),
			}
			resultData, err := json.Marshal(result)
			if err != nil {
				return err
			}

			return os.WriteFile(resultPath, resultData, 0o644)
		} else if analysisErr != nil {
			return analysisErr
		}
		return ExecuteAdapterBuildPaths(analysisPath, adapterPath, resultPath)
	} else if !os.IsNotExist(err) {
		return err
	}

	if _, err := os.Stat(analysisPath); err == nil {
		if err := ExecuteAdapterAnalysisPaths(analysisPath, adapterPath); err != nil {
			return err
		}
		return ExecuteAdapterBuildPaths(analysisPath, adapterPath, resultPath)
	} else if !os.IsNotExist(err) {
		return err
	}

	return ExecutePaths(inputPath, resultPath)
}

func ExecuteAdapterPaths(inputPath, resultPath string) error {
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		return err
	}

	var input Input
	if err := json.Unmarshal(inputData, &input); err != nil {
		return err
	}

	adapter, err := BuildRealAdapter(input)
	if err != nil {
		failedResult := AdapterResult{
			OK:          false,
			Diagnostics: []string{err.Error()},
		}
		resultData, marshalErr := json.Marshal(failedResult)
		if marshalErr != nil {
			return marshalErr
		}
		if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
			return writeErr
		}
		return err
	}

	resultData, err := json.Marshal(AdapterResult{
		OK:      true,
		Adapter: &adapter,
		Diagnostics: []string{
			fmt.Sprintf("tinygo frontend prepared real adapter handoff for %s", adapter.Toolchain.Target),
		},
	})
	if err != nil {
		return err
	}

	return os.WriteFile(resultPath, resultData, 0o644)
}

func ExecuteAdapterAnalysisPaths(analysisPath, resultPath string) error {
	analysisData, err := os.ReadFile(analysisPath)
	if err != nil {
		return err
	}

	var analysisResult AnalysisResult
	if err := json.Unmarshal(analysisData, &analysisResult); err != nil {
		return err
	}
	if !analysisResult.OK || analysisResult.Analysis == nil {
		result := AdapterResult{
			OK:          false,
			Diagnostics: append([]string{}, analysisResult.Diagnostics...),
		}
		if len(result.Diagnostics) == 0 {
			result.Diagnostics = []string{"frontend analysis result is required"}
		}
		resultData, marshalErr := json.Marshal(result)
		if marshalErr != nil {
			return marshalErr
		}
		if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
			return writeErr
		}
		return fmt.Errorf("%s", result.Diagnostics[0])
	}

	adapter, err := AdaptReal(*analysisResult.Analysis)
	if err != nil {
		failedResult := AdapterResult{
			OK:          false,
			Diagnostics: []string{err.Error()},
		}
		resultData, marshalErr := json.Marshal(failedResult)
		if marshalErr != nil {
			return marshalErr
		}
		if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
			return writeErr
		}
		return err
	}

	resultData, err := json.Marshal(AdapterResult{
		OK:      true,
		Adapter: &adapter,
		Diagnostics: []string{
			fmt.Sprintf("tinygo frontend prepared real adapter handoff for %s", adapter.Toolchain.Target),
		},
	})
	if err != nil {
		return err
	}

	return os.WriteFile(resultPath, resultData, 0o644)
}

func ExecutePaths(inputPath, resultPath string) error {
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		return err
	}

	var input Input
	if err := json.Unmarshal(inputData, &input); err != nil {
		return err
	}

	analysis, err := Analyze(input)
	if err != nil {
		failedResult := Result{
			OK:          false,
			Diagnostics: []string{err.Error()},
		}
		resultData, marshalErr := json.Marshal(failedResult)
		if marshalErr != nil {
			return marshalErr
		}
		if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
			return writeErr
		}
		return err
	}

	result, err := BuildFromAnalysis(analysis)
	if err != nil {
		failedResult := Result{
			OK:          false,
			Diagnostics: []string{err.Error()},
		}
		resultData, marshalErr := json.Marshal(failedResult)
		if marshalErr != nil {
			return marshalErr
		}
		if writeErr := os.WriteFile(resultPath, resultData, 0o644); writeErr != nil {
			return writeErr
		}
		return err
	}

	resultData, err := json.Marshal(result)
	if err != nil {
		return err
	}

	return os.WriteFile(resultPath, resultData, 0o644)
}
