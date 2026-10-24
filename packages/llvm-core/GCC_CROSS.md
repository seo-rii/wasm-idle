# GNU GCC in a browser Worker

`@wasm-idle/llvm-core/gcc` runs the producer's real GCC 13.3.0 `cc1`/`cc1plus` and GNU
binutils `as`/`ld` as Emscripten WebAssembly modules. It returns Linux x86-64 assembly, ELF
objects, or static ELF executables for download. The compiler host is
`wasm32-emscripten`; the output target is `x86_64-linux-gnu`. No browser x86 executor is
included and output ELF bytes never enter `WebAssembly.compile` or `instantiate`.

This API requires an independently built and qualified GCC bundle from `wasm-llvm`'s
`producer/gcc-browser`. There is no implicit CDN, fallback compiler, or bundled binary.
An `unverified` producer manifest remains explicitly unverified; successfully loading
that manifest does not establish that GCC can compile the acceptance suite.

```ts
import { createCrossGccWorker } from '@wasm-idle/llvm-core/gcc';

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

One request compiles one C or C++ translation unit, with optional local header/data files
under `/workspace`. Source text reaches the GNU front end unchanged. GCC's `target` and
`optimize` pragmas, `push_options`/`pop_options`, PBDS, intrinsic headers and exception
handling are implemented by the actual compiler and GNU headers, not by a JavaScript
compatibility layer. Their availability must be confirmed by the real producer suite.

The front ends use `-nostdinc` plus explicit GNU C, C++, GCC internal and glibc include
directories from the pinned sysroot. C++ also gets the GNU driver's `_GNU_SOURCE` define
and exception support. GCC emits assembly, GNU `as --64` emits an ELF object, and GNU
`ld -static` receives the GNU CRT, libstdc++ (C++), libm (C++), libgcc, libgcc_eh and
glibc in their required order. Each stage uses a fresh module and MEMFS to reset GCC
global state. The JavaScript Worker orchestrates these stages without `fork` or `exec`.

| Request field  | Supported values                                                                         |
| -------------- | ---------------------------------------------------------------------------------------- |
| `language`     | `c`, `cpp` (default)                                                                     |
| `cpu`          | `x86-64` (baseline default), `avx2-fma` (`-march=x86-64 -mavx2 -mfma`)                   |
| `emit`         | `assembly`, `object`, `executable` (static default)                                      |
| `optimization` | `0`, `1`, `2` (default), `3`, `s`                                                        |
| `standard`     | C99/C11/C17/C2x or C++11/14/17/20/23, including GNU dialects; defaults `gnu17`/`gnu++20` |
| `preprocessed` | `true` for `.i`/`.ii` plus `-fpreprocessed`; ordinary source is the default              |
| `files`        | Up to 1,024 relative local files; 16 MiB total source and file contents                  |

No `-march=native`, arbitrary driver arguments, PCH, plugin, LTO, shared/dynamic linking,
OpenMP, multi-translation-unit linking, or process spawning is supported. The option
allowlist rejects unknown request fields. A CPU profile describes the generated program's
requirements; it does not detect the browser host CPU. Source pragmas can enable additional
instructions, just as with native GCC. Choose execution hardware accordingly.

The compiler's GMP/MPFR/MPC and Emscripten libraries are **host** dependencies in Wasm.
The GNU sysroot's glibc, libstdc++, libgcc and CRT are **target** ELF files; they are only
read by the compiler/linker. Source revisions, file hashes and licenses belong to the
producer bundle's provenance files. The common sysroot contract is shared with the
separately stacked Clang PR, with GCC's own internal headers added by the GCC producer.

## Integrity, state and measurements

The manifest's exact bytes are pinned before parsing. Every JavaScript loader, Wasm
module and sysroot archive is size bounded and SHA-256 verified before any loader import.
The browser imports verified loader bytes through Blob URLs and instantiates the verified
Wasm modules. Hosting CSP must permit module Workers and `blob:` modules. Relative asset
paths are fixed by the manifest schema; archive paths cannot escape `/sysroot`.

Compilation has no result cache. Compiled Wasm modules are retained only in the current
compiler instance, whose identity contains the manifest digest, GCC version, host, target
and sysroot digest. A consumer adding its own result cache must also key source/files,
language/standard, preprocessing, output kind, optimization and CPU profile. Failed
compilations never return an artifact from an earlier request. The connected example
removes the previous download at the start of every compile.

Each result includes all stage argument vectors, exit codes, elapsed milliseconds and
peak linear-memory capacity. Emscripten memory only grows, so its final capacity is the
stage's linear-memory maximum. This metric excludes JavaScript and MEMFS allocations;
it is not total browser process RSS. ELF validation checks ELF64, little endian, x86-64,
the requested output kind and, for executables, loadable segments without an interpreter.

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

```sh
# Synthetic transport/filesystem/integrity tests; these are NOT evidence of a GCC port.
pnpm --dir packages/llvm-core exec vitest run runtime/gcc/test

# Actual Wasm GCC in Chromium, then known baseline ELF programs run by Linux x86-64.
node scripts/verify-x86-cross-gcc.mjs \
  /path/to/gcc-toolchain.v1.json \
  /path/to/wasm-llvm/producer/gcc-browser/qualification \
  /path/to/new-results-directory
```

The real acceptance path exercises `.ii`, ordinary C/C++, `bits/stdc++.h`, PBDS order
statistics, exception unwinding, dynamic-input AVX2/FMA and GCC pragma push/pop behavior,
assembly/disassembly checks, Worker cancellation, failed-output isolation and native
stdin/stdout. It records manifest, suite and output identities with stage measurements.
Keep its real-build report separate from the synthetic fixture test report.
