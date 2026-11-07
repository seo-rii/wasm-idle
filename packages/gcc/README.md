# @wasm-idle/gcc

`createGccWorker` runs real GCC in a browser Worker: GCC 13.3.0/16.2.0 with GNU
binutils for `target: 'x86_64-linux-gnu'`, or experimental GCC 17 for
`target: 'wasm32-wasi'`. `createCrossGccWorker` and `createCrossGccCompiler` retain
the x86 API.

Both hosts use `wasm32-emscripten`, producing x86 assembly/ELF downloads or
WAT/Wasm objects/WASI Preview 1 executables. ELF never enters WebAssembly execution.

The MIT JavaScript/TypeScript host uses `@wasm-idle/core` for assets/archives and
`@bjorn3/browser_wasi_shim` 0.4.2 for execution, with no LLVM package dependency.
GCC, binutils, Emscripten modules and GNU sysroots ship separately under their own licenses.

Provide a qualified `wasm-llvm/producer/gcc-browser` (x86) or `producer/gcc-wasi`
(Wasm) bundle. No implicit CDN, fallback compiler or bundled binary is provided.
V1 compiler/library/include versions must match: GCC 13.3.0/13 or 16.2.0/16.
Loading an `unverified` manifest does not qualify its compiler.

## Explicit WebAssembly output

The v2 manifest (`kind: gcc-wasm32-wasi`) pins GCC, patched WABT, LLD and wasi-libc
revisions and asset sizes/SHA-256. Supply an independently trusted manifest digest.

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
unexpected imports, imported/shared memory, memory64 and implicit start sections
in this command profile; the explicit shared-entry profile below has a separate
ABI. Object memory imports also reject shared memory/memory64. Execution uses the exact
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

Bundle capabilities distinguish C++, libc, libm, GNU libstdc++ and static
initialization. C++ requires `cpp`; STL/iostream requires qualified `libstdcxx`;
global/function-local construction and destruction require `staticInitialization`.
The SDK preserves `qualification.status`.

Optional `timezoneDatabase` advertises embedded GNU C++20 time zones; provenance
pins the data version. No compile option, timezone files or network is needed;
`current_zone()` falls back to UTC. Throwing lookups need `exceptions: true`.
TLS/shared combinations remain unqualified. Prebuilt `std` modules and C++26
debugger functions use the separate profiles below.

### GNU standard library modules

`stdModules: true` opts in to a bundle's separately qualified `std` and `std.compat`
BMIs. The default header workflow fetches no module assets, including when the
bundle advertises this capability. Both the outer manifest and its optional
`stdModules` descriptor must have `qualification.status: 'verified'`; a raw or
unverified producer package is insufficient.

```ts
const compiled = await compiler.compile({
	stdModules: true,
	standard: 'gnu++23',
	code: 'import std;\nint main() { std::vector<int> values{40, 2}; std::cout << values[0] + values[1] << "\\n"; }'
});
```

This initial profile requires ordinary C++ source, explicit `gnu++23`, O2
(`optimization` may be omitted), private scalar memory, and executable output.
Additional source units may mix imports and headers using the same profile.
Caller macro definitions, preprocessed input, external `linkInputs`, C++ exceptions,
RTTI, SIMD, atomics, TLS, shared memory, coverage, debug, threads and dynamic linking
are rejected before optional asset fetches. Omitting the standard retains the
ordinary `gnu++20` default and therefore rejects this opt-in.

The descriptor binds the exact Wasm-hosted compiler, GCC source revision and ordered
patches, sysroot, GNU ABI, interface sources, BMI bytes and real initializer archive.
Its full GCC BMI host is `wasm32-unknown-emscripten`, distinct from the outer SDK
manifest's `wasm32-emscripten` label. Native-host BMIs cannot substitute for it.
The SDK verifies all four lazy assets and the initializer archive's object members
before starting a frontend. Successful bytes are retained per compiler instance;
each fresh frontend receives private BMI copies and a fixed mapper outside the
caller's workspace. Initializer and signal archives follow all user objects and
precede the GNU runtime libraries. A failed fetch does not prevent header compilation
or a later retry. `dispose()` releases retained assets.

The original interfaces require the target flag `-mexception-handling` and the
internal `_WASI_EMULATED_SIGNAL=1` definition with its real signal provider. C++
compilation still uses `-fno-exceptions -fno-rtti`; this does not qualify throw/catch
or `setjmp`/`longjmp`. Module support requires native and Chromium Worker execution
of the exact packaged assets; synthetic SDK metadata and transport tests alone do
not qualify a producer bundle.

From the repository root, after building `packages/core` and `packages/gcc`, run the
real Chromium check with the root development dependencies installed:

```sh
node packages/gcc/test/std-modules/browser.mjs \
	--manifest /path/to/qualified/gcc-toolchain.qualification.v2.json \
	--sha256 "$GCC_MODULES_MANIFEST_SHA256" \
	--native-bmi /path/to/native-bmis --out /path/to/browser-receipt
```

The native BMI directory supplies the wrong-host negative case. `--candidate`
labels an explicitly prepared private qualification candidate in the receipt;
the harness never modifies or promotes a manifest. It records exact inputs,
stdin/stdout, optional requests, cache reuse, rejected profiles/assets, compression
sizes and Wasm linear memory separately from page heap measurements.

The optional `capabilities.debugger` defaults to `false`. A capable bundle must
advertise `cpp` and `libstdcxx` and include both
`/sysroot/lib/wasm32-wasi/libstdc++debugger.a` and
`/sysroot/lib/wasm32-wasi/libwasi-emulated-signal.a` in `runtimeLibraries`.
The auxiliary archive contains the pinned GNU implementation of `<debugging>`;
the ordinary libstdc++ archive stays unchanged. With this capability and
`qualification.status: 'verified'`, WASI requests may select `standard: 'c++26'`
or `'gnu++26'`. Older bundles and the x86 API continue to accept C++23 or earlier.
This bounded profile qualifies the three debugger functions, without promising
general C++26 library support. It is independent of `capabilities.debug` and
`debug: true`, which control embedded DWARF information.

The capable link profile adds
`--export-if-defined=_ZN9__gnu_cxx30debugger_signal_for_breakpointE`.
If the program uses GNU's debugger functions, this export identifies the address
of `__gnu_cxx::debugger_signal_for_breakpoint` in linear memory. It is an address
export, not the mutable C++ integer itself. A cooperating debugger enables CDP
debugging for the execution Worker, then explicitly registers by writing `-1`
to that four-byte little-endian integer. The initial and unregistered value is
`0`. GNU's `std::is_debugger_present()` reads this volatile state on each call;
`std::breakpoint_if_debugging()` calls `std::breakpoint()` only when it is nonzero.
Opening DevTools or attaching a protocol client alone does not register an
observer, and the SDK does not infer attachment or provide a debugger host option.

The observer must clear the integer before an orderly detach. If it loses its
debugger connection unexpectedly, its controller must terminate the execution
Worker; an abandoned registered instance must not continue. Clear registration
when the run ends and use a fresh instance for each run. Positive signal values
are outside this profile. `std::breakpoint()` uses GNU's `__builtin_trap()` path,
which becomes a Wasm `unreachable` trap. CDP pause-on-exceptions can expose that
stop, but continuing the debugger propagates the trap and terminates the guest
run; execution cannot resume after the C++ call. Native and actual Chromium
Worker qualification must establish these state transitions and traps before a
bundle advertises this capability. SDK parser/planner tests do not qualify it.

RTTI is opt-in: `rtti: true` requires a C++ request and a bundle with
`capabilities.rtti: true`, backed by its qualified GNU libstdc++ runtime. C++ then
uses `-frtti`. Omitted or false keeps `-fno-rtti`, including with capable bundles;
unchanged older `rtti: false` manifests remain supported and reject opt-in.
The manifest field remains a required boolean. C requests reject `rtti: true`.
All translation units use the same request profile.

The RTTI contract covers the producer's qualified nonthrowing operations, including
pointer `dynamic_cast` and `typeid` on valid operands. Failed reference casts and
`typeid` through null polymorphic pointers require the separate exception profile.
RTTI alone does not promise recovery from those failures
or source-level rejection of every expression that might reach them. Native and
actual Worker execution of the exact compiler/runtime must establish support;
SDK parser/planner tests alone do not qualify a bundle.

Threads and dynamic linking remain unsupported.
The default command profile retains `-fno-exceptions -fuse-cxa-atexit -fno-threadsafe-statics`, preserving
static destruction in this single-threaded environment.
Its `__GCC_WASI_SINGLE_THREAD__=1` selects the producer's `errno` header, which uses
single-thread WASI libc storage and rejects `_REENTRANT`; it provides no TLS.
`cpu` must be `wasm32`; x86 `avx2`/`avx2-fma` do not select Wasm SIMD. GCC diagnoses
unsupported target pragmas/attributes with `-Werror=pragmas -Werror=attributes`.
The separate x86 bundle retains its pragmas, intrinsics, libm and libstdc++.

`exceptions: true` requires ordinary C++, a verified bundle advertising
`capabilities.exceptions`, and an engine supporting modern `try_table`,
`catch_ref` and `throw_ref`. `WebAssembly.Tag` alone is insufficient. Legacy and
mixed EH binaries are rejected. All source units receive `-mexception-handling
-fexceptions`; omitted/false preserves existing arguments and receipt shapes.
The request selects the sysroot-bound `libstdc++.a`, `libsupc++.a` and
`libunwind.a` under `/sysroot/lib/wasm32-wasi-eh`, followed by the ordinary libc
providers. Default compilation retains its existing GNU archives.
EH-only GNU wrappers cover uncaught exceptions at main, static construction,
destruction and exit, calling `std::terminate` inside Wasm.

The initial exception profile excludes C, shared memory, TLS, debug, coverage,
SIMD and atomic options. RTTI remains independently selected; typed catches do
not require enabling user RTTI. Object/archive receipts must match the exception
profile and exact GCC bundle; tag symbols, instruction relocations and feature
metadata are checked for every member. Standalone `runGccWasiArtifact` requires
the qualified manifest. Exceptions execute in Wasm with a local C++ tag; no tag
export or JavaScript exception bridge is required. SDK tests and Clang references
do not qualify GCC: native and browser execution of the actual GCC/GNU runtime
must establish the advertised support.

SIMD requires `capabilities.simd: true`, a `simd: true` request and a successful
engine `v128` probe before GCC receives `-msimd128`. Capable bundles default to
`-mno-simd128`; legacy `simd: false` manifests retain their arguments. SIMD artifacts
without opt-in are rejected.
GNU `__attribute__((vector_size(16)))` supports i8x16/i16x8/i32x4/i64x2/f32x4/f64x2.
Patch `0006` adds scalar-count shifts, comparisons, selection and constant shuffles.
Patch `0007` adds direct `v128` calls and singleton vector aggregates, qualified
against pinned Clang with SIMD enabled on both sides. Disabled profiles use indirect
calls. Check pinned patches and native/browser results: older bundles support
fewer operations. Automatic vectorization, `wasm_simd128.h` and
arbitrary cross-compiler ABI compatibility are not promised.

Relaxed SIMD is a separate explicit profile: a verified bundle must advertise
`capabilities.relaxedSimd: true` together with `simd: true`, and the request must
select both `simd: true` and `relaxedSimd: true`. Missing capabilities and omitted
request fields mean false. A separate engine probe validates all 20 relaxed
instructions before compilation. The producer's `wasm_relaxed_simd.h` exposes
the real GCC builtins; the SDK does not rewrite source or emulate operations.
Capable bundles receive `-mrelaxed-simd` only when selected, otherwise
`-mno-relaxed-simd`; older bundles retain their original compiler arguments.
The assembler enables relaxed SIMD only for selected requests.

Binary inspection detects actual relaxed instructions independently of optional
`target_features` metadata. Default and SIMD128-only compilation reject them.
`inspectGccWasm(bytes, kind, { relaxedSimd: true })` explicitly enables inspection
of this profile; it still requires the real engine. Inspection exposes both
`features.simd128` and `features.relaxedSimd`. Compiled artifacts retain
`relaxedSimd: true`, which `run()` accepts only with a qualified capable bundle
and freshly checked executable bytes. Changing inspection metadata cannot enable
an unselected artifact. Worker transport retains this selection and object receipts.
Direct `runGccWasiArtifact(artifact, options, verifiedManifest)` calls require that
same parsed, independently verified manifest for relaxed artifacts; the compiler's
`run()` supplies its own pinned manifest. Existing two-argument calls retain the
baseline and SIMD128 execution profile.

Relaxed operations permit multiple results for certain inputs, including NaNs,
out-of-range conversions, fused arithmetic and selection masks. Qualification
must record actual native and Worker outputs and check each against the allowed
result set; the two engines need not choose identical permitted results.

## Atomic instructions and shared entries

`capabilities.atomics` and `capabilities.sharedMemory` are optional and default to
false; shared memory requires atomics. `threads` remains false. An `atomics: true`
compile request requires a verified capable bundle and an actual engine probe.
It selects GCC `-matomics`, WABT `--enable-threads`, and exactly the qualified
`/sysroot/lib/wasm32-wasi/libatomic.a` provider from the integrity-checked sysroot.
Capable bundles use `-mno-atomics` and omit that provider for ordinary requests;
older bundles preserve their compiler arguments. This compile profile can also
produce ordinary WASI commands with private memory. Atomic waits require shared
memory. Binary inspection reports `features.atomics` and `features.bulkMemory`,
and rejects atomic instructions without explicit opt-in.

`sharedMemory: { entry, initialPages, maximumPages }` selects a separate
freestanding C or C++ executable contract. Both page counts must be equal, between
1 and 8192; each page is 65536 bytes. There is no WASI command CRT or `_start`.
The exported entry takes only `i32` arguments and returns one `i32`; use
`extern "C"` for a C++ entry. The SDK does not link libstdc++, enable RTTI or
coverage, or provide pthreads, dynamic global constructors or stdio in this
profile. Without `tls: true`, it also excludes TLS and allocation. The explicit
TLS runtime extension is described below. Pure libc memory routines may resolve
libatomic's dependencies.
Use `sources` for additional translation units; every unit receives the same
freestanding flags. External `linkInputs` are rejected in shared mode because
their existing object/archive receipts do not attest shared-safe static
initialization. The ordinary atomic command profile still accepts those inputs.
Without TLS the final executable may import only `env.memory`. C++ atomic builtins and
separately qualified header operations do not establish general C++ runtime
thread safety.

```ts
import { runGccSharedArtifact } from '@wasm-idle/gcc';

// `compiler` is a wasm32-wasi Worker with a qualified atomics/shared-memory bundle.
const compiled = await compiler.compile({
	language: 'c',
	atomics: true,
	sharedMemory: { entry: 'count', initialPages: 4, maximumPages: 4 },
	code: `static unsigned counter;
unsigned count(unsigned iterations) {
  for (unsigned i = 0; i < iterations; ++i)
    __atomic_fetch_add(&counter, 1, __ATOMIC_SEQ_CST);
  return (unsigned)&counter;
}`
});
if (compiled.exitCode !== 0) throw new Error(compiled.stderr);
const result = await runGccSharedArtifact(
	compiled.artifact!,
	{ workerArguments: [[10000], [10000]], stackBytes: 32768, timeoutMs: 30000 },
	compiler.manifest
);
const counter = new DataView(result.memory.buffer).getUint32(result.values[0] >>> 0, true);
console.log(counter); // 20000 after both Workers finish
```

The browser must support cross-origin isolation, shared WebAssembly memory and
module Workers. Serve the application with appropriate COOP/COEP headers.
`runGccSharedArtifact` creates a fresh shared memory and 1–16 Workers; it does not
fetch compiler assets. Each argument row belongs to one Worker. `stackBytes` is
a multiple of 16 between 4096 and 16777216. Data and all disjoint stack regions,
including guards, must fit the fixed memory. The SDK checks the actual entry
signature, exported data/heap bounds, local mutable stack pointer, zero TLS size,
empty constructors, passive data and stackless one-time linker initialization.
Each Worker instantiates the same module, sets its own stack pointer, waits for
the host start barrier, then runs the guest entry. Host Atomics coordinate the
barrier; guest instructions perform the program's atomic operations.

Success returns `values`, a copied `Uint8Array` in `memory`, and `stackRegions`;
it exposes no live memory or Worker handles. Abort, timeout, trap, malformed reply
or a failed stack guard invalidates the entire run and requests termination of
every Worker. Stale replies are ignored and that memory is permanently discarded.
Browser termination can be delayed, so rejection does not promise immediate CPU
quiescence or safe reuse. `timeoutMs` defaults to 30000 and is limited to 300000.
Use this standalone runner for shared artifacts; ordinary `compiler.run()` and
`runGccWasiArtifact()` reject them. Atomic WASI artifacts also require their
qualified manifest when passed directly to `runGccWasiArtifact()`.

## Thread-local storage

`capabilities.tls` is optional and defaults to false. The explicit `tls: true`
request selects qualified local-exec TLS for C `_Thread_local`/`__thread` and C++
`thread_local`. It selects GCC `-mtls`; capable bundles use `-mno-tls` otherwise,
and older bundle arguments remain unchanged. Native atomic instruction lowering
is selected separately by `atomics`. TLS and `debug` cannot be combined: this
profile does not qualify TLS DWARF relocations.

TLS object symbols, segment flags and relocations are inspected together, and
object receipts preserve `profile.tls`. Their LLD ABI requires atomics and
bulk-memory feature metadata even when the final private-memory executable has
no atomic instructions. The SDK reports actual atomic instructions separately
from `features.tls`. Qualified TLS runtime libraries may contribute atomic
instructions to the final executable even with `atomics: false`; their execution
requires actual atomic engine support. User-generated and external objects still
require `atomics: true` for atomic instructions. TLS metadata requires explicit opt-in and a matching
qualified GCC bundle; `clang-c-scalar-v1` does not qualify TLS inputs.

TLS requests select the integrity-bound
`/sysroot/include/wasm32-wasi-tls/__errno.h` before the ordinary include paths.
It declares real C `_Thread_local` or C++ `thread_local` `errno`, matching the
selected libc; requests without TLS retain the existing headers.

Ordinary WASI TLS uses the existing command runner, private memory and the real
TLS libc. Its
qualified GNU TLS archive is
`/sysroot/lib/wasm32-wasi-tls/libgcc-wasi-tls.a`. TLS-only exit wrappers run C++
thread-local destructors before process `atexit` handlers and static destructors
on normal main return or `std::exit`. `abort`, `_Exit` and `quick_exit` retain
their separate termination behavior. Direct `runGccWasiArtifact` execution of a
TLS artifact requires its qualified manifest. This profile selects its qualified
`libc.a`, `libm.a` and `libclang_rt.builtins-wasm32.a` from the same
`/sysroot/lib/wasm32-wasi-tls` directory. Its libc retains the original
single-thread stdio and allocator implementations while using real TLS for
`errno`. Private-memory executables containing `atomic.wait` remain rejected.
When the bundle also supports binary128 `long double`, TLS commands select the
matching `libc-printscan-long-double.a` from that directory before libc, preserving
the formatter/scanner's TLS `errno` ABI.

Shared TLS additionally requires `atomics: true` and
`sharedMemory: { entry, initialPages, maximumPages, reservedBytes }`.
`reservedBytes` must be a positive multiple of 16. LLD reserves this many bytes
between the aligned end of static data and the allocator heap. This reservation
must fit every Worker's TLS image, alignment padding, stack and guard regions.
For example, `reservedBytes: 262144` accommodates two 65536-byte stacks and small
TLS images; the SDK checks actual linked sizes before creating any Worker.
The normal fixed initial/maximum memory limits still apply.

The SDK validates LLD's exact one-time initializer, retained TLS template,
`__wasm_init_tls` body, exported TLS alignment and size, and stack/heap bounds.
It allocates disjoint TLS blocks and stacks below `__heap_base`. Each Worker sets
its local stack pointer and initializes its TLS block before the all-ready
barrier. After a normal entry return it calls `__wasm_call_thread_dtors` before
reporting success. The result includes copied memory and `tlsRegions`; it exposes
no live TLS address handle. A trap, cancellation or cleanup failure discards the
whole cohort, without a destructor guarantee or memory reuse.

Shared TLS selects
`/sysroot/lib/wasm32-wasi-threads/libgcc-wasi-tls-shared.a` and the matching
`libc.a`, `libm.a` and `libclang_rt.builtins-wasm32.a`. Hosted GNU headers expose
`std::malloc` and `std::strtol`; linking supplies GNU TLS cleanup/new/delete and
threads libc, without the full shared `libstdc++.a`. Compiler builtins stay off.
Libc supplies private `errno` and a shared allocator for GNU destructor records.
Its heap begins at `__heap_base`, above TLS/stacks; fixed maximum memory prevents
growth, so exhaustion returns allocation failure. Imports permit only
`env.memory` and optional `wasi_snapshot_preview1.sched_yield: () -> i32`, which
yields through a private Worker control word. This enables neither pthreads,
`std::thread`, shared stdio nor general C++ library thread safety. These
integrity-bound providers cannot enter the default runtime-library list.

## Explicit static link inputs

WASI executable requests accept ordered `linkInputs`, separately from `files` and
`sources`. Each entry has a relative `.o` or `.a` `path`, `format: 'wasm-object'` or
`'wasm-archive'`, `Uint8Array` `bytes`, lowercase SHA-256, and a typed
`WasiGccLinkProfile`. Source-generated objects precede these inputs; runtime
libraries follow them. Entries retain their listed order, including archives.
The optional `profile.relaxedSimd` defaults to false and must exactly match the
compilation request. True requires `profile.simd: true` and the same qualified
GCC bundle; the existing `clang-c-scalar-v1` contract does not qualify relaxed SIMD.
Likewise, optional `profile.atomics` defaults to false and must exactly match the
request. Atomic object instructions require a `+atomics` target feature and the
same qualified GCC bundle; `clang-c-scalar-v1` does not qualify atomics. Object
receipts and compile Worker transport preserve these selections, including the
optional TLS profile described above.
Every archive member's actual instructions and declared `target_features` are
checked before compilation, including members the linker would leave unused.
Archives use ordinary lazy member extraction; this API adds no `--whole-archive`,
library search flags, dynamic linking, or arbitrary linker options.

Object compilation supplies a reusable receipt automatically:

```ts
const produced = await compiler.compile({
	language: 'c',
	emit: 'object',
	code: 'int twice(int n) { return n * 2; }'
});
if (produced.exitCode !== 0) throw new Error(produced.stderr);
const object = produced.artifact!;
const linked = await compiler.compile({
	language: 'c',
	code: 'int twice(int); int main(void) { return twice(21) == 42 ? 0 : 1; }',
	linkInputs: [{ path: 'twice.o', bytes: object.bytes, ...object.linkInput! }]
});
```

The receipt binds the object digest, `target: 'wasm32-wasi'`,
`abi: 'wasm32-wasi-preview1'`, requested SIMD profile, and the exact GCC manifest
and sysroot digests (`compatibility.kind: 'gcc-bundle'`). Reuse requires the same
bundle and SIMD setting. Externally prepared GCC archives need the same receipt
fields, based on independently recorded compiler inputs. A digest identifies
bytes; caller-supplied provenance does not authenticate who compiled them or
prove source-level ABI compatibility.

For RTTI-capable bundles, generated object profiles also record `language: 'c'`
or `'cpp'`; C++ profiles record the effective `rtti` boolean. Known same-bundle C
objects are RTTI-neutral and can be used by C++ callers with either setting.
C++ objects must match the request's RTTI mode. A pure-C archive can declare the
C profile; an archive containing C++ members must declare their compatible C++
RTTI profile. The validator checks this declared contract before any frontend
runs; Wasm symbols cannot prove the original language or class hierarchy.

Legacy profile omission means unknown language and RTTI disabled. Those receipts
retain their existing default/off behavior. An enabled C++ request rejects an
unknown-language legacy input rather than assuming it is C: regenerate the object
receipt or provide independently known C provenance. RTTI-false bundles continue
emitting the original profile shape, preserving old receipt consumers. Manifests
and sysroots must still match exactly; a new profile never makes different
bundles compatible.

The only mixed-compiler contract is the explicit caller declaration
`compatibility.kind: 'clang-c-scalar-v1'`, pinned to Clang 22.1.0 commit
`4434dabb69916856b824f68a64b029c67175e532` with the matching `sysrootSha256`.
It requires a C source request and nonvariadic C interfaces using integers up to
64 bits, float/double, pointers, and function pointers with those same signatures.
Shared pointees must use agreed scalar layouts or remain opaque to the other
compiler. Aggregates, bitfields, vectors, long double, int128, variadic boundaries,
and C++ interfaces are outside this contract. The validator additionally rejects
vector/reference function types and visible C++ mangled symbols in these inputs;
those checks cannot reconstruct C declarations from Wasm. In particular, known
aligned-empty C++ ABI differences in older GCC bundles are not made compatible by
successful Wasm validation or linking. This restriction does not remove the
bundle's existing SIMD, binary128 or int128 support for GCC source compilation.

The host copies bytes and profile fields before asynchronous validation or Worker
transport, without detaching caller buffers. Inputs live under a separate
`/link-inputs` namespace. Limits are 128 inputs, 64 MiB combined, and 4,096 members
per archive. Supported archives are regular GNU `ar`, including GNU long names
and the 32-bit symbol index. Thin/nested archives, LLVM bitcode, ELF, common
symbols, TLS symbols without an explicit qualified TLS profile, and unsupported
relocations/features are rejected with the input/member name. Archive members are all checked, even when the linker would not select them.

Validation requires WebAssembly version 1, linking metadata version 2 and a symbol
table. It checks symbol/segment/constructor indices, COMDATs, relocation target
sections and symbol kinds, nonoverlapping chunk bounds and padded 32-bit LEB
relocations, archive indices, byte digests, target/ABI and SIMD/RTTI profiles. Actual
instructions/types are inspected even when the optional `target_features` section
is absent, as with older qualified WABT outputs. `wasm-ld --fatal-warnings` still
performs cross-object resolution and relocation application, and the final
executable is independently validated. Static constructors require the bundle's
`staticInitialization` capability.

Compile results record ordered `linkInputs` identities, including each archive
member's name, length and digest. Include those receipts in application cache
keys. Invalid inputs fail before any front end runs; failed tools return no old
artifact. The x86 API continues to reject `linkInputs`, and ordinary `files` never
become linker inputs implicitly.

`run()` accepts `stdin`, `args`, `env` and `maxOutputBytes` (default: four MiB combined
stdout/stderr), returning exit code, output, runtime and final linear-memory
capacity. Optional `preopens` provide a fresh in-memory filesystem for each run:

```ts
const result = await compiler.run(artifact, {
	stdin: '3\n',
	preopens: [
		{ path: '/input', readonly: true, files: [{ path: 'data.bin', contents: inputBytes }] },
		{ path: '/output', directories: ['results'] }
	],
	filesystemLimits: { maxFileBytes: 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 }
});
const output = result.files.find((file) => file.path === '/output/results/data.bin');
```

Guest code can use `fopen`, `fread`, `fwrite`, directory enumeration, `mkdir`,
`unlink` and `rmdir` inside the supplied mounts. Mount paths are canonical absolute
guest paths (`/input`, or `/`); mounts cannot overlap. Input file and directory
paths are canonical relative paths, with no empty, `.` or `..` components,
backslashes or NULs. Missing input parent directories are created automatically.
Guest relative `.` and `..` components are normalized within the directory fd;
traversed components must exist and be directories. An attempt to escape that fd
returns `ENOTCAPABLE`. Symlinks, hard links, rename
and filesystem timestamps are unsupported in this profile.

The SDK copies input bytes before execution. Strings become UTF-8; binary data
remains bytes. Each normal exit, including a nonzero exit code, returns `files`:
all remaining regular files from every mount, including unchanged input files,
sorted by absolute guest path and containing independent `Uint8Array` copies.
Empty directories are not included. Running again starts from the new options;
mutating input or returned buffers never changes another run. No preopens means
no guest filesystem and `files: []`. No host directories or OPFS are mounted.
Worker requests and results use structured clone without detaching caller buffers.

`readonly: true` rejects file creation, writes, truncation, allocation and directory
mutation with `EROFS`. Missing files return `ENOENT`. `filesystemLimits` applies
across every mount, independently of stdout/stderr and Wasm linear memory:

| Limit           | Default | What is counted                                   |
| --------------- | ------- | ------------------------------------------------- |
| `maxEntries`    | 1024    | Live files and directories, including mount roots |
| `maxFileBytes`  | 16 MiB  | Each file's logical size, including holes         |
| `maxTotalBytes` | 64 MiB  | All live file bytes                               |
| `maxPathBytes`  | 4096    | Absolute guest path length in UTF-8 bytes         |
| `maxOpenFiles`  | 256     | Open filesystem descriptors, including preopens   |

Limits must be positive integers no larger than `2**32 - 1`. Initial input that
exceeds a limit rejects the request. Guest growth beyond entry/byte limits returns
`ENOSPC` before allocating; overlong paths return `ENAMETOOLONG` and too many open
descriptors return `EMFILE`. Lookup text is also bounded to the greater of 4096
code units and `maxPathBytes`; the resolved path uses the UTF-8 byte limit.
Unlinked files held open still consume entry/byte quota until the last descriptor
closes. Growth is rejected before the offending write or resize allocates bytes.

### DWARF debug information

WASI requests can select `debug: true` when a verified producer bundle declares
`capabilities.debug: true`. Missing capabilities are false. The initial profile
embeds standard DWARF4 with `-g -gdwarf-4 -gno-variable-location-views` and defaults
to `optimization: '0'`; an explicitly selected nonzero optimization is rejected
before any tool runs. This applies to assembly, object and executable outputs,
including additional source units through `files` and `sources`. Source text is
passed unchanged to GCC. The separate x86 request API does not accept `debug`.

Debug information stays inside the normal WAT or Wasm artifact; it adds no debug
receipt or ABI profile field. `debug: false` and omission preserve the ordinary
optimization default (`'2'`), compiler arguments and receipt shapes. RTTI, SIMD,
wide values and coverage retain their existing request rules. Actual debugger
locations depend on the producer's qualified profile; an unavailable location
does not disable the language feature itself.

### GCC coverage

WASI requests can opt in with `coverage: true` when the pinned bundle declares
`capabilities.coverage: true`. Older manifests omit the capability and treat it
as false. Omission or `coverage: false` preserves ordinary compiler/linker
arguments and object receipts. The separate x86 API does not accept this option.

```ts
const compiled = await compiler.compile({
	code: 'int main(void) { return 0; }',
	language: 'c',
	coverage: true
});
if (!compiled.artifact || !compiled.coverage) throw new Error(compiled.stderr);
const executed = await compiler.run(compiled.artifact, {
	preopens: [{ path: '/profile' }]
});
const note = compiled.coverage.notes[0];
const data = executed.files.find((file) => file.path === note.dataPath);
// Save note.contents as note.path, and data.contents as the matching .gcda filename.
```

This profile uses GCC's `-fprofile-arcs -ftest-coverage` instrumentation with
`-fprofile-update=single`, and links the bundle's official `libgcov.a` and WASI
SDK `libwasi-emulated-getpid.a` only for covered executables. Every C/C++ source
unit uses the same selected optimization and coverage flags. Additional sources
work through the existing `files`/`sources` API. Initial coverage compilation
accepts source units only: combining `coverage: true` with `linkInputs` rejects
the request. Assembly, object and executable outputs are supported; a covered
object receipt records `profile.coverage: true`, and covered external objects or
archives currently reject in every executable request. Visible reserved
`__gcov` imports/symbols also reject undeclared instrumented inputs. Caller
provenance remains required; binary checks cannot authenticate all source options.
Ordinary uncovered link inputs retain their existing compatibility rules.

On success, `compiled.coverage` identifies the GCC version and commit and returns
exact binary `.gcno` notes in source/link order. Filenames are `program.gcno`,
`program.1.gcno`, and so on; matching guest data paths are
`/profile/program.gcda`, `/profile/program.1.gcda`, and so on. Generated note
names, including a same-named directory, are reserved against input collisions
only when coverage is enabled. Each frontend's notes are captured before its
filesystem is discarded and copied into private `Uint8Array` buffers. Limits are
16 MiB per note and 64 MiB total. Worker responses transfer these private output
buffers without detaching caller inputs. Failed compilation returns no artifact
or partial coverage result, and subsequent requests start fresh.

Covered executable metadata declares the fixed `/profile` directory and expected
data paths. `run()` requires an exact writable `{ path: '/profile' }` preopen;
missing/read-only mounts reject before execution. `GCOV_PREFIX` and
`GCOV_PREFIX_STRIP` overrides reject because they redirect those paths. Other
environment entries retain their normal behavior. Normal termination writes real
`.gcda` bytes into the existing `files` result, subject to filesystem limits and
guest I/O errors reported by libgcov. A trap, Worker cancellation, or `_Exit`
does not guarantee a profile. Each run has a fresh mount; profiles merge only if
the caller explicitly supplies previous `.gcda` bytes as mount inputs.

Analyze matching `.gcno`/`.gcda` pairs with the producer's official pinned GCC 17
`gcov`, using `--json-format --branch-probabilities --branch-counts` when needed.
The qualified base GCC revision is
`ac20dcd5f8c5ae858f9b2d9cdf4140c0738e5e27`; its version word is `B70 ` (including
the trailing space), and its JSON format version is 2. These binary files use
GCC's private format; the SDK returns them unchanged and supplies no custom
parser. Coverage describes the selected optimized program; inlining and dead
code removal can change source-level counts. PGO/value profiling, atomic
updates, info-section streaming, condition/path coverage, function-entry hooks,
manual gcov control calls, and PID-dependent naming are outside this API.

Threads and dynamic linking remain unavailable.
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
preprocessing, defines, ordered link-input receipts, output kind, optimization and
CPU/SIMD/relaxed-SIMD/RTTI settings. Failures never return
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

# Binary metadata/WebCrypto/Worker contract only; no compiler qualification claim.
WASM_IDLE_RUN_GCC_LINK_INPUTS_BROWSER=1 node --test scripts/gcc-link-inputs.browser.test.mjs

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
