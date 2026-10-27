# @wasm-idle/gcc

`@wasm-idle/gcc` runs real GCC in a browser Worker. `createGccWorker` selects
GCC 13.3.0/GNU binutils with `target: 'x86_64-linux-gnu'`, or a separate experimental
GCC 17 Wasm backend with `target: 'wasm32-wasi'`. `createCrossGccWorker` and
`createCrossGccCompiler` retain the GCC 13 x86 API.

Both compiler hosts are `wasm32-emscripten`. The separate output targets produce
x86 assembly/ELF for download, or WAT/Wasm objects/WASI Preview 1 executables.
There is no browser x86 executor; ELF never enters `WebAssembly.compile` or `instantiate`.

This MIT-licensed JavaScript/TypeScript host depends on `@wasm-idle/core` for assets
and archives, and `@bjorn3/browser_wasi_shim` 0.4.2 for execution. It has no LLVM
compiler-package dependency. The producer separately distributes GCC, binutils,
Emscripten modules and GNU sysroots under their own licenses and obligations.

Provide a qualified bundle from `wasm-llvm/producer/gcc-browser` (x86) or
`producer/gcc-wasi` (Wasm). There is no implicit CDN, fallback compiler or bundled
binary. Loading an `unverified` manifest does not qualify its compiler.

## Explicit WebAssembly output

The separate v2 manifest (`kind: gcc-wasm32-wasi`) pins GCC, patched WABT, LLD and
wasi-libc revisions, plus every asset's size and SHA-256. Supply its independently
obtained manifest digest. The existing x86 compiler is unchanged.

```ts
import { createGccWorker } from '@wasm-idle/gcc';

const compiler = await createGccWorker({
	target: 'wasm32-wasi',
	manifestUrl: 'https://your-host/gcc-wasi/gcc-toolchain.v2.json',
	manifestSha256: trustedBuildReceipt.manifestSha256
});
try {
	const compiled = await compiler.compile({
		language: 'c',
		code: '#include <stdio.h>\nint main(void) { int n; if (scanf("%d", &n) != 1) return 1; printf("%d\\n", n + 1); }',
		defines: ['ONLINE_JUDGE=1'],
		emit: 'executable'
	});
	if (compiled.exitCode !== 0) throw new Error(compiled.stderr);
	const executed = await compiler.run(compiled.artifact!, { stdin: '41\n' });
	console.log(executed.stdout); // 42\n, when this producer bundle passes qualification
} finally {
	compiler.dispose();
}
```

`createGccCompiler` provides the same explicit target selector for callers that own
their Worker. `runGccWasiArtifact` can run a linked artifact independently without
loading the compiler. Both low-level APIs run synchronous tool/guest instructions in
their caller's thread. Use `createGccWorker` and its `AbortSignal` or `cancel()` to
interrupt compilation or a nonterminating guest. Cancellation terminates that Worker.

The Wasm pipeline is:

1. GCC `cc1`/`cc1plus`, hosted by Emscripten, emits WAT directly from the original source.
2. The producer's patched WABT `wat2wasm -r --enable-annotations` emits a relocatable
   Wasm object. Stock WABT is not interchangeable with this pinned assembler.
3. LLVM `wasm-ld`, itself hosted as a WASI Preview 1 command, links the object(s),
   `crt1-command.o`, wasi-libc/libm, and the exact runtime archives listed in the manifest.
   LLVM is used for linking; it never receives the user's C/C++ source.
4. The linked module runs with WASI Preview 1 buffered stdin/stdout/stderr. EOF follows
   `stdin`. The runner does not preopen the host filesystem or provide network access.

Every translation unit gets a fresh GCC/assembler instance. `defines` are passed as
actual `-DNAME`/`-DNAME=value` arguments to each front end; source text is not rewritten.
Definitions with preprocessed `.i`/`.ii` input are rejected because GCC would not apply
ordinary preprocessing to that input. Additional `sources` use the existing multi-unit
contract below. The new output kinds are `wasm-object` and `wasm-executable`; assembly
output is a `.wat` file. Each binary artifact includes inspected imports, exports,
linking metadata, memory limits, and `wasm.features.simd128` detected from its actual
instructions and value types. Custom metadata is not required for SIMD detection.

The output uses wasm32, little endian, WASI Preview 1 with an exported memory and `_start`.
Pointers and `long` are 32-bit, unlike the existing Linux x86-64 target. A Wasm object
must have linking metadata; an executable may import only Preview 1 functions. The
loader rejects ELF bytes, unexpected host imports, imported/shared memory, memory64,
implicit Wasm start sections, and executables whose `_start` is not `() -> ()`. Object
memory imports are also checked for shared memory and memory64. The runner inspects
a private byte snapshot and executes that exact compiled module, even if the caller
later mutates the artifact's buffer. SHA-256 pins establish asset identity;
compiler correctness still requires the producer's real native and Chromium tests.

The experimental GCC port is not fully ABI-compatible with the LLVM-built WASI sysroot.
Its `long double` is 64-bit rather than WASI libc's 128-bit; long-double library and
variadic interfaces are unsupported. Producer patch `0004` corrects scalar singleton
aggregate calls. Linking uses `--fatal-warnings` to reject signature mismatches.
This cannot detect mismatched variadic layouts or establish complete ABI compatibility.

The experimental bundle's `capabilities` records C++, libc, libm, libstdc++, and static
initialization availability independently. A bundle without `cpp` rejects C++ requests.
A bundle with `cpp` but without `libstdcxx` can compile core C++ constructs when they do
not require unavailable library support; it does not promise STL or iostream. Global
and function-local static construction/destruction depend on `staticInitialization`
and can be supported independently of libstdc++. The manifest's `qualification.status`
is not upgraded by the SDK.
The GNU runtime recipe excludes the timezone database, C++26 debugger functions, and
the prebuilt `std` modules. Their atomics/signals require unsupported backend/runtime
interfaces. Their use fails at compilation or linking; no fallback implementations are
provided. Basic STL and iostream support must pass the producer's actual runtime
qualification before a bundle advertises `libstdcxx`.

Exceptions, RTTI, threads, dynamic linking and relaxed SIMD are unsupported by this SDK
contract. Requests enabling them fail explicitly. C++ uses `-fno-exceptions -fno-rtti`
and `-fuse-cxa-atexit -fno-threadsafe-statics` to preserve static object destruction
in this single-threaded environment.
The compiler profile also defines `__GCC_WASI_SINGLE_THREAD__=1` for the producer's
ported `errno` header. That header references the existing single-thread WASI libc
storage and rejects `_REENTRANT`; it does not implement TLS or enable threads.
`cpu` can only be `wasm32`; x86 `avx2`/`avx2-fma` profiles do not select Wasm SIMD.
Unsupported target pragmas/attributes are diagnosed by GCC with
`-Werror=pragmas -Werror=attributes`, preserving the original source text. Existing x86
pragmas, intrinsic headers, libm and libstdc++ behavior remain under the x86 bundle.

Wasm SIMD requires both a producer bundle with `capabilities.simd: true` and an explicit
`simd: true` compile request. The SDK probes real `v128` support in the current Wasm
engine before passing `-msimd128` to GCC. A capable bundle defaults to `-mno-simd128`;
legacy manifests with `simd: false` retain their original compiler arguments. An object
or executable containing SIMD without the requested opt-in is rejected.
The experimental backend profile targets GNU `__attribute__((vector_size(16)))` vectors
with i8x16, i16x8, i32x4, i64x2, f32x4 and f64x2 lanes. Producer patch `0006` adds scalar-count
shifts, comparisons, conditional selection and constant shuffles. Patch `0007` enables
direct `v128` calls and singleton vector aggregates, qualified against pinned Clang
with SIMD enabled on both sides. Disabled profiles retain indirect vector calls.
Check the bundle's pinned patches and native/browser qualification; older SIMD bundles
have fewer operations. Automatic vectorization, `wasm_simd128.h`, relaxed SIMD and
arbitrary external object inputs are not promised.

`run()` accepts `stdin`, `args`, `env` and `maxOutputBytes` (four MiB by default, combined
stdout/stderr), and returns the exit code, output, runtime and final linear-memory
capacity. File I/O requiring a preopened directory, threads and dynamic linking are not
provided by this runner. Traps remain errors, and failed compilation never yields an
artifact to execute.

## Existing GCC 13 x86 API

```ts
import { createCrossGccWorker } from '@wasm-idle/gcc';

const controller = new AbortController();
const compiler = await createCrossGccWorker({
	manifestUrl: 'https://your-host/gcc/gcc-toolchain.v1.json',
	manifestSha256: trustedBuildReceipt.manifestSha256,
	signal: controller.signal
});
try {
	const result = await compiler.compile(
		{
			code: '#include <bits/stdc++.h>\nint main() { int n; std::cin >> n; std::cout << n + 1; }',
			language: 'cpp',
			cpu: 'x86-64',
			optimization: '2',
			emit: 'executable'
		},
		{ signal: controller.signal }
	);
	if (result.exitCode !== 0) throw new Error(result.stderr);
	const url = URL.createObjectURL(new Blob([result.artifact!.bytes]));
	// Assign url and result.artifact.fileName to an <a href download>.
	// Revoke this URL when the download is replaced or the view is disposed.
} finally {
	compiler.dispose();
}
```

`controller.abort()` or `compiler.cancel()` terminates the dedicated Worker, including
a synchronous compiler invocation. A cancelled Worker cannot be reused. The low-level
`createCrossGccCompiler` API runs in its caller's thread and is intended for hosts which
already own a Worker; terminating that Worker is the cancellation mechanism.

## Supported compilation contract

One request compiles its primary `code` as C or C++, with optional local header/data files
under `/workspace`. For executable output, `sources` explicitly selects additional files
to compile as separate translation units and link in the listed order. Every unit uses
the request's language, standard, CPU, optimization and preprocessing settings. Source
text reaches the GNU front end unchanged. GCC's `target` and
`optimize` pragmas, `push_options`/`pop_options`, PBDS, intrinsic headers and exception
handling are implemented by the actual compiler and GNU headers, not by a JavaScript
compatibility layer. Their availability must be confirmed by the real producer suite.

The front ends use `-nostdinc` plus explicit GNU C, C++, GCC internal and glibc include
directories from the pinned sysroot. C++ also gets the GNU driver's `_GNU_SOURCE` define
and exception support. GCC emits assembly, GNU `as --64` emits an ELF object, and GNU
`ld -static` receives the GNU CRT, libstdc++ (C++), libm (C and C++), libgcc, libgcc_eh and
glibc in their required order. Each stage uses a fresh module and MEMFS to reset GCC
global state. The JavaScript Worker orchestrates these stages without `fork` or `exec`.

| Request field  | Supported values                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| `language`     | `c`, `cpp` (default)                                                                                          |
| `cpu`          | `x86-64` (baseline default), `avx2` (`-mavx2 -mno-fma`), `avx2-fma` (`-mavx2 -mfma`); all use `-march=x86-64` |
| `emit`         | `assembly`, `object`, `executable` (static default)                                                           |
| `optimization` | `0`, `1`, `2` (default), `3`, `s`                                                                             |
| `standard`     | C99/C11/C17/C2x or C++11/14/17/20/23, including GNU dialects; defaults `gnu17`/`gnu++20`                      |
| `preprocessed` | `true` for `.i`/`.ii` plus `-fpreprocessed`; ordinary source is the default                                   |
| `files`        | Up to 1,024 relative local files; 16 MiB total source and file contents                                       |
| `sources`      | Up to 63 additional translation unit paths from `files`; executable output only                               |
| `defines`      | Up to 256 object-like macro definitions, e.g. `ONLINE_JUDGE=1`, passed directly as GCC `-D` options           |

```ts
const result = await compiler.compile({
	code: '#include "math.h"\nint main() { return twice(21) == 42 ? 0 : 1; }',
	language: 'cpp',
	files: [
		{ path: 'math.h', contents: 'int twice(int value);' },
		{
			path: 'math.cpp',
			contents: '#include "math.h"\nint twice(int value) { return value * 2; }'
		}
	],
	sources: ['math.cpp']
});
```

Only paths listed in `sources` are compiled in addition to `code`; an unlisted `.cpp`
in `files` remains an ordinary workspace file. Each translation unit gets a fresh front
end and assembler, so file-local symbols and macros remain independent. The static
linker receives all objects after every unit succeeds. Any failing stage stops the request
without an artifact. Missing/duplicate source paths and intermediate-output collisions
are rejected before compilation. Additional outputs reserve `program.N.s` and
`program.N.o` in the workspace, where N starts at 1. Multiple-unit assembly/object output
is rejected; use separate requests to obtain those individual artifacts.

No `-march=native`, arbitrary driver arguments, PCH, plugin, LTO, shared/dynamic linking,
OpenMP or process spawning is supported. The option
allowlist rejects unknown request fields. A CPU profile describes the generated program's
requirements; it does not detect the browser host CPU. Source pragmas can enable additional
instructions, just as with native GCC. Choose execution hardware accordingly.

`avx2` enables AVX2 without enabling FMA instructions or FMA contraction of multiply-add
expressions. Use `avx2-fma` when FMA is intended and supported by the execution host.
The producer v1 manifest still lists `['x86-64', 'avx2-fma']`: the consumer derives the
AVX2-only request as a subset of that existing capability, without changing the manifest
or its integrity digest. `artifact.cpu` records the requested profile, including `avx2`.
Source target pragmas and attributes can override the requested CPU settings.

The compiler's GMP/MPFR/MPC and Emscripten libraries are **host** dependencies in Wasm.
The GNU sysroot's glibc, libstdc++, libgcc and CRT are **target** ELF files; they are only
read by the compiler/linker. Source revisions, file hashes and licenses belong to the
producer bundle's provenance files. The common sysroot contract is shared with the
Clang cross compiler, with GCC's own internal headers added by the GCC producer.

## Integrity, state and measurements

The manifest's exact bytes are pinned before parsing. Every JavaScript loader, Wasm
module and sysroot archive is size bounded and SHA-256 verified before any loader import.
The browser imports verified loader bytes through Blob URLs and instantiates the verified
Wasm modules. Hosting CSP must permit module Workers and `blob:` modules. Relative asset
paths are fixed by the manifest schema; archive paths cannot escape `/sysroot`.
The runtime's downloaded-byte cache is scoped to each compiler initialization, even
with a shared custom `fetchImpl`. Retrying after an integrity failure or supplying a
new manifest digest at the same URL fetches and verifies the bundle again.

Compilation has no result cache. Compiled Wasm modules are retained only in the current
compiler instance, whose identity contains the manifest digest, GCC version, host, target
and sysroot digest. A consumer adding its own result cache must also key source/files,
the ordered additional `sources` list,
language/standard, preprocessing, macro definitions, output kind, optimization and CPU profile. Failed
compilations never return an artifact from an earlier request. The connected example
removes the previous download at the start of every compile.

Each result includes all stage argument vectors, exit codes, elapsed milliseconds and
peak linear-memory capacity. Emscripten memory only grows, so its final capacity is the
stage's linear-memory maximum. This metric excludes JavaScript and MEMFS allocations;
it is not total browser process RSS. ELF validation checks ELF64, little endian, x86-64,
the requested output kind and, for executables, loadable segments without an interpreter.

## Seeded API contract fuzzing

`pnpm run fuzz:gcc-contract` runs 10,000 deterministic cases against the actual manifest
parser, request planner, path checks and asset-integrity loader. It covers option/profile
combinations, source-byte preservation, copied file buffers, traversal and file/directory
collisions, reserved outputs, malformed manifests, size/UTF-8 boundaries and corrupted
manifest/asset bytes. It uses inert download bytes and does **not** execute GCC or establish
compiler correctness. This is seeded property fuzzing, not coverage-guided fuzzing.

```sh
pnpm run fuzz:gcc-contract --seed 20261024 --iterations 50000 --out .cache/gcc-contract-fuzz
# A failure reports the seed, zero-based case index, input payload and this replay command:
pnpm run fuzz:gcc-contract --seed 20261024 --case 1234 --out .cache/gcc-contract-replay
```

Each case has an independently derived RNG, so replay does not need preceding cases.
The output directory must be new; the default uses a timestamp and PID to preserve evidence.
The first cases always exercise resource boundaries; subsequent cases mutate generated
valid inputs. `report.json` records source identity, seed, coverage groups, elapsed time and
the first failure. PR/main CI uses a fixed seed; scheduled CI uses its run number as the
seed. Both save the report even on failure. Keep this report separate from real GCC fuzzing
and qualification reports.

For generated programs executed by actual Wasm GCC, use `pnpm run fuzz:gcc-browser`
with the producer's immutable corpus and pinned bundle. See
[Chromium corpus replay](../../scripts/GCC_FUZZ.md) for commands, evidence and limits.

## Connected example and qualification

From the repository root, run:

```sh
pnpm exec vite --config examples/gcc-cross/vite.config.mjs
```

Open `/examples/gcc-cross/`, enter the hosted producer manifest URL and its trusted SHA-256,
then compile and download. The form explicitly selects GCC and provides CPU/output controls,
compiler diagnostics, per-stage measurements and cancellation. Serve the bundle with CORS
headers if it is on another origin. For a local setup, put the bundle in the example server's
`.cache/gcc-bundle/` directory and use `/.cache/gcc-bundle/gcc-toolchain.v1.json` with the
server's HTTP origin. This is an opt-in example and does not change the main playground's
existing Clang Run path.

Build the shared core and GCC host before running the following checks. The real
Chromium qualification loads their emitted package modules and Worker entry.

```sh
pnpm --dir packages/core build
pnpm --dir packages/gcc build

# Synthetic transport/filesystem/integrity tests; these are NOT evidence of a GCC port.
pnpm --dir packages/gcc test

# Required synthetic Chromium contract CI job (separate from Node-only workspace tests).
pnpm exec playwright-core install chromium
pnpm run test:browser:gcc-worker-contract

# Actual Wasm GCC in Chromium, then known baseline ELF programs run by Linux x86-64.
node scripts/verify-x86-cross-gcc.mjs \
  /path/to/gcc-toolchain.v1.json \
  /path/to/wasm-llvm/producer/gcc-browser/qualification \
  /path/to/new-results-directory

# Focused C/C++ multi-source suite: separate units, nested headers, failures and recovery.
node scripts/verify-x86-cross-gcc.mjs \
  /path/to/gcc-toolchain.v1.json \
  packages/gcc/test/multiple-sources \
  /path/to/new-multiple-source-results-directory

# Focused consumer CPU-profile regression suite using the same real Chromium Worker.
# Checks C/C++ feature macros, AVX2 integer SIMD, vectorization and FMA separation.
node scripts/verify-x86-cross-gcc.mjs \
  /path/to/gcc-toolchain.v1.json \
  packages/gcc/test/cpu-profiles \
  /path/to/new-cpu-profile-results-directory
```

The real acceptance path exercises `.ii`, ordinary C/C++, `bits/stdc++.h`, PBDS order
statistics, exception unwinding, dynamic-input AVX2/FMA and GCC pragma push/pop behavior,
assembly/disassembly checks, Worker cancellation, failed-output isolation and native
stdin/stdout. It records manifest, suite and output identities with stage measurements.
Keep its real-build report separate from the synthetic fixture test report.
