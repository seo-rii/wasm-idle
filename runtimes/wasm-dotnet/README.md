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

The playground executes the threaded runtime in a dedicated host Worker so cancellation can
terminate compilation and user code. The host sets `dotnetSidecar`; the runtime patcher ensures
Emscripten reads `ENVIRONMENT_IS_WORKER` after .NET initializes its replacements. This identifies
the host as the runtime's main thread while preserving normal initialization of its pthreads.
The patcher rejects unfamiliar generated code and refreshes the native JS integrity hash in the
boot manifest. Runtime abort and exit callbacks reject pending initialization, compilation, and
execution immediately. The .NET Monaco language servers retain their in-process `MessageChannel`
JSON-RPC transport.

## Debugging prerequisites

`compile({ debug: true, sourcePath: '/workspace/nested/Program.cs', ... })` asks the real
compiler to emit Portable PDB symbols. C# and VB use Roslyn's Portable PDB emitter; F# uses
`--debug:portable`, `--pdb` and `--pathmap`. The host loads the PE and PDB together with
`Assembly.Load(pe, pdb)`. `artifact.debug` contains the virtual document path, assembly name,
module version ID and the actual PE/PDB bytes as base64. Source paths must be normalized files
under `/workspace/`. This API generates symbols without attaching a debugger.
The existing stdin adaptation still runs before compilation; PDB checksums and columns therefore
describe that compiled source. A source debugger must account for those existing substitutions
when matching editor text and column positions.

The TypeScript wrapper rejects a debug request if an older managed compiler silently omits its
PDB response. Updating the TypeScript module alone therefore cannot enable this feature in an
already published runtime: `WasmDotnet.Compiler` must also be rebuilt and repackaged. The normal
compile/run API continues to work with older bundles.

For a compatible native runtime, `loadDotnetCompilerRuntime({ enableDebugging: true, language })`
calls the official `.withDebugging(1)` builder and preserves that level in `onConfigLoaded`
after the boot manifest merges, then exposes `debugAgent`. The
`connectMonoDebugAgent(runtime)` export can also connect to an already created runtime. It checks
Mono's actual `VM.Version` response through `INTERNAL.mono_wasm_send_dbg_command`, rather than
inferring native support from JavaScript function names. Its `attach`, `detach`, and `sendCommand`
methods delegate to the runtime's soft debugger. Debug-enabled and ordinary runtime instances
have separate cache entries. Start a fresh Worker for a debug session: the native host builder
returns its existing runtime after initialization and cannot enable native debugging retroactively.

This is a symbol/agent integration layer, not a finished source debugger. The app still needs the
Mono BrowserDebugProxy semantics (Portable PDB sequence points, managed frames, variables and
events) between the agent and the UI/CDP transport. A native source breakpoint, stack/locals and
step/continue browser session must pass before enabling the .NET debug button. The shared JS CDP
adapter alone does not provide those managed-language semantics.

The bridge follows the pinned .NET runtime's
[debug agent entry points](https://github.com/dotnet/runtime/blob/a1e6809fb8318884882ceff057000654f558738a/src/mono/browser/runtime/debug.ts)
and [VM command definitions](https://github.com/dotnet/runtime/blob/a1e6809fb8318884882ceff057000654f558738a/src/mono/browser/debugger/BrowserDebugProxy/MonoSDBHelper.cs).
To test the current browser runtime without publishing/AOT-compiling it:

```sh
pnpm --dir runtimes/wasm-dotnet build
node runtimes/wasm-dotnet/scripts/probe-debug-runtime.mjs runtimes/wasm-dotnet/dist out/dotnet-debug-agent.json csharp
```

The probe uses Chromium, the bundle's configured pthread pool, and a 90-second worker deadline.
An `agent-connected` result only proves native command transport; it records that breakpoints/frames/locals
have not been qualified. Timeouts and missing assets are probe errors, not proof of missing runtime
support.

The [2026-10-23 browser receipt](docs/native-agent-20261023.json) boots the current C# bundle with
`debugLevel: 1`, then records a failed real `VM.Version` call. Inspection of that exact Wasm shows
both command exports have the body `00 41 00 0b` (no locals, return integer zero). These match
the pinned runtime's [debugger stubs](https://github.com/dotnet/runtime/blob/a1e6809fb8318884882ceff057000654f558738a/src/mono/mono/component/debugger-stub.c#L228).
The preserved link response also selects `libmono-component-debugger-stub-static.a`.
JavaScript wrappers and the ready flag cannot replace the missing native component.

This failure is not an omitted attach call: the official
[proxy initialization](https://github.com/dotnet/runtime/blob/a1e6809fb8318884882ceff057000654f558738a/src/mono/browser/debugger/BrowserDebugProxy/MonoProxy.cs#L1572)
sends commands and reads the VM version before setting the attached flag. The current AOT runtime
also [skips native debugger initialization](https://github.com/dotnet/runtime/blob/a1e6809fb8318884882ceff057000654f558738a/src/mono/browser/runtime/runtime.c#L263).
A producer profile with the real debugger component and compatible initialization is required,
followed by the managed proxy and actual source-session tests. No full AOT publish was run for
this change; the current deployed runtime assets remain unchanged.

The native regression runner validates each real compiler's PDB document path, sequence points and
local names, then executes the generated assembly with stdin. It does not publish the browser runtime:

```sh
for language in csharp vbnet fsharp; do
  dotnet run --project runtimes/wasm-dotnet/dotnet/ReferenceTests/ReferenceTests.csproj \
    -p:WasmDotnetLanguage="$language" -- "$DOTNET_ROOT/packs/Microsoft.NETCore.App.Ref/9.0.16/ref/net9.0"
done
```

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
