# Experimental Clang command adapter

Import `createClangAdapter` from `@wasm-idle/container/adapters/clang`. Registration
requires application-pinned `clangSha256`, `linkerSha256`, and a canonical absolute
`linkerPath` below `/opt/toolchains`. Registration performs no download. A command
distribution prepares both executable files and the full selected sysroot closure
before starting the Worker. The linker must be mounted readonly. Compiler bytes
and linker bytes are verified again by the LLVM tool host, and never fetched by
the Worker.

Shell applications may opt into `executableOutputProfile: 'wasi-preview1-process'`.
After a successful compiler job, changed files below `/workspace` gain execute bits
only when their actual module has bounded memory, supported imports, exported memory
and `_start`, and the `initial_cwd` process ABI. Execute bits follow existing read bits.
This publishes executable metadata with the same snapshot commit as the output bytes.
Unchanged files, failed jobs, other targets and object/library outputs remain data;
filenames and extensions do not grant execution rights. The execution adapter still
checks the module and process policy at every launch. Without this option applications
can use the explicit `wasm-run` command for otherwise supported artifacts.

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

The selected C++20 fixture passes `-fno-exceptions` explicitly. The existing pinned
sysroot does not link the exception allocation/throw symbols required by the same
template fixture with exceptions enabled; those real linker diagnostics remain a
recorded unsupported boundary. The adapter never inserts or ignores this flag,
and the full selected-target headers and libraries are preserved.

Both qualified modules retain `exec_v1`: LLD's optional error-handling script
uses the same LLVM Support entry. The host supplies the import but rejects all
LLD child requests with `-1`. Only top-level Clang may invoke the pinned linker;
error-handling scripts and recursive linker execution are unsupported.

For compile-and-link jobs, the pinned driver disables in-process cc1 and requests
its own multicall compiler. The adapter opts in to the exact empty-program argv
form `['', 'clang', '-cc1' | '-cc1as', ...]` and executes the same verified module
with unchanged arguments. Only the root driver may start these jobs or its pinned
linker; children cannot recurse. Very long child jobs serialized only as `@rsp`
remain unsupported; ordinary root response files are handled by Clang itself.

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
do not qualify this CLI. The producer's selected-header regression corpus requires
its own recorded evidence before command-alpha promotion. Actual shell integration
is a separate milestone.

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
NUL, non-UTF-8 and UTF-8 bytes on separate stdout/stderr streams. A fresh page then
runs `clang --version` using the verified persistent cache; this reload check does
not repeat the full compilation corpus. The server requires exactly one body request per
pinned asset across both pages with HTTP caching disabled. Worker/process cleanup
and browser/CSP errors are checked after execution.

Sysroot extraction is a trusted local fixture preparation step after the first
command request. It preserves the complete pinned archive and mounts it readonly;
it does not add general archive extraction to runtime distributions. The fixture
only promotes its measured Chromium batch snapshot profile when every gate passes.
It does not qualify a real shell, live filesystem, persistence, performance, all
header combinations, or another browser.

The original [Chromium receipt](test/fixtures/clang-browser-evidence.json) records
a passing run on Chromium 153.0.8010.12/Linux x64 at application commit
`fe5e3a85277e2dec02347d9d5362e5656ed3e5b7`. Its SHA-256 is
`b04774f0181150e46a4121dccbcf14ecb584bcf968133af585cbcae7e256fb9a`;
all 65 recorded source hashes match that tested snapshot. The cold page completed
nine compiler invocations and three actual WASI artifact runs, including C binary
stdio and the explicit exception-free C++20 profile. All 13 guest Workers across
the cold and reload pages were reclaimed, process inspection was empty, and no
browser/CSP errors were recorded.

Boot and command metadata lookup downloaded zero asset bodies. Cold execution
downloaded Clang gzip (16,270,174 bytes), LLD gzip (8,178,107 bytes), and the full
sysroot tar (35,328,000 bytes) once each. Reloading the page and running the version
command added no body requests with HTTP caching disabled. The independent
[process supervision record](test/fixtures/clang-browser-process-evidence.json)
reports exit 0 and all owned OS descendants reaped. These receipts retain their
original tested identity when later documentation or evidence commits are added.

## Optional live filesystem and byte streams

`createLiveClangAdapter` from `@wasm-idle/container/adapters/clang-live` registers
the separate `llvm-clang-tool-host-live-v1` profile. It requires a secure isolated
browser, SharedArrayBuffer, and the same pinned compiler/linker process ABI. It
does not change the snapshot adapter or the previously qualified Bash distribution.
Registration remains metadata-only; the command resolver prepares verified bytes
and the complete readonly sysroot before starting this adapter's Worker.

The live adapter accepts the snapshot adapter's pins, `linkerPath`, `compilerPaths`
and output qualification option, plus `pipeBytes` and `maxBlockedIoMs` from the
live WASI profile. `workerFactory` must create the live Clang worker. The canonical
paths must identify real readonly executable files. For the selected multicall
producer, mount the compiler at `/opt/toolchains/llvm/bin/llvm`, use that exact
`argv0` and `compilerPaths` alias, and prefix the original user arguments with
`clang` and the pinned target/sysroot/resource/linker defaults. The driver then
resolves its own cc1 job to the same multicall executable without rewriting argv.
Other `compilerPaths` remain explicit trusted host aliases: dispatch uses the
configured pinned compiler module, rather than loading code from the alias file.

The live owner retains up to two immutable compiler/linker modules, bounded by
`moduleCacheBytes` (256 MiB by default, charged by logical source bytes plus cache
keys; zero disables retention). Each command still snapshots and hashes its actual
owner-side input bytes, including cache hits. The key includes the pinned digest,
logical length, native compilation key, memory/cwd admission profile and asset
limit. Workers receive single-use owner service ports instead of compiler/linker
byte buffers, and repeat import/export/cwd admission before creating fresh tool
instances, memories and descriptors. Cancellation closes those ports and retires
the command Worker; abandoned native compilation cannot publish a cached module.
At most two native preparation operations (hashing or compilation) run at once,
including abandoned work that the engine cannot cancel; cancelled queued requests
are removed before they can start native work.

The owner-side executable reads, snapshots and integrity hashes remain costs of
each invocation. Cache accounting does not measure native compiled-code memory.
`adapter.clearModuleCache()` explicitly releases retained module references; the
bounded cache otherwise lives with the adapter so sharing it between containers
remains supported. Disposing a container closes its command endpoints and Workers
without clearing another owner's shared adapter. Custom Worker proxies should
forward the optional `postMessage(message, transfer)` list. A synchronous
`DataCloneError` falls back to the original verified-byte preparation path for
older proxies that cannot transfer ports. The snapshot adapter is unchanged.

Each actual driver, cc1 and linker file operation reaches the common owner VFS.
Other live processes and the editor can observe completed writes while compilation
continues. There is no writer lease or implicit rollback: normal errors, crashes
and cancellation retain changes already made visible, subject to the compiler's
own file cleanup. Concurrent source edits can affect a compilation; callers that
need a fixed input revision should keep using the snapshot profile or arrange an
explicit source revision themselves.

Stdin, stdout and stderr use separate bounded byte endpoints. The default capacity
is 64 KiB per endpoint; output must be drained concurrently. Child LLVM invocations
inherit descriptor references and cannot close the parent's remaining reference.
No output is retained inside the tool worker. Worker generations, blocked-I/O
deadlines and forced cancellation use the same owner transport as live WASI. One
compiler invocation per adapter instance is admitted; each nested tool has its
own linear memory. These are per-instance limits, not an aggregate heap/RSS bound.

With `executableOutputProfile: 'wasi-preview1-process'`, the owner records actual
create/truncate/write/rename operations from this compiler invocation. On exit 0
it asynchronously validates each current `/workspace` output's memory/imports and
command ABI before granting read-derived execute bits. It uses inode revision
tokens, not editor watcher delivery or filename extensions. A foreign write,
unlink, rename away and back, or ancestor directory move invalidates an earlier
token; an intervening edit between compiler writes permanently disqualifies that
invocation's output. An edit or cancellation during asynchronous validation also
prevents the grant. Browser module compilation itself has no cancellation API;
an already pending validation can finish later but cannot publish after disposal.
Temporary regular-file rename is tracked, while moving an
entire output directory conservatively leaves its descendants unqualified.
The journal is bounded by the invocation's inode budget, including subsequently
unlinked outputs; exhausting it disables the automatic grant for that invocation.
Existing execute permissions are not revoked by this mechanism. A valid file
left as data can still run through explicit `wasm-run` after normal ABI checks.

`test:clang:live --node|--browser --config /absolute/configuration.json --output
/fresh/absolute/directory` runs the same fixture against actual pinned Clang/LLD
and the full process sysroot. The configuration uses the existing producer,
producer-smoke and process-sysroot receipt fields from shell acceptance; SDK/Bash
assets are not loaded. The fixture covers version output with owned stdin EOF and
with initially closed stdin, native cc1/linker dispatch, generated
artifact execution, streamed stdin reading a changed header, cancellation after
a file write becomes visible, and a concurrent same-byte output edit. It records
the exact bundled source hashes, rechecks them after execution and accounts for
all owned Workers. Neither tiny WASI tests nor a successful bundle build qualifies
this compiler profile.

The pinned Clang driver checks standard descriptors before processing arguments.
For one closed descriptor it opens `/dev/null` and expects the lowest free fd to
replace that descriptor. The live host preserves the initial `EBADF` state and
performs this real device open; it does not silently substitute EOF for a closed
channel. The upstream WASI fixup lacks `dup2`, so repairing several simultaneously
closed standard descriptors is outside this producer's qualified CLI profile.

The [live LLVM qualification records](test/fixtures/clang-live/README.md) record
12 passing real-compiler checks in both Node Workers and Chromium, seven retired
guest Workers in each, and 228 passing unit/contract tests at commit `66ac18fa`.
That evidence is specific to this opt-in command profile; the separate snapshot
Bash distribution retains its own manifest and qualification history.

The [closed-input follow-up](test/fixtures/clang-live/null-device/README.md) at
`29435e8a` records 14 passing checks in each environment and 235 unit/contract
tests. Both real version invocations return the same output, and each environment
retires all nine guest Workers. Its source attestation maps the captured source
hashes to the committed fix; the original qualification records stay unchanged.
