# Testing Guide

This project has three validation layers: host pipeline tests, browser-native bundle checks, and browser-native Playwright execution.

## Fast TypeScript Check

```sh
npm run check
```

Runs TypeScript type checking without producing build output.

## Host Pipeline

```sh
npm run test:host-pipeline
```

Validates the Node-hosted compile pipeline. This uses host executables and is useful before debugging browser-specific worker behavior.

## Browser-Native Bundle Metadata

```sh
npm run test:browser-native-bundle
```

Validates:

- `wasm_of_ocaml` browser Binaryen bridge patch metadata.
- Static Binaryen browser tool patch metadata.
- Static version placeholder patch metadata.
- Supported package manifest entries.
- Compressed runtime pack metadata and index contents.

Run `npm run prepare:browser-native -- --force` first when the bundle is missing or stale.

## Browser-Native Playwright

```sh
npx playwright install --with-deps chromium
npm run test:browser-native
```

Validates in Chromium:

- `hello.ml -> hello.js`.
- `hello.ml -> hello.js + hello.assets/*.wasm`.
- `yojson` package fixture for JS and wasm targets.
- Type error diagnostic normalization.
- Static local Binaryen assets.
- Default `fast` mode avoids loading `wasm-opt` and `wasm-metadce`.
- Explicit `wasmBinaryenMode: "full"` loads all static Binaryen tools.

## CI Parity

```sh
npm run test:ci
```

Runs the same broad sequence as GitHub Actions:

```text
build
host pipeline
prepare browser-native bundle
browser-native bundle metadata tests
browser-native Playwright tests
```

## Debugging Browser Failures

Check these first:

- `browser-native-manifest.v1.json` exists and points to static local assets.
- `.cache/browser-native-bundle/tools/*.browser.js` files are served with JavaScript content type.
- The runtime pack asset and index are both served.
- The browser does not issue `POST /api/binaryen-command`.
- `wasmBinaryenMode` is `fast` unless testing the full optimizer path.

If the tab crashes, retry with `wasmBinaryenMode: "fast"` and a small fixture before profiling larger package compiles.
