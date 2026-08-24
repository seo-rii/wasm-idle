# TeaVM Runtime Package

`@wasm-idle/runtime-teavm` wraps the TeaVM browser compiler/runtime assets with reusable asset
manifests, URL resolution, and fetch helpers.

Java execution uses TeaVM's browser compiler/runtime assets from `static/teavm/`:

- `compiler.wasm`
- `compiler.wasm-runtime.js`
- `compile-classlib-teavm.bin`
- `runtime-classlib-teavm.bin`

The checked-in generation is reproduced from `konsoletyper/teavm-javac` revision
`7e4a44cf521694a4e326e33850dd8aec165eb5c9`, TeaVM 0.13.1, and the Eclipse Temurin
25.0.3+9 Linux x64 JDK archive. Java-specific integration code lives in
`src/lib/playground/worker/java.ts` and `src/lib/playground/javaStdin.ts`.

The wrapper and browser application pin all four logical assets to the same exact byte counts and
SHA-256 receipts. `static/teavm/runtime-manifest.v2.json` binds those receipts to source, JDK,
Gradle, dependency-verification, local-overlay, storage, and license metadata. A custom base URL or
loader remains a mirror for the pinned generation unless the caller explicitly supplies a complete
replacement receipt set.

The runtime class library intentionally carries one wasm-idle compatibility overlay. It starts
from the pinned TeaVM 0.13.1 source JAR and changes exactly two `TByteBuffer` calls from
`Int8Array.fromJavaArray` to `Int8Array.copyFromJavaArray`. The producer verifies the original
source entry, occurrence count, transformed source, JDK 25 `javac --release 17` output, canonical
2,141-entry archive, and final byte receipts before publication. Do not broaden this overlay while
performing a provenance-only refresh.

To reproduce and publish the generation, check out the revision above, download the exact JDK
archive recorded in `scripts/wasm-teavm-assets.lock.json`, and run:

```bash
pnpm run sync:wasm-teavm /path/to/teavm-javac /path/to/OpenJDK25U-jdk_x64_linux_hotspot_25.0.3_9.tar.gz
```

The producer uses a fresh isolated Gradle cache, injects the checked-in SHA-256 dependency
verification metadata, verifies the Gradle and OpenJDK downloads, applies the locked overlay, and
transactionally replaces the static tree and both generated consumer receipt modules. It rejects
source, dependency, toolchain, intermediate, overlay, logical-output, or compressed-storage drift.
Third-party license texts and source correspondence are shipped in
`static/teavm/THIRD_PARTY_NOTICES.md`.

Build and type-check the wrapper package with:

```bash
pnpm --dir runtimes/teavm run build
pnpm --dir runtimes/teavm run check
```

For generic runtime-dispatch integration, `wasm-teavm` is registered as a manual,
source-required producer. Set `WASM_IDLE_TEAVM_JDK_ARCHIVE` to the pinned JDK archive before using
`scripts/sync-runtime.mjs wasm-teavm <sourceDir> [targetDir]`.
