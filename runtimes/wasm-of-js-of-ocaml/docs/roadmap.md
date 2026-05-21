# Roadmap

The long-term target is a frozen browser OCaml toolchain that can compile controlled OCaml projects to JavaScript and WebAssembly artifacts without a server-side compiler API.

## Completed Bring-Up

- Public compile API for `js` and `wasm` targets.
- In-memory filesystem and allowlisted subprocess dispatcher.
- Host-built frozen switch scripts.
- Browser-native `ocamlc`, `js_of_ocaml`, and `wasm_of_ocaml` execution path.
- Static local Binaryen bridge for `wasm_of_ocaml`.
- Compressed browser-native runtime pack.
- Browser harness and Playwright validation for hello, wasm, diagnostics, and `yojson`.
- Default lower-memory `wasmBinaryenMode: "fast"` with opt-in `"full"`.

## Near-Term Work

- Make package recipes stricter and easier to audit.
- Add more pure OCaml package fixtures.
- Improve browser memory profiling and artifact size reporting.
- Stabilize the manifest format before public package publication.
- Add downstream bundle stale-check examples.

## Package And Build Expansion

- Multi-module graph support beyond simple fixture ordering.
- Per-module bytecode cache.
- Recipe-based package lazy loading.
- Limited whitelisted ppx driver support.
- More complete findlib metadata handling without shell behavior.

## Advanced Features

- Source map artifacts.
- Browser-safe source content policy.
- JSPI mode with capability detection and CPS fallback.
- Incremental compile for editor use.
- Execution and preview APIs for generated artifacts.

## Still Out Of Scope

- Full opam in the browser.
- General C stub support.
- Full `dune build` compatibility.
- Dynlink completeness.
- Full OCaml toplevel compatibility.
