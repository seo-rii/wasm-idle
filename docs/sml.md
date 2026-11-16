# Standard ML browser execution

`SML` runs the original HaMLet 2.0.1 SML97 parser, type checker and evaluator
compiled to WASI by MLton. The original Standard Basis library is embedded in
its executable. Each run gets a fresh interpreter and private filesystem.

The default `main.sml` reads and prints one input line:

```sml
val _ = print (case TextIO.inputLine TextIO.stdIn of SOME line => line | NONE => "");
```

Explicit `stdin`, delayed terminal input and EOF use the existing WASI input
protocol. `print` and `TextIO.output` use real standard output. The original
compiler diagnoses parse/type errors and unhandled exceptions. A small embedding
entry point suppresses interactive declaration echoes and counts original
diagnostics to return failed execution for language errors; it preserves the original language implementation.

The SDK supports `programArgs` or legacy `args`, `activePath` and `workspaceFiles`.
As in the original interpreter host, `CommandLine.arguments()` includes the source
path before supplied program arguments. The runtime installs embedded Basis files
under `/.wasm-idle-sml-basis`; this directory is reserved. Runtime file writes are
private to execution and are not exported to the editor. Compiler arguments are
rejected. Prepare compiles the runtime module without executing user source.

Cancellation, timeouts, output and workspace limits use the existing Wasm
lifecycle. Native networking, subprocesses, signal handlers and foreign libraries
are outside this browser profile. The editor uses plain text; no debugger or SML
language server is provided.

Serve `static/wasm-sml/` under `runtimeAssets.rootUrl`. Runtime bytes, input source
pins and build receipts are verified before execution. The pinned producer is in
`runtimes/wasm-sml`; `pnpm test:browser:sml` runs the real Chromium acceptance suite.
