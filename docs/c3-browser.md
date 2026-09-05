# C3 browser integration

C3 runs the real C3 0.8.3 compiler and builtin LLVM/LLD linker in a fresh browser Worker for each run. The producer is `wasm-llvm/producer/c3-browser`, pinned to upstream [C3 commit 1d155ee](https://github.com/c3lang/c3c/tree/1d155ee04d3b607261b99aa15ed5eefd6d7db284). Its LLVM library is the checksum-verified upstream Emscripten archive reporting LLVM 22.1.8; this integration does not rebuild that LLVM archive.

The current program target is `wasm32-unknown-unknown`. Export `fn void main() @wasm("main")`. Only function imports `env.readByte` and `env.writeByte` are supported: read returns one UTF-8 byte or `-1` at EOF, and write consumes its low eight bits. The editor's C3 sample echoes input with this ABI. `std::io`, WASI, program arguments, custom compiler flags, and debugger integration are unavailable in this profile. Other unresolved guest imports are rejected before instantiation.

The bundled standard library is available to the compiler. Each `.c3` workspace file is compiled from its original source; there is no source translation. Source diagnostics retain file, line and column information. Terminal input streams through the shared stdin ring on an isolated page. Without `SharedArrayBuffer`, supply prebuffered stdin or finish terminal input before compilation starts.

## Local assets and acceptance

Build and verify the separate C3 producer, including its Node and Chromium acceptance, before syncing its release directory:

```sh
pnpm install --frozen-lockfile
pnpm sync:wasm-c3 --producer /absolute/path/to/wasm-llvm
pnpm run build:publish-deps
pnpm test:unit:c3
pnpm test:browser:c3
```

Sync verifies the producer manifest, build and acceptance receipts, then verifies each copied asset. It creates local `static/wasm-c3/{c3c.mjs,c3c.wasm,producer-receipt.json,runner-worker.js}` and the code-pinned `wasmC3Version.ts` profile. The generated binary assets are not committed or deployed by this change. A host must serve them before selecting C3. Set `runtimeAssets.c3.baseUrl` (or `PUBLIC_WASM_C3_BASE_URL`) to a mirror containing exactly these bytes; `rootUrl` uses its `wasm-c3/` subdirectory.

The host verifies the compiler, receipt and Worker before execution and transfers owned compiler bytes once. The Worker verifies the transferred assets again and imports the verified Emscripten loader from a Blob. `wasmBinary`, `FS` and `callMain` use the actual upstream compiler API. Each run has a new Worker and a new virtual filesystem; cancellation, timeouts and completion terminate that Worker.

The Chromium suite exercises the exported playground API and the actual language selector, default editor sample, and delayed terminal input. It compiles different sources, checks UTF-8/EOF, source diagnostics, output limits, compile/run timeouts, stdin cancellation and recovery, compiler allocation failure, and guest `memory.grow` at the boundary. Node tests also cover malformed/unsupported Wasm memory declarations and the stdin EOF notification race.

## Memory and deadlines

C3's default linear-memory budget is **1 GiB**, declared by the C3 adapter and applied by both direct calls and the Core bound sandbox. Other languages retain their existing defaults. A caller's explicit `limits.maxWasmMemoryBytes` always takes precedence; a lower limit is never silently increased. The editor displays this C3 memory requirement.

At the default budget the compiler has a maximum of **960 MiB** and the guest **64 MiB**. The guest reservation is the smaller of 64 MiB and one eighth of the requested budget, rounded down to Wasm pages; the compiler receives the rest. Requests above 2 GiB are capped at 2 GiB. These maxima bound the sum of the two live Wasm linear memories. They do not measure JavaScript heap, downloaded bytes, virtual filesystem copies, browser JIT memory, or total process RSS. Compiler arenas use the official `--max-mem 64` option in addition to the actual Wasm memory maximum.

The producer compiler defines its own memory with a 128 MiB initial size and a 2 GiB maximum. The consumer verifies the original compiler hash, then lowers only its Wasm memory-section maximum. It similarly caps the newly linked guest. Only one defined, unshared wasm32 memory is accepted; imported, multiple, shared, memory64, malformed, or initially oversized memory declarations are rejected. Code and data sections are unchanged and both original and derived modules are validated by `WebAssembly.compile`.

`sandbox.memoryEvidence.current` records the original and derived SHA-256 hashes, initial/maximum byte counts, and total requested budget. Evidence is emitted before compiler instantiation and updated after linking the guest. Lower-budget Chromium tests observe the real Emscripten `WebAssembly.Memory.grow(): Maximum memory size exceeded` failure. The guest boundary test grows to 64 MiB and observes `memory.grow` returning `-1` on the next page.

Asset and startup deadlines reuse the existing host. Once a run is dispatched, the compilation deadline covers compiler initialization, compilation and linking. The execution deadline starts when the compiled module is ready to instantiate, including guest initialization and stdin waits. All deadline timers stay on the host thread, so they can terminate a blocked or nonterminating Worker.
