package tinygoroot

import "testing"

func TestFilesIncludeBootstrapTinyGoRootAssets(t *testing.T) {
	files := Files()
	if len(files) == 0 {
		t.Fatalf("expected bootstrap TinyGo root assets")
	}

	paths := map[string]string{}
	for _, file := range files {
		paths[file.Path] = file.Contents
	}

	required := []string{
		RootDir + "/targets/wasm.json",
		RootDir + "/targets/wasip1.json",
		RootDir + "/targets/wasip2.json",
		RootDir + "/targets/wasip3.json",
		RootDir + "/targets/wasm-undefined.txt",
		RootDir + "/src/runtime/internal/sys/zversion.go",
		RootDir + "/src/device/arm/arm.go",
		RootDir + "/src/errors/errors.go",
		RootDir + "/src/fmt/print.go",
		RootDir + "/src/io/io.go",
		RootDir + "/src/runtime/runtime.go",
		RootDir + "/src/unsafe/unsafe.go",
	}
	for _, path := range required {
		if _, ok := paths[path]; !ok {
			t.Fatalf("missing bootstrap asset: %s", path)
		}
	}
}

func TestTargetSourceReturnsJSONForSupportedTargets(t *testing.T) {
	wasmSource, ok := TargetSource("wasm")
	if !ok {
		t.Fatalf("expected wasm target source")
	}
	if wasmSource == "" {
		t.Fatalf("expected non-empty wasm target source")
	}

	for _, target := range []string{"wasip1", "wasip2", "wasip3"} {
		source, ok := TargetSource(target)
		if !ok {
			t.Fatalf("expected %s target source", target)
		}
		if source == "" {
			t.Fatalf("expected non-empty %s target source", target)
		}
	}

	if _, ok := TargetSource("avr"); ok {
		t.Fatalf("did not expect unsupported target source")
	}
}
