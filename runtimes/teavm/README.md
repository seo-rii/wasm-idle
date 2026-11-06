# TeaVM Runtime Package

`@wasm-idle/runtime-teavm` wraps the TeaVM browser compiler and class libraries with reusable
asset manifests, URL resolution, and fetch helpers. Java integration lives in
`src/lib/playground/worker/java.ts` and uses the real TeaVM compiler in a browser Worker.

The checked-in generation uses TeaVM `0.17.0-dev-3` and `konsoletyper/teavm-javac` revision
`76b5b53850f74e510ec8588a56a211cf60e9d496`, built with Eclipse Temurin 25.0.5+8 for Linux x64
and Gradle 9.1.0. This is a pinned TeaVM development release from
`https://teavm.org/maven/repository`, matching upstream revision
`6df39ceae1897750419abfa2ff8905be8a6145f7`. The published core, classlib, and bootstrap-compiler
source JARs were compared against that revision; all Java sources match. The javac source is
independently pinned to OpenJDK revision `6c48f4ed707bf0b15f9b6098de30db8aae6fa40f`.

All five logical assets in `static/teavm/` belong to one generation:

- `compiler.wasm-runtime.js`
- `compiler.wasm`
- `compiler.wasm-deobfuscator.wasm`
- `compile-classlib-teavm.bin`
- `runtime-classlib-teavm.bin`

`scripts/wasm-teavm-assets.lock.json` pins source inputs, compatibility patches, JDK/Node/Gradle
identities, observed dependency checksums, logical and compressed output hashes, and notices.
`static/teavm/runtime-manifest.v2.json` and both generated consumer modules bind exactly the same
receipts. Custom asset URLs are mirrors for that generation unless the caller provides a complete
replacement receipt set.

## Reproduce the shipped generation

Check out the exact teavm-javac revision above and download the JDK archive named in the lock.
Use the locked Node version, then run:

```bash
pnpm run sync:wasm-teavm /path/to/teavm-javac /path/to/OpenJDK25U-jdk_x64_linux_hotspot_25.0.5_8.tar.gz
```

The producer requires a clean checkout from the pinned remote. It exports that commit into a fresh
build directory, checks and applies the compatibility patch, verifies every integrated overlay
source, checks JDK identity, and invokes Gradle with `--dependency-verification strict`. The
checked-in dependency metadata pins resolved artifacts; publication never regenerates it.
Gradle and OpenJDK downloads are hash checked. An optional
`GRADLE_RO_DEP_CACHE` may point to a cache directory containing `modules-2`; writes stay isolated.

The producer extracts the stack deobfuscator's unmodified Wasm resource from the resolved,
hash-pinned `teavm-wasm-gc-deobfuscator-0.17.0-dev-3.jar`. The final five outputs must match
the locked receipts before the producer transactionally
replaces the static tree and both generated modules. Third-party notices and source references
are included in `static/teavm/THIRD_PARTY_NOTICES.md`.

Reserve several GiB of temporary disk and memory for this build. The Gradle coordinator is limited
to one worker and a 512 MiB heap; TeaVM's compiler daemon needs additional memory. Long builds
should use a private background log and recorded exit status according to the workspace rules.
`TMPDIR` selects the build scratch filesystem.

## Compatibility changes

`scripts/teavm/patches/teavm-javac-0.17.0-dev-3-compat.patch` keeps the remaining compatibility
changes around upstream's `TeaVMBootstrapCompiler`. The migration removes the local bootstrap
dependency, reflection, and ServiceLoader registration; annotation self-inheritance and
`SuppressWarnings` fixes; all seven NIO buffer overlays; deterministic `TypeSet`/`TagRegistry`
copies; and both debug emitter overrides.

| Removed local change                                       | Upstream replacement included in the pinned inputs                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bootstrap dependency registration                          | TeaVM [`b21aced`](https://github.com/konsoletyper/teavm/commit/b21acedc5ca83ee1491bfa48bdfc975eb99e3a4d) and [`7746d7a`](https://github.com/konsoletyper/teavm/commit/7746d7ab0d15f8a702d77ec776873843caf14e77) register dependency plugins, including `Object` and `String`.                                                                                |
| Reflection and ServiceLoader registration                  | TeaVM [`466a744`](https://github.com/konsoletyper/teavm/commit/466a744940df29fa3586bca499ce73b411c8b8d1) enables these services in the bootstrap compiler.                                                                                                                                                                                                   |
| Annotation self-inheritance and `SuppressWarnings.value()` | The pinned [teavm-javac converter](https://github.com/konsoletyper/teavm-javac/blob/76b5b53850f74e510ec8588a56a211cf60e9d496/compiler/src/main/java/org/teavm/javac/StdlibConverter.java) filters self-interfaces; TeaVM [`da907f4`](https://github.com/konsoletyper/teavm/commit/da907f42871842a1f6412cb79149818c02caf7fc) supplies the annotation element. |
| NIO typed-array workarounds                                | The upstream [bootstrap compiler](https://github.com/konsoletyper/teavm/blob/6df39ceae1897750419abfa2ff8905be8a6145f7/bootstrap-compiler/core/src/main/java/org/teavm/compiler/bootstrap/TeaVMBootstrapCompiler.java) installs Platform and JCL before JSO, eliminating JS-only branches before Wasm GC validation.                                          |
| Deterministic compiler source copies                       | Upstream uses ordered dependency domains and stable class traversal, with broader fixes in [`f671f14`](https://github.com/konsoletyper/teavm/commit/f671f14c4ffeb8a8088bdf2b0786536c209f3b20).                                                                                                                                                               |
| Debug scope emitter overrides                              | TeaVM [`ab0eb85`](https://github.com/konsoletyper/teavm/commit/ab0eb85c8cac27f15ff06e11de9705b741b47ca7) closes inline scopes after each function body.                                                                                                                                                                                                      |

The primitive-array clone listener remains: arrays whose references do not escape a method can
still miss clone dependency propagation. Eight supplement classes also remain for APIs missing
from the pinned class library: `Character.toString(int)`, `Collection.parallelStream`, unsigned
integer parsing, `Math.multiplyFull`/`multiplyHigh`, several `PrintStream` overloads,
`Stream.ofNullable`, and `String.lines`/`transform`. They are compiled once and injected into both
class libraries; insertion rejects collisions with upstream methods.

The remaining runtime overlays are `JsConsolePrintStream`, `TFormatter`, and
`TIllegalFormatWidthException`. Archive assembly replaces four compiled classes, including nested
classes, and adds the width exception to the upstream bootstrap runtime archive. These fixes
preserve UTF-8 across flush boundaries, advance long byte writes correctly, and retain `%n`, `%%`,
scientific notation, and decimal rounding behavior. Original and modified source hashes are
recorded in the input lock.

Upstream merged the [console fix #1336](https://github.com/konsoletyper/teavm/pull/1336) and
[Formatter `%n`/`%%` fix #1337](https://github.com/konsoletyper/teavm/pull/1337) on November 4,
2026, after the November 3 publication of `0.17.0-dev-3`. Their fixes are absent from the pinned
artifacts, so these overlays remain necessary. The
[Formatter HALF_UP rounding change #1338](https://github.com/konsoletyper/teavm/pull/1338) was
still open when this migration was reviewed on November 6, 2026.

## Validation

Chromium passed all 29 direct compiler cases, including UTF-8 stdin, formatting, typed buffers,
reflection/enums, annotation values, primitive/object clone, and ServiceLoader. All 14 application
Worker cases passed across buffered and streaming loading. Every generated program is also
checked for balanced inline/function debug scopes. Exact inputs, outputs, and results are recorded
in `scripts/teavm/candidate-qualification.json`.

Two isolated native builds produced byte-identical copies of all five assets. The first build records
resolved dependency hashes. A separate resolution with a fresh Gradle cache supplies six additional
parent POM/BOM metadata receipts, reviewed against Maven Central without changing existing
artifact hashes. The independent producer build enforces the completed metadata with
`--dependency-verification strict`.

`scripts/teavm/DebugScopesRegression.java` checks balanced scopes, subsequent functions, and
nested source frames against the upstream emitter, without local emitter overrides.

To exercise the actual application Worker with the shipped assets, including shared-buffer stdin,
UTF-8 EOF, preparation, diagnostics, exception source stacks, and recovery, run:

```bash
WASM_IDLE_TEAVM_WORKER_RECEIPT=/path/to/worker-report.json node scripts/probe-teavm-worker.mjs
```

The probe uses Chromium and checks both buffered and streaming compiler loading. It verifies every
stored and logical asset before serving it on an isolated loopback origin. The streaming adapter
accepts a compiled module only at the exact verified runtime-loader boundary.
Buffered and custom loaders receive verified deobfuscator bytes; the adapted streaming loader can
reuse its compiled module. Both paths validate the deobfuscator before acknowledging startup.
Exception checks require the original throw location and reject raw placeholder frames. The tested
`Main.fail(Main.java:2)` throw frame is preserved on both loading paths. Optimized caught-exception
traces can still omit the inlined `Main.main` caller.

The isolated candidate preparer remains available for future input migrations without publishing:

```bash
node scripts/prepare-wasm-teavm-candidate.mjs /path/to/source.tar.gz /path/to/new-candidate /path/to/jdk.tar.gz
node scripts/probe-wasm-teavm-candidate.mjs /path/to/new-candidate /path/to/browser-report.json
```

That preparer records newly observed dependencies and does not replace the strict publication
producer. Its original validation-pending input metadata is complemented by the separate observed
qualification receipt.

Build and type-check the wrapper with `pnpm --dir runtimes/teavm run build` and
`pnpm --dir runtimes/teavm run check`. The generic runtime dispatcher registers `wasm-teavm` as a
manual source-required producer; set `WASM_IDLE_TEAVM_JDK_ARCHIVE` before invoking
`scripts/sync-runtime.mjs wasm-teavm <sourceDir> [targetDir]`.
