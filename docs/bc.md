# bc browser execution

`BC` runs Gavin Howard's original bc 7.0.3 POSIX calculator with GNU extensions,
compiled with wasi-sdk 33.0. It includes arbitrary-precision decimal arithmetic,
functions, arrays, control flow, and the original math library (`programArgs: ['-l']`).
Source files use `.bc`, with `main.bc` as the default.

The default example reads one numeric expression and prints its increment:

```bc
value = read()
print "value=", value + 1, "\n"
```

Source is loaded with the original `-q -R -f <activePath>` options. The `-f` option
exits after the script and `-R` disables input prompts, so programs that do not call `read()` finish without
requiring terminal EOF. `read()` uses the real WASI stdin, including delayed input.
UTF-8 strings and native parse/runtime errors are preserved. An empty `read()` at
EOF is an upstream runtime error, including a final partial line without a newline.
Supply a newline after each input expression.

The SDK forwards `programArgs` (or legacy `args`) as interpreter options and files.
`compileArgs` is rejected. Workspace files are readable in a fresh private snapshot;
the active script may use a nested path. Writes are not exported to the editor.
Preparing only compiles the interpreter module and does not run or validate source.
Output limits, timeouts, cancellation and recovery use the existing Wasm lifecycle.

History, interactive terminal editing and translated system messages are disabled.
The producer's small platform patch skips unavailable asynchronous signal handlers
and maps signal-mask jumps to real Wasm-EH setjmp/longjmp. Worker termination handles
cancellation. The parser, decimal engine and evaluator remain original upstream code.
The runtime needs a browser with WebAssembly exception handling.

Serve `static/wasm-bc/` under `runtimeAssets.rootUrl`. The interpreter's byte length
and SHA-256 are verified before execution. Source, toolchain recipe, licenses and
artifact receipts are retained under `runtimes/wasm-bc/` and the static distribution.
Run `pnpm test:browser:bc` for real Chromium execution and the normal page default.
