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
