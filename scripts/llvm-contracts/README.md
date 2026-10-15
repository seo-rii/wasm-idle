# LLVM consumer contracts

These code-only modules validate build artifacts consumed by `wasm-idle`. Their behavior is
derived from the corresponding producer profiles in `wasm-llvm`, but they are owned and loaded
locally so synchronization tooling never imports the producer repository as an npm dependency.

The directory must not contain compiler binaries or other static runtime assets. Producer identity
strings are retained only when they are part of an artifact provenance contract.

When a producer contract changes, update the matching module and its consumer tests together:

- `archive.mjs`: exact single-file ZIP names, CRC and expansion bounds, plus TAR
  checksums, payload bounds, safe unique regular-file paths and required file sets.
- `clang-build-provenance.mjs`: preserve a declared verified Clang build receipt and
  bind its source/tool evidence to the raw inputs installed by the consumer. A declared
  unverified build is rejected by normal synchronization. `clang-legacy-release.mjs`
  limits receipt-free compatibility to the exact independently pinned metadata and six
  raw inputs of the installed historical bundle, including its complete sysroot derivation.
- `clangd-artifact-contract.mjs`: named and minified Emscripten stdin import wiring,
  adapted from `wasm-llvm` commit `e88868c`. The loader is parsed without execution;
  supported generated mappings must match an actual Wasm function import.
- `emscripten-lld.mjs`: shared Emscripten LLD profile and asset-reference validation
- `nim.mjs`: Nim LLVM profile validation
- `rust.mjs`: split and integrated Rust runtime manifest validation
- `tinygo.mjs`: TinyGo emception profile, worker patching, and checksum validation
- `swift/`: Swift runtime contract, build-info, and runtime-manifest validation

The consumer updates for `wasm-llvm` revision `14ea5ecbc514b0c87338aebf8f2b567020be5750`
adopt the reviewed WAMR session-fix assets and Lean same-byte requalification receipt.
V and COBOL synchronization applies the stricter archive and acceptance contracts before
publication. Lean synchronization separately requires its runtime, checks library ranges
and complete module parts, and bounds decompression.

Clang compiler bytes remain at the existing consumer profile. Copying and validating a build
receipt does not qualify a new compiler release: the producer still owns clean source builds,
independent reproducibility and real compiler acceptance. Producer-only CI and cache changes
therefore require no duplicated build machinery in this consumer repository.
