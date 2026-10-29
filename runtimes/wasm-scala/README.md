# Scala 3 / Scala.js (experimental)

The playground exposes `SCALA` through its normal lazy Sandbox route. Source is
compiled in the browser by the real Scala 3 compiler, linked to JavaScript by
Scala.js, and executed in a fresh Worker. No handwritten Scala interpreter or
server-side compiler is used. This is Scala.js compatibility, not a browser JVM.

## Use

Choose **Scala 3 / Scala.js (experimental)**, use `Main.scala`, and define
`object Main` with `def main(args: Array[String]): Unit`. Enter any input in
**Preloaded stdin** before Run. The complete input ends in EOF; interactive
terminal input is unavailable. Program arguments and multiple relative `.scala`
workspace files are supported. Macros, arbitrary Maven dependencies, JVM-only
libraries, debugging, and a Scala language server are unavailable.

The browser must expose `WebAssembly.JSTag`, `WebAssembly.Suspending`, and
`WebAssembly.promising`. Capability checks run before downloading large assets.
The compiler, linker, libraries, and JSZip comprise 10 assets totaling
62,554,449 bytes. Default downloads use an immutable upstream revision, verified
against the checked-in size/SHA-256 receipts. Existing persistent asset caching
supports later offline use when the browser retains the complete assets; the app
and its normal modules must also be available offline.

The pinned source revision is
`pgilliar/scala3-compiler-sjs@357051c857d4ffd5d1e1bfc9a56f0cbf5943a325`.
[ASSET-PROVENANCE.md](ASSET-PROVENANCE.md) records observed version identities,
licenses, and the unresolved upstream builder-JDK provenance. This integration
uses reviewed upstream prebuilt assets. A locally reproduced compiler source
build and a separately maintained release producer remain future work. The
experimental label does not imply full Scala or JVM-library compatibility.

## Sandbox and verified loading

The public adapter is `src/lib/playground/scala.ts`. Its canonical workers and
upstream virtual filesystem live under `src/lib/playground/worker/scala/` so npm
consumers receive the complete adapter. The original spike entry paths are thin
wrappers around these same sources.

The host downloads only pinned assets through the common verified cache loader.
The compiler Worker verifies the transferred inventory again, then builds its
executable Blob-module graph from those bytes. Original import and Wasm URLs are
rewritten using a pinned exact-match profile; no unverified compiler module is
re-fetched. CSP must permit Blob modules and WebAssembly compilation; the app's
existing policy permits these. Custom mirrors use
`runtimeAssets.scala.baseUrl` and cannot override the pinned integrity metadata.
A string asset-root configuration maps to `<root>/wasm-scala/`.

A load initializes the compiler. Each run snapshots source and arguments,
compiles fresh source/runner IR, links, and starts a disposable execution Worker.
Input and runtime arguments do not affect generated source. No compiled-artifact
cache is claimed. Compiler state is retained when `limits.maxWorkers >= 2`.
With the default one-worker budget, the compiler Worker is terminated before
execution, so later runs reinitialize from verified cached bytes. Stop during
execution preserves any retained compiler; cancelling compilation discards it.
Every execution has fresh module/global state.

The Scala bridge uses `StringReader` for stdin and UTF-8 `PrintStream`s for
`scala.Console`/Predef stdout and stderr. It preserves blank lines, whitespace,
Unicode, and initial BOM characters. Direct `System.in/out/err`, `System.exit`,
and asynchronous work after `main` returns are outside this initial profile.
The terminal merges streams as required by the existing Sandbox interface.
Output limits are sticky host-visible failures, even when Scala catches the
underlying exception. Failed compilation never launches an older artifact.

Limits use the existing execution options: asset/startup/compile/run deadlines,
source/workspace limits, output and diagnostic budgets, and worker count.
Additional hard ceilings are 64 source files, 1 MiB source/input/arguments,
32 MiB generated JavaScript, and 1 MiB output. The current compiler uses WasmGC;
`maxWasmMemoryBytes` does not provide a hard JavaScript/WasmGC heap cap. Worker
termination supplies cancellation and deadline enforcement; total browser heap
is not bounded by the linear-memory setting.

## Reproduce and qualify

From the wasm-idle root with its dependencies installed:

```sh
node runtimes/wasm-scala/prepare-assets.mjs
node runtimes/wasm-scala/prepare-assets.mjs --verify
pnpm test:scala
pnpm test:browser:scala
```

Prepared local assets are ignored. The browser suite serves these exact verified
upstream bytes locally and exercises the actual public Sandbox in Chromium,
including stdin/EOF, Scala 3 features, multiple files, diagnostics, fresh state,
Stop/Abort/timeouts and recovery, output limits, cached offline startup, corrupt
asset rejection, and one-worker scheduling. Set `WASM_IDLE_SCALA_EVIDENCE_FILE`
as documented in the test to record current source hashes and measured results.
The checked-in `evidence/playground-browser.json` is the integration receipt;
`evidence/browser.json` is historical spike evidence and is not a claim about
later source revisions. Runtime tests with simulated Worker messages qualify
host lifecycle behavior only.

The earlier direct spike tests remain available:

```sh
node --test runtimes/wasm-scala/src/candidate.test.mjs
node runtimes/wasm-scala/test/browser.mjs
node runtimes/wasm-scala/test/output-limit.mjs
```

For an explicit local mirror, `pnpm sync:wasm-scala` prepares
`static/wasm-scala/`; it is not part of release publishing or deployment.
Re-distributing this asset set requires resolving the provenance and licensing
prerequisites in `ASSET-PROVENANCE.md`. No new infrastructure is provisioned by
this integration.

Upstream documents a source build in a separate checkout:

```sh
sbt --client "scala3-compiler-sjs/prepareBrowserIDE"
```

Future work includes producer reproducibility, curated library packs, complete
language qualification, repeated-run heap analysis, and genuine preserving
interactive input. The demo's exception/replay input model must not be reused.
Scala.js Wasm+JS output is a separate backend, not generic WASI output.
