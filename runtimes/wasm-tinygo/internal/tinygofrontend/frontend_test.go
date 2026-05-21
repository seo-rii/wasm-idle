package tinygofrontend

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestSourceSelectionOmitsLegacyDerivedGroups(t *testing.T) {
	sourceSelectionType := reflect.TypeOf(SourceSelection{})
	for _, field := range []string{
		"TargetAssets",
		"RuntimeSupport",
		"Program",
		"Imported",
		"Stdlib",
	} {
		if _, ok := sourceSelectionType.FieldByName(field); ok {
			t.Fatalf("expected SourceSelection to omit legacy field %q", field)
		}
	}
}

func analysisSplitTestInput() Input {
	return Input{
		BuildTags: []string{"tinygo.wasm", "scheduler.tasks"},
		BuildContext: BuildContext{
			Target:     "wasm",
			LLVMTarget: "wasm32-unknown-wasi",
			GOOS:       "js",
			GOARCH:     "wasm",
			GC:         "precise",
			Scheduler:  "tasks",
			BuildTags:  []string{"scheduler.tasks", "tinygo.wasm"},
			ModulePath: "example.com/app",
		},
		OptimizeFlag: "-Oz",
		EntryFile:    "/workspace/main.go",
		ModulePath:   "example.com/app",
		PackageGraph: []PackageGraphPackage{
			{
				DepOnly:    false,
				Dir:        "/workspace",
				Files:      PackageGraphFiles{GoFiles: []string{"main.go"}},
				ImportPath: "command-line-arguments",
				Imports:    []string{"example.com/app/lib"},
				ModulePath: "example.com/app",
				Name:       "main",
				Standard:   false,
			},
			{
				DepOnly:    true,
				Dir:        "/workspace/lib",
				Files:      PackageGraphFiles{GoFiles: []string{"helper.go"}},
				ImportPath: "example.com/app/lib",
				Imports:    []string{"fmt"},
				ModulePath: "example.com/app",
				Name:       "helper",
				Standard:   false,
			},
			{
				DepOnly:    true,
				Dir:        "/working/.tinygo-root/src/fmt",
				Files:      PackageGraphFiles{GoFiles: []string{"print.go"}},
				ImportPath: "fmt",
				Imports:    []string{"errors", "io"},
				ModulePath: "",
				Name:       "fmt",
				Standard:   true,
			},
		},
		Toolchain: Toolchain{
			Target:             "wasm",
			ArtifactOutputPath: "/working/out.wasm",
		},
		SourceSelection: SourceSelection{
			AllCompile: []string{
				"/working/.tinygo-root/src/fmt/print.go",
				"/workspace/lib/helper.go",
				"/workspace/main.go",
			},
		},
		CompileUnits: []IntermediateCompileUnit{
			{Kind: "program", ImportPath: "command-line-arguments", Imports: []string{"example.com/app/lib"}, ModulePath: "example.com/app", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}},
			{Kind: "imported", ImportPath: "example.com/app/lib", Imports: []string{"fmt"}, ModulePath: "example.com/app", PackageName: "helper", PackageDir: "/workspace/lib", Files: []string{"/workspace/lib/helper.go"}},
			{Kind: "stdlib", ImportPath: "fmt", Imports: []string{"errors", "io"}, ModulePath: "", PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}},
		},
	}
}

func upstreamFrontendProbeTestResult() *UpstreamFrontendProbeResult {
	return &UpstreamFrontendProbeResult{
		RequestedTarget:  "wasip1",
		MainImportPath:   "command-line-arguments",
		MainPackageName:  "main",
		PackageCount:     3,
		FileCount:        3,
		DeclarationCount: 7,
		Imports:          []string{"example.com/app/lib"},
		Packages: []UpstreamFrontendProbePackage{
			{
				ImportPath: "command-line-arguments",
				Name:       "main",
				FileCount:  1,
				Imports:    []string{"example.com/app/lib"},
			},
			{
				ImportPath: "example.com/app/lib",
				Name:       "helper",
				FileCount:  1,
				Imports:    []string{"fmt"},
			},
			{
				ImportPath: "fmt",
				Name:       "fmt",
				FileCount:  1,
				Imports:    []string{"errors", "io"},
			},
		},
	}
}

func TestAnalyzeNormalizesFrontendBuildState(t *testing.T) {
	analysis, err := Analyze(analysisSplitTestInput())
	if err != nil {
		t.Fatalf("Analyze returned error: %v", err)
	}

	if analysis.EntryFile != "/workspace/main.go" {
		t.Fatalf("unexpected analysis entry file: %#v", analysis)
	}
	if !reflect.DeepEqual(analysis.BuildTags, []string{"scheduler.tasks", "tinygo.wasm"}) {
		t.Fatalf("unexpected analysis build tags: %#v", analysis.BuildTags)
	}
	if analysis.Toolchain.Target != "wasm" ||
		analysis.Toolchain.LLVMTarget != "wasm32-unknown-wasi" ||
		analysis.Toolchain.Linker != "wasm-ld" ||
		analysis.Toolchain.TranslationUnitPath != "/working/tinygo-bootstrap.c" ||
		analysis.Toolchain.ObjectOutputPath != "/working/tinygo-bootstrap.o" ||
		analysis.Toolchain.ArtifactOutputPath != "/working/out.wasm" {
		t.Fatalf("unexpected analysis toolchain: %#v", analysis.Toolchain)
	}
	if !reflect.DeepEqual(analysis.TargetAssets, []string{
		"/working/.tinygo-root/targets/wasm-undefined.txt",
		"/working/.tinygo-root/targets/wasm.json",
	}) {
		t.Fatalf("unexpected analysis target assets: %#v", analysis.TargetAssets)
	}
	if !reflect.DeepEqual(analysis.RuntimeSupport, []string{
		"/working/.tinygo-root/src/device/arm/arm.go",
		"/working/.tinygo-root/src/runtime/asm_tinygowasm.S",
		"/working/.tinygo-root/src/runtime/gc_boehm.c",
		"/working/.tinygo-root/src/runtime/internal/sys/zversion.go",
	}) {
		t.Fatalf("unexpected analysis runtime support: %#v", analysis.RuntimeSupport)
	}
	if len(analysis.CompileGroups) != 6 {
		t.Fatalf("unexpected analysis compile groups: %#v", analysis.CompileGroups)
	}
	if !reflect.DeepEqual(analysis.CompileUnits, []IntermediateCompileUnit{
		{DepOnly: false, Kind: "program", ImportPath: "command-line-arguments", Imports: []string{"example.com/app/lib"}, ModulePath: "example.com/app", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}, Standard: false},
		{DepOnly: true, Kind: "imported", ImportPath: "example.com/app/lib", Imports: []string{"fmt"}, ModulePath: "example.com/app", PackageName: "helper", PackageDir: "/workspace/lib", Files: []string{"/workspace/lib/helper.go"}, Standard: false},
		{DepOnly: true, Kind: "stdlib", ImportPath: "fmt", Imports: []string{"errors", "io"}, ModulePath: "", PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}, Standard: true},
	}) {
		t.Fatalf("unexpected analysis compile units: %#v", analysis.CompileUnits)
	}
	if !reflect.DeepEqual(analysis.BuildContext, BuildContext{
		Target:     "wasm",
		LLVMTarget: "wasm32-unknown-wasi",
		GOOS:       "js",
		GOARCH:     "wasm",
		GC:         "precise",
		Scheduler:  "tasks",
		BuildTags:  []string{"scheduler.tasks", "tinygo.wasm"},
		ModulePath: "example.com/app",
	}) {
		t.Fatalf("unexpected analysis build context: %#v", analysis.BuildContext)
	}
	if !reflect.DeepEqual(analysis.PackageGraph, []PackageGraphPackage{
		{DepOnly: false, Dir: "/workspace", Files: PackageGraphFiles{GoFiles: []string{"main.go"}}, ImportPath: "command-line-arguments", Imports: []string{"example.com/app/lib"}, ModulePath: "example.com/app", Name: "main", Standard: false},
		{DepOnly: true, Dir: "/workspace/lib", Files: PackageGraphFiles{GoFiles: []string{"helper.go"}}, ImportPath: "example.com/app/lib", Imports: []string{"fmt"}, ModulePath: "example.com/app", Name: "helper", Standard: false},
		{DepOnly: true, Dir: "/working/.tinygo-root/src/fmt", Files: PackageGraphFiles{GoFiles: []string{"print.go"}}, ImportPath: "fmt", Imports: []string{"errors", "io"}, ModulePath: "", Name: "fmt", Standard: true},
	}) {
		t.Fatalf("unexpected analysis package graph: %#v", analysis.PackageGraph)
	}
}

func TestAnalyzePreservesUpstreamFrontendProbeFacts(t *testing.T) {
	input := analysisSplitTestInput()
	input.UpstreamFrontendProbe = upstreamFrontendProbeTestResult()

	analysis, err := Analyze(input)
	if err != nil {
		t.Fatalf("Analyze returned error: %v", err)
	}

	if !reflect.DeepEqual(analysis.UpstreamFrontendProbe, input.UpstreamFrontendProbe) {
		t.Fatalf("unexpected analysis upstream frontend probe: %#v", analysis.UpstreamFrontendProbe)
	}
	input.UpstreamFrontendProbe.Packages[0].Imports[0] = "changed"
	if reflect.DeepEqual(analysis.UpstreamFrontendProbe, input.UpstreamFrontendProbe) {
		t.Fatalf("analysis upstream frontend probe aliased input: %#v", analysis.UpstreamFrontendProbe)
	}

	adapter, err := BuildRealAdapter(analysisSplitTestInputWithUpstreamFrontendProbe())
	if err != nil {
		t.Fatalf("BuildRealAdapter returned error: %v", err)
	}
	if !reflect.DeepEqual(adapter.UpstreamFrontendProbe, analysis.UpstreamFrontendProbe) {
		t.Fatalf("unexpected adapter upstream frontend probe: %#v", adapter.UpstreamFrontendProbe)
	}
}

func analysisSplitTestInputWithUpstreamFrontendProbe() Input {
	input := analysisSplitTestInput()
	input.UpstreamFrontendProbe = upstreamFrontendProbeTestResult()
	return input
}

func TestAnalyzeRejectsMismatchedUpstreamFrontendProbeFacts(t *testing.T) {
	input := analysisSplitTestInput()
	input.UpstreamFrontendProbe = upstreamFrontendProbeTestResult()
	input.UpstreamFrontendProbe.Packages[1].Imports = []string{"io"}

	_, err := Analyze(input)
	if err == nil {
		t.Fatal("Analyze succeeded without matching upstream frontend probe facts")
	}
	if !strings.Contains(err.Error(), "upstream frontend probe package summaries did not match frontend analysis") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestAnalyzeNormalizesProgramAliasAgainstPackageGraph(t *testing.T) {
	input := analysisSplitTestInput()
	input.CompileUnits[0].Imports = nil
	input.PackageGraph[0].ImportPath = "example.com/app"

	analysis, err := Analyze(input)
	if err != nil {
		t.Fatalf("Analyze returned error: %v", err)
	}

	if got := analysis.CompileUnits[0].ImportPath; got != "example.com/app" {
		t.Fatalf("unexpected program import path: %q", got)
	}
	if !reflect.DeepEqual(analysis.CompileUnits[0].Imports, []string{"example.com/app/lib"}) {
		t.Fatalf("unexpected program imports: %#v", analysis.CompileUnits[0].Imports)
	}
	if got := analysis.PackageGraph[0].ImportPath; got != "example.com/app" {
		t.Fatalf("unexpected package graph import path: %q", got)
	}
}

func TestAnalyzeSynthesizesCompileUnitsFromPackageGraphWhenCompileUnitsAreOmitted(t *testing.T) {
	input := analysisSplitTestInput()
	input.CompileUnits = nil
	input.PackageGraph[0].ImportPath = "example.com/app"

	analysis, err := Analyze(input)
	if err != nil {
		t.Fatalf("Analyze returned error: %v", err)
	}

	if !reflect.DeepEqual(analysis.CompileUnits, []IntermediateCompileUnit{
		{DepOnly: false, Kind: "program", ImportPath: "example.com/app", Imports: []string{"example.com/app/lib"}, ModulePath: "example.com/app", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}, Standard: false},
		{DepOnly: true, Kind: "imported", ImportPath: "example.com/app/lib", Imports: []string{"fmt"}, ModulePath: "example.com/app", PackageName: "helper", PackageDir: "/workspace/lib", Files: []string{"/workspace/lib/helper.go"}, Standard: false},
		{DepOnly: true, Kind: "stdlib", ImportPath: "fmt", Imports: []string{"errors", "io"}, ModulePath: "", PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}, Standard: true},
	}) {
		t.Fatalf("unexpected synthesized compile units: %#v", analysis.CompileUnits)
	}
	if len(analysis.CompileGroups) != 6 {
		t.Fatalf("unexpected analysis compile groups: %#v", analysis.CompileGroups)
	}
	if !reflect.DeepEqual(analysis.AllCompileFiles, []string{
		"/working/.tinygo-root/src/fmt/print.go",
		"/workspace/lib/helper.go",
		"/workspace/main.go",
	}) {
		t.Fatalf("unexpected all compile files: %#v", analysis.AllCompileFiles)
	}
}

func TestAnalyzePreservesCompileUnitModulePathsFromPackageGraph(t *testing.T) {
	input := analysisSplitTestInput()
	input.CompileUnits = nil
	input.PackageGraph[0].ImportPath = "example.com/app"

	analysis, err := Analyze(input)
	if err != nil {
		t.Fatalf("Analyze returned error: %v", err)
	}

	if !reflect.DeepEqual(analysis.CompileUnits, []IntermediateCompileUnit{
		{DepOnly: false, Kind: "program", ImportPath: "example.com/app", Imports: []string{"example.com/app/lib"}, ModulePath: "example.com/app", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}, Standard: false},
		{DepOnly: true, Kind: "imported", ImportPath: "example.com/app/lib", Imports: []string{"fmt"}, ModulePath: "example.com/app", PackageName: "helper", PackageDir: "/workspace/lib", Files: []string{"/workspace/lib/helper.go"}, Standard: false},
		{DepOnly: true, Kind: "stdlib", ImportPath: "fmt", Imports: []string{"errors", "io"}, ModulePath: "", PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}, Standard: true},
	}) {
		t.Fatalf("unexpected synthesized compile-unit module paths: %#v", analysis.CompileUnits)
	}
}

func TestAdaptRealFillsProgramFactsFromAnalysisPackageGraph(t *testing.T) {
	analysis, err := Analyze(analysisSplitTestInput())
	if err != nil {
		t.Fatalf("Analyze returned error: %v", err)
	}

	analysis.CompileUnits[0].Imports = nil
	analysis.CompileUnits[0].PackageName = ""

	adapter, err := AdaptReal(analysis)
	if err != nil {
		t.Fatalf("AdaptReal returned error: %v", err)
	}

	if !reflect.DeepEqual(adapter.CompileUnits, []IntermediateCompileUnit{
		{DepOnly: false, Kind: "program", ImportPath: "command-line-arguments", Imports: []string{"example.com/app/lib"}, ModulePath: "example.com/app", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}, Standard: false},
		{DepOnly: true, Kind: "imported", ImportPath: "example.com/app/lib", Imports: []string{"fmt"}, ModulePath: "example.com/app", PackageName: "helper", PackageDir: "/workspace/lib", Files: []string{"/workspace/lib/helper.go"}, Standard: false},
		{DepOnly: true, Kind: "stdlib", ImportPath: "fmt", Imports: []string{"errors", "io"}, ModulePath: "", PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}, Standard: true},
	}) {
		t.Fatalf("unexpected adapter compile units: %#v", adapter.CompileUnits)
	}
	if !reflect.DeepEqual(adapter.BuildContext, analysis.BuildContext) {
		t.Fatalf("unexpected adapter build context: %#v", adapter.BuildContext)
	}
	if !reflect.DeepEqual(adapter.PackageGraph, analysis.PackageGraph) {
		t.Fatalf("unexpected adapter package graph: %#v", adapter.PackageGraph)
	}
}

func TestBuildRealAdapterProducesPackageFocusedHandoff(t *testing.T) {
	adapter, err := BuildRealAdapter(analysisSplitTestInput())
	if err != nil {
		t.Fatalf("BuildRealAdapter returned error: %v", err)
	}

	if adapter.EntryFile != "/workspace/main.go" {
		t.Fatalf("unexpected adapter entry file: %#v", adapter)
	}
	if adapter.CompileUnitManifestPath != "/working/tinygo-compile-unit.json" {
		t.Fatalf("unexpected adapter compile unit manifest path: %#v", adapter)
	}
	if !reflect.DeepEqual(adapter.AllCompileFiles, []string{
		"/working/.tinygo-root/src/fmt/print.go",
		"/workspace/lib/helper.go",
		"/workspace/main.go",
	}) {
		t.Fatalf("unexpected adapter all-compile files: %#v", adapter.AllCompileFiles)
	}
	if !reflect.DeepEqual(adapter.CompileGroups, []CompileGroup{
		{Name: "program", Files: []string{"/workspace/main.go"}},
		{Name: "imported", Files: []string{"/workspace/lib/helper.go"}},
		{Name: "stdlib", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}},
		{Name: "all-compile", Files: []string{"/working/.tinygo-root/src/fmt/print.go", "/workspace/lib/helper.go", "/workspace/main.go"}},
	}) {
		t.Fatalf("unexpected adapter compile groups: %#v", adapter.CompileGroups)
	}
	if !reflect.DeepEqual(adapter.CompileUnits, []IntermediateCompileUnit{
		{DepOnly: false, Kind: "program", ImportPath: "command-line-arguments", Imports: []string{"example.com/app/lib"}, ModulePath: "example.com/app", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}, Standard: false},
		{DepOnly: true, Kind: "imported", ImportPath: "example.com/app/lib", Imports: []string{"fmt"}, ModulePath: "example.com/app", PackageName: "helper", PackageDir: "/workspace/lib", Files: []string{"/workspace/lib/helper.go"}, Standard: false},
		{DepOnly: true, Kind: "stdlib", ImportPath: "fmt", Imports: []string{"errors", "io"}, ModulePath: "", PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}, Standard: true},
	}) {
		t.Fatalf("unexpected adapter compile units: %#v", adapter.CompileUnits)
	}
	if !reflect.DeepEqual(adapter.BuildContext, BuildContext{
		Target:     "wasm",
		LLVMTarget: "wasm32-unknown-wasi",
		GOOS:       "js",
		GOARCH:     "wasm",
		GC:         "precise",
		Scheduler:  "tasks",
		BuildTags:  []string{"scheduler.tasks", "tinygo.wasm"},
		ModulePath: "example.com/app",
	}) {
		t.Fatalf("unexpected adapter build context: %#v", adapter.BuildContext)
	}
	if !reflect.DeepEqual(adapter.PackageGraph, []PackageGraphPackage{
		{DepOnly: false, Dir: "/workspace", Files: PackageGraphFiles{GoFiles: []string{"main.go"}}, ImportPath: "command-line-arguments", Imports: []string{"example.com/app/lib"}, ModulePath: "example.com/app", Name: "main", Standard: false},
		{DepOnly: true, Dir: "/workspace/lib", Files: PackageGraphFiles{GoFiles: []string{"helper.go"}}, ImportPath: "example.com/app/lib", Imports: []string{"fmt"}, ModulePath: "example.com/app", Name: "helper", Standard: false},
		{DepOnly: true, Dir: "/working/.tinygo-root/src/fmt", Files: PackageGraphFiles{GoFiles: []string{"print.go"}}, ImportPath: "fmt", Imports: []string{"errors", "io"}, ModulePath: "", Name: "fmt", Standard: true},
	}) {
		t.Fatalf("unexpected adapter package graph: %#v", adapter.PackageGraph)
	}
}

func TestBuildRealAdapterFillsMissingCompileUnitFactsFromPackageGraph(t *testing.T) {
	input := analysisSplitTestInput()
	input.CompileUnits = []IntermediateCompileUnit{
		{Kind: "program", ImportPath: "command-line-arguments", Files: []string{"/workspace/main.go"}},
		{Kind: "imported", ImportPath: "example.com/app/lib", Files: []string{"/workspace/lib/helper.go"}},
		{Kind: "stdlib", ImportPath: "fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}},
	}

	adapter, err := BuildRealAdapter(input)
	if err != nil {
		t.Fatalf("BuildRealAdapter returned error: %v", err)
	}

	if !reflect.DeepEqual(adapter.CompileUnits, []IntermediateCompileUnit{
		{DepOnly: false, Kind: "program", ImportPath: "command-line-arguments", Imports: []string{"example.com/app/lib"}, ModulePath: "example.com/app", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}, Standard: false},
		{DepOnly: true, Kind: "imported", ImportPath: "example.com/app/lib", Imports: []string{"fmt"}, ModulePath: "example.com/app", PackageName: "helper", PackageDir: "/workspace/lib", Files: []string{"/workspace/lib/helper.go"}, Standard: false},
		{DepOnly: true, Kind: "stdlib", ImportPath: "fmt", Imports: []string{"errors", "io"}, ModulePath: "", PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}, Standard: true},
	}) {
		t.Fatalf("unexpected adapter compile units: %#v", adapter.CompileUnits)
	}
}

func TestBuildRealAdapterRejectsMismatchedPackageGraphFacts(t *testing.T) {
	input := analysisSplitTestInput()
	input.CompileUnits = []IntermediateCompileUnit{
		{Kind: "program", ImportPath: "command-line-arguments", Imports: []string{"example.com/app/lib"}, PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}},
		{Kind: "imported", ImportPath: "example.com/app/lib", Imports: []string{"io"}, PackageName: "helper", PackageDir: "/workspace/lib", Files: []string{"/workspace/lib/helper.go"}},
		{Kind: "stdlib", ImportPath: "fmt", Imports: []string{"errors", "io"}, PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}},
	}

	_, err := BuildRealAdapter(input)
	if err == nil {
		t.Fatal("BuildRealAdapter succeeded without matching package graph facts")
	}
	if !strings.Contains(err.Error(), `compile unit "example.com/app/lib" imports do not match package graph`) {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildRealAdapterMatchesAnalysisSeamForCanonicalProgramPackageGraph(t *testing.T) {
	input := analysisSplitTestInput()
	input.PackageGraph[0].ImportPath = "example.com/app"

	analysis, err := Analyze(input)
	if err != nil {
		t.Fatalf("Analyze returned error: %v", err)
	}

	adapterFromAnalysis, err := AdaptReal(analysis)
	if err != nil {
		t.Fatalf("AdaptReal returned error: %v", err)
	}

	adapterFromInput, err := BuildRealAdapter(input)
	if err != nil {
		t.Fatalf("BuildRealAdapter returned error: %v", err)
	}

	if !reflect.DeepEqual(adapterFromInput, adapterFromAnalysis) {
		t.Fatalf("direct adapter did not match analysis seam:\nfrom input: %#v\nfrom analysis: %#v", adapterFromInput, adapterFromAnalysis)
	}
}

func TestBuildRealAdapterMatchesPackageGraphOnlyAnalysisSeamForCanonicalProgramPackageGraph(t *testing.T) {
	input := analysisSplitTestInput()
	input.PackageGraph[0].ImportPath = "example.com/app"
	for index := range input.CompileUnits {
		if input.CompileUnits[index].Kind == "stdlib" {
			input.CompileUnits[index].Imports = nil
		}
	}

	analysisInput := input
	analysisInput.CompileUnits = nil

	analysis, err := Analyze(analysisInput)
	if err != nil {
		t.Fatalf("Analyze returned error: %v", err)
	}

	adapterFromAnalysis, err := AdaptReal(analysis)
	if err != nil {
		t.Fatalf("AdaptReal returned error: %v", err)
	}

	adapterFromInput, err := BuildRealAdapter(input)
	if err != nil {
		t.Fatalf("BuildRealAdapter returned error: %v", err)
	}

	if !reflect.DeepEqual(adapterFromInput, adapterFromAnalysis) {
		t.Fatalf("direct adapter did not match packageGraph-only analysis seam:\nfrom input: %#v\nfrom analysis: %#v", adapterFromInput, adapterFromAnalysis)
	}
}

func TestEmitSyntheticMatchesBuildForAnalyzedInput(t *testing.T) {
	input := analysisSplitTestInput()

	analysis, err := Analyze(input)
	if err != nil {
		t.Fatalf("Analyze returned error: %v", err)
	}
	resultFromAnalysis, err := EmitSynthetic(analysis)
	if err != nil {
		t.Fatalf("EmitSynthetic returned error: %v", err)
	}
	resultFromBuild, err := Build(input)
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !reflect.DeepEqual(resultFromAnalysis, resultFromBuild) {
		t.Fatalf("unexpected emit result diff:\nanalysis=%#v\nbuild=%#v", resultFromAnalysis, resultFromBuild)
	}
}

func TestBuildFromAnalysisMatchesBuildForAnalyzedInput(t *testing.T) {
	input := analysisSplitTestInput()

	analysis, err := Analyze(input)
	if err != nil {
		t.Fatalf("Analyze returned error: %v", err)
	}
	resultFromAnalysis, err := BuildFromAnalysis(analysis)
	if err != nil {
		t.Fatalf("BuildFromAnalysis returned error: %v", err)
	}
	resultFromBuild, err := Build(input)
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !reflect.DeepEqual(resultFromAnalysis, resultFromBuild) {
		t.Fatalf("unexpected analysis build result diff:\nanalysis=%#v\nbuild=%#v", resultFromAnalysis, resultFromBuild)
	}
}

func TestBuildProducesCompileGroups(t *testing.T) {
	result, err := Build(Input{
		BuildTags: []string{"scheduler.tasks", "tinygo.wasm"},
		BuildContext: BuildContext{
			Target:     "wasm",
			LLVMTarget: "wasm32-unknown-wasi",
			GOOS:       "js",
			GOARCH:     "wasm",
			GC:         "precise",
			Scheduler:  "tasks",
			BuildTags:  []string{"scheduler.tasks", "tinygo.wasm"},
			ModulePath: "example.com/app",
		},
		OptimizeFlag: "-Oz",
		EntryFile:    "/workspace/main.go",
		ModulePath:   "example.com/app",
		PackageGraph: []PackageGraphPackage{
			{
				DepOnly:    false,
				Dir:        "/workspace",
				Files:      PackageGraphFiles{GoFiles: []string{"main.go"}},
				ImportPath: "command-line-arguments",
				Imports:    []string{"example.com/app/lib"},
				Name:       "main",
				Standard:   false,
			},
			{
				DepOnly:    true,
				Dir:        "/workspace/lib",
				Files:      PackageGraphFiles{GoFiles: []string{"helper.go"}},
				ImportPath: "example.com/app/lib",
				Imports:    []string{"fmt"},
				Name:       "helper",
				Standard:   false,
			},
			{
				DepOnly:    true,
				Dir:        "/working/.tinygo-root/src/fmt",
				Files:      PackageGraphFiles{GoFiles: []string{"print.go"}},
				ImportPath: "fmt",
				Imports:    []string{"errors", "io"},
				Name:       "fmt",
				Standard:   true,
			},
		},
		Toolchain: Toolchain{
			Target:             "wasm",
			ArtifactOutputPath: "/working/out.wasm",
		},
		SourceSelection: SourceSelection{
			AllCompile: []string{
				"/working/.tinygo-root/src/fmt/print.go",
				"/workspace/lib/helper.go",
				"/workspace/main.go",
			},
		},
		CompileUnits: []IntermediateCompileUnit{
			{Kind: "program", ImportPath: "command-line-arguments", Imports: []string{"example.com/app/lib"}, PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}},
			{Kind: "imported", ImportPath: "example.com/app/lib", Imports: []string{"fmt"}, PackageName: "helper", PackageDir: "/workspace/lib", Files: []string{"/workspace/lib/helper.go"}},
			{Kind: "stdlib", ImportPath: "fmt", Imports: []string{"errors", "io"}, PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}},
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	if !result.OK {
		t.Fatalf("unexpected result: %#v", result)
	}
	if len(result.GeneratedFiles) != 7 {
		t.Fatalf("unexpected generated files: %#v", result.GeneratedFiles)
	}
	if !reflect.DeepEqual([]string{result.GeneratedFiles[0].Path, result.GeneratedFiles[1].Path, result.GeneratedFiles[2].Path, result.GeneratedFiles[3].Path, result.GeneratedFiles[4].Path, result.GeneratedFiles[5].Path, result.GeneratedFiles[6].Path}, []string{
		"/working/tinygo-bootstrap.c",
		"/working/tinygo-compile-unit.json",
		"/working/tinygo-intermediate.json",
		"/working/tinygo-lowering-input.json",
		"/working/tinygo-work-items.json",
		"/working/tinygo-lowering-plan.json",
		"/working/tinygo-backend-input.json",
	}) {
		t.Fatalf("unexpected generated files: %#v", result.GeneratedFiles)
	}
	if !strings.Contains(result.GeneratedFiles[1].Contents, "\"entryFile\":\"/workspace/main.go\"") ||
		!strings.Contains(result.GeneratedFiles[1].Contents, "\"toolchain\":{\"target\":\"wasm\",\"artifactOutputPath\":\"/working/out.wasm\"}") ||
		!strings.Contains(result.GeneratedFiles[1].Contents, "\"compileUnits\":[{\"kind\":\"program\",\"importPath\":\"command-line-arguments\",\"imports\":[\"example.com/app/lib\"],\"modulePath\":\"example.com/app\",\"depOnly\":false,\"packageName\":\"main\",\"packageDir\":\"/workspace\",\"files\":[\"/workspace/main.go\"],\"standard\":false},{\"kind\":\"imported\",\"importPath\":\"example.com/app/lib\",\"imports\":[\"fmt\"],\"modulePath\":\"example.com/app\",\"depOnly\":true,\"packageName\":\"helper\",\"packageDir\":\"/workspace/lib\",\"files\":[\"/workspace/lib/helper.go\"],\"standard\":false},{\"kind\":\"stdlib\",\"importPath\":\"fmt\",\"imports\":[\"errors\",\"io\"],\"modulePath\":\"\",\"depOnly\":true,\"packageName\":\"fmt\",\"packageDir\":\"/working/.tinygo-root/src/fmt\",\"files\":[\"/working/.tinygo-root/src/fmt/print.go\"],\"standard\":true}]") ||
		!strings.Contains(result.GeneratedFiles[1].Contents, "\"sourceSelection\":{\"allCompile\":[\"/working/.tinygo-root/src/fmt/print.go\",\"/workspace/lib/helper.go\",\"/workspace/main.go\"]}") ||
		!strings.Contains(result.GeneratedFiles[1].Contents, "\"allCompile\":[\"/working/.tinygo-root/src/fmt/print.go\",\"/workspace/lib/helper.go\",\"/workspace/main.go\"]") ||
		!strings.Contains(result.GeneratedFiles[1].Contents, "\"materializedFiles\":[\"/working/.tinygo-root/src/device/arm/arm.go\"") {
		t.Fatalf("unexpected compile unit manifest: %q", result.GeneratedFiles[1].Contents)
	}
	if strings.Contains(result.GeneratedFiles[1].Contents, "\"packageLayout\":") {
		t.Fatalf("expected compile unit manifest to omit package layout: %q", result.GeneratedFiles[1].Contents)
	}
	if strings.Contains(result.GeneratedFiles[1].Contents, "\"checksum\":") {
		t.Fatalf("expected compile unit manifest to omit checksum: %q", result.GeneratedFiles[1].Contents)
	}
	if strings.Contains(result.GeneratedFiles[1].Contents, "\"mode\":") {
		t.Fatalf("expected compile unit manifest to omit mode: %q", result.GeneratedFiles[1].Contents)
	}
	if strings.Contains(result.GeneratedFiles[1].Contents, "\"program\":") {
		t.Fatalf("expected compile unit manifest to omit program group: %q", result.GeneratedFiles[1].Contents)
	}
	if strings.Contains(result.GeneratedFiles[1].Contents, "\"targetAssets\":") {
		t.Fatalf("expected compile unit manifest to omit target assets: %q", result.GeneratedFiles[1].Contents)
	}
	if strings.Contains(result.GeneratedFiles[1].Contents, "\"runtimeSupport\":") {
		t.Fatalf("expected compile unit manifest to omit runtime support: %q", result.GeneratedFiles[1].Contents)
	}
	if strings.Contains(result.GeneratedFiles[1].Contents, "\"imported\":") {
		t.Fatalf("expected compile unit manifest to omit imported group: %q", result.GeneratedFiles[1].Contents)
	}
	if strings.Contains(result.GeneratedFiles[1].Contents, "\"stdlib\":") {
		t.Fatalf("expected compile unit manifest to omit stdlib group: %q", result.GeneratedFiles[1].Contents)
	}
	for _, unexpected := range []string{
		"/working/tinygo-bootstrap.json",
		"/working/tinygo-frontend-input.json",
	} {
		if strings.Contains(result.GeneratedFiles[1].Contents, unexpected) {
			t.Fatalf("expected compile unit manifest to omit planner handoff file %q: %q", unexpected, result.GeneratedFiles[1].Contents)
		}
		if strings.Contains(result.GeneratedFiles[0].Contents, unexpected) {
			t.Fatalf("expected bootstrap source to omit planner handoff file %q: %q", unexpected, result.GeneratedFiles[0].Contents)
		}
	}
	for _, unexpected := range []string{
		"\"packageFileCount\":",
		"\"importedPackageFileCount\":",
		"\"stdlibPackageFileCount\":",
		"\"allFileCount\":",
		"\"targetAssetCount\":",
		"\"runtimeSupportFileCount\":",
		"\"programFileCount\":",
		"\"materializedFileCount\":",
	} {
		if strings.Contains(result.GeneratedFiles[1].Contents, unexpected) {
			t.Fatalf("expected compile unit manifest to omit %s: %q", unexpected, result.GeneratedFiles[1].Contents)
		}
	}
	var compileUnitManifest map[string]any
	if err := json.Unmarshal([]byte(result.GeneratedFiles[1].Contents), &compileUnitManifest); err != nil {
		t.Fatalf("json.Unmarshal(compile-unit): %v", err)
	}
	for _, key := range []string{
		"target",
		"llvmTarget",
		"linker",
		"modulePath",
		"imports",
		"buildTags",
		"translationUnitPath",
		"objectOutputPath",
		"artifactOutputPath",
		"packageFiles",
		"importedPackageFiles",
		"stdlibPackageFiles",
		"allFiles",
		"allCompileFiles",
		"targetAssetFiles",
		"runtimeSupportFiles",
		"programFiles",
		"packageFileCount",
		"importedPackageFileCount",
		"stdlibPackageFileCount",
		"allFileCount",
		"targetAssetCount",
		"runtimeSupportFileCount",
		"programFileCount",
		"materializedFileCount",
	} {
		if _, ok := compileUnitManifest[key]; ok {
			t.Fatalf("expected compile unit manifest to omit top-level %q: %#v", key, compileUnitManifest)
		}
	}
	if !strings.Contains(result.GeneratedFiles[0].Contents, "\"/workspace/lib/helper.go\"") ||
		!strings.Contains(result.GeneratedFiles[0].Contents, "\\\"materializedFiles\\\":[\\\"/working/.tinygo-root/src/device/arm/arm.go\\\"") {
		t.Fatalf("unexpected generated bootstrap source: %q", result.GeneratedFiles[0].Contents)
	}
	if strings.Contains(result.GeneratedFiles[0].Contents, "module: ") {
		t.Fatalf("expected bootstrap source to omit module comment: %q", result.GeneratedFiles[0].Contents)
	}
	if strings.Contains(result.GeneratedFiles[0].Contents, "unsigned int tinygo_dispatch_materialized_file_count(void)") {
		t.Fatalf("expected generated bootstrap source to omit materialized-file dispatch count export: %q", result.GeneratedFiles[0].Contents)
	}
	var intermediateManifest IntermediateManifest
	if err := json.Unmarshal([]byte(result.GeneratedFiles[2].Contents), &intermediateManifest); err != nil {
		t.Fatalf("json.Unmarshal(intermediate): %v", err)
	}
	if intermediateManifest.EntryFile != "/workspace/main.go" {
		t.Fatalf("unexpected intermediate manifest: %#v", intermediateManifest)
	}
	if intermediateManifest.ModulePath != "example.com/app" {
		t.Fatalf("unexpected intermediate module path: %#v", intermediateManifest)
	}
	if !reflect.DeepEqual(intermediateManifest.BuildTags, []string{"scheduler.tasks", "tinygo.wasm"}) {
		t.Fatalf("unexpected intermediate build tags: %#v", intermediateManifest)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "\"sourceSelection\":{\"targetAssets\":[\"/working/.tinygo-root/targets/wasm-undefined.txt\",\"/working/.tinygo-root/targets/wasm.json\"],\"runtimeSupport\":[\"/working/.tinygo-root/src/device/arm/arm.go\",\"/working/.tinygo-root/src/runtime/asm_tinygowasm.S\",\"/working/.tinygo-root/src/runtime/gc_boehm.c\",\"/working/.tinygo-root/src/runtime/internal/sys/zversion.go\"],\"program\":[\"/workspace/main.go\"],\"imported\":[\"/workspace/lib/helper.go\"],\"stdlib\":[\"/working/.tinygo-root/src/fmt/print.go\"],\"allCompile\":[\"/working/.tinygo-root/src/fmt/print.go\",\"/workspace/lib/helper.go\",\"/workspace/main.go\"]}") {
		t.Fatalf("unexpected intermediate manifest contents: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "\"toolchain\":{\"target\":\"wasm\",\"llvmTarget\":\"wasm32-unknown-wasi\",\"linker\":\"wasm-ld\",\"cflags\":[\"-mbulk-memory\",\"-mnontrapping-fptoint\",\"-mno-multivalue\",\"-mno-reference-types\",\"-msign-ext\"],\"ldflags\":[\"--stack-first\",\"--no-demangle\"],\"translationUnitPath\":\"/working/tinygo-bootstrap.c\",\"objectOutputPath\":\"/working/tinygo-bootstrap.o\",\"artifactOutputPath\":\"/working/out.wasm\"}") {
		t.Fatalf("unexpected intermediate toolchain contents: %q", result.GeneratedFiles[2].Contents)
	}
	if !reflect.DeepEqual(intermediateManifest.CompileUnits, []IntermediateCompileUnit{
		{DepOnly: false, Kind: "program", ImportPath: "command-line-arguments", Imports: []string{"example.com/app/lib"}, ModulePath: "example.com/app", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}, Standard: false},
		{DepOnly: true, Kind: "imported", ImportPath: "example.com/app/lib", Imports: []string{"fmt"}, ModulePath: "example.com/app", PackageName: "helper", PackageDir: "/workspace/lib", Files: []string{"/workspace/lib/helper.go"}, Standard: false},
		{DepOnly: true, Kind: "stdlib", ImportPath: "fmt", Imports: []string{"errors", "io"}, ModulePath: "", PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}, Standard: true},
	}) {
		t.Fatalf("unexpected intermediate compile units: %#v", intermediateManifest.CompileUnits)
	}
	var loweringManifest LoweringManifest
	if err := json.Unmarshal([]byte(result.GeneratedFiles[3].Contents), &loweringManifest); err != nil {
		t.Fatalf("json.Unmarshal(lowering): %v", err)
	}
	if loweringManifest.EntryFile != "/workspace/main.go" {
		t.Fatalf("unexpected lowering manifest: %#v", loweringManifest)
	}
	if loweringManifest.ModulePath != "example.com/app" {
		t.Fatalf("unexpected lowering module path: %#v", loweringManifest)
	}
	if !reflect.DeepEqual(loweringManifest.BuildTags, []string{"scheduler.tasks", "tinygo.wasm"}) {
		t.Fatalf("unexpected lowering build tags: %#v", loweringManifest)
	}
	if !reflect.DeepEqual(loweringManifest.Toolchain, Toolchain{
		Target:              "wasm",
		LLVMTarget:          "wasm32-unknown-wasi",
		Linker:              "wasm-ld",
		CFlags:              []string{"-mbulk-memory", "-mnontrapping-fptoint", "-mno-multivalue", "-mno-reference-types", "-msign-ext"},
		LDFlags:             []string{"--stack-first", "--no-demangle"},
		TranslationUnitPath: "/working/tinygo-bootstrap.c",
		ObjectOutputPath:    "/working/tinygo-bootstrap.o",
		ArtifactOutputPath:  "/working/out.wasm",
	}) {
		t.Fatalf("unexpected lowering toolchain: %#v", loweringManifest.Toolchain)
	}
	if !reflect.DeepEqual(loweringManifest.Support, LoweringSupport{
		TargetAssets:   []string{"/working/.tinygo-root/targets/wasm-undefined.txt", "/working/.tinygo-root/targets/wasm.json"},
		RuntimeSupport: []string{"/working/.tinygo-root/src/device/arm/arm.go", "/working/.tinygo-root/src/runtime/asm_tinygowasm.S", "/working/.tinygo-root/src/runtime/gc_boehm.c", "/working/.tinygo-root/src/runtime/internal/sys/zversion.go"},
	}) {
		t.Fatalf("unexpected lowering support: %#v", loweringManifest.Support)
	}
	if !reflect.DeepEqual(loweringManifest.CompileUnits, intermediateManifest.CompileUnits) {
		t.Fatalf("unexpected lowering compile units: %#v", loweringManifest.CompileUnits)
	}
	var workItemsManifest WorkItemsManifest
	if err := json.Unmarshal([]byte(result.GeneratedFiles[4].Contents), &workItemsManifest); err != nil {
		t.Fatalf("json.Unmarshal(work-items): %v", err)
	}
	if !reflect.DeepEqual(workItemsManifest.WorkItems, []WorkItem{
		{ID: "program-000", Kind: "program", ImportPath: "command-line-arguments", Imports: []string{"example.com/app/lib"}, DepOnly: false, ModulePath: "example.com/app", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}, BitcodeOutputPath: "/working/tinygo-work/program-000.bc", Standard: false},
		{ID: "imported-000", Kind: "imported", ImportPath: "example.com/app/lib", Imports: []string{"fmt"}, DepOnly: true, ModulePath: "example.com/app", PackageName: "helper", PackageDir: "/workspace/lib", Files: []string{"/workspace/lib/helper.go"}, BitcodeOutputPath: "/working/tinygo-work/imported-000.bc", Standard: false},
		{ID: "stdlib-000", Kind: "stdlib", ImportPath: "fmt", Imports: []string{"errors", "io"}, DepOnly: true, ModulePath: "", PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}, BitcodeOutputPath: "/working/tinygo-work/stdlib-000.bc", Standard: true},
	}) {
		t.Fatalf("unexpected work items: %#v", workItemsManifest.WorkItems)
	}
	if !reflect.DeepEqual(workItemsManifest.Toolchain, Toolchain{
		Target:              "wasm",
		LLVMTarget:          "wasm32-unknown-wasi",
		Linker:              "wasm-ld",
		CFlags:              []string{"-mbulk-memory", "-mnontrapping-fptoint", "-mno-multivalue", "-mno-reference-types", "-msign-ext"},
		LDFlags:             []string{"--stack-first", "--no-demangle"},
		TranslationUnitPath: "/working/tinygo-bootstrap.c",
		ObjectOutputPath:    "/working/tinygo-bootstrap.o",
		ArtifactOutputPath:  "/working/out.wasm",
	}) {
		t.Fatalf("unexpected work-item toolchain: %#v", workItemsManifest.Toolchain)
	}
	var loweringPlanManifest LoweringPlanManifest
	if err := json.Unmarshal([]byte(result.GeneratedFiles[5].Contents), &loweringPlanManifest); err != nil {
		t.Fatalf("json.Unmarshal(lowering-plan): %v", err)
	}
	if !reflect.DeepEqual(loweringPlanManifest.CompileJobs, []LoweringCompileJob{
		{ID: "program-000", Kind: "program", ImportPath: "command-line-arguments", Imports: []string{"example.com/app/lib"}, DepOnly: false, ModulePath: "example.com/app", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}, BitcodeOutputPath: "/working/tinygo-work/program-000.bc", LLVMTarget: "wasm32-unknown-wasi", CFlags: []string{"-mbulk-memory", "-mnontrapping-fptoint", "-mno-multivalue", "-mno-reference-types", "-msign-ext"}, OptimizeFlag: "-Oz", Standard: false},
		{ID: "imported-000", Kind: "imported", ImportPath: "example.com/app/lib", Imports: []string{"fmt"}, DepOnly: true, ModulePath: "example.com/app", PackageName: "helper", PackageDir: "/workspace/lib", Files: []string{"/workspace/lib/helper.go"}, BitcodeOutputPath: "/working/tinygo-work/imported-000.bc", LLVMTarget: "wasm32-unknown-wasi", CFlags: []string{"-mbulk-memory", "-mnontrapping-fptoint", "-mno-multivalue", "-mno-reference-types", "-msign-ext"}, OptimizeFlag: "-Oz", Standard: false},
		{ID: "stdlib-000", Kind: "stdlib", ImportPath: "fmt", Imports: []string{"errors", "io"}, DepOnly: true, ModulePath: "", PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}, BitcodeOutputPath: "/working/tinygo-work/stdlib-000.bc", LLVMTarget: "wasm32-unknown-wasi", CFlags: []string{"-mbulk-memory", "-mnontrapping-fptoint", "-mno-multivalue", "-mno-reference-types", "-msign-ext"}, OptimizeFlag: "-Oz", Standard: true},
	}) {
		t.Fatalf("unexpected lowering compile jobs: %#v", loweringPlanManifest.CompileJobs)
	}
	if !reflect.DeepEqual(loweringPlanManifest.LinkJob, LoweringLinkJob{
		Linker:             "wasm-ld",
		LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
		ArtifactOutputPath: "/working/out.wasm",
		BitcodeInputs:      []string{"/working/tinygo-work/program-000.bc", "/working/tinygo-work/imported-000.bc", "/working/tinygo-work/stdlib-000.bc"},
	}) {
		t.Fatalf("unexpected lowering link job: %#v", loweringPlanManifest.LinkJob)
	}
	if loweringPlanManifest.ExecutionLinkJob == nil || !reflect.DeepEqual(*loweringPlanManifest.ExecutionLinkJob, LoweringLinkJob{
		Linker:             "wasm-ld",
		LDFlags:            []string{"--stack-first", "--no-demangle"},
		ArtifactOutputPath: "/working/out.wasm",
		BitcodeInputs:      []string{"/working/tinygo-work/program-000.bc", "/working/tinygo-work/imported-000.bc", "/working/tinygo-work/stdlib-000.bc"},
	}) {
		t.Fatalf("unexpected lowering execution link job: %#v", loweringPlanManifest.ExecutionLinkJob)
	}
	var backendInputManifest struct {
		EntryFile        string               `json:"entryFile"`
		CompileJobs      []LoweringCompileJob `json:"compileJobs"`
		LinkJob          LoweringLinkJob      `json:"linkJob"`
		ExecutionLinkJob *LoweringLinkJob     `json:"executionLinkJob"`
	}
	if err := json.Unmarshal([]byte(result.GeneratedFiles[6].Contents), &backendInputManifest); err != nil {
		t.Fatalf("json.Unmarshal(backend-input): %v", err)
	}
	if backendInputManifest.EntryFile != "/workspace/main.go" ||
		!reflect.DeepEqual(backendInputManifest.CompileJobs, loweringPlanManifest.CompileJobs) ||
		backendInputManifest.LinkJob.Linker != loweringPlanManifest.LinkJob.Linker ||
		!reflect.DeepEqual(backendInputManifest.LinkJob.LDFlags, loweringPlanManifest.LinkJob.LDFlags) ||
		backendInputManifest.LinkJob.ArtifactOutputPath != loweringPlanManifest.LinkJob.ArtifactOutputPath ||
		backendInputManifest.ExecutionLinkJob == nil ||
		loweringPlanManifest.ExecutionLinkJob == nil ||
		backendInputManifest.ExecutionLinkJob.Linker != loweringPlanManifest.ExecutionLinkJob.Linker ||
		!reflect.DeepEqual(backendInputManifest.ExecutionLinkJob.LDFlags, loweringPlanManifest.ExecutionLinkJob.LDFlags) ||
		backendInputManifest.ExecutionLinkJob.ArtifactOutputPath != loweringPlanManifest.ExecutionLinkJob.ArtifactOutputPath {
		t.Fatalf("unexpected backend input manifest: %#v", backendInputManifest)
	}
	if strings.Contains(result.GeneratedFiles[6].Contents, "\"loweredUnits\"") {
		t.Fatalf("expected backend input manifest to omit lowered units: %q", result.GeneratedFiles[6].Contents)
	}
	if strings.Contains(result.GeneratedFiles[6].Contents, "\"bitcodeInputs\"") {
		t.Fatalf("expected backend input manifest to omit bitcode inputs: %q", result.GeneratedFiles[6].Contents)
	}
	if len(result.Diagnostics) == 0 || !strings.Contains(result.Diagnostics[0], "frontend prepared 6 compile groups") {
		t.Fatalf("unexpected diagnostics: %#v", result.Diagnostics)
	}
}

func TestBuildRejectsMismatchedBuildContext(t *testing.T) {
	_, err := Build(Input{
		BuildTags: []string{"scheduler.tasks", "tinygo.wasm"},
		BuildContext: BuildContext{
			Target:     "wasm",
			LLVMTarget: "wasm32-unknown-wasi",
			GOOS:       "js",
			GOARCH:     "wasm",
			GC:         "precise",
			Scheduler:  "asyncify",
			BuildTags:  []string{"scheduler.tasks", "tinygo.wasm"},
			ModulePath: "example.com/app",
		},
		EntryFile:  "/workspace/main.go",
		ModulePath: "example.com/app",
		Toolchain: Toolchain{
			Target:             "wasm",
			ArtifactOutputPath: "/working/out.wasm",
		},
		SourceSelection: SourceSelection{
			AllCompile: []string{"/workspace/main.go"},
		},
		CompileUnits: []IntermediateCompileUnit{
			{Kind: "program", ImportPath: "command-line-arguments", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}},
		},
	})
	if err == nil {
		t.Fatalf("expected build context validation error")
	}
	if !strings.Contains(err.Error(), "build context scheduler must match target/profile") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildRejectsMismatchedPackageGraph(t *testing.T) {
	_, err := Build(Input{
		BuildTags: []string{"scheduler.tasks", "tinygo.wasm"},
		BuildContext: BuildContext{
			Target:     "wasm",
			LLVMTarget: "wasm32-unknown-wasi",
			GOOS:       "js",
			GOARCH:     "wasm",
			GC:         "precise",
			Scheduler:  "tasks",
			BuildTags:  []string{"scheduler.tasks", "tinygo.wasm"},
			ModulePath: "example.com/app",
		},
		EntryFile:  "/workspace/main.go",
		ModulePath: "example.com/app",
		PackageGraph: []PackageGraphPackage{
			{
				DepOnly:    false,
				Dir:        "/workspace",
				Files:      PackageGraphFiles{GoFiles: []string{"other.go"}},
				ImportPath: "command-line-arguments",
				Name:       "main",
				Standard:   false,
			},
		},
		Toolchain: Toolchain{
			Target:             "wasm",
			ArtifactOutputPath: "/working/out.wasm",
		},
		SourceSelection: SourceSelection{
			AllCompile: []string{"/workspace/main.go"},
		},
		CompileUnits: []IntermediateCompileUnit{
			{Kind: "program", ImportPath: "command-line-arguments", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}},
		},
	})
	if err == nil {
		t.Fatalf("expected package graph validation error")
	}
	if !strings.Contains(err.Error(), "package graph must match compile units") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildPreservesCompileUnitDirectImports(t *testing.T) {
	result, err := Build(Input{
		OptimizeFlag: "-Oz",
		EntryFile:    "/workspace/main.go",
		Toolchain: Toolchain{
			Target:             "wasip1",
			ArtifactOutputPath: "/working/out.wasm",
		},
		SourceSelection: SourceSelection{
			AllCompile: []string{
				"/workspace/helper/helper.go",
				"/workspace/main.go",
				"/working/.tinygo-root/src/fmt/print.go",
			},
		},
		CompileUnits: []IntermediateCompileUnit{
			{DepOnly: false, Kind: "program", ImportPath: "example.com/app", Imports: []string{"example.com/app/helper"}, PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}, Standard: false},
			{DepOnly: true, Kind: "imported", ImportPath: "example.com/app/helper", Imports: []string{"fmt"}, PackageName: "helper", PackageDir: "/workspace/helper", Files: []string{"/workspace/helper/helper.go"}, Standard: false},
			{DepOnly: true, Kind: "stdlib", ImportPath: "fmt", Imports: []string{"errors", "io"}, PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}, Standard: true},
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	var compileUnitManifest struct {
		CompileUnits []IntermediateCompileUnit `json:"compileUnits"`
	}
	if err := json.Unmarshal([]byte(result.GeneratedFiles[1].Contents), &compileUnitManifest); err != nil {
		t.Fatalf("json.Unmarshal(compile-unit): %v", err)
	}
	if !reflect.DeepEqual(compileUnitManifest.CompileUnits, []IntermediateCompileUnit{
		{DepOnly: false, Kind: "program", ImportPath: "example.com/app", Imports: []string{"example.com/app/helper"}, ModulePath: "", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}, Standard: false},
		{DepOnly: true, Kind: "imported", ImportPath: "example.com/app/helper", Imports: []string{"fmt"}, ModulePath: "", PackageName: "helper", PackageDir: "/workspace/helper", Files: []string{"/workspace/helper/helper.go"}, Standard: false},
		{DepOnly: true, Kind: "stdlib", ImportPath: "fmt", Imports: []string{"errors", "io"}, ModulePath: "", PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}, Standard: true},
	}) {
		t.Fatalf("unexpected compile unit imports: %#v", compileUnitManifest.CompileUnits)
	}

	var intermediateManifest IntermediateManifest
	if err := json.Unmarshal([]byte(result.GeneratedFiles[2].Contents), &intermediateManifest); err != nil {
		t.Fatalf("json.Unmarshal(intermediate): %v", err)
	}
	if !reflect.DeepEqual(intermediateManifest.CompileUnits, compileUnitManifest.CompileUnits) {
		t.Fatalf("unexpected intermediate compile unit imports: %#v", intermediateManifest.CompileUnits)
	}
}

func TestBuildRejectsEntryMissingFromProgramFiles(t *testing.T) {
	_, err := Build(Input{
		Toolchain: Toolchain{
			Target:              "wasm",
			TranslationUnitPath: "/working/tinygo-bootstrap.c",
			ObjectOutputPath:    "/working/tinygo-bootstrap.o",
			ArtifactOutputPath:  "/working/out.wasm",
		},
		EntryFile: "/workspace/main.go",
		SourceSelection: SourceSelection{
			AllCompile: []string{
				"/workspace/helper.go",
			},
		},
		CompileUnits: []IntermediateCompileUnit{
			{Kind: "program", ImportPath: "command-line-arguments", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/helper.go"}},
		},
	})
	if err == nil {
		t.Fatalf("expected validation error")
	}
	if !strings.Contains(err.Error(), "entry file must be present in program files") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildDefaultsBootstrapPaths(t *testing.T) {
	result, err := Build(Input{
		Toolchain: Toolchain{
			Target:             "wasm",
			LLVMTarget:         "wasm32-unknown-wasi",
			Linker:             "wasm-ld",
			ArtifactOutputPath: "/working/out.wasm",
		},
		EntryFile: "/workspace/main.go",
		SourceSelection: SourceSelection{
			AllCompile: []string{
				"/workspace/main.go",
			},
		},
		CompileUnits: []IntermediateCompileUnit{
			{Kind: "program", ImportPath: "command-line-arguments", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}},
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !result.OK {
		t.Fatalf("unexpected result: %#v", result)
	}
	if got := []string{result.GeneratedFiles[0].Path, result.GeneratedFiles[1].Path, result.GeneratedFiles[2].Path, result.GeneratedFiles[3].Path, result.GeneratedFiles[4].Path, result.GeneratedFiles[5].Path, result.GeneratedFiles[6].Path}; !reflect.DeepEqual(got, []string{
		"/working/tinygo-bootstrap.c",
		"/working/tinygo-compile-unit.json",
		"/working/tinygo-intermediate.json",
		"/working/tinygo-lowering-input.json",
		"/working/tinygo-work-items.json",
		"/working/tinygo-lowering-plan.json",
		"/working/tinygo-backend-input.json",
	}) {
		t.Fatalf("unexpected generated files: %#v", result.GeneratedFiles)
	}
	if strings.Contains(result.GeneratedFiles[1].Contents, "\"translationUnitPath\":\"/working/tinygo-bootstrap.c\"") ||
		strings.Contains(result.GeneratedFiles[1].Contents, "\"objectOutputPath\":\"/working/tinygo-bootstrap.o\"") ||
		strings.Contains(result.GeneratedFiles[1].Contents, "\"packageLayout\":") {
		t.Fatalf("expected compile unit manifest to omit default bootstrap paths and package layout: %q", result.GeneratedFiles[1].Contents)
	}
}

func TestExecutePathsWritesFrontendResult(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "tinygo-frontend-input.json")
	resultPath := filepath.Join(dir, "tinygo-frontend-result.json")
	inputData, err := json.Marshal(Input{
		Toolchain: Toolchain{
			Target:             "wasm",
			ArtifactOutputPath: "/working/out.wasm",
		},
		EntryFile: "/workspace/main.go",
		SourceSelection: SourceSelection{
			AllCompile: []string{
				"/workspace/main.go",
			},
		},
		CompileUnits: []IntermediateCompileUnit{
			{Kind: "program", ImportPath: "command-line-arguments", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}},
		},
	})
	if err != nil {
		t.Fatalf("json.Marshal(input): %v", err)
	}
	if err := os.WriteFile(inputPath, inputData, 0o644); err != nil {
		t.Fatalf("os.WriteFile(input): %v", err)
	}

	if err := ExecutePaths(inputPath, resultPath); err != nil {
		t.Fatalf("ExecutePaths returned error: %v", err)
	}

	resultData, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatalf("os.ReadFile(result): %v", err)
	}
	var result Result
	if err := json.Unmarshal(resultData, &result); err != nil {
		t.Fatalf("json.Unmarshal(result): %v", err)
	}
	if !result.OK {
		t.Fatalf("unexpected result: %#v", result)
	}
	if len(result.GeneratedFiles) != 7 || result.GeneratedFiles[0].Path != "/working/tinygo-bootstrap.c" || result.GeneratedFiles[1].Path != "/working/tinygo-compile-unit.json" || result.GeneratedFiles[2].Path != "/working/tinygo-intermediate.json" || result.GeneratedFiles[3].Path != "/working/tinygo-lowering-input.json" || result.GeneratedFiles[4].Path != "/working/tinygo-work-items.json" || result.GeneratedFiles[5].Path != "/working/tinygo-lowering-plan.json" || result.GeneratedFiles[6].Path != "/working/tinygo-backend-input.json" {
		t.Fatalf("unexpected generated files: %#v", result.GeneratedFiles)
	}
	if !strings.Contains(result.GeneratedFiles[1].Contents, "\"toolchain\":{\"target\":\"wasm\",\"artifactOutputPath\":\"/working/out.wasm\"}") ||
		!strings.Contains(result.GeneratedFiles[1].Contents, "\"sourceSelection\":{\"allCompile\":[\"/workspace/main.go\"]}") ||
		!strings.Contains(result.GeneratedFiles[1].Contents, "\"materializedFiles\":[\"/working/.tinygo-root/src/device/arm/arm.go\",\"/working/.tinygo-root/src/runtime/asm_tinygowasm.S\",\"/working/.tinygo-root/src/runtime/gc_boehm.c\",\"/working/.tinygo-root/src/runtime/internal/sys/zversion.go\",\"/working/.tinygo-root/targets/wasm-undefined.txt\",\"/working/.tinygo-root/targets/wasm.json\",\"/working/tinygo-bootstrap.c\",\"/working/tinygo-compile-unit.json\"]") {
		t.Fatalf("unexpected compile unit manifest: %q", result.GeneratedFiles[1].Contents)
	}
	for _, unexpected := range []string{
		"/working/tinygo-bootstrap.json",
		"/working/tinygo-frontend-input.json",
	} {
		if strings.Contains(result.GeneratedFiles[1].Contents, unexpected) {
			t.Fatalf("expected execute compile unit manifest to omit planner handoff file %q: %q", unexpected, result.GeneratedFiles[1].Contents)
		}
		if strings.Contains(result.GeneratedFiles[0].Contents, unexpected) {
			t.Fatalf("expected execute bootstrap source to omit planner handoff file %q: %q", unexpected, result.GeneratedFiles[0].Contents)
		}
	}
	for _, unexpected := range []string{
		"\"targetAssets\":",
		"\"runtimeSupport\":",
		"\"imported\":",
		"\"stdlib\":",
		"\"program\":",
		"\"packageFileCount\":",
		"\"importedPackageFileCount\":",
		"\"stdlibPackageFileCount\":",
		"\"allFileCount\":",
		"\"targetAssetCount\":",
		"\"runtimeSupportFileCount\":",
		"\"programFileCount\":",
		"\"materializedFileCount\":",
	} {
		if strings.Contains(result.GeneratedFiles[1].Contents, unexpected) {
			t.Fatalf("expected execute compile unit manifest to omit %s: %q", unexpected, result.GeneratedFiles[1].Contents)
		}
	}
	var executeCompileUnitManifest map[string]any
	if err := json.Unmarshal([]byte(result.GeneratedFiles[1].Contents), &executeCompileUnitManifest); err != nil {
		t.Fatalf("json.Unmarshal(execute compile-unit): %v", err)
	}
	for _, key := range []string{
		"target",
		"llvmTarget",
		"linker",
		"modulePath",
		"imports",
		"buildTags",
		"packageLayout",
		"translationUnitPath",
		"objectOutputPath",
		"artifactOutputPath",
		"packageFiles",
		"importedPackageFiles",
		"stdlibPackageFiles",
		"allFiles",
		"allCompileFiles",
		"targetAssetFiles",
		"runtimeSupportFiles",
		"programFiles",
		"packageFileCount",
		"importedPackageFileCount",
		"stdlibPackageFileCount",
		"allFileCount",
		"targetAssetCount",
		"runtimeSupportFileCount",
		"programFileCount",
		"materializedFileCount",
	} {
		if _, ok := executeCompileUnitManifest[key]; ok {
			t.Fatalf("expected compile unit manifest to omit top-level %q: %#v", key, executeCompileUnitManifest)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "tinygo-compile-request.json")); !os.IsNotExist(err) {
		t.Fatalf("expected compile request artifact to be omitted, got err=%v", err)
	}
}

func TestExecuteAdapterPathsWritesFrontendAdapter(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "tinygo-frontend-input.json")
	resultPath := filepath.Join(dir, "tinygo-frontend-adapter.json")
	inputData, err := json.Marshal(analysisSplitTestInput())
	if err != nil {
		t.Fatalf("json.Marshal(input): %v", err)
	}
	if err := os.WriteFile(inputPath, inputData, 0o644); err != nil {
		t.Fatalf("os.WriteFile(input): %v", err)
	}

	if err := ExecuteAdapterPaths(inputPath, resultPath); err != nil {
		t.Fatalf("ExecuteAdapterPaths returned error: %v", err)
	}

	resultData, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatalf("os.ReadFile(result): %v", err)
	}
	var result AdapterResult
	if err := json.Unmarshal(resultData, &result); err != nil {
		t.Fatalf("json.Unmarshal(result): %v", err)
	}
	if !result.OK {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.Adapter == nil {
		t.Fatalf("expected adapter result: %#v", result)
	}
	if result.Adapter.Toolchain.Target != "wasm" ||
		result.Adapter.Toolchain.LLVMTarget != "wasm32-unknown-wasi" ||
		result.Adapter.Toolchain.ArtifactOutputPath != "/working/out.wasm" ||
		result.Adapter.OptimizeFlag != "-Oz" ||
		result.Adapter.CompileUnitManifestPath != "/working/tinygo-compile-unit.json" {
		t.Fatalf("unexpected adapter payload: %#v", result.Adapter)
	}
	if len(result.Adapter.CompileGroups) != 4 {
		t.Fatalf("unexpected adapter compile groups: %#v", result.Adapter.CompileGroups)
	}
	if !reflect.DeepEqual(result.Adapter.CompileGroups, []CompileGroup{
		{Name: "program", Files: []string{"/workspace/main.go"}},
		{Name: "imported", Files: []string{"/workspace/lib/helper.go"}},
		{Name: "stdlib", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}},
		{Name: "all-compile", Files: []string{"/working/.tinygo-root/src/fmt/print.go", "/workspace/lib/helper.go", "/workspace/main.go"}},
	}) {
		t.Fatalf("unexpected adapter compile groups: %#v", result.Adapter.CompileGroups)
	}
	if !reflect.DeepEqual(result.Adapter.AllCompileFiles, []string{
		"/working/.tinygo-root/src/fmt/print.go",
		"/workspace/lib/helper.go",
		"/workspace/main.go",
	}) {
		t.Fatalf("unexpected adapter all-compile files: %#v", result.Adapter.AllCompileFiles)
	}
	if len(result.Diagnostics) == 0 || !strings.Contains(result.Diagnostics[0], "frontend prepared real adapter handoff") {
		t.Fatalf("unexpected diagnostics: %#v", result.Diagnostics)
	}
}

func TestExecuteAdapterAnalysisPathsWritesFrontendAdapter(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "tinygo-frontend-input.json")
	analysisPath := filepath.Join(dir, "tinygo-frontend-analysis.json")
	resultPath := filepath.Join(dir, "tinygo-frontend-adapter.json")
	inputData, err := json.Marshal(analysisSplitTestInput())
	if err != nil {
		t.Fatalf("json.Marshal(input): %v", err)
	}
	if err := os.WriteFile(inputPath, inputData, 0o644); err != nil {
		t.Fatalf("os.WriteFile(input): %v", err)
	}
	if err := ExecuteAnalysisPaths(inputPath, analysisPath); err != nil {
		t.Fatalf("ExecuteAnalysisPaths returned error: %v", err)
	}

	if err := ExecuteAdapterAnalysisPaths(analysisPath, resultPath); err != nil {
		t.Fatalf("ExecuteAdapterAnalysisPaths returned error: %v", err)
	}

	resultData, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatalf("os.ReadFile(result): %v", err)
	}
	var result AdapterResult
	if err := json.Unmarshal(resultData, &result); err != nil {
		t.Fatalf("json.Unmarshal(result): %v", err)
	}
	if !result.OK {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.Adapter == nil {
		t.Fatalf("expected adapter result: %#v", result)
	}
	if len(result.Adapter.CompileGroups) != 4 {
		t.Fatalf("unexpected adapter compile groups: %#v", result.Adapter.CompileGroups)
	}
	if len(result.Diagnostics) == 0 || !strings.Contains(result.Diagnostics[0], "frontend prepared real adapter handoff") {
		t.Fatalf("unexpected diagnostics: %#v", result.Diagnostics)
	}
}

func TestExecuteAnalysisBuildPathsWritesFrontendResult(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "tinygo-frontend-input.json")
	analysisPath := filepath.Join(dir, "tinygo-frontend-analysis.json")
	resultPath := filepath.Join(dir, "tinygo-frontend-result.json")
	inputData, err := json.Marshal(analysisSplitTestInput())
	if err != nil {
		t.Fatalf("json.Marshal(input): %v", err)
	}
	if err := os.WriteFile(inputPath, inputData, 0o644); err != nil {
		t.Fatalf("os.WriteFile(input): %v", err)
	}
	if err := ExecuteAnalysisPaths(inputPath, analysisPath); err != nil {
		t.Fatalf("ExecuteAnalysisPaths returned error: %v", err)
	}

	if err := ExecuteAnalysisBuildPaths(analysisPath, resultPath); err != nil {
		t.Fatalf("ExecuteAnalysisBuildPaths returned error: %v", err)
	}

	resultData, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatalf("os.ReadFile(result): %v", err)
	}
	var result Result
	if err := json.Unmarshal(resultData, &result); err != nil {
		t.Fatalf("json.Unmarshal(result): %v", err)
	}
	if !result.OK {
		t.Fatalf("unexpected result: %#v", result)
	}
	if len(result.GeneratedFiles) != 7 {
		t.Fatalf("unexpected generated files: %#v", result.GeneratedFiles)
	}
	if len(result.Diagnostics) == 0 || !strings.Contains(result.Diagnostics[0], "frontend prepared bootstrap compile request") {
		t.Fatalf("unexpected diagnostics: %#v", result.Diagnostics)
	}
}

func TestExecuteAdapterBuildPathsWritesFrontendResult(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "tinygo-frontend-input.json")
	analysisPath := filepath.Join(dir, "tinygo-frontend-analysis.json")
	adapterPath := filepath.Join(dir, "tinygo-frontend-real-adapter.json")
	resultPath := filepath.Join(dir, "tinygo-frontend-result.json")
	inputData, err := json.Marshal(analysisSplitTestInput())
	if err != nil {
		t.Fatalf("json.Marshal(input): %v", err)
	}
	if err := os.WriteFile(inputPath, inputData, 0o644); err != nil {
		t.Fatalf("os.WriteFile(input): %v", err)
	}
	if err := ExecuteAnalysisPaths(inputPath, analysisPath); err != nil {
		t.Fatalf("ExecuteAnalysisPaths returned error: %v", err)
	}
	if err := ExecuteAdapterAnalysisPaths(analysisPath, adapterPath); err != nil {
		t.Fatalf("ExecuteAdapterAnalysisPaths returned error: %v", err)
	}
	adapterData, err := os.ReadFile(adapterPath)
	if err != nil {
		t.Fatalf("os.ReadFile(adapter): %v", err)
	}
	var adapterResult AdapterResult
	if err := json.Unmarshal(adapterData, &adapterResult); err != nil {
		t.Fatalf("json.Unmarshal(adapter): %v", err)
	}
	if adapterResult.Adapter == nil {
		t.Fatalf("expected adapter result: %#v", adapterResult)
	}
	adapterResult.Adapter.CompileUnits[0].ImportPath = "example.com/app"
	adapterResult.Adapter.PackageGraph[0].ImportPath = "example.com/app"
	adapterData, err = json.Marshal(adapterResult)
	if err != nil {
		t.Fatalf("json.Marshal(adapter): %v", err)
	}
	if err := os.WriteFile(adapterPath, adapterData, 0o644); err != nil {
		t.Fatalf("os.WriteFile(adapter): %v", err)
	}

	if err := ExecuteAdapterBuildPaths(analysisPath, adapterPath, resultPath); err != nil {
		t.Fatalf("ExecuteAdapterBuildPaths returned error: %v", err)
	}

	resultData, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatalf("os.ReadFile(result): %v", err)
	}
	var result Result
	if err := json.Unmarshal(resultData, &result); err != nil {
		t.Fatalf("json.Unmarshal(result): %v", err)
	}
	if !result.OK {
		t.Fatalf("unexpected result: %#v", result)
	}
	if len(result.GeneratedFiles) != 7 {
		t.Fatalf("unexpected generated files: %#v", result.GeneratedFiles)
	}
	if len(result.Diagnostics) == 0 || !strings.Contains(result.Diagnostics[0], "frontend prepared bootstrap compile request") {
		t.Fatalf("unexpected diagnostics: %#v", result.Diagnostics)
	}
	compileUnitFileFound := false
	for _, generatedFile := range result.GeneratedFiles {
		if generatedFile.Path != "/working/tinygo-compile-unit.json" {
			continue
		}
		compileUnitFileFound = true
		var compileUnitManifest struct {
			CompileUnits []IntermediateCompileUnit `json:"compileUnits"`
		}
		if err := json.Unmarshal([]byte(generatedFile.Contents), &compileUnitManifest); err != nil {
			t.Fatalf("json.Unmarshal(compileUnitManifest): %v", err)
		}
		if len(compileUnitManifest.CompileUnits) == 0 {
			t.Fatalf("expected compile units: %#v", compileUnitManifest)
		}
		if got := compileUnitManifest.CompileUnits[0].ImportPath; got != "example.com/app" {
			t.Fatalf("unexpected emitted program import path: %q", got)
		}
	}
	if !compileUnitFileFound {
		t.Fatalf("expected tinygo-compile-unit.json in generated files: %#v", result.GeneratedFiles)
	}
}

func TestExecuteAdapterBuildPathsWritesFrontendResultWithoutAnalysis(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "tinygo-frontend-input.json")
	adapterPath := filepath.Join(dir, "tinygo-frontend-real-adapter.json")
	resultPath := filepath.Join(dir, "tinygo-frontend-result.json")
	missingAnalysisPath := filepath.Join(dir, "missing-frontend-analysis.json")
	inputData, err := json.Marshal(analysisSplitTestInput())
	if err != nil {
		t.Fatalf("json.Marshal(input): %v", err)
	}
	if err := os.WriteFile(inputPath, inputData, 0o644); err != nil {
		t.Fatalf("os.WriteFile(input): %v", err)
	}
	if err := ExecuteAdapterPaths(inputPath, adapterPath); err != nil {
		t.Fatalf("ExecuteAdapterPaths returned error: %v", err)
	}
	adapterData, err := os.ReadFile(adapterPath)
	if err != nil {
		t.Fatalf("os.ReadFile(adapter): %v", err)
	}
	var adapterResult AdapterResult
	if err := json.Unmarshal(adapterData, &adapterResult); err != nil {
		t.Fatalf("json.Unmarshal(adapter): %v", err)
	}
	if adapterResult.Adapter == nil {
		t.Fatalf("expected adapter result: %#v", adapterResult)
	}
	adapterResult.Adapter.CompileUnits[0].ImportPath = "example.com/app"
	adapterResult.Adapter.PackageGraph[0].ImportPath = "example.com/app"
	adapterData, err = json.Marshal(adapterResult)
	if err != nil {
		t.Fatalf("json.Marshal(adapter): %v", err)
	}
	if err := os.WriteFile(adapterPath, adapterData, 0o644); err != nil {
		t.Fatalf("os.WriteFile(adapter): %v", err)
	}

	if err := ExecuteAdapterBuildPaths(missingAnalysisPath, adapterPath, resultPath); err != nil {
		t.Fatalf("ExecuteAdapterBuildPaths returned error: %v", err)
	}

	resultData, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatalf("os.ReadFile(result): %v", err)
	}
	var result Result
	if err := json.Unmarshal(resultData, &result); err != nil {
		t.Fatalf("json.Unmarshal(result): %v", err)
	}
	if !result.OK {
		t.Fatalf("unexpected result: %#v", result)
	}
	compileUnitFileFound := false
	for _, generatedFile := range result.GeneratedFiles {
		if generatedFile.Path != "/working/tinygo-compile-unit.json" {
			continue
		}
		compileUnitFileFound = true
		var compileUnitManifest struct {
			OptimizeFlag string                    `json:"optimizeFlag"`
			Toolchain    Toolchain                 `json:"toolchain"`
			CompileUnits []IntermediateCompileUnit `json:"compileUnits"`
		}
		if err := json.Unmarshal([]byte(generatedFile.Contents), &compileUnitManifest); err != nil {
			t.Fatalf("json.Unmarshal(compileUnitManifest): %v", err)
		}
		if compileUnitManifest.OptimizeFlag != "-Oz" {
			t.Fatalf("unexpected optimize flag: %#v", compileUnitManifest)
		}
		if compileUnitManifest.Toolchain.ArtifactOutputPath != "/working/out.wasm" {
			t.Fatalf("unexpected artifact output path: %#v", compileUnitManifest.Toolchain)
		}
		if len(compileUnitManifest.CompileUnits) == 0 {
			t.Fatalf("expected compile units: %#v", compileUnitManifest)
		}
		if got := compileUnitManifest.CompileUnits[0].ImportPath; got != "example.com/app" {
			t.Fatalf("unexpected emitted program import path: %q", got)
		}
	}
	if !compileUnitFileFound {
		t.Fatalf("expected tinygo-compile-unit.json in generated files: %#v", result.GeneratedFiles)
	}
}

func TestExecuteAnalysisPathsWritesFrontendAnalysis(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "tinygo-frontend-input.json")
	resultPath := filepath.Join(dir, "tinygo-frontend-analysis.json")
	inputData, err := json.Marshal(analysisSplitTestInput())
	if err != nil {
		t.Fatalf("json.Marshal(input): %v", err)
	}
	if err := os.WriteFile(inputPath, inputData, 0o644); err != nil {
		t.Fatalf("os.WriteFile(input): %v", err)
	}

	if err := ExecuteAnalysisPaths(inputPath, resultPath); err != nil {
		t.Fatalf("ExecuteAnalysisPaths returned error: %v", err)
	}

	resultData, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatalf("os.ReadFile(result): %v", err)
	}
	var result AnalysisResult
	if err := json.Unmarshal(resultData, &result); err != nil {
		t.Fatalf("json.Unmarshal(result): %v", err)
	}
	if !result.OK {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.Analysis == nil {
		t.Fatalf("expected analysis result: %#v", result)
	}
	if result.Analysis.Toolchain.Target != "wasm" ||
		result.Analysis.Toolchain.LLVMTarget != "wasm32-unknown-wasi" ||
		result.Analysis.CompileUnitManifestPath != "/working/tinygo-compile-unit.json" {
		t.Fatalf("unexpected analysis payload: %#v", result.Analysis)
	}
	if len(result.Analysis.CompileGroups) != 6 {
		t.Fatalf("unexpected compile groups: %#v", result.Analysis.CompileGroups)
	}
	if !reflect.DeepEqual(result.Analysis.AllCompileFiles, []string{
		"/working/.tinygo-root/src/fmt/print.go",
		"/workspace/lib/helper.go",
		"/workspace/main.go",
	}) {
		t.Fatalf("unexpected all compile files: %#v", result.Analysis.AllCompileFiles)
	}
}

func TestExecuteAnalysisResultPathsWritesFrontendResult(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "tinygo-frontend-input.json")
	analysisPath := filepath.Join(dir, "tinygo-frontend-analysis.json")
	resultPath := filepath.Join(dir, "tinygo-frontend-result.json")
	inputData, err := json.Marshal(analysisSplitTestInput())
	if err != nil {
		t.Fatalf("json.Marshal(input): %v", err)
	}
	if err := os.WriteFile(inputPath, inputData, 0o644); err != nil {
		t.Fatalf("os.WriteFile(input): %v", err)
	}
	if err := ExecuteAnalysisPaths(inputPath, analysisPath); err != nil {
		t.Fatalf("ExecuteAnalysisPaths returned error: %v", err)
	}
	if err := os.Remove(inputPath); err != nil {
		t.Fatalf("os.Remove(input): %v", err)
	}

	if err := ExecuteAnalysisResultPaths(analysisPath, resultPath); err != nil {
		t.Fatalf("ExecuteAnalysisResultPaths returned error: %v", err)
	}

	resultData, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatalf("os.ReadFile(result): %v", err)
	}
	var result Result
	if err := json.Unmarshal(resultData, &result); err != nil {
		t.Fatalf("json.Unmarshal(result): %v", err)
	}
	if !result.OK {
		t.Fatalf("unexpected result: %#v", result)
	}
	if len(result.GeneratedFiles) != 7 {
		t.Fatalf("unexpected generated files: %#v", result.GeneratedFiles)
	}
	if len(result.Diagnostics) == 0 || !strings.Contains(result.Diagnostics[0], "frontend prepared bootstrap compile request") {
		t.Fatalf("unexpected diagnostics: %#v", result.Diagnostics)
	}
}

func TestExecuteResultPathsPrefersFrontendRealAdapterWhenPresent(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "tinygo-frontend-input.json")
	analysisPath := filepath.Join(dir, "tinygo-frontend-analysis.json")
	adapterPath := filepath.Join(dir, "tinygo-frontend-real-adapter.json")
	resultPath := filepath.Join(dir, "tinygo-frontend-result.json")
	inputData, err := json.Marshal(analysisSplitTestInput())
	if err != nil {
		t.Fatalf("json.Marshal(input): %v", err)
	}
	if err := os.WriteFile(inputPath, inputData, 0o644); err != nil {
		t.Fatalf("os.WriteFile(input): %v", err)
	}
	if err := ExecuteAnalysisPaths(inputPath, analysisPath); err != nil {
		t.Fatalf("ExecuteAnalysisPaths returned error: %v", err)
	}
	if err := ExecuteAdapterAnalysisPaths(analysisPath, adapterPath); err != nil {
		t.Fatalf("ExecuteAdapterAnalysisPaths returned error: %v", err)
	}
	adapterData, err := os.ReadFile(adapterPath)
	if err != nil {
		t.Fatalf("os.ReadFile(adapter): %v", err)
	}
	var adapterResult AdapterResult
	if err := json.Unmarshal(adapterData, &adapterResult); err != nil {
		t.Fatalf("json.Unmarshal(adapter): %v", err)
	}
	if adapterResult.Adapter == nil {
		t.Fatalf("expected adapter result: %#v", adapterResult)
	}
	adapterResult.Adapter.CompileUnits[0].ImportPath = "example.com/app"
	adapterResult.Adapter.PackageGraph[0].ImportPath = "example.com/app"
	adapterData, err = json.Marshal(adapterResult)
	if err != nil {
		t.Fatalf("json.Marshal(adapter): %v", err)
	}
	if err := os.WriteFile(adapterPath, adapterData, 0o644); err != nil {
		t.Fatalf("os.WriteFile(adapter): %v", err)
	}
	if err := os.Remove(inputPath); err != nil {
		t.Fatalf("os.Remove(input): %v", err)
	}

	if err := ExecuteResultPaths(inputPath, analysisPath, adapterPath, resultPath); err != nil {
		t.Fatalf("ExecuteResultPaths returned error: %v", err)
	}

	resultData, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatalf("os.ReadFile(result): %v", err)
	}
	var result Result
	if err := json.Unmarshal(resultData, &result); err != nil {
		t.Fatalf("json.Unmarshal(result): %v", err)
	}
	if !result.OK {
		t.Fatalf("unexpected result: %#v", result)
	}
	compileUnitFileFound := false
	for _, generatedFile := range result.GeneratedFiles {
		if generatedFile.Path != "/working/tinygo-compile-unit.json" {
			continue
		}
		compileUnitFileFound = true
		var compileUnitManifest struct {
			CompileUnits []IntermediateCompileUnit `json:"compileUnits"`
		}
		if err := json.Unmarshal([]byte(generatedFile.Contents), &compileUnitManifest); err != nil {
			t.Fatalf("json.Unmarshal(compileUnitManifest): %v", err)
		}
		if len(compileUnitManifest.CompileUnits) == 0 {
			t.Fatalf("expected compile units: %#v", compileUnitManifest)
		}
		if got := compileUnitManifest.CompileUnits[0].ImportPath; got != "example.com/app" {
			t.Fatalf("unexpected emitted program import path: %q", got)
		}
	}
	if !compileUnitFileFound {
		t.Fatalf("expected tinygo-compile-unit.json in generated files: %#v", result.GeneratedFiles)
	}
}

func TestExecuteResultPathsMaterializesFrontendRealAdapterFromAnalysis(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "tinygo-frontend-input.json")
	analysisPath := filepath.Join(dir, "tinygo-frontend-analysis.json")
	adapterPath := filepath.Join(dir, "tinygo-frontend-real-adapter.json")
	resultPath := filepath.Join(dir, "tinygo-frontend-result.json")
	inputData, err := json.Marshal(analysisSplitTestInput())
	if err != nil {
		t.Fatalf("json.Marshal(input): %v", err)
	}
	if err := os.WriteFile(inputPath, inputData, 0o644); err != nil {
		t.Fatalf("os.WriteFile(input): %v", err)
	}
	if err := ExecuteAnalysisPaths(inputPath, analysisPath); err != nil {
		t.Fatalf("ExecuteAnalysisPaths returned error: %v", err)
	}
	if err := os.Remove(inputPath); err != nil {
		t.Fatalf("os.Remove(input): %v", err)
	}

	if err := ExecuteResultPaths(inputPath, analysisPath, adapterPath, resultPath); err != nil {
		t.Fatalf("ExecuteResultPaths returned error: %v", err)
	}

	adapterData, err := os.ReadFile(adapterPath)
	if err != nil {
		t.Fatalf("os.ReadFile(adapter): %v", err)
	}
	var adapterResult AdapterResult
	if err := json.Unmarshal(adapterData, &adapterResult); err != nil {
		t.Fatalf("json.Unmarshal(adapter): %v", err)
	}
	if !adapterResult.OK || adapterResult.Adapter == nil {
		t.Fatalf("expected adapter result: %#v", adapterResult)
	}
	if len(adapterResult.Adapter.CompileGroups) != 4 {
		t.Fatalf("unexpected adapter compile groups: %#v", adapterResult.Adapter.CompileGroups)
	}
}

func TestBuildRejectsLegacyTopLevelSourceGroupsWithoutNestedSourceSelection(t *testing.T) {
	_, err := Build(Input{
		Target:              "wasm",
		LLVMTarget:          "wasm32-unknown-wasi",
		Linker:              "wasm-ld",
		EntryFile:           "/workspace/main.go",
		TranslationUnitPath: "/working/tinygo-bootstrap.c",
		ObjectOutputPath:    "/working/tinygo-bootstrap.o",
		ArtifactOutputPath:  "/working/out.wasm",
		TargetAssetFiles: []string{
			"/working/.tinygo-root/targets/wasm.json",
		},
		RuntimeSupportFiles: []string{
			"/working/.tinygo-root/src/runtime/runtime.go",
		},
		ProgramFiles: []string{
			"/workspace/main.go",
		},
		ImportedPackageFiles: []string{},
		StdlibPackageFiles: []string{
			"/working/.tinygo-root/src/fmt/print.go",
		},
		AllCompileFiles: []string{
			"/working/.tinygo-root/src/fmt/print.go",
			"/workspace/main.go",
		},
	})
	if err == nil {
		t.Fatalf("expected validation error")
	}
	if !strings.Contains(err.Error(), "toolchain is required") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildRejectsLegacyTopLevelSourceGroupsEvenWithNestedSourceSelection(t *testing.T) {
	_, err := Build(Input{
		Toolchain: Toolchain{
			Target:             "wasm",
			ArtifactOutputPath: "/working/out.wasm",
		},
		EntryFile: "/workspace/main.go",
		SourceSelection: SourceSelection{
			AllCompile: []string{
				"/workspace/main.go",
			},
		},
		ProgramFiles: []string{
			"/workspace/main.go",
		},
	})
	if err == nil {
		t.Fatalf("expected validation error")
	}
	if !strings.Contains(err.Error(), "legacy top-level source selection fields are not supported") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildRejectsMissingCompileUnits(t *testing.T) {
	_, err := Build(Input{
		Toolchain: Toolchain{
			Target:             "wasm",
			ArtifactOutputPath: "/working/out.wasm",
		},
		EntryFile: "/workspace/main.go",
		SourceSelection: SourceSelection{
			AllCompile: []string{
				"/workspace/main.go",
			},
		},
	})
	if err == nil {
		t.Fatalf("expected validation error")
	}
	if !strings.Contains(err.Error(), "compile units are required") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildRejectsCompileUnitsMissingAllCompileFile(t *testing.T) {
	_, err := Build(Input{
		Toolchain: Toolchain{
			Target:             "wasm",
			ArtifactOutputPath: "/working/out.wasm",
		},
		EntryFile: "/workspace/main.go",
		SourceSelection: SourceSelection{
			AllCompile: []string{
				"/workspace/helper.go",
				"/workspace/main.go",
			},
		},
		CompileUnits: []IntermediateCompileUnit{
			{Kind: "program", ImportPath: "command-line-arguments", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}},
		},
	})
	if err == nil {
		t.Fatalf("expected validation error")
	}
	if !strings.Contains(err.Error(), "compile units must cover every allCompile file") {
		t.Fatalf("unexpected error: %v", err)
	}
}
