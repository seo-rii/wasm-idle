# D browser compiler and shared modules

The D playground uses LDC 1.42.0 compiled for WASI and the shared Emscripten LLD
16.0.4 profile. Its compiler packaging recipe lives in `wasm-llvm/producer/d-browser`.
The browser adapter, WASI execution and playground lifecycle remain in
`runtimes/wasm-d` and `src/lib/playground/d.ts`.

## Importing compiler artifacts

Package the finalized LDC inputs with the wasm-llvm producer, then explicitly
select the resulting directory when building the consumer:

```sh
# In wasm-llvm; LDC_FINALIZED_DIR contains the producer's pinned finalized inputs.
pnpm run package:d -- --source "$LDC_FINALIZED_DIR" --out "$D_BROWSER_ARTIFACT_DIR"

# In wasm-idle.
WASM_LLVM_D_ARTIFACT_DIR="$D_BROWSER_ARTIFACT_DIR" pnpm --dir runtimes/wasm-d build
node scripts/sync-wasm-d.mjs
```

The consumer never searches for a sibling `ldc-wasm` checkout. Its checked-in
`runtimes/wasm-d/producer-lock.json` pins the producer manifest, source lock and
the complete output receipt. Import verifies that receipt first, then the exact
seven output files and every compressed asset's logical bytes. A changed file or
a replacement receipt fails before the installed runtime is removed. Sync repeats
this verification and copies the verified snapshot.

The producer currently preserves content-locked, finalized LDC artifacts. Its
recorded `ldc-wasm` recipe commit is provenance information; it does not attest
that those binary bytes were rebuilt from that commit. A future compiler upgrade
must update and review the producer inputs, output receipt and consumer lock.

Sync redirects LLD to `static/shared/emscripten-lld`, refreshes the installed
manifest/build receipts, and generates `wasmDVersion.ts`, `wasmDIntegrity.ts` and
the LSP outer receipts. The installed `producer-receipt.json` describes the
original producer output, before shared LLD paths and installed receipts are
rewritten. The installed manifest/build receipt describes the published layout.

## Shared compiler modules

The sandbox accepts the application's `RuntimeAssetCache` through
`setRuntimeAssetCache`. The host supplies one `RuntimeWasmModuleService` port for
LDC and one for LLD. It pins their uncompressed byte lengths and SHA-256 values,
checks bytes on every request, and partitions reuse by runtime asset policy,
compiler version, installed manifest, loader profile and execution limits. The
LLD identity includes its profile, JavaScript loader and data hashes.

The worker passes the resulting `WebAssembly.Module` to the actual WASI
instantiation and Emscripten `instantiateWasm` hook. Only immutable compiler
modules survive execution. Every completed execution retires its worker; the next
run loads a fresh worker and receives new compiler instances, memories, filesystem and
guest state. A prepare-only call executes no guest, so its worker keeps the compiled
artifact for the following execution of the same source instead of compiling twice. Cancellation closes that run's service endpoints without cancelling
another consumer of the same pending native compilation.

A sandbox disposes only the cache it owns. A borrowed application cache survives
sandbox disposal. Standalone sandboxes own a local cache; custom runtime bundles
and environments without MessageChannel use the independent compilation path.

## Validation

Focused tests cover pinned producer imports, corrupted delivery and logical bytes,
native module injection, cross-worker cache reuse, private memories, cancellation
and custom-runtime fallback. The real-runtime test compiles and links a D
stdin/stdout program when the imported artifacts are present.

```sh
pnpm --dir runtimes/wasm-d check
pnpm --dir runtimes/wasm-d test
pnpm exec vitest run src/lib/playground/d.test.ts src/lib/playground/d-module-cache.test.ts src/lib/sync-wasm-d.test.ts
WASM_IDLE_RUN_REAL_BROWSER_D_MODULE_CACHE=1 pnpm exec vitest run src/lib/playground/d-module-cache.playwright.test.ts
```
