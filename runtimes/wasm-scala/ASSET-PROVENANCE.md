# Pinned browser compiler distribution

The consumer downloads the **upstream committed binaries** at
`pgilliar/scala3-compiler-sjs@357051c857d4ffd5d1e1bfc9a56f0cbf5943a325`.
`assets.lock.json` authenticates the complete 10-file graph (62,554,449 bytes).
No claim of a wasm-idle source rebuild or independently reproduced distribution
is made. Compiler, linker, libraries and zip loader must be updated as one set.

Observed directly from the hash-verified assets:

| Component                          | Observed identity                                                                        | Licensing/source evidence                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Scala compiler / adapted memory FS | pinned upstream source revision                                                          | Apache-2.0; `UPSTREAM-LICENSE`, `licenses/SCALA-NOTICE.md`                                                      |
| Scala library                      | `scala-lib.jar` manifest: `3.8.4-RC1-bin-SNAPSHOT`                                       | same pinned upstream Scala source tree; Apache-2.0                                                              |
| Scala.js library                   | `scalajs-lib.jar` manifest: `1.20.2`                                                     | [Scala.js 1.20.2](https://github.com/scala-js/scala-js/tree/v1.20.2), Apache-2.0; `licenses/SCALAJS-NOTICE.txt` |
| JSZip                              | bundled source header: `3.10.1`                                                          | MIT chosen from upstream dual-license offer; `licenses/JSZIP-MIT-LICENSE.txt`                                   |
| pako (inside JSZip)                | upstream JSZip 3.10.1 package dependency `~1.0.2`; exact embedded version not identified | MIT; `licenses/PAKO-LICENSE.txt` from 1.0.11                                                                    |
| compile-time `rt.jar`              | no version manifest or license files in the committed JAR                                | upstream preparation extracts the builder JDK's `java.base`; exact JDK vendor/build is not recorded             |

The upstream recipe is [`project/Build.scala`](https://github.com/pgilliar/scala3-compiler-sjs/blob/357051c857d4ffd5d1e1bfc9a56f0cbf5943a325/project/Build.scala#L1909),
using `sbt --client "scala3-compiler-sjs/prepareBrowserIDE"` after installing its
Node dependencies. That recipe is a source-build reference, not evidence that the
committed files were reproduced from that revision.

Default playground delivery references immutable upstream URLs. The runtime checks
all byte counts and SHA-256 digests before executable imports and rechecks the
Worker delivery. No remote manifest may expand or replace the reviewed graph.
JS modules and Wasm are imported from local Blob URLs after verification; imports
cannot silently return to the upstream network after preflight. Persistent cache
hits are checked by the existing content-addressed cache before use.

`node scripts/sync-wasm-scala.mjs` provides a verified **local development** mirror
in ignored `static/wasm-scala/`; it does not publish files or establish permission
to redistribute the incomplete-provenance JDK extraction. Before publishing a
wasm-idle-owned producer/release mirror, record the exact compiler/linker source
build, JDK vendor/build, JDK license/source notices and complete dependency license
inventory. The current upstream pin and observed manifest values do not establish
that missing information. Do not wire that mirror into public release publishing
until those provenance requirements are satisfied.
