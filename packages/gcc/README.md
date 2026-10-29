# @wasm-idle/gcc

`@wasm-idle/gcc` runs real GCC in a browser Worker. `createGccWorker` selects
GCC 13.3.0 or 16.2.0/GNU binutils with `target: 'x86_64-linux-gnu'`, or a separate experimental
GCC 17 Wasm backend with `target: 'wasm32-wasi'`. `createCrossGccWorker` and
`createCrossGccCompiler` retain the x86 API.

Both compiler hosts are `wasm32-emscripten`. The separate output targets produce
x86 assembly/ELF for download, or WAT/Wasm objects/WASI Preview 1 executables.
There is no browser x86 executor; ELF never enters `WebAssembly.compile` or `instantiate`.

This MIT-licensed JavaScript/TypeScript host depends on `@wasm-idle/core` for assets
and archives, and `@bjorn3/browser_wasi_shim` 0.4.2 for execution. It has no LLVM
compiler-package dependency. The producer separately distributes GCC, binutils,
Emscripten modules and GNU sysroots under their own licenses and obligations.

Provide a qualified bundle from `wasm-llvm/producer/gcc-browser` (x86) or
`producer/gcc-wasi` (Wasm). There is no implicit CDN, fallback compiler or bundled
binary. V1 requires matching compiler, GNU library and include versions: GCC 13.3.0/13
or 16.2.0/16. Loading an `unverified` manifest does not qualify its compiler.

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

`createGccCompiler` selects the target in a caller-owned Worker. `runGccWasiArtifact`
runs a linked artifact without loading GCC. Tool/guest instructions run
synchronously in the caller's thread. To interrupt compilation or a guest, use
`createGccWorker`: its `AbortSignal` or `cancel()` terminates the Worker.

The Wasm pipeline is:

1. Emscripten-hosted GCC `cc1`/`cc1plus` emits WAT from the original source.
2. Pinned, patched WABT `wat2wasm -r --enable-annotations` emits a relocatable Wasm
   object. Stock WABT cannot replace it.
3. WASI-hosted LLVM `wasm-ld` links the objects, `crt1-command.o`, wasi-libc/libm and
   manifest-listed runtime archives. LLVM never receives the user's C/C++ source.
4. WASI Preview 1 executes with buffered stdin/stdout/stderr and EOF after `stdin`.
   The runner provides no filesystem preopens or network access.

Each unit gets fresh GCC/assembler instances and real `-DNAME`/`-DNAME=value`
arguments from `defines`. Source is unchanged; definitions with preprocessed
`.i`/`.ii` input are rejected. Additional `sources` follow the multi-unit contract
below. Artifacts are `wasm-object`, `wasm-executable`, or `.wat` assembly. Binary
metadata includes imports, exports, linking information, memory limits and
`wasm.features.simd128`, detected from instructions/types without custom metadata.

The target is little-endian wasm32/WASI Preview 1: pointers and `long` are 32-bit,
unlike x86-64. Objects require linking metadata. Executables export memory and
`_start: () -> ()` and may import only Preview 1 functions. The loader rejects ELF,
unexpected imports, imported/shared memory, memory64 and implicit start sections;
object memory imports also reject shared memory/memory64. Execution uses the exact
private byte snapshot inspected, protecting against later caller mutations.
Digests establish asset identity; native and Chromium tests qualify the compiler.

`capabilities.longDouble` identifies bundles qualified for IEEE binary128, including
WASI math and formatted I/O. The SDK links their `libc-printscan-long-double.a`
before libc. Older manifests default to `false`: their 64-bit `long double` is
incompatible with WASI long-double library and variadic interfaces. Linking uses
`--fatal-warnings`; execution tests are also needed to detect variadic ABI errors.

The optional `capabilities.int128` flag is for producer-qualified signed/unsigned
`__int128` operations and ABI. It defaults to `false` and adds no compile option
or link override. Native and Worker execution must qualify a bundle before it
advertises this capability.

Bundle `capabilities` separately records `cpp`, `libc`, `libm`, `libstdcxx` and
`staticInitialization`. Without `cpp`, C++ requests fail; without `libstdcxx`, only
constructs not requiring that library can compile. Global/function-local static
construction and destruction require `staticInitialization` independently of
libstdc++. The SDK preserves `qualification.status`.
The GNU runtime excludes timezone databases, C++26 debugger functions and prebuilt
`std` modules: their atomics/signals need unsupported interfaces, so use fails at
compile/link time. Advertising `libstdcxx` requires real STL/iostream qualification.

Requests for exceptions, RTTI, threads, dynamic linking or relaxed SIMD fail.
C++ uses `-fno-exceptions -fno-rtti -fuse-cxa-atexit -fno-threadsafe-statics`,
preserving static destruction in this single-threaded environment.
`__GCC_WASI_SINGLE_THREAD__=1` selects the producer's `errno` header, which uses
single-thread WASI libc storage and rejects `_REENTRANT`; it provides no TLS.
`cpu` must be `wasm32`; x86 `avx2`/`avx2-fma` do not select Wasm SIMD. GCC diagnoses
unsupported target pragmas/attributes with `-Werror=pragmas -Werror=attributes`.
The separate x86 bundle retains its pragmas, intrinsics, libm and libstdc++.

SIMD requires `capabilities.simd: true`, a `simd: true` request and a successful
engine `v128` probe before GCC receives `-msimd128`. Capable bundles default to
`-mno-simd128`; legacy `simd: false` manifests retain their arguments. SIMD artifacts
without opt-in are rejected.
GNU `__attribute__((vector_size(16)))` supports i8x16/i16x8/i32x4/i64x2/f32x4/f64x2.
Patch `0006` adds scalar-count shifts, comparisons, selection and constant shuffles.
Patch `0007` adds direct `v128` calls and singleton vector aggregates, qualified
against pinned Clang with SIMD enabled on both sides. Disabled profiles use indirect
calls. Check pinned patches and native/browser results: older bundles support
fewer operations. Automatic vectorization, `wasm_simd128.h`, relaxed SIMD and
arbitrary external objects are not promised.

`run()` accepts `stdin`, `args`, `env` and `maxOutputBytes` (default: four MiB combined
stdout/stderr), returning exit code, output, runtime and final linear-memory
capacity. It supplies no directory preopens, threads or dynamic linking.
Traps are errors; failed compilation yields no executable artifact.

## Existing x86 API

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

`controller.abort()` or `compiler.cancel()` terminates the Worker even during a
synchronous compilation; it cannot be reused. `createCrossGccCompiler` runs in its
caller's thread: use and terminate your own Worker to cancel it.

## Supported compilation contract

An x86 request compiles `code` as C/C++, with headers/data under `/workspace`.
For executables, `sources` selects further units, linked in listed order. All use
the request's language, standard, CPU, optimization and preprocessing settings.
GCC receives unchanged source. Its `target`/`optimize` pragmas, push/pop options,
PBDS, intrinsics and exceptions use real GNU implementation and qualification.

Front ends use `-nostdinc` and pinned GNU C/C++/GCC/glibc include directories;
C++ also gets `_GNU_SOURCE` and exceptions. GCC emits assembly, GNU `as --64`
assembles ELF, and `ld -static` links CRT, libstdc++ (C++), libm (both languages),
libgcc, libgcc_eh and glibc in the required order. Fresh modules/MEMFS reset state;
Emscripten stages mount the verified sysroot read-only and share its extracted bytes.
The WASI-hosted linker retains its existing verified file map. The Worker
orchestrates the stages without `fork`/`exec`.

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

Only `sources` entries compile alongside `code`; other `.cpp` files remain data.
Fresh front ends/assemblers isolate each unit's local symbols and macros. Linking
starts after all units succeed; any failed stage yields no artifact. Missing or
duplicate paths and output collisions fail before compilation. Additional outputs
reserve `program.N.s`/`program.N.o` (N ≥ 1). Multiple-unit assembly/object output
is rejected; request those artifacts separately.

No `-march=native`, arbitrary driver arguments, user-supplied PCH files, plugin, LTO,
shared/dynamic linking, OpenMP or process spawning is supported. The option
allowlist rejects unknown request fields. A CPU profile describes the generated program's
requirements; it does not detect the browser host CPU. Source pragmas can enable additional
instructions, just as with native GCC. Choose execution hardware accordingly.

`avx2` disables FMA instructions and contraction; select `avx2-fma` for FMA-capable
execution hosts. The consumer derives AVX2-only support from the v1 manifest's
`['x86-64', 'avx2-fma']` without changing its bytes/digest. `artifact.cpu` records
the request, including `avx2`; source target pragmas/attributes can override it.

### Precompiled `bits/stdc++.h`

Parsing GNU `bits/stdc++.h` takes most of a typical C++ compilation. When
`manifest.capabilities.precompiledHeaders` is true, `precompileHeader()` lets the real
`cc1plus` precompile that header for one C++ profile (`standard`, `optimization` and `cpu`,
with the same defaults as `compile()`):

```ts
await compiler.precompileHeader({ optimization: '2' }); // About 7 s and 100 MB, once.
const result = await compiler.compile({ code: '#include <bits/stdc++.h>\n...' });
```

The compiler retains one PCH and replaces it on the next call. Later C++ units whose
front-end flags are identical get `-isystem /pch` first on their include path, as the
stage `argv` shows. GCC itself decides whether to load it: a PCH is used only when
`#include <bits/stdc++.h>` comes before any C/C++ token and the macros and target
options match. Otherwise GCC parses the header normally. The output is identical either
way. With the producer's GCC 16.2 build, a `bits/stdc++.h` program's front end took about
1.2 s instead of 3.4 s. Older bundles lack the capability; for them the method rejects
instead of risking GCC's `PCH allocation failure`.

The compiler's GMP/MPFR/MPC and Emscripten libraries are **host** dependencies in Wasm.
The GNU sysroot's glibc, libstdc++, libgcc and CRT are **target** ELF files; they are only
read by the compiler/linker. Source revisions, file hashes and licenses belong to the
producer bundle's provenance files. The common sysroot contract is shared with the
Clang cross compiler, with GCC's own internal headers added by the GCC producer.

## Integrity, state and measurements

Manifest bytes are pinned before parsing; all loaders, Wasm modules and sysroot
archives are size bounded and SHA-256 verified before import. Verified loaders use
Blob URLs; CSP must allow module Workers and `blob:` modules. The schema fixes
asset paths, and archives cannot escape `/sysroot`. Download caches belong to each
initialization, even with shared `fetchImpl`: integrity-failure retries and new
digests at the same URL fetch and verify assets again.

Compilation has no result cache. Compiled modules belong to the current instance,
identified by manifest/sysroot digests, GCC version, host and target. Consumer
caches must also key source/files, ordered `sources`, language/standard,
preprocessing, defines, output kind, optimization and CPU/SIMD. Failures never return
old artifacts; the example clears its download when compilation starts.

Results include stage argv, exit codes, milliseconds and peak linear-memory
capacity (Emscripten memory only grows). This excludes JS/MEMFS allocations and
is not process RSS. ELF checks require ELF64, little endian, x86-64, matching
output kind and executable loadable segments without an interpreter.

## Seeded API contract fuzzing

`pnpm run fuzz:gcc-contract` runs 10,000 deterministic parser/planner/path/integrity
cases: option profiles, source preservation, buffer copies, traversal/collisions,
reserved outputs, malformed manifests, size/UTF-8 boundaries and corrupt assets.
It uses inert bytes and **does not execute GCC** or qualify the compiler. This is
seeded property fuzzing, not coverage-guided fuzzing.

```sh
pnpm run fuzz:gcc-contract --seed 20261024 --iterations 50000 --out .cache/gcc-contract-fuzz
# A failure reports the seed, zero-based case index, input payload and this replay command:
pnpm run fuzz:gcc-contract --seed 20261024 --case 1234 --out .cache/gcc-contract-replay
```

Independent RNGs allow individual replay. Output must be a new directory
(default: timestamp/PID). Boundary cases precede mutated valid inputs.
`report.json` records source identity, seed, coverage groups, elapsed time and
first failure, including on failed CI runs. PR/main CI uses a fixed seed;
scheduled CI uses its run number. Keep real GCC qualification reports separate.

For generated programs executed by actual Wasm GCC, use `pnpm run fuzz:gcc-browser`
with the producer's immutable corpus and pinned bundle. See
[Chromium corpus replay](../../scripts/GCC_FUZZ.md) for commands, evidence and limits.

## Connected example and qualification

From the repository root, run:

```sh
pnpm exec vite --config examples/gcc-cross/vite.config.mjs
```

Open `/examples/gcc-cross/` and enter the producer manifest URL/trusted SHA-256.
The GCC form offers CPU/output controls, downloads, diagnostics, measurements and
cancellation. Cross-origin bundles need CORS. Locally, serve `.cache/gcc-bundle/`
and use `/.cache/gcc-bundle/gcc-toolchain.v1.json` at the server's HTTP origin.
This opt-in example leaves the main playground's Clang Run path unchanged.

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
