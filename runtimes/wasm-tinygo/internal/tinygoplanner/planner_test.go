package tinygoplanner

import (
	"encoding/json"
	"reflect"
	"slices"
	"strings"
	"testing"

	"wasm-tinygo/internal/tinygotarget"
)

func TestPlanBuildReturnsBootstrapSmokePlan(t *testing.T) {
	profile, err := tinygotarget.Resolve("wasm")
	if err != nil {
		t.Fatalf("tinygotarget.Resolve: %v", err)
	}

	result, err := PlanBuild(Request{
		Planner:      "bootstrap",
		Target:       "wasm",
		Output:       "/working/out.wasm",
		OptimizeFlag: "-Oz",
		Profile:      profile,
	})
	if err != nil {
		t.Fatalf("PlanBuild returned error: %v", err)
	}

	if result.Mode != "bootstrap-c-smoke" {
		t.Fatalf("unexpected mode: %q", result.Mode)
	}
	if result.Artifact != "/working/out.wasm" {
		t.Fatalf("unexpected artifact: %q", result.Artifact)
	}
	if len(result.Files) != 1 || result.Files[0].Path != "/working/smoke.c" {
		t.Fatalf("unexpected generated files: %#v", result.Files)
	}
	if len(result.Plan) != 2 {
		t.Fatalf("expected 2 tool steps, got %d", len(result.Plan))
	}
	if !slices.Equal(result.Plan[0].Argv[:3], []string{"/usr/bin/clang", "--target=wasm32-unknown-wasi", "-Oz"}) {
		t.Fatalf("unexpected compile argv: %#v", result.Plan[0].Argv)
	}
	if result.Plan[1].Argv[0] != "/usr/bin/wasm-ld" {
		t.Fatalf("unexpected linker argv: %#v", result.Plan[1].Argv)
	}
	if len(result.Diagnostics) == 0 || !strings.Contains(result.Diagnostics[0], "bootstrap driver planned a C smoke build") {
		t.Fatalf("unexpected diagnostics: %#v", result.Diagnostics)
	}
}

func TestPlanBuildReturnsTinyGoBootstrapPlan(t *testing.T) {
	profile, err := tinygotarget.Resolve("wasm")
	if err != nil {
		t.Fatalf("tinygotarget.Resolve: %v", err)
	}

	result, err := PlanBuild(Request{
		Planner:       "tinygo",
		Target:        "wasm",
		Output:        "/working/out.wasm",
		OptimizeFlag:  "-O2",
		EntryPath:     "/workspace/cmd/app/main.go",
		ModulePath:    "example.com/app",
		PackageFiles:  []string{"/workspace/cmd/app/main.go", "/workspace/cmd/app/helper.go"},
		Imports:       []string{"example.com/app/internal/helper", "fmt"},
		StdlibImports: []string{"fmt"},
		BuildTags:     []string{"tinygo.wasm", "scheduler.tasks"},
		Profile:       profile,
		Scheduler:     "tasks",
		PanicStrategy: "trap",
	})
	if err != nil {
		t.Fatalf("PlanBuild returned error: %v", err)
	}

	if result.Mode != "tinygo-bootstrap" {
		t.Fatalf("unexpected mode: %q", result.Mode)
	}
	if len(result.Diagnostics) != 2 {
		t.Fatalf("unexpected diagnostics: %#v", result.Diagnostics)
	}
	if len(result.Files) != 13 {
		t.Fatalf("unexpected generated files: %#v", result.Files)
	}
	if !strings.Contains(result.Diagnostics[0], "target=wasm") ||
		!strings.Contains(result.Diagnostics[0], "scheduler=tasks") ||
		!strings.Contains(result.Diagnostics[0], "panic=trap") {
		t.Fatalf("unexpected planner diagnostic: %q", result.Diagnostics[0])
	}

	manifestSource := ""
	frontendInputSource := ""
	for _, file := range result.Files {
		if file.Path == "/working/tinygo-bootstrap.json" {
			manifestSource = file.Contents
		}
		if file.Path == "/working/tinygo-frontend-input.json" {
			frontendInputSource = file.Contents
		}
	}
	if manifestSource == "" {
		t.Fatalf("unexpected manifest path: %#v", result.Files)
	}
	if frontendInputSource == "" {
		t.Fatalf("expected frontend input source in %#v", result.Files)
	}

	var manifest struct {
		TinyGoRoot           string   `json:"tinygoRoot"`
		EntryPath            string   `json:"entryPath"`
		ModulePath           string   `json:"modulePath"`
		PackageFiles         []string `json:"packageFiles"`
		ImportedPackageFiles []string `json:"importedPackageFiles"`
		Imports              []string `json:"imports"`
		StdlibImports        []string `json:"stdlibImports"`
		StdlibPackageFiles   []string `json:"stdlibPackageFiles"`
		BuildTags            []string `json:"buildTags"`
		CompileInputs        struct {
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
	if manifest.TinyGoRoot != "" {
		t.Fatalf("expected top-level tinygo root to be omitted, got %#v", manifest)
	}
	if manifest.EntryPath != "" {
		t.Fatalf("expected top-level entry path to be omitted, got %#v", manifest)
	}
	if manifest.ModulePath != "" {
		t.Fatalf("expected top-level module path to be omitted, got %#v", manifest)
	}
	if manifest.PackageFiles != nil {
		t.Fatalf("expected top-level package files to be omitted, got %#v", manifest)
	}
	if manifest.ImportedPackageFiles != nil {
		t.Fatalf("expected top-level imported package files to be omitted, got %#v", manifest)
	}
	if manifest.Imports != nil {
		t.Fatalf("expected top-level imports to be omitted, got %#v", manifest)
	}
	if manifest.StdlibImports != nil {
		t.Fatalf("expected top-level stdlib imports to be omitted, got %#v", manifest)
	}
	if manifest.StdlibPackageFiles != nil {
		t.Fatalf("expected top-level stdlib package files to be omitted, got %#v", manifest)
	}
	if manifest.BuildTags != nil {
		t.Fatalf("expected top-level build tags to be omitted, got %#v", manifest)
	}
	if manifest.CompileInputs.EntryFile != "/workspace/cmd/app/main.go" {
		t.Fatalf("unexpected compile input entry file: %#v", manifest.CompileInputs)
	}
	if !slices.Equal(manifest.CompileInputs.PackageFiles, []string{"/workspace/cmd/app/helper.go", "/workspace/cmd/app/main.go"}) {
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
		t.Fatalf("unexpected bootstrap dispatch runtime support files: %#v", manifest.BootstrapDispatch)
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
			DepOnly     bool     `json:"depOnly"`
			Kind        string   `json:"kind"`
			ImportPath  string   `json:"importPath"`
			Imports     []string `json:"imports"`
			ModulePath  string   `json:"modulePath"`
			PackageName string   `json:"packageName"`
			PackageDir  string   `json:"packageDir"`
			Files       []string `json:"files"`
			Standard    bool     `json:"standard"`
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
		frontendInput.OptimizeFlag != "-O2" ||
		frontendInput.EntryFile != "/workspace/cmd/app/main.go" ||
		frontendInput.BuildContext.Target != "wasm" ||
		frontendInput.BuildContext.LLVMTarget != "wasm32-unknown-wasi" ||
		frontendInput.BuildContext.GOOS != "js" ||
		frontendInput.BuildContext.GOARCH != "wasm" ||
		frontendInput.BuildContext.GC != "precise" ||
		frontendInput.BuildContext.Scheduler != "tasks" ||
		frontendInput.BuildContext.ModulePath != "example.com/app" ||
		!slices.Equal(frontendInput.BuildContext.BuildTags, []string{"scheduler.tasks", "tinygo.wasm"}) ||
		frontendInput.ModulePath != "example.com/app" ||
		!slices.Equal(frontendInput.BuildTags, []string{"scheduler.tasks", "tinygo.wasm"}) ||
		frontendInput.Toolchain.ArtifactOutputPath != "/working/out.wasm" ||
		frontendInput.Toolchain.LLVMTarget != "" ||
		frontendInput.Toolchain.Linker != "" ||
		frontendInput.Toolchain.Target != "wasm" ||
		frontendInput.Toolchain.CFlags != nil ||
		frontendInput.Toolchain.LDFlags != nil ||
		!reflect.DeepEqual(frontendInput.CompileUnits, []struct {
			DepOnly     bool     `json:"depOnly"`
			Kind        string   `json:"kind"`
			ImportPath  string   `json:"importPath"`
			Imports     []string `json:"imports"`
			ModulePath  string   `json:"modulePath"`
			PackageName string   `json:"packageName"`
			PackageDir  string   `json:"packageDir"`
			Files       []string `json:"files"`
			Standard    bool     `json:"standard"`
		}{
			{DepOnly: false, Kind: "program", ImportPath: "command-line-arguments", Imports: []string{"example.com/app/internal/helper", "fmt"}, ModulePath: "example.com/app", PackageName: "main", PackageDir: "/workspace/cmd/app", Files: []string{"/workspace/cmd/app/helper.go", "/workspace/cmd/app/main.go"}, Standard: false},
			{DepOnly: true, Kind: "stdlib", ImportPath: "errors", Imports: nil, ModulePath: "", PackageName: "errors", PackageDir: "/working/.tinygo-root/src/errors", Files: []string{"/working/.tinygo-root/src/errors/errors.go"}, Standard: true},
			{DepOnly: true, Kind: "stdlib", ImportPath: "fmt", Imports: nil, ModulePath: "", PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}, Standard: true},
			{DepOnly: true, Kind: "stdlib", ImportPath: "io", Imports: nil, ModulePath: "", PackageName: "io", PackageDir: "/working/.tinygo-root/src/io", Files: []string{"/working/.tinygo-root/src/io/io.go"}, Standard: true},
			{DepOnly: true, Kind: "stdlib", ImportPath: "runtime", Imports: nil, ModulePath: "", PackageName: "runtime", PackageDir: "/working/.tinygo-root/src/runtime", Files: []string{"/working/.tinygo-root/src/runtime/runtime.go"}, Standard: true},
			{DepOnly: true, Kind: "stdlib", ImportPath: "unsafe", Imports: nil, ModulePath: "", PackageName: "unsafe", PackageDir: "/working/.tinygo-root/src/unsafe", Files: []string{"/working/.tinygo-root/src/unsafe/unsafe.go"}, Standard: true},
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
			{DepOnly: false, Dir: "/workspace/cmd/app", Files: struct {
				GoFiles []string `json:"goFiles"`
			}{GoFiles: []string{"helper.go", "main.go"}}, ImportPath: "command-line-arguments", Imports: []string{"example.com/app/internal/helper", "fmt"}, Name: "main", Standard: false},
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
			"/workspace/cmd/app/helper.go",
			"/workspace/cmd/app/main.go",
		}) {
		t.Fatalf("frontend input file did not match bootstrap front-end section: %#v", frontendInput)
	}
	var frontendInputMap map[string]any
	if err := json.Unmarshal([]byte(frontendInputSource), &frontendInputMap); err != nil {
		t.Fatalf("json.Unmarshal(frontendInputMap): %v", err)
	}
	if frontendInputMap["modulePath"] != "example.com/app" {
		t.Fatalf("expected frontend input to include modulePath, got %#v", frontendInputMap)
	}
	if !reflect.DeepEqual(frontendInputMap["buildTags"], []any{"scheduler.tasks", "tinygo.wasm"}) {
		t.Fatalf("expected frontend input to include buildTags, got %#v", frontendInputMap)
	}
	if buildContext, ok := frontendInputMap["buildContext"].(map[string]any); !ok {
		t.Fatalf("expected frontend input to include buildContext, got %#v", frontendInputMap)
	} else {
		if buildContext["target"] != "wasm" || buildContext["llvmTarget"] != "wasm32-unknown-wasi" ||
			buildContext["goos"] != "js" || buildContext["goarch"] != "wasm" ||
			buildContext["gc"] != "precise" || buildContext["scheduler"] != "tasks" ||
			buildContext["modulePath"] != "example.com/app" {
			t.Fatalf("unexpected buildContext: %#v", frontendInputMap)
		}
	}
	if _, ok := frontendInputMap["tinygoRoot"]; ok {
		t.Fatalf("expected frontend input to omit tinygoRoot, got %#v", frontendInputMap)
	}
	if packageGraph, ok := frontendInputMap["packageGraph"].([]any); !ok || len(packageGraph) != 6 {
		t.Fatalf("expected frontend input to include packageGraph, got %#v", frontendInputMap)
	}
	compileUnitsAny, ok := frontendInputMap["compileUnits"].([]any)
	if !ok {
		t.Fatalf("expected compileUnits in %#v", frontendInputMap)
	}
	if len(compileUnitsAny) != 6 {
		t.Fatalf("expected 6 compile units in %#v", frontendInputMap)
	}
	if sourceSelection, ok := frontendInputMap["sourceSelection"].(map[string]any); ok {
		if _, ok := sourceSelection["targetAssets"]; ok {
			t.Fatalf("expected frontend input sourceSelection to omit targetAssets, got %#v", frontendInputMap)
		}
		if _, ok := sourceSelection["runtimeSupport"]; ok {
			t.Fatalf("expected frontend input sourceSelection to omit runtimeSupport, got %#v", frontendInputMap)
		}
		if _, ok := sourceSelection["program"]; ok {
			t.Fatalf("expected frontend input sourceSelection to omit program, got %#v", frontendInputMap)
		}
		if _, ok := sourceSelection["imported"]; ok {
			t.Fatalf("expected frontend input sourceSelection to omit imported, got %#v", frontendInputMap)
		}
		if _, ok := sourceSelection["stdlib"]; ok {
			t.Fatalf("expected frontend input sourceSelection to omit stdlib, got %#v", frontendInputMap)
		}
	}
	if toolchain, ok := frontendInputMap["toolchain"].(map[string]any); ok {
		if _, ok := toolchain["llvmTarget"]; ok {
			t.Fatalf("expected frontend input toolchain to omit llvmTarget, got %#v", frontendInputMap)
		}
		if _, ok := toolchain["linker"]; ok {
			t.Fatalf("expected frontend input toolchain to omit linker, got %#v", frontendInputMap)
		}
		if _, ok := toolchain["cflags"]; ok {
			t.Fatalf("expected frontend input toolchain to omit cflags, got %#v", frontendInputMap)
		}
		if _, ok := toolchain["ldflags"]; ok {
			t.Fatalf("expected frontend input toolchain to omit ldflags, got %#v", frontendInputMap)
		}
		if _, ok := toolchain["translationUnitPath"]; ok {
			t.Fatalf("expected frontend input toolchain to omit translationUnitPath, got %#v", frontendInputMap)
		}
		if _, ok := toolchain["objectOutputPath"]; ok {
			t.Fatalf("expected frontend input toolchain to omit objectOutputPath, got %#v", frontendInputMap)
		}
	}
	if frontendInput.MaterializedFiles != nil {
		t.Fatalf("expected frontend input to omit materializedFiles, got %#v", frontendInput)
	}

	filePaths := make([]string, 0, len(result.Files))
	for _, file := range result.Files {
		filePaths = append(filePaths, file.Path)
	}
	for _, want := range []string{
		"/working/.tinygo-root/targets/wasm.json",
		"/working/.tinygo-root/targets/wasm-undefined.txt",
		"/working/.tinygo-root/src/runtime/asm_tinygowasm.S",
		"/working/.tinygo-root/src/runtime/gc_boehm.c",
		"/working/.tinygo-root/src/errors/errors.go",
		"/working/.tinygo-root/src/fmt/print.go",
		"/working/tinygo-frontend-input.json",
	} {
		if !slices.Contains(filePaths, want) {
			t.Fatalf("missing generated file %q in %#v", want, filePaths)
		}
	}
	if slices.Contains(filePaths, "/working/.tinygo-root/targets/wasip1.json") {
		t.Fatalf("did not expect unrelated wasip1 target asset: %#v", filePaths)
	}
	if slices.Contains(filePaths, "/working/tinygo-bootstrap.c") {
		t.Fatalf("planner should not emit frontend-generated bootstrap source: %#v", filePaths)
	}
}

func TestPlanBuildOmitsImportedSelectionFromFrontendInput(t *testing.T) {
	profile, err := tinygotarget.Resolve("wasm")
	if err != nil {
		t.Fatalf("tinygotarget.Resolve: %v", err)
	}

	result, err := PlanBuild(Request{
		Planner:              "tinygo",
		Target:               "wasm",
		Output:               "/working/out.wasm",
		OptimizeFlag:         "-Oz",
		EntryPath:            "/workspace/cmd/app/main.go",
		ModulePath:           "example.com/app",
		PackageFiles:         []string{"/workspace/cmd/app/main.go"},
		ImportedPackageFiles: []string{"/workspace/internal/helper/helper.go"},
		CompileUnits: []CompileUnit{
			{
				Kind:        "program",
				ImportPath:  "command-line-arguments",
				Imports:     []string{"example.com/app/internal/helper"},
				ModulePath:  "example.com/app",
				DepOnly:     false,
				PackageName: "main",
				PackageDir:  "/workspace/cmd/app",
				Files:       []string{"/workspace/cmd/app/main.go"},
				Standard:    false,
			},
			{
				Kind:        "imported",
				ImportPath:  "example.com/app/internal/helper",
				Imports:     nil,
				ModulePath:  "example.com/app",
				DepOnly:     true,
				PackageName: "helper",
				PackageDir:  "/workspace/internal/helper",
				Files:       []string{"/workspace/internal/helper/helper.go"},
				Standard:    false,
			},
		},
		Profile: profile,
	})
	if err != nil {
		t.Fatalf("PlanBuild returned error: %v", err)
	}

	frontendInputSource := ""
	for _, file := range result.Files {
		if file.Path == "/working/tinygo-frontend-input.json" {
			frontendInputSource = file.Contents
			break
		}
	}
	if frontendInputSource == "" {
		t.Fatalf("expected frontend input source in %#v", result.Files)
	}

	var frontendInputMap map[string]any
	if err := json.Unmarshal([]byte(frontendInputSource), &frontendInputMap); err != nil {
		t.Fatalf("json.Unmarshal(frontendInputMap): %v", err)
	}
	sourceSelection, ok := frontendInputMap["sourceSelection"].(map[string]any)
	if !ok {
		t.Fatalf("expected sourceSelection in %#v", frontendInputMap)
	}
	compileUnitsAny, ok := frontendInputMap["compileUnits"].([]any)
	if !ok {
		t.Fatalf("expected compileUnits in %#v", frontendInputMap)
	}
	if len(compileUnitsAny) != 2 {
		t.Fatalf("expected 2 compile units in %#v", frontendInputMap)
	}
	if _, ok := sourceSelection["imported"]; ok {
		t.Fatalf("expected frontend input sourceSelection to omit imported, got %#v", frontendInputMap)
	}
	allCompileAny, ok := sourceSelection["allCompile"].([]any)
	if !ok {
		t.Fatalf("expected allCompile in %#v", frontendInputMap)
	}
	allCompile := make([]string, 0, len(allCompileAny))
	for _, value := range allCompileAny {
		path, ok := value.(string)
		if !ok {
			t.Fatalf("expected string allCompile entry in %#v", frontendInputMap)
		}
		allCompile = append(allCompile, path)
	}
	if !slices.Equal(allCompile, []string{
		"/workspace/cmd/app/main.go",
		"/workspace/internal/helper/helper.go",
	}) {
		t.Fatalf("unexpected allCompile in %#v", frontendInputMap)
	}
}

func TestPlanBuildRequiresCompileUnitsWhenImportedPackagesArePresent(t *testing.T) {
	profile, err := tinygotarget.Resolve("wasm")
	if err != nil {
		t.Fatalf("tinygotarget.Resolve: %v", err)
	}

	_, err = PlanBuild(Request{
		Planner:              "tinygo",
		Target:               "wasm",
		Output:               "/working/out.wasm",
		OptimizeFlag:         "-Oz",
		EntryPath:            "/workspace/cmd/app/main.go",
		PackageFiles:         []string{"/workspace/cmd/app/main.go"},
		ImportedPackageFiles: []string{"/workspace/internal/helper/helper.go"},
		Profile:              profile,
	})
	if err == nil || !strings.Contains(err.Error(), "compile units are required when imported package files are present") {
		t.Fatalf("expected compile-unit requirement error, got %v", err)
	}
}
