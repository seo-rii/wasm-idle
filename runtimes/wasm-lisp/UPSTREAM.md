# Upstream Provenance

This runtime vendors the Puppy Scheme WASM compiler binary used by `wasm-idle`
for browser-side Lisp-family compilation.

- Upstream repository: `https://github.com/matthewp/puppy-scheme`
- Upstream release: `v0.0.7`
- Upstream revision: `315dcebacea3af8dbfa87285598210c71a4dca47`
- Vendored release asset: `vendor/puppy-scheme/puppyc.wasm`
- Release asset SHA-256: `5a1429982560c20d808def1c7b546ba846063c780db8c1f7249488a688b7964d`
- Vendored license: BSD-3-Clause

The release digest and repository revision are pinned, but upstream does not
publish an attestation that proves this binary was built from that revision.
`runtime-build.json` and `THIRD_PARTY_NOTICES.md` preserve that limitation
instead of claiming source-to-binary verification.

The runtime does not implement a small replacement compiler. It runs the
upstream self-hosting Scheme compiler in WebAssembly.

The browser distribution bundles the pinned JCO and Preview 2 shim code into a
self-contained `index.js`. The sync step accepts only that entry, the generated
Puppy binding, and its two core modules; it verifies every source receipt and
publishes a fingerprinted manifest consumed by both execution and LSP workers.

To rebuild and publish the static runtime assets:

```bash
pnpm --dir runtimes/wasm-lisp build
pnpm sync:wasm-lisp
```
