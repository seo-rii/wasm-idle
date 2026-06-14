# wasm-dotnet

Browser-loadable .NET C#, F#, and VB.NET compiler/runtime glue for `wasm-idle`.

The TypeScript entry exposes the same browser compiler contract used by the other `wasm-*`
projects:

- `createDotnetCompiler()`
- `compileDotnet()`
- `executeBrowserDotnetArtifact()`

Compile and run stay in the browser. The compiler is a static .NET `browser-wasm` app under
`dist/runtime/`; JavaScript loads its `dotnet.js`, calls exported .NET methods, and keeps
compiled assemblies in the browser runtime. Execution requests can pass CLI args, environment
variables, and stdin text to the generated assembly.

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
