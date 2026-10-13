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
normal driver option (for example `--ld-path=/opt/toolchains/<id>/bin/wasm-ld`).
Target, sysroot, resource directory and ABI defaults belong in an explicit pinned
distribution profile; the host does not infer or silently replace user options.

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
