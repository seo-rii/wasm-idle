# LLVM consumer contracts

These code-only modules validate build artifacts consumed by `wasm-idle`. Their behavior is
derived from the corresponding producer profiles in `wasm-llvm`, but they are owned and loaded
locally so synchronization tooling never imports the producer repository as an npm dependency.

The directory must not contain compiler binaries or other static runtime assets. Producer identity
strings are retained only when they are part of an artifact provenance contract.

When a producer contract changes, update the matching module and its consumer tests together:

- `emscripten-lld.mjs`: shared Emscripten LLD profile and asset-reference validation
- `nim.mjs`: Nim LLVM profile validation
- `rust.mjs`: split and integrated Rust runtime manifest validation
- `tinygo.mjs`: TinyGo emception profile, worker patching, and checksum validation
- `swift/`: Swift runtime contract, build-info, and runtime-manifest validation
