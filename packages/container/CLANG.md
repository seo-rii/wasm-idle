# Experimental Clang command adapter

Import `createClangAdapter` from `@wasm-idle/container/adapters/clang`. Registration
requires application-pinned `clangSha256`, `linkerSha256`, and a canonical absolute
`linkerPath` below `/opt/toolchains`. Registration performs no download. A command
distribution prepares both executable files and the full selected sysroot closure
before starting the Worker. The linker must be mounted readonly. Compiler bytes
and linker bytes are verified again by the LLVM tool host, and never fetched by
the Worker.

The adapter uses the common snapshot lease, memory/import admission, deadlines,
and forced Worker termination. Driver and linker see the same private filesystem
and share byte stdin/stdout/stderr. A normal nonzero exit commits the snapshot;
a trap or termination discards it. This is a batch contract, not live file sharing
or a shell process model. Each tool has a separate memory; the configured maximum
applies per instance and is not an aggregate JS heap or browser memory budget.

Original argv remains intact. An opt-in LLVM producer patch calls the synchronous
`wasm_idle_tool_host.exec_v1` ABI to run its pinned linker. No diagnostic output is
parsed to reconstruct commands. Configure the producer's linker path with its
normal driver option (for example `-fuse-ld=/opt/toolchains/<id>/bin/wasm-ld`).
The pinned WebAssembly driver uses `-fuse-ld` for this selection; `--ld-path` does
not select its linker. The host preserves both options as provided and leaves
interpretation and diagnostics to Clang.
Target, sysroot, resource directory and ABI defaults belong in an explicit pinned
distribution profile; the host does not infer or silently replace user options.

Both qualified modules retain `exec_v1`: LLD's optional error-handling script
uses the same LLVM Support entry. The host supplies the import but rejects all
LLD child requests with `-1`. Only top-level Clang may invoke the pinned linker;
error-handling scripts and recursive linker execution are unsupported.

Non-root working directories require both modules to implement the
`wasm_idle_process_v1.initial_cwd` startup contract and call real libc `chdir`.
The old producer modules cannot satisfy that contract just by receiving PWD or a
`.` preopen. They are rejected for non-root cwd. User artifacts without that
extension can still use the ordinary Preview1 profile with explicit `cwd: '/'`.

The fixture `scripts/test-clang.mjs` takes `CONTAINER_CLANG_WASM` and
`CONTAINER_LLD_WASM` paths and writes optional `CONTAINER_EVIDENCE`. Set
`CONTAINER_CLANG_BRIDGE=1` to require actual driver-to-linker dispatch and artifact
execution. It exercises `-c`, `-E`, `-S`, includes/defines, relative paths, spaces,
response files and an invalid option with the real compiler. Tiny protocol tests
do not qualify this CLI. Full C/C++ headers, browser execution and shell integration
require their own recorded producer/browser receipts before release promotion.

The opt-in `test:browser:clang` fixture bundles the current Container, Core and LLVM
tool-host source with esbuild into three local modules. It therefore exercises
the real Clang Worker without relying on a page import map or another checkout's
`dist` directory. `node scripts/test-clang-browser.mjs --build-only` prepares those
bundles and reports `qualification: not-run`; it does not launch Chromium, load
compiler binaries, or qualify the adapter.

For actual qualification, supply `CONTAINER_CLANG_WASM`, `CONTAINER_LLD_WASM` and
`CONTAINER_SYSROOT` as in the Node fixture. The sysroot must match the full
selected-target pin `91899da37610664152a2a1cbae3632f35ff8803e32f006225c1c4fb50f341402`
(2,285 entries, 2,168 files). Additionally set:

- `CONTAINER_PRODUCER_RECEIPT` and `CONTAINER_PRODUCER_RECEIPT_SHA256`: the completed
  opt-in producer's `build-receipt.json` and independently reviewed digest.
- `CONTAINER_PRODUCER_SMOKE` and `CONTAINER_PRODUCER_SMOKE_SHA256`: the producer's
  successful `smoke-cli.mjs` receipt and digest, referencing the same build receipt
  and exact Clang/LLD bytes.
- `CONTAINER_EVIDENCE`: a new output file; an existing receipt is never overwritten.
- Optional `CHROMIUM_PATH` and `CONTAINER_CLANG_TIMEOUT_MS` (default 120,000, maximum
  300,000 per compiler invocation).

Missing inputs, failed producer gates and integrity mismatches fail explicitly.
The fixture starts a fresh loopback origin and Chromium context, applies CSP
(`script-src 'self' 'wasm-unsafe-eval'`, local module Workers, same-origin fetch),
COOP and COEP, and records browser/OS/source/bundle/asset identities. It uses no
JavaScript `unsafe-eval`, Blob Workers, remote host code, or production deployment.
Optional repository browser-test cookies are scoped to that local origin.

The cold run checks metadata-only command lookup before any asset body request;
real `-c/-E/-S`, relative include/define options, response files and paths containing
spaces and Korean; separated raw diagnostic bytes; multi-object driver/linker
dispatch; C stdio and C++20 template/header compilation; and all three generated
artifacts through the WASI adapter. Both tools start in the real non-root cwd with
a deliberately incorrect `PWD`. The C artifact reads binary stdin and preserves
NUL, non-UTF-8 and UTF-8 bytes on separate stdout/stderr streams. A fresh page then runs Clang again using the
verified persistent cache. The server requires exactly one body request per
pinned asset across both pages with HTTP caching disabled. Worker/process cleanup
and browser/CSP errors are checked after execution.

Sysroot extraction is a trusted local fixture preparation step after the first
command request. It preserves the complete pinned archive and mounts it readonly;
it does not add general archive extraction to runtime distributions. The fixture
only promotes its measured Chromium batch snapshot profile when every gate passes.
It does not qualify a real shell, live filesystem, persistence, performance, all
header combinations, or another browser. Until an actual receipt is recorded,
browser Clang qualification remains pending.
