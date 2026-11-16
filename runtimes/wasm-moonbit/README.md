# Original MoonBit browser compiler

The producer uses the official `v0.10.19+97801ee1b` Wasm compiler release:

- Archive: `moonbit-wasm.tar.gz`, 4,176,888 bytes.
- SHA-256: `ab55f4d92206916308922c768033d8a1b0eef5a2a3ea4c3ba8569c52cd40e2a9`.
- Compiler source: `moonbitlang/moonbit-compiler` commit
  `d4ada10d212b5376f7f8bf49cd2fbaa275a395df`.
- Matching core source archive: 2,253,163 bytes,
  SHA-256 `b2426aa085b3c7bf31af07e2c652701461cd9fe5c7b79dd7a8578f124e87e5c1`.

`prepare.py` verifies the complete official archive and its three selected
members, then invokes the original Wasm compiler through Node to build unmodified
core sources. It reads build metadata only from this exact pinned archive, skips
native async/test packages, bootstraps builtin before prelude and produces a
deterministic tar containing 96 original interfaces and their bundled core IR.
No native SDK, compiler fork, language parser or source translator is used.

Two clean producer runs yielded the same 8,273,920-byte `stdlib.tar`:
`c4f7c594c6e900395ec7afe0b1fcbb01452b65587a7303f63710e6db74598500`.
All producer paths and tar metadata are fixed. `--input-dir` reuses only the exact
three receipt-verified upstream members; `--build-dir` reuses a marked private
producer directory. An unmarked existing build output is never cleared.

```sh
node scripts/sync-wasm-moonbit.mjs
node scripts/sync-wasm-moonbit.mjs --check
```

Sync downloads and builds missing payloads, verifies existing ones and generates
the host/profile. `--check` is offline and rejects missing or changed files. The
original compiler JS/Wasm payloads and generated core tar are ignored; the source
pins, full original compiler/core licenses, core notices, metadata and host are
retained. The original compiler bytes are never patched or re-encoded.

The compiler is source-available under the MoonBit Public Source License, not the
host project's MIT license. Corresponding compiler source is available at the
exact pinned commit above; matching core sources are in the pinned release.
Retained licenses include the upstream compiler-output exception. The core is
Apache-2.0 with its original third-party notices. See [the browser API and limits](../../docs/moonbit.md).

Section 14 requires Service Source Code, including programs used to provide a
commercial or competitive compiler service, to be available by free network
download under the MoonBit license. This includes user interfaces and hosting
software. Service suitability is a PR review item; the host MIT license is not
changed by this integration. The separately retained compiler-output exception
covers compiler portions embedded into compiled output and does not remove that
service condition.
