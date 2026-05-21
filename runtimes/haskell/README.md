# Haskell Runtime Package

`@wasm-idle/runtime-haskell` wraps build metadata for the GHC WebAssembly backend.

GHC's Wasm backend is distributed as an external toolchain, not as an npm-hosted browser compiler.
This package centralizes:

- `wasm32-wasi-ghc` compile command construction
- post-link JavaScript wrapper command construction
- generated `.wasm`/`.mjs`/`.js` asset manifests

```bash
pnpm --dir runtimes/haskell run build
pnpm --dir runtimes/haskell run check
```
