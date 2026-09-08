# LFortran browser execution

`LFORTRAN` is an experimental, separate Fortran backend. It uses the real upstream
LFortran compiler at `ab867a23029b0c1b1c3131b5a0e2363709be37f0`
(`0.65.0-97-gab867a23`), compiled with LLVM 22.1.8 and Emscripten 4.0.9 by
[`wasm-llvm/producer/lfortran-browser`](https://github.com/seo-rii/wasm-llvm/tree/74f414095fd2f1b91e5ff9aac1b22a47bc98d6a1/producer/lfortran-browser).
The existing `FORTRAN`/`F77` f2c backend and existing file/URL aliases retain their behavior.
Select **LFortran (experimental)** or use `?lang=lfortran` to choose this backend.

The producer includes a correction to upstream ASR statement-transform state:
formatted PRINT inside IF/DO bodies retains its enclosing control flow. Nested
PRINT, accumulated loop state, and both EOF/non-EOF branches are regression gates.

The evaluator compiles source through LLVM, links an Emscripten side module, and
executes it inside its compiler Worker. Each invocation receives a fresh Worker
and filesystem. This is the upstream LLVM evaluator, not LFortran's separate
custom Wasm backend or a standalone WASI executable.

## Local artifacts

Build and validate the producer, then pass its artifact directory explicitly:

```sh
pnpm run sync:wasm-lfortran /path/to/wasm-llvm/out/lfortran-browser/artifacts
pnpm run prepare:app
pnpm run test:browser:lfortran
```

The sync command verifies the exact producer receipt and all three compiler
assets against `scripts/wasm-lfortran-assets.lock.json` before replacing any
output. It also binds the consumer Worker hash in the generated
`wasmLfortranVersion.ts`. A different producer build requires a reviewed lock
update. It does not accept an arbitrary receipt merely because validation says
`passed: true`.

The synced bundle is about 82 MB and is ignored by Git. `lfortran.data` is stored
as `lfortran.data.bin` to receive the correct MIME type; its bytes remain identical
to the producer output. Browser preflight verifies sizes and SHA-256 hashes before
transferring buffers to the Worker, which verifies them again before executing JS
or Wasm. The Emscripten factory receives the verified Wasm and preload data
directly. Generated side modules are loaded from that invocation's memory filesystem.

`runtimeAssets.lfortran.baseUrl` can relocate this exact reviewed bundle. The
default location is `<rootUrl>/wasm-lfortran/`. There is no automatic download,
release upload, or deployment step in this integration.

`pnpm page:build` requires this verified local bundle as an explicit release input.
On a fresh checkout, run the sync command above with the reviewed producer artifacts
first. The page build checks every compiler, receipt, and Worker against the committed
consumer profile before building, then checks the copied `build/` output after
compression. Missing files, different hashes, or a stale gzip delivery index fail
the build. The publish script repeats the output check before publishing. These
checks never rewrite the committed profile or fetch an unpinned replacement.

Run `pnpm verify:page-lfortran` to check local input or
`pnpm verify:page-lfortran build` to check prepared page output.

## Supported execution contract

- Real list-directed `READ`, delayed terminal input, and EOF use the existing
  shared stdin ring. Explicit `options.stdin` closes after those bytes; interactive
  callers use `write()` and `eof()`. The stdin device returns available bytes as
  short reads, allowing a later prompt before the next input line or EOF.
- Standard output and error are streamed, with UTF-8 decoding and partial prompt
  flushing before `READ`. Upstream source locations become editor diagnostics.
- The active source file is compiled. Workspace files are available for data and
  includes; separate module compilation and link orchestration are not provided.
  Modules declared together with a program in the active file are supported.
- Program arguments, custom compiler options, LSP, and debugging are not exposed
  by this evaluator bridge. Upstream Fortran support is experimental; this entry
  does not claim complete Fortran 90/95 or newer standard conformance.
- The existing Sandbox enforces asset/workspace/output limits, cancellation, and
  Worker cleanup. Since compilation and program invocation share one synchronous
  upstream call, the execution deadline is `compileTimeoutMs + runTimeoutMs`.
  Readiness is reported on output, input request, or completion.
- At least 128 MiB of WebAssembly memory is required; the normal Sandbox default
  is 512 MiB. The configured
  `maxWasmMemoryBytes` sets the maximum of the imported memory shared by compiler
  and program. This limits Wasm linear memory, not the browser's JS/code caches.
  Cancellation terminates even a Worker blocked in synchronous input or computation.

The browser test starts a local Vite server and Chromium. It covers the normal
language selector/editor/terminal path plus the consumer Sandbox's arrays,
same-file module, changed input, EOF, upstream diagnostics, output and memory
limits, deadline, cancellation, and a fresh invocation after cancellation.
