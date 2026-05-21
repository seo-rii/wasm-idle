# AssemblyScript Runtime Package

`@wasm-idle/runtime-assemblyscript` wraps the AssemblyScript npm compiler and runtime loader.

- compiler package: `assemblyscript`
- loader package: `@assemblyscript/loader`
- compiler module: `assemblyscript/asc`

The package exposes URL helpers for vendored AssemblyScript assets, compile argument construction,
dynamic imports for the compiler and loader modules, and an in-memory `compileAssemblyScript`
helper that uses the browser-compatible AssemblyScript compiler API.

```bash
pnpm --dir runtimes/assemblyscript run build
pnpm --dir runtimes/assemblyscript run check
```
