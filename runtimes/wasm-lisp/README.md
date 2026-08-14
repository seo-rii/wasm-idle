# wasm-lisp

Browser runtime for Lisp-family support in `wasm-idle`.

This runtime vendors Puppy Scheme's self-hosting `puppyc.wasm` compiler and
transpiles that existing WASM component into browser-loadable JavaScript during
the package build. At execution time, the browser worker runs `puppyc.wasm`,
compiles the user's Scheme source into a WASM component, transpiles that
component with JCO in the browser, and runs the result with preview2 WASI shims.

The build pins the Puppy release artifact, JCO, Preview 2 shim, TypeScript, and
esbuild inputs. It emits a self-contained browser entry plus the Puppy binding
and two core modules. `scripts/sync-wasm-lisp.mjs` verifies those receipts and
publishes `runtime-manifest.v2.json`; consumers verify the manifest fingerprint,
stored bytes, decompressed size, and logical asset hash before importing code.

## Build

```bash
pnpm --dir runtimes/wasm-lisp build
pnpm sync:wasm-lisp
```
