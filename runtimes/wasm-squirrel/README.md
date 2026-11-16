# Squirrel browser runtime

Runs the real Squirrel 3.2 VM and standard libraries from upstream revision
`f92bc298784ceea459b12e2de33bdff672bfeb83` (MIT). The source archive is vendored with
its SHA-256 checked before extraction. `runner.cpp` only hosts upstream APIs; it does
not parse, translate or evaluate Squirrel itself.

Rebuild with wasi-sdk 33.0:

```sh
WASI_SDK_PATH=/path/to/wasi-sdk-33 pnpm run build:wasm-squirrel
pnpm run assets:lock
pnpm run test:browser:squirrel
```

The build records source, runner and output hashes plus compiler version and flags
in `scripts/wasm-squirrel-assets.lock.json` and `static/wasm-squirrel/runtime-build.json`.
The recorded `stdin-eof.patch` makes `stdin.eos()` use libc EOF instead of seeking
a terminal (seeking can clear EOF and request input again). Regular-file behavior
is preserved. It uses 32-bit integers and 64-bit floats, UTF-8 byte strings, a 1 MiB native stack,
and at most 64 MiB of linear memory. Squirrel's compiler and regular-expression
library use setjmp/longjmp, enabled through WASI's WebAssembly exception support.

The existing WASI adapter starts a fresh interpreter for each run and supports
terminal input, delayed input, EOF, stdout/stderr, workspace files (`dofile`), limits,
and cancellation. The default program echoes bytes until EOF. Read one byte with
`stdin.readn('b')`; EOF raises the original stream exception and `stdin.eos()` then
returns true. All source is compiled by the upstream VM, including classes,
generators, closures and exceptions.

The host executes the active script with fixed arguments. Program arguments,
interactive REPL, debugger and LSP are not provided. `system()` returns -1 because
WASI has no subprocesses. `clock()` uses WASI's wall-clock emulation. Files live in
the run's virtual workspace and cannot access the host filesystem.
