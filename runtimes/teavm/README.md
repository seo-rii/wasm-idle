# TeaVM Runtime Package

`@wasm-idle/runtime-teavm` wraps the TeaVM browser compiler and class libraries with reusable
asset manifests, URL resolution, and fetch helpers. Java integration lives in
`src/lib/playground/worker/java.ts` and uses the real TeaVM compiler in a browser Worker.

The checked-in generation uses TeaVM 0.16.0 and `konsoletyper/teavm-javac` revision
`208d4c97a602ba0df055f16e6882059fb69d0122`, built with Eclipse Temurin 25.0.5+8 for Linux x64
and Gradle 9.1.0. The javac source is independently pinned to OpenJDK revision
`6c48f4ed707bf0b15f9b6098de30db8aae6fa40f`.

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
checked-in dependency metadata was observed identically in two independent builds; publication
never regenerates it. Gradle and OpenJDK downloads are hash checked. An optional
`GRADLE_RO_DEP_CACHE` may point to a cache directory containing `modules-2`; writes stay isolated.

TeaVM 0.16's distribution ZIP omits the stack deobfuscator. The producer extracts its unmodified
Wasm resource from the resolved, hash-pinned `teavm-wasm-gc-deobfuscator-0.16.0.jar`. The final
five outputs must match the independently reproduced receipts before the producer transactionally
replaces the static tree and both generated modules. Third-party notices and source references
are included in `static/teavm/THIRD_PARTY_NOTICES.md`.

Reserve several GiB of temporary disk and memory for this build. The Gradle coordinator is limited
to one worker and a 512 MiB heap; TeaVM's compiler daemon needs additional memory. Long builds
should use a private background log and recorded exit status according to the workspace rules.
`TMPDIR` selects the build scratch filesystem.

## Compatibility changes

`scripts/teavm/patches/teavm-javac-0.16.0-compat.patch` migrates the existing browser fixes to
0.16's reflection and ServiceLoader APIs. Upstream now supplies the SDK method-renaming fix and
several numeric methods, so those old backports are omitted. Eight remaining supplement classes
are compiled once and injected into both class libraries. Supplement insertion rejects collisions.

Byte I/O, typed NIO buffers, and Formatter overlays are now a Gradle source set. Archive assembly
verifies all 11 replacement classes and appends the missing format-width exception. The fixes
preserve UTF-8 across flush boundaries, advance long byte writes correctly, avoid unsupported
JavaScript typed-array views, and retain `%n`, `%%`, scientific notation, and decimal rounding
behavior. The overlay's original and modified source hashes are recorded in the input lock.

Compiler-side annotation and array-clone fixes remain. Deterministic copies of `TypeSet` and
`TagRegistry` stabilize class traversal and numbering during the native build. These two classes
are build inputs only. Reflective field/method invocation remains outside TeaVM Wasm GC support.

`teavm-javac-0.16.0-debug-scopes.patch` fixes an upstream 0.16 debug-information regression:
an inlined final instruction left its scopes open, hiding later functions from stack deobfuscation.
Two source copies from the pinned `teavm-core` source JAR explicitly finish locations at each
function boundary. Original and modified hashes are recorded in `build.compilerOverrides`.
The compiler task puts these outputs before dependency JARs so the source overrides take effect.
`scripts/teavm/DebugScopesRegression.java` fails against the original 0.16 emitter and passes
against these overrides, checking balanced scopes, subsequent functions, and nested source frames.

## Validation

Two isolated native builds produced byte-identical copies of all five assets and identical Gradle
verification metadata. Chromium passed all 24 direct compiler cases on the reproduced bundle, including
UTF-8 stdin, formatting, typed buffers, reflection/enums, annotation values, primitive/object clone,
and ServiceLoader. The exact inputs, outputs, and cases are in
`scripts/teavm/candidate-qualification.json`.
Every generated program is also checked for balanced inline/function debug scopes.

To exercise the actual application Worker with the shipped assets, including shared-buffer stdin,
UTF-8 EOF, preparation, diagnostics, exception source stacks, and recovery, run:

```bash
WASM_IDLE_TEAVM_WORKER_RECEIPT=/path/to/worker-report.json node scripts/probe-teavm-worker.mjs
```

The probe uses Chromium and checks both buffered and streaming compiler loading. It verifies every
stored and logical asset before serving it on an isolated loopback origin. The streaming adapter
accepts a compiled module only at the exact verified 0.16 runtime-loader boundary.
Buffered and custom loaders receive verified deobfuscator bytes; the adapted streaming loader can
reuse its compiled module. Both paths validate the deobfuscator before acknowledging startup.
Exception checks require the original throw location and reject raw placeholder frames. TeaVM 0.16
can omit an inlined caller from the optimized launcher stack: the tested exception retains
`Main.fail(Main.java:2)` but omits `Main.main(Main.java:3)`, which the previous 0.13.1 bundle retained.

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
