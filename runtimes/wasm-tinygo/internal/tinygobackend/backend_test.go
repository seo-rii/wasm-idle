package tinygobackend

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
)

func TestBuildProducesBackendOwnedCommandArtifacts(t *testing.T) {
	result, err := Build(Input{
		EntryFile: "/workspace/main.go",
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				ImportPath:        "command-line-arguments",
				Imports:           []string{"fmt"},
				DepOnly:           false,
				ModulePath:        "example.com/app",
				PackageName:       "main",
				PackageDir:        "/workspace",
				Files:             []string{"/workspace/main.go"},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory", "-mnontrapping-fptoint"},
				OptimizeFlag:      "-Oz",
				Standard:          false,
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !result.OK {
		t.Fatalf("unexpected result: %#v", result)
	}
	if len(result.GeneratedFiles) != 8 {
		t.Fatalf("unexpected generated files: %#v", result.GeneratedFiles)
	}
	if !reflect.DeepEqual([]string{result.GeneratedFiles[0].Path, result.GeneratedFiles[1].Path, result.GeneratedFiles[2].Path, result.GeneratedFiles[3].Path, result.GeneratedFiles[4].Path, result.GeneratedFiles[5].Path, result.GeneratedFiles[6].Path, result.GeneratedFiles[7].Path}, []string{
		"/working/tinygo-lowered-sources.json",
		"/working/tinygo-lowered-bitcode.json",
		"/working/tinygo-lowered/program-000.c",
		"/working/tinygo-lowered-ir.json",
		"/working/tinygo-lowered-command-batch.json",
		"/working/tinygo-lowered-artifact.json",
		"/working/tinygo-command-artifact.json",
		"/working/tinygo-command-batch.json",
	}) {
		t.Fatalf("unexpected generated files: %#v", result.GeneratedFiles)
	}
	if !strings.Contains(result.GeneratedFiles[0].Contents, "\"loweredSourcePath\":\"/working/tinygo-lowered/program-000.c\"") ||
		!strings.Contains(result.GeneratedFiles[0].Contents, "\"importPath\":\"command-line-arguments\"") ||
		!strings.Contains(result.GeneratedFiles[0].Contents, "\"imports\":[\"fmt\"]") ||
		!strings.Contains(result.GeneratedFiles[0].Contents, "\"depOnly\":false") ||
		!strings.Contains(result.GeneratedFiles[0].Contents, "\"modulePath\":\"example.com/app\"") ||
		!strings.Contains(result.GeneratedFiles[0].Contents, "\"packageName\":\"main\"") ||
		!strings.Contains(result.GeneratedFiles[0].Contents, "\"standard\":false") {
		t.Fatalf("unexpected lowered sources manifest: %q", result.GeneratedFiles[0].Contents)
	}
	var loweredIRManifest struct {
		Units []struct {
			ID                string   `json:"id"`
			Kind              string   `json:"kind"`
			ImportPath        string   `json:"importPath"`
			ModulePath        string   `json:"modulePath"`
			PackageDir        string   `json:"packageDir"`
			SourceFiles       []string `json:"sourceFiles"`
			LoweredSourcePath string   `json:"loweredSourcePath"`
			PackageName       string   `json:"packageName"`
			Imports           []struct {
				Path  string `json:"path"`
				Alias string `json:"alias,omitempty"`
			} `json:"imports"`
			Functions []struct {
				Name       string `json:"name"`
				Exported   bool   `json:"exported"`
				Method     bool   `json:"method"`
				Main       bool   `json:"main"`
				Init       bool   `json:"init"`
				Parameters int    `json:"parameters"`
				Results    int    `json:"results"`
			} `json:"functions"`
			Types []struct {
				Name     string `json:"name"`
				Exported bool   `json:"exported"`
				Kind     string `json:"kind"`
			} `json:"types"`
			Constants []struct {
				Name     string `json:"name"`
				Exported bool   `json:"exported"`
			} `json:"constants"`
			Variables []struct {
				Name     string `json:"name"`
				Exported bool   `json:"exported"`
			} `json:"variables"`
			Declarations []struct {
				Kind     string `json:"kind"`
				Name     string `json:"name"`
				Exported bool   `json:"exported"`
				Method   bool   `json:"method"`
			} `json:"declarations"`
			PlaceholderBlocks []struct {
				Stage     string `json:"stage"`
				Index     int    `json:"index"`
				Value     string `json:"value"`
				Signature string `json:"signature"`
			} `json:"placeholderBlocks"`
			LoweringBlocks []struct {
				Stage string `json:"stage"`
				Index int    `json:"index"`
				Value string `json:"value"`
			} `json:"loweringBlocks"`
		} `json:"units"`
	}
	if !strings.Contains(result.GeneratedFiles[1].Contents, "\"bitcodeFiles\":[\"/working/tinygo-work/program-000.bc\"]") {
		t.Fatalf("unexpected lowered bitcode manifest: %q", result.GeneratedFiles[1].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "tinygo_lowered_program_000_id") ||
		!strings.Contains(result.GeneratedFiles[2].Contents, "tinygo_lowered_program_000_source_file_count") ||
		!strings.Contains(result.GeneratedFiles[2].Contents, "tinygo_lowered_program_000_kind_tag") ||
		!strings.Contains(result.GeneratedFiles[2].Contents, "tinygo_lowered_program_000_source_hash") {
		t.Fatalf("unexpected lowered source contents: %q", result.GeneratedFiles[2].Contents)
	}
	if err := json.Unmarshal([]byte(result.GeneratedFiles[3].Contents), &loweredIRManifest); err != nil {
		t.Fatalf("json.Unmarshal(lowered-ir): %v", err)
	}
	if !reflect.DeepEqual(loweredIRManifest.Units, []struct {
		ID                string   `json:"id"`
		Kind              string   `json:"kind"`
		ImportPath        string   `json:"importPath"`
		ModulePath        string   `json:"modulePath"`
		PackageDir        string   `json:"packageDir"`
		SourceFiles       []string `json:"sourceFiles"`
		LoweredSourcePath string   `json:"loweredSourcePath"`
		PackageName       string   `json:"packageName"`
		Imports           []struct {
			Path  string `json:"path"`
			Alias string `json:"alias,omitempty"`
		} `json:"imports"`
		Functions []struct {
			Name       string `json:"name"`
			Exported   bool   `json:"exported"`
			Method     bool   `json:"method"`
			Main       bool   `json:"main"`
			Init       bool   `json:"init"`
			Parameters int    `json:"parameters"`
			Results    int    `json:"results"`
		} `json:"functions"`
		Types []struct {
			Name     string `json:"name"`
			Exported bool   `json:"exported"`
			Kind     string `json:"kind"`
		} `json:"types"`
		Constants []struct {
			Name     string `json:"name"`
			Exported bool   `json:"exported"`
		} `json:"constants"`
		Variables []struct {
			Name     string `json:"name"`
			Exported bool   `json:"exported"`
		} `json:"variables"`
		Declarations []struct {
			Kind     string `json:"kind"`
			Name     string `json:"name"`
			Exported bool   `json:"exported"`
			Method   bool   `json:"method"`
		} `json:"declarations"`
		PlaceholderBlocks []struct {
			Stage     string `json:"stage"`
			Index     int    `json:"index"`
			Value     string `json:"value"`
			Signature string `json:"signature"`
		} `json:"placeholderBlocks"`
		LoweringBlocks []struct {
			Stage string `json:"stage"`
			Index int    `json:"index"`
			Value string `json:"value"`
		} `json:"loweringBlocks"`
	}{
		{
			ID:                "program-000",
			Kind:              "program",
			ImportPath:        "command-line-arguments",
			ModulePath:        "example.com/app",
			PackageDir:        "/workspace",
			SourceFiles:       []string{"/workspace/main.go"},
			LoweredSourcePath: "/working/tinygo-lowered/program-000.c",
			PackageName:       "main",
			Imports: []struct {
				Path  string `json:"path"`
				Alias string `json:"alias,omitempty"`
			}{},
			Functions: []struct {
				Name       string `json:"name"`
				Exported   bool   `json:"exported"`
				Method     bool   `json:"method"`
				Main       bool   `json:"main"`
				Init       bool   `json:"init"`
				Parameters int    `json:"parameters"`
				Results    int    `json:"results"`
			}{},
			Types: []struct {
				Name     string `json:"name"`
				Exported bool   `json:"exported"`
				Kind     string `json:"kind"`
			}{},
			Constants: []struct {
				Name     string `json:"name"`
				Exported bool   `json:"exported"`
			}{},
			Variables: []struct {
				Name     string `json:"name"`
				Exported bool   `json:"exported"`
			}{},
			Declarations: []struct {
				Kind     string `json:"kind"`
				Name     string `json:"name"`
				Exported bool   `json:"exported"`
				Method   bool   `json:"method"`
			}{},
			PlaceholderBlocks: []struct {
				Stage     string `json:"stage"`
				Index     int    `json:"index"`
				Value     string `json:"value"`
				Signature string `json:"signature"`
			}{},
			LoweringBlocks: []struct {
				Stage string `json:"stage"`
				Index int    `json:"index"`
				Value string `json:"value"`
			}{},
		},
	}) {
		t.Fatalf("unexpected lowered ir manifest: %#v", loweredIRManifest)
	}
	var commandArtifactManifest struct {
		ArtifactOutputPath string   `json:"artifactOutputPath"`
		ArtifactKind       string   `json:"artifactKind"`
		BitcodeFiles       []string `json:"bitcodeFiles"`
		Entrypoint         *string  `json:"entrypoint"`
		Reason             string   `json:"reason"`
		Runnable           bool     `json:"runnable"`
	}
	var loweredCommandBatchManifest struct {
		CompileCommands []struct {
			Argv []string `json:"argv"`
			Cwd  string   `json:"cwd"`
		} `json:"compileCommands"`
		LinkCommand struct {
			Argv []string `json:"argv"`
			Cwd  string   `json:"cwd"`
		} `json:"linkCommand"`
	}
	if err := json.Unmarshal([]byte(result.GeneratedFiles[4].Contents), &loweredCommandBatchManifest); err != nil {
		t.Fatalf("json.Unmarshal(lowered-command-batch): %v", err)
	}
	if !reflect.DeepEqual(loweredCommandBatchManifest.CompileCommands, []struct {
		Argv []string `json:"argv"`
		Cwd  string   `json:"cwd"`
	}{
		{
			Argv: []string{"/usr/bin/clang", "--target=wasm32-unknown-wasi", "-Oz", "-mbulk-memory", "-mnontrapping-fptoint", "-c", "/working/tinygo-lowered/program-000.c", "-o", "/working/tinygo-lowered/program-000.o"},
			Cwd:  "/working",
		},
	}) {
		t.Fatalf("unexpected lowered compile commands: %#v", loweredCommandBatchManifest.CompileCommands)
	}
	if !reflect.DeepEqual(loweredCommandBatchManifest.LinkCommand.Argv, []string{
		"/usr/bin/wasm-ld",
		"--stack-first",
		"--no-demangle",
		"--no-entry",
		"--export-all",
		"/working/tinygo-lowered/program-000.o",
		"-o",
		"/working/tinygo-lowered-out.wasm",
	}) {
		t.Fatalf("unexpected lowered link command: %#v", loweredCommandBatchManifest.LinkCommand.Argv)
	}
	var loweredArtifactManifest struct {
		ArtifactOutputPath string   `json:"artifactOutputPath"`
		ArtifactKind       string   `json:"artifactKind"`
		Entrypoint         *string  `json:"entrypoint"`
		ObjectFiles        []string `json:"objectFiles"`
		Reason             string   `json:"reason"`
		Runnable           bool     `json:"runnable"`
	}
	if err := json.Unmarshal([]byte(result.GeneratedFiles[5].Contents), &loweredArtifactManifest); err != nil {
		t.Fatalf("json.Unmarshal(lowered-artifact): %v", err)
	}
	if !reflect.DeepEqual(loweredArtifactManifest, struct {
		ArtifactOutputPath string   `json:"artifactOutputPath"`
		ArtifactKind       string   `json:"artifactKind"`
		Entrypoint         *string  `json:"entrypoint"`
		ObjectFiles        []string `json:"objectFiles"`
		Reason             string   `json:"reason"`
		Runnable           bool     `json:"runnable"`
	}{
		ArtifactOutputPath: "/working/tinygo-lowered-out.wasm",
		ArtifactKind:       "probe",
		Entrypoint:         nil,
		ObjectFiles:        []string{"/working/tinygo-lowered/program-000.o"},
		Reason:             "missing-wasi-entrypoint",
		Runnable:           false,
	}) {
		t.Fatalf("unexpected lowered artifact manifest: %#v", loweredArtifactManifest)
	}
	if err := json.Unmarshal([]byte(result.GeneratedFiles[6].Contents), &commandArtifactManifest); err != nil {
		t.Fatalf("json.Unmarshal(command-artifact): %v", err)
	}
	if !reflect.DeepEqual(commandArtifactManifest, struct {
		ArtifactOutputPath string   `json:"artifactOutputPath"`
		ArtifactKind       string   `json:"artifactKind"`
		BitcodeFiles       []string `json:"bitcodeFiles"`
		Entrypoint         *string  `json:"entrypoint"`
		Reason             string   `json:"reason"`
		Runnable           bool     `json:"runnable"`
	}{
		ArtifactOutputPath: "/working/out.wasm",
		ArtifactKind:       "probe",
		BitcodeFiles:       []string{"/working/tinygo-work/program-000.bc"},
		Entrypoint:         nil,
		Reason:             "missing-wasi-entrypoint",
		Runnable:           false,
	}) {
		t.Fatalf("unexpected command artifact manifest: %#v", commandArtifactManifest)
	}
	var commandBatchManifest struct {
		CompileCommands []struct {
			Argv []string `json:"argv"`
			Cwd  string   `json:"cwd"`
		} `json:"compileCommands"`
		LinkCommand struct {
			Argv []string `json:"argv"`
			Cwd  string   `json:"cwd"`
		} `json:"linkCommand"`
	}
	if err := json.Unmarshal([]byte(result.GeneratedFiles[7].Contents), &commandBatchManifest); err != nil {
		t.Fatalf("json.Unmarshal(command-batch): %v", err)
	}
	if !reflect.DeepEqual(commandBatchManifest.CompileCommands, []struct {
		Argv []string `json:"argv"`
		Cwd  string   `json:"cwd"`
	}{
		{
			Argv: []string{"/usr/bin/clang", "--target=wasm32-unknown-wasi", "-Oz", "-mbulk-memory", "-mnontrapping-fptoint", "-emit-llvm", "-c", "/working/tinygo-lowered/program-000.c", "-o", "/working/tinygo-work/program-000.bc"},
			Cwd:  "/working",
		},
	}) {
		t.Fatalf("unexpected compile commands: %#v", commandBatchManifest.CompileCommands)
	}
	if !reflect.DeepEqual(commandBatchManifest.LinkCommand.Argv, []string{
		"/usr/bin/wasm-ld",
		"--stack-first",
		"--no-demangle",
		"--no-entry",
		"--export-all",
		"/working/tinygo-work/program-000.bc",
		"-o",
		"/working/out.wasm",
	}) {
		t.Fatalf("unexpected link command: %#v", commandBatchManifest.LinkCommand.Argv)
	}
}

func TestBuildMarksMinimalStandaloneProgramArtifactsRunnable(t *testing.T) {
	tempDir := t.TempDir()
	entryPath := filepath.Join(tempDir, "main.go")
	if err := os.WriteFile(entryPath, []byte(`package main

const bonus = 3

func factorial(n int) int {
	if n <= 1 {
		return 1
	}
	return n * factorial(n-1)
}

func main() {
	print("factorial_plus_bonus=")
	println(factorial(5) + bonus)
}
`), 0o644); err != nil {
		t.Fatalf("os.WriteFile(main.go): %v", err)
	}

	result, err := Build(Input{
		EntryFile: entryPath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				ImportPath:        "command-line-arguments",
				Imports:           []string{},
				DepOnly:           false,
				ModulePath:        "example.com/app",
				PackageName:       "main",
				PackageDir:        tempDir,
				Files:             []string{entryPath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory", "-mnontrapping-fptoint"},
				OptimizeFlag:      "-Oz",
				Standard:          false,
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	generatedFilesByPath := map[string]string{}
	for _, generatedFile := range result.GeneratedFiles {
		generatedFilesByPath[generatedFile.Path] = generatedFile.Contents
	}

	var loweredArtifactManifest LoweredArtifactManifest
	if err := json.Unmarshal([]byte(generatedFilesByPath["/working/tinygo-lowered-artifact.json"]), &loweredArtifactManifest); err != nil {
		t.Fatalf("json.Unmarshal(lowered-artifact): %v", err)
	}
	if loweredArtifactManifest.ArtifactKind != "execution" {
		t.Fatalf("expected lowered artifact kind execution, got %#v", loweredArtifactManifest)
	}
	if loweredArtifactManifest.Entrypoint == nil || *loweredArtifactManifest.Entrypoint != "main" {
		t.Fatalf("expected lowered artifact entrypoint main, got %#v", loweredArtifactManifest)
	}
	if loweredArtifactManifest.Reason != "" || !loweredArtifactManifest.Runnable {
		t.Fatalf("expected lowered artifact manifest to be runnable, got %#v", loweredArtifactManifest)
	}

	var commandArtifactManifest CommandArtifactManifest
	if err := json.Unmarshal([]byte(generatedFilesByPath["/working/tinygo-command-artifact.json"]), &commandArtifactManifest); err != nil {
		t.Fatalf("json.Unmarshal(command-artifact): %v", err)
	}
	if commandArtifactManifest.ArtifactKind != "execution" {
		t.Fatalf("expected command artifact kind execution, got %#v", commandArtifactManifest)
	}
	if commandArtifactManifest.Entrypoint == nil || *commandArtifactManifest.Entrypoint != "main" {
		t.Fatalf("expected command artifact entrypoint main, got %#v", commandArtifactManifest)
	}
	if commandArtifactManifest.Reason != "" || !commandArtifactManifest.Runnable {
		t.Fatalf("expected command artifact manifest to be runnable, got %#v", commandArtifactManifest)
	}

	var loweredCommandBatch CommandBatchManifest
	if err := json.Unmarshal([]byte(generatedFilesByPath["/working/tinygo-lowered-command-batch.json"]), &loweredCommandBatch); err != nil {
		t.Fatalf("json.Unmarshal(lowered-command-batch): %v", err)
	}
	if !slices.Contains(loweredCommandBatch.LinkCommand.Argv, "--no-entry") || !slices.Contains(loweredCommandBatch.LinkCommand.Argv, "--export=main") {
		t.Fatalf("expected lowered execution link command to export the main entrypoint, got %#v", loweredCommandBatch.LinkCommand.Argv)
	}
	if slices.Contains(loweredCommandBatch.LinkCommand.Argv, "--export-all") {
		t.Fatalf("expected lowered execution link command to omit export-all probe flag, got %#v", loweredCommandBatch.LinkCommand.Argv)
	}
	if !slices.Contains(loweredCommandBatch.LinkCommand.Argv, "--stack-first") || !slices.Contains(loweredCommandBatch.LinkCommand.Argv, "--no-demangle") {
		t.Fatalf("expected lowered execution link command to preserve execution ldflags, got %#v", loweredCommandBatch.LinkCommand.Argv)
	}

	var commandBatch CommandBatchManifest
	if err := json.Unmarshal([]byte(generatedFilesByPath["/working/tinygo-command-batch.json"]), &commandBatch); err != nil {
		t.Fatalf("json.Unmarshal(command-batch): %v", err)
	}
	if !slices.Contains(commandBatch.LinkCommand.Argv, "--no-entry") || !slices.Contains(commandBatch.LinkCommand.Argv, "--export=main") {
		t.Fatalf("expected final execution link command to export the main entrypoint, got %#v", commandBatch.LinkCommand.Argv)
	}
	if slices.Contains(commandBatch.LinkCommand.Argv, "--export-all") {
		t.Fatalf("expected final execution link command to omit export-all probe flag, got %#v", commandBatch.LinkCommand.Argv)
	}
	if !slices.Contains(commandBatch.LinkCommand.Argv, "--stack-first") || !slices.Contains(commandBatch.LinkCommand.Argv, "--no-demangle") {
		t.Fatalf("expected final execution link command to preserve execution ldflags, got %#v", commandBatch.LinkCommand.Argv)
	}

	loweredSourceContents := generatedFilesByPath["/working/tinygo-lowered/program-000.c"]
	if !strings.Contains(loweredSourceContents, "extern tinygo_wasi_errno_t tinygo_runtime_fd_write_import") {
		t.Fatalf("expected lowered source to embed wasi stdout helpers, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "static int factorial(int n)") {
		t.Fatalf("expected lowered source to lower factorial function, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "int main(void)") {
		t.Fatalf("expected lowered source to embed runnable main entrypoint, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "tinygo_runtime_print_literal(\"factorial_plus_bonus=\", 21u, 0);") {
		t.Fatalf("expected lowered source to lower print builtin, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "tinygo_runtime_print_i32((factorial(5) + bonus), 1);") {
		t.Fatalf("expected lowered source to lower println integer payload, got: %q", loweredSourceContents)
	}
}

func TestBuildMarksFmtPrintProgramArtifactsRunnable(t *testing.T) {
	tempDir := t.TempDir()
	entryPath := filepath.Join(tempDir, "main.go")
	if err := os.WriteFile(entryPath, []byte(`package main

import "fmt"

const bonus = 3

func factorial(n int) int {
	if n <= 1 {
		return 1
	}
	return n * factorial(n-1)
}

func main() {
	fmt.Print("factorial_plus_bonus=")
	fmt.Println(factorial(5) + bonus)
}
`), 0o644); err != nil {
		t.Fatalf("os.WriteFile(main.go): %v", err)
	}

	result, err := Build(Input{
		EntryFile: entryPath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				ImportPath:        "command-line-arguments",
				Imports:           []string{"fmt"},
				DepOnly:           false,
				ModulePath:        "example.com/app",
				PackageName:       "main",
				PackageDir:        tempDir,
				Files:             []string{entryPath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory", "-mnontrapping-fptoint"},
				OptimizeFlag:      "-Oz",
				Standard:          false,
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	generatedFilesByPath := map[string]string{}
	for _, generatedFile := range result.GeneratedFiles {
		generatedFilesByPath[generatedFile.Path] = generatedFile.Contents
	}

	var commandArtifactManifest CommandArtifactManifest
	if err := json.Unmarshal([]byte(generatedFilesByPath["/working/tinygo-command-artifact.json"]), &commandArtifactManifest); err != nil {
		t.Fatalf("json.Unmarshal(command-artifact): %v", err)
	}
	if commandArtifactManifest.ArtifactKind != "execution" || commandArtifactManifest.Entrypoint == nil || *commandArtifactManifest.Entrypoint != "main" || !commandArtifactManifest.Runnable {
		t.Fatalf("expected runnable command artifact manifest, got %#v", commandArtifactManifest)
	}

	loweredSourceContents := generatedFilesByPath["/working/tinygo-lowered/program-000.c"]
	if !strings.Contains(loweredSourceContents, "tinygo_runtime_print_literal(\"factorial_plus_bonus=\", 21u, 0);") {
		t.Fatalf("expected lowered source to lower fmt.Print string payload, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "tinygo_runtime_print_i32((factorial(5) + bonus), 1);") {
		t.Fatalf("expected lowered source to lower fmt.Println integer payload, got: %q", loweredSourceContents)
	}
}

func TestBuildLowersSimpleSwitchStatementsForRunnableSubset(t *testing.T) {
	tempDir := t.TempDir()
	entryPath := filepath.Join(tempDir, "main.go")
	if err := os.WriteFile(entryPath, []byte(`package main

import "fmt"

func classify(n int) string {
	switch bucket := n % 4; bucket {
	case 0, 2:
		return "even"
	case 1:
		return "one"
	default:
		return "odd"
	}
}

func bonus(n int) int {
	switch {
	case n > 10:
		return 10
	case n > 0:
		return 3
	default:
		return 0
	}
}

func main() {
	total := 120 + bonus(5)
	fmt.Printf("%s=%d\n", classify(total), total)
}
`), 0o644); err != nil {
		t.Fatalf("os.WriteFile(main.go): %v", err)
	}

	result, err := Build(Input{
		EntryFile: entryPath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				ImportPath:        "command-line-arguments",
				Imports:           []string{"fmt"},
				DepOnly:           false,
				ModulePath:        "example.com/app",
				PackageName:       "main",
				PackageDir:        tempDir,
				Files:             []string{entryPath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory", "-mnontrapping-fptoint"},
				OptimizeFlag:      "-Oz",
				Standard:          false,
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	generatedFilesByPath := map[string]string{}
	for _, generatedFile := range result.GeneratedFiles {
		generatedFilesByPath[generatedFile.Path] = generatedFile.Contents
	}
	var commandArtifactManifest CommandArtifactManifest
	if err := json.Unmarshal([]byte(generatedFilesByPath["/working/tinygo-command-artifact.json"]), &commandArtifactManifest); err != nil {
		t.Fatalf("json.Unmarshal(command-artifact): %v", err)
	}
	if commandArtifactManifest.ArtifactKind != "execution" || commandArtifactManifest.Entrypoint == nil || *commandArtifactManifest.Entrypoint != "main" || !commandArtifactManifest.Runnable {
		t.Fatalf("expected runnable command artifact manifest, got %#v", commandArtifactManifest)
	}

	loweredSourceContents := generatedFilesByPath["/working/tinygo-lowered/program-000.c"]
	if !strings.Contains(loweredSourceContents, "int bucket = (n % 4);") {
		t.Fatalf("expected lowered source to lower switch init short declaration, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "if ((bucket == 0) || (bucket == 2)) {") {
		t.Fatalf("expected lowered source to lower multi-value switch case, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "else if ((bucket == 1)) {") {
		t.Fatalf("expected lowered source to lower switch else-if case, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "if (((n > 10))) {") {
		t.Fatalf("expected lowered source to lower expressionless switch case, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "else if (((n > 0))) {") {
		t.Fatalf("expected lowered source to lower expressionless switch else-if case, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "char *tinygo_printf_arg_000 = classify(total);") {
		t.Fatalf("expected lowered source to use switch-backed string helper in fmt.Printf, got: %q", loweredSourceContents)
	}
}

func TestBuildLowersScalarPackageVarsForRunnableSubset(t *testing.T) {
	tempDir := t.TempDir()
	entryPath := filepath.Join(tempDir, "main.go")
	if err := os.WriteFile(entryPath, []byte(`package main

import "fmt"

var total = 120
var label = "package_var_total"
var allow bool
var delta int

func main() {
	allow = true
	var localBoost int
	var localLabel = label
	const localExpected = "package_var_total"
	const localPenalty = 14
	if localLen := len(localLabel); allow && localLabel == localExpected {
		localBoost += localLen - localPenalty
		delta += localBoost
		total += delta
	}
	fmt.Printf("%s=%d\n", label, total)
}
`), 0o644); err != nil {
		t.Fatalf("os.WriteFile(main.go): %v", err)
	}

	result, err := Build(Input{
		EntryFile: entryPath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				ImportPath:        "command-line-arguments",
				Imports:           []string{"fmt"},
				DepOnly:           false,
				ModulePath:        "example.com/app",
				PackageName:       "main",
				PackageDir:        tempDir,
				Files:             []string{entryPath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory", "-mnontrapping-fptoint"},
				OptimizeFlag:      "-Oz",
				Standard:          false,
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	generatedFilesByPath := map[string]string{}
	for _, generatedFile := range result.GeneratedFiles {
		generatedFilesByPath[generatedFile.Path] = generatedFile.Contents
	}
	var commandArtifactManifest CommandArtifactManifest
	if err := json.Unmarshal([]byte(generatedFilesByPath["/working/tinygo-command-artifact.json"]), &commandArtifactManifest); err != nil {
		t.Fatalf("json.Unmarshal(command-artifact): %v", err)
	}
	if commandArtifactManifest.ArtifactKind != "execution" || commandArtifactManifest.Entrypoint == nil || *commandArtifactManifest.Entrypoint != "main" || !commandArtifactManifest.Runnable {
		t.Fatalf("expected runnable command artifact manifest, got %#v", commandArtifactManifest)
	}

	loweredSourceContents := generatedFilesByPath["/working/tinygo-lowered/program-000.c"]
	if !strings.Contains(loweredSourceContents, "static int total = 120;") {
		t.Fatalf("expected lowered source to lower int package var, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "static char *label = \"package_var_total\";") {
		t.Fatalf("expected lowered source to lower string package var, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "static int allow = 0;") {
		t.Fatalf("expected lowered source to lower zero bool package var, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "static int delta = 0;") {
		t.Fatalf("expected lowered source to lower zero int package var, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "allow = 1;") {
		t.Fatalf("expected lowered source to lower bool package var assignment, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "static int tinygo_runtime_string_equal(const char *left, const char *right)") {
		t.Fatalf("expected lowered source to embed string equality helper, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "int localBoost = 0;") {
		t.Fatalf("expected lowered source to lower local zero int var declaration, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "char *localLabel = label;") {
		t.Fatalf("expected lowered source to lower inferred local string var declaration, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "char *localExpected = \"package_var_total\";") {
		t.Fatalf("expected lowered source to lower local string const declaration, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "const int localPenalty = 14;") {
		t.Fatalf("expected lowered source to lower local int const declaration, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "int localLen = tinygo_runtime_string_len(localLabel);") {
		t.Fatalf("expected lowered source to lower if init short declaration, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "if ((allow && (tinygo_runtime_string_equal(localLabel, localExpected) != 0))) {") {
		t.Fatalf("expected lowered source to lower local string const comparison, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "localBoost += (localLen - localPenalty);") {
		t.Fatalf("expected lowered source to lower string len into local compound assignment, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "delta += localBoost;") {
		t.Fatalf("expected lowered source to compound-assign local int var into package var, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "total += delta;") {
		t.Fatalf("expected lowered source to lower package var compound assignment, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "char *tinygo_printf_arg_000 = label;") {
		t.Fatalf("expected lowered source to pass string package var into fmt.Printf, got: %q", loweredSourceContents)
	}
}

func TestBuildUsesSourceContentsForLoweredSourceHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	expectedHash := uint32(0)
	position := uint32(1)
	for _, b := range []byte(sourceContents) {
		expectedHash += uint32(b) * position
		position += 1
	}
	expectedHash += uint32('\n') * position

	if !strings.Contains(result.GeneratedFiles[3].Contents, "\"packageName\":\"main\"") ||
		!strings.Contains(result.GeneratedFiles[3].Contents, "\"functions\":[{\"name\":\"main\",\"exported\":false,\"method\":false,\"main\":true,\"init\":false,\"parameters\":0,\"results\":0}]") {
		t.Fatalf("expected lowered ir manifest to embed parsed source semantics, got: %q", result.GeneratedFiles[3].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("\treturn %du;\n", expectedHash)) {
		t.Fatalf("expected lowered source hash to use source contents, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char tinygo_lowered_program_000_package_name[] = \"main\";") {
		t.Fatalf("expected lowered source to embed parsed package name, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_import_count(void) {\n\treturn 0u;\n}") {
		t.Fatalf("expected lowered source to embed parsed import count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_import_path_hash(void) {\n\treturn 0u;\n}") {
		t.Fatalf("expected lowered source to embed parsed import path hash, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_blank_import_count(void) {\n\treturn 0u;\n}") {
		t.Fatalf("expected lowered source to embed parsed blank import count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_dot_import_count(void) {\n\treturn 0u;\n}") {
		t.Fatalf("expected lowered source to embed parsed dot import count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_function_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed function count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_main_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed main count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_init_count(void) {\n\treturn 0u;\n}") {
		t.Fatalf("expected lowered source to embed parsed init count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildProducesRunnableExecutionArtifactsForSimpleProgramSubset(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\n\nconst bonus = 3\n\nfunc factorial(n int) int {\n\tif n <= 1 {\n\t\treturn 1\n\t}\n\treturn n * factorial(n-1)\n}\n\nfunc main() {\n\tprint(\"factorial_plus_bonus=\")\n\tprintln(factorial(5) + bonus)\n}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				ImportPath:        "command-line-arguments",
				Imports:           []string{},
				DepOnly:           false,
				ModulePath:        "example.com/staticprobe",
				PackageName:       "main",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
				Standard:          false,
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	if !strings.Contains(result.GeneratedFiles[2].Contents, "extern tinygo_wasi_errno_t tinygo_runtime_fd_write_import") {
		t.Fatalf("expected lowered source to import wasi fd_write, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static void tinygo_runtime_print_i32(int value, int newline)") {
		t.Fatalf("expected lowered source to embed integer printing helper, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "int main(void) {") {
		t.Fatalf("expected lowered source to embed a runnable main entrypoint, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "tinygo_runtime_print_literal(\"factorial_plus_bonus=\", 21u, 0);") {
		t.Fatalf("expected lowered source to embed translated print calls, got: %q", result.GeneratedFiles[2].Contents)
	}

	var loweredArtifactManifest struct {
		ArtifactKind string  `json:"artifactKind"`
		Entrypoint   *string `json:"entrypoint"`
		Reason       string  `json:"reason"`
		Runnable     bool    `json:"runnable"`
	}
	if err := json.Unmarshal([]byte(result.GeneratedFiles[5].Contents), &loweredArtifactManifest); err != nil {
		t.Fatalf("json.Unmarshal(lowered-artifact): %v", err)
	}
	if loweredArtifactManifest.ArtifactKind != "execution" || loweredArtifactManifest.Entrypoint == nil || *loweredArtifactManifest.Entrypoint != "main" || loweredArtifactManifest.Reason != "" || loweredArtifactManifest.Runnable != true {
		t.Fatalf("unexpected lowered artifact manifest: %#v", loweredArtifactManifest)
	}
	var commandArtifactManifest struct {
		ArtifactKind string  `json:"artifactKind"`
		Entrypoint   *string `json:"entrypoint"`
		Reason       string  `json:"reason"`
		Runnable     bool    `json:"runnable"`
	}
	if err := json.Unmarshal([]byte(result.GeneratedFiles[6].Contents), &commandArtifactManifest); err != nil {
		t.Fatalf("json.Unmarshal(command-artifact): %v", err)
	}
	if commandArtifactManifest.ArtifactKind != "execution" || commandArtifactManifest.Entrypoint == nil || *commandArtifactManifest.Entrypoint != "main" || commandArtifactManifest.Reason != "" || commandArtifactManifest.Runnable != true {
		t.Fatalf("unexpected command artifact manifest: %#v", commandArtifactManifest)
	}
}

func TestBuildProducesRunnableExecutionArtifactsForTinyGoStarterSubset(t *testing.T) {
	dir := t.TempDir()
	entryPath := filepath.Join(dir, "main.go")
	starterSource := "package main\n\nimport (\n\t\"bufio\"\n\t\"fmt\"\n\t\"os\"\n\t\"strconv\"\n\t\"strings\"\n)\n\nconst bonus = 3\nconst baseLabel = \"factorial_plus_bonus\"\nconst allowBonus = true\nconst skipPenalty bool = false\n\nfunc label() string {\n\treturn baseLabel\n}\n\nfunc factorial(n int) int {\n\tif n <= 1 {\n\t\treturn 1\n\t}\n\treturn n * factorial(n-1)\n}\n\nfunc main() {\n\tline, _ := bufio.NewReader(os.Stdin).ReadString('\\n')\n\tn, err := strconv.Atoi(strings.TrimSpace(line))\n\tif err != nil {\n\t\tn = 4\n\t}\n\ttotal := factorial(n)\n\tif allowBonus && !skipPenalty {\n\t\ttotal = total + bonus\n\t}\n\tfmt.Printf(\"%s=%d input=%d\\n\", label(), total, n)\n}\n"
	if err := os.WriteFile(entryPath, []byte(starterSource), 0o644); err != nil {
		t.Fatalf("os.WriteFile(main.go): %v", err)
	}

	stdlibFiles := map[string]string{
		"bufio/bufio.go":     "package bufio\n\ntype Reader struct{}\n\nfunc NewReader(v any) Reader { return Reader{} }\n\nfunc (Reader) ReadString(delim byte) (string, error) { return \"\", nil }\n",
		"fmt/fmt.go":         "package fmt\n\nfunc Printf(format string, args ...any) (int, error) { return 0, nil }\n",
		"os/os.go":           "package os\n\ntype File struct{}\n\nvar Stdin File\n",
		"strconv/strconv.go": "package strconv\n\nfunc Atoi(s string) (int, error) { return 0, nil }\n",
		"strings/strings.go": "package strings\n\nfunc TrimSpace(s string) string { return s }\n",
	}
	for relativePath, contents := range stdlibFiles {
		absolutePath := filepath.Join(dir, relativePath)
		if err := os.MkdirAll(filepath.Dir(absolutePath), 0o755); err != nil {
			t.Fatalf("os.MkdirAll(%s): %v", relativePath, err)
		}
		if err := os.WriteFile(absolutePath, []byte(contents), 0o644); err != nil {
			t.Fatalf("os.WriteFile(%s): %v", relativePath, err)
		}
	}

	result, err := Build(Input{
		EntryFile: entryPath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				ImportPath:        "command-line-arguments",
				Imports:           []string{"bufio", "fmt", "os", "strconv", "strings"},
				DepOnly:           false,
				ModulePath:        "example.com/wasmidle",
				PackageName:       "main",
				PackageDir:        dir,
				Files:             []string{entryPath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
				Standard:          false,
			},
			{
				ID:                "stdlib-000",
				Kind:              "stdlib",
				ImportPath:        "bufio",
				DepOnly:           true,
				ModulePath:        "std",
				PackageName:       "bufio",
				PackageDir:        filepath.Join(dir, "bufio"),
				Files:             []string{filepath.Join(dir, "bufio", "bufio.go")},
				BitcodeOutputPath: "/working/tinygo-work/stdlib-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
				Standard:          true,
			},
			{
				ID:                "stdlib-001",
				Kind:              "stdlib",
				ImportPath:        "fmt",
				DepOnly:           true,
				ModulePath:        "std",
				PackageName:       "fmt",
				PackageDir:        filepath.Join(dir, "fmt"),
				Files:             []string{filepath.Join(dir, "fmt", "fmt.go")},
				BitcodeOutputPath: "/working/tinygo-work/stdlib-001.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
				Standard:          true,
			},
			{
				ID:                "stdlib-002",
				Kind:              "stdlib",
				ImportPath:        "os",
				DepOnly:           true,
				ModulePath:        "std",
				PackageName:       "os",
				PackageDir:        filepath.Join(dir, "os"),
				Files:             []string{filepath.Join(dir, "os", "os.go")},
				BitcodeOutputPath: "/working/tinygo-work/stdlib-002.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
				Standard:          true,
			},
			{
				ID:                "stdlib-003",
				Kind:              "stdlib",
				ImportPath:        "strconv",
				DepOnly:           true,
				ModulePath:        "std",
				PackageName:       "strconv",
				PackageDir:        filepath.Join(dir, "strconv"),
				Files:             []string{filepath.Join(dir, "strconv", "strconv.go")},
				BitcodeOutputPath: "/working/tinygo-work/stdlib-003.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
				Standard:          true,
			},
			{
				ID:                "stdlib-004",
				Kind:              "stdlib",
				ImportPath:        "strings",
				DepOnly:           true,
				ModulePath:        "std",
				PackageName:       "strings",
				PackageDir:        filepath.Join(dir, "strings"),
				Files:             []string{filepath.Join(dir, "strings", "strings.go")},
				BitcodeOutputPath: "/working/tinygo-work/stdlib-004.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
				Standard:          true,
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	generatedFilesByPath := map[string]string{}
	for _, generatedFile := range result.GeneratedFiles {
		generatedFilesByPath[generatedFile.Path] = generatedFile.Contents
	}

	loweredSourceContents := generatedFilesByPath["/working/tinygo-lowered/program-000.c"]
	if !strings.Contains(loweredSourceContents, "extern tinygo_wasi_errno_t tinygo_runtime_fd_read_import") {
		t.Fatalf("expected lowered source to import wasi fd_read, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "static unsigned int tinygo_runtime_read_line(char *buffer, tinygo_wasi_size_t capacity)") {
		t.Fatalf("expected lowered source to embed line reader helper, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "static char *tinygo_runtime_trim_space(char *value)") {
		t.Fatalf("expected lowered source to embed trim-space helper, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "static int tinygo_runtime_parse_i32(char *value, int *out)") {
		t.Fatalf("expected lowered source to embed integer parser helper, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "tinygo_runtime_read_line(line, 256u);") {
		t.Fatalf("expected lowered source to lower bufio.ReadString newline reads, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "err = tinygo_runtime_parse_i32(tinygo_runtime_trim_space(line), &n);") {
		t.Fatalf("expected lowered source to lower strconv.Atoi(strings.TrimSpace(...)), got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "static char *baseLabel = \"factorial_plus_bonus\";") {
		t.Fatalf("expected lowered source to lower string constants, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "static char* label(void);") {
		t.Fatalf("expected lowered source to declare main-package string helpers, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "static char* label(void) {\n\treturn baseLabel;\n}") {
		t.Fatalf("expected lowered source to lower main-package string helpers, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "static const int allowBonus = 1;") {
		t.Fatalf("expected lowered source to lower true constants, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "static const int skipPenalty = 0;") {
		t.Fatalf("expected lowered source to lower typed false constants, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "if ((allowBonus && (!skipPenalty))) {") {
		t.Fatalf("expected lowered source to lower logical boolean conditions, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "char *tinygo_printf_arg_000 = label();") {
		t.Fatalf("expected lowered source to evaluate fmt.Printf string placeholder first, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "tinygo_runtime_print_string(tinygo_printf_arg_000, 0);") {
		t.Fatalf("expected lowered source to lower fmt.Printf string placeholder, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "tinygo_runtime_print_literal(\"=\", 1u, 0);") {
		t.Fatalf("expected lowered source to lower fmt.Printf literal separator, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "int tinygo_printf_arg_001 = total;") {
		t.Fatalf("expected lowered source to evaluate first fmt.Printf integer payload first, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "tinygo_runtime_print_i32(tinygo_printf_arg_001, 0);") {
		t.Fatalf("expected lowered source to lower first fmt.Printf integer payload, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "tinygo_runtime_print_literal(\" input=\", 7u, 0);") {
		t.Fatalf("expected lowered source to lower fmt.Printf middle literal, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "int tinygo_printf_arg_002 = n;") {
		t.Fatalf("expected lowered source to evaluate second fmt.Printf integer payload first, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "tinygo_runtime_print_i32(tinygo_printf_arg_002, 0);") {
		t.Fatalf("expected lowered source to lower second fmt.Printf integer payload, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "tinygo_runtime_print_literal(\"\\n\", 1u, 0);") {
		t.Fatalf("expected lowered source to lower fmt.Printf newline suffix, got: %q", loweredSourceContents)
	}

	var loweredArtifactManifest struct {
		ArtifactKind string  `json:"artifactKind"`
		Entrypoint   *string `json:"entrypoint"`
		Reason       string  `json:"reason"`
		Runnable     bool    `json:"runnable"`
	}
	if err := json.Unmarshal([]byte(generatedFilesByPath["/working/tinygo-lowered-artifact.json"]), &loweredArtifactManifest); err != nil {
		t.Fatalf("json.Unmarshal(lowered-artifact): %v", err)
	}
	if loweredArtifactManifest.ArtifactKind != "execution" || loweredArtifactManifest.Entrypoint == nil || *loweredArtifactManifest.Entrypoint != "main" || loweredArtifactManifest.Reason != "" || loweredArtifactManifest.Runnable != true {
		t.Fatalf("unexpected lowered artifact manifest: %#v", loweredArtifactManifest)
	}

	var commandArtifactManifest struct {
		ArtifactKind string  `json:"artifactKind"`
		Entrypoint   *string `json:"entrypoint"`
		Reason       string  `json:"reason"`
		Runnable     bool    `json:"runnable"`
	}
	if err := json.Unmarshal([]byte(generatedFilesByPath["/working/tinygo-command-artifact.json"]), &commandArtifactManifest); err != nil {
		t.Fatalf("json.Unmarshal(command-artifact): %v", err)
	}
	if commandArtifactManifest.ArtifactKind != "execution" || commandArtifactManifest.Entrypoint == nil || *commandArtifactManifest.Entrypoint != "main" || commandArtifactManifest.Reason != "" || commandArtifactManifest.Runnable != true {
		t.Fatalf("unexpected command artifact manifest: %#v", commandArtifactManifest)
	}
}

func TestBuildProducesRunnableExecutionArtifactsForImportedWorkspacePackageSubset(t *testing.T) {
	dir := t.TempDir()
	entryPath := filepath.Join(dir, "main.go")
	programHelperPath := filepath.Join(dir, "extra.go")
	helperPath := filepath.Join(dir, "helper", "helper.go")
	fmtPath := filepath.Join(dir, "fmt", "fmt.go")
	if err := os.MkdirAll(filepath.Dir(helperPath), 0o755); err != nil {
		t.Fatalf("os.MkdirAll(helper): %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(fmtPath), 0o755); err != nil {
		t.Fatalf("os.MkdirAll(fmt): %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("package main\n\nimport \"example.com/staticimport/helper\"\n\nfunc main() {\n\thelper.Run()\n}\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(main.go): %v", err)
	}
	if err := os.WriteFile(programHelperPath, []byte("package main\n\nfunc keepalive() int {\n\treturn 7\n}\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(extra.go): %v", err)
	}
	if err := os.WriteFile(helperPath, []byte("package helper\n\nimport \"fmt\"\n\nfunc Run() {\n\tfmt.Println(\"import-ok\")\n}\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(helper.go): %v", err)
	}
	if err := os.WriteFile(fmtPath, []byte("package fmt\n\nfunc Println(args ...any) (int, error) { return 0, nil }\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(fmt.go): %v", err)
	}

	result, err := Build(Input{
		EntryFile: entryPath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				ImportPath:        "command-line-arguments",
				Imports:           []string{"example.com/staticimport/helper"},
				DepOnly:           false,
				ModulePath:        "example.com/staticimport",
				PackageName:       "main",
				PackageDir:        dir,
				Files:             []string{entryPath, programHelperPath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
				Standard:          false,
			},
			{
				ID:                "imported-000",
				Kind:              "imported",
				ImportPath:        "example.com/staticimport/helper",
				Imports:           []string{"fmt"},
				DepOnly:           true,
				ModulePath:        "example.com/staticimport",
				PackageName:       "helper",
				PackageDir:        filepath.Join(dir, "helper"),
				Files:             []string{helperPath},
				BitcodeOutputPath: "/working/tinygo-work/imported-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
				Standard:          false,
			},
			{
				ID:                "stdlib-000",
				Kind:              "stdlib",
				ImportPath:        "fmt",
				Imports:           []string{},
				DepOnly:           true,
				ModulePath:        "std",
				PackageName:       "fmt",
				PackageDir:        filepath.Join(dir, "fmt"),
				Files:             []string{fmtPath},
				BitcodeOutputPath: "/working/tinygo-work/stdlib-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
				Standard:          true,
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	generatedFilesByPath := map[string]string{}
	for _, generatedFile := range result.GeneratedFiles {
		generatedFilesByPath[generatedFile.Path] = generatedFile.Contents
	}

	programLoweredSource := generatedFilesByPath["/working/tinygo-lowered/program-000.c"]
	importedLoweredSource := generatedFilesByPath["/working/tinygo-lowered/imported-000.c"]
	if !strings.Contains(programLoweredSource, "int main(void) {") {
		t.Fatalf("expected runnable main entrypoint in program lowered source, got: %q", programLoweredSource)
	}
	if !strings.Contains(programLoweredSource, "tinygo_imported_000_Run();") {
		t.Fatalf("expected program lowered source to call imported helper symbol, got: %q", programLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "void tinygo_imported_000_Run(void)") {
		t.Fatalf("expected imported lowered source to export runnable helper symbol, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "tinygo_runtime_print_literal(\"import-ok\", 9u, 1);") {
		t.Fatalf("expected imported lowered source to lower fmt.Println, got: %q", importedLoweredSource)
	}

	var commandArtifactManifest struct {
		ArtifactKind string  `json:"artifactKind"`
		Entrypoint   *string `json:"entrypoint"`
		Reason       string  `json:"reason"`
		Runnable     bool    `json:"runnable"`
	}
	if err := json.Unmarshal([]byte(generatedFilesByPath["/working/tinygo-command-artifact.json"]), &commandArtifactManifest); err != nil {
		t.Fatalf("json.Unmarshal(command-artifact): %v", err)
	}
	if commandArtifactManifest.ArtifactKind != "execution" || commandArtifactManifest.Entrypoint == nil || *commandArtifactManifest.Entrypoint != "main" || commandArtifactManifest.Reason != "" || commandArtifactManifest.Runnable != true {
		t.Fatalf("unexpected command artifact manifest: %#v", commandArtifactManifest)
	}
}

func TestBuildProducesRunnableExecutionArtifactsForImportedWorkspaceIntHelperSubset(t *testing.T) {
	dir := t.TempDir()
	entryPath := filepath.Join(dir, "main.go")
	helperPath := filepath.Join(dir, "helper", "helper.go")
	fmtPath := filepath.Join(dir, "fmt", "fmt.go")
	if err := os.MkdirAll(filepath.Dir(helperPath), 0o755); err != nil {
		t.Fatalf("os.MkdirAll(helper): %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(fmtPath), 0o755); err != nil {
		t.Fatalf("os.MkdirAll(fmt): %v", err)
	}
	if err := os.WriteFile(entryPath, []byte(`package main

import (
	"fmt"

	"example.com/staticimport/helper"
)

func main() {
	fmt.Printf("%s=%d\n", helper.Label(), helper.Total(5))
}
`), 0o644); err != nil {
		t.Fatalf("os.WriteFile(main.go): %v", err)
	}
	if err := os.WriteFile(helperPath, []byte(`package helper

import "fmt"

var Bonus = 3
const InputLabel = "helper_input"
const OutputLabel = "imported_total"
const ApplyBonus = true
const SkipReport bool = false
var Adjustment int

func Factorial(n int) int {
	if n <= 1 {
		return 1
	}
	return n * Factorial(n-1)
}

func Sum(n int) int {
	total := 0
	for i := 1; ; i += 1 {
		if i > n {
			break
		}
		if i == 0 {
			continue
		}
		total += i
	}
	return total
}

func Report(n int) {
	fmt.Printf("%s=%d\n", InputLabel, n)
}

func Label() string {
	switch labelTag := OutputLabel; labelTag {
	case "imported_total":
		return OutputLabel
	default:
		return "none"
	}
}

func Total(n int) int {
	if !SkipReport {
		Report(n)
	}
	if OutputLabel != "imported_total" {
		return 0
	}
	total := Factorial(n) + Sum(2)
	if ApplyBonus || false {
		if labelLen := len(OutputLabel); labelLen > 0 {
			Bonus += labelLen - 14
		}
		const adjustmentBase = 3
		Adjustment += Bonus - adjustmentBase
		total += Adjustment
		return total
	}
	return Factorial(n)
}
`), 0o644); err != nil {
		t.Fatalf("os.WriteFile(helper.go): %v", err)
	}
	if err := os.WriteFile(fmtPath, []byte("package fmt\n\nfunc Print(args ...any) (int, error) { return 0, nil }\nfunc Println(args ...any) (int, error) { return 0, nil }\nfunc Printf(format string, args ...any) (int, error) { return 0, nil }\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(fmt.go): %v", err)
	}

	result, err := Build(Input{
		EntryFile: entryPath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				ImportPath:        "command-line-arguments",
				Imports:           []string{"fmt", "example.com/staticimport/helper"},
				DepOnly:           false,
				ModulePath:        "example.com/staticimport",
				PackageName:       "main",
				PackageDir:        dir,
				Files:             []string{entryPath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
				Standard:          false,
			},
			{
				ID:                "imported-000",
				Kind:              "imported",
				ImportPath:        "example.com/staticimport/helper",
				Imports:           []string{"fmt"},
				DepOnly:           true,
				ModulePath:        "example.com/staticimport",
				PackageName:       "helper",
				PackageDir:        filepath.Join(dir, "helper"),
				Files:             []string{helperPath},
				BitcodeOutputPath: "/working/tinygo-work/imported-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
				Standard:          false,
			},
			{
				ID:                "stdlib-000",
				Kind:              "stdlib",
				ImportPath:        "fmt",
				Imports:           []string{},
				DepOnly:           true,
				ModulePath:        "std",
				PackageName:       "fmt",
				PackageDir:        filepath.Join(dir, "fmt"),
				Files:             []string{fmtPath},
				BitcodeOutputPath: "/working/tinygo-work/stdlib-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
				Standard:          true,
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	generatedFilesByPath := map[string]string{}
	for _, generatedFile := range result.GeneratedFiles {
		generatedFilesByPath[generatedFile.Path] = generatedFile.Contents
	}

	programLoweredSource := generatedFilesByPath["/working/tinygo-lowered/program-000.c"]
	importedLoweredSource := generatedFilesByPath["/working/tinygo-lowered/imported-000.c"]
	if !strings.Contains(programLoweredSource, "int tinygo_imported_000_Total(int n);") {
		t.Fatalf("expected program lowered source to declare imported helper return signature, got: %q", programLoweredSource)
	}
	if !strings.Contains(programLoweredSource, "char *tinygo_printf_arg_") || !strings.Contains(programLoweredSource, "= tinygo_imported_000_Label();") {
		t.Fatalf("expected program lowered source to evaluate imported string helper before fmt.Printf output, got: %q", programLoweredSource)
	}
	if !strings.Contains(programLoweredSource, "int tinygo_printf_arg_") || !strings.Contains(programLoweredSource, "= tinygo_imported_000_Total(5);") {
		t.Fatalf("expected program lowered source to evaluate imported int helper before fmt.Printf output, got: %q", programLoweredSource)
	}
	if !strings.Contains(programLoweredSource, "tinygo_runtime_print_string(tinygo_printf_arg_") {
		t.Fatalf("expected program lowered source to print imported string helper result, got: %q", programLoweredSource)
	}
	if !strings.Contains(programLoweredSource, "tinygo_runtime_print_literal(\"=\", 1u, 0);") {
		t.Fatalf("expected program lowered source to print fmt.Printf separator literal, got: %q", programLoweredSource)
	}
	if !strings.Contains(programLoweredSource, "tinygo_runtime_print_i32(tinygo_printf_arg_") {
		t.Fatalf("expected program lowered source to print imported helper result, got: %q", programLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "static int tinygo_imported_000_Bonus = 3;") {
		t.Fatalf("expected imported lowered source to prefix imported int vars, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "static int tinygo_imported_000_Adjustment = 0;") {
		t.Fatalf("expected imported lowered source to prefix imported zero int vars, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "static char *tinygo_imported_000_InputLabel = \"helper_input\";") {
		t.Fatalf("expected imported lowered source to prefix imported string constants, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "static char *tinygo_imported_000_OutputLabel = \"imported_total\";") {
		t.Fatalf("expected imported lowered source to prefix imported string constants, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "static const int tinygo_imported_000_ApplyBonus = 1;") {
		t.Fatalf("expected imported lowered source to prefix imported true constants, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "static const int tinygo_imported_000_SkipReport = 0;") {
		t.Fatalf("expected imported lowered source to prefix imported typed false constants, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "int tinygo_imported_000_Factorial(int n)") {
		t.Fatalf("expected imported lowered source to lower recursive helper, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "int tinygo_imported_000_Sum(int n)") {
		t.Fatalf("expected imported lowered source to lower loop helper, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "for (int i = 1; 1; i += 1)") {
		t.Fatalf("expected imported lowered source to lower helper loop, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "break;") {
		t.Fatalf("expected imported lowered source to lower loop break statements, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "continue;") {
		t.Fatalf("expected imported lowered source to lower loop continue statements, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "void tinygo_imported_000_Report(int n)") {
		t.Fatalf("expected imported lowered source to lower void helper with int parameter, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "char *tinygo_printf_arg_000 = tinygo_imported_000_InputLabel;") {
		t.Fatalf("expected imported lowered source to evaluate fmt.Printf string placeholder first, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "tinygo_runtime_print_string(tinygo_printf_arg_000, 0);") {
		t.Fatalf("expected imported lowered source to lower fmt.Printf string placeholder, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "int tinygo_printf_arg_001 = n;") {
		t.Fatalf("expected imported lowered source to evaluate fmt.Printf integer placeholder first, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "tinygo_runtime_print_i32(tinygo_printf_arg_001, 0);") {
		t.Fatalf("expected imported lowered source to lower fmt.Printf integer placeholder, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "int tinygo_imported_000_Total(int n)") {
		t.Fatalf("expected imported lowered source to lower exported int helper, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "if ((!tinygo_imported_000_SkipReport)) {") {
		t.Fatalf("expected imported lowered source to lower unary boolean conditions, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "tinygo_imported_000_Report(n);") {
		t.Fatalf("expected imported lowered source to call void helper from int helper, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "if ((tinygo_imported_000_ApplyBonus || 0)) {") {
		t.Fatalf("expected imported lowered source to lower logical boolean conditions, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "int labelLen = tinygo_runtime_string_len(tinygo_imported_000_OutputLabel);") {
		t.Fatalf("expected imported lowered source to lower if init short declaration, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "if ((labelLen > 0)) {") {
		t.Fatalf("expected imported lowered source to lower if init condition, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "tinygo_imported_000_Bonus += (labelLen - 14);") {
		t.Fatalf("expected imported lowered source to compound-assign string len into imported package var, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "const int adjustmentBase = 3;") {
		t.Fatalf("expected imported lowered source to lower local inferred int const declaration, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "tinygo_imported_000_Adjustment += (tinygo_imported_000_Bonus - adjustmentBase);") {
		t.Fatalf("expected imported lowered source to compound-assign imported package var, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "total += tinygo_imported_000_Adjustment;") {
		t.Fatalf("expected imported lowered source to compound-assign imported package var into local, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "return total;") {
		t.Fatalf("expected imported lowered source to return compound assignment result, got: %q", importedLoweredSource)
	}
	if !strings.Contains(programLoweredSource, "int tinygo_runtime_string_equal(const char *left, const char *right)") {
		t.Fatalf("expected program lowered source to export string equality helper for imported packages, got: %q", programLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "extern int tinygo_runtime_string_equal(const char *left, const char *right);") {
		t.Fatalf("expected imported lowered source to declare string equality helper, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "if ((tinygo_runtime_string_equal(tinygo_imported_000_OutputLabel, \"imported_total\") == 0)) {") {
		t.Fatalf("expected imported lowered source to lower string inequality condition, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "char* tinygo_imported_000_Label(void)") {
		t.Fatalf("expected imported lowered source to lower exported string helper, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "char *labelTag = tinygo_imported_000_OutputLabel;") {
		t.Fatalf("expected imported lowered source to lower switch init short declaration, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "if ((tinygo_runtime_string_equal(labelTag, \"imported_total\") != 0)) {") {
		t.Fatalf("expected imported lowered source to lower string switch case, got: %q", importedLoweredSource)
	}
	if !strings.Contains(importedLoweredSource, "return tinygo_imported_000_OutputLabel;") {
		t.Fatalf("expected imported lowered source to return string constant from helper, got: %q", importedLoweredSource)
	}

	var commandArtifactManifest struct {
		ArtifactKind string  `json:"artifactKind"`
		Entrypoint   *string `json:"entrypoint"`
		Reason       string  `json:"reason"`
		Runnable     bool    `json:"runnable"`
	}
	if err := json.Unmarshal([]byte(generatedFilesByPath["/working/tinygo-command-artifact.json"]), &commandArtifactManifest); err != nil {
		t.Fatalf("json.Unmarshal(command-artifact): %v", err)
	}
	if commandArtifactManifest.ArtifactKind != "execution" || commandArtifactManifest.Entrypoint == nil || *commandArtifactManifest.Entrypoint != "main" || commandArtifactManifest.Reason != "" || commandArtifactManifest.Runnable != true {
		t.Fatalf("unexpected command artifact manifest: %#v", commandArtifactManifest)
	}
}

func TestBuildProducesRunnableExecutionArtifactsForSimpleForLoopSubset(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\n\nfunc main() {\n\tsum := 0\n\tfor i := 0; i < 3; i += 1 {\n\t\tsum += i\n\t}\n\tprintln(sum)\n}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				ImportPath:        "command-line-arguments",
				Imports:           []string{},
				DepOnly:           false,
				ModulePath:        "example.com/staticprobe",
				PackageName:       "main",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
				Standard:          false,
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	loweredSourceContents := result.GeneratedFiles[2].Contents
	if !strings.Contains(loweredSourceContents, "for (int i = 0; (i < 3); i += 1) {") {
		t.Fatalf("expected lowered source to lower for loop, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "sum += i;") {
		t.Fatalf("expected lowered source to lower loop body compound assignment, got: %q", loweredSourceContents)
	}
	if !strings.Contains(loweredSourceContents, "tinygo_runtime_print_i32(sum, 1);") {
		t.Fatalf("expected lowered source to lower println(sum), got: %q", loweredSourceContents)
	}
}

func TestBuildParsesBlankAndDotImportCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nimport (\n\t_ \"unsafe\"\n\t. \"fmt\"\n)\nfunc main() { Println(\"hi\") }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_blank_import_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed blank import count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_dot_import_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed dot import count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char tinygo_lowered_program_000_import_stream[] = \"_=unsafe\\n.=fmt\\n\";\n") {
		t.Fatalf("expected lowered source to embed normalized import stream, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_import_table[] = {\n\t\"_=unsafe\",\n\t\".=fmt\",\n};\n") {
		t.Fatalf("expected lowered source to embed import table, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char tinygo_lowered_program_000_import_block_value_000[] = \"import:_=unsafe\";\nstatic const char tinygo_lowered_program_000_import_block_value_001[] = \"import:.=fmt\";\n") {
		t.Fatalf("expected lowered source to embed import block values, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const unsigned int tinygo_lowered_program_000_import_probe_index_table[] = {\n\t0u,\n\t1u,\n};\n") {
		t.Fatalf("expected lowered source to embed import probe index table, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const unsigned int tinygo_lowered_program_000_import_lowering_index_table[] = {\n\t0u,\n\t1u,\n};\n") {
		t.Fatalf("expected lowered source to embed import lowering index table, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_run_import_lowering(unsigned int index) {\n\tif (index < 2u) {\n\t\treturn tinygo_lowered_program_000_lowering_block_table[tinygo_lowered_program_000_import_lowering_index_table[index]];\n\t}\n\treturn \"\";\n}\n") {
		t.Fatalf("expected lowered source to embed import lowering dispatcher, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_run_import_probe(unsigned int index) {\n\tif (index < 2u) {\n\t\treturn tinygo_lowered_program_000_placeholder_block_table[tinygo_lowered_program_000_import_probe_index_table[index]];\n\t}\n\treturn \"\";\n}\n") {
		t.Fatalf("expected lowered source to embed import probe dispatcher, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_import_block_000(void) {\n\treturn tinygo_lowered_program_000_run_import_probe(0u);\n}\n") ||
		!strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_import_block_001(void) {\n\treturn tinygo_lowered_program_000_run_import_probe(1u);\n}\n") {
		t.Fatalf("expected lowered source to route import block functions through import probe dispatcher, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_placeholder_block_table[] = {\n\ttinygo_lowered_program_000_import_block_value_000,\n\ttinygo_lowered_program_000_import_block_value_001,\n\ttinygo_lowered_program_000_function_block_value_000,\n\ttinygo_lowered_program_000_declaration_block_value_000,\n};\n") {
		t.Fatalf("expected lowered source to embed placeholder block table, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_placeholder_block_count(void) {\n\treturn 4u;\n}") {
		t.Fatalf("expected lowered source to embed placeholder block count, got: %q", result.GeneratedFiles[2].Contents)
	}
	expectedPlaceholderBlockHash := uint32(0)
	expectedPlaceholderBlockHashPosition := uint32(1)
	for _, placeholderBlock := range []string{
		"import:_=unsafe",
		"import:.=fmt",
		"function:main:0:0:1:0:0:0",
		"declaration:function:main:0:0",
	} {
		for _, b := range []byte(placeholderBlock) {
			expectedPlaceholderBlockHash += uint32(b) * expectedPlaceholderBlockHashPosition
			expectedPlaceholderBlockHashPosition += 1
		}
		expectedPlaceholderBlockHash += uint32('\n') * expectedPlaceholderBlockHashPosition
		expectedPlaceholderBlockHashPosition += 1
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_placeholder_block_hash(void) {\n\treturn %du;\n}", expectedPlaceholderBlockHash)) {
		t.Fatalf("expected lowered source to embed placeholder block hash, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char tinygo_lowered_program_000_placeholder_block_signature_value_000[] = \"_=unsafe\";\nstatic const char tinygo_lowered_program_000_placeholder_block_signature_value_001[] = \".=fmt\";\nstatic const char tinygo_lowered_program_000_placeholder_block_signature_value_002[] = \"main:0:0:1:0:0:0\";\nstatic const char tinygo_lowered_program_000_placeholder_block_signature_value_003[] = \"function:main:0:0\";\nstatic const char *tinygo_lowered_program_000_placeholder_block_signature_table[] = {\n\ttinygo_lowered_program_000_placeholder_block_signature_value_000,\n\ttinygo_lowered_program_000_placeholder_block_signature_value_001,\n\ttinygo_lowered_program_000_placeholder_block_signature_value_002,\n\ttinygo_lowered_program_000_placeholder_block_signature_value_003,\n};\n") {
		t.Fatalf("expected lowered source to embed placeholder block signature table, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_run_placeholder_block_signature(unsigned int index) {\n\tif (index < 4u) {\n\t\treturn tinygo_lowered_program_000_placeholder_block_signature_table[index];\n\t}\n\treturn \"\";\n}\n") {
		t.Fatalf("expected lowered source to embed placeholder block signature runner, got: %q", result.GeneratedFiles[2].Contents)
	}
	expectedPlaceholderBlockSignatureHash := uint32(0)
	expectedPlaceholderBlockSignatureHashPosition := uint32(1)
	for _, placeholderBlockSignature := range []string{
		"_=unsafe",
		".=fmt",
		"main:0:0:1:0:0:0",
		"function:main:0:0",
	} {
		for _, b := range []byte(placeholderBlockSignature) {
			expectedPlaceholderBlockSignatureHash += uint32(b) * expectedPlaceholderBlockSignatureHashPosition
			expectedPlaceholderBlockSignatureHashPosition += 1
		}
		expectedPlaceholderBlockSignatureHash += uint32('\n') * expectedPlaceholderBlockSignatureHashPosition
		expectedPlaceholderBlockSignatureHashPosition += 1
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_placeholder_block_signature_hash(void) {\n\treturn %du;\n}", expectedPlaceholderBlockSignatureHash)) {
		t.Fatalf("expected lowered source to embed placeholder block signature hash, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_run_placeholder_block(unsigned int index) {\n\tif (index < 4u) {\n\t\treturn tinygo_lowered_program_000_placeholder_block_table[index];\n\t}\n\treturn \"\";\n}\n") {
		t.Fatalf("expected lowered source to embed direct placeholder block runner, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char tinygo_lowered_program_000_lowering_block_value_000[] = \"tinygo_lower_unit_begin(\\\"program-000\\\", \\\"program\\\", \\\"main\\\", 1);tinygo_lower_import_begin();tinygo_emit_import_index(0);tinygo_emit_import_alias(\\\"_\\\");tinygo_emit_import_path(\\\"unsafe\\\");tinygo_emit_import_signature(\\\"_=unsafe\\\");tinygo_lower_import_end();tinygo_lower_unit_end()\";\nstatic const char tinygo_lowered_program_000_lowering_block_value_001[] = \"tinygo_lower_unit_begin(\\\"program-000\\\", \\\"program\\\", \\\"main\\\", 1);tinygo_lower_import_begin();tinygo_emit_import_index(1);tinygo_emit_import_alias(\\\".\\\");tinygo_emit_import_path(\\\"fmt\\\");tinygo_emit_import_signature(\\\".=fmt\\\");tinygo_lower_import_end();tinygo_lower_unit_end()\";\nstatic const char tinygo_lowered_program_000_lowering_block_value_002[] = \"tinygo_lower_unit_begin(\\\"program-000\\\", \\\"program\\\", \\\"main\\\", 1);tinygo_lower_function_begin(\\\"main\\\", \\\"main\\\");tinygo_emit_function_index(0);tinygo_emit_function_flags(0, 0, 1, 0);tinygo_emit_function_signature(0, 0);tinygo_emit_function_stream(\\\"main:0:0:1:0:0:0\\\");tinygo_lower_function_end();tinygo_lower_unit_end()\";\nstatic const char tinygo_lowered_program_000_lowering_block_value_003[] = \"tinygo_lower_unit_begin(\\\"program-000\\\", \\\"program\\\", \\\"main\\\", 1);tinygo_lower_declaration_begin(\\\"main\\\", \\\"function\\\", \\\"main\\\");tinygo_emit_declaration_index(0);tinygo_emit_declaration_flags(0, 0);tinygo_emit_declaration_signature(\\\"function:main:0:0\\\");tinygo_lower_declaration_end();tinygo_lower_unit_end()\";\nstatic const char *tinygo_lowered_program_000_lowering_block_table[] = {\n\ttinygo_lowered_program_000_lowering_block_value_000,\n\ttinygo_lowered_program_000_lowering_block_value_001,\n\ttinygo_lowered_program_000_lowering_block_value_002,\n\ttinygo_lowered_program_000_lowering_block_value_003,\n};\n") {
		t.Fatalf("expected lowered source to embed direct lowering block table, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_run_lowering_block(unsigned int index) {\n\tif (index < 4u) {\n\t\treturn tinygo_lowered_program_000_lowering_block_table[index];\n\t}\n\treturn \"\";\n}\n") {
		t.Fatalf("expected lowered source to embed direct lowering block runner, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_lowering_block_count(void) {\n\treturn 4u;\n}") {
		t.Fatalf("expected lowered source to embed lowering block count, got: %q", result.GeneratedFiles[2].Contents)
	}
	expectedLoweringBlockHash := uint32(0)
	expectedLoweringBlockHashPosition := uint32(1)
	for _, loweringBlock := range []string{
		"tinygo_lower_unit_begin(\"program-000\", \"program\", \"main\", 1);tinygo_lower_import_begin();tinygo_emit_import_index(0);tinygo_emit_import_alias(\"_\");tinygo_emit_import_path(\"unsafe\");tinygo_emit_import_signature(\"_=unsafe\");tinygo_lower_import_end();tinygo_lower_unit_end()",
		"tinygo_lower_unit_begin(\"program-000\", \"program\", \"main\", 1);tinygo_lower_import_begin();tinygo_emit_import_index(1);tinygo_emit_import_alias(\".\");tinygo_emit_import_path(\"fmt\");tinygo_emit_import_signature(\".=fmt\");tinygo_lower_import_end();tinygo_lower_unit_end()",
		"tinygo_lower_unit_begin(\"program-000\", \"program\", \"main\", 1);tinygo_lower_function_begin(\"main\", \"main\");tinygo_emit_function_index(0);tinygo_emit_function_flags(0, 0, 1, 0);tinygo_emit_function_signature(0, 0);tinygo_emit_function_stream(\"main:0:0:1:0:0:0\");tinygo_lower_function_end();tinygo_lower_unit_end()",
		"tinygo_lower_unit_begin(\"program-000\", \"program\", \"main\", 1);tinygo_lower_declaration_begin(\"main\", \"function\", \"main\");tinygo_emit_declaration_index(0);tinygo_emit_declaration_flags(0, 0);tinygo_emit_declaration_signature(\"function:main:0:0\");tinygo_lower_declaration_end();tinygo_lower_unit_end()",
	} {
		for _, b := range []byte(loweringBlock) {
			expectedLoweringBlockHash += uint32(b) * expectedLoweringBlockHashPosition
			expectedLoweringBlockHashPosition += 1
		}
		expectedLoweringBlockHash += uint32('\n') * expectedLoweringBlockHashPosition
		expectedLoweringBlockHashPosition += 1
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_lowering_block_hash(void) {\n\treturn %du;\n}", expectedLoweringBlockHash)) {
		t.Fatalf("expected lowered source to embed lowering block hash, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_lowering_block_runtime_hash(void) {\n\tunsigned int hash = 0u;\n\tunsigned int position = 1u;\n\tunsigned int index = 0u;\n\twhile (index < 4u) {\n\t\tconst char *value = tinygo_lowered_program_000_run_lowering_block(index);\n\t\twhile (*value != '\\0') {\n\t\t\thash += ((unsigned int)(unsigned char)(*value)) * position;\n\t\t\tposition += 1u;\n\t\t\tvalue += 1;\n\t\t}\n\t\thash += 10u * position;\n\t\tposition += 1u;\n\t\tindex += 1u;\n\t}\n\treturn hash;\n}\n") {
		t.Fatalf("expected lowered source to embed lowering block runtime hash, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_placeholder_block_runtime_hash(void) {\n\tunsigned int hash = 0u;\n\tunsigned int position = 1u;\n\tunsigned int index = 0u;\n\twhile (index < 4u) {\n\t\tconst char *value = tinygo_lowered_program_000_run_placeholder_block(index);\n\t\twhile (*value != '\\0') {\n\t\t\thash += ((unsigned int)(unsigned char)(*value)) * position;\n\t\t\tposition += 1u;\n\t\t\tvalue += 1;\n\t\t}\n\t\thash += 10u * position;\n\t\tposition += 1u;\n\t\tindex += 1u;\n\t}\n\treturn hash;\n}\n") {
		t.Fatalf("expected lowered source to embed placeholder block runtime hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesAliasedImportCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nimport ioalias \"io\"\nfunc main(reader ioalias.Reader) { _ = reader }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_aliased_import_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed aliased import count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char tinygo_lowered_program_000_import_stream[] = \"ioalias=io\\n\";\n") {
		t.Fatalf("expected lowered source to embed aliased import stream, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesMethodAndExportedFunctionCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype App struct{}\nfunc (App) Serve() {}\nfunc Hello() {}\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_method_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed method count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_exported_function_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed exported function count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_type_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed type count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_exported_type_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed exported type count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char tinygo_lowered_program_000_function_stream[] = \"Serve:1:1:0:0:0:0\\nHello:1:0:0:0:0:0\\nmain:0:0:1:0:0:0\\n\";\n") {
		t.Fatalf("expected lowered source to embed ordered function stream, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_function_table[] = {\n\t\"Serve:1:1:0:0:0:0\",\n\t\"Hello:1:0:0:0:0:0\",\n\t\"main:0:0:1:0:0:0\",\n};\n") {
		t.Fatalf("expected lowered source to embed function table, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char tinygo_lowered_program_000_function_block_value_000[] = \"function:Serve:1:1:0:0:0:0\";\nstatic const char tinygo_lowered_program_000_function_block_value_001[] = \"function:Hello:1:0:0:0:0:0\";\nstatic const char tinygo_lowered_program_000_function_block_value_002[] = \"function:main:0:0:1:0:0:0\";\n") {
		t.Fatalf("expected lowered source to embed function block values, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const unsigned int tinygo_lowered_program_000_function_probe_index_table[] = {\n\t0u,\n\t1u,\n\t2u,\n};\n") {
		t.Fatalf("expected lowered source to embed function probe index table, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const unsigned int tinygo_lowered_program_000_function_lowering_index_table[] = {\n\t0u,\n\t1u,\n\t2u,\n};\n") {
		t.Fatalf("expected lowered source to embed function lowering index table, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_run_function_lowering(unsigned int index) {\n\tif (index < 3u) {\n\t\treturn tinygo_lowered_program_000_lowering_block_table[tinygo_lowered_program_000_function_lowering_index_table[index]];\n\t}\n\treturn \"\";\n}\n") {
		t.Fatalf("expected lowered source to embed function lowering dispatcher, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_run_function_probe(unsigned int index) {\n\tif (index < 3u) {\n\t\treturn tinygo_lowered_program_000_placeholder_block_table[tinygo_lowered_program_000_function_probe_index_table[index]];\n\t}\n\treturn \"\";\n}\n") {
		t.Fatalf("expected lowered source to embed function probe dispatcher, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_function_block_000(void) {\n\treturn tinygo_lowered_program_000_run_function_probe(0u);\n}\n") ||
		!strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_function_block_001(void) {\n\treturn tinygo_lowered_program_000_run_function_probe(1u);\n}\n") ||
		!strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_function_block_002(void) {\n\treturn tinygo_lowered_program_000_run_function_probe(2u);\n}\n") {
		t.Fatalf("expected lowered source to route function block functions through function probe dispatcher, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesFunctionNameHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype App struct{}\nfunc (App) Serve() {}\nfunc Hello() {}\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"Serve", "Hello", "main"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_function_name_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed function name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildRecordsLoweredIRDeclarationsInSourceOrder(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nconst Version = \"v1\"\ntype App struct{}\nvar Build = 2\nfunc helper() {}\nfunc (App) Serve() {}\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	var loweredIRManifest struct {
		Units []struct {
			Declarations []struct {
				Kind     string `json:"kind"`
				Name     string `json:"name"`
				Exported bool   `json:"exported"`
				Method   bool   `json:"method"`
			} `json:"declarations"`
		} `json:"units"`
	}
	if err := json.Unmarshal([]byte(result.GeneratedFiles[3].Contents), &loweredIRManifest); err != nil {
		t.Fatalf("json.Unmarshal(lowered-ir): %v", err)
	}
	if !reflect.DeepEqual(loweredIRManifest.Units[0].Declarations, []struct {
		Kind     string `json:"kind"`
		Name     string `json:"name"`
		Exported bool   `json:"exported"`
		Method   bool   `json:"method"`
	}{
		{Kind: "const", Name: "Version", Exported: true, Method: false},
		{Kind: "type", Name: "App", Exported: true, Method: false},
		{Kind: "var", Name: "Build", Exported: true, Method: false},
		{Kind: "function", Name: "helper", Exported: false, Method: false},
		{Kind: "function", Name: "Serve", Exported: true, Method: true},
		{Kind: "function", Name: "main", Exported: false, Method: false},
	}) {
		t.Fatalf("unexpected lowered ir declarations: %#v", loweredIRManifest.Units[0].Declarations)
	}
	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"Version", "App", "Build", "helper", "Serve", "main"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}
	expectedSignatureHash := uint32(0)
	signaturePosition := uint32(1)
	expectedKindHash := uint32(0)
	kindPosition := uint32(1)
	expectedExportedNameHash := uint32(0)
	exportedNamePosition := uint32(1)
	expectedExportedSignatureHash := uint32(0)
	exportedSignaturePosition := uint32(1)
	expectedExportedKindHash := uint32(0)
	exportedKindPosition := uint32(1)
	expectedMethodNameHash := uint32(0)
	methodNamePosition := uint32(1)
	expectedMethodSignatureHash := uint32(0)
	methodSignaturePosition := uint32(1)
	expectedMethodKindHash := uint32(0)
	methodKindPosition := uint32(1)
	for _, declaration := range []struct {
		kind     string
		name     string
		exported bool
		method   bool
	}{
		{kind: "const", name: "Version", exported: true, method: false},
		{kind: "type", name: "App", exported: true, method: false},
		{kind: "var", name: "Build", exported: true, method: false},
		{kind: "function", name: "helper", exported: false, method: false},
		{kind: "function", name: "Serve", exported: true, method: true},
		{kind: "function", name: "main", exported: false, method: false},
	} {
		signature := declaration.kind + ":" + declaration.name + ":0:0"
		if declaration.exported {
			signature = declaration.kind + ":" + declaration.name + ":1:0"
		}
		if declaration.method {
			if declaration.exported {
				signature = declaration.kind + ":" + declaration.name + ":1:1"
			} else {
				signature = declaration.kind + ":" + declaration.name + ":0:1"
			}
		}
		for _, b := range []byte(signature) {
			expectedSignatureHash += uint32(b) * signaturePosition
			signaturePosition += 1
		}
		expectedSignatureHash += uint32('\n') * signaturePosition
		signaturePosition += 1
		for _, b := range []byte(declaration.kind) {
			expectedKindHash += uint32(b) * kindPosition
			kindPosition += 1
		}
		expectedKindHash += uint32('\n') * kindPosition
		kindPosition += 1
		if declaration.exported {
			for _, b := range []byte(declaration.name) {
				expectedExportedNameHash += uint32(b) * exportedNamePosition
				exportedNamePosition += 1
			}
			expectedExportedNameHash += uint32('\n') * exportedNamePosition
			exportedNamePosition += 1
			for _, b := range []byte(signature) {
				expectedExportedSignatureHash += uint32(b) * exportedSignaturePosition
				exportedSignaturePosition += 1
			}
			expectedExportedSignatureHash += uint32('\n') * exportedSignaturePosition
			exportedSignaturePosition += 1
			for _, b := range []byte(declaration.kind) {
				expectedExportedKindHash += uint32(b) * exportedKindPosition
				exportedKindPosition += 1
			}
			expectedExportedKindHash += uint32('\n') * exportedKindPosition
			exportedKindPosition += 1
		}
		if declaration.method {
			for _, b := range []byte(declaration.name) {
				expectedMethodNameHash += uint32(b) * methodNamePosition
				methodNamePosition += 1
			}
			expectedMethodNameHash += uint32('\n') * methodNamePosition
			methodNamePosition += 1
			for _, b := range []byte(signature) {
				expectedMethodSignatureHash += uint32(b) * methodSignaturePosition
				methodSignaturePosition += 1
			}
			expectedMethodSignatureHash += uint32('\n') * methodSignaturePosition
			methodSignaturePosition += 1
			for _, b := range []byte(declaration.kind) {
				expectedMethodKindHash += uint32(b) * methodKindPosition
				methodKindPosition += 1
			}
			expectedMethodKindHash += uint32('\n') * methodKindPosition
			methodKindPosition += 1
		}
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_declaration_count(void) {\n\treturn 6u;\n}") {
		t.Fatalf("expected lowered source to embed declaration count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_declaration_name_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed declaration name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_declaration_signature_hash(void) {\n\treturn %du;\n}", expectedSignatureHash)) {
		t.Fatalf("expected lowered source to embed declaration signature hash, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_declaration_kind_hash(void) {\n\treturn %du;\n}", expectedKindHash)) {
		t.Fatalf("expected lowered source to embed declaration kind hash, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_declaration_exported_count(void) {\n\treturn 4u;\n}") {
		t.Fatalf("expected lowered source to embed declaration exported count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_declaration_method_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed declaration method count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_declaration_exported_name_hash(void) {\n\treturn %du;\n}", expectedExportedNameHash)) {
		t.Fatalf("expected lowered source to embed declaration exported name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_declaration_exported_signature_hash(void) {\n\treturn %du;\n}", expectedExportedSignatureHash)) {
		t.Fatalf("expected lowered source to embed declaration exported signature hash, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_declaration_exported_kind_hash(void) {\n\treturn %du;\n}", expectedExportedKindHash)) {
		t.Fatalf("expected lowered source to embed declaration exported kind hash, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_declaration_method_name_hash(void) {\n\treturn %du;\n}", expectedMethodNameHash)) {
		t.Fatalf("expected lowered source to embed declaration method name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_declaration_method_signature_hash(void) {\n\treturn %du;\n}", expectedMethodSignatureHash)) {
		t.Fatalf("expected lowered source to embed declaration method signature hash, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_declaration_method_kind_hash(void) {\n\treturn %du;\n}", expectedMethodKindHash)) {
		t.Fatalf("expected lowered source to embed declaration method kind hash, got: %q", result.GeneratedFiles[2].Contents)
	}
	expectedDeclarationStream := "const:Version:1:0\n" +
		"type:App:1:0\n" +
		"var:Build:1:0\n" +
		"function:helper:0:0\n" +
		"function:Serve:1:1\n" +
		"function:main:0:0\n"
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("static const char tinygo_lowered_program_000_declaration_stream[] = %q;\n", expectedDeclarationStream)) {
		t.Fatalf("expected lowered source to embed declaration stream, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_declaration_table[] = {\n\t\"const:Version:1:0\",\n\t\"type:App:1:0\",\n\t\"var:Build:1:0\",\n\t\"function:helper:0:0\",\n\t\"function:Serve:1:1\",\n\t\"function:main:0:0\",\n};\n") {
		t.Fatalf("expected lowered source to embed declaration table, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char tinygo_lowered_program_000_declaration_block_value_000[] = \"declaration:const:Version:1:0\";\nstatic const char tinygo_lowered_program_000_declaration_block_value_001[] = \"declaration:type:App:1:0\";\nstatic const char tinygo_lowered_program_000_declaration_block_value_002[] = \"declaration:var:Build:1:0\";\nstatic const char tinygo_lowered_program_000_declaration_block_value_003[] = \"declaration:function:helper:0:0\";\nstatic const char tinygo_lowered_program_000_declaration_block_value_004[] = \"declaration:function:Serve:1:1\";\nstatic const char tinygo_lowered_program_000_declaration_block_value_005[] = \"declaration:function:main:0:0\";\n") {
		t.Fatalf("expected lowered source to embed declaration block values, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const unsigned int tinygo_lowered_program_000_declaration_probe_index_table[] = {\n\t3u,\n\t4u,\n\t5u,\n\t6u,\n\t7u,\n\t8u,\n};\n") {
		t.Fatalf("expected lowered source to embed declaration probe index table, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const unsigned int tinygo_lowered_program_000_declaration_lowering_index_table[] = {\n\t3u,\n\t4u,\n\t5u,\n\t6u,\n\t7u,\n\t8u,\n};\n") {
		t.Fatalf("expected lowered source to embed declaration lowering index table, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_run_declaration_lowering(unsigned int index) {\n\tif (index < 6u) {\n\t\treturn tinygo_lowered_program_000_lowering_block_table[tinygo_lowered_program_000_declaration_lowering_index_table[index]];\n\t}\n\treturn \"\";\n}\n") {
		t.Fatalf("expected lowered source to embed declaration lowering dispatcher, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_run_declaration_probe(unsigned int index) {\n\tif (index < 6u) {\n\t\treturn tinygo_lowered_program_000_placeholder_block_table[tinygo_lowered_program_000_declaration_probe_index_table[index]];\n\t}\n\treturn \"\";\n}\n") {
		t.Fatalf("expected lowered source to embed declaration probe dispatcher, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_declaration_block_000(void) {\n\treturn tinygo_lowered_program_000_run_declaration_probe(0u);\n}\n") ||
		!strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_declaration_block_001(void) {\n\treturn tinygo_lowered_program_000_run_declaration_probe(1u);\n}\n") ||
		!strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_declaration_block_002(void) {\n\treturn tinygo_lowered_program_000_run_declaration_probe(2u);\n}\n") ||
		!strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_declaration_block_003(void) {\n\treturn tinygo_lowered_program_000_run_declaration_probe(3u);\n}\n") ||
		!strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_declaration_block_004(void) {\n\treturn tinygo_lowered_program_000_run_declaration_probe(4u);\n}\n") ||
		!strings.Contains(result.GeneratedFiles[2].Contents, "static const char *tinygo_lowered_program_000_declaration_block_005(void) {\n\treturn tinygo_lowered_program_000_run_declaration_probe(5u);\n}\n") {
		t.Fatalf("expected lowered source to route declaration block functions through declaration probe dispatcher, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildWritesLoweringBlocksIntoLoweredIRWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nimport alias \"fmt\"\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	var loweredIRManifest struct {
		Units []struct {
			PlaceholderBlocks []struct {
				Stage     string `json:"stage"`
				Index     int    `json:"index"`
				Value     string `json:"value"`
				Signature string `json:"signature"`
			} `json:"placeholderBlocks"`
			LoweringBlocks []struct {
				Stage string `json:"stage"`
				Index int    `json:"index"`
				Value string `json:"value"`
			} `json:"loweringBlocks"`
		} `json:"units"`
	}
	if err := json.Unmarshal([]byte(result.GeneratedFiles[3].Contents), &loweredIRManifest); err != nil {
		t.Fatalf("json.Unmarshal(lowered-ir): %v", err)
	}
	if !reflect.DeepEqual(loweredIRManifest.Units[0].PlaceholderBlocks, []struct {
		Stage     string `json:"stage"`
		Index     int    `json:"index"`
		Value     string `json:"value"`
		Signature string `json:"signature"`
	}{
		{
			Stage:     "import",
			Index:     0,
			Value:     "import:alias=fmt",
			Signature: "alias=fmt",
		},
		{
			Stage:     "function",
			Index:     0,
			Value:     "function:main:0:0:1:0:0:0",
			Signature: "main:0:0:1:0:0:0",
		},
		{
			Stage:     "declaration",
			Index:     0,
			Value:     "declaration:function:main:0:0",
			Signature: "function:main:0:0",
		},
	}) {
		t.Fatalf("unexpected lowered ir placeholder blocks: %#v", loweredIRManifest.Units[0].PlaceholderBlocks)
	}
	if !reflect.DeepEqual(loweredIRManifest.Units[0].LoweringBlocks, []struct {
		Stage string `json:"stage"`
		Index int    `json:"index"`
		Value string `json:"value"`
	}{
		{
			Stage: "import",
			Index: 0,
			Value: "tinygo_lower_unit_begin(\"program-000\", \"program\", \"main\", 1);tinygo_lower_import_begin();tinygo_emit_import_index(0);tinygo_emit_import_alias(\"alias\");tinygo_emit_import_path(\"fmt\");tinygo_emit_import_signature(\"alias=fmt\");tinygo_lower_import_end();tinygo_lower_unit_end()",
		},
		{
			Stage: "function",
			Index: 0,
			Value: "tinygo_lower_unit_begin(\"program-000\", \"program\", \"main\", 1);tinygo_lower_function_begin(\"main\", \"main\");tinygo_emit_function_index(0);tinygo_emit_function_flags(0, 0, 1, 0);tinygo_emit_function_signature(0, 0);tinygo_emit_function_stream(\"main:0:0:1:0:0:0\");tinygo_lower_function_end();tinygo_lower_unit_end()",
		},
		{
			Stage: "declaration",
			Index: 0,
			Value: "tinygo_lower_unit_begin(\"program-000\", \"program\", \"main\", 1);tinygo_lower_declaration_begin(\"main\", \"function\", \"main\");tinygo_emit_declaration_index(0);tinygo_emit_declaration_flags(0, 0);tinygo_emit_declaration_signature(\"function:main:0:0\");tinygo_lower_declaration_end();tinygo_lower_unit_end()",
		},
	}) {
		t.Fatalf("unexpected lowered ir lowering blocks: %#v", loweredIRManifest.Units[0].LoweringBlocks)
	}
}

func TestBuildParsesMethodNameHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype App struct{}\nfunc (App) Serve() {}\nfunc (App) Reset() {}\nfunc Hello() {}\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"Serve", "Reset"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_method_name_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed method name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesMethodSignatureHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype App struct{}\nfunc (App) Serve() {}\nfunc (*App) Reset(value int) error { return nil }\nfunc Hello() {}\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	expectedHash := uint32(0)
	position := uint32(1)
	for _, signature := range []string{"func (App) Serve()", "func (*App) Reset(value int) error"} {
		for _, b := range []byte(signature) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_method_signature_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed method signature hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesExportedMethodNameHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype App struct{}\nfunc (App) serve() {}\nfunc (App) Reset() {}\nfunc (App) Start() {}\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"Reset", "Start"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_exported_method_name_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed exported method name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesExportedMethodSignatureHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype App struct{}\nfunc (App) serve() {}\nfunc (*App) Reset(value int) error { return nil }\nfunc (App) Start(flag bool) {}\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	expectedHash := uint32(0)
	position := uint32(1)
	for _, signature := range []string{"func (*App) Reset(value int) error", "func (App) Start(flag bool)"} {
		for _, b := range []byte(signature) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_exported_method_signature_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed exported method signature hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesExportedFunctionNameHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc helper() {}\nfunc Hello() {}\nfunc Exported[T any]() {}\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"Hello", "Exported"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_exported_function_name_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed exported function name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesCallExpressionAndReturnStatementCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nimport \"fmt\"\nfunc Hello() { fmt.Println(\"hi\") }\nfunc main() { return }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_call_expression_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed call expression count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_return_statement_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed return statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesGoAndDeferStatementCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nimport \"fmt\"\nfunc Hello() { defer fmt.Println(\"bye\"); fmt.Println(\"hi\") }\nfunc main() { go Hello(); return }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_go_statement_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed go statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_defer_statement_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed defer statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesIfAndRangeStatementCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc Hello(ok bool) { if ok { return } }\nfunc main() { for range []int{1} { return } }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_if_statement_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed if statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_range_statement_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed range statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesSwitchCaseAndSelectClauseCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc Choose(value int) { switch value { case 1: case 2: default: } }\nfunc Await(ch chan int) { select { case <-ch: case <-ch: default: } }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_switch_statement_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed switch statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_select_statement_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed select statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_switch_case_clause_count(void) {\n\treturn 3u;\n}") {
		t.Fatalf("expected lowered source to embed parsed switch case clause count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_select_comm_clause_count(void) {\n\treturn 3u;\n}") {
		t.Fatalf("expected lowered source to embed parsed select comm clause count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesTypeSwitchStatementCountWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc classify(value any) { switch value.(type) { case string: default: } }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_switch_statement_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to keep parsed switch statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_type_switch_statement_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed type switch statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesTypeSwitchCaseClauseCountWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc classify(value any) { switch value.(type) { case string: case int, int32: default: } }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_type_switch_statement_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to keep parsed type switch statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_type_switch_case_clause_count(void) {\n\treturn 3u;\n}") {
		t.Fatalf("expected lowered source to embed parsed type switch case clause count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesTypeSwitchGuardNameHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc classify(value any) { switch typed := value.(type) { case string: _ = typed; default: } }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_type_switch_guard_name_hash(void) {\n\treturn 1658u;\n}") {
		t.Fatalf("expected lowered source to embed parsed type switch guard name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesTypeSwitchCaseTypeHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc classify(value any) { switch value.(type) { case string: case int, int32: default: } }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_type_switch_case_type_hash(void) {\n\treturn 11496u;\n}") {
		t.Fatalf("expected lowered source to embed parsed type switch case type hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesStructFieldTypeHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype Base struct{}\ntype App struct{ Base; Name string; Count, Size int; Ready bool `json:\"ready\"` }\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_struct_field_type_hash(void) {\n\treturn 17616u;\n}") {
		t.Fatalf("expected lowered source to embed parsed struct field type hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesForBreakAndContinueStatementCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc loopForever() { for { break } }\nfunc step() { for { continue } }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_for_statement_count(void) {\n\treturn 2u;\n}") {
		t.Fatalf("expected lowered source to embed parsed for statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_break_statement_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed break statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_continue_statement_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed continue statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesLabelGotoAndFallthroughStatementCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc route(value int) {\nstart:\n\tswitch value {\n\tcase 0:\n\t\tgoto start\n\tcase 1:\n\t\tfallthrough\n\tdefault:\n\t}\n}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_labeled_statement_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed labeled statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_goto_statement_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed goto statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_fallthrough_statement_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed fallthrough statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesSendAndReceiveExpressionCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc pump(ch chan int) { ch <- 1; <-ch }\nfunc Await(ch chan int) { select { case <-ch: case <-ch: default: } }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_send_statement_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed send statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_receive_expression_count(void) {\n\treturn 3u;\n}") {
		t.Fatalf("expected lowered source to embed parsed receive expression count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesAssignAndDefineStatementCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc assignAll() { value := 1; value = value + 1 }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_assign_statement_count(void) {\n\treturn 2u;\n}") {
		t.Fatalf("expected lowered source to embed parsed assign statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_define_statement_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed define statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesIncAndDecStatementCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc bump() { value := 1; value++; value-- }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_inc_statement_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed increment statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_dec_statement_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed decrement statement count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesUnaryAndBinaryExpressionCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc exprs(ch chan int) int { value := -1; <-ch; return value + 2 }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_unary_expression_count(void) {\n\treturn 2u;\n}") {
		t.Fatalf("expected lowered source to embed parsed unary expression count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_binary_expression_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed binary expression count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesBuiltinAndAppendCallCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc grow(items []int) []int { return append(items, 1) }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_builtin_call_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed builtin call count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_append_call_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed append call count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesLenAndMakeCallCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc sizes(items []int) int { buffer := make([]int, len(items)); return len(buffer) }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_len_call_count(void) {\n\treturn 2u;\n}") {
		t.Fatalf("expected lowered source to embed parsed len call count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_make_call_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed make call count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesCapAndCopyCallCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc clone(dst, src []int) int { _ = copy(dst, src); return cap(dst) }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_cap_call_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed cap call count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_copy_call_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed copy call count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesPanicAndRecoverCallCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc guard() { _ = recover(); panic(\"boom\") }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_panic_call_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed panic call count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_recover_call_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed recover call count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesNewAndDeleteCallCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc useMap(m map[string]int) *int { delete(m, \"x\"); return new(int) }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_new_call_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed new call count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_delete_call_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed delete call count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesCompositeLiteralAndSelectorExpressionCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nimport \"fmt\"\ntype App struct{ Name string }\nfunc (App) Serve() {}\nfunc literals() { app := App{Name: \"codex\"}; _ = app.Name; fmt.Println(app.Name); app.Serve() }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_composite_literal_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed composite literal count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_selector_expression_count(void) {\n\treturn 4u;\n}") {
		t.Fatalf("expected lowered source to embed parsed selector expression count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesIndexAndSliceExpressionCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc access(items []int) int { _ = items[0]; return len(items[1:]) }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_index_expression_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed index expression count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_slice_expression_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed slice expression count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesKeyValueAndTypeAssertionCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype App struct{ Name string }\nfunc probe(value any) string { app := App{Name: \"codex\"}; text, _ := value.(string); _ = app; return text }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_key_value_expression_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed key value expression count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_type_assertion_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed type assertion count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesBlankIdentifierAndBlankAssignmentTargetCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc probe(value any) string { text, _ := value.(string); _ = text; _ = value; return text }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_blank_identifier_count(void) {\n\treturn 3u;\n}") {
		t.Fatalf("expected lowered source to embed parsed blank identifier count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_blank_assignment_target_count(void) {\n\treturn 3u;\n}") {
		t.Fatalf("expected lowered source to embed parsed blank assignment target count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesConstAndVarCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nconst Version = 1\nvar Ready = true\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_const_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed const count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_var_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed var count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_exported_const_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed exported const count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_exported_var_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed exported var count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesStructAndInterfaceTypeCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype App struct{}\ntype Service interface{ Run() }\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_struct_type_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed struct type count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_interface_type_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed interface type count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesMapAndChanTypeCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc probe(items map[string]int, input chan int, output chan<- int, recv <-chan int) { _ = items; _ = input; _ = output; _ = recv }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_map_type_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed map type count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_chan_type_count(void) {\n\treturn 3u;\n}") {
		t.Fatalf("expected lowered source to embed parsed chan type count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_send_only_chan_type_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed send-only chan type count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_receive_only_chan_type_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed receive-only chan type count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesArrayAndPointerTypeCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype Item struct{}\nfunc probe(items [3]int, slice []string, ptr *Item, nested **Item) { _ = items; _ = slice; _ = ptr; _ = nested }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_array_type_count(void) {\n\treturn 2u;\n}") {
		t.Fatalf("expected lowered source to embed parsed array type count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_pointer_type_count(void) {\n\treturn 3u;\n}") {
		t.Fatalf("expected lowered source to embed parsed pointer type count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesSliceTypeCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype Bag struct{ Values []int }\nfunc main(items []byte, nested [][]string) { _ = items; _ = nested }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_slice_type_count(void) {\n\treturn 4u;\n}") {
		t.Fatalf("expected lowered source to embed parsed slice type count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesTypeParameterCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype Box[T any, U comparable] struct{ Left T; Right U }\nfunc Convert[A any, B any](in A) B { var zero B; return zero }\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_type_parameter_count(void) {\n\treturn 4u;\n}") {
		t.Fatalf("expected lowered source to embed parsed type parameter count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_generic_function_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed generic function count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_generic_type_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed generic type count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesFuncLiteralCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc main() { _ = func(value int) int { return value + 1 } }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_func_literal_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed func literal count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesFuncParameterAndResultCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc add(a int, b string) (int, error) { return 0, nil }\nfunc main() { _ = func(value int, ok bool) string { return \"\" } }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_func_parameter_count(void) {\n\treturn 4u;\n}") {
		t.Fatalf("expected lowered source to embed parsed func parameter count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_func_result_count(void) {\n\treturn 3u;\n}") {
		t.Fatalf("expected lowered source to embed parsed func result count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesVariadicParameterAndNamedResultCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc add(prefix string, values ...int) (total int, err error) { return 0, nil }\nfunc main() { _ = func(flag bool, values ...string) (result string) { return \"\" } }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_variadic_parameter_count(void) {\n\treturn 2u;\n}") {
		t.Fatalf("expected lowered source to embed parsed variadic parameter count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_named_result_count(void) {\n\treturn 3u;\n}") {
		t.Fatalf("expected lowered source to embed parsed named result count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesStructFieldAndInterfaceMethodCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype App struct{ Name string }\ntype Service interface{ Run() }\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_struct_field_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed struct field count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_interface_method_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed interface method count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesEmbeddedStructFieldAndInterfaceMethodCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype Base struct{}\ntype App struct{ Base; Name string }\ntype Runner interface{ Run() }\ntype Service interface{ Runner; Close() }\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_embedded_struct_field_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed embedded struct field count, got: %q", result.GeneratedFiles[2].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_embedded_interface_method_count(void) {\n\treturn 1u;\n}") {
		t.Fatalf("expected lowered source to embed parsed embedded interface method count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesEmbeddedStructFieldTypeHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype Base struct{}\ntype Named struct{}\ntype App struct{ Base; Named; Name string }\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"Base", "Named"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}

	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_embedded_struct_field_type_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed embedded struct field type hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesInterfaceMethodNameHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype Runner interface{ Run() }\ntype Service interface{ Runner; Close(); Reset() error }\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"Run", "Close", "Reset"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}

	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_interface_method_name_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed interface method name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesInterfaceMethodSignatureHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype Runner interface{ Run() }\ntype Service interface{ Runner; Close(); Reset() error }\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_interface_method_signature_hash(void) {\n\treturn 8294u;\n}") {
		t.Fatalf("expected lowered source to embed parsed interface method signature hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesEmbeddedInterfaceMethodNameHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype Runner interface{ Run() }\ntype Closer interface{ Close() }\ntype Service interface{ Runner; Closer; Reset() error }\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"Runner", "Closer"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}

	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_embedded_interface_method_name_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed embedded interface method name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesTypeNameHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype runner struct{}\ntype App struct{}\ntype Service interface{ Run() }\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"runner", "App", "Service"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}

	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_type_name_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed type name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesExportedTypeNameHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype runner struct{}\ntype App struct{}\ntype service interface{ Run() }\ntype Public interface{ Close() }\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"App", "Public"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}

	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_exported_type_name_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed exported type name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesConstNameHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nconst (\n\tversion = 1\n\tAppName = \"wasm\"\n\tBuild, Ready = 1, 2\n)\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"version", "AppName", "Build", "Ready"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}

	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_const_name_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed const name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesExportedConstNameHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nconst (\n\tversion = 1\n\tAppName = \"wasm\"\n\tBuild, Ready = 1, 2\n)\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"AppName", "Build", "Ready"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}

	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_exported_const_name_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed exported const name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesVarNameHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nvar (\n\tready = true\n\tAppState = \"boot\"\n\tCount, Size = 1, 2\n)\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"ready", "AppState", "Count", "Size"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}

	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_var_name_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed var name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesExportedVarNameHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nvar (\n\tready = true\n\tAppState = \"boot\"\n\tCount, Size = 1, 2\n)\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"AppState", "Count", "Size"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}

	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_exported_var_name_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed exported var name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesTaggedStructFieldCountsWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype App struct{ Name string `json:\"name\"`; Count int `json:\"count\"`; Ready bool }\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !strings.Contains(result.GeneratedFiles[2].Contents, "unsigned int tinygo_lowered_program_000_tagged_struct_field_count(void) {\n\treturn 2u;\n}") {
		t.Fatalf("expected lowered source to embed parsed tagged struct field count, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesTaggedStructFieldTagHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype App struct{ Name string `json:\"name\"`; Count int `db:\"count\"`; Ready bool }\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	expectedHash := uint32(0)
	position := uint32(1)
	for _, tag := range []string{"`json:\"name\"`", "`db:\"count\"`"} {
		for _, b := range []byte(tag) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}

	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_tagged_struct_field_tag_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed tagged struct field tag hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesSelectorNameHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype App struct{ Name string; Ready bool; Count int }\nfunc main() { var app App; _, _, _ = app.Name, app.Ready, app.Count }\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"Name", "Ready", "Count"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}

	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_selector_name_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed selector name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesLabelNameHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc route(value int) {\nstart:\n\tif value > 0 {\n\t\tgoto start\n\t}\n}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"start"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}

	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_label_name_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed label name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesGotoLabelNameHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc route(value int) {\nstart:\n\tif value > 0 {\n\t\tgoto start\n\t}\n}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"start"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}

	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_goto_label_name_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed goto label name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesBreakLabelNameHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc route(items []int) {\nouter:\n\tfor range items {\n\t\tbreak outer\n\t}\n}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"outer"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}

	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_break_label_name_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed break label name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesContinueLabelNameHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nfunc route(items []int) {\nouter:\n\tfor range items {\n\t\tfor range items {\n\t\t\tcontinue outer\n\t\t}\n\t}\n}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"outer"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}

	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_continue_label_name_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed continue label name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildParsesStructFieldNameHashWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\ntype Base struct{}\ntype App struct{ Base; Name string; Count, Size int; Ready bool `json:\"ready\"` }\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	expectedHash := uint32(0)
	position := uint32(1)
	for _, name := range []string{"Name", "Count", "Size", "Ready"} {
		for _, b := range []byte(name) {
			expectedHash += uint32(b) * position
			position += 1
		}
		expectedHash += uint32('\n') * position
		position += 1
	}

	if !strings.Contains(result.GeneratedFiles[2].Contents, fmt.Sprintf("unsigned int tinygo_lowered_program_000_struct_field_name_hash(void) {\n\treturn %du;\n}", expectedHash)) {
		t.Fatalf("expected lowered source to embed parsed struct field name hash, got: %q", result.GeneratedFiles[2].Contents)
	}
}

func TestBuildWritesConstAndVarSummariesIntoLoweredIRWhenFilesExist(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "main.go")
	sourceContents := "package main\nconst Version = \"v1\"\nconst hidden = 1\nvar Build = 2\nvar local = 3\nfunc main() {}\n"
	if err := os.WriteFile(sourcePath, []byte(sourceContents), 0o644); err != nil {
		t.Fatalf("os.WriteFile(source): %v", err)
	}

	result, err := Build(Input{
		EntryFile: sourcePath,
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        dir,
				Files:             []string{sourcePath},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	if !strings.Contains(result.GeneratedFiles[3].Contents, "\"constants\":[{\"name\":\"Version\",\"exported\":true},{\"name\":\"hidden\",\"exported\":false}]") {
		t.Fatalf("expected lowered ir manifest to include const summaries, got: %q", result.GeneratedFiles[3].Contents)
	}
	if !strings.Contains(result.GeneratedFiles[3].Contents, "\"variables\":[{\"name\":\"Build\",\"exported\":true},{\"name\":\"local\",\"exported\":false}]") {
		t.Fatalf("expected lowered ir manifest to include var summaries, got: %q", result.GeneratedFiles[3].Contents)
	}
}

func TestBuildRejectsCompileJobWithoutPackageDir(t *testing.T) {
	_, err := Build(Input{
		EntryFile: "/workspace/main.go",
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				Files:             []string{"/workspace/main.go"},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
		},
	})
	if err == nil || err.Error() != "package directory is required for compile job program-000" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestExecutePathsWritesBackendResult(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "tinygo-backend-input.json")
	resultPath := filepath.Join(dir, "tinygo-backend-result.json")
	inputData, err := json.Marshal(Input{
		EntryFile: "/workspace/main.go",
		CompileJobs: []CompileJob{
			{
				ID:                "program-000",
				Kind:              "program",
				PackageDir:        "/workspace",
				Files:             []string{"/workspace/main.go"},
				BitcodeOutputPath: "/working/tinygo-work/program-000.bc",
				LLVMTarget:        "wasm32-unknown-wasi",
				CFlags:            []string{"-mbulk-memory", "-mnontrapping-fptoint"},
				OptimizeFlag:      "-Oz",
			},
		},
		LinkJob: LinkJob{
			Linker:             "wasm-ld",
			LDFlags:            []string{"--stack-first", "--no-demangle", "--no-entry", "--export-all"},
			ArtifactOutputPath: "/working/out.wasm",
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
	if !reflect.DeepEqual([]string{result.GeneratedFiles[0].Path, result.GeneratedFiles[1].Path, result.GeneratedFiles[2].Path, result.GeneratedFiles[3].Path, result.GeneratedFiles[4].Path, result.GeneratedFiles[5].Path, result.GeneratedFiles[6].Path, result.GeneratedFiles[7].Path}, []string{
		"/working/tinygo-lowered-sources.json",
		"/working/tinygo-lowered-bitcode.json",
		"/working/tinygo-lowered/program-000.c",
		"/working/tinygo-lowered-ir.json",
		"/working/tinygo-lowered-command-batch.json",
		"/working/tinygo-lowered-artifact.json",
		"/working/tinygo-command-artifact.json",
		"/working/tinygo-command-batch.json",
	}) {
		t.Fatalf("unexpected generated files: %#v", result.GeneratedFiles)
	}
}
