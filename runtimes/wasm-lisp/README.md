# wasm-lisp

Browser runtime for Lisp-family support in `wasm-idle`.

This runtime vendors Puppy Scheme's self-hosting `puppyc.wasm` compiler and
transpiles that existing WASM component into browser-loadable JavaScript during
the package build. At execution time, the browser worker runs `puppyc.wasm`,
compiles the user's Scheme source into a WASM component, transpiles that
component with JCO in the browser, and runs the result with preview2 WASI shims.

## Build

```bash
pnpm --dir runtimes/wasm-lisp build
pnpm sync:wasm-lisp
```
