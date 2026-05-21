# R Runtime Package

`@wasm-idle/runtime-r` wraps the `webR` WebAssembly distribution for R execution in browsers and
Node-capable hosts.

- package: `webr`
- core assets: `R.js`, `R.wasm`, `webr-worker.js`, BLAS/LAPACK shared objects, and VFS data under
  `dist/vfs/`

The package exposes URL helpers, a core asset manifest, and a dynamic import helper for the `WebR`
constructor.

```bash
pnpm --dir runtimes/r run build
pnpm --dir runtimes/r run check
```
