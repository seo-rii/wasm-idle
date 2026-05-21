package tinygoroot

type File struct {
	Path     string
	Contents string
}

const RootDir = "/working/.tinygo-root"

const wasmTargetSource = `{
	"llvm-target":   "wasm32-unknown-wasi",
	"cpu":           "generic",
	"features":      "+bulk-memory,+bulk-memory-opt,+call-indirect-overlong,+mutable-globals,+nontrapping-fptoint,+sign-ext,-multivalue,-reference-types",
	"build-tags":    ["tinygo.wasm"],
	"goos":          "js",
	"goarch":        "wasm",
	"linker":        "wasm-ld",
	"libc":          "wasi-libc",
	"rtlib":         "compiler-rt",
	"gc":            "precise",
	"scheduler":     "asyncify",
	"default-stack-size": 65536,
	"cflags": [
		"-mbulk-memory",
		"-mnontrapping-fptoint",
		"-mno-multivalue",
		"-mno-reference-types",
		"-msign-ext"
	],
	"ldflags": [
		"--allow-undefined-file={root}/targets/wasm-undefined.txt",
		"--stack-first",
		"--no-demangle"
	],
	"extra-files": [
		"src/runtime/asm_tinygowasm.S",
		"src/runtime/gc_boehm.c"
	],
	"emulator":      "node {root}/targets/wasm_exec.js {}"
}
`

const wasip1TargetSource = `{
	"llvm-target":   "wasm32-unknown-wasi",
	"cpu":           "generic",
	"features":      "+bulk-memory,+bulk-memory-opt,+call-indirect-overlong,+mutable-globals,+nontrapping-fptoint,+sign-ext,-multivalue,-reference-types",
	"build-tags":    ["tinygo.wasm"],
	"goos":          "wasip1",
	"goarch":        "wasm",
	"linker":        "wasm-ld",
	"libc":          "wasi-libc",
	"rtlib":         "compiler-rt",
	"gc":            "precise",
	"scheduler":     "asyncify",
	"default-stack-size": 65536,
	"cflags": [
		"-mbulk-memory",
		"-mnontrapping-fptoint",
		"-mno-multivalue",
		"-mno-reference-types",
		"-msign-ext"
	],
	"ldflags": [
		"--stack-first",
		"--no-demangle"
	],
	"extra-files": [
		"src/runtime/asm_tinygowasm.S",
		"src/runtime/gc_boehm.c"
	],
	"emulator":      "wasmtime run --dir={tmpDir}::/tmp {}"
}
`

const wasip2TargetSource = `{
	"llvm-target":   "wasm32-unknown-wasi",
	"cpu":           "generic",
	"features":      "+bulk-memory,+bulk-memory-opt,+call-indirect-overlong,+mutable-globals,+nontrapping-fptoint,+sign-ext,-multivalue,-reference-types",
	"build-tags":    ["tinygo.wasm", "wasip2"],
	"buildmode":     "c-shared",
	"goos":          "linux",
	"goarch":        "arm",
	"linker":        "wasm-ld",
	"libc":          "wasmbuiltins",
	"rtlib":         "compiler-rt",
	"gc":            "precise",
	"scheduler":     "asyncify",
	"default-stack-size": 65536,
	"cflags": [
		"-mbulk-memory",
		"-mnontrapping-fptoint",
		"-mno-multivalue",
		"-mno-reference-types",
		"-msign-ext"
	],
	"ldflags": [
		"--stack-first",
		"--no-demangle",
		"--no-entry"
	],
	"extra-files": [
		"src/runtime/asm_tinygowasm.S"
	],
	"emulator": "wasmtime run --wasm component-model -Sinherit-network -Sallow-ip-name-lookup --dir={tmpDir}::/tmp {}",
	"wit-package": "{root}/lib/wasi-cli/wit/",
	"wit-world": "wasi:cli/command"
}
`

const wasip3TargetSource = `{
	"llvm-target":   "wasm32-unknown-wasi",
	"cpu":           "generic",
	"features":      "+bulk-memory,+bulk-memory-opt,+call-indirect-overlong,+mutable-globals,+nontrapping-fptoint,+sign-ext,-multivalue,-reference-types",
	"build-tags":    ["tinygo.wasm", "wasip3"],
	"buildmode":     "c-shared",
	"goos":          "linux",
	"goarch":        "arm",
	"linker":        "wasm-ld",
	"libc":          "wasmbuiltins",
	"rtlib":         "compiler-rt",
	"gc":            "precise",
	"scheduler":     "asyncify",
	"default-stack-size": 65536,
	"cflags": [
		"-mbulk-memory",
		"-mnontrapping-fptoint",
		"-mno-multivalue",
		"-mno-reference-types",
		"-msign-ext"
	],
	"ldflags": [
		"--stack-first",
		"--no-demangle",
		"--no-entry"
	],
	"extra-files": [
		"src/runtime/asm_tinygowasm.S"
	],
	"emulator": "wasmtime run --wasm component-model -Sinherit-network -Sallow-ip-name-lookup --dir={tmpDir}::/tmp {}",
	"wit-package": "{root}/lib/wasi-cli/wit/",
	"wit-world": "wasi:cli/command"
}
`

const wasmUndefinedSource = `syscall/js.copyBytesToGo
syscall/js.copyBytesToJS
syscall/js.finalizeRef
syscall/js.stringVal
syscall/js.valueCall
syscall/js.valueDelete
syscall/js.valueGet
syscall/js.valueIndex
syscall/js.valueInstanceOf
syscall/js.valueInvoke
syscall/js.valueLength
syscall/js.valueLoadString
syscall/js.valueNew
syscall/js.valuePrepareString
syscall/js.valueSet
syscall/js.valueSetIndex
`

const versionSource = "package sys\n\nconst TheVersion = `go0.1.0`\n"

const armSource = "package arm\n"

const errorsSource = "package errors\n"

const fmtPrintSource = "package fmt\n\nfunc Println(args ...any) {}\n"

const ioSource = "package io\n"

const runtimeSource = "package runtime\n"

const unsafeSource = "package unsafe\n"

const asmTinyGoWasmSource = "// placeholder bootstrap runtime asset for future TinyGo integration\n"

const gcBoehmSource = "/* placeholder bootstrap runtime asset for future TinyGo integration */\n"

var files = []File{
	{
		Path:     RootDir + "/targets/wasm.json",
		Contents: wasmTargetSource,
	},
	{
		Path:     RootDir + "/targets/wasip1.json",
		Contents: wasip1TargetSource,
	},
	{
		Path:     RootDir + "/targets/wasip2.json",
		Contents: wasip2TargetSource,
	},
	{
		Path:     RootDir + "/targets/wasip3.json",
		Contents: wasip3TargetSource,
	},
	{
		Path:     RootDir + "/targets/wasm-undefined.txt",
		Contents: wasmUndefinedSource,
	},
	{
		Path:     RootDir + "/src/runtime/internal/sys/zversion.go",
		Contents: versionSource,
	},
	{
		Path:     RootDir + "/src/device/arm/arm.go",
		Contents: armSource,
	},
	{
		Path:     RootDir + "/src/errors/errors.go",
		Contents: errorsSource,
	},
	{
		Path:     RootDir + "/src/fmt/print.go",
		Contents: fmtPrintSource,
	},
	{
		Path:     RootDir + "/src/io/io.go",
		Contents: ioSource,
	},
	{
		Path:     RootDir + "/src/runtime/runtime.go",
		Contents: runtimeSource,
	},
	{
		Path:     RootDir + "/src/unsafe/unsafe.go",
		Contents: unsafeSource,
	},
	{
		Path:     RootDir + "/src/runtime/asm_tinygowasm.S",
		Contents: asmTinyGoWasmSource,
	},
	{
		Path:     RootDir + "/src/runtime/gc_boehm.c",
		Contents: gcBoehmSource,
	},
}

var targetSources = map[string]string{
	"wasm":   wasmTargetSource,
	"wasip1": wasip1TargetSource,
	"wasip2": wasip2TargetSource,
	"wasip3": wasip3TargetSource,
}

func Files() []File {
	assets := make([]File, 0, len(files))
	for _, file := range files {
		assets = append(assets, File{
			Path:     file.Path,
			Contents: file.Contents,
		})
	}
	return assets
}

func TargetSource(target string) (string, bool) {
	contents, ok := targetSources[target]
	return contents, ok
}
