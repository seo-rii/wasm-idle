# Container source materials

`scripts/prepare-container-source-pack.py` assembles the selected Bash and patched
Wasmer SDK source materials without running a build, fetching a dependency, or
extracting an input archive. It requires Python 3.11 or newer.

The output contains upstream source archives, the complete prepared SDK/WASIX/
virtual-fs trees, local patches, source preparation and build scripts, Bash
producer materials, and identified license/notice texts. Every registry package
in the SDK Cargo.lock is included, even packages for unused targets and tests.
When a Rust source component is supplied, its library Cargo.lock is included too.
Shared package archives are stored once. This is a conservative source inventory,
not a list of libraries linked into the final binary.

The source policy, Bash build receipt, and supplemental inventory each require an
independent SHA-256 argument. The SDK policy must enumerate every file in all
three prepared trees. Registry archives must match Cargo.lock checksums. Local
bridge files must match the preparation receipt. Files are hashed again while
streaming into the output so changed inputs cannot produce a successful pack
with an outdated inventory. The existing input files and caches remain unchanged.

The generated `source-pack.tar.gz` has sorted entries, fixed timestamps and owner
IDs, and a gzip header without a host filename or clock. Repeating the same inputs
produces the same archive. Source archives retain their upstream metadata; files
stored directly by the assembler use mode 0644. Build scripts can be invoked by
their interpreter. `source-pack.json` inventories the payload except itself; the
separate `receipt.json` pins the complete archive and manifest. Neither a manifest
nor its self-described identity is an independent trust root.

```sh
python3 scripts/prepare-container-source-pack.py \
  --source-policy /inputs/sdk/source-policy.json \
  --source-policy-sha256 "$SOURCE_POLICY_SHA256" \
  --bridge-repository /sources/wasm-idle-sdk-bridge \
  --recipe-repository /sources/wasm-idle \
  --input-archive wasmer-sdk=/inputs/wasmer-sdk.tgz \
  --input-archive wasmer-wasix=/inputs/wasmer-wasix.tgz \
  --input-archive virtual-fs=/inputs/virtual-fs-0.601.0.crate \
  --registry-cache /inputs/crates \
  --bash-build /inputs/bash-build \
  --bash-receipt-sha256 "$BASH_RECEIPT_SHA256" \
  --supplements /inputs/source-supplements.json \
  --supplements-sha256 "$SUPPLEMENTS_SHA256" \
  --output /outputs/container-sources
```

The output must be new. The assembler streams archives directly into the pack;
it does not create another expanded source tree. It reserves the uncompressed
sum of the files it will package plus 2 GiB of free disk before writing.
`source-pack.tar.gz` is published only after its stream verifies successfully.

## Supplemental sources and notices

The caller prepares a pinned JSON inventory with a `materials` array. Each entry
has `id`, local `path`, `bytes`, `sha256`, and provenance fields such as
`archiveUrl`, `sourceRevision`, and `role`. Paths are omitted from the portable
output inventory. An archive entry may declare `archivePrefix` and optionally
`noticePaths` relative to that prefix. The latter selects known notice files
without scanning every source file in a large LLVM archive. Entire archive bytes
are preserved regardless of the notice selection.

```json
{
  "schemaVersion": 1,
  "materials": [
    {
      "id": "rust-src.tar.xz",
      "path": "/inputs/rust-src.tar.xz",
      "bytes": 0,
      "sha256": "REPLACE_WITH_INDEPENDENT_PIN",
      "archivePrefix": "rust-src-nightly",
      "role": "Rust build-std sources"
    }
  ],
  "rustSource": {
    "archive": "rust-src.tar.xz",
    "prefix": "rust-src-nightly/rust-src/lib/rustlib/src/rust",
    "installedRoot": "/toolchain/lib/rustlib/src/rust"
  },
  "remainingGaps": ["Record source-to-binary and notice review still required"]
}
```

The zero size and digest above are placeholders and will fail validation.
With `rustSource`, every installed source file must match the pinned component
archive byte for byte, with no missing or extra files. The component's own
Cargo.lock determines the additional registry archives. Include the independently
pinned rustup channel manifest alongside it to preserve the component's original
download URL and digest.

Crates sometimes omit a standalone notice while declaring a license in Cargo.toml.
The declaration does not substitute for the text. Such components remain listed
as missing an identified notice. A supplemental notice can use
`noticeForVcsRevision` to associate an exact upstream revision's notice with
crates whose `.cargo_vcs_info.json` contains that same revision. This records
provenance, without asserting that one top-level notice covers every source file.
Original source headers and nested notice files remain in their source archives.

For a published crate without VCS metadata, an upstream archive can supply
`publishedCrate: { "name": "crate-version", "prefix": "upstream/subcrate" }`.
The assembler compares every published source, build script, and example file,
including `Cargo.toml.orig`, against that archive before associating its notices.
Cargo's normalized `Cargo.toml`, publication `Cargo.lock`, and VCS metadata are
excluded from this source comparison and retained in the published crate archive.
A matching version label alone is insufficient.

## Selected source lineages

The patched SDK's source revision is
`93b8b738ebd3ee57e118da0f0eb795b97d5b999e`. WASIX and virtual-fs 0.601.0 both
record Wasmer revision `3189527eec99cfea7e6991328509e72ed0bec2e0` in their crate
metadata. The source preparation receipt records their archive and patch pins.

The selected `nightly-2025-07-05` Rust source component has SHA-256
`8f43ecd89129ffa4af2147f99a9fe0ec383be7391c8c61c586059e47b94be52b` for its
official xz archive. Its installed source tree can therefore be checked against
an independent component identity, rather than only a local directory hash.

The Bash producer's WASIX sysroot release
[`v2024-07-08.1`](https://github.com/wasix-org/wasix-libc/releases/tag/v2024-07-08.1)
points to `c20a27d4b42228647b084b5e9e88408cbccff931`. Its three gitlinks are:

| Submodule | Exact revision |
| --- | --- |
| `tools/llvm-project` | `4ba6a9c9f65bbc8bd06e3652cb20fd4dfc846137` |
| `tools/wasi-headers/WASI` | `bac366c8aeb69cacfea6c4c04a503191bf1cede1` |
| `tools/wasix-headers/WASI` | `ad9d3c9a2fa6ef13cde11466b7e3f93ba1293c49` |

Capture each source archive and the exact gitlink inventory with the libc source.
The libc archive includes release/build scripts and its musl, cloudlibc, and
other notice texts. Merely downloading the release commit does not establish
that an existing sysroot binary was built reproducibly from it: the historical
release workflow also used mutable host packages.

Bash additionally uses WASI SDK 20's Clang resource directory. Its
[`wasi-sdk-20` tree](https://github.com/WebAssembly/wasi-sdk/tree/935fe1acd2fcd7ea4aed2d5ee4527482862b6344)
pins LLVM `08d094a0e457360ad8b94b017d2dc277e697ca76`, which is a distinct
compiler-rt source lineage. Preserve both candidate runtime source lineages until
linker provenance identifies the exact archive used. A complete compiler-rt
subtree pack avoids storing a second full LLVM checkout:

```sh
python3 scripts/prepare-container-source-pack.py subset \
  --source /inputs/llvm-project-08d094a0.tar.gz \
  --source-sha256 "$LLVM_PARENT_SHA256" \
  --prefix llvm-project-08d094a0e457360ad8b94b017d2dc277e697ca76 \
  --tree compiler-rt --tree cmake --tree llvm/cmake \
  --tree llvm/include/llvm/Config --tree runtimes \
  --file llvm/LICENSE.TXT --file llvm/CMakeLists.txt \
  --output /outputs/compiler-rt-sources.tar.gz
```

The subset includes all entries under the named directories, preserves links,
normalizes timestamps/ownership, and records the full parent archive identity in
`SOURCE-SUBSET.json`. The compiler-rt subtree is not reduced to files observed in a
single build. Selecting source directories is separate from qualifying the
producer's linked library closure.

## Release boundary

The assembler always emits `sourceStatus: "incomplete"` and
`completeReleaseSourcePack: false`. It distinguishes verified material availability
from source-to-binary correspondence and notice review. This output is review
evidence; it cannot by itself promote a distribution to `reviewed-complete`.

The selected SDK package builder accepts only its explicit SDK/bindgen module
graph and rejects unregistered imports. Its upstream npm dependency list is not
automatically a list of shipped browser modules. Use the actual bundle inventory
and binary receipt for that decision. Build tools, linked runtime libraries, and
distributed host modules should remain separately identified.

Run the focused source-pack checks with:

```sh
python3 -m unittest discover -s scripts -p test_prepare_container_source_pack.py
```
