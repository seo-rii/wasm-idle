package tinygobootstrap

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestOutputOmitsLegacyChecksumFields(t *testing.T) {
	outputType := reflect.TypeOf(Output{})
	if _, ok := outputType.FieldByName("Checksum"); ok {
		t.Fatalf("expected Output to omit legacy Checksum field")
	}
	if _, ok := outputType.FieldByName("ManifestLength"); ok {
		t.Fatalf("expected Output to omit legacy ManifestLength field")
	}
}

func TestCompileUnitManifestOmitsLegacyTopLevelSourceGroups(t *testing.T) {
	manifestType := reflect.TypeOf(CompileUnitManifest{})
	for _, field := range []string{
		"Target",
		"LLVMTarget",
		"Linker",
		"PackageLayout",
		"TranslationUnitPath",
		"ObjectOutputPath",
		"ArtifactOutputPath",
		"Imports",
		"BuildTags",
		"PackageFiles",
		"ImportedPackageFiles",
		"StdlibPackageFiles",
		"AllFiles",
		"AllCompileFiles",
		"TargetAssetFiles",
		"RuntimeSupportFiles",
		"ProgramFiles",
	} {
		if _, ok := manifestType.FieldByName(field); ok {
			t.Fatalf("expected CompileUnitManifest to omit legacy field %q", field)
		}
	}
}

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

func TestGenerateEmbedsTypedCompileUnitManifest(t *testing.T) {
	manifest := CompileUnitManifest{
		EntryFile: "/workspace/main.go",
		MaterializedFiles: []string{
			"/working/.tinygo-root/src/fmt/print.go",
			"/working/.tinygo-root/src/runtime/runtime.go",
			"/working/.tinygo-root/targets/wasm.json",
			"/working/tinygo-bootstrap.c",
			"/working/tinygo-compile-unit.json",
		},
		CompileUnits: []CompileUnit{
			{Kind: "program", ImportPath: "command-line-arguments", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}},
			{Kind: "imported", ImportPath: "example.com/app/lib", PackageName: "helper", PackageDir: "/workspace/lib", Files: []string{"/workspace/lib/helper.go"}},
			{Kind: "stdlib", ImportPath: "fmt", PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}},
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
	}

	result, err := Generate(Input{
		CompileUnitManifest: manifest,
		OptimizeFlag:        "-Oz",
	})
	if err != nil {
		t.Fatalf("Generate returned error: %v", err)
	}

	if !strings.Contains(result.EmbeddedManifest, "\"entryFile\":\"/workspace/main.go\"") ||
		!strings.Contains(result.EmbeddedManifest, "\"toolchain\":{\"target\":\"wasm\",\"artifactOutputPath\":\"/working/out.wasm\"}") ||
		!strings.Contains(result.EmbeddedManifest, "\"compileUnits\":[{\"kind\":\"program\",\"importPath\":\"command-line-arguments\",\"imports\":[],\"modulePath\":\"\",\"depOnly\":false,\"packageName\":\"main\",\"packageDir\":\"/workspace\",\"files\":[\"/workspace/main.go\"],\"standard\":false},{\"kind\":\"imported\",\"importPath\":\"example.com/app/lib\",\"imports\":[],\"modulePath\":\"\",\"depOnly\":true,\"packageName\":\"helper\",\"packageDir\":\"/workspace/lib\",\"files\":[\"/workspace/lib/helper.go\"],\"standard\":false},{\"kind\":\"stdlib\",\"importPath\":\"fmt\",\"imports\":[],\"modulePath\":\"\",\"depOnly\":true,\"packageName\":\"fmt\",\"packageDir\":\"/working/.tinygo-root/src/fmt\",\"files\":[\"/working/.tinygo-root/src/fmt/print.go\"],\"standard\":true}]") ||
		!strings.Contains(result.EmbeddedManifest, "\"sourceSelection\":{\"allCompile\":[\"/working/.tinygo-root/src/fmt/print.go\",\"/workspace/lib/helper.go\",\"/workspace/main.go\"]}") ||
		!strings.Contains(result.EmbeddedManifest, "\"materializedFiles\":[\"/working/.tinygo-root/src/fmt/print.go\"") {
		t.Fatalf("unexpected embedded manifest: %q", result.EmbeddedManifest)
	}
	if strings.Contains(result.EmbeddedManifest, "\"packageLayout\":") {
		t.Fatalf("expected embedded manifest to omit package layout: %q", result.EmbeddedManifest)
	}
	if strings.Contains(result.EmbeddedManifest, "\"targetAssets\":") {
		t.Fatalf("expected embedded manifest to omit target assets: %q", result.EmbeddedManifest)
	}
	if strings.Contains(result.EmbeddedManifest, "\"runtimeSupport\":") {
		t.Fatalf("expected embedded manifest to omit runtime support: %q", result.EmbeddedManifest)
	}
	if strings.Contains(result.EmbeddedManifest, "\"program\":") {
		t.Fatalf("expected embedded manifest to omit program group: %q", result.EmbeddedManifest)
	}
	if strings.Contains(result.EmbeddedManifest, "\"imported\":") {
		t.Fatalf("expected embedded manifest to omit imported group: %q", result.EmbeddedManifest)
	}
	if strings.Contains(result.EmbeddedManifest, "\"stdlib\":") {
		t.Fatalf("expected embedded manifest to omit stdlib group: %q", result.EmbeddedManifest)
	}
	var embeddedManifest map[string]any
	if err := json.Unmarshal([]byte(result.EmbeddedManifest), &embeddedManifest); err != nil {
		t.Fatalf("json.Unmarshal(embeddedManifest): %v", err)
	}
	for _, key := range []string{
		"mode",
		"checksum",
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
		if _, ok := embeddedManifest[key]; ok {
			t.Fatalf("expected embedded manifest to omit top-level %q: %#v", key, embeddedManifest)
		}
	}
	if !strings.Contains(result.Source, "\"/workspace/lib/helper.go\"") {
		t.Fatalf("unexpected generated source: %q", result.Source)
	}
	if strings.Contains(result.Source, "module: ") {
		t.Fatalf("expected generated source to omit module comment: %q", result.Source)
	}
	if strings.Contains(result.Source, "unsigned int tinygo_dispatch_program_file_count(void)") {
		t.Fatalf("expected generated source to omit program dispatch count export: %q", result.Source)
	}
	if strings.Contains(result.Source, "unsigned int tinygo_dispatch_target_asset_count(void)") {
		t.Fatalf("expected generated source to omit target-asset dispatch count export: %q", result.Source)
	}
	if strings.Contains(result.Source, "unsigned int tinygo_dispatch_runtime_support_file_count(void)") {
		t.Fatalf("expected generated source to omit runtime-support dispatch count export: %q", result.Source)
	}
	if strings.Contains(result.Source, "unsigned int tinygo_dispatch_materialized_file_count(void)") {
		t.Fatalf("expected generated source to omit materialized-file dispatch count export: %q", result.Source)
	}
	if strings.Contains(result.Source, "unsigned int tinygo_all_compile_file_count(void)") {
		t.Fatalf("expected generated source to omit all-compile count export: %q", result.Source)
	}
	if strings.Contains(result.Source, "unsigned int tinygo_stdlib_package_file_count(void)") {
		t.Fatalf("expected generated source to omit stdlib count export: %q", result.Source)
	}
	if strings.Contains(result.Source, "unsigned int tinygo_package_file_count(void)") {
		t.Fatalf("expected generated source to omit package count export: %q", result.Source)
	}
	if strings.Contains(result.Source, "unsigned int tinygo_imported_package_file_count(void)") {
		t.Fatalf("expected generated source to omit imported-package count export: %q", result.Source)
	}
	if strings.Contains(result.Source, "unsigned int tinygo_compile_input_checksum(void)") {
		t.Fatalf("expected generated source to omit checksum export: %q", result.Source)
	}
	if strings.Contains(result.EmbeddedManifest, "\"checksum\":") {
		t.Fatalf("expected embedded manifest to omit checksum: %q", result.EmbeddedManifest)
	}
}

func TestGeneratePreservesCompileUnitDirectImports(t *testing.T) {
	manifest := CompileUnitManifest{
		EntryFile: "/workspace/main.go",
		CompileUnits: []CompileUnit{
			{Kind: "program", ImportPath: "example.com/app", Imports: []string{"example.com/app/helper"}, PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}},
			{Kind: "imported", ImportPath: "example.com/app/helper", Imports: []string{"fmt"}, PackageName: "helper", PackageDir: "/workspace/helper", Files: []string{"/workspace/helper/helper.go"}},
			{Kind: "stdlib", ImportPath: "fmt", Imports: []string{"errors", "io"}, PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}},
		},
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
	}

	result, err := Generate(Input{
		CompileUnitManifest: manifest,
		OptimizeFlag:        "-Oz",
	})
	if err != nil {
		t.Fatalf("Generate returned error: %v", err)
	}

	var embeddedManifest struct {
		CompileUnits []CompileUnit `json:"compileUnits"`
	}
	if err := json.Unmarshal([]byte(result.EmbeddedManifest), &embeddedManifest); err != nil {
		t.Fatalf("json.Unmarshal(embeddedManifest): %v", err)
	}
	if !reflect.DeepEqual(embeddedManifest.CompileUnits, []CompileUnit{
		{Kind: "program", ImportPath: "example.com/app", Imports: []string{"example.com/app/helper"}, ModulePath: "", DepOnly: false, PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}, Standard: false},
		{Kind: "imported", ImportPath: "example.com/app/helper", Imports: []string{"fmt"}, ModulePath: "", DepOnly: true, PackageName: "helper", PackageDir: "/workspace/helper", Files: []string{"/workspace/helper/helper.go"}, Standard: false},
		{Kind: "stdlib", ImportPath: "fmt", Imports: []string{"errors", "io"}, ModulePath: "", DepOnly: true, PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}, Standard: true},
	}) {
		t.Fatalf("unexpected embedded compile unit imports: %#v", embeddedManifest.CompileUnits)
	}
}

func TestGenerateEmbedsCompileUnitModulePaths(t *testing.T) {
	manifest := CompileUnitManifest{
		EntryFile: "/workspace/main.go",
		CompileUnits: []CompileUnit{
			{Kind: "program", ImportPath: "example.com/app", Imports: []string{"example.com/app/helper"}, ModulePath: "example.com/app", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}},
			{Kind: "imported", ImportPath: "example.com/app/helper", Imports: []string{"fmt"}, ModulePath: "example.com/app", PackageName: "helper", PackageDir: "/workspace/helper", Files: []string{"/workspace/helper/helper.go"}},
			{Kind: "stdlib", ImportPath: "fmt", Imports: []string{"errors", "io"}, ModulePath: "", PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}},
		},
		Toolchain: Toolchain{
			Target:             "wasm",
			ArtifactOutputPath: "/working/out.wasm",
		},
		SourceSelection: SourceSelection{
			AllCompile: []string{
				"/working/.tinygo-root/src/fmt/print.go",
				"/workspace/helper/helper.go",
				"/workspace/main.go",
			},
		},
	}

	result, err := Generate(Input{CompileUnitManifest: manifest, OptimizeFlag: "-Oz"})
	if err != nil {
		t.Fatalf("Generate returned error: %v", err)
	}

	if !strings.Contains(result.EmbeddedManifest, "\"modulePath\":\"example.com/app\"") {
		t.Fatalf("expected embedded manifest to preserve compile unit modulePath: %q", result.EmbeddedManifest)
	}
}

func TestGenerateRejectsAllCompileWithoutEntryFile(t *testing.T) {
	_, err := Generate(Input{
		CompileUnitManifest: CompileUnitManifest{
			EntryFile: "/workspace/main.go",
			CompileUnits: []CompileUnit{
				{Kind: "program", ImportPath: "command-line-arguments", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/other.go"}},
			},
			Toolchain: Toolchain{
				Target:              "wasm",
				LLVMTarget:          "wasm32-unknown-wasi",
				Linker:              "wasm-ld",
				TranslationUnitPath: "/working/tinygo-bootstrap.c",
				ObjectOutputPath:    "/working/tinygo-bootstrap.o",
				ArtifactOutputPath:  "/working/out.wasm",
			},
			SourceSelection: SourceSelection{
				AllCompile: []string{
					"/workspace/other.go",
				},
			},
		},
	})
	if err == nil {
		t.Fatalf("expected validation error")
	}
	if !strings.Contains(err.Error(), "source selection all compile files must include the entry file") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestGenerateAcceptsNestedOnlySourceSelection(t *testing.T) {
	result, err := Generate(Input{
		CompileUnitManifest: CompileUnitManifest{
			EntryFile:    "/workspace/main.go",
			OptimizeFlag: "-Oz",
			CompileUnits: []CompileUnit{
				{Kind: "program", ImportPath: "command-line-arguments", PackageName: "main", PackageDir: "/workspace", Files: []string{"/workspace/main.go"}},
				{Kind: "imported", ImportPath: "example.com/app/lib", PackageName: "helper", PackageDir: "/workspace/lib", Files: []string{"/workspace/lib/helper.go"}},
				{Kind: "stdlib", ImportPath: "fmt", PackageName: "fmt", PackageDir: "/working/.tinygo-root/src/fmt", Files: []string{"/working/.tinygo-root/src/fmt/print.go"}},
			},
			MaterializedFiles: []string{
				"/working/.tinygo-root/src/fmt/print.go",
				"/working/.tinygo-root/src/runtime/runtime.go",
				"/working/.tinygo-root/targets/wasm.json",
				"/working/tinygo-bootstrap.c",
				"/working/tinygo-compile-unit.json",
			},
			Toolchain: Toolchain{
				Target:              "wasm",
				LLVMTarget:          "wasm32-unknown-wasi",
				Linker:              "wasm-ld",
				CFlags:              []string{"-mbulk-memory"},
				LDFlags:             []string{"--stack-first"},
				TranslationUnitPath: "/working/tinygo-bootstrap.c",
				ObjectOutputPath:    "/working/tinygo-bootstrap.o",
				ArtifactOutputPath:  "/working/out.wasm",
			},
			SourceSelection: SourceSelection{
				AllCompile: []string{
					"/working/.tinygo-root/src/fmt/print.go",
					"/workspace/lib/helper.go",
					"/workspace/main.go",
				},
			},
		},
		OptimizeFlag: "-Oz",
	})
	if err != nil {
		t.Fatalf("Generate returned error: %v", err)
	}

	if !strings.Contains(result.Source, "\"/workspace/lib/helper.go\"") ||
		!strings.Contains(result.EmbeddedManifest, "\"sourceSelection\":{\"allCompile\":[\"/working/.tinygo-root/src/fmt/print.go\",\"/workspace/lib/helper.go\",\"/workspace/main.go\"]}") {
		t.Fatalf("unexpected nested-only output: source=%q manifest=%q", result.Source, result.EmbeddedManifest)
	}
}
