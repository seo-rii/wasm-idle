# wasm-php static runtime producer

This standalone pnpm workspace builds the PHP 8.4 browser runtime without adding PHP build
dependencies to the wasm-idle workspace. PHP package, Vite, and esbuild versions are exact and
captured in the lockfile. The generated runtime manifest records only the packages required by the
deployed runtime, not the producer-only bundler toolchain.

## Build

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run verify
```

`dist/runtime.mjs` is the consumer entry. Its chunks and binary assets remain relative to that
module. `dist/runtime-manifest.v1.json` records resolved PHP runtime package versions plus every
output file's uncompressed byte count and SHA-256 digest. Verification also checks the exported
API, JSPI/Asyncify loader branches, and every generated local chunk/asset reference.

## Consumer sync

After verification, replace the consumer's PHP static-runtime directory with the contents of
`dist/`. Keep this producer output outside npm packages and serve it from the consumer's external
static-asset URL. The consumer owns compression and deployment; this producer does not modify
`wasm-idle/static`.

## Deferred verified startup

`dist/startup.mjs` is the lightweight factory used by the first-party application.
Importing it does not download or initialize PHP. Calling `createPhp84()` selects
the supported JSPI/Asyncify branch and starts the selected Wasm download, bounded
SHA-256 verification and native compilation alongside the JavaScript loaders.
Instantiation is gated on successful receipt verification. The other mode and
unused intl extensions are not fetched. The existing `runtime.mjs` and its named
`PHP` export remain available to legacy consumers. No built-in PHP extensions are
removed from either binary, and this does not claim to reduce their download size.

The new entry accepts `{ asyncMode: 'auto' | 'jspi' | 'asyncify' }` (default `auto`).
An explicit unsupported JSPI request fails rather than loading an incompatible
binary. Up to two immutable native modules are cached per worker realm, with
failed promises evicted; each factory call still creates fresh runtime memory,
filesystem and PHP state. There is no persistent or cross-tab cache.

After building, run `node scripts/probe-startup.mjs` from this directory with the
root development dependencies installed and Chromium available. The probe tests
both modes, native-module reuse, isolated filesystems, I/O, legacy entry behavior
and rejected instantiation. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` may select a local
Chromium executable. Unit tests are in `src/lib/php-startup-loader.test.ts` at
the repository root and participate in the normal application test suite.
