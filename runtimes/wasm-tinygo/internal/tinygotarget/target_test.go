package tinygotarget

import "testing"

func TestResolveDefaultsToWasmProfile(t *testing.T) {
	profile, err := Resolve("")
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if profile.Name != "wasm" {
		t.Fatalf("unexpected default profile: %q", profile.Name)
	}
	if profile.GOOS != "js" {
		t.Fatalf("unexpected default GOOS: %q", profile.GOOS)
	}
}

func TestResolveSupportsWasmFamilyTargets(t *testing.T) {
	testCases := []struct {
		name               string
		target             string
		wantGOOS           string
		wantGOARCH         string
		wantTriple         string
		wantLibC           string
		wantRTLib          string
		wantCPU            string
		wantFeatures       string
		wantDefaultStack   int
		wantFirstExtraFile string
	}{
		{
			name:               "wasm",
			target:             "wasm",
			wantGOOS:           "js",
			wantGOARCH:         "wasm",
			wantTriple:         "wasm32-unknown-wasi",
			wantLibC:           "wasi-libc",
			wantRTLib:          "compiler-rt",
			wantCPU:            "generic",
			wantFeatures:       "+bulk-memory,+bulk-memory-opt,+call-indirect-overlong,+mutable-globals,+nontrapping-fptoint,+sign-ext,-multivalue,-reference-types",
			wantDefaultStack:   65536,
			wantFirstExtraFile: "src/runtime/asm_tinygowasm.S",
		},
		{
			name:               "wasip1",
			target:             "wasip1",
			wantGOOS:           "wasip1",
			wantGOARCH:         "wasm",
			wantTriple:         "wasm32-unknown-wasi",
			wantLibC:           "wasi-libc",
			wantRTLib:          "compiler-rt",
			wantCPU:            "generic",
			wantFeatures:       "+bulk-memory,+bulk-memory-opt,+call-indirect-overlong,+mutable-globals,+nontrapping-fptoint,+sign-ext,-multivalue,-reference-types",
			wantDefaultStack:   65536,
			wantFirstExtraFile: "src/runtime/asm_tinygowasm.S",
		},
		{
			name:               "wasip2",
			target:             "wasip2",
			wantGOOS:           "linux",
			wantGOARCH:         "arm",
			wantTriple:         "wasm32-unknown-wasi",
			wantLibC:           "wasmbuiltins",
			wantRTLib:          "compiler-rt",
			wantCPU:            "generic",
			wantFeatures:       "+bulk-memory,+bulk-memory-opt,+call-indirect-overlong,+mutable-globals,+nontrapping-fptoint,+sign-ext,-multivalue,-reference-types",
			wantDefaultStack:   65536,
			wantFirstExtraFile: "src/runtime/asm_tinygowasm.S",
		},
		{
			name:               "wasip3",
			target:             "wasip3",
			wantGOOS:           "linux",
			wantGOARCH:         "arm",
			wantTriple:         "wasm32-unknown-wasi",
			wantLibC:           "wasmbuiltins",
			wantRTLib:          "compiler-rt",
			wantCPU:            "generic",
			wantFeatures:       "+bulk-memory,+bulk-memory-opt,+call-indirect-overlong,+mutable-globals,+nontrapping-fptoint,+sign-ext,-multivalue,-reference-types",
			wantDefaultStack:   65536,
			wantFirstExtraFile: "src/runtime/asm_tinygowasm.S",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			profile, err := Resolve(tc.target)
			if err != nil {
				t.Fatalf("Resolve returned error: %v", err)
			}
			if profile.GOOS != tc.wantGOOS {
				t.Fatalf("unexpected GOOS: got %q want %q", profile.GOOS, tc.wantGOOS)
			}
			if profile.LLVMTarget != tc.wantTriple {
				t.Fatalf("unexpected LLVM target: got %q want %q", profile.LLVMTarget, tc.wantTriple)
			}
			if profile.GOARCH != tc.wantGOARCH {
				t.Fatalf("unexpected GOARCH: got %q want %q", profile.GOARCH, tc.wantGOARCH)
			}
			if profile.GC != "precise" {
				t.Fatalf("unexpected GC: %q", profile.GC)
			}
			if profile.Scheduler != "asyncify" {
				t.Fatalf("unexpected scheduler: %q", profile.Scheduler)
			}
			if profile.LibC != tc.wantLibC {
				t.Fatalf("unexpected libc: got %q want %q", profile.LibC, tc.wantLibC)
			}
			if profile.RTLib != tc.wantRTLib {
				t.Fatalf("unexpected rtlib: got %q want %q", profile.RTLib, tc.wantRTLib)
			}
			if profile.CPU != tc.wantCPU {
				t.Fatalf("unexpected cpu: got %q want %q", profile.CPU, tc.wantCPU)
			}
			if profile.Features != tc.wantFeatures {
				t.Fatalf("unexpected features: got %q want %q", profile.Features, tc.wantFeatures)
			}
			if profile.DefaultStackSize != tc.wantDefaultStack {
				t.Fatalf("unexpected default stack size: got %d want %d", profile.DefaultStackSize, tc.wantDefaultStack)
			}
			if len(profile.BuildTags) == 0 {
				t.Fatalf("expected non-empty build tags")
			}
			if len(profile.ExtraFiles) == 0 {
				t.Fatalf("expected non-empty extra files")
			}
			if profile.ExtraFiles[0] != tc.wantFirstExtraFile {
				t.Fatalf("unexpected first extra file: got %q want %q", profile.ExtraFiles[0], tc.wantFirstExtraFile)
			}
		})
	}
}

func TestResolveAddsWasipPreviewBuildTags(t *testing.T) {
	for _, target := range []string{"wasip2", "wasip3"} {
		t.Run(target, func(t *testing.T) {
			profile, err := Resolve(target)
			if err != nil {
				t.Fatalf("Resolve returned error: %v", err)
			}
			tags := profile.BuildTagsFor("")
			found := false
			for _, tag := range tags {
				if tag == target {
					found = true
					break
				}
			}
			if !found {
				t.Fatalf("expected build tag %q in %#v", target, tags)
			}
		})
	}
}

func TestResolveRejectsUnsupportedTarget(t *testing.T) {
	if _, err := Resolve("avr"); err == nil {
		t.Fatalf("expected unsupported target error")
	}
}

func TestFilterLDFlagsDropsRootDependentFlags(t *testing.T) {
	profile, err := Resolve("wasm")
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	flags := profile.LinkerFlags()
	for _, flag := range flags {
		if flag == "--allow-undefined-file={root}/targets/wasm-undefined.txt" {
			t.Fatalf("expected filtered ldflags to drop root-dependent entries")
		}
	}
	if len(flags) == 0 {
		t.Fatalf("expected retained ldflags")
	}
}
