# Kotlin browser candidate

Internal foundations for the official Kotlin compiler source port. **Kotlin is
not publicly registered and there is no browser compiler bundle in this change.**
These files are not an exported runtime package or a Kotlin source executor.

The active producer work builds the official compiler source for a wasmJs browser
host and ports its FIR, KLIB, IR and Wasm backend dependencies. The full compiler
build still fails; this consumer has no callable compiler bundle and has not
compiled fresh Kotlin input in a browser.

The existing Hello World/Fibonacci browser runs are WASI runtime fixtures
compiled on the development machine. They validate console execution and remain
separate from browser compiler acceptance. The bootstrap reference
`2.5.0-dev-10106` has not been proven to represent the selected source commit.

The producer lives in
[`wasm-llvm/producer/kotlin-browser`](https://github.com/seo-rii/wasm-llvm/tree/feat/kotlin-browser-foundation/producer/kotlin-browser).
It pins development source `4d78aae1e337cd40f69baa865aed950fe807a775` and records
the still-blocked G0 dependency/tool/baseline work. The intended compiler host is
`wasmJs`; initial user output is `wasmWasi`/WASI Preview 1. The two stdlib and host
permission sets must remain separate.

## Implemented boundaries

- `src/sources.ts` snapshots a bounded multiple-file request, rejects traversal,
  backslashes, duplicate/file-directory paths, and non-`.kt` input, and preserves
  source Unicode, BOM, CRLF, and file order. Diagnostic offsets and 1-based
  columns use UTF-16 code units. Multiple-file input validation is not a public
  multiple-file compiler support claim.
- `src/protocol.ts` checks candidate request identity/profile and explicit entry
  metadata. It rejects compiler option injection, stale request/generation
  failures, failed-result artifacts, unknown source/range diagnostics, and
  diagnostic count/byte overflows. This is data validation, not FIR entry
  discovery, a compiler bridge, or a success-artifact verifier.
- `src/wasi.ts` implements only `fd_read`, `fd_write`, and `poll_oneoff` against
  standard Preview 1 layouts: subscription 48 bytes and event 32 bytes, alignment 8. It provides prebuffered stdin plus EOF, non-consuming readiness, separate
  incremental stdout/stderr UTF-8 decoding, aggregate output-byte limits, and
  bounds/iovec/count/overflow checks before side effects. It supplies no generic
  success stubs or filesystem/network access.
- `src/program.ts` compiles and instantiates raw Wasm inside a disposable Worker,
  permits only the three console imports plus genuine Web Crypto `random_get`,
  and calls the explicit `_start` command. Random requests are bounded to 1 MiB
  and split at Web Crypto's 64 KiB call limit. Each run gets fresh memory, console,
  and instance state. This function does not interpret Kotlin source.
- `src/program.worker.ts` accepts one request with a request ID/generation,
  program and stdin ceilings of 8 MiB each, and a Worker-owned output ceiling of
  1 MiB. Output-limit failures and guest exceptions are distinct from completion.

The command runner checks zero parameters before calling `_start` and rejects an
observed return value afterward. This is not full declared WasmGC type validation;
return checking occurs after guest execution. Start-section I/O is unsupported
with the current exported-memory profile because the instance is not available
until instantiation returns. External watchdogs must begin before compilation
and instantiation, then terminate the Worker on timeout or cancellation.

The console exposes a memory getter so the host can provide imported memory
before instantiation if the module start function calls imports. With exported
memory, callers must not assume start imports can wait until instantiation ends.
Shared memory and streaming stdin are unsupported. `finish()` flushes decoding
once and closes the console. Validation/output-limit failures preserve input,
output streams, and guest result counters.

The pinned
[Kotlin stdlib](https://github.com/JetBrains/kotlin/blob/4d78aae1e337cd40f69baa865aed950fe807a775/libraries/stdlib/wasm/wasi/src/kotlin/io.kt)
currently requests 20/26-byte polling buffers, whereas pinned
[wasi-libc](https://github.com/WebAssembly/wasi-libc/blob/165235bc467d5fa52d424f5d82587dfb76ed9d54/libc-bottom-half/headers/public/wasi/wasip1.h)
defines 48/32. Source inspection of Kotlin's allocator confirms 8-byte rounding:
the original event receives 32 bytes, but the subscription receives only 24.
The producer now builds the complete selected-source target stdlib with an exact
two-line allocation patch. Programs using this KLIB execute successfully in
Chromium, including stdin polling. The host writes the full standard layout.
Linear-memory bounds
cannot detect an undersized logical allocation inside that memory; this host
therefore cannot prove allocator compatibility or repair the upstream allocation.
Kotlin allocator canaries and the complete ABI/runtime acceptance corpus remain
required.

## Focused verification

Run from the wasm-idle repository root:

```sh
pnpm check:kotlin-candidate
pnpm test:unit:kotlin
pnpm test:browser:kotlin-wasi
```

The unit tests cover the source/protocol boundaries and console memory/UTF-8/EOF/
limit semantics, including actual Wasm → WASI import calls. The browser command
uses Chromium and a real module Worker with networking disabled. It compiles the
checked-in `test/wasi-probe.wat` ABI fixture with the existing WABT dependency,
tests full-sized canaries/readiness/EOF and split Unicode stdout/stderr, and
requires zero network requests. The regular unit command excludes the browser
case; browser coverage is a separate command and is never inferred from Node.

`evidence/chromium-wasi-abi.json` records the executed browser probe and hashes.
Regenerate into a **new** file with `KOTLIN_WASI_EVIDENCE_FILE=/path/to/new.json`
while running the browser command. The receipt explicitly leaves Kotlin compiler
build, Kotlin compile/run, and Kotlin stdlib allocator acceptance `not-run`.
Changing the adapter or WAT fixture invalidates that probe receipt.

## Execution of JVM-compiled runtime fixtures

First use the producer's hash-verified bootstrap and two-stage official compiler
build, then supply its newly created output directory explicitly:

```sh
# In wasm-llvm; downloaded JAR/KLIBs and generated programs remain in ignored out/.
node producer/kotlin-browser/build/bootstrap.mjs prepare
node --experimental-wasm-exnref producer/kotlin-browser/build/baseline.mjs \
  --output out/kotlin-browser-baseline/my-run

# In wasm-idle; use the absolute output directory from the preceding command.
KOTLIN_BASELINE_DIR=/absolute/path/to/wasm-llvm/out/kotlin-browser-baseline/my-run \
  pnpm test:browser:kotlin-programs
```

Node 24.1.0 needs the explicit exnref flag to inspect these Kotlin 2.5 artifacts.
The executed Chromium 153.0.8010.12 browser uses default flags. The test verifies
source/program hashes against the build receipt and runs sequential fresh Workers:

| Program                         | stdin  | Actual stdout   | Status       |
| ------------------------------- | ------ | --------------- | ------------ |
| Hello World                     | empty  | `Hello World\n` | completed    |
| Fibonacci                       | `10\n` | `55\n`          | completed    |
| Fibonacci                       | `20\n` | `6765\n`        | completed    |
| Hello World, zero output budget | empty  | empty           | output-limit |
| Hello World after failure       | empty  | `Hello World\n` | completed    |

Networking is disabled for execution; the recorded request count is zero. The
main-thread heartbeat continues during Worker execution. The console fixture's
full-sized allocator canaries remain separate from these real Kotlin programs.
Successful stdin polling does not prove the original stdlib's logical allocation
matches the complete Preview 1 structure.

[`evidence/chromium-kotlin-programs.json`](evidence/chromium-kotlin-programs.json)
records execution with the official unpatched bootstrap stdlib. The separate
[`evidence/chromium-kotlin-patched-stdlib.json`](evidence/chromium-kotlin-patched-stdlib.json)
records all five scenarios with the complete target stdlib built from the selected
Kotlin source pin and ABI patch. Its KLIB is 4,111,645 bytes; its source commit,
patch, recipe, KLIB and producer receipt identities are recorded and the copied
library payload is verified before the browser test. The compiler remains the
JVM-hosted bootstrap reference, whose source commit is unknown.

To reproduce this variant, follow the producer's
[stdlib source recipe](https://github.com/seo-rii/wasm-llvm/tree/feat/kotlin-browser-foundation/producer/kotlin-browser/stdlib-probe)
and set `KOTLIN_BASELINE_DIR` to that recipe's new baseline output directory.
Set `KOTLIN_PROGRAM_EVIDENCE_FILE=/path/to/new.json` to regenerate a receipt, and
`KOTLIN_BASELINE_SCREENSHOT=/path/to/preview.png` to capture the displayed real
source/output results. Receipts explicitly keep browser Kotlin compilation,
candidate R0 and target-allocator canaries `not-run` and public support false.
The patched-target receipt distinguishes observed browser example success from
full stdlib/ABI acceptance. No precompiled fixture is counted as a browser compiler
success.

## Remaining integration

An accepted official parser/FIR/KLIB/IR/Wasm compiler and matching stdlib assets
must arrive from the producer first. The runtime still needs receipt/trust-root
verification before executing loader JS, bounded assets/KLIBs, a compiler bridge,
complete artifact/import/export/type verification and a complete accepted WASI profile.
Current imports alone do not promise all Kotlin-generated programs can link.

Public integration must retain `ExecutionRequest`/`ExecutionResult`, structured
diagnostics, termination reasons, limits, and AbortSignal. Compile/run Workers
must execute sequentially under the current `maxWorkers=1` policy; external
deadlines/termination and new generations must handle synchronous compile,
cancel, trap, and recovery. Source sessions cannot reuse mutable FIR/IR state.
No GC heap hard cap, accepted feature set, performance number, or offline Kotlin
compilation is claimed by these foundations. Language registration waits for
actual browser compilation/execution, differential language tests, runtime I/O,
offline/cache corruption, cancellation/recovery, resource, and release gates.
