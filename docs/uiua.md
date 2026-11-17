# Uiua browser execution

`UIUA` runs the original Uiua 0.19.1 interpreter inside a private WASI Worker.
The source is a `.ua` file, with `main.ua` as the default. The wrapper loads and
executes fresh source through the upstream compiler and interpreter, prints its
original reports and remaining stack, and returns a nonzero exit for language errors.

For example, the default program reads and prints one complete input line:

```uiua
&p &sc
```

`&sc` reads one line from standard input, and `&p` prints it with a newline.
Input may arrive after execution has started. The original interpreter returns
numeric `0` at EOF. It also discards a final partial line that has no newline
before EOF; include a newline when supplying a complete line. Output, UTF-8,
EOF, cancellation, timeouts and output limits use the existing Wasm lifecycle.

Program arguments are available through Uiua's original `&args` operation.
The SDK accepts `programArgs` or legacy `args`. `activePath` selects the source
file and workspace files are available in the private filesystem; each execution
starts from a fresh snapshot. Runtime writes are not exported to the editor.
Compiler arguments are rejected. Prepare compiles the interpreter module but
does not execute or syntax-check the source.

This text execution profile does not provide native FFI, networking, external
processes, terminal raw mode, GUI, audio or video. Unsupported host operations
fail through the original implementation. No custom Uiua parser or subset
interpreter is used. The producer includes a narrow platform configuration patch
so WASI uses its actual system clock instead of the browser-only JavaScript clock.
Optional upstream battery features, including CSV, JSON5, FFT and compression,
are disabled in this build.

Hosts serve `static/wasm-uiua/` under `runtimeAssets.rootUrl`. The interpreter is
verified against its pinned byte length and SHA-256 before execution. Source pins,
license and the reproducible build recipe are retained with the producer and assets.

Run `pnpm test:browser:uiua` for real Chromium source execution, standard input,
errors, limits, cancellation, recovery and the normal default page.
