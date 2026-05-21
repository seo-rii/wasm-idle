# Browser-Native Architecture

The browser-native path compiles OCaml without calling a server-side compiler API. Host scripts build and freeze the toolchain first; the browser later loads static assets and runs the compiler tools inside workers.

## Build-Time Flow

```text
host opam switch
  -> ocamlc.byte
  -> js_of_ocaml compiler bytecode
  -> wasm_of_ocaml compiler bytecode
  -> js_of_ocaml --target-env browser
  -> browser JS compiler tools
  -> browser-native manifest + runtime pack
```

`scripts/prepare-browser-native.mjs` writes the browser bundle under:

```text
.cache/browser-native-bundle/
```

The important outputs are:

- `browser-native-manifest.v1.json`
- `browser-native-runtime-pack.v1.bin.gz`
- `browser-native-runtime-pack.v1.index.json`
- `tools/ocamlc.byte.browser.js`
- `tools/js_of_ocaml.bc.browser.js`
- `tools/wasm_of_ocaml.bc.browser.js`
- `tools/wasm-merge.browser.js`
- `tools/wasm-metadce.browser.js`
- `tools/wasm-opt.browser.js`

## Runtime Flow

```text
compile(request)
  -> stage source files in in-memory FS
  -> run ocamlc through browser tool worker
  -> run js_of_ocaml or wasm_of_ocaml through browser tool worker
  -> collect /workspace/_build artifacts
  -> return CompileResult
```

The browser dispatcher is created with:

```ts
const manifest = await fetchBrowserNativeManifest();
const system = createBrowserWorkerSystemDispatcher({ manifest });
```

The compile handler passes all subprocess calls through that dispatcher. Unsupported commands fail instead of falling back to shell behavior.

## Static Assets Only

The browser-native path must use static local assets. `wasm_of_ocaml` Binaryen calls are bridged through `globalThis.__wasm_of_js_system_command`, but that bridge invokes static local browser tool files from the manifest.

Expected network behavior:

- `GET /.cache/browser-native-bundle/browser-native-manifest.v1.json`
- `GET /.cache/browser-native-bundle/browser-native-runtime-pack.v1.bin.gz`
- `GET /.cache/browser-native-bundle/browser-native-runtime-pack.v1.index.json`
- `GET /.cache/browser-native-bundle/tools/*.browser.js`

Unexpected behavior:

- `POST /api/binaryen-command`
- Remote Binaryen service calls.
- Shell command strings with redirection.

The Playwright tests assert that the browser-native path does not call `/api/binaryen-command`.

## Runtime Pack

The runtime pack stores OCaml stdlib and supported package files in one compressed asset. The index maps each virtual toolchain path to a byte range inside the decompressed payload.

This reduces the number of static file requests and avoids leaving thousands of individual package files in downstream apps.

## Binaryen Modes

`wasmBinaryenMode` is part of `CompileRequest`.

```ts
type WasmBinaryenMode = 'fast' | 'full';
```

`fast` is the default browser mode. It runs the required merge step and skips the highest-memory post-processing passes by writing pass-through wasm outputs.

`full` runs the original local static Browser Binaryen sequence:

- `wasm-merge`
- `wasm-metadce`
- `wasm-opt`

Use `full` when smaller optimized output is more important than browser memory headroom.

## Package Resolution

Package support is manifest-based. `ocamlfind ocamlc` invocations are expanded by the browser dispatcher for bundled packages only.

Current behavior:

- Package closure is resolved from manifest metadata.
- Include paths and bytecode archive link arguments are injected explicitly.
- Missing packages produce deterministic browser-native errors.

This is deliberately narrower than full findlib behavior.

## Integration Notes

Downstream static apps should publish the whole `.cache/browser-native-bundle` directory or copy its contents under an equivalent static prefix, then keep manifest paths consistent with the served location.

If the bundle is mirrored into another project, add a stale-bundle check that compares the manifest and expected compiler package version. `wasm-idle` uses this pattern when syncing the OCaml browser toolchain.
