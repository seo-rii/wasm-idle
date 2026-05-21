# Browser Runtime Contract

`wasm-of-js-of-ocaml` exposes a compile surface that is intentionally smaller than a full local OCaml environment.

## Public Compile API

The browser-facing API is defined by `src/types.ts`.

```ts
type CompileTarget = "js" | "wasm";
type WasmBinaryenMode = "fast" | "full";

type CompileRequest = {
  files: Record<string, string>;
  entry: string;
  target: CompileTarget;
  packages?: string[];
  effectsMode?: "cps" | "jspi";
  wasmBinaryenMode?: WasmBinaryenMode;
  sourcemap?: boolean;
};
```

`CompileResult` always returns:

- captured `stdout`
- captured `stderr`
- normalized diagnostics
- an artifact array that can carry JS, wasm, source maps, or text diagnostics such as the compile plan

## Toolchain Boundary

The worker owns:

- request validation
- workspace staging into a writable in-memory filesystem
- compile plan construction
- artifact collection from `/workspace/_build`

The host/runtime layer owns:

- mounting `/toolchain`
- executing supported subprocesses
- stdout/stderr capture for bytecode tools
- bridging Binaryen-style wasm post-processing

## Supported Subprocess Surface

The browser substrate is intentionally restrictive. It only dispatches the commands below:

- `ocamlc`
- `ocamlfind`
- `js_of_ocaml`
- `wasm_of_ocaml`

No shell emulation is assumed. Any upstream code path that still depends on `Sys.command` or redirections needs to move behind explicit host bridges.

## Filesystem Contract

The worker currently assumes these writable locations:

- `/workspace`
- `/workspace/_build`
- `/tmp`

The host-provided toolchain is mounted read-only under `/toolchain`.

## Bring-up Defaults

- `wasm_of_ocaml` browser bring-up defaults to `effectsMode: "cps"`.
- `wasm_of_ocaml` browser bring-up defaults to `wasmBinaryenMode: "fast"` to avoid loading the highest-memory Binaryen passes. Use `"full"` to run the original static `wasm-merge`, `wasm-metadce`, and `wasm-opt` sequence.
- Binaryen browser integration must use static local assets from the manifest. Runtime calls to `/api/binaryen-command` or any remote Binaryen service are outside the browser-native contract.
- wasm source maps stay disabled during early browser bring-up.
- runtime variants are expected to be precompiled on the host and copied into the frozen bundle.

See also:

- [Browser-native architecture](browser-native.md)
- [Testing guide](testing.md)
