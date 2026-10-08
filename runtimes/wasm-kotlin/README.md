# Kotlin browser candidate

Internal foundations for the official Kotlin compiler source port. **Kotlin is
not publicly registered and there is no browser compiler bundle in this change.**
These files are not an exported runtime package or a Kotlin source executor.

The producer lives in
[`wasm-llvm/producer/kotlin-browser`](https://github.com/seo-rii/wasm-llvm/blob/1a9f4a33f5981848711277d7cd9526888c4de6b8/producer/kotlin-browser/README.md).
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
defines 48/32. The host writes the full standard layout. Linear-memory bounds
cannot detect an undersized logical allocation inside that memory; this host
therefore cannot prove allocator compatibility or repair the upstream allocation.
Real Kotlin-generated fixture/allocator canaries and any matched stdlib patch
remain required.

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

## Remaining integration

An accepted official parser/FIR/KLIB/IR/Wasm compiler and matching stdlib assets
must arrive from the producer first. The runtime still needs receipt/trust-root
verification before executing loader JS, bounded assets/KLIBs, a compiler bridge,
actual import/export and entry verification, and a complete accepted WASI profile.
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
