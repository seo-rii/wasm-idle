# wasm-php static runtime producer

This standalone pnpm workspace builds the PHP 8.4 browser runtime without adding PHP build
dependencies to the wasm-idle workspace. PHP package, Vite, and esbuild versions are exact and
captured in the lockfile. The generated runtime manifest records only the packages required by the
deployed runtime, not the producer-only bundler toolchain.

## Build

Use Node.js 24.18.0 or newer, matching the pinned PHP packages' engine requirement.

```sh
pnpm install --frozen-lockfile
pnpm test
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

## Native debugger capability

The shipped PHP 8.4.25 engine from `@php-wasm/web-8-4` 3.1.57 does not contain Xdebug.
The [runtime receipt](docs/debug-capabilities-20261023.json) records actual
`extension_loaded('xdebug')`, `function_exists('xdebug_break')` and `ini_get('xdebug.mode')`
results, the loaded Wasm SHA-256, and a successful stdin `7` to stdout `12` control.
To reproduce from the repository root without building PHP:

```sh
node producers/wasm-php/scripts/probe-debug-runtime.mjs static/wasm-php out/php-debug-agent.json asyncify
```

This runs the verified browser engine in a dedicated Node host, supplying local files for asset
fetches and selecting Emscripten's worker host path. It does not qualify browser breakpoint or
variable support. A timeout or loader failure is a probe error, not proof that Xdebug is unavailable.

[WordPress Playground's Xdebug build](https://github.com/WordPress/wordpress-playground/blob/trunk/packages/php-wasm/compile/shared/xdebug/Dockerfile)
provides a real Wasm extension build with `wasm_recv` and JSPI/Asyncify support. The remaining work
is to build/package the extension for this exact PHP ABI and async mode, provide its debugger
transport, and connect DBGp breakpoints, PHP stack frames and locals to the app. The current
`startup.ts` WebSocket decorator stubs networking, so packaging the extension alone would not
complete the transport. No PHP debug UI is enabled by this probe.
