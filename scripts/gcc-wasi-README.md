# GCC WebAssembly qualification

The 2026-10-26 qualification passed all 17 actual Wasm-host GCC cases in
Chromium Worker and independent Node WASI, including GNU STL and iostream at
`-O0` and `-O2`. Host GCC references passed 17/17, Clang/WASI references passed
16/16, unsupported diagnostics passed 7/7, and existing GCC 13.3 x86 regressions
passed 20/20. The exact final manifest SHA-256 is
`d1eb6cfde2ae54de253171b1bcbbc1abb75c605434fa74a23fd25fe02872443a`.
Full source/asset/artifact identities and loading measurements are recorded in
the companion wasm-llvm `docs/gcc-wasi-validation.md` and `.json`.
The local full receipt is `out/gcc-wasi-final-worker-20261026/qualification.json`.
These recorded results qualify an experimental profile; the limitations below
and the package README still apply.
The subsequent backend review and SIMD/ABI results are recorded separately in
wasm-llvm `docs/gcc-wasi-backend-review.md`; the numbers above identify the
original scalar bundle rather than a later rebuild.
Further SIMD operations and direct vector ABI work are recorded in wasm-llvm
`docs/gcc-wasi-simd-extension.md`, with distinct compiler and bundle identities.

These tools distinguish the compiler's **host** from its **output target**.
`verify-gcc-wasi.mjs --manifest ...` loads real GCC into a Chromium Worker,
checks its WebAssembly object, compiles each requested program, executes it in
the SDK's WASI Worker, and independently executes the downloaded program with
Node's WASI Preview 1 implementation. It does not fall back to Clang.

Build `@wasm-idle/core` and `@wasm-idle/gcc` before browser compiler qualification:

```sh
node node_modules/typescript/bin/tsc -p packages/core/tsconfig.json
node node_modules/typescript/bin/tsc -p packages/gcc/tsconfig.json
node scripts/verify-gcc-wasi.mjs \
  --manifest /path/to/gcc-wasi-bundle/gcc-toolchain.v2.json \
  --output out/gcc-wasi-browser
```

The script needs Chromium and the workspace's Vite/Playwright dependencies.
`WASM_IDLE_CHROMIUM_EXECUTABLE` can select an installed Chromium executable.
The test server uses an isolated loopback origin with no application credentials.
Each compiler request has a ten-minute deadline; each program has a thirty-second
deadline. A failed or missing case fails qualification. Use `--cases c-hello`
for the first milestone; omitted cases remain explicitly untested in the report.
Do not present a selected subset as full C/C++ qualification.
Use `--save-intermediates` with a compiler manifest to preserve the main
translation unit's GCC WAT and assembled object alongside the final program.
These extra compilations help isolate GCC code generation from assembler/linker
behavior when native and Wasm compiler hosts disagree.

## Per-run memory filesystem

Issue #343 adds optional `preopens` and `filesystemLimits` to the SDK execution
host, with final binary file snapshots returned through the actual Worker. The
compiler backend, compiler hosts, GNU runtime and sysroot are unchanged.
The 2026-10-30 check used the qualified eleven-patch GCC bundle: all **14 O0/O2
programs compiled and passed in Chromium 156.0.8078.4**, with **16 executions**
including two repeated-run checks. The same native GCC sources compiled and
linked all 14 programs before browser validation. Six cases ran successfully in
independent Node WASI for both native and browser-produced programs. The other
eight test SDK readonly and quota policies that Node WASI does not expose; their
receipts explicitly record that oracle as inapplicable, rather than passed.

The [recorded qualification](../docs/gcc-wasi-filesystem-20261030.json) identifies
compiler, assembler, linker, sysroot, SDK code, fixtures and each actual program
by SHA-256. The reused manifest is
`576ebe8a59ecdda01acaaf71c5f46b8306d3ef75a9d87356728c7fbc9a958d77`.
The [fixture suite](gcc-wasi-filesystem-fixtures.mjs) includes original C source,
input bytes and independently specified expected output files. It checks binary
`fread`/`fwrite`, append and seek, directory enumeration, creation/removal, missing
files, capability escape, readonly mounts, entry/per-file/total quotas, unchanged
stdin/stdout and fresh state on repeated execution.

```sh
pnpm --filter @wasm-idle/core build
pnpm --filter @wasm-idle/gcc build
node scripts/verify-gcc-wasi.mjs \
  --manifest /path/to/gcc-wasi-bundle/gcc-toolchain.v2.json \
  --suite scripts/gcc-wasi-filesystem-fixtures.mjs \
  --save-intermediates --output out/gcc-wasi-filesystem-browser
```

Filesystem fixtures require `--manifest` so the SDK's real compiler and Worker
path are exercised. File snapshots are compared in full, including unchanged
inputs. Runtime policy and lifecycle unit tests additionally cover raw WASI
allocation/truncation, open-but-unlinked files, bounded fd reuse and Worker
structured cloning. The [package contract](../packages/gcc/README.md) documents
path rules, limits, errors and unsupported filesystem operations.

## Additional compiler suites

The optional `--suite /path/to/TRUSTED_LOCAL_MODULE.mjs` imports executable local
test code exporting `cases` and optional `disabledCases` arrays. Both arrays are
included in selection and the report. Every case carries its original source,
request, stdin and expected stdout. The receipt records the module identity and
each serialized fixture, and rejects changes to the suite during qualification.
Use the producer's focused suites for the reviewed backend:

```sh
node scripts/verify-gcc-wasi.mjs \
  --manifest /path/to/gcc-wasi-bundle/gcc-toolchain.v2.json \
  --suite /path/to/wasm-llvm/producer/gcc-wasi/simd-fixtures.mjs \
  --save-intermediates --output out/gcc-wasi-simd-browser
node scripts/verify-gcc-wasi.mjs \
  --manifest /path/to/gcc-wasi-bundle/gcc-toolchain.v2.json \
  --suite /path/to/wasm-llvm/producer/gcc-wasi/abi-interop-cases.mjs \
  --output out/gcc-wasi-abi-browser
node scripts/verify-gcc-wasi.mjs \
  --manifest /path/to/gcc-wasi-bundle/gcc-toolchain.v2.json \
  --suite /path/to/wasm-llvm/producer/gcc-wasi/atomic-libcall-fixtures.mjs \
  --output out/gcc-wasi-atomic-abi-browser
node scripts/verify-gcc-wasi.mjs \
  --manifest /path/to/gcc-wasi-bundle/gcc-toolchain.v2.json \
  --suite /path/to/wasm-llvm/producer/gcc-wasi/simd-extended-fixtures.mjs \
  --save-intermediates --output out/gcc-wasi-simd-extended-browser
node scripts/verify-gcc-wasi.mjs \
  --manifest /path/to/gcc-wasi-bundle/gcc-toolchain.v2.json \
  --suite /path/to/wasm-llvm/producer/gcc-wasi/vector-abi-cases.mjs \
  --output out/gcc-wasi-vector-abi-browser
```

SIMD qualification checks enabled and disabled requests, every frontend's
`-msimd128`/`-mno-simd128` argument, and the SDK's instruction/type-derived
`features.simd128`. GNU vector expressions are compiled by GCC; x86 intrinsics
are not translated. Browser ABI tests use GCC for all source units; the separate
producer native suite additionally checks bidirectional Clang interoperability
and raw narrow-integer Wasm exports. Atomic fixtures use explicit test-only
single-threaded providers to inspect libcall arguments, not an atomic runtime.
The extended SIMD suite includes NaNs, unsigned i64 comparisons, defined shift
counts, GNU C++ vector conditions, and constant shuffles. Run the producer's
`verify-simd-worker.mjs --suite .../simd-extended-fixtures.mjs` on its saved
qualification to verify actual WAT and object instructions. The vector ABI suite
uses multiple GCC translation units in Chromium; its separate native matrix
additionally verifies both Clang directions and exact exported function types.

For a bundle advertising `capabilities.longDouble`, qualify IEEE binary128
arithmetic, C/C++ calls, varargs, formatted I/O, libm and GNU iostreams with:

```sh
node scripts/verify-gcc-wasi.mjs \
  --manifest /path/to/gcc-wasi-bundle/gcc-toolchain.v2.json \
  --suite /path/to/wasm-llvm/producer/gcc-wasi/long-double-fixtures.mjs \
  --save-intermediates --output out/gcc-wasi-long-double-browser
```

All 42 cases include their own O0/O2 request and actual `ONLINE_JUDGE=1`
compiler option. Forty cases use the scalar profile; two mix binary128 with
explicit SIMD vector arguments. The native producer matrix additionally links
GCC and Clang objects in both directions. The SDK keeps Clang outside its
compilation path. Old manifests omit the capability and retain their original
link command; their binary64 long-double runtime limitation still applies.
The print/scan extension is part of `sysroot.tar` and its loading measurements.
Saved intermediate WAT/objects cover the main translation unit; the executable
contains all requested translation units.

The optional `capabilities.int128` metadata defaults to false for older bundles.
A producer must separately qualify signed and unsigned `__int128` code generation,
WASI argument/result and variadic ABI, runtime helpers, and actual native/Worker
execution before advertising it. It does not enable a compiler option, rewrite
source, change the link plan or establish qualification by itself. This SDK
contract alone does not claim that an existing bundle supports the extension.

The shared fixture set covers integer/floating-point operations, control flow,
calls/function pointers, globals, structures, allocation, libc I/O, dynamic-input
libm, C/C++ translation units and headers, static initialization/destruction,
libstdc++ iostreams, STL, and real
`-D` arguments. The ABI fixture expects wasm32 pointers and `long` to occupy four
bytes. The x86 reference expects eight bytes for those types. Source-level
`__GNUC__`/`__clang__` checks supplement the producer's pinned source/build receipts;
they do not replace build provenance.

Compiler qualification records stage arguments, diagnostic text, output hashes,
imports/exports, memory limits, Node output and Chromium output. It also rejects
requests for exceptions, RTTI, threads, dynamic linking, and an x86
AVX2/FMA CPU profile, and checks that an x86 target pragma is diagnosed. An x86
intrinsic or target pragma is not evidence of Wasm SIMD support.
SIMD requests are also rejected for the original scalar manifest. A new capable
manifest accepts explicit `simd: true`; it does not enable SIMD by default.

For native-produced GCC programs, provide the same fixtures' `.wasm` artifacts
and a source/build receipt:

```sh
node scripts/verify-gcc-wasi.mjs \
  --programs /path/to/native-output \
  --provenance /path/to/native-output/receipt.json \
  --cases c-hello,c-core,c-libm \
  --output out/gcc-wasi-native
```

The native receipt has `target: "wasm32-wasi"`,
`compiler: { "family": "gcc", "version": "...", "commit": "<40 hex digits>" }`,
and `programs` keyed by fixture id. Each program receipt contains a relative
`path`, `sha256`, and optional `bytes`. An optional nested `object` receipt binds
its relocatable Wasm object, whose linking metadata is checked separately.
Include compiler configure/build commands, source/patch identities, assembler,
linker and sysroot versions in that receipt; all receipt fields are retained.
This mode executes already-built programs and cannot establish that a browser
compiler works.

To repeat native qualification at another optimization level, or to check real
GCC unsupported-feature diagnostics, reuse the producer's successful native
receipt. The helper verifies the built GCC binary hashes, keeps all producer
receipts intact, and uses a new output directory:

```sh
node scripts/gcc-wasi-native-checks.mjs \
  --provenance /path/to/native-programs/provenance.json \
  --build-receipt /path/to/work/native-build.json \
  --optimization 2 \
  --cases c-hello,c-core,c-libm,c-multiple,c-defines,c-wasm32-abi,cpp-core,cpp-static-lifecycle \
  --output out/gcc-wasi-native-o2
node scripts/gcc-wasi-native-checks.mjs \
  --provenance /path/to/native-programs/provenance.json \
  --build-receipt /path/to/work/native-build.json \
  --mode diagnostics --output out/gcc-wasi-native-diagnostics
```

Native program mode checks relocatable objects, linked program format, and Node
WASI output. Pass its output and `provenance.json` to `verify-gcc-wasi.mjs` for
Chromium execution as well. The helper inherits native sysroot/linker arguments
from the baseline receipt, so a baseline without libstdc++ cannot qualify STL.
It applies the SDK's C++ `-fuse-cxa-atexit -fno-threadsafe-statics` configuration
and linker `--fatal-warnings` so a mismatched runtime ABI fails the check. It
also passes `-D__GCC_WASI_SINGLE_THREAD__=1`, matching the SDK's explicit
single-thread WASI libc header configuration. `c-errno` verifies that compiled
code reads the same `errno` storage that libc updates on `strtol` overflow;
the expected output compares with `ERANGE` instead of assuming its ABI-specific
numeric value.
`cpp-static-lifecycle` verifies global construction before `main`, one-time
function-local static construction, and local/global destruction in reverse
order at program exit. No source-level destructor workaround is used.
`cpp-typedef-void-o0` and `cpp-typedef-void-o2` cover direct and indirect calls to
functions returning a typedef of `void`, including an explicit `return;`. These
exercise the backend's return-label fix at both browser compilation optimization
levels. The native helper's `--optimization` deliberately overrides each selected
fixture's optimization, so run it once per optimization when checking that fix.
`c-wide-integers-o0` and `c-wide-integers-o2` verify signed and unsigned constants
larger than 32 bits, arithmetic, division, and libc's 64-bit varargs ABI. They
exercise host-width-safe WAT formatting in both GCC compilation configurations.
GNU iostream and multiple-source STL fixtures also run at both `-O0` and `-O2`,
the SDK's default optimization level. The compiler harness checks every frontend
invocation's actual optimization argument, alongside its output.

`initialAssets` measures every manifest execution payload plus the manifest,
both uncompressed and at gzip level 9. The server actually delivers bundle files
with gzip. It also records SDK module bytes and the actual complete initial
response payload. `network` counts server response writes and retains Chromium's
body/header measurements separately: Chromium sometimes reports zero bytes for
a Worker entry script. Every manifest asset must appear in the server transfer
log. The isolated Vite server serves SDK modules without compression; the report
states that delivery configuration explicitly. Source/license receipts are
provenance material, not initial compiler execution downloads.

Reference and test-host validation are deliberately separate:

```sh
node --test scripts/gcc-wasi-artifact.test.mjs
WASM_IDLE_RUN_GCC_WASI_WORKER_CONTRACT=1 \
  node --test scripts/gcc-wasi-worker-contract.browser.test.mjs
node scripts/verify-gcc-wasi-references.mjs \
  /path/to/wasi-sdk/bin/clang out/gcc-wasi-references
node scripts/verify-gcc-wasi.mjs \
  --programs out/gcc-wasi-references \
  --provenance out/gcc-wasi-references/clang-reference-provenance.json \
  --reference-clang \
  --cases c-hello,c-core,c-libm,c-multiple,c-wasm32-abi,cpp-core,cpp-stl-multiple \
  --output out/gcc-wasi-clang-reference-browser
```

The unit tests use synthetic Wasm only to test format validation and the Node
host. The reference script validates fixture semantics with host GCC and Clang
WASI, records the compiler identities, and excludes the intentionally GCC-only
macro case from Clang comparison. Neither result establishes GCC Wasm output.
An optional final comma-separated case list selects a focused reference check.
The synthetic Worker test deliberately prevents source compilation. It verifies
repeated execution with fresh state, recovery after a trap, already-aborted
requests, concurrent-request rejection, and termination of an unbounded guest.

The standalone linker host check uses Clang objects to isolate the real WASI
`wasm-ld` filesystem adapter, archive loading, libc/libm and multiple objects:

```sh
node scripts/verify-gcc-wasi-linker.mjs \
  /path/to/ld.wasm /path/to/wasi-sdk-33 out/gcc-wasi-linker-host
```

That report explicitly identifies the Clang reference inputs and cannot qualify
GCC code generation. GCC-produced objects are checked by the native/compiler
qualification paths above.

Preserve the existing GCC 13.3 x86 behavior with the producer's real suite and
three additional libc/libm and C/C++ multiple-source cases:

```sh
node scripts/gcc-wasi-x86-regression-suite.mjs \
  ../wasm-llvm/producer/gcc-browser/qualification out/gcc-x86-suite
node scripts/verify-x86-cross-gcc.mjs \
  /path/to/existing-gcc-x86/gcc-toolchain.v1.json \
  out/gcc-x86-suite out/gcc-x86-regression
```

All output directories must be new. Keep compiler sources and built SDK modules
fixed while qualification runs. Reports retain the exact fixture and manifest
identities, SDK/runtime JavaScript hashes, and distinguish partial, failed,
unsupported and successful work. Input hashes are rechecked before success is
reported, so rebuilding the SDK during qualification invalidates that run.
