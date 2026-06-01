# Upstream Provenance

This runtime vendors the Puppy Scheme WASM compiler binary used by `wasm-idle`
for browser-side Lisp-family compilation.

- Upstream repository: `https://github.com/matthewp/puppy-scheme`
- Upstream release: `v0.0.7`
- Vendored compiler: `compiler/puppyc.wasm`
- Vendored license: BSD-3-Clause

The runtime does not implement a small replacement compiler. It runs the
upstream self-hosting Scheme compiler in WebAssembly.

To rebuild and publish the static runtime assets:

```bash
pnpm --dir runtimes/wasm-lisp build
pnpm sync:wasm-lisp
```
