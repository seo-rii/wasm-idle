package driver

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
)

func TestBuildRejectsNonGoEntryPath(t *testing.T) {
	_, err := Build(Request{
		Command: "build",
		Entry:   "/workspace/main.txt",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []byte("package main\n\nfunc main() {}\n"))
	if err == nil {
		t.Fatalf("expected non-Go entry path validation error")
	}
}

func TestBuildRejectsNonWasmOutputPath(t *testing.T) {
	_, err := Build(Request{
		Command: "build",
		Entry:   "/workspace/main.go",
		Output:  "/working/out.bin",
		Target:  "wasm",
	}, []byte("package main\n\nfunc main() {}\n"))
	if err == nil {
		t.Fatalf("expected non-wasm output path validation error")
	}
}

func TestBuildRejectsEntryFileExcludedByBuildConstraints(t *testing.T) {
	_, err := Build(Request{
		Command: "build",
		Entry:   "/workspace/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []byte("//go:build wasip1\n\npackage main\n\nfunc main() {}\n"))
	if err == nil {
		t.Fatalf("expected build constraint exclusion error")
	}
	if !strings.Contains(err.Error(), "excluded by current target/build constraints") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildProducesBootstrapPlan(t *testing.T) {
	result, err := Build(Request{
		Command:  "build",
		Planner:  "bootstrap",
		Entry:    "/workspace/main.go",
		Output:   "/working/out.wasm",
		Target:   "wasm",
		Optimize: "z",
	}, []byte("package main\n\nfunc main() {}\n"))
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	if !result.OK {
		t.Fatalf("expected OK result, got %#v", result)
	}
	if result.Mode != "bootstrap-c-smoke" {
		t.Fatalf("unexpected mode: %q", result.Mode)
	}
	if result.Artifact != "/working/out.wasm" {
		t.Fatalf("unexpected artifact path: %q", result.Artifact)
	}
	if len(result.Files) != 1 {
		t.Fatalf("expected 1 generated file, got %d", len(result.Files))
	}
	if result.Files[0].Path != "/working/smoke.c" {
		t.Fatalf("unexpected generated file path: %q", result.Files[0].Path)
	}
	if len(result.Plan) != 2 {
		t.Fatalf("expected 2 tool invocations, got %d", len(result.Plan))
	}
	if got := result.Plan[0].Argv[0]; got != "/usr/bin/clang" {
		t.Fatalf("unexpected compiler executable: %q", got)
	}
	if got := result.Plan[1].Argv[0]; got != "/usr/bin/wasm-ld" {
		t.Fatalf("unexpected linker executable: %q", got)
	}
	if got := result.Plan[1].Argv[len(result.Plan[1].Argv)-1]; got != "/working/out.wasm" {
		t.Fatalf("unexpected final output path: %q", got)
	}
}

func TestBuildDefaultsToTinyGoPlanner(t *testing.T) {
	result, err := Build(Request{
		Command: "build",
		Entry:   "/workspace/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []byte("package main\n\nfunc main() {}\n"))
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if result.Mode != "tinygo-bootstrap" {
		t.Fatalf("unexpected default mode: %q", result.Mode)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata for tinygo planner")
	}
	if result.Metadata.LLVMTarget != "wasm32-unknown-wasi" {
		t.Fatalf("unexpected llvm target: %q", result.Metadata.LLVMTarget)
	}
	if result.Metadata.GOOS != "js" {
		t.Fatalf("unexpected GOOS: %q", result.Metadata.GOOS)
	}
	if result.Metadata.GOARCH != "wasm" {
		t.Fatalf("unexpected GOARCH: %q", result.Metadata.GOARCH)
	}
	if len(result.Metadata.BuildTags) == 0 {
		t.Fatalf("expected build tags in metadata")
	}
	foundManifest := false
	foundTinyGoRoot := false
	foundUnexpectedTarget := false
	for _, file := range result.Files {
		if file.Path == "/working/tinygo-bootstrap.json" {
			foundManifest = true
		}
		if file.Path == "/working/.tinygo-root/targets/wasm.json" {
			foundTinyGoRoot = true
		}
		if file.Path == "/working/.tinygo-root/targets/wasip1.json" {
			foundUnexpectedTarget = true
		}
	}
	if !foundManifest {
		t.Fatalf("expected tinygo bootstrap manifest in %#v", result.Files)
	}
	if !foundTinyGoRoot {
		t.Fatalf("expected tinygo root targets in %#v", result.Files)
	}
	if foundUnexpectedTarget {
		t.Fatalf("did not expect unrelated wasip1 target asset in %#v", result.Files)
	}
	if len(result.Metadata.PackageFiles) != 1 || result.Metadata.PackageFiles[0] != "/workspace/main.go" {
		t.Fatalf("unexpected package files: %#v", result.Metadata.PackageFiles)
	}
	if got := result.Plan[0].Argv[1]; got != "--target=wasm32-unknown-wasi" {
		t.Fatalf("unexpected compile target: %q", got)
	}
	if got := result.Plan[0].Argv[len(result.Plan[0].Argv)-4:]; !slices.Equal(got, []string{"-c", "tinygo-bootstrap.c", "-o", "tinygo-bootstrap.o"}) {
		t.Fatalf("unexpected tinygo compile trailer: %#v", result.Plan[0].Argv)
	}
}

func TestBuildPackageIncludesSameDirectoryFilesAndImports(t *testing.T) {
	result, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []SourceFile{
		{
			Path:     "/workspace/main.go",
			Contents: []byte("package main\n\nimport \"fmt\"\n\nfunc main() { helper(); fmt.Println(\"ok\") }\n"),
		},
		{
			Path:     "/workspace/helper.go",
			Contents: []byte("package main\n\nfunc helper() {}\n"),
		},
	})
	if err != nil {
		t.Fatalf("BuildPackage returned error: %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if !slices.Equal(result.Metadata.PackageFiles, []string{"/workspace/helper.go", "/workspace/main.go"}) {
		t.Fatalf("unexpected package files: %#v", result.Metadata.PackageFiles)
	}
	if !slices.Equal(result.Metadata.Imports, []string{"fmt"}) {
		t.Fatalf("unexpected imports: %#v", result.Metadata.Imports)
	}
}

func TestBuildPackageTracksStdlibImports(t *testing.T) {
	result, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []SourceFile{
		{
			Path:     "/workspace/main.go",
			Contents: []byte("package main\n\nimport (\n\t\"fmt\"\n\t\"runtime\"\n)\n\nfunc main() { helper(); fmt.Println(runtime.GOOS) }\n"),
		},
		{
			Path:     "/workspace/helper.go",
			Contents: []byte("package main\n\nimport \"unsafe\"\n\nfunc helper() { _ = unsafe.Sizeof(0) }\n"),
		},
	})
	if err != nil {
		t.Fatalf("BuildPackage returned error: %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if !slices.Equal(result.Metadata.Imports, []string{"fmt", "runtime", "unsafe"}) {
		t.Fatalf("unexpected imports: %#v", result.Metadata.Imports)
	}
	if !slices.Equal(result.Metadata.StdlibImports, []string{"fmt", "runtime", "unsafe"}) {
		t.Fatalf("unexpected stdlib imports: %#v", result.Metadata.StdlibImports)
	}
	manifestSource := ""
	frontendInputSource := ""
	generatedPaths := make([]string, 0, len(result.Files))
	for _, file := range result.Files {
		generatedPaths = append(generatedPaths, file.Path)
		if file.Path == "/working/tinygo-bootstrap.json" {
			manifestSource = file.Contents
		}
		if file.Path == "/working/tinygo-frontend-input.json" {
			frontendInputSource = file.Contents
		}
	}
	for _, want := range []string{
		"/working/.tinygo-root/src/errors/errors.go",
		"/working/.tinygo-root/src/fmt/print.go",
		"/working/.tinygo-root/src/io/io.go",
		"/working/.tinygo-root/src/runtime/runtime.go",
		"/working/.tinygo-root/src/unsafe/unsafe.go",
	} {
		if !slices.Contains(generatedPaths, want) {
			t.Fatalf("missing stdlib planner asset %q in %#v", want, generatedPaths)
		}
	}
	if manifestSource == "" {
		t.Fatalf("expected bootstrap manifest in %#v", result.Files)
	}
	if frontendInputSource == "" {
		t.Fatalf("expected frontend input source in %#v", result.Files)
	}
	var manifest struct {
		CompileInputs struct {
			EntryFile            string   `json:"entryFile"`
			PackageFiles         []string `json:"packageFiles"`
			ImportedPackageFiles []string `json:"importedPackageFiles"`
			StdlibPackageFiles   []string `json:"stdlibPackageFiles"`
		} `json:"compileInputs"`
		BootstrapExports  json.RawMessage `json:"bootstrapExports"`
		BootstrapDispatch struct {
			TargetAssetFiles    []string `json:"targetAssetFiles"`
			RuntimeSupportFiles []string `json:"runtimeSupportFiles"`
			MaterializedFiles   []string `json:"materializedFiles"`
		} `json:"bootstrapDispatch"`
		BootstrapFrontEnd json.RawMessage `json:"bootstrapFrontEnd"`
	}
	if err := json.Unmarshal([]byte(manifestSource), &manifest); err != nil {
		t.Fatalf("json.Unmarshal(manifest): %v", err)
	}
	if manifest.CompileInputs.EntryFile != "/workspace/main.go" {
		t.Fatalf("unexpected compile input entry file: %#v", manifest.CompileInputs)
	}
	if !slices.Equal(manifest.CompileInputs.PackageFiles, []string{"/workspace/helper.go", "/workspace/main.go"}) {
		t.Fatalf("unexpected compile input package files: %#v", manifest.CompileInputs)
	}
	if len(manifest.CompileInputs.ImportedPackageFiles) != 0 {
		t.Fatalf("unexpected compile input imported package files: %#v", manifest.CompileInputs)
	}
	if !slices.Equal(manifest.CompileInputs.StdlibPackageFiles, []string{
		"/working/.tinygo-root/src/errors/errors.go",
		"/working/.tinygo-root/src/fmt/print.go",
		"/working/.tinygo-root/src/io/io.go",
		"/working/.tinygo-root/src/runtime/runtime.go",
		"/working/.tinygo-root/src/unsafe/unsafe.go",
	}) {
		t.Fatalf("unexpected compile input stdlib package files: %#v", manifest.CompileInputs)
	}
	if manifest.BootstrapExports != nil {
		t.Fatalf("expected bootstrapExports to be omitted, got %s", string(manifest.BootstrapExports))
	}
	if !slices.Equal(manifest.BootstrapDispatch.TargetAssetFiles, []string{
		"/working/.tinygo-root/targets/wasm-undefined.txt",
		"/working/.tinygo-root/targets/wasm.json",
	}) {
		t.Fatalf("unexpected bootstrap dispatch target assets: %#v", manifest.BootstrapDispatch)
	}
	if !slices.Equal(manifest.BootstrapDispatch.RuntimeSupportFiles, []string{
		"/working/.tinygo-root/src/device/arm/arm.go",
		"/working/.tinygo-root/src/runtime/asm_tinygowasm.S",
		"/working/.tinygo-root/src/runtime/gc_boehm.c",
		"/working/.tinygo-root/src/runtime/internal/sys/zversion.go",
	}) {
		t.Fatalf("unexpected bootstrap dispatch runtime support: %#v", manifest.BootstrapDispatch)
	}
	if !slices.Equal(manifest.BootstrapDispatch.MaterializedFiles, []string{
		"/working/.tinygo-root/src/device/arm/arm.go",
		"/working/.tinygo-root/src/errors/errors.go",
		"/working/.tinygo-root/src/fmt/print.go",
		"/working/.tinygo-root/src/io/io.go",
		"/working/.tinygo-root/src/runtime/asm_tinygowasm.S",
		"/working/.tinygo-root/src/runtime/gc_boehm.c",
		"/working/.tinygo-root/src/runtime/internal/sys/zversion.go",
		"/working/.tinygo-root/src/runtime/runtime.go",
		"/working/.tinygo-root/src/unsafe/unsafe.go",
		"/working/.tinygo-root/targets/wasm-undefined.txt",
		"/working/.tinygo-root/targets/wasm.json",
		"/working/tinygo-bootstrap.json",
		"/working/tinygo-frontend-input.json",
	}) {
		t.Fatalf("unexpected bootstrap dispatch materialized files: %#v", manifest.BootstrapDispatch)
	}
	if manifest.BootstrapFrontEnd != nil {
		t.Fatalf("expected bootstrapFrontEnd mirror to be omitted, got %s", string(manifest.BootstrapFrontEnd))
	}
	var frontendInput struct {
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
			Name       string   `json:"name"`
			Standard   bool     `json:"standard"`
		} `json:"packageGraph"`
		Scheduler         string   `json:"scheduler"`
		PanicStrategy     string   `json:"panicStrategy"`
		OptimizeFlag      string   `json:"optimizeFlag"`
		EntryFile         string   `json:"entryFile"`
		MaterializedFiles []string `json:"materializedFiles"`
		CompileUnits      []struct {
			Kind        string   `json:"kind"`
			ImportPath  string   `json:"importPath"`
			Imports     []string `json:"imports"`
			PackageName string   `json:"packageName"`
			PackageDir  string   `json:"packageDir"`
			Files       []string `json:"files"`
		} `json:"compileUnits"`
		Toolchain struct {
			Target              string   `json:"target"`
			LLVMTarget          string   `json:"llvmTarget"`
			Linker              string   `json:"linker"`
			CFlags              []string `json:"cflags"`
			LDFlags             []string `json:"ldflags"`
			TranslationUnitPath string   `json:"translationUnitPath"`
			ObjectOutputPath    string   `json:"objectOutputPath"`
			ArtifactOutputPath  string   `json:"artifactOutputPath"`
		} `json:"toolchain"`
		SourceSelection struct {
			TargetAssets   []string `json:"targetAssets"`
			RuntimeSupport []string `json:"runtimeSupport"`
			Program        []string `json:"program"`
			Imported       []string `json:"imported"`
			Stdlib         []string `json:"stdlib"`
			AllCompile     []string `json:"allCompile"`
		} `json:"sourceSelection"`
	}
	if err := json.Unmarshal([]byte(frontendInputSource), &frontendInput); err != nil {
		t.Fatalf("json.Unmarshal(frontendInput): %v", err)
	}
	if frontendInput.Scheduler != "" ||
		frontendInput.PanicStrategy != "" ||
		frontendInput.OptimizeFlag != "-Oz" ||
		frontendInput.EntryFile != "/workspace/main.go" ||
		frontendInput.BuildContext.Target != "wasm" ||
		frontendInput.BuildContext.LLVMTarget != "wasm32-unknown-wasi" ||
		frontendInput.BuildContext.GOOS != "js" ||
		frontendInput.BuildContext.GOARCH != "wasm" ||
		frontendInput.BuildContext.GC != "precise" ||
		frontendInput.BuildContext.Scheduler != "asyncify" ||
		frontendInput.BuildContext.ModulePath != "" ||
		!slices.Equal(frontendInput.BuildContext.BuildTags, []string{"gc.precise", "math_big_pure_go", "osusergo", "purego", "scheduler.asyncify", "serial.none", "tinygo", "tinygo.unicore", "tinygo.wasm"}) ||
		frontendInput.Toolchain.ArtifactOutputPath != "/working/out.wasm" ||
		frontendInput.Toolchain.LLVMTarget != "" ||
		frontendInput.Toolchain.Linker != "" ||
		frontendInput.Toolchain.Target != "wasm" ||
		frontendInput.ModulePath != "" ||
		!slices.Equal(frontendInput.BuildTags, []string{"gc.precise", "math_big_pure_go", "osusergo", "purego", "scheduler.asyncify", "serial.none", "tinygo", "tinygo.unicore", "tinygo.wasm"}) ||
		frontendInput.Toolchain.CFlags != nil ||
		frontendInput.Toolchain.LDFlags != nil ||
		!reflect.DeepEqual(frontendInput.CompileUnits, []struct {
			Kind        string   `json:"kind"`
			ImportPath  string   `json:"importPath"`
			Imports     []string `json:"imports"`
			PackageName string   `json:"packageName"`
			PackageDir  string   `json:"packageDir"`
			Files       []string `json:"files"`
		}{
			{Kind: "program", ImportPath: "command-line-arguments", Imports: []string{"fmt", "runtime", "unsafe"}, PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/helper.go", "/workspace/main.go"}},
			{Kind: "stdlib", ImportPath: "errors", Imports: nil, PackageName: "errors", PackageDir: "/working/.tinygo-root/src/errors", Files: []string{"/working/.tinygo-root/src/errors/errors.go"}},
			{Kind: "stdlib", ImportPath: "fmt", Imports: nil, PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}},
			{Kind: "stdlib", ImportPath: "io", Imports: nil, PackageName: "io", PackageDir: "/working/.tinygo-root/src/io", Files: []string{"/working/.tinygo-root/src/io/io.go"}},
			{Kind: "stdlib", ImportPath: "runtime", Imports: nil, PackageName: "runtime", PackageDir: "/working/.tinygo-root/src/runtime", Files: []string{"/working/.tinygo-root/src/runtime/runtime.go"}},
			{Kind: "stdlib", ImportPath: "unsafe", Imports: nil, PackageName: "unsafe", PackageDir: "/working/.tinygo-root/src/unsafe", Files: []string{"/working/.tinygo-root/src/unsafe/unsafe.go"}},
		}) ||
		!reflect.DeepEqual(frontendInput.PackageGraph, []struct {
			DepOnly bool   `json:"depOnly"`
			Dir     string `json:"dir"`
			Files   struct {
				GoFiles []string `json:"goFiles"`
			} `json:"files"`
			ImportPath string   `json:"importPath"`
			Imports    []string `json:"imports"`
			Name       string   `json:"name"`
			Standard   bool     `json:"standard"`
		}{
			{DepOnly: false, Dir: "/workspace", Files: struct {
				GoFiles []string `json:"goFiles"`
			}{GoFiles: []string{"helper.go", "main.go"}}, ImportPath: "command-line-arguments", Imports: []string{"fmt", "runtime", "unsafe"}, Name: "main", Standard: false},
			{DepOnly: true, Dir: "/working/.tinygo-root/src/errors", Files: struct {
				GoFiles []string `json:"goFiles"`
			}{GoFiles: []string{"errors.go"}}, ImportPath: "errors", Imports: []string{}, Name: "errors", Standard: true},
			{DepOnly: true, Dir: "/working/.tinygo-root/src/fmt", Files: struct {
				GoFiles []string `json:"goFiles"`
			}{GoFiles: []string{"print.go"}}, ImportPath: "fmt", Imports: []string{}, Name: "fmt", Standard: true},
			{DepOnly: true, Dir: "/working/.tinygo-root/src/io", Files: struct {
				GoFiles []string `json:"goFiles"`
			}{GoFiles: []string{"io.go"}}, ImportPath: "io", Imports: []string{}, Name: "io", Standard: true},
			{DepOnly: true, Dir: "/working/.tinygo-root/src/runtime", Files: struct {
				GoFiles []string `json:"goFiles"`
			}{GoFiles: []string{"runtime.go"}}, ImportPath: "runtime", Imports: []string{}, Name: "runtime", Standard: true},
			{DepOnly: true, Dir: "/working/.tinygo-root/src/unsafe", Files: struct {
				GoFiles []string `json:"goFiles"`
			}{GoFiles: []string{"unsafe.go"}}, ImportPath: "unsafe", Imports: []string{}, Name: "unsafe", Standard: true},
		}) ||
		frontendInput.SourceSelection.Program != nil ||
		frontendInput.SourceSelection.Imported != nil ||
		!slices.Equal(frontendInput.SourceSelection.AllCompile, []string{
			"/working/.tinygo-root/src/errors/errors.go",
			"/working/.tinygo-root/src/fmt/print.go",
			"/working/.tinygo-root/src/io/io.go",
			"/working/.tinygo-root/src/runtime/runtime.go",
			"/working/.tinygo-root/src/unsafe/unsafe.go",
			"/workspace/helper.go",
			"/workspace/main.go",
		}) {
		t.Fatalf("frontend input file did not match bootstrap front-end section: %#v", frontendInput)
	}
	var frontendInputMap map[string]any
	if err := json.Unmarshal([]byte(frontendInputSource), &frontendInputMap); err != nil {
		t.Fatalf("json.Unmarshal(frontendInputMap): %v", err)
	}
	if frontendInputMap["modulePath"] != "" {
		t.Fatalf("expected frontend input to include empty modulePath: %#v", frontendInputMap)
	}
	if !reflect.DeepEqual(frontendInputMap["buildTags"], []any{"gc.precise", "math_big_pure_go", "osusergo", "purego", "scheduler.asyncify", "serial.none", "tinygo", "tinygo.unicore", "tinygo.wasm"}) {
		t.Fatalf("expected frontend input to include buildTags: %#v", frontendInputMap)
	}
	if buildContext, ok := frontendInputMap["buildContext"].(map[string]any); !ok {
		t.Fatalf("expected frontend input to include buildContext: %#v", frontendInputMap)
	} else {
		if buildContext["target"] != "wasm" || buildContext["llvmTarget"] != "wasm32-unknown-wasi" ||
			buildContext["goos"] != "js" || buildContext["goarch"] != "wasm" ||
			buildContext["gc"] != "precise" || buildContext["scheduler"] != "asyncify" ||
			buildContext["modulePath"] != "" {
			t.Fatalf("unexpected buildContext: %#v", frontendInputMap)
		}
	}
	if _, ok := frontendInputMap["tinygoRoot"]; ok {
		t.Fatalf("expected frontend input to omit tinygoRoot: %#v", frontendInputMap)
	}
	if packageGraph, ok := frontendInputMap["packageGraph"].([]any); !ok || len(packageGraph) != 6 {
		t.Fatalf("expected frontend input to include packageGraph: %#v", frontendInputMap)
	}
	compileUnitsAny, ok := frontendInputMap["compileUnits"].([]any)
	if !ok {
		t.Fatalf("expected frontend input to include compileUnits: %#v", frontendInputMap)
	}
	if len(compileUnitsAny) != 6 {
		t.Fatalf("expected 6 compile units: %#v", frontendInputMap)
	}
	if sourceSelection, ok := frontendInputMap["sourceSelection"].(map[string]any); ok {
		if _, ok := sourceSelection["targetAssets"]; ok {
			t.Fatalf("expected frontend input sourceSelection to omit targetAssets: %#v", frontendInputMap)
		}
		if _, ok := sourceSelection["runtimeSupport"]; ok {
			t.Fatalf("expected frontend input sourceSelection to omit runtimeSupport: %#v", frontendInputMap)
		}
		if _, ok := sourceSelection["program"]; ok {
			t.Fatalf("expected frontend input sourceSelection to omit program: %#v", frontendInputMap)
		}
		if _, ok := sourceSelection["imported"]; ok {
			t.Fatalf("expected frontend input sourceSelection to omit imported: %#v", frontendInputMap)
		}
		if _, ok := sourceSelection["stdlib"]; ok {
			t.Fatalf("expected frontend input sourceSelection to omit stdlib: %#v", frontendInputMap)
		}
	}
	if toolchain, ok := frontendInputMap["toolchain"].(map[string]any); ok {
		if _, ok := toolchain["llvmTarget"]; ok {
			t.Fatalf("expected frontend input toolchain to omit llvmTarget: %#v", frontendInputMap)
		}
		if _, ok := toolchain["linker"]; ok {
			t.Fatalf("expected frontend input toolchain to omit linker: %#v", frontendInputMap)
		}
		if _, ok := toolchain["cflags"]; ok {
			t.Fatalf("expected frontend input toolchain to omit cflags: %#v", frontendInputMap)
		}
		if _, ok := toolchain["ldflags"]; ok {
			t.Fatalf("expected frontend input toolchain to omit ldflags: %#v", frontendInputMap)
		}
		if _, ok := toolchain["translationUnitPath"]; ok {
			t.Fatalf("expected frontend input toolchain to omit translationUnitPath: %#v", frontendInputMap)
		}
		if _, ok := toolchain["objectOutputPath"]; ok {
			t.Fatalf("expected frontend input toolchain to omit objectOutputPath: %#v", frontendInputMap)
		}
	}
	if frontendInput.MaterializedFiles != nil {
		t.Fatalf("expected frontend input to omit materializedFiles: %#v", frontendInput)
	}
	for _, want := range []string{
		"/working/.tinygo-root/src/runtime/runtime.go",
		"/working/tinygo-bootstrap.json",
		"/working/tinygo-frontend-input.json",
	} {
		if !slices.Contains(generatedPaths, want) {
			t.Fatalf("missing generated path %q in %#v", want, generatedPaths)
		}
	}
	if len(result.Metadata.ExternalImports) != 0 {
		t.Fatalf("unexpected external imports: %#v", result.Metadata.ExternalImports)
	}
	if !slices.Contains(generatedPaths, "/working/tinygo-frontend-input.json") {
		t.Fatalf("missing frontend input asset in %#v", generatedPaths)
	}
	if slices.Contains(generatedPaths, "/working/tinygo-bootstrap.c") {
		t.Fatalf("planner should not emit frontend-generated bootstrap source in %#v", generatedPaths)
	}
}

func TestBuildPackageRejectsRelativeImports(t *testing.T) {
	_, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []SourceFile{
		{
			Path:     "/workspace/main.go",
			Contents: []byte("package main\n\nimport \"./helper\"\n\nfunc main() {}\n"),
		},
	})
	if err == nil {
		t.Fatalf("expected relative import validation error")
	}
	if !strings.Contains(err.Error(), "relative import") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildPackageRejectsExternalImportsUntilModuleResolutionExists(t *testing.T) {
	_, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []SourceFile{
		{
			Path:     "/workspace/main.go",
			Contents: []byte("package main\n\nimport \"example.com/lib\"\n\nfunc main() { lib.Run() }\n"),
		},
	})
	if err == nil {
		t.Fatalf("expected unresolved external import validation error")
	}
	if !strings.Contains(err.Error(), "module resolution") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildPackageTracksCurrentModuleImportsWhenGoModPresent(t *testing.T) {
	result, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/cmd/app/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []SourceFile{
		{
			Path:     "/workspace/go.mod",
			Contents: []byte("module example.com/app\n\ngo 1.24\n"),
		},
		{
			Path:     "/workspace/cmd/app/main.go",
			Contents: []byte("package main\n\nimport \"example.com/app/internal/helper\"\n\nfunc main() { helper.Run() }\n"),
		},
		{
			Path:     "/workspace/internal/helper/helper.go",
			Contents: []byte("package helper\n\nimport \"example.com/app/internal/deep\"\n\nfunc Run() { deep.Call() }\n"),
		},
		{
			Path:     "/workspace/internal/deep/deep.go",
			Contents: []byte("package deep\n\nfunc Call() {}\n"),
		},
	})
	if err != nil {
		t.Fatalf("BuildPackage returned error: %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if result.Metadata.ModulePath != "example.com/app" {
		t.Fatalf("unexpected module path: %q", result.Metadata.ModulePath)
	}
	if !slices.Equal(result.Metadata.LocalModuleImports, []string{
		"example.com/app/internal/deep",
		"example.com/app/internal/helper",
	}) {
		t.Fatalf("unexpected local module imports: %#v", result.Metadata.LocalModuleImports)
	}
	if !slices.Equal(result.Metadata.ImportedPackageFiles, []string{
		"/workspace/internal/deep/deep.go",
		"/workspace/internal/helper/helper.go",
	}) {
		t.Fatalf("unexpected imported package files: %#v", result.Metadata.ImportedPackageFiles)
	}
	if len(result.Metadata.ExternalImports) != 0 {
		t.Fatalf("unexpected external imports: %#v", result.Metadata.ExternalImports)
	}
}

func TestBuildPackageRejectsMissingCurrentModulePackageFiles(t *testing.T) {
	_, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/cmd/app/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []SourceFile{
		{
			Path:     "/workspace/go.mod",
			Contents: []byte("module example.com/app\n\ngo 1.24\n"),
		},
		{
			Path:     "/workspace/cmd/app/main.go",
			Contents: []byte("package main\n\nimport \"example.com/app/internal/helper\"\n\nfunc main() { helper.Run() }\n"),
		},
	})
	if err == nil {
		t.Fatalf("expected missing local module package error")
	}
	if !strings.Contains(err.Error(), "local module import package not found") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildPackageRejectsCurrentModuleImportCycles(t *testing.T) {
	_, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/cmd/app/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []SourceFile{
		{
			Path:     "/workspace/go.mod",
			Contents: []byte("module example.com/app\n\ngo 1.24\n"),
		},
		{
			Path:     "/workspace/cmd/app/main.go",
			Contents: []byte("package main\n\nimport \"example.com/app/internal/helper\"\n\nfunc main() { helper.Run() }\n"),
		},
		{
			Path:     "/workspace/internal/helper/helper.go",
			Contents: []byte("package helper\n\nimport \"example.com/app/internal/deep\"\n\nfunc Run() { deep.Call() }\n"),
		},
		{
			Path:     "/workspace/internal/deep/deep.go",
			Contents: []byte("package deep\n\nimport \"example.com/app/internal/helper\"\n\nfunc Call() { helper.Run() }\n"),
		},
	})
	if err == nil {
		t.Fatalf("expected import cycle error")
	}
	if !strings.Contains(err.Error(), "import cycle") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildPackageRejectsCurrentModuleImportWhenFilesAreExcludedByBuildConstraints(t *testing.T) {
	_, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/cmd/app/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []SourceFile{
		{
			Path:     "/workspace/go.mod",
			Contents: []byte("module example.com/app\n\ngo 1.24\n"),
		},
		{
			Path:     "/workspace/cmd/app/main.go",
			Contents: []byte("package main\n\nimport \"example.com/app/internal/helper\"\n\nfunc main() { helper.Run() }\n"),
		},
		{
			Path:     "/workspace/internal/helper/helper_wasip1.go",
			Contents: []byte("package helper\n\nfunc Run() {}\n"),
		},
	})
	if err == nil {
		t.Fatalf("expected build constraint exclusion error")
	}
	if !strings.Contains(err.Error(), "no files matching current target/build constraints") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildPackageTracksLocalReplaceModuleImports(t *testing.T) {
	result, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/cmd/app/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []SourceFile{
		{
			Path:     "/workspace/go.mod",
			Contents: []byte("module example.com/app\n\ngo 1.24\n\nreplace example.com/lib => ./third_party/lib\n"),
		},
		{
			Path:     "/workspace/cmd/app/main.go",
			Contents: []byte("package main\n\nimport \"example.com/lib/pkg\"\n\nfunc main() { pkg.Run() }\n"),
		},
		{
			Path:     "/workspace/third_party/lib/pkg/pkg.go",
			Contents: []byte("package pkg\n\nfunc Run() {}\n"),
		},
	})
	if err != nil {
		t.Fatalf("BuildPackage returned error: %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if !slices.Equal(result.Metadata.ReplacedModuleImports, []string{"example.com/lib/pkg"}) {
		t.Fatalf("unexpected replaced module imports: %#v", result.Metadata.ReplacedModuleImports)
	}
	if !slices.Equal(result.Metadata.ImportedPackageFiles, []string{"/workspace/third_party/lib/pkg/pkg.go"}) {
		t.Fatalf("unexpected imported package files: %#v", result.Metadata.ImportedPackageFiles)
	}
	if len(result.Metadata.ExternalImports) != 0 {
		t.Fatalf("unexpected external imports: %#v", result.Metadata.ExternalImports)
	}
}

func TestBuildPackageRejectsMissingLocalReplacePackageFiles(t *testing.T) {
	_, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/cmd/app/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []SourceFile{
		{
			Path:     "/workspace/go.mod",
			Contents: []byte("module example.com/app\n\ngo 1.24\n\nreplace example.com/lib => ./third_party/lib\n"),
		},
		{
			Path:     "/workspace/cmd/app/main.go",
			Contents: []byte("package main\n\nimport \"example.com/lib/pkg\"\n\nfunc main() { pkg.Run() }\n"),
		},
	})
	if err == nil {
		t.Fatalf("expected missing replaced module package error")
	}
	if !strings.Contains(err.Error(), "replaced module import package not found") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildPackageRejectsNonLocalModuleReplaceDirectives(t *testing.T) {
	_, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/cmd/app/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []SourceFile{
		{
			Path:     "/workspace/go.mod",
			Contents: []byte("module example.com/app\n\ngo 1.24\n\nreplace example.com/lib => example.com/lib v1.2.3\n"),
		},
		{
			Path:     "/workspace/cmd/app/main.go",
			Contents: []byte("package main\n\nimport \"example.com/lib/pkg\"\n\nfunc main() { pkg.Run() }\n"),
		},
	})
	if err == nil {
		t.Fatalf("expected unsupported non-local replace error")
	}
	if !strings.Contains(err.Error(), "non-local replace directive is not supported yet") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildPackageTracksWorkspaceModuleImports(t *testing.T) {
	result, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/app/cmd/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []SourceFile{
		{
			Path:     "/workspace/go.work",
			Contents: []byte("go 1.24\n\nuse (\n\t./app\n\t./libs/lib\n)\n"),
		},
		{
			Path:     "/workspace/app/go.mod",
			Contents: []byte("module example.com/app\n\ngo 1.24\n"),
		},
		{
			Path:     "/workspace/app/cmd/main.go",
			Contents: []byte("package main\n\nimport \"example.com/lib/pkg\"\n\nfunc main() { pkg.Run() }\n"),
		},
		{
			Path:     "/workspace/libs/lib/go.mod",
			Contents: []byte("module example.com/lib\n\ngo 1.24\n"),
		},
		{
			Path:     "/workspace/libs/lib/pkg/pkg.go",
			Contents: []byte("package pkg\n\nfunc Run() {}\n"),
		},
	})
	if err != nil {
		t.Fatalf("BuildPackage returned error: %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if !slices.Equal(result.Metadata.WorkspaceModuleImports, []string{"example.com/lib/pkg"}) {
		t.Fatalf("unexpected workspace module imports: %#v", result.Metadata.WorkspaceModuleImports)
	}
	if !slices.Equal(result.Metadata.ImportedPackageFiles, []string{"/workspace/libs/lib/pkg/pkg.go"}) {
		t.Fatalf("unexpected imported package files: %#v", result.Metadata.ImportedPackageFiles)
	}
}

func TestBuildPackageRejectsMissingWorkspaceModulePackageFiles(t *testing.T) {
	_, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/app/cmd/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []SourceFile{
		{
			Path:     "/workspace/go.work",
			Contents: []byte("go 1.24\n\nuse (\n\t./app\n\t./libs/lib\n)\n"),
		},
		{
			Path:     "/workspace/app/go.mod",
			Contents: []byte("module example.com/app\n\ngo 1.24\n"),
		},
		{
			Path:     "/workspace/app/cmd/main.go",
			Contents: []byte("package main\n\nimport \"example.com/lib/pkg\"\n\nfunc main() { pkg.Run() }\n"),
		},
		{
			Path:     "/workspace/libs/lib/go.mod",
			Contents: []byte("module example.com/lib\n\ngo 1.24\n"),
		},
	})
	if err == nil {
		t.Fatalf("expected missing workspace module package error")
	}
	if !strings.Contains(err.Error(), "workspace module import package not found") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildPackageRejectsNonLocalWorkfileReplaceDirectives(t *testing.T) {
	_, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/app/cmd/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []SourceFile{
		{
			Path:     "/workspace/go.work",
			Contents: []byte("go 1.24\n\nuse ./app\n\nreplace example.com/lib => example.com/lib v1.2.3\n"),
		},
		{
			Path:     "/workspace/app/go.mod",
			Contents: []byte("module example.com/app\n\ngo 1.24\n"),
		},
		{
			Path:     "/workspace/app/cmd/main.go",
			Contents: []byte("package main\n\nimport \"example.com/lib/pkg\"\n\nfunc main() { pkg.Run() }\n"),
		},
	})
	if err == nil {
		t.Fatalf("expected unsupported non-local workfile replace error")
	}
	if !strings.Contains(err.Error(), "non-local replace directive is not supported yet") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildPackageTracksWorkspaceModuleReplaceImports(t *testing.T) {
	result, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/app/cmd/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []SourceFile{
		{
			Path:     "/workspace/go.work",
			Contents: []byte("go 1.24\n\nuse (\n\t./app\n\t./libs/lib\n)\n"),
		},
		{
			Path:     "/workspace/app/go.mod",
			Contents: []byte("module example.com/app\n\ngo 1.24\n"),
		},
		{
			Path:     "/workspace/app/cmd/main.go",
			Contents: []byte("package main\n\nimport \"example.com/lib/pkg\"\n\nfunc main() { pkg.Run() }\n"),
		},
		{
			Path:     "/workspace/libs/lib/go.mod",
			Contents: []byte("module example.com/lib\n\ngo 1.24\n\nreplace example.com/dep => ../../shared/dep\n"),
		},
		{
			Path:     "/workspace/libs/lib/pkg/pkg.go",
			Contents: []byte("package pkg\n\nimport \"example.com/dep/value\"\n\nfunc Run() { value.Call() }\n"),
		},
		{
			Path:     "/workspace/shared/dep/go.mod",
			Contents: []byte("module example.com/dep\n\ngo 1.24\n"),
		},
		{
			Path:     "/workspace/shared/dep/value/value.go",
			Contents: []byte("package value\n\nfunc Call() {}\n"),
		},
	})
	if err != nil {
		t.Fatalf("BuildPackage returned error: %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if !slices.Equal(result.Metadata.WorkspaceModuleImports, []string{"example.com/lib/pkg"}) {
		t.Fatalf("unexpected workspace module imports: %#v", result.Metadata.WorkspaceModuleImports)
	}
	if !slices.Equal(result.Metadata.ReplacedModuleImports, []string{"example.com/dep/value"}) {
		t.Fatalf("unexpected replaced module imports: %#v", result.Metadata.ReplacedModuleImports)
	}
	if !slices.Equal(result.Metadata.ImportedPackageFiles, []string{
		"/workspace/libs/lib/pkg/pkg.go",
		"/workspace/shared/dep/value/value.go",
	}) {
		t.Fatalf("unexpected imported package files: %#v", result.Metadata.ImportedPackageFiles)
	}
}

func TestBuildPackageTracksWorkspaceReplaceModuleImports(t *testing.T) {
	result, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/app/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []SourceFile{
		{
			Path:     "/workspace/go.work",
			Contents: []byte("go 1.24\n\nuse ./app\n\nreplace example.com/lib => ./shared/lib\n"),
		},
		{
			Path:     "/workspace/app/go.mod",
			Contents: []byte("module example.com/app\n\ngo 1.24\n"),
		},
		{
			Path:     "/workspace/app/main.go",
			Contents: []byte("package main\n\nimport \"example.com/lib/pkg\"\n\nfunc main() { pkg.Run() }\n"),
		},
		{
			Path:     "/workspace/shared/lib/go.mod",
			Contents: []byte("module example.com/lib\n\ngo 1.24\n"),
		},
		{
			Path:     "/workspace/shared/lib/pkg/pkg.go",
			Contents: []byte("package pkg\n\nfunc Run() {}\n"),
		},
	})
	if err != nil {
		t.Fatalf("BuildPackage returned error: %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if len(result.Metadata.WorkspaceModuleImports) != 0 {
		t.Fatalf("unexpected workspace module imports: %#v", result.Metadata.WorkspaceModuleImports)
	}
	if !slices.Equal(result.Metadata.ReplacedModuleImports, []string{"example.com/lib/pkg"}) {
		t.Fatalf("unexpected replaced module imports: %#v", result.Metadata.ReplacedModuleImports)
	}
	if !slices.Equal(result.Metadata.ImportedPackageFiles, []string{"/workspace/shared/lib/pkg/pkg.go"}) {
		t.Fatalf("unexpected imported package files: %#v", result.Metadata.ImportedPackageFiles)
	}
}

func TestBuildSupportsOptimizeAliases(t *testing.T) {
	testCases := []struct {
		name     string
		optimize string
		wantFlag string
	}{
		{name: "default", optimize: "", wantFlag: "-Oz"},
		{name: "size", optimize: "z", wantFlag: "-Oz"},
		{name: "o0", optimize: "0", wantFlag: "-O0"},
		{name: "o1", optimize: "1", wantFlag: "-O1"},
		{name: "o2", optimize: "2", wantFlag: "-O2"},
		{name: "o3", optimize: "3", wantFlag: "-O3"},
		{name: "os", optimize: "s", wantFlag: "-Os"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result, err := Build(Request{
				Command:  "build",
				Planner:  "bootstrap",
				Entry:    "/workspace/main.go",
				Output:   "/working/out.wasm",
				Target:   "wasm",
				Optimize: tc.optimize,
			}, []byte("package main\n\nfunc main() {}\n"))
			if err != nil {
				t.Fatalf("Build returned error: %v", err)
			}
			if got := result.Plan[0].Argv[2]; got != tc.wantFlag {
				t.Fatalf("unexpected optimize flag: got %q want %q", got, tc.wantFlag)
			}
		})
	}
}

func TestBuildRejectsNonMainPackage(t *testing.T) {
	_, err := Build(Request{
		Command: "build",
		Entry:   "/workspace/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []byte("package helper\n"))
	if err == nil {
		t.Fatalf("expected package validation error")
	}
}

func TestBuildPackageRejectsMixedPackageFiles(t *testing.T) {
	_, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []SourceFile{
		{
			Path:     "/workspace/main.go",
			Contents: []byte("package main\n\nfunc main() {}\n"),
		},
		{
			Path:     "/workspace/helper.go",
			Contents: []byte("package helper\n\nfunc helper() {}\n"),
		},
	})
	if err == nil {
		t.Fatalf("expected mixed-package validation error")
	}
}

func TestBuildPackageIgnoresTestAndHiddenFiles(t *testing.T) {
	result, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []SourceFile{
		{
			Path:     "/workspace/main.go",
			Contents: []byte("package main\n\nimport \"fmt\"\n\nfunc main() { fmt.Println(\"ok\") }\n"),
		},
		{
			Path:     "/workspace/main_test.go",
			Contents: []byte("package broken\n"),
		},
		{
			Path:     "/workspace/.hidden.go",
			Contents: []byte("package broken\n"),
		},
		{
			Path:     "/workspace/_ignored.go",
			Contents: []byte("package broken\n"),
		},
	})
	if err != nil {
		t.Fatalf("BuildPackage returned error: %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if !slices.Equal(result.Metadata.PackageFiles, []string{"/workspace/main.go"}) {
		t.Fatalf("unexpected package files: %#v", result.Metadata.PackageFiles)
	}
}

func TestBuildPackageHonorsGoBuildConstraints(t *testing.T) {
	result, err := BuildPackage(Request{
		Command:   "build",
		Planner:   "tinygo",
		Entry:     "/workspace/main.go",
		Output:    "/working/out.wasm",
		Target:    "wasm",
		Scheduler: "tasks",
	}, []SourceFile{
		{
			Path:     "/workspace/main.go",
			Contents: []byte("package main\n\nfunc main() { browserOnly(); }\n"),
		},
		{
			Path:     "/workspace/browser.go",
			Contents: []byte("//go:build tinygo.wasm && scheduler.tasks\n\npackage main\n\nfunc browserOnly() {}\n"),
		},
		{
			Path:     "/workspace/wasip1_only.go",
			Contents: []byte("//go:build wasip1\n\npackage broken\n"),
		},
		{
			Path:     "/workspace/not_wasm.go",
			Contents: []byte("//go:build !tinygo.wasm\n\npackage broken\n"),
		},
	})
	if err != nil {
		t.Fatalf("BuildPackage returned error: %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if !slices.Equal(result.Metadata.PackageFiles, []string{"/workspace/browser.go", "/workspace/main.go"}) {
		t.Fatalf("unexpected package files: %#v", result.Metadata.PackageFiles)
	}
}

func TestBuildPackageHonorsWasip1BuildConstraints(t *testing.T) {
	result, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasip1",
	}, []SourceFile{
		{
			Path:     "/workspace/main.go",
			Contents: []byte("package main\n\nfunc main() {}\n"),
		},
		{
			Path:     "/workspace/wasip1_only.go",
			Contents: []byte("//go:build wasip1\n\npackage main\n\nfunc helper() {}\n"),
		},
		{
			Path:     "/workspace/js_only.go",
			Contents: []byte("//go:build js\n\npackage broken\n"),
		},
	})
	if err != nil {
		t.Fatalf("BuildPackage returned error: %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if !slices.Equal(result.Metadata.PackageFiles, []string{"/workspace/main.go", "/workspace/wasip1_only.go"}) {
		t.Fatalf("unexpected package files: %#v", result.Metadata.PackageFiles)
	}
}

func TestBuildPackageHonorsFilenameTargetSuffixesForWasm(t *testing.T) {
	result, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []SourceFile{
		{
			Path:     "/workspace/main.go",
			Contents: []byte("package main\n\nfunc main() { browserOnly(); archOnly(); comboOnly() }\n"),
		},
		{
			Path:     "/workspace/browser_js.go",
			Contents: []byte("package main\n\nfunc browserOnly() {}\n"),
		},
		{
			Path:     "/workspace/arch_wasm.go",
			Contents: []byte("package main\n\nfunc archOnly() {}\n"),
		},
		{
			Path:     "/workspace/combo_js_wasm.go",
			Contents: []byte("package main\n\nfunc comboOnly() {}\n"),
		},
		{
			Path:     "/workspace/host_wasip1.go",
			Contents: []byte("package broken\n"),
		},
	})
	if err != nil {
		t.Fatalf("BuildPackage returned error: %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if !slices.Equal(result.Metadata.PackageFiles, []string{
		"/workspace/arch_wasm.go",
		"/workspace/browser_js.go",
		"/workspace/combo_js_wasm.go",
		"/workspace/main.go",
	}) {
		t.Fatalf("unexpected package files: %#v", result.Metadata.PackageFiles)
	}
}

func TestBuildPackageHonorsFilenameTargetSuffixesForWasip1(t *testing.T) {
	result, err := BuildPackage(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasip1",
	}, []SourceFile{
		{
			Path:     "/workspace/main.go",
			Contents: []byte("package main\n\nfunc main() { hostOnly(); archOnly(); comboOnly() }\n"),
		},
		{
			Path:     "/workspace/host_wasip1.go",
			Contents: []byte("package main\n\nfunc hostOnly() {}\n"),
		},
		{
			Path:     "/workspace/arch_wasm.go",
			Contents: []byte("package main\n\nfunc archOnly() {}\n"),
		},
		{
			Path:     "/workspace/combo_wasip1_wasm.go",
			Contents: []byte("package main\n\nfunc comboOnly() {}\n"),
		},
		{
			Path:     "/workspace/browser_js.go",
			Contents: []byte("package broken\n"),
		},
	})
	if err != nil {
		t.Fatalf("BuildPackage returned error: %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if !slices.Equal(result.Metadata.PackageFiles, []string{
		"/workspace/arch_wasm.go",
		"/workspace/combo_wasip1_wasm.go",
		"/workspace/host_wasip1.go",
		"/workspace/main.go",
	}) {
		t.Fatalf("unexpected package files: %#v", result.Metadata.PackageFiles)
	}
}

func TestBuildRejectsMissingMainFunction(t *testing.T) {
	_, err := Build(Request{
		Command: "build",
		Entry:   "/workspace/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasm",
	}, []byte("package main\n\nfunc helper() {}\n"))
	if err == nil {
		t.Fatalf("expected main function validation error")
	}
}

func TestBuildRejectsInvalidMainSignature(t *testing.T) {
	testCases := []struct {
		name   string
		source string
	}{
		{
			name:   "parameters",
			source: "package main\n\nfunc main(arg string) {}\n",
		},
		{
			name:   "results",
			source: "package main\n\nfunc main() int { return 0 }\n",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Build(Request{
				Command: "build",
				Entry:   "/workspace/main.go",
				Output:  "/working/out.wasm",
				Target:  "wasm",
			}, []byte(tc.source))
			if err == nil {
				t.Fatalf("expected invalid main signature error")
			}
		})
	}
}

func TestBuildRejectsUnsupportedCompatibilityFlags(t *testing.T) {
	testCases := []struct {
		name    string
		request Request
	}{
		{
			name: "command",
			request: Request{
				Command: "run",
				Entry:   "/workspace/main.go",
				Output:  "/working/out.wasm",
				Target:  "wasm",
			},
		},
		{
			name: "target",
			request: Request{
				Command: "build",
				Entry:   "/workspace/main.go",
				Output:  "/working/out.wasm",
				Target:  "avr",
			},
		},
		{
			name: "optimize",
			request: Request{
				Command:  "build",
				Entry:    "/workspace/main.go",
				Output:   "/working/out.wasm",
				Target:   "wasm",
				Optimize: "fast",
			},
		},
		{
			name: "planner",
			request: Request{
				Command: "build",
				Planner: "full",
				Entry:   "/workspace/main.go",
				Output:  "/working/out.wasm",
				Target:  "wasm",
			},
		},
		{
			name: "scheduler",
			request: Request{
				Command:   "build",
				Entry:     "/workspace/main.go",
				Output:    "/working/out.wasm",
				Target:    "wasm",
				Scheduler: "threads",
			},
		},
		{
			name: "panic",
			request: Request{
				Command: "build",
				Entry:   "/workspace/main.go",
				Output:  "/working/out.wasm",
				Target:  "wasm",
				Panic:   "abort",
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Build(tc.request, []byte("package main\n\nfunc main() {}\n"))
			if err == nil {
				t.Fatalf("expected unsupported compatibility flag error")
			}
		})
	}
}

func TestExecutePathsWritesResultFile(t *testing.T) {
	tempDir := t.TempDir()
	requestPath := filepath.Join(tempDir, "tinygo-request.json")
	resultPath := filepath.Join(tempDir, "tinygo-result.json")
	entryPath := filepath.Join(tempDir, "main.go")

	payload, err := json.Marshal(Request{
		Command: "build",
		Planner: "bootstrap",
		Entry:   entryPath,
		Output:  "/working/out.wasm",
		Target:  "wasm",
	})
	if err != nil {
		t.Fatalf("json.Marshal(request): %v", err)
	}
	if err := os.WriteFile(requestPath, payload, 0o644); err != nil {
		t.Fatalf("os.WriteFile(requestPath): %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("package main\n\nfunc main() {}\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(entryPath): %v", err)
	}

	if err := ExecutePaths(requestPath, resultPath); err != nil {
		t.Fatalf("ExecutePaths returned error: %v", err)
	}

	data, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatalf("os.ReadFile(resultPath): %v", err)
	}

	var result Result
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal(result): %v", err)
	}

	if !result.OK {
		t.Fatalf("expected OK result, got %#v", result)
	}
	if len(result.Plan) == 0 {
		t.Fatalf("expected a non-empty plan, got %#v", result)
	}
}

func TestExecutePathsWritesFailureResultOnInvalidEntry(t *testing.T) {
	tempDir := t.TempDir()
	requestPath := filepath.Join(tempDir, "tinygo-request.json")
	resultPath := filepath.Join(tempDir, "tinygo-result.json")
	entryPath := filepath.Join(tempDir, "main.go")

	payload, err := json.Marshal(Request{
		Command: "build",
		Entry:   entryPath,
		Output:  "/working/out.wasm",
		Target:  "wasm",
	})
	if err != nil {
		t.Fatalf("json.Marshal(request): %v", err)
	}
	if err := os.WriteFile(requestPath, payload, 0o644); err != nil {
		t.Fatalf("os.WriteFile(requestPath): %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("package main\n\nfunc helper() {}\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(entryPath): %v", err)
	}

	err = ExecutePaths(requestPath, resultPath)
	if err == nil {
		t.Fatalf("expected ExecutePaths to return error")
	}

	data, readErr := os.ReadFile(resultPath)
	if readErr != nil {
		t.Fatalf("os.ReadFile(resultPath): %v", readErr)
	}

	var result Result
	if unmarshalErr := json.Unmarshal(data, &result); unmarshalErr != nil {
		t.Fatalf("json.Unmarshal(result): %v", unmarshalErr)
	}
	if result.OK {
		t.Fatalf("expected failed result, got %#v", result)
	}
	if len(result.Diagnostics) == 0 {
		t.Fatalf("expected diagnostics for failed result")
	}
}

func TestExecutePathsLoadsSameDirectoryGoFiles(t *testing.T) {
	tempDir := t.TempDir()
	requestPath := filepath.Join(tempDir, "tinygo-request.json")
	resultPath := filepath.Join(tempDir, "tinygo-result.json")
	entryPath := filepath.Join(tempDir, "main.go")
	helperPath := filepath.Join(tempDir, "helper.go")

	payload, err := json.Marshal(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   entryPath,
		Output:  "/working/out.wasm",
		Target:  "wasm",
	})
	if err != nil {
		t.Fatalf("json.Marshal(request): %v", err)
	}
	if err := os.WriteFile(requestPath, payload, 0o644); err != nil {
		t.Fatalf("os.WriteFile(requestPath): %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("package main\n\nimport \"fmt\"\n\nfunc main() { helper(); fmt.Println(\"ok\") }\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(entryPath): %v", err)
	}
	if err := os.WriteFile(helperPath, []byte("package main\n\nfunc helper() {}\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(helperPath): %v", err)
	}

	if err := ExecutePaths(requestPath, resultPath); err != nil {
		t.Fatalf("ExecutePaths returned error: %v", err)
	}

	data, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatalf("os.ReadFile(resultPath): %v", err)
	}

	var result Result
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal(result): %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if !slices.Equal(result.Metadata.PackageFiles, []string{helperPath, entryPath}) {
		t.Fatalf("unexpected package files: %#v", result.Metadata.PackageFiles)
	}
	if !slices.Equal(result.Metadata.Imports, []string{"fmt"}) {
		t.Fatalf("unexpected imports: %#v", result.Metadata.Imports)
	}
}

func TestExecutePathsIgnoresTestAndHiddenGoFiles(t *testing.T) {
	tempDir := t.TempDir()
	requestPath := filepath.Join(tempDir, "tinygo-request.json")
	resultPath := filepath.Join(tempDir, "tinygo-result.json")
	entryPath := filepath.Join(tempDir, "main.go")
	testPath := filepath.Join(tempDir, "main_test.go")
	hiddenPath := filepath.Join(tempDir, ".hidden.go")
	ignoredPath := filepath.Join(tempDir, "_ignored.go")

	payload, err := json.Marshal(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   entryPath,
		Output:  "/working/out.wasm",
		Target:  "wasm",
	})
	if err != nil {
		t.Fatalf("json.Marshal(request): %v", err)
	}
	if err := os.WriteFile(requestPath, payload, 0o644); err != nil {
		t.Fatalf("os.WriteFile(requestPath): %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("package main\n\nfunc main() {}\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(entryPath): %v", err)
	}
	if err := os.WriteFile(testPath, []byte("package broken\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(testPath): %v", err)
	}
	if err := os.WriteFile(hiddenPath, []byte("package broken\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(hiddenPath): %v", err)
	}
	if err := os.WriteFile(ignoredPath, []byte("package broken\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(ignoredPath): %v", err)
	}

	if err := ExecutePaths(requestPath, resultPath); err != nil {
		t.Fatalf("ExecutePaths returned error: %v", err)
	}

	data, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatalf("os.ReadFile(resultPath): %v", err)
	}

	var result Result
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal(result): %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if !slices.Equal(result.Metadata.PackageFiles, []string{entryPath}) {
		t.Fatalf("unexpected package files: %#v", result.Metadata.PackageFiles)
	}
}

func TestExecutePathsHonorsGoBuildConstraints(t *testing.T) {
	tempDir := t.TempDir()
	requestPath := filepath.Join(tempDir, "tinygo-request.json")
	resultPath := filepath.Join(tempDir, "tinygo-result.json")
	entryPath := filepath.Join(tempDir, "main.go")
	wasmOnlyPath := filepath.Join(tempDir, "browser.go")
	wasip1OnlyPath := filepath.Join(tempDir, "wasip1_only.go")

	payload, err := json.Marshal(Request{
		Command:   "build",
		Planner:   "tinygo",
		Entry:     entryPath,
		Output:    "/working/out.wasm",
		Target:    "wasm",
		Scheduler: "tasks",
	})
	if err != nil {
		t.Fatalf("json.Marshal(request): %v", err)
	}
	if err := os.WriteFile(requestPath, payload, 0o644); err != nil {
		t.Fatalf("os.WriteFile(requestPath): %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("package main\n\nfunc main() { browserOnly() }\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(entryPath): %v", err)
	}
	if err := os.WriteFile(wasmOnlyPath, []byte("//go:build tinygo.wasm && scheduler.tasks\n\npackage main\n\nfunc browserOnly() {}\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(wasmOnlyPath): %v", err)
	}
	if err := os.WriteFile(wasip1OnlyPath, []byte("//go:build wasip1\n\npackage broken\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(wasip1OnlyPath): %v", err)
	}

	if err := ExecutePaths(requestPath, resultPath); err != nil {
		t.Fatalf("ExecutePaths returned error: %v", err)
	}

	data, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatalf("os.ReadFile(resultPath): %v", err)
	}

	var result Result
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal(result): %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if !slices.Equal(result.Metadata.PackageFiles, []string{wasmOnlyPath, entryPath}) {
		t.Fatalf("unexpected package files: %#v", result.Metadata.PackageFiles)
	}
}

func TestExecutePathsHonorsFilenameTargetSuffixes(t *testing.T) {
	tempDir := t.TempDir()
	requestPath := filepath.Join(tempDir, "tinygo-request.json")
	resultPath := filepath.Join(tempDir, "tinygo-result.json")
	entryPath := filepath.Join(tempDir, "main.go")
	jsPath := filepath.Join(tempDir, "browser_js.go")
	wasmPath := filepath.Join(tempDir, "arch_wasm.go")
	wasip1Path := filepath.Join(tempDir, "host_wasip1.go")

	payload, err := json.Marshal(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   entryPath,
		Output:  "/working/out.wasm",
		Target:  "wasm",
	})
	if err != nil {
		t.Fatalf("json.Marshal(request): %v", err)
	}
	if err := os.WriteFile(requestPath, payload, 0o644); err != nil {
		t.Fatalf("os.WriteFile(requestPath): %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("package main\n\nfunc main() { browserOnly(); archOnly() }\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(entryPath): %v", err)
	}
	if err := os.WriteFile(jsPath, []byte("package main\n\nfunc browserOnly() {}\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(jsPath): %v", err)
	}
	if err := os.WriteFile(wasmPath, []byte("package main\n\nfunc archOnly() {}\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(wasmPath): %v", err)
	}
	if err := os.WriteFile(wasip1Path, []byte("package broken\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(wasip1Path): %v", err)
	}

	if err := ExecutePaths(requestPath, resultPath); err != nil {
		t.Fatalf("ExecutePaths returned error: %v", err)
	}

	data, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatalf("os.ReadFile(resultPath): %v", err)
	}

	var result Result
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal(result): %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if !slices.Equal(result.Metadata.PackageFiles, []string{wasmPath, jsPath, entryPath}) {
		t.Fatalf("unexpected package files: %#v", result.Metadata.PackageFiles)
	}
}

func TestExecutePathsLoadsGoModForCurrentModuleImports(t *testing.T) {
	tempDir := t.TempDir()
	requestPath := filepath.Join(tempDir, "tinygo-request.json")
	resultPath := filepath.Join(tempDir, "tinygo-result.json")
	modulePath := filepath.Join(tempDir, "go.mod")
	entryDir := filepath.Join(tempDir, "cmd", "app")
	entryPath := filepath.Join(entryDir, "main.go")

	if err := os.MkdirAll(entryDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(entryDir): %v", err)
	}
	payload, err := json.Marshal(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   entryPath,
		Output:  "/working/out.wasm",
		Target:  "wasm",
	})
	if err != nil {
		t.Fatalf("json.Marshal(request): %v", err)
	}
	if err := os.WriteFile(requestPath, payload, 0o644); err != nil {
		t.Fatalf("os.WriteFile(requestPath): %v", err)
	}
	if err := os.WriteFile(modulePath, []byte("module example.com/app\n\ngo 1.24\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(modulePath): %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("package main\n\nimport \"example.com/app/internal/helper\"\n\nfunc main() { helper.Run() }\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(entryPath): %v", err)
	}
	helperDir := filepath.Join(tempDir, "internal", "helper")
	if err := os.MkdirAll(helperDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(helperDir): %v", err)
	}
	helperPath := filepath.Join(helperDir, "helper.go")
	if err := os.WriteFile(helperPath, []byte("package helper\n\nfunc Run() {}\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(helperPath): %v", err)
	}
	deepDir := filepath.Join(tempDir, "internal", "deep")
	if err := os.MkdirAll(deepDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(deepDir): %v", err)
	}
	deepPath := filepath.Join(deepDir, "deep.go")
	if err := os.WriteFile(helperPath, []byte("package helper\n\nimport \"example.com/app/internal/deep\"\n\nfunc Run() { deep.Call() }\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(helperPath): %v", err)
	}
	if err := os.WriteFile(deepPath, []byte("package deep\n\nfunc Call() {}\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(deepPath): %v", err)
	}

	if err := ExecutePaths(requestPath, resultPath); err != nil {
		t.Fatalf("ExecutePaths returned error: %v", err)
	}

	data, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatalf("os.ReadFile(resultPath): %v", err)
	}

	var result Result
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal(result): %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if result.Metadata.ModulePath != "example.com/app" {
		t.Fatalf("unexpected module path: %q", result.Metadata.ModulePath)
	}
	if !slices.Equal(result.Metadata.LocalModuleImports, []string{
		"example.com/app/internal/deep",
		"example.com/app/internal/helper",
	}) {
		t.Fatalf("unexpected local module imports: %#v", result.Metadata.LocalModuleImports)
	}
	if !slices.Equal(result.Metadata.ImportedPackageFiles, []string{deepPath, helperPath}) {
		t.Fatalf("unexpected imported package files: %#v", result.Metadata.ImportedPackageFiles)
	}
}

func TestExecutePathsLoadsLocalReplaceModuleImports(t *testing.T) {
	tempDir := t.TempDir()
	requestPath := filepath.Join(tempDir, "tinygo-request.json")
	resultPath := filepath.Join(tempDir, "tinygo-result.json")
	modulePath := filepath.Join(tempDir, "go.mod")
	entryDir := filepath.Join(tempDir, "cmd", "app")
	entryPath := filepath.Join(entryDir, "main.go")

	if err := os.MkdirAll(entryDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(entryDir): %v", err)
	}
	payload, err := json.Marshal(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   entryPath,
		Output:  "/working/out.wasm",
		Target:  "wasm",
	})
	if err != nil {
		t.Fatalf("json.Marshal(request): %v", err)
	}
	if err := os.WriteFile(requestPath, payload, 0o644); err != nil {
		t.Fatalf("os.WriteFile(requestPath): %v", err)
	}
	if err := os.WriteFile(modulePath, []byte("module example.com/app\n\ngo 1.24\n\nreplace example.com/lib => ./third_party/lib\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(modulePath): %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("package main\n\nimport \"example.com/lib/pkg\"\n\nfunc main() { pkg.Run() }\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(entryPath): %v", err)
	}
	replacedDir := filepath.Join(tempDir, "third_party", "lib", "pkg")
	if err := os.MkdirAll(replacedDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(replacedDir): %v", err)
	}
	replacedPath := filepath.Join(replacedDir, "pkg.go")
	if err := os.WriteFile(replacedPath, []byte("package pkg\n\nfunc Run() {}\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(replacedPath): %v", err)
	}

	if err := ExecutePaths(requestPath, resultPath); err != nil {
		t.Fatalf("ExecutePaths returned error: %v", err)
	}

	data, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatalf("os.ReadFile(resultPath): %v", err)
	}

	var result Result
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal(result): %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if !slices.Equal(result.Metadata.ReplacedModuleImports, []string{"example.com/lib/pkg"}) {
		t.Fatalf("unexpected replaced module imports: %#v", result.Metadata.ReplacedModuleImports)
	}
	if !slices.Equal(result.Metadata.ImportedPackageFiles, []string{replacedPath}) {
		t.Fatalf("unexpected imported package files: %#v", result.Metadata.ImportedPackageFiles)
	}
}

func TestExecutePathsLoadsWorkspaceModuleImports(t *testing.T) {
	tempDir := t.TempDir()
	requestPath := filepath.Join(tempDir, "tinygo-request.json")
	resultPath := filepath.Join(tempDir, "tinygo-result.json")
	workPath := filepath.Join(tempDir, "go.work")
	appDir := filepath.Join(tempDir, "app")
	appModulePath := filepath.Join(appDir, "go.mod")
	entryDir := filepath.Join(appDir, "cmd")
	entryPath := filepath.Join(entryDir, "main.go")
	libModulePath := filepath.Join(tempDir, "libs", "lib", "go.mod")
	libPkgDir := filepath.Join(tempDir, "libs", "lib", "pkg")

	if err := os.MkdirAll(entryDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(entryDir): %v", err)
	}
	if err := os.MkdirAll(libPkgDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(libPkgDir): %v", err)
	}
	payload, err := json.Marshal(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   entryPath,
		Output:  "/working/out.wasm",
		Target:  "wasm",
	})
	if err != nil {
		t.Fatalf("json.Marshal(request): %v", err)
	}
	if err := os.WriteFile(requestPath, payload, 0o644); err != nil {
		t.Fatalf("os.WriteFile(requestPath): %v", err)
	}
	if err := os.WriteFile(workPath, []byte("go 1.24\n\nuse (\n\t./app\n\t./libs/lib\n)\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(workPath): %v", err)
	}
	if err := os.WriteFile(appModulePath, []byte("module example.com/app\n\ngo 1.24\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(appModulePath): %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("package main\n\nimport \"example.com/lib/pkg\"\n\nfunc main() { pkg.Run() }\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(entryPath): %v", err)
	}
	if err := os.WriteFile(libModulePath, []byte("module example.com/lib\n\ngo 1.24\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(libModulePath): %v", err)
	}
	libPkgPath := filepath.Join(libPkgDir, "pkg.go")
	if err := os.WriteFile(libPkgPath, []byte("package pkg\n\nfunc Run() {}\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(libPkgPath): %v", err)
	}

	if err := ExecutePaths(requestPath, resultPath); err != nil {
		t.Fatalf("ExecutePaths returned error: %v", err)
	}

	data, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatalf("os.ReadFile(resultPath): %v", err)
	}

	var result Result
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal(result): %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if !slices.Equal(result.Metadata.WorkspaceModuleImports, []string{"example.com/lib/pkg"}) {
		t.Fatalf("unexpected workspace module imports: %#v", result.Metadata.WorkspaceModuleImports)
	}
	if !slices.Equal(result.Metadata.ImportedPackageFiles, []string{libPkgPath}) {
		t.Fatalf("unexpected imported package files: %#v", result.Metadata.ImportedPackageFiles)
	}
}

func TestExecutePathsLoadsWorkspaceModuleReplaceImports(t *testing.T) {
	tempDir := t.TempDir()
	requestPath := filepath.Join(tempDir, "tinygo-request.json")
	resultPath := filepath.Join(tempDir, "tinygo-result.json")
	workPath := filepath.Join(tempDir, "go.work")
	appDir := filepath.Join(tempDir, "app")
	appModulePath := filepath.Join(appDir, "go.mod")
	entryDir := filepath.Join(appDir, "cmd")
	entryPath := filepath.Join(entryDir, "main.go")
	libModulePath := filepath.Join(tempDir, "libs", "lib", "go.mod")
	libPkgDir := filepath.Join(tempDir, "libs", "lib", "pkg")
	depModulePath := filepath.Join(tempDir, "shared", "dep", "go.mod")
	depValueDir := filepath.Join(tempDir, "shared", "dep", "value")

	if err := os.MkdirAll(entryDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(entryDir): %v", err)
	}
	if err := os.MkdirAll(libPkgDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(libPkgDir): %v", err)
	}
	if err := os.MkdirAll(depValueDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(depValueDir): %v", err)
	}
	payload, err := json.Marshal(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   entryPath,
		Output:  "/working/out.wasm",
		Target:  "wasm",
	})
	if err != nil {
		t.Fatalf("json.Marshal(request): %v", err)
	}
	if err := os.WriteFile(requestPath, payload, 0o644); err != nil {
		t.Fatalf("os.WriteFile(requestPath): %v", err)
	}
	if err := os.WriteFile(workPath, []byte("go 1.24\n\nuse (\n\t./app\n\t./libs/lib\n)\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(workPath): %v", err)
	}
	if err := os.WriteFile(appModulePath, []byte("module example.com/app\n\ngo 1.24\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(appModulePath): %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("package main\n\nimport \"example.com/lib/pkg\"\n\nfunc main() { pkg.Run() }\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(entryPath): %v", err)
	}
	if err := os.WriteFile(libModulePath, []byte("module example.com/lib\n\ngo 1.24\n\nreplace example.com/dep => ../../shared/dep\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(libModulePath): %v", err)
	}
	libPkgPath := filepath.Join(libPkgDir, "pkg.go")
	if err := os.WriteFile(libPkgPath, []byte("package pkg\n\nimport \"example.com/dep/value\"\n\nfunc Run() { value.Call() }\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(libPkgPath): %v", err)
	}
	if err := os.WriteFile(depModulePath, []byte("module example.com/dep\n\ngo 1.24\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(depModulePath): %v", err)
	}
	depValuePath := filepath.Join(depValueDir, "value.go")
	if err := os.WriteFile(depValuePath, []byte("package value\n\nfunc Call() {}\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(depValuePath): %v", err)
	}

	if err := ExecutePaths(requestPath, resultPath); err != nil {
		t.Fatalf("ExecutePaths returned error: %v", err)
	}

	data, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatalf("os.ReadFile(resultPath): %v", err)
	}

	var result Result
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal(result): %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if !slices.Equal(result.Metadata.WorkspaceModuleImports, []string{"example.com/lib/pkg"}) {
		t.Fatalf("unexpected workspace module imports: %#v", result.Metadata.WorkspaceModuleImports)
	}
	if !slices.Equal(result.Metadata.ReplacedModuleImports, []string{"example.com/dep/value"}) {
		t.Fatalf("unexpected replaced module imports: %#v", result.Metadata.ReplacedModuleImports)
	}
	if !slices.Equal(result.Metadata.ImportedPackageFiles, []string{libPkgPath, depValuePath}) {
		t.Fatalf("unexpected imported package files: %#v", result.Metadata.ImportedPackageFiles)
	}
}

func TestExecutePathsLoadsWorkspaceReplaceModuleImports(t *testing.T) {
	tempDir := t.TempDir()
	requestPath := filepath.Join(tempDir, "tinygo-request.json")
	resultPath := filepath.Join(tempDir, "tinygo-result.json")
	workPath := filepath.Join(tempDir, "go.work")
	appDir := filepath.Join(tempDir, "app")
	appModulePath := filepath.Join(appDir, "go.mod")
	entryPath := filepath.Join(appDir, "main.go")
	sharedLibDir := filepath.Join(tempDir, "shared", "lib", "pkg")

	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(appDir): %v", err)
	}
	if err := os.MkdirAll(sharedLibDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(sharedLibDir): %v", err)
	}
	payload, err := json.Marshal(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   entryPath,
		Output:  "/working/out.wasm",
		Target:  "wasm",
	})
	if err != nil {
		t.Fatalf("json.Marshal(request): %v", err)
	}
	if err := os.WriteFile(requestPath, payload, 0o644); err != nil {
		t.Fatalf("os.WriteFile(requestPath): %v", err)
	}
	if err := os.WriteFile(workPath, []byte("go 1.24\n\nuse ./app\n\nreplace example.com/lib => ./shared/lib\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(workPath): %v", err)
	}
	if err := os.WriteFile(appModulePath, []byte("module example.com/app\n\ngo 1.24\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(appModulePath): %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("package main\n\nimport \"example.com/lib/pkg\"\n\nfunc main() { pkg.Run() }\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(entryPath): %v", err)
	}
	sharedLibModulePath := filepath.Join(tempDir, "shared", "lib", "go.mod")
	if err := os.WriteFile(sharedLibModulePath, []byte("module example.com/lib\n\ngo 1.24\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(sharedLibModulePath): %v", err)
	}
	sharedLibPkgPath := filepath.Join(sharedLibDir, "pkg.go")
	if err := os.WriteFile(sharedLibPkgPath, []byte("package pkg\n\nfunc Run() {}\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(sharedLibPkgPath): %v", err)
	}

	if err := ExecutePaths(requestPath, resultPath); err != nil {
		t.Fatalf("ExecutePaths returned error: %v", err)
	}

	data, err := os.ReadFile(resultPath)
	if err != nil {
		t.Fatalf("os.ReadFile(resultPath): %v", err)
	}

	var result Result
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("json.Unmarshal(result): %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata")
	}
	if len(result.Metadata.WorkspaceModuleImports) != 0 {
		t.Fatalf("unexpected workspace module imports: %#v", result.Metadata.WorkspaceModuleImports)
	}
	if !slices.Equal(result.Metadata.ReplacedModuleImports, []string{"example.com/lib/pkg"}) {
		t.Fatalf("unexpected replaced module imports: %#v", result.Metadata.ReplacedModuleImports)
	}
	if !slices.Equal(result.Metadata.ImportedPackageFiles, []string{sharedLibPkgPath}) {
		t.Fatalf("unexpected imported package files: %#v", result.Metadata.ImportedPackageFiles)
	}
}

func TestExecutePathsWritesFailureForNonLocalWorkfileReplace(t *testing.T) {
	tempDir := t.TempDir()
	requestPath := filepath.Join(tempDir, "tinygo-request.json")
	resultPath := filepath.Join(tempDir, "tinygo-result.json")
	workPath := filepath.Join(tempDir, "go.work")
	appDir := filepath.Join(tempDir, "app")
	appModulePath := filepath.Join(appDir, "go.mod")
	entryPath := filepath.Join(appDir, "main.go")

	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(appDir): %v", err)
	}
	payload, err := json.Marshal(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   entryPath,
		Output:  "/working/out.wasm",
		Target:  "wasm",
	})
	if err != nil {
		t.Fatalf("json.Marshal(request): %v", err)
	}
	if err := os.WriteFile(requestPath, payload, 0o644); err != nil {
		t.Fatalf("os.WriteFile(requestPath): %v", err)
	}
	if err := os.WriteFile(workPath, []byte("go 1.24\n\nuse ./app\n\nreplace example.com/lib => example.com/lib v1.2.3\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(workPath): %v", err)
	}
	if err := os.WriteFile(appModulePath, []byte("module example.com/app\n\ngo 1.24\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(appModulePath): %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("package main\n\nimport \"example.com/lib/pkg\"\n\nfunc main() { pkg.Run() }\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(entryPath): %v", err)
	}

	err = ExecutePaths(requestPath, resultPath)
	if err == nil {
		t.Fatalf("expected ExecutePaths to return error")
	}

	data, readErr := os.ReadFile(resultPath)
	if readErr != nil {
		t.Fatalf("os.ReadFile(resultPath): %v", readErr)
	}
	var result Result
	if unmarshalErr := json.Unmarshal(data, &result); unmarshalErr != nil {
		t.Fatalf("json.Unmarshal(result): %v", unmarshalErr)
	}
	if result.OK {
		t.Fatalf("expected failed result, got %#v", result)
	}
	if len(result.Diagnostics) == 0 || !strings.Contains(result.Diagnostics[0], "non-local replace directive is not supported yet") {
		t.Fatalf("unexpected diagnostics: %#v", result.Diagnostics)
	}
}

func TestExecutePathsWritesFailureForCurrentModuleImportCycle(t *testing.T) {
	tempDir := t.TempDir()
	requestPath := filepath.Join(tempDir, "tinygo-request.json")
	resultPath := filepath.Join(tempDir, "tinygo-result.json")
	goModPath := filepath.Join(tempDir, "go.mod")
	entryDir := filepath.Join(tempDir, "cmd", "app")
	entryPath := filepath.Join(entryDir, "main.go")
	helperDir := filepath.Join(tempDir, "internal", "helper")
	deepDir := filepath.Join(tempDir, "internal", "deep")

	if err := os.MkdirAll(entryDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(entryDir): %v", err)
	}
	if err := os.MkdirAll(helperDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(helperDir): %v", err)
	}
	if err := os.MkdirAll(deepDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(deepDir): %v", err)
	}
	payload, err := json.Marshal(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   entryPath,
		Output:  "/working/out.wasm",
		Target:  "wasm",
	})
	if err != nil {
		t.Fatalf("json.Marshal(request): %v", err)
	}
	if err := os.WriteFile(requestPath, payload, 0o644); err != nil {
		t.Fatalf("os.WriteFile(requestPath): %v", err)
	}
	if err := os.WriteFile(goModPath, []byte("module example.com/app\n\ngo 1.24\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(goModPath): %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("package main\n\nimport \"example.com/app/internal/helper\"\n\nfunc main() { helper.Run() }\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(entryPath): %v", err)
	}
	if err := os.WriteFile(filepath.Join(helperDir, "helper.go"), []byte("package helper\n\nimport \"example.com/app/internal/deep\"\n\nfunc Run() { deep.Call() }\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(helper.go): %v", err)
	}
	if err := os.WriteFile(filepath.Join(deepDir, "deep.go"), []byte("package deep\n\nimport \"example.com/app/internal/helper\"\n\nfunc Call() { helper.Run() }\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(deep.go): %v", err)
	}

	err = ExecutePaths(requestPath, resultPath)
	if err == nil {
		t.Fatalf("expected ExecutePaths to return error")
	}

	data, readErr := os.ReadFile(resultPath)
	if readErr != nil {
		t.Fatalf("os.ReadFile(resultPath): %v", readErr)
	}
	var result Result
	if unmarshalErr := json.Unmarshal(data, &result); unmarshalErr != nil {
		t.Fatalf("json.Unmarshal(result): %v", unmarshalErr)
	}
	if result.OK {
		t.Fatalf("expected failed result, got %#v", result)
	}
	if len(result.Diagnostics) == 0 || !strings.Contains(result.Diagnostics[0], "import cycle") {
		t.Fatalf("unexpected diagnostics: %#v", result.Diagnostics)
	}
}

func TestExecutePathsWritesFailureForExcludedCurrentModulePackage(t *testing.T) {
	tempDir := t.TempDir()
	requestPath := filepath.Join(tempDir, "tinygo-request.json")
	resultPath := filepath.Join(tempDir, "tinygo-result.json")
	goModPath := filepath.Join(tempDir, "go.mod")
	entryDir := filepath.Join(tempDir, "cmd", "app")
	entryPath := filepath.Join(entryDir, "main.go")
	helperDir := filepath.Join(tempDir, "internal", "helper")

	if err := os.MkdirAll(entryDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(entryDir): %v", err)
	}
	if err := os.MkdirAll(helperDir, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(helperDir): %v", err)
	}
	payload, err := json.Marshal(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   entryPath,
		Output:  "/working/out.wasm",
		Target:  "wasm",
	})
	if err != nil {
		t.Fatalf("json.Marshal(request): %v", err)
	}
	if err := os.WriteFile(requestPath, payload, 0o644); err != nil {
		t.Fatalf("os.WriteFile(requestPath): %v", err)
	}
	if err := os.WriteFile(goModPath, []byte("module example.com/app\n\ngo 1.24\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(goModPath): %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("package main\n\nimport \"example.com/app/internal/helper\"\n\nfunc main() { helper.Run() }\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(entryPath): %v", err)
	}
	if err := os.WriteFile(filepath.Join(helperDir, "helper_wasip1.go"), []byte("package helper\n\nfunc Run() {}\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(helper_wasip1.go): %v", err)
	}

	err = ExecutePaths(requestPath, resultPath)
	if err == nil {
		t.Fatalf("expected ExecutePaths to return error")
	}

	data, readErr := os.ReadFile(resultPath)
	if readErr != nil {
		t.Fatalf("os.ReadFile(resultPath): %v", readErr)
	}
	var result Result
	if unmarshalErr := json.Unmarshal(data, &result); unmarshalErr != nil {
		t.Fatalf("json.Unmarshal(result): %v", unmarshalErr)
	}
	if result.OK {
		t.Fatalf("expected failed result, got %#v", result)
	}
	if len(result.Diagnostics) == 0 || !strings.Contains(result.Diagnostics[0], "no files matching current target/build constraints") {
		t.Fatalf("unexpected diagnostics: %#v", result.Diagnostics)
	}
}

func TestBuildAcceptsTinyGoStyleOptions(t *testing.T) {
	result, err := Build(Request{
		Command:   "build",
		Planner:   "tinygo",
		Entry:     "/workspace/main.go",
		Output:    "/working/out.wasm",
		Target:    "wasm",
		Scheduler: "tasks",
		Panic:     "trap",
	}, []byte("package main\n\nfunc main() {}\n"))
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if result.Mode != "tinygo-bootstrap" {
		t.Fatalf("unexpected tinygo mode: %q", result.Mode)
	}
	if len(result.Diagnostics) == 0 {
		t.Fatalf("expected tinygo planner diagnostics")
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata for tinygo planner")
	}
	if result.Metadata.Scheduler != "tasks" {
		t.Fatalf("unexpected scheduler metadata: %q", result.Metadata.Scheduler)
	}
	if result.Metadata.PanicStrategy != "trap" {
		t.Fatalf("unexpected panic metadata: %q", result.Metadata.PanicStrategy)
	}
	if result.Metadata.GC != "precise" {
		t.Fatalf("unexpected GC metadata: %q", result.Metadata.GC)
	}
	wantTags := []string{"tinygo.wasm", "scheduler.tasks", "gc.precise", "serial.none", "tinygo.unicore"}
	for _, want := range wantTags {
		found := false
		for _, got := range result.Metadata.BuildTags {
			if got == want {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("expected build tag %q in %#v", want, result.Metadata.BuildTags)
		}
	}
}

func TestBuildSupportsWasip1Target(t *testing.T) {
	result, err := Build(Request{
		Command: "build",
		Planner: "tinygo",
		Entry:   "/workspace/main.go",
		Output:  "/working/out.wasm",
		Target:  "wasip1",
	}, []byte("package main\n\nfunc main() {}\n"))
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if result.Metadata == nil {
		t.Fatalf("expected metadata for wasip1 target")
	}
	if result.Metadata.GOOS != "wasip1" {
		t.Fatalf("unexpected wasip1 GOOS: %q", result.Metadata.GOOS)
	}
	if got := result.Plan[0].Argv[1]; got != "--target=wasm32-unknown-wasi" {
		t.Fatalf("unexpected compile target for wasip1: %q", got)
	}
}

func TestBuildSupportsWasipPreviewTargets(t *testing.T) {
	for _, target := range []string{"wasip2", "wasip3"} {
		t.Run(target, func(t *testing.T) {
			result, err := Build(Request{
				Command: "build",
				Planner: "tinygo",
				Entry:   "/workspace/main.go",
				Output:  "/working/out.wasm",
				Target:  target,
			}, []byte("package main\n\nfunc main() {}\n"))
			if err != nil {
				t.Fatalf("Build returned error: %v", err)
			}
			if result.Metadata == nil {
				t.Fatalf("expected metadata for %s target", target)
			}
			if result.Metadata.GOOS != "linux" {
				t.Fatalf("unexpected %s GOOS: %q", target, result.Metadata.GOOS)
			}
			if result.Metadata.GOARCH != "arm" {
				t.Fatalf("unexpected %s GOARCH: %q", target, result.Metadata.GOARCH)
			}
			foundTargetTag := false
			for _, tag := range result.Metadata.BuildTags {
				if tag == target {
					foundTargetTag = true
					break
				}
			}
			if !foundTargetTag {
				t.Fatalf("expected build tag %q in %#v", target, result.Metadata.BuildTags)
			}
			if got := result.Plan[0].Argv[1]; got != "--target=wasm32-unknown-wasi" {
				t.Fatalf("unexpected compile target for %s: %q", target, got)
			}
		})
	}
}
