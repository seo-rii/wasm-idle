# MemFS input: linear consumption and lazy diagnostics

## Why repeated suffix copies matter

When a program consumes n input bytes in chunks of k bytes, copying the remaining suffix after every read performs work proportional to n + (n-k) + (n-2k) + ... . For fixed-size small reads this approaches quadratic copy work. A cursor retains one input allocation and copies only the requested bytes into Wasm memory. UTF-8 encoding and destination copies still exist, but already consumed or not-yet-requested suffixes are not repeatedly reallocated.

stdinBytes and its read offset are reset together when input is replaced. Exhaustion releases the retained allocation. Multiple iovecs consume one logical stream in order, including multibyte UTF-8 split across vectors. A zero-length iovec must not ask for interactive input: zero capacity is not a request to block. EOF and explicit/interactive behavior remain on the original input protocol.

## Logging can be expensive even when output is disabled

Calling a no-op trace function still costs time if its arguments eagerly decode input, read memory strings or build previews. The implementation checks whether tracing is enabled before constructing those values. The writable trace callback remains supported; replacing it after construction must enable the expected tracing behavior. This is lazy diagnostic preparation, not disabling diagnostics globally.

## Boundaries and compatibility

This changes the JavaScript MemFS host, not Clang/LLD binaries, the user's compiled program or the WASI syscall layout. The seven regression cases transpile the actual MemFS class and supply explicit Wasm-loading/memory fixtures. They cover large input allocation behavior, vector boundaries, zero-capacity reads, reset, interactive input/EOF, disabled tracing and replacing trace at runtime. They do not by themselves constitute a real browser/compiler integration test.

The regression harness is now invoked by a normal root Vitest test, so CI does not merely rely on a manually run script. That collector passed locally with the CI dependency snapshot (Node 24.21.0 / TypeScript 6.0.3 / Vitest 5.0.3). The preceding feature head already passed remote packages, required Clang browser execution, LSP smoke and LLDB workflows; the new collector/documentation head still requires its own CI result.

## Expected benefit and measurement

The expected benefit is lower host copying and garbage-collection pressure for large input consumed in small reads, plus lower disabled-trace overhead. This is an algorithmic argument, not a measured browser speedup. Small inputs or compute-bound programs may change little. The compiler/runtime download size is unchanged.

Measure a fixed large input with several read sizes, multi-iovec reads, C and C++ stdio, Unicode boundaries and interactive EOF/cancellation. Compare output hashes, wall time, allocations and peak/retained memory. Separate cold startup from warm execution; do not attribute faster asset caching to the input cursor. Keep the original zero-read and cancellation assertions when composing this branch with other runtime changes.
