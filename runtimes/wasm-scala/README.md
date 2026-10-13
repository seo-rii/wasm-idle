# Scala 3 / Scala.js browser compiler spike

Internal experimental candidate, **not registered as a supported playground
language or exported runtime package**. This uses the real Scala compiler and
Scala.js linker from `pgilliar/scala3-compiler-sjs`, browser revision
`357051c857d4ffd5d1e1bfc9a56f0cbf5943a325`. It does not interpret a Scala subset.
User source is compiled in a browser Worker; user output is JavaScript ES modules,
not standalone WASI. Scala.js library compatibility differs from JVM Scala.

## Reproduce

From the wasm-idle root, with its dependencies installed:

```sh
node runtimes/wasm-scala/prepare-assets.mjs
node runtimes/wasm-scala/prepare-assets.mjs --verify
node --test runtimes/wasm-scala/src/candidate.test.mjs
node runtimes/wasm-scala/test/browser.mjs
node runtimes/wasm-scala/test/output-limit.mjs
```

Preparation downloads 10 committed upstream assets (62,554,449 bytes) from the
immutable revision and checks every size and SHA-256 against `assets.lock.json`.
Assets remain ignored and are prepared before serving, never downloaded or built
by a Run action. The browser harness also verifies them before launching Chromium.
The lock pins the entire compiler/linker/classpath/runtime-IR/vendor set together.
This spike qualifies upstream **prebuilt** assets; it does not claim a locally
reproduced source build, known compiler version string, or a published producer.

Upstream documents this source-build command:

```sh
# In a separate checkout of the pinned upstream revision:
sbt --client "scala3-compiler-sjs/prepareBrowserIDE"
```

A future maintained producer must reproduce that build, record actual compiler,
linker and library versions, retain licenses, and generate release integrity
metadata. Do not replace individual assets with newer Scala.js versions.

## Current contract

- Explicit root `object Main` with `main(args: Array[String])`. Multiple `.scala`
  files with bounded relative paths; no entry discovery, dependency resolver,
  macros, debugger, or language server.
- Standard-library source functionality within the pinned Scala.js profile.
  Arbitrary JVM/JDK APIs are not supported by this contract.
- Complete buffered stdin passed before execution; `scala.io.StdIn` uses a real
  `StringReader`, including empty input, final lines without newline, and EOF.
  Interactive stdin is unsupported. There is no replay or restart on new input.
- `scala.Console`/Predef output is streamed through separate UTF-8 `PrintStream`s without
  trimming, filtering, or adding newlines. Direct `System.in/out/err`, JS console,
  asynchronous callbacks after main returns, and `System.exit` need additional
  qualification and are outside this initial contract.
- Each execution imports its generated module into a fresh disposable Worker.
  Main runs once and runtime arguments/input do not affect compilation. There is
  no compiled-artifact cache yet. The real compiler and runtime IR remain warm.
- Candidate host API `src/candidate.js`: `compile(files)`, `run({files,stdin,args},
{signal,onOutput,timeoutMs})`, `stop()`, `dispose()`. `onOutput(stream,text)`
  receives exact console chunks. Overlapping requests are rejected; failure,
  cancellation, and timeout terminate the affected Worker. A failed compilation
  cannot execute a previous artifact. Stop during execution preserves the compiler;
  Stop during compilation discards it for safe recovery.
- Limits: 64 files / 1 MiB source, 1 MiB stdin, 32 MiB generated JavaScript,
  1 MiB console output; default compile deadline 120s, execution deadline 10s.
  These are transport/output limits, not a compiler GC heap cap.
- Compiler Worker checks `WebAssembly.JSTag`, `Suspending`, and `promising` before
  fetching assets. Execution uses Blob ES modules; CSP must permit that loading
  profile before any public integration.

`src/memory-fs.js` is adapted from the pinned upstream browser IDE, under the
included Apache-2.0 license. The other adapters are wasm-idle code. Downloaded
assets include upstream/compiler/library and JSZip dependencies; their distribution
licenses must be collected before a release producer publishes them.

## Qualification and release gates

`test/browser.mjs` compiles fresh Scala source entirely in Chromium, keeps the
compiler warm, and uses a new execution Worker for each run. Its corpus includes
collections, case classes, matching, `given`/`using`, type errors, buffered
stdin/EOF, exact whitespace/Unicode stdout/stderr, runtime arguments, repeated
mutable state, multiple files, BOM preservation, and timeout/recovery. The
candidate API also passes real Stop/AbortController/recovery tests with a single
retained compiler and five fresh execution Workers. `evidence/browser.json` records the actual
result, source and asset hashes, capabilities, browser version, and timings.
Inspect that receipt for passed/failed cases; tests are not a support declaration.
Node lifecycle tests use simulated Worker messages and prove host cancellation
and routing only; they do not prove Scala compiler correctness.

Public registration requires reproducible producer assets with licenses and
version identities, verified asset-cache integration, the existing `Sandbox`
and execution-limit contract (including current worker scheduling), structured
compiler diagnostic locations, Stop/abort browser tests through that adapter,
offline/cache-corruption tests, and measured repeated-run memory behavior.
Buffered input must be described in the UI before exposure. Genuine interactive
input would need a preserving shared-buffer Reader and a delayed-input side-effect
regression; the demo's exception/replay implementation must not be reused.

The checked-in Chromium 153.0.8010.12 receipt passes all 14 browser cases. On
this machine it records about 2.0s cold initialization, 21.3s first compile/link,
and 10.7–18.3s successful warm compile/link (including workspace I/O). These are
local measurements, not latency guarantees. Thirteen Node lifecycle tests also pass, including cancellation between compiler
completion and execution. The focused output-limit browser test compiles a real
Scala program and checks the exact 1 MiB budget, a caught one-byte overflow,
a caught overflow followed by an infinite loop, and recovery in fresh Workers.
Limit failures notify the host immediately and cannot be cleared by guest code.
Cold download size and compile/link timings are measured by this spike. Browser
heap/memory trends and full language compatibility are not established. A Scala.js
Wasm+JS backend, browser JVM, and TeaVM compiler port remain separate future work.

References: [upstream browser IDE](https://github.com/pgilliar/scala3-compiler-sjs/tree/357051c857d4ffd5d1e1bfc9a56f0cbf5943a325/compiler/browser-ide),
[compiler discussion](https://contributors.scala-lang.org/t/scala-3-compiler-plugins-embedded-in-browser-with-wasm/7472),
[Scala.js library compatibility](https://www.scala-js.org/doc/project/linking-errors.html).
