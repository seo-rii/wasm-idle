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

## Startup and isolation

`createPhp84()` automatically selects JSPI when supported, otherwise Asyncify. An explicit
`createPhp84({ asyncMode: 'asyncify' })` or `createPhp84({ asyncMode: 'jspi' })` selects a profile;
unsupported JSPI fails before requesting engine assets. Only the selected engine's large loader
and Wasm are fetched, in parallel. Build-pinned byte lengths and SHA-256 receipts are checked
before a compiled module can be instantiated. Loading failures are retryable and preparation
is bounded by a timeout.

The module keeps at most the two engines' immutable compiled code in its own realm. Each factory
call still creates a new PHP VM, memory and filesystem. This is not a cross-tab or persistent
cache and does not remove extensions from the distribution. To exercise both actual engines in
Chromium, run `node scripts/probe-wasm-php-startup.mjs producers/wasm-php/dist` from the repository
root after building; the probe also checks the parallel fetch dependency and VM isolation.
