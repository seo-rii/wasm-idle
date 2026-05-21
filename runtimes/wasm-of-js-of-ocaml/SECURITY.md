# Security Policy

## Supported Versions

`wasm-of-js-of-ocaml` is currently experimental. Security fixes should target the default branch unless maintainers explicitly define release branches.

## Reporting A Vulnerability

Do not publish exploit details in a public issue.

Report privately through GitHub private vulnerability reporting if it is enabled for the repository. If private reporting is not available, contact the maintainer through GitHub with a minimal description and a request for a private disclosure channel.

## Security Model

The browser toolchain is designed around a restricted execution surface:

- Tool execution is allowlisted to known OCaml tools.
- Browser-native `wasm_of_ocaml` Binaryen work uses static local assets.
- The runtime does not provide a general shell.
- The browser bundle is frozen and generated on the host.

This is not a sandbox for untrusted native tooling. Do not treat arbitrary opam packages, C stubs, ppx drivers, or generated JavaScript as trusted merely because compilation happens in a browser worker.

## Out Of Scope

- Vulnerabilities in upstream OCaml, `js_of_ocaml`, `wasm_of_ocaml`, Binaryen, Playwright, or browser engines unless this project introduces the vulnerable integration behavior.
- Attacks that require running arbitrary local development commands outside the documented scripts.
- Issues caused by publishing a bundle with a locally modified frozen switch that is not represented in the manifest.
