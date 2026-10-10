# Grain browser integration

Grain runs the real upstream Grain 0.7.2 compiler in a fresh browser Worker for each run, then
executes the WebAssembly module that compiler emits.

## Runtime source

The compiler is upstream's own js_of_ocaml build, `grainc.bc.js` (`dune build @js`, js_of_ocaml
6.0.1, Binaryen compiled to JavaScript). Upstream ships it inside the `pkg` snapshot of the
[`grain-v0.7.2` release](https://github.com/grain-lang/grain/releases/tag/grain-v0.7.2) binary
`grain-linux-x64` (commit `49829d7966b38b177291f7e91f5eb81c65ec07aa`). `pnpm sync:wasm-grain`
downloads that binary, checks its pinned SHA-256, extracts `grainc.bc.js` and the bundled
`@grain/stdlib` 0.7.2 sources byte-for-byte, and checks the compiler against its pinned SHA-256.
No Grain source is translated or interpreted by wasm-idle.

The same script precompiles every stdlib module to a `.gro` object with that compiler, using the
same in-memory host as the browser Worker (`scripts/runtime-workers/grain-host.mjs`), so a browser
run only compiles the user's modules. The output is reproducible.

| File                         | Contents                                                     |
| ---------------------------- | ------------------------------------------------------------ |
| `grainc.js.gz.bin`           | gzip of upstream `grainc.bc.js` (20.9 MB → 3.4 MB)           |
| `stdlib.pack.gz.bin`         | gzip of the stdlib `.gr` sources and `.gro` objects (1.7 MB) |
| `runner-worker.js`           | generated Worker bound to the profile receipts               |
| `runtime-build.json`         | upstream source, release asset, and license receipt          |
| `LICENSE-grain-compiler.txt` | Grain compiler license (LGPL-3.0)                            |
| `LICENSE-grain-stdlib.txt`   | Grain standard library license (MIT)                         |

`src/lib/playground/wasmGrainVersion.ts` pins the compressed and decompressed sizes and SHA-256
hashes. The host preflights both gzip assets through the Core asset preflight (persistent cache
included). The Worker verifies the transferred bytes again, decompresses them, and verifies the
decompressed hashes before evaluating the compiler.

## Compiler host

`grainc.bc.js` uses js_of_ocaml's Node filesystem backend. The Worker provides a `process` object
and a `require` that returns a synchronous in-memory `node:fs` subset. The stdlib is mounted at
`/grain/stdlib`, and the workspace at `/work`. `process.exit` stops compilation. The compiler runs
as

```sh
grainc --stdlib /grain/stdlib --no-color --initial-memory-pages=N --maximum-memory-pages=M -o /work/main.wasm /work/main.gr
```

`M` is `limits.maxWasmMemoryBytes` in 64 KiB pages (512 MiB by default). Memory flags are not part
of Grain's object digest, so the precompiled `.gro` objects stay valid. Compiler messages are
streamed as terminal stderr. `File "...", line N, characters A-B` locations become editor
diagnostics. A compile error finishes the run with result `false`.

## Program I/O

The emitted module imports only `wasi_snapshot_preview1`. The Worker provides stdio: `fd_write`
to fds 1/2, `fd_read` from fd 0, plus args, clocks, random, and `proc_exit`. No directory is
preopened, so filesystem calls fail. A nonzero exit status finishes the run with result `false`.

Read stdin with `File.fdRead(File.stdin, n)` from `"wasi/file"`. The editor sample reads one line
byte by byte. On a cross-origin-isolated page, terminal input streams through the shared stdin
ring, and a blocked read waits for more input or EOF. Without `SharedArrayBuffer`, provide stdin
before the run starts.

## Validation

```sh
pnpm exec vitest run src/lib/playground/grain.test.ts
pnpm test:browser:grain
```

The unit test verifies the receipts and compiles and runs the editor sample over WASI stdin with
the real compiler in Node. The Chromium test drives the exported sandbox through:

- delayed streaming input and EOF
- prebuffered UTF-8 input
- workspace modules and program arguments
- diagnostics and exit codes
- cancellation and Worker recovery
- output, memory, and run-time limits

It also runs the default sample from the language selector with terminal input.
