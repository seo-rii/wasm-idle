# TeaVM Runtime Package

`@wasm-idle/runtime-teavm` wraps the TeaVM browser compiler/runtime assets with reusable asset
manifests, URL resolution, and fetch helpers.

Java execution uses TeaVM's browser compiler/runtime assets from `static/teavm/`:

- `compiler.wasm`
- `compiler.wasm-runtime.js`
- `compile-classlib-teavm.bin`
- `runtime-classlib-teavm.bin`

No local TeaVM source checkout was found next to the existing runtime repositories. These files are
therefore tracked as external runtime artifacts with a wrapper package here, while Java-specific
integration code lives in `src/lib/playground/worker/java.ts` and
`src/lib/playground/javaStdin.ts`.

The wrapper and browser application pin all four logical assets to the same exact byte counts and
SHA-256 receipts. `static/teavm/runtime-manifest.v1.json` also records the checked-in gzip storage
receipts and the repository commit that imported this legacy asset generation. A custom base URL or
loader remains a mirror for the pinned generation unless the caller explicitly supplies a complete
replacement receipt set.

Build and type-check the wrapper package with:

```bash
pnpm --dir runtimes/teavm run build
pnpm --dir runtimes/teavm run check
```

If a local TeaVM build project is added later, put it under this directory and wire a sync script to
copy the four generated files into `static/teavm/`, regenerate the manifest and both consumer pins,
and retain the exact receipt verification at each browser boundary.
