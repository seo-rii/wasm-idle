# Coq source and release record

The browser runs the original jsCoq 0.17.1 JavaScript kernel, built from the full Coq
8.17.1 implementation. It is compiled by js_of_ocaml 4.0.0 with OCaml 4.12.0+32bit.
The kernel and matching `init` / `coq-base` ZIP archives are unchanged files from
the published `jscoq@0.17.1` distribution. Each URL, byte count and SHA-256 is in
`upstream.json`; the original npm distribution integrity is recorded there too.

Corresponding source is available from the exact jsCoq and Coq archive URLs in
`upstream.json`. jsCoq's git submodule pins Coq SerAPI to
`a224455c7ce3975fb9ebb2ad687d54b71eaabff2`. The original build instructions,
Makefile, toolchain setup and all three 32-bit Coq patches are retained here.
`upstream-build.sh NEW_DIRECTORY` follows that source build without changing
language semantics. This records a source-build route; bit-for-bit reproducibility
of the historical npm release has not been asserted.

jsCoq is AGPL-3.0-or-later. The original copyright/license inventory and complete
AGPL text are retained and served beside the assets. Coq and SerAPI use LGPL,
OCaml, js_of_ocaml and Zarith include their original linking exceptions; their
complete license records are retained. The MIT/BSD notices of the OCaml support
libraries (Jane Street, Lwt, Yojson and ppx_deriving), and the GPL text referenced
by SerAPI, are also included. The historical release has no complete OPAM lockfile;
transitive dependency versions are not reconstructed or asserted. The host worker bundles the existing
fflate dependency for ZIP delivery and retains its MIT license. No frontend
images, fonts, UI libraries or npm jsCoq runtime dependencies are shipped.

Run `pnpm sync:wasm-coq` to verify the committed original bytes and regenerate the
host worker, build manifest and TypeScript receipts. `--check` is read-only.
`--download` is the explicit opt-in restoration path for the same pinned release.
Normal page builds never download the compiler or libraries.

Only host I/O, isolated virtual files, output quotas and worker lifecycle are
adapted. Source and stdin are whole files submitted to native `Load` through the
original `Put` / `Load` protocol. There is no source splitter, translator,
proof emulator or replacement evaluator. The original build disables the native
and bytecode execution engines; `Compute` uses Coq's documented `cbv` fallback.
