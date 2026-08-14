# Haskell browser runtime third-party notices

This runtime profile packages a browser-hosted GHC artifact from
[`haskell-wasm/ghc-in-browser`](https://github.com/haskell-wasm/ghc-in-browser), a rootfs
extractor from [`haskell-wasm/bsdtar-wasm`](https://github.com/haskell-wasm/bsdtar-wasm),
and `@bjorn3/browser_wasi_shim` 0.4.2.

The `dyld.mjs`, `prelude.mjs`, `post-link.mjs`, and `rootfs.tar.zst` inputs are pinned by
commit, byte length, and SHA-256. The upstream artifact commit does not publish a license,
SBOM, source archive, or reproducible-build attestation for the GHC/rootfs bytes. The rootfs
also contains GHC packages and native libraries whose complete transitive license inventory is
not present in the artifact. Their license expression is therefore recorded as `NOASSERTION`;
this file must not be read as a complete SBOM or redistribution determination.

The `bsdtar.wasm` receipt is tied to a successful upstream GitHub Actions run and the
corresponding source commit. That workflow downloads mutable dependency branches and does not
publish a binary-to-source reproducibility attestation. Its repository license is reproduced at
`licenses/bsdtar-wasm/LICENSE`, but the embedded libarchive, zstd, WASI SDK, and other toolchain
components still require a complete upstream bill of materials.

`@bjorn3/browser_wasi_shim` is available under MIT or Apache-2.0. Both choices are reproduced at
`licenses/browser-wasi-shim/LICENSE-MIT` and
`licenses/browser-wasi-shim/LICENSE-APACHE`.

wasm-idle applies five browser-host/stdin compatibility patches to `dyld.mjs`, then uses pinned
Vite 8.0.8 to bundle the eleven JavaScript inputs into one self-contained browser module. It
copies the rootfs unchanged and stores `bsdtar.wasm` as deterministic gzip while browser consumers
verify the logical Wasm bytes after delivery decompression.
