# wasm-dotnet

Browser-loadable .NET C#, F#, and VB.NET compiler/runtime glue for `wasm-idle`.

The TypeScript entry exposes the same browser compiler contract used by the other `wasm-*`
projects:

- `createDotnetCompiler()`
- `compileDotnet()`
- `executeBrowserDotnetArtifact()`

Compile and run stay in the browser. C#, F#, and VB.NET each have a static .NET `browser-wasm`
app under `dist/runtime/{csharp,fsharp,vbnet}/`. JavaScript selects the matching `dotnet.js`,
calls exported .NET methods, and keeps compiled assemblies in that browser runtime. Execution
requests can pass CLI args, environment variables, and stdin text to the generated assembly.

## Runtime layout

The runtimes use the .NET 9.0.16 multithreaded `browser-wasm` workload. The C# bundle contains
Roslyn C# 4.14.0, the F# bundle contains FSharp.Compiler.Service 43.12.204 and FSharp.Core
10.1.204, and the VB.NET bundle contains Roslyn Visual Basic 4.14.0. Each selected compiler,
System.Private.CoreLib, and the BCL assemblies on its hot path are AOT compiled. The compiler host
and remaining framework assemblies stay interpreted. FSharp.Compiler.Service and FSharp.Core are
trim roots because FCS depends on metadata and resources that cannot be inferred statically.

Compiler assemblies are core assets in their own language bundle. AOT generic registration needs
their metadata during startup, so moving them to .NET's lazy assembly group causes startup failure.
No .NET asset is fetched before C#, F#, or VB.NET is selected. Selecting one language fetches only
its runtime directory plus the filtered shared reference set under `dist/runtime/ref/`; it does not
fetch either of the other compiler bundles.

F# compilation uses `fsc.exe --target:exe --targetprofile:netcore --noframework
--simpleresolution --nowin32manifest --debug- --optimize-`. Its reference set includes FSharp.Core,
netstandard, System.Collections, System.Console, System.Net.Requests, System.Net.WebClient,
System.Runtime, System.Runtime.Numerics, and `WasmDotnet.Stdin`. C# and VB.NET compile through
Roslyn with concurrent builds disabled. All three languages rewrite `Console` input calls to the
buffered browser stdin shim before compilation. The shim is a compiler-independent assembly shared
by all three bundles.

The playground executes the threaded runtime on the browser UI thread. The .NET Monaco language
servers use an in-process `MessageChannel` JSON-RPC transport for the same reason: Emscripten treats
a host Web Worker as a pthread worker and cannot start the threaded runtime there. The compiler hot
paths are AOT compiled, keeping diagnostics responsive while preserving the existing language-server
transport contract.

## Build

Build the TypeScript browser module:

```sh
npm run build
```

Build the .NET browser runtime assets when a .NET SDK with WebAssembly workloads is available:

```sh
dotnet workload install wasm-tools
dotnet workload install wasm-experimental
npm run build:runtime
```

After both steps, sync this project into `wasm-idle`:

```sh
cd ../wasm-idle
pnpm run sync:wasm-dotnet
```
