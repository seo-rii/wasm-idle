## wasm-idle

![wasm-idle](static/image.jpeg)

Executes C, C++, Python, Java, Rust, Go, D, C#, F#, VB.NET, Elixir, Erlang, Prolog,
Gleam, Perl, Tcl, AWK, Pascal, Forth, J, BQN, Janet, Julia, Nim, Bash, ClojureScript, TinyGo, OCaml, JavaScript, TypeScript,
AssemblyScript, WAT, WASM, Lua, Zig, Scheme, Ruby, Haskell, R, Octave, SQLite, DuckDB,
and PHP code.

Refer to src/lib/clang.

## Language support policy

wasm-idle language support must run user code through the real language implementation in the
browser, normally via a WebAssembly compiler, interpreter, or runtime. Do not add handwritten
parsers, translators, emulators, or "subset" executors as language support. A language should be
listed only after normal user code runs on that actual runtime and stdin/stdout behavior, or a
documented stdin limitation, is covered by tests.

## Support matrix

All execution entries run in the browser through real runtime, compiler, or interpreter
implementations. `Editor support` lists browser LSP/compiler diagnostics when wired; `syntax`
means Monaco syntax highlighting only. `Debug` means wasm-idle's trace/debug controls, not a
native debugger.

| Language       | Browser runtime/compiler                | Stdin | Editor support       | Debug |
| -------------- | --------------------------------------- | ----- | -------------------- | ----- |
| C              | @wasm-idle/llvm-core / Clang WASI       | Yes   | clangd               | -     |
| C++            | @wasm-idle/llvm-core / Clang WASI       | Yes   | clangd               | Trace |
| Objective-C    | GNUstep libobjc2 + @wasm-idle/llvm-core | Yes   | clangd               | -     |
| Python         | Pyodide                                 | Yes   | Python LSP           | Trace |
| Java           | TeaVM                                   | Yes   | syntax               | -     |
| Rust           | wasm-rust / browser rustc               | Yes   | rustc diagnostics    | Trace |
| Go             | wasm-go / browser Go compiler           | Yes   | compiler diagnostics | Trace |
| D              | wasm-d                                  | Yes   | syntax               | -     |
| C#             | wasm-dotnet                             | Yes   | compiler diagnostics | -     |
| F#             | wasm-dotnet                             | Yes   | compiler diagnostics | -     |
| VB.NET         | wasm-dotnet                             | Yes   | compiler diagnostics | -     |
| Elixir         | AtomVM / Popcorn                        | Yes   | syntax               | -     |
| Erlang         | AtomVM / Popcorn                        | Yes   | syntax               | -     |
| Prolog         | SWI-Prolog WASM worker                  | Yes   | syntax               | -     |
| Gleam          | Gleam precompiled browser runtime       | Yes   | compiler diagnostics | -     |
| Perl           | Perl WASM worker                        | Yes   | syntax               | -     |
| Tcl            | Wacl Tcl WASM worker                    | Yes   | syntax               | -     |
| AWK            | GoAWK WASM worker                       | Yes   | syntax               | -     |
| Pascal         | pas2js worker                           | Yes   | syntax               | -     |
| Forth          | WAForth WASM worker                     | Yes   | syntax               | -     |
| J              | J playground WASM worker                | Yes   | syntax               | -     |
| BQN            | CBQN WASM worker                        | Yes   | syntax               | -     |
| Janet          | Janet VM WASM worker                    | Yes   | syntax               | -     |
| Julia          | Julia 1.0.4 WASM worker                 | Yes   | syntax               | -     |
| Nim            | Nim 2.2.4 WASM + clang/lld WASM         | Yes   | syntax               | -     |
| Bash           | GNU Bash WASIX / Wasmer SDK             | Yes   | syntax               | -     |
| ClojureScript  | cljs.js self-hosted compiler            | Yes   | syntax               | -     |
| TinyGo         | wasm-tinygo                             | Yes   | syntax               | -     |
| OCaml          | wasm-of-js-of-ocaml / js_of_ocaml       | Yes   | syntax               | -     |
| JavaScript     | wasm-typescript / TypeScript service    | Yes   | TypeScript LSP       | -     |
| TypeScript     | wasm-typescript / TypeScript service    | Yes   | TypeScript LSP       | -     |
| AssemblyScript | AssemblyScript compiler                 | Yes   | AssemblyScript LSP   | -     |
| WAT            | WABT                                    | Yes   | WAT LSP              | -     |
| WASM           | Browser WebAssembly + WASI shim         | Yes   | syntax               | -     |
| Lua            | Wasmoon                                 | Yes   | syntax               | -     |
| Zig            | zig_small.wasm                          | Yes   | syntax               | -     |
| Scheme         | Puppy Scheme / wasm-lisp                | Yes   | syntax               | -     |
| Ruby           | CRuby WASI                              | Yes   | syntax               | -     |
| Haskell        | ghc-in-browser                          | Yes   | syntax               | -     |
| Fortran        | f2c + @wasm-idle/llvm-core              | Yes   | Fortran LSP          | -     |
| COBOL          | GnuCOBOL 3.2 + @wasm-idle/llvm-core     | Yes   | syntax               | -     |
| R              | WebR                                    | Yes   | syntax               | -     |
| Octave         | wasm-octave                             | Yes   | syntax               | -     |
| DuckDB         | DuckDB-Wasm                             | Files | DuckDB LSP           | -     |
| SQLite         | sql.js                                  | n/a   | syntax               | -     |
| PHP            | php-wasm                                | Yes   | syntax               | -     |

### Runtime details

`Package/version base` names the browser-side npm package, workspace runtime wrapper, or
static runtime manifest that backs each row. `Execution defaults / flags` lists the default
targets and flags wasm-idle applies, plus the public per-run options that change execution.
`Customization` lists the `runtimeAssets` fields and matching `PUBLIC_WASM_*` env overrides
when they exist.

| Language / IDs                     | Package/version base                                                                                           | Execution defaults / flags                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Customization                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C<br>`C`                           | @wasm-idle/llvm-core@0.1.0 / Clang 22.1.8 WASI sysroot from the `wasm-llvm` producer                           | `clang` for `wasm32-wasi`; default `-std=gnu11`; WASI preview1 execution supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                          | `runtimeAssets.clang.baseUrl`/`loader` or `rootUrl`; `compileArgs`, `programArgs`, `cVersion`, `activePath`, `workspaceFiles`                                                                                                                                                                 |
| C++<br>`CPP`                       | @wasm-idle/llvm-core@0.1.0 / Clang 22.1.8 WASI sysroot from the `wasm-llvm` producer                           | `clang++` for `wasm32-wasi`; default `-std=gnu++2a`; trace debug uses wasm-idle controls; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                         | `runtimeAssets.clang.baseUrl`/`loader` or `rootUrl`; `compileArgs`, `programArgs`, `cppVersion`, `activePath`, `workspaceFiles`                                                                                                                                                               |
| Objective-C<br>`OBJC`              | GNUstep libobjc2 v2.3 assets from the `wasm-llvm` producer + @wasm-idle/llvm-core@0.1.0                        | `clang -x objective-c -fobjc-runtime=gnustep-2.0 -fblocks` for `wasm32-wasi`; links `libobjc.a`, `libgnustep-base.a`, and `libffi.a` when Foundation is imported; Foundation headers are inlined from `foundation-headers.json`; includes a constructor wrapper for Objective-C class registration; auto-compiles `.m` and `.c` workspace sources; supports `stdin` and `programArgs`; large Objective-C assets may be served as gzip-only `.gz` files through the service worker or worker fallback | `runtimeAssets.objectivec.baseUrl`/`libobjcUrl`/`headersUrl`/`libgnustepBaseUrl`/`libgnustepBaseObjectUrl`/`foundationHeadersUrl`/`libffiUrl` or `PUBLIC_WASM_OBJECTIVEC_*`; `runtimeAssets.clang.baseUrl`/`loader` for the clang toolchain; `activePath`, `workspaceFiles`, `compileArgs`    |
| Python<br>`PYTHON3`, `PYPY3`       | @wasm-idle/runtime-pyodide@0.0.0 / pyodide@0.29.3                                                              | Pyodide worker loads `pyodide.asm.js`, `pyodide.asm.wasm`, `python_stdlib.zip`; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                   | `runtimeAssets.python.baseUrl`/`loader` or `rootUrl`                                                                                                                                                                                                                                          |
| Java<br>`JAVA`                     | @wasm-idle/runtime-teavm@0.0.0 / TeaVM compiler assets                                                         | `compiler.wasm` compiles Java to browser WASM/JS; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                                 | `runtimeAssets.java.baseUrl`/`loader` or `rootUrl`                                                                                                                                                                                                                                            |
| Rust<br>`RUST`                     | wasm-rust@0.1.0 / rust-1.99.0-browser-integrated-v1 + integrated LLVM/LLD 22.1.8 from the `wasm-llvm` producer | browser host `wasm32-wasip1-threads`; `rustc -Zthreads=1 -Zcodegen-backend=llvm --crate-type=bin --edition=2024 -Cpanic=abort -Ccodegen-units=1 --emit=link`; default target `wasm32-wasip1`, selectable `wasm32-wasip1`, `wasm32-wasip2`, `wasm32-wasip3`; Preview 1 emits core Wasm and Preview 2/3 are component-encoded; supports `stdin` and `programArgs`                                                                                                                                      | `runtimeAssets.rust.compilerUrl` or `PUBLIC_WASM_RUST_COMPILER_URL`; `rootUrl`, `rustTargetTriple`, `programArgs`; compiler requests accept `edition`, `crateType`, `extendedTimeout`, `log`, and `onProgress`; runtime manifest controls compiler memory, timeout, and shared workspace size |
| Go<br>`GO`                         | wasm-go@0.1.0 / go1.26.1                                                                                       | default target `wasip1/wasm`; selectable `wasip1/wasm`, `wasip2/wasm`, `wasip3/wasm`, `js/wasm`; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                  | `runtimeAssets.go.compilerUrl` or `PUBLIC_WASM_GO_COMPILER_URL`; `goTarget`, `programArgs`                                                                                                                                                                                                    |
| D<br>`D`                           | wasm-d@0.1.0 / ldc-1.42.0-wasi-smoke                                                                           | `ldc2 -conf=/toolchain/etc/ldc2.conf -mtriple=wasm32-wasi -c` then `wasm-ld` to WASI preview1; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                    | `runtimeAssets.d.moduleUrl` or `PUBLIC_WASM_D_MODULE_URL`; `activePath`, `programArgs`                                                                                                                                                                                                        |
| C#<br>`CSHARP`                     | wasm-dotnet@0.1.0 / .NET 9.0.16 browser-wasm / Roslyn C# 4.14.0                                                | `CSharpCompilationOptions(OutputKind.ConsoleApplication)`; `concurrentBuild=false`; target `browser-wasm`; language-specific AOT bundle `runtime/csharp/`; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                        | `runtimeAssets.dotnet.moduleUrl` or `PUBLIC_WASM_DOTNET_MODULE_URL`; `programArgs`, LSP on/off                                                                                                                                                                                                |
| F#<br>`FSHARP`                     | wasm-dotnet@0.1.0 / .NET 9.0.16 browser-wasm / FCS 43.12.204 / FSharp.Core 10.1.204                            | `fsc.exe --target:exe --targetprofile:netcore --noframework --simpleresolution --nowin32manifest --debug- --optimize-`; language-specific AOT bundle `runtime/fsharp/`; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                           | `runtimeAssets.dotnet.moduleUrl` or `PUBLIC_WASM_DOTNET_MODULE_URL`; `programArgs`, LSP on/off                                                                                                                                                                                                |
| VB.NET<br>`VBNET`                  | wasm-dotnet@0.1.0 / .NET 9.0.16 browser-wasm / Roslyn Visual Basic 4.14.0                                      | `VisualBasicCompilationOptions(OutputKind.ConsoleApplication)`; `concurrentBuild=false`, `OptionStrict=Off`, `OptionInfer=On`, `OptionExplicit=On`; target `browser-wasm`; language-specific AOT bundle `runtime/vbnet/`; supports `stdin` and `programArgs`                                                                                                                                                                                                                                         | `runtimeAssets.dotnet.moduleUrl` or `PUBLIC_WASM_DOTNET_MODULE_URL`; `programArgs`, LSP on/off                                                                                                                                                                                                |
| Elixir<br>`ELIXIR`                 | wasm-elixir asset bundle / @swmansion/popcorn@0.2.2                                                            | Popcorn/AtomVM bundle `bundle.avm`; supports `stdin`                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `runtimeAssets.elixir.bundleUrl` or `PUBLIC_WASM_ELIXIR_BUNDLE_URL`                                                                                                                                                                                                                           |
| Erlang<br>`ERLANG`                 | wasm-elixir asset bundle / @swmansion/popcorn@0.2.2                                                            | Popcorn/AtomVM bundle `bundle.avm`; supports `stdin`                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `runtimeAssets.erlang.bundleUrl` or `PUBLIC_WASM_ERLANG_BUNDLE_URL`; falls back to Elixir bundle URL                                                                                                                                                                                          |
| Prolog<br>`PROLOG`                 | swipl-wasm@8.0.1 synced into `static/wasm-prolog`                                                              | static worker runs SWI-Prolog; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                                                    | `runtimeAssets.prolog.baseUrl`/`runtimeAssets.prolog.workerUrl` or `PUBLIC_WASM_PROLOG_BASE_URL`/`PUBLIC_WASM_PROLOG_WORKER_URL`; `programArgs`, `activePath`, `workspaceFiles`                                                                                                               |
| Gleam<br>`GLEAM`                   | @live-codes/gleam-precompiled@0.5.0 static worker                                                              | Gleam worker compiles/runs browser output with source manifest; supports `stdin`                                                                                                                                                                                                                                                                                                                                                                                                                     | `runtimeAssets.gleam.baseUrl`/`workerUrl`/`manifestUrl` or `PUBLIC_WASM_GLEAM_*`; `programArgs`, `workspaceFiles`                                                                                                                                                                             |
| Perl<br>`PERL`                     | WebPerl v0.09-beta (webperl_prebuilt_v0.09-beta.zip)                                                           | static worker runs `emperl`; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                                                      | `runtimeAssets.perl.baseUrl`/`runtimeAssets.perl.workerUrl` or `PUBLIC_WASM_PERL_BASE_URL`/`PUBLIC_WASM_PERL_WORKER_URL`; `programArgs`, `activePath`, `workspaceFiles`                                                                                                                       |
| Tcl<br>`TCL`                       | Wacl Tcl 2017-05-29 (wacl.zip)                                                                                 | static worker runs Wacl Tcl; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                                                      | `runtimeAssets.tcl.baseUrl`/`runtimeAssets.tcl.workerUrl` or `PUBLIC_WASM_TCL_BASE_URL`/`PUBLIC_WASM_TCL_WORKER_URL`; `programArgs`, `activePath`, `workspaceFiles`                                                                                                                           |
| AWK<br>`AWK`                       | GoAWK v1.31.0 / go1.25.3                                                                                       | static worker runs `goawk.wasm`; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                                                  | `runtimeAssets.awk.baseUrl`/`runtimeAssets.awk.workerUrl` or `PUBLIC_WASM_AWK_BASE_URL`/`PUBLIC_WASM_AWK_WORKER_URL`; `programArgs`, `activePath`, `workspaceFiles`                                                                                                                           |
| Pascal<br>`PASCAL`                 | pas2js 3.2.1 (9ac46614dc82)                                                                                    | static worker compiles with pas2js then runs JS; supports `stdin`                                                                                                                                                                                                                                                                                                                                                                                                                                    | `runtimeAssets.pascal.baseUrl`/`runtimeAssets.pascal.workerUrl` or `PUBLIC_WASM_PASCAL_BASE_URL`/`PUBLIC_WASM_PASCAL_WORKER_URL`; `programArgs`, `activePath`, `workspaceFiles`                                                                                                               |
| Forth<br>`FORTH`                   | waforth@0.20.1 / static worker                                                                                 | WAForth worker; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `runtimeAssets.forth.baseUrl`/`runtimeAssets.forth.workerUrl` or `PUBLIC_WASM_FORTH_BASE_URL`/`PUBLIC_WASM_FORTH_WORKER_URL`; `programArgs`, `activePath`, `workspaceFiles`                                                                                                                   |
| J<br>`J`                           | jsoftware-j-playground static worker                                                                           | J playground worker; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                                                              | `runtimeAssets.j.baseUrl`/`runtimeAssets.j.workerUrl` or `PUBLIC_WASM_J_BASE_URL`/`PUBLIC_WASM_J_WORKER_URL`; `programArgs`, `activePath`, `workspaceFiles`                                                                                                                                   |
| BQN<br>`BQN`                       | CBQN static worker / Emscripten 3.1.8                                                                          | CBQN worker; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `runtimeAssets.bqn.baseUrl`/`runtimeAssets.bqn.workerUrl` or `PUBLIC_WASM_BQN_BASE_URL`/`PUBLIC_WASM_BQN_WORKER_URL`; `programArgs`, `activePath`, `workspaceFiles`                                                                                                                           |
| Janet<br>`JANET`                   | Janet static worker / Emscripten 3.1.8                                                                         | Janet VM worker; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `runtimeAssets.janet.baseUrl`/`runtimeAssets.janet.workerUrl` or `PUBLIC_WASM_JANET_BASE_URL`/`PUBLIC_WASM_JANET_WORKER_URL`; `programArgs`, `activePath`, `workspaceFiles`                                                                                                                   |
| Julia<br>`JULIA`                   | @chriskoch/julia-wasm@1.0.4                                                                                    | Julia WASM worker; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                                                                | `runtimeAssets.julia.baseUrl`/`runtimeAssets.julia.workerUrl` or `PUBLIC_WASM_JULIA_BASE_URL`/`PUBLIC_WASM_JULIA_WORKER_URL`; `programArgs`, `activePath`, `workspaceFiles`                                                                                                                   |
| Nim<br>`NIM`                       | Nim 2.2.4 / benagastov Nim-WASM-Compiler with clang/lld WASM                                                   | static worker compiles Nim to C, then clang/lld to WASM; supports `stdin`                                                                                                                                                                                                                                                                                                                                                                                                                            | `runtimeAssets.nim.baseUrl`/`runtimeAssets.nim.workerUrl` or `PUBLIC_WASM_NIM_BASE_URL`/`PUBLIC_WASM_NIM_WORKER_URL`; `programArgs`, `activePath`, `workspaceFiles`                                                                                                                           |
| Bash<br>`BASH`                     | @wasm-idle/runtime-bash@0.1.0 / GNU Bash WASIX + @wasmer/sdk@0.9.0                                             | runs the pinned `bash.webc` locally with the Wasmer package entrypoint; supports `stdin`, `programArgs`, `activePath`, and `workspaceFiles`                                                                                                                                                                                                                                                                                                                                                          | `runtimeAssets.bash.webcUrl` or `rootUrl`; `programArgs`                                                                                                                                                                                                                                      |
| ClojureScript<br>`CLOJURESCRIPT`   | @wasm-idle/runtime-clojurescript@0.1.0 / ClojureScript 1.12.134                                                | static worker compiles and evaluates with the official `cljs.js` self-hosted compiler; supports `stdin`, `programArgs`, `activePath`, and `workspaceFiles`                                                                                                                                                                                                                                                                                                                                           | `runtimeAssets.clojurescript.baseUrl`/`runtimeAssets.clojurescript.workerUrl` or `PUBLIC_WASM_CLOJURESCRIPT_BASE_URL`/`PUBLIC_WASM_CLOJURESCRIPT_WORKER_URL`; `programArgs`, `activePath`, `workspaceFiles`                                                                                   |
| TinyGo<br>`TINYGO`                 | wasm-tinygo@0.0.0 / TinyGo 0.40.1 browser toolchain                                                            | default target `wasm`; selectable `wasm`, `wasip1`, `wasip2`, `wasip3`; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                           | `runtimeAssets.tinygo.moduleUrl`/`appUrl`/`assetLoader`/`assetPacks`; `PUBLIC_WASM_TINYGO_*`, `tinygoTarget`, `programArgs`                                                                                                                                                                   |
| OCaml<br>`OCAML`                   | wasm-of-js-of-ocaml@0.1.0 / js_of_ocaml + wasm_of_ocaml                                                        | default backend `wasm`; selectable `wasm`, `js`; `ocamlWasmBinaryenMode` `fast`, `full`; supports `stdin`                                                                                                                                                                                                                                                                                                                                                                                            | `runtimeAssets.ocaml.moduleUrl`/`manifestUrl` or `PUBLIC_WASM_OCAML_*`; `ocamlBackend`                                                                                                                                                                                                        |
| JavaScript<br>`JAVASCRIPT`         | wasm-typescript@0.1.0 / @swc/wasm-typescript@1.15.33                                                           | TypeScript service transpiles JS/TS and runs in browser sandbox; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                  | `runtimeAssets.typescript.moduleUrl`/`libUrl` or `PUBLIC_WASM_TYPESCRIPT_MODULE_URL`                                                                                                                                                                                                          |
| TypeScript<br>`TYPESCRIPT`         | wasm-typescript@0.1.0 / @swc/wasm-typescript@1.15.33                                                           | TypeScript service transpiles then runs in browser sandbox; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                       | `runtimeAssets.typescript.moduleUrl`/`libUrl` or `PUBLIC_WASM_TYPESCRIPT_MODULE_URL`                                                                                                                                                                                                          |
| AssemblyScript<br>`ASSEMBLYSCRIPT` | assemblyscript@0.28.17 + @assemblyscript/loader@0.28.17                                                        | AssemblyScript compiler emits WASM and runs through WASI/browser imports; supports `stdin`                                                                                                                                                                                                                                                                                                                                                                                                           | `programArgs`, `stdin`; compiler modules load with the AssemblyScript worker                                                                                                                                                                                                                  |
| WAT<br>`WAT`                       | wasm-wat@0.1.0 / wabt@1.0.39                                                                                   | WABT parses WAT to WASM then runs through WASI shim; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                              | `runtimeAssets.wat.moduleUrl` or `PUBLIC_WASM_WAT_MODULE_URL`; `programArgs`                                                                                                                                                                                                                  |
| WASM<br>`WASM`                     | Browser WebAssembly + @bjorn3/browser_wasi_shim@0.4.2                                                          | loads provided WASM bytes and executes with WASI preview1 imports; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                | `programArgs`, `stdin`, `activePath`                                                                                                                                                                                                                                                          |
| Lua<br>`LUA`                       | wasm-lua@0.1.0 / wasmoon@1.16.0                                                                                | Wasmoon Lua VM; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `runtimeAssets.lua.moduleUrl` or `PUBLIC_WASM_LUA_MODULE_URL`; `programArgs`                                                                                                                                                                                                                  |
| Zig<br>`ZIG`                       | static wasm-zig assets / `zig_small.wasm` + stdlib zip                                                         | default target `wasm64-wasi`; Zig compile args are appended; supports `stdin`, `compileArgs`, `programArgs`                                                                                                                                                                                                                                                                                                                                                                                          | `runtimeAssets.zig.compilerUrl`/`stdlibUrl` or `PUBLIC_WASM_ZIG_*`; `zigTargetTriple`, `activePath`, `workspaceFiles`                                                                                                                                                                         |
| Scheme<br>`LISP`                   | wasm-lisp@0.1.0 / Puppy Scheme WASM component                                                                  | Puppy Scheme compiler/runtime; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                                                    | `runtimeAssets.lisp.moduleUrl` or `PUBLIC_WASM_LISP_MODULE_URL`; `programArgs`                                                                                                                                                                                                                |
| Ruby<br>`RUBY`                     | @wasm-idle/runtime-ruby@0.0.0 / @ruby/3.4-wasm-wasi@2.9.3-2.9.4                                                | CRuby 3.4 WASI runtime; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                                                           | `runtimeAssets.ruby.wasmUrl` or `PUBLIC_WASM_RUBY_WASM_URL`; `programArgs`                                                                                                                                                                                                                    |
| Haskell<br>`HASKELL`               | ghc-in-browser / GHC 9.14.0.20251031 WASI rootfs                                                               | loads `dyld.mjs`, `rootfs.tar.zst`, `bsdtar.wasm`; `compileArgs` become GHC args, otherwise legacy `args` become GHC args                                                                                                                                                                                                                                                                                                                                                                            | `runtimeAssets.haskell.moduleUrl`/`rootfsUrl`/`bsdtarUrl`; `mainSoPath`, `searchDirs`, `activePath`, `workspaceFiles`                                                                                                                                                                         |
| Fortran<br>`FORTRAN`               | Netlib f2c 2022-09-09 + `@cowasm/f2c 1.0.0` libf2c + @wasm-idle/llvm-core@0.1.0                                | runs `f2c.wasm` in WASI, compiles generated C with the llvm-core Clang host, links `libf2c.a`, then executes the resulting WASI module with `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                | `runtimeAssets.fortran.baseUrl`/`f2cWasmUrl`/`libf2cUrl`/`f2cHeaderUrl`/`analyzerUrl` or `PUBLIC_WASM_FORTRAN_*`; `runtimeAssets.clang.baseUrl`/`loader` for the C backend; `activePath`, `workspaceFiles`, `compileArgs`                                                                     |
| COBOL<br>`COBOL`                   | GnuCOBOL 3.2 + GMP 6.3.0 assets from the `wasm-llvm` producer + @wasm-idle/llvm-core@0.1.0                     | translates free-format COBOL with the real GnuCOBOL `cobc` frontend, compiles the generated C with the llvm-core Clang host, links libcob/GMP, and executes the resulting WASI module with `stdin` and `programArgs`                                                                                                                                                                                                                                                                                 | `runtimeAssets.cobol.baseUrl` or `PUBLIC_WASM_COBOL_BASE_URL`; `runtimeAssets.clang.baseUrl`/`loader` for the C backend; `activePath`, `workspaceFiles`, `compileArgs`                                                                                                                        |
| R<br>`R`                           | @wasm-idle/runtime-r@0.0.0 / webr@0.6.0                                                                        | WebR worker; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `runtimeAssets.r.baseUrl` or `PUBLIC_WASM_R_BASE_URL`                                                                                                                                                                                                                                         |
| Octave<br>`OCTAVE`                 | Octave 10.3.0 (octave-10.3.0-pl5321h996e327_3.tar.bz2)                                                         | Octave CLI Emscripten worker; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                                                     | `runtimeAssets.octave.baseUrl`/`workerUrl`/`manifestUrl` or `PUBLIC_WASM_OCTAVE_*`                                                                                                                                                                                                            |
| DuckDB<br>`DUCKDB`                 | @duckdb/duckdb-wasm@1.33.1-dev45.0                                                                             | DuckDB-Wasm query engine; stdin is treated as SQL/file input rather than terminal stdin                                                                                                                                                                                                                                                                                                                                                                                                              | `stdin` for query text/files; no separate runtime asset override                                                                                                                                                                                                                              |
| SQLite<br>`SQLITE`                 | sql.js@1.14.1                                                                                                  | sql.js executes SQL in browser memory; terminal stdin is not applicable                                                                                                                                                                                                                                                                                                                                                                                                                              | `runtimeAssets.sqlite.wasmUrl` or `PUBLIC_WASM_SQLITE_WASM_URL`                                                                                                                                                                                                                               |
| PHP<br>`PHP`                       | @php-wasm/web@3.1.34 + @php-wasm/universal@3.1.34                                                              | php-wasm runtime, default PHP version `8.4`; supports `stdin` and `programArgs`                                                                                                                                                                                                                                                                                                                                                                                                                      | `runtimeAssets.php.version` or `PUBLIC_WASM_PHP_VERSION`; `programArgs`                                                                                                                                                                                                                       |

### Blocked candidates

These languages are intentionally not part of the execution support matrix yet. They should stay
out of `supportedLanguages` until the blocker is resolved with a real browser runtime/compiler and
stdin/stdout coverage.

| Candidate      | Candidate IDs | Current evidence                                                                                                                                                                                         | Blocker                                                                                                                                                                                  | Required follow-up                                                                                                                                                            |
| -------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modern Fortran | `F90`, `F95`  | `FORTRAN` now runs through f2c/libf2c, while `static/wasm-fortran` still packages LFortran analyzer assets                                                                                               | LFortran WASM/WAT stdin codegen still aborts and the C backend reports `visit_FileRead() not implemented`; f2c covers Fortran 77-style code but is not a full modern Fortran compiler    | Package a real browser modern Fortran compiler/runtime with stdin-capable codegen before advertising F90/F95 as first-class runtimes                                          |
| Crystal        | `CRYSTAL`     | No browser Crystal compiler/runtime assets are packaged in this repository                                                                                                                               | Crystal cannot be treated as syntax-only or as a wasm-idle-authored translator/subset                                                                                                    | Find or build a browser-hosted real Crystal compiler/runtime path with stdin/stdout coverage before registering the language                                                  |
| Swift          | `SWIFT`       | Swift.org documents Wasm support through a native Swift 6.x toolchain plus a Wasm SDK, and SwiftWasm Pad uses a backend compile service; no browser-hosted swiftc/SwiftPM runtime asset is packaged here | Swift cannot be implemented as a wasm-idle-authored parser/runtime subset or as a remote compile service; the playground needs a redistributable browser-hosted real Swift compiler path | Build or source a browser-hosted Swift compiler/SwiftPM runtime bundle, prove stdin/stdout execution for generated WASI modules, then register SWIFT as a first-class runtime |

## Monorepo layout

`wasm-idle` is managed as a pnpm workspace. Language-independent app code remains here while large
toolchains can be consumed from pinned external runtime repositories:

- `packages/core`: framework-neutral contracts, runtime asset keys, progress helpers, and playground
  binding helpers.
- `packages/llvm-core`: code-only browser hosts for shared memory, MemFS, tar, WASI, Clang, COBOL,
  and Objective-C execution. Every compiler, sysroot, archive, and worker asset is supplied through
  an explicit HTTP(S) URL.
- `packages/lsp`: code-only browser language-server hosts. TypeScript libraries, SQL engines,
  clangd, and other language-tool assets are supplied through explicit runtime URLs.
- `wasm-llvm`: external producer repository for compiler source pins, patches, reproducible builds,
  manifests, and asset verification. Its `producer/rust-browser` source build owns the current Rust
  1.99 compiler, matching LLVM 22 code generator, and in-process LLD; it is not consumed as an npm
  runtime package.
- `packages/svelte`: Svelte store/binding helpers around `@wasm-idle/core`.
- `packages/react`: React hooks around `@wasm-idle/core`.
- `packages/vue`: Vue composables around `@wasm-idle/core`.
- `packages/node`: Node.js host helpers for Node-capable sandbox loaders.
- `runtimes/*`: imported runtime/compiler packages such as `wasm-rust`,
  `wasm-of-js-of-ocaml`, `wasm-go`, `wasm-tinygo`, `wasm-dotnet`, `wasm-typescript`,
  `wasm-wat`, `wasm-lua`, `wasm-lisp`, `wasm-elixir`, `wasm-tcl`, `wasm-awk`,
  `wasm-forth`, `wasm-j`, `wasm-bqn`, `wasm-janet`,
  `pyodide`, `teavm`, `assemblyscript`, `ruby`, `r`, `php`, and `js-sandbox`.
- `static/wasm-zig`, `static/wasm-haskell`, `static/wasm-julia`, and `static/wasm-nim`: bundled browser runtime and
  compiler assets synced from
  upstream asset builds rather than local workspace packages.
- `tools/*`: migrated local toolchain projects that are too broad or infrastructure-heavy to run as
  normal runtime workspace packages. `tools/dool` contains the Docker judge backend for Elixir and
  the other server-side language runners.

Useful workspace commands:

```bash
pnpm workspace:list
pnpm build:packages
pnpm check:packages
pnpm build:runtimes
pnpm check:runtimes
pnpm sync:runtime list
pnpm sync:runtimes
```

The sync scripts default to `runtimes/<name>/dist`; optional source and target arguments are for
alternate build directories inside the current checkout.

Published packages are built in workspace dependency order. Before publishing, run:

```bash
pnpm verify:package
```

The smoke check packs the root library and its public workspace dependencies, installs the tarballs
into a temporary project, and imports each public entry point.

Java uses TeaVM's browser compiler/runtime. TeaVM compiler/runtime/classlib assets are bundled under `static/teavm/` by default, and the asset base URL can be overridden with `PUBLIC_TEAVM_BASE_URL`.

Pyodide core assets are vendored under `static/pyodide/`. Refresh them after bumping the `pyodide`
package with:

```bash
cd wasm-idle
pnpm run sync:pyodide
```

Elixir and Erlang browser execution use an AtomVM/Popcorn AVM bundle. The Popcorn `eval-in-wasm`
source and vendored Popcorn Elixir build dependency now live under `runtimes/wasm-elixir/`;
rebuild and sync with:

```bash
cd wasm-idle
pnpm --dir runtimes/wasm-elixir run bundle
pnpm run sync:wasm-elixir
```

Erlang support uses Popcorn's upstream `eval_erlang` and `eval_erlang_module` paths. This is not a
handwritten wasm-idle subset, but it inherits AtomVM/Popcorn runtime limits and is not full
Erlang/OTP ERTS coverage. Some OTP paths that rely on missing NIFs can fail in the current bundle,
so the browser starter and stdin coverage use `io:get_line`/`io:format` only.

Julia browser execution uses the `@chriskoch/julia-wasm` Julia 1.0.4 asset bundle under
`static/wasm-julia/`. Refresh the vendored worker/runtime assets with:

```bash
cd wasm-idle
pnpm run sync:wasm-julia
```

Nim browser execution uses the `benagastov/Nim-WASM-Compiler` asset pipeline under
`static/wasm-nim/`: Nim 2.2.4 compiled to WebAssembly emits C, then bundled clang/lld WebAssembly
assets link a runnable WASI module. Refresh the vendored worker/runtime assets with:

```bash
cd wasm-idle
pnpm run sync:wasm-nim
```

## Rust browser integration

The demo app bundles the workspace `wasm-rust` browser compiler under `static/wasm-rust/` and points
the example `Terminal` at `/wasm-rust/index.js` by default. Refresh it with:

```bash
pnpm --dir runtimes/wasm-rust build
pnpm run sync:wasm-rust
```

The built-in Rust route supports `wasm32-wasip1`, `wasm32-wasip2`, and `wasm32-wasip3`. The page
exposes a target selector when Rust is active, defaults to `wasm32-wasip1`, and persists that choice
in local storage. The compiler module, rustc, sysroot, and component tooling remain unloaded until
Rust is selected; LSP assets remain unloaded until the LSP toggle is enabled.

## TinyGo browser integration

The demo app can also vendor the workspace `wasm-tinygo` browser build under `static/wasm-tinygo/`
and load its `runtime.js` entry directly inside the TinyGo playground sandbox. The example page
uses the bundled browser runtime by default, including on `localhost` during `vite dev` /
`vite preview`. Refresh the
bundled runtime assets after rebuilding the workspace project with:

```bash
pnpm --dir runtimes/wasm-tinygo build
pnpm run sync:wasm-tinygo
```

TinyGo exposes `wasm`, `wasip1`, `wasip2`, and `wasip3` targets through the example page. The
browser pipeline still lives inside `wasm-tinygo`; `wasm-idle` imports its reusable `runtime.js`
library entry directly, forwards the selected target into the build request, then runs the emitted
artifact with browser WASI so terminal stdin/EOF behavior stays consistent with the other runtimes.
The default bundled browser path loads the vendored TinyGo runtime in `direct` mode, skips the old
bootstrap-only compile step, and runs runnable WASI artifacts locally. The `wasip2` and `wasip3`
entries use the preview target profiles shipped by the bundled `wasm-tinygo` runtime, so they may
produce non-runnable preview artifacts until the matching execution path is available.

## C# / F# / VB.NET / .NET browser integration

The demo app vendors the workspace `wasm-dotnet` browser module under `static/wasm-dotnet/` and exposes
C# as `CSHARP`, F# as `FSHARP`, and VB.NET as `VBNET` in the shared playground selector. Refresh the
browser module after rebuilding the workspace project with:

```bash
pnpm --dir runtimes/wasm-dotnet build
dotnet workload install wasm-tools
dotnet workload install wasm-experimental
pnpm --dir runtimes/wasm-dotnet build:runtime
pnpm run sync:wasm-dotnet
```

C#, F#, and VB.NET compile in the browser through separate .NET `browser-wasm` AOT bundles at
`runtime/csharp/`, `runtime/fsharp/`, and `runtime/vbnet/`. `wasm-idle` loads the static
`wasm-dotnet` module only after a .NET language is selected; the module then loads only that
language's `dotnet.js` and filtered shared reference assemblies. No server-side dotnet compile route
is involved. For a hosted app, pass `runtimeAssets.dotnet.moduleUrl` or set
`PUBLIC_WASM_DOTNET_MODULE_URL`. The browser path forwards CLI args and buffered terminal stdin into
`Console.In`. Roslyn C#, FSharp.Compiler.Service, and Roslyn Visual Basic hot paths are selectively
AOT compiled in their respective bundles. Monaco diagnostics reuse the selected threaded runtime
through an in-process `MessageChannel` transport because the .NET pthread runtime must start on the
browser UI thread.

## Browser regression commands

Browser-level Rust and TinyGo checks are reproducible from this repo:

```bash
cd wasm-idle
pnpm run probe:rust-browser
pnpm run test:browser:playwright
pnpm run probe:tinygo-browser
pnpm run test:browser:tinygo

WASM_IDLE_BROWSER_URL='http://localhost:5173/absproxy/5173/' \
WASM_IDLE_REUSE_LOCAL_PREVIEW=1 \
pnpm run probe:rust-browser

WASM_IDLE_BROWSER_URL='http://localhost:5173/absproxy/5173/' \
WASM_IDLE_REUSE_LOCAL_PREVIEW=1 \
pnpm run probe:tinygo-browser

WASM_IDLE_RUN_REAL_BROWSER_RUST=1 \
WASM_IDLE_BROWSER_URL='http://localhost:5173/absproxy/5173/' \
WASM_IDLE_REUSE_LOCAL_PREVIEW=1 \
pnpm exec vitest run src/lib/playground/rust.playwright.test.ts

WASM_IDLE_RUN_REAL_BROWSER_TINYGO=1 \
WASM_IDLE_BROWSER_URL='http://localhost:5173/absproxy/5173/' \
WASM_IDLE_REUSE_LOCAL_PREVIEW=1 \
pnpm exec vitest run src/lib/playground/tinygo.playwright.test.ts
```

Both runtime probes exercise the real Chromium page path. The default Rust probe now feeds stdin with a
single line (`5\n`) and expects the page to finish without sending EOF, which keeps the regression
aligned with the default Rust sample and proves that pressing Enter is enough for line-based stdin.
Programs that intentionally read stdin until EOF can still be finished with `Ctrl+D` or the toolbar
`Send EOF` button while the process is running.
The browser helper writes stdin through the page-owned `window.__wasmIdleDebug.writeTerminalInput(...)`
hook instead of trying to click xterm's hidden helper textarea, which proved too flaky for repeatable
Playwright runs.
The TinyGo probe follows the same pattern. The browser path should load the vendored runtime in
`direct` mode and avoid the old bootstrap compile command altogether.
The TinyGo browser commands currently default to `vite dev`.
If Rust ever reports `invalid metadata files for crate core` or `Unsupported archive identifier`,
the browser almost always fetched a stale or wrong `wasm-rust` sysroot asset. Hard refresh the page
and rebuild then resync `static/wasm-rust/` from `runtimes/wasm-rust/dist/`.
When browser-rustc does retry, it now emits a visible warning instead of only a debug-level
transition into attempt `2/5`, `3/5`, and so on.
When the Rust `log` option is enabled, those compile-time `wasm-rust` progress and retry lines are
also forwarded into the terminal transcript before the final runtime output, so the browser console
is no longer required to inspect build progress.
They also resync the vendored `wasm-rust` bundle and rebuild `wasm-idle` first, so the browser run is
checked against the current assets rather than a stale preview output.
The probe/test helper also claims a dedicated local preview port by default instead of reusing
whatever already answers on `localhost`, which keeps the regression target tied to the current build.
If you point the probe at `dev.seorii.io`, remember that route currently requires an authenticated
session; the repo-owned regression target is the local preview path above.

## Runtime expectations

The `wasm-idle`, `@wasm-idle/llvm-core`, and `@wasm-idle/lsp` npm packages contain host code only.
The `wasm-llvm` repository produces compiler assets but is not an npm runtime dependency. Static
compiler/runtime assets are deployed separately and loaded through `runtimeAssets` HTTP(S) URLs.
References to bundled assets below mean files deployed to the page's HTTP origin, not files embedded
in an npm package; library consumers must provide their own externally hosted URLs.

Rust still supports an external browser compiler module for library consumers. Point `PUBLIC_WASM_RUST_COMPILER_URL` at a built `wasm-rust` ESM entry such as `.../wasm-rust/dist/index.js`, or pass `runtimeAssets.rust.compilerUrl` at runtime.
TinyGo expects a browser-loadable `wasm-tinygo` runtime module. Point
`PUBLIC_WASM_TINYGO_MODULE_URL` at a built entry such as `.../wasm-tinygo/dist/runtime.js`, or
pass `runtimeAssets.tinygo.moduleUrl` at runtime. The older `PUBLIC_WASM_TINYGO_APP_URL` /
`runtimeAssets.tinygo.appUrl` document path is still accepted and normalized to `runtime.js`.
WAT uses the bundled `static/wasm-wat/` WABT browser module by default. Override it with
`PUBLIC_WASM_WAT_MODULE_URL`, or pass `runtimeAssets.wat.moduleUrl`.
WASM executes binary WebAssembly modules directly through the browser WebAssembly API. The editor
accepts base64, hex, or `data:application/wasm` content, and the worker connects WASI preview1
stdin/stdout/stderr plus the `env.readByte` import used by the WAT runner.
DuckDB uses `@duckdb/duckdb-wasm` in a browser worker against a fresh in-memory database per run.
Workspace files are registered before the active query; terminal input is registered as `stdin.txt`
and `/dev/stdin` for queries that load it as a file.
Lua uses the bundled `static/wasm-lua/` wasmoon browser module plus its local `glue.wasm`
payload by default. Override it with `PUBLIC_WASM_LUA_MODULE_URL`, or pass
`runtimeAssets.lua.moduleUrl`.
Zig uses the bundled `static/wasm-zig/zig_small.wasm` compiler and `static/wasm-zig/std.zip`
standard library by default. Override them with `PUBLIC_WASM_ZIG_COMPILER_URL` and
`PUBLIC_WASM_ZIG_STDLIB_URL`, or pass `runtimeAssets.zig.compilerUrl` and
`runtimeAssets.zig.stdlibUrl`. The compiler runs under browser WASI, emits a `wasm64-wasi`
artifact with the self-hosted backend, and wasm-idle executes that artifact locally in the worker.
Scheme uses the bundled `static/wasm-lisp/` Puppy Scheme compiler module by default. Override it
with `PUBLIC_WASM_LISP_MODULE_URL`, or pass `runtimeAssets.lisp.moduleUrl`.
Ruby uses the bundled `@ruby/3.4-wasm-wasi` CRuby `ruby+stdlib.wasm` asset by default. Override it
with `PUBLIC_WASM_RUBY_WASM_URL`, or pass `runtimeAssets.ruby.wasmUrl`.
AssemblyScript uses the bundled `assemblyscript` browser compiler and instantiates the emitted
WebAssembly locally. `_start` or `main` runs first; otherwise zero-argument numeric, boolean, and
string exports are printed to the terminal. AssemblyScript programs can import stdin helpers from
`env`: `readLine(): string | null`, `readAll(): string`, and `readByte(): i32`. `readLine` waits for
Enter-submitted terminal input, while `readAll` reads until Ctrl+D or the EOF button.
WAT modules can import `env.readByte(): i32` for byte-oriented stdin; it returns `-1` at EOF.
Haskell uses the bundled `static/wasm-haskell/` `ghc-in-browser` assets by default. Override them
with `PUBLIC_WASM_HASKELL_MODULE_URL`, `PUBLIC_WASM_HASKELL_ROOTFS_URL`, and
`PUBLIC_WASM_HASKELL_BSDTAR_URL`, or pass `runtimeAssets.haskell`. The worker extracts the wasm GHC
root filesystem, loads `dyld.mjs`, and invokes the browser GHC/GHCi entry point locally. Browser
stdin is wired into the dyld WASI fd0, so `getLine` reads terminal input.

The Rust browser path now executes returned artifacts through the target-appropriate runtime inside
the Rust worker:

- `wasm32-wasip1` runs as preview1 core wasm through `@bjorn3/browser_wasi_shim`
- `wasm32-wasip2` runs as a preview2 component through `preview2-shim` plus transpiled `jco` output

The generic `src/lib/clang/app.ts` host remains in place for other runtimes, but Rust now delegates
execution to `wasm-rust` so the selected target and returned artifact format stay aligned.

`Terminal` and `playground(...).load(...)` support either the legacy shared `path`/`rootUrl` or per-runtime asset config:

```ts
import type { PlaygroundRuntimeAssets } from 'wasm-idle';

const runtimeAssets: PlaygroundRuntimeAssets = {
	rootUrl: 'https://cdn.example.com/repl',
	python: {
		loader: async ({ asset }) => ({ url: `https://cdn.example.com/repl/pyodide/${asset}` })
	},
	java: {
		baseUrl: 'https://cdn.example.com/repl/teavm/'
	},
	clang: {
		loader: async ({ asset }) => ({ url: `https://cdn.example.com/repl/clang/${asset}` })
	},
	clangd: {
		loader: async ({ asset }) => ({ url: `https://cdn.example.com/repl/clangd/${asset}` })
	},
	rust: {
		compilerUrl: 'https://cdn.example.com/wasm-rust/index.js'
	},
	dotnet: {
		moduleUrl: 'https://cdn.example.com/wasm-dotnet/index.js'
	},
	tinygo: {
		moduleUrl: 'https://cdn.example.com/wasm-tinygo/runtime.js'
	},
	wat: {
		moduleUrl: 'https://cdn.example.com/wasm-wat/index.js'
	},
	lua: {
		moduleUrl: 'https://cdn.example.com/wasm-lua/index.js'
	},
	zig: {
		compilerUrl: 'https://cdn.example.com/wasm-zig/zig_small.wasm',
		stdlibUrl: 'https://cdn.example.com/wasm-zig/std.zip'
	},
	lisp: {
		moduleUrl: 'https://cdn.example.com/wasm-lisp/index.js'
	},
	haskell: {
		moduleUrl: 'https://cdn.example.com/wasm-haskell/dyld.mjs',
		rootfsUrl: 'https://cdn.example.com/wasm-haskell/rootfs.tar.zst',
		bsdtarUrl: 'https://cdn.example.com/wasm-haskell/bsdtar.wasm'
	},
	janet: {
		baseUrl: 'https://cdn.example.com/wasm-janet/',
		workerUrl: 'https://cdn.example.com/wasm-janet/runner-worker.js'
	},
	julia: {
		baseUrl: 'https://cdn.example.com/wasm-julia/',
		workerUrl: 'https://cdn.example.com/wasm-julia/runner-worker.js'
	},
	nim: {
		baseUrl: 'https://cdn.example.com/wasm-nim/',
		workerUrl: 'https://cdn.example.com/wasm-nim/runner-worker.js'
	}
};
```

Python custom loaders receive file names under the Pyodide asset root and can serve both core assets and package files. TeaVM custom loaders receive file names under the TeaVM asset root. Clang custom loaders receive `bin/memfs.zip`, `bin/clang.zip`, `bin/lld.zip`, and `bin/sysroot.tar.zip`; clangd custom loaders receive `clangd.js` and `clangd.wasm.gz`, with the worker decompressing the gzip payload before instantiation. Rust expects a browser-loadable compiler module URL; that module is responsible for serving its own nested runtime assets. C#, F#, and VB.NET expect a browser-loadable `wasm-dotnet` module with its language-specific static .NET `browser-wasm` runtime assets. TinyGo expects a browser-loadable runtime module. The browser runtime now ships a direct-mode execution path that can produce and run the bundled TinyGo WASI artifact locally, alongside `tools/go-probe.wasm` and vendored emception assets. TinyGo also accepts a runtime asset loader + pack bundle in `runtimeAssets.tinygo` when you need to serve runtime assets out of a single compressed archive. Compressed TeaVM runtime assets are no longer unpacked inside the library; provide the final file URL or handle decompression in your own loader.

If you want a host app to reuse the same runtime asset configuration for both `<Terminal>` and direct `playground(...)` access, bind it once:

```ts
import Terminal, { createPlaygroundBinding } from 'wasm-idle';

const wasmIdle = createPlaygroundBinding({
	rootUrl: 'https://cdn.example.com/repl',
	rust: {
		compilerUrl: 'https://cdn.example.com/wasm-rust/index.js'
	},
	dotnet: {
		moduleUrl: 'https://cdn.example.com/wasm-dotnet/index.js'
	},
	tinygo: {
		moduleUrl: 'https://cdn.example.com/wasm-tinygo/runtime.js',
		assetPacks: [
			{
				index: 'https://cdn.example.com/wasm-tinygo/runtime-pack/runtime-pack.index.json',
				asset: 'https://cdn.example.com/wasm-tinygo/runtime-pack/runtime-pack.bin',
				fileCount: 12,
				totalBytes: 123456
			}
		]
	}
});

const sandbox = await wasmIdle.load('PYTHON');
await sandbox.load('print("hi")', false);
```

```svelte
<Terminal {...wasmIdle.terminalProps} bind:terminal />
```

Compiler assets produced by [`wasm-llvm`](https://github.com/seo-rii/wasm-llvm) are deployed to
external static hosting and loaded by `@wasm-idle/llvm-core`. Also powered by Pyodide, TeaVM, `wasm-rust`,
`wasm-tinygo`, `wasm-dotnet`, `wasm-of-js-of-ocaml`, `wasm-typescript`, `wasm-lisp`,
`wasm-wat`, `wasm-lua`, `wasm-zig`, CBQN, Janet, AtomVM/Popcorn, and `ghc-in-browser`.
