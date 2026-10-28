# OCaml browser compiler inputs: 5.5.2 / 6.5.0

Qualified OCaml 5.5.2, js_of_ocaml 6.5.0 and wasm_of_ocaml 6.5.0 browser compiler
inputs, plus Binaryen 132 JavaScript tools. These files are inputs to
`scripts/prepare-ocaml-browser-wrapper.mjs`; that script rebuilds the browser
adapter from tracked TypeScript before installing the bundle.

The compiler and libraries come from the OPAM package sources recorded in
`runtimes/wasm-of-js-of-ocaml/validation/5.5.2-6.5.0.opam.export`. It includes
resolved package versions, source URLs, checksums and package license metadata.
Upstream root license/copyright files are retained in `licenses/`.

Rebuild using the runtime README and `scripts/prepare-browser-native.mjs`.
The recipe includes the OCaml 5.5 dynamic-linking primitives, resolves findlib
paths into the browser filesystem, removes build-time version probes, normalizes
Wasm runtime module paths, and bridges Binaryen subprocess commands to the
browser tools. The upstream compiler implementations are preserved.

Six tool scripts use deterministic gzip (level 9, modification time 0). The
runtime pack retains the producer's compressed bytes. The qualification receipt
records every delivered file and actual compiler/Worker acceptance; it does not
claim cross-machine byte reproducibility of OPAM builds.
