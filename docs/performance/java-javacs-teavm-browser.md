# Original javacs on TeaVM

The Java language-server provider compiles
[georgewfraser/java-language-server](https://github.com/georgewfraser/java-language-server)
and the original OpenJDK compiler into a TeaVM Wasm GC module. Its SDK interface is
`getJavaLanguageServer` from `@wasm-idle/lsp/java`. An isolated module Worker owns
the upstream server, compiler state and in-memory project filesystem.

The unchanged native server and the real Chromium public SDK have passed the
acceptance fixture. All three isolated browser sessions match the native
semantic results, including new documents without a source snapshot and Monaco's
null-root initialization. The pinned producer recipe, native platform controls
and XML documentation adapter are implemented. A clean build in a separate
physical source directory reproduces the final five producer artifacts and all
46 notice files byte for byte.

## Source identities

| Component                          | Identity                                                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| javacs version                     | `0.2.38`                                                                                                                                  |
| javacs commit                      | `7fffb6c5929fe02c52e1c823ae990bad2b540ad1`                                                                                                |
| javacs source archive              | [Pinned original archive](https://codeload.github.com/georgewfraser/java-language-server/tar.gz/7fffb6c5929fe02c52e1c823ae990bad2b540ad1) |
| javacs source bytes                | `6538580`                                                                                                                                 |
| javacs source SHA-256              | `fb7e94a7594f2e6bc9031b328ac38841d28270043a3dd9cb1f1f23ab7bc46674`                                                                        |
| TeaVM                              | `0.16.0`                                                                                                                                  |
| Gradle                             | `9.7.1`                                                                                                                                   |
| Native compiler/runtime            | OpenJDK `17.0.20.1+1-1-deb12u1-Debian`                                                                                                    |
| Gson                               | `2.8.5`                                                                                                                                   |
| Gson JAR SHA-256                   | `233a0149fc365c9f6edbd683cfe266b19bdc773be98eabdaf6b3c924b48e7d81`                                                                        |
| Native control Protobuf dependency | `3.9.1`                                                                                                                                   |
| Protobuf JAR SHA-256               | `5a1e5c225791eccd3d67a598922e637406190c90155fb97f38e4eab29719324d`                                                                        |

The native control compiles every original Java source with the original
source/target level `13`, annotation processing disabled, and the upstream javac
module exports and `api` opening. It checks the entire extracted source tree
against the authenticated archive before compilation. Its receipt records zero
source modifications.

The browser build uses a separate source copy. The producer retains a reviewable
platform patch and builds from the original JDK compiler classes. TeaVM's build
plugins also transform compiler bootstrap and platform operations; the generated
Wasm is not a byte-for-byte copy of the JDK module. Parsing, symbol resolution,
type checking and the javacs language handlers remain the original implementations.

## Browser platform boundary

`producers/javacs-teavm` supplies the browser entry point and the platform adapters.
The original `JavaLanguageServer` handles initialize, hover, completion,
completion-item resolution, signature help, definitions, references, symbols,
rename, formatting, folding and diagnostics.

- The browser dispatcher is generated from the original `LSP.java` dispatch
  switch. Structured JSON messages and a callback replace its JVM stdin/stdout
  framing, reader thread and blocking queue. The dispatcher invokes the original
  `doAsyncWork()` to publish diagnostics after document changes.
- `BrowserFileManager` implements the standard Java compiler file-manager API
  using the original platform class files and the Worker filesystem. It replaces
  JRT discovery, host class loaders and host SDK filesystem access. The TeaVM
  `Path.of(URI)` compatibility transform delegates to the existing provider's
  `getPath(uri)`: its filesystem lookup accepts the root `file:///` URI but
  rejects a normal file URI such as `file:///workspace`. The provider retains
  URI validation and the original javacs `Paths.get` calls remain unchanged.
  The paired `DefaultPath.toUri()` hook removes an erroneous current-directory
  prefix from absolute paths. Native differential checks cover both directions,
  escaped Unicode filenames, directories and rejected URI components.
  Filesystem wrappers also accept an existing directory before calling TeaVM's
  directory-creation API, preserving native behavior for root-level sources.
- The platform SDK contains original `.class` entries from six Java 17 modules:
  `java.base`, `java.logging`, `java.compiler`, `java.sql`, `java.xml` and
  `java.transaction.xa`. The compiler reads their class bytes. The TeaVM execution
  class library is a separate input.
- The original source scanner keeps its Boyer–Moore search and 1 MiB byte limit.
  Bounded stream I/O supplies the same source bytes where TeaVM lacks FileChannel.
- Compiler service registration, the reflective
  `JavacTrees.instance(CompilationTask)` factory used by `Trees`/`DocTrees`, and
  the `JavacTaskImpl.cleanup()` access needed by the original reusable compiler
  are explicit build-time/runtime metadata.
  Original Gson parses and writes JSON. DTO adapters generated from the original
  native field/type metadata preserve collection, map, URI, array and default
  mappings without runtime generic reflection. A separate JVM differential
  compares these adapters with unchanged Gson before AOT.
- An unchanged OpenJDK `BreakIterator.class` supplies the API type missing from
  TeaVM's execution class library. The original javacs profile leaves
  `JavacTrees.getBreakIterator()` null and uses the original
  `DocTreeMaker.defaultSentenceBreak` implementation for source Javadoc.
- Javadoc HTML conversion uses an XML DOM/serialization callback in the Worker.
  The boundary preserves the original DOM traversal and Markdown replacements.
  It uses `saxes` 6.0.0 and `@xmldom/xmldom` 0.9.12. Its 53 fixed native cases and
  opt-in unchanged-JVM differential test pass, for 54 tests. Java syntax and
  semantic analysis do not pass through this callback.
- Annotation processors, compiler plugins, host command-line help/exit paths,
  DocLint integration and deferred host-file-manager cleanup are outside this
  browser profile. The producer makes those platform exclusions explicit.

Plain source projects and the supplied Java 17 platform library are the supported
workspace profile. Maven/Gradle/Bazel inference, external class paths, dependency
downloads and the host JDK `src.zip` are unavailable in this profile. JDK member
documentation that requires `src.zip` is therefore limited. Source Javadoc from
the project is part of the acceptance fixture.

The Java execution runtime continues to use its existing TeaVM compiler/runtime
assets and its existing stdin/stdout path. Java LSP owns the distinct
`wasm-java-lsp/` asset directory and a separate Worker.

## SDK startup and asset ownership

```ts
import { getJavaLanguageServer } from '@wasm-idle/lsp/java';

const handle = await getJavaLanguageServer({
	java: {
		baseUrl: 'https://assets.example.com/wasm-java-lsp/',
		initialFiles: {
			'file:///workspace/Main.java': editor.getValue()
		}
	},
	signal,
	startupTimeoutMs: 180_000
});

// Attach handle.transport to the LSP client.
// Terminate its Worker when Java LSP is disabled or the editor is destroyed.
handle.dispose();
```

`initialFiles` is a source snapshot available to upstream javacs before
`initialize` scans the workspace. Entries must be local `file:///workspace/`
URIs. Canonical URI case preserves Java file names when a client lowercases a
request URI. Ambiguous case and duplicate normalized decoded paths, including
repeated slashes and equivalent percent encodings, are rejected before Worker
creation. The first `didOpen` reserves its filename case for the session;
conflicting later opens emit a type-1 `window/logMessage` notification (or
`-32602` for requests), preserving the existing document and running Worker.
Lowercased change/feature requests and reopening the same client URI continue
to resolve to the original filename. The total
source-text limit is 16 MiB of UTF-8 bytes. This snapshot also permits feature
requests that a client sends before `didOpen`.

Monaco's initialize request contains a null `rootUri` and no workspace folders.
The profile requires the transport to supply its known `file:///workspace` root
before invoking the unchanged upstream initialize handler.
The playground includes all text Java sources in this snapshot, with the active
model's latest contents taking precedence. Sibling changes, additions, removals
and tab switches refresh the server snapshot; active-file edits retain normal
LSP document synchronization.
Monaco's marker conversion omits diagnostic metadata in code-action requests.
The Worker retains the original published diagnostics and restores missing
fields only for matching document, range, message and severity. Explicit client
fields are preserved, and document changes invalidate old diagnostic snapshots.
Cache keys normalize equivalent URI encodings without folding filename case:
the native `Foo$Bar.java` URI and an editor's `Foo%24Bar.java` URI identify the
same diagnostic snapshot. Original JSON-RPC messages retain their URI spelling.
Diagnostics without a code that no longer match a current published diagnostic
are excluded from the request context. This handles stale markers sent during
rapid typing without guessing their old codes. The request range and other
context fields still reach the original upstream code-action handler.

The provider validates its HTTP(S) asset directory and receipts before starting
the Worker. The delivery set is `javacs-runtime.mjs`, `javacs.wasm` and
`jdk-platform.zip`, with exact byte lengths and SHA-256 digests. The Worker checks
the bytes before importing runtime code or instantiating Wasm. The producer
provenance records authenticated source and toolchain inputs, recipe hashes and
output receipts. Asset sync validates that provenance against the repository
lock and generates the SDK's delivery receipts.

`persistentCache` controls the common verified asset cache. Cache reuse applies
to authenticated asset bytes; each provider call creates fresh server state and
its own writable source filesystem. This cache is distinct from javacs's compiler
and document caches inside one session.

`signal` governs startup. A pre-aborted signal prevents Worker creation. Aborting
during startup and reaching `startupTimeoutMs` reject startup and terminate the
Worker. After startup, callers own the returned handle and call `dispose()` to
end the session. Repeated disposal is idempotent. Language-server `shutdown` and
`exit` are exercised separately; they do not replace host Worker ownership.

## Native acceptance and browser gate

The shared protocol is
[`scripts/java-teavm-lsp-protocol.mjs`](../../scripts/java-teavm-lsp-protocol.mjs).
Its exact, URI-normalized native results are checked in as
[`native-oracle.json`](../../packages/lsp/test/fixtures/java-teavm/native-oracle.json).
The project profile records 19 result groups:

- Original initialize capabilities, including incremental `textDocumentSync: 2`.
- Clean baseline diagnostics, local `int answer` hover and cross-file method
  hover with source Javadoc.
- Cross-file completion, completion resolution, definition, references,
  signature help, prepare-rename and a rename that edits two source files.
- Document and workspace symbols, folding and formatting.
- A ranged `int` to `String` edit after a Korean/emoji comment, the original javac
  `compiler.err.prob.found.req` diagnostic with exact UTF-16 positions, undo to
  clear the diagnostic, and the original hover after editing.
- A `shutdown` response and successful native exit.

The independent default-package fixture checks local-variable hover, diagnostics
and edit recovery. The original pinned server fails method/documentation hover
in that profile: it returns internal-error code `-32603` after dereferencing a
missing `ClassTree`. The TeaVM gate requires that original failure to remain
visible. It compares the error code and behavior; null-pointer exception message
wording is VM-specific. The adapter does not rewrite a user's package declaration.

The original native stdin reader reads each input byte as a character. The native
control uses standard JSON `\u` escapes on the wire so that Korean characters and
emoji arrive as the exact original source strings. Browser messages are already
structured and do not use that byte-framing path.

To run the native control after the original source archive has been prepared,
choose a fresh output directory so stale class files cannot enter the control:

```sh
node scripts/java-teavm-lsp-protocol.mjs \
  --source-directory .cache/javacs-teavm/javacs \
  --source-archive .cache/javacs-teavm/downloads/javacs.tar.gz \
  --output-directory .cache/java-teavm-acceptance/native-new-run
```

`--write-fixtures` deliberately updates the checked-in semantic oracle after a
successful native run. Native acceptance requires Node.js, Python 3 and JDK 17.
The control uses only the original dependency JARs pinned above.

The real browser gate is
[`scripts/java-teavm-lsp.browser.test.mjs`](../../scripts/java-teavm-lsp.browser.test.mjs).
It bundles the public SDK and its actual Worker, serves the prepared assets on
loopback, and launches Chromium with the application strict CSP and COOP/COEP.
The gate compares the native semantic results in three isolated sessions
(including document creation without an initial source snapshot and Monaco's
null workspace-root initialization). A fourth session checks dynamic case
collisions, lowercased snapshot opens, change/hover aliases and close/reopen
ownership. Duplicate initial path aliases must create no Worker or asset fetch.
The gate also checks
verified-cache reuse, repeated disposal, startup cancellation/timeout,
tampered Wasm rejection and complete Worker cleanup. It also requires zero JVM
iframes and zero page errors. It is opt-in because it needs built native assets
and an installed Chromium:

```sh
WASM_IDLE_RUN_REAL_BROWSER_LSP=1 \
  node --test scripts/java-teavm-lsp.browser.test.mjs
```

The strict public SDK gate passed after the review fixes against main
baseline `0fdc77e3` on 2026-10-23 with Chromium `153.0.8010.12`. Three sessions
match all 19, 8 and 19 native result groups; a fourth checks URI ownership and
diagnostic metadata. Both the original diagnostic and Monaco's reduced payload
produce the native `Import 'java.util.UUID'` edit. An explicitly supplied client
diagnostic code remains unchanged. Delayed uncoded markers after a source change
or diagnostic clear still reach the original cursor handler with an empty
diagnostic context and return no stale edit.
The qualified delivery receipts are:

| Asset                | Bytes      | SHA-256                                                            |
| -------------------- | ---------- | ------------------------------------------------------------------ |
| `javacs-runtime.mjs` | `17410`    | `1652b9a5a7a833f02205b00e3ba609ac98f7dcb16215df0ae815a77ae555f336` |
| `javacs.wasm`        | `6193326`  | `1f1d92aaaf988d8379407b03851925861c1c6b8d858b314c4f8b848fdc9400f9` |
| `jdk-platform.zip`   | `18004088` | `7fa8f015e179b1ca89edfc6e6a67db37c613b8f6cc3679834323d711c3036d96` |

| Session                          | Native result groups | Asset requests | Startup | Protocol |
| -------------------------------- | -------------------- | -------------- | ------- | -------- |
| Project, initial source snapshot | 19                   | 3              | 3279 ms | 1577 ms  |
| Default package, fresh Worker    | 8                    | 0              | 2314 ms | 467 ms   |
| New documents, Monaco null root  | 19                   | 0              | 1549 ms | 659 ms   |
| URI and metadata boundaries      | —                    | 0              | 1732 ms | 546 ms   |

These are observations from one local run under the shared machine's load.
Startup includes SDK validation, asset loading/cache reads, Wasm initialization
and SDK archive import; it ends when the public provider returns its handle.
Protocol time covers initialize through shutdown and the feature fixture.
Every session has fresh compiler state despite verified-byte cache reuse.

The same run passed pre-start and in-startup cancellation, a real silent-Worker
250 ms startup timeout, a one-bit change to the real Wasm rejected by SHA-256,
and repeated disposal. All seven created Workers terminated, with zero live
Workers, page errors or JVM iframes at completion. The gate writes full JSON-RPC
replies, receipts, timings and lifecycle evidence to
`.cache/java-teavm-acceptance/browser/browser-evidence.json`. The review-fix run
is preserved as
`browser-evidence-stale-diagnostics-20261023T145436Z.json` in the same
directory. The focused source snapshot, dynamic URI and diagnostic metadata unit
tests pass 88 cases, including 31 metadata restoration and invalidation cases.

Native platform controls additionally pass 30 path/URI, directory and
stream-transfer checks against JDK APIs. The bounded source-I/O comparison passes
24 searches across eight file cases, including the 1 MiB boundary, UTF-8 and a
missing file.
The DTO/Gson JVM differential covers 67 original classes, 134 serialization
comparisons and 132 typed-read comparisons. Two original unsupported
`MarkedString` read cases retain the same upstream failure.
The production-preview Monaco Java suite also passed all five selected tests
under strict CSP. Its actual editor case types `String` over `int` with the
keyboard, observes the original type diagnostic, uses keyboard undo to restore
the source and clear markers, and displays `int answer` in Monaco's hover. It
then disables LSP and verifies the disabled lifecycle state. The browser has a
single frame, and the gate closes its Chromium, Workers and preview server.
The Java case also checks cross-file `Helper.VALUE` completion, a sibling type
change and restoration across tabs, and sibling deletion/recreation while
`Main.java` stays open.
This coverage is in
[`monaco-lsp.playwright.test.ts`](../../src/routes/monaco-lsp.playwright.test.ts).

After merging compiler-option support from main at `27996430`, a fresh
production build passed all five Monaco Java tests under strict CSP with no
skips, and Svelte checking reported zero errors and warnings. The focused
editor/workspace/compiler-option unit run passed 292 tests and skipped one
opt-in browser case. One route-compilation test exceeded its explicit 15-second
timeout on the loaded shared machine. Its isolated semantic check passed in
11.396 seconds with only that timeout raised to 60 seconds in memory; the
original test bytes, assertions and repository timeout remain unchanged.

The earlier Java execution acceptance run passed all three selected stdin
browser cases. That production build preceded the compiler-option merge. The
run took about 38 seconds; the other 35 language cases were excluded by the
Java name filter.
The JSON report verifies exactly these three passes and zero failures:

| Java execution case             | Input    | Observed output | Case time |
| ------------------------------- | -------- | --------------- | --------- |
| Scanner                         | `68\n`   | `main=73`       | 12.9 s    |
| BufferedReader / BufferedWriter | `68 5\n` | `main=73`       | 11.6 s    |
| Formatter                       | `68 5\n` | `main=73.00`    | 11.8 s    |

These are the real TeaVM execution cases in
[`stdin.playwright.test.ts`](../../src/lib/playground/stdin.playwright.test.ts),
selected with `-t 'passes JAVA '`. The test used an existing production-preview
server without rebuilding the app. Its JSON report is
`.cache/java-teavm-acceptance/java-execution-browser-report-latest-main.json`.
The preview server and all test processes closed after the run. Java execution
assets and stdin/stdout implementation remain separate from Java LSP.

## Producing and syncing assets

The checked-in producer is documented in
[`producers/javacs-teavm/README.md`](../../producers/javacs-teavm/README.md).
From the repository root on Linux x86-64, with Python 3, `dpkg-deb`, `unzip`,
Node.js 24 or newer and the repository's pnpm dependencies available, run:

```sh
python3 producers/javacs-teavm/build.py
pnpm sync:java-lsp
```

`pnpm run build:java-lsp` invokes the same producer command. The existing
`sync:page-runtimes` begins with `build:java-lsp` and `sync:java-lsp`, preparing
the Java LSP assets before the page build's static compression and asset-lock
steps. Those steps already include `wasm-*` directories; the JDK ZIP remains
precompressed. This build wiring does not publish or deploy the page.

The producer downloads its pinned Debian JDK and Gradle distribution into a
private `.cache/javacs-teavm/` toolchain. It checks archive lengths and SHA-256,
the actual JDK version, all seven input JDK modules and restored Gradle files.
It replaces Debian's host-dependent `cacerts` link with a private truststore of
142 Mozilla roots from a size/SHA-256-pinned Debian CA package. Missing links,
external links and corrupt cached stores are repaired without reading or
changing host certificates. Four truststore regressions pass, and strict TeaVM
dependency resolution succeeds with empty Gradle user/project caches. The store
serves build HTTPS transport and is excluded from the browser artifact receipts.
SDK ZIP packaging also uses a private, authenticated Debian zlib 1.2.13 and
checks its actual runtime version, keeping archive output independent of the
host distribution's deflater.
It uses a separate Gradle user home with strict dependency verification against
reviewed metadata. It neither installs system packages nor modifies the host
JDK. Source preparation authenticates the entire original javacs source tree
and checks the separate browser-source changes against the reviewed platform
patch. An independent JVM check compares generated DTO adapters with original
Gson before AOT.

`build.py` validates the generated Wasm in V8 and records the complete eager
TeaVM JavaScript-body inventory. It compares that inventory with the reviewed
expected bodies and loads it through static CSP factories. Output under
`producers/javacs-teavm/build/dist/` includes the three runtime assets,
`jso-bodies.json`, `provenance.json` and `notices/`. The repository sync applies
the reviewed CSP loader transformation, checks the pinned source and delivery
receipts, and materializes `static/wasm-java-lsp/`.

The raw producer loader and transformed delivery loader have separate receipts.
A change to the producer, its inputs or the host CSP adapter requires a reviewed
lock update. A successful build and asset sync remain separate from the strict
SDK semantic gate and the independent rebuild comparison.

The final independent build completed successfully in 2 min 22 s. Its clean
physical source copy reproduced the raw loader, Wasm, JDK ZIP, JavaScript-body
inventory and provenance, and all 46 notice files were identical. The final
`provenance.json` is 12633 bytes with SHA-256
`3a5829d7c0b20ffe6c1f51b4576f05fcce9eff526112c371da4222675f88b837`.
The comparison evidence is
`.cache/javacs-teavm/repro-evidence-truststore-20261023.json`; the raw
loader's receipt differs from the CSP-transformed delivery receipt above by
design. This comparison uses the same pinned toolchain and reviewed recipe.

## Distribution and licensing

javacs's repository license is MIT. Individual upstream files copied from
OpenJDK, including the reusable compiler, carry GPL-2.0 with the Classpath
exception; the OpenJDK compiler and platform classes have their applicable
GPL-2.0-with-Classpath-exception notices and corresponding-source obligations.
Preserve per-file notices and provide the required corresponding source when
publishing prepared browser artifacts.

TeaVM and the adapted TeaVM compiler-platform hooks are Apache-2.0. Gson is
Apache-2.0. Protobuf and JZlib's Java inflater have BSD-3-Clause notices. Native
zlib is a private build-only packaging dependency with its copyright supplied.
The pinned Debian/Mozilla certificate copyright is also included; the generated
build-transport truststore is excluded from the browser assets.
The Worker XML
adapter uses ISC-licensed `saxes` and MIT-licensed `@xmldom/xmldom`.

The producer includes its component inventory, original javacs and dependency
license texts, OpenJDK module notices, the reviewed platform patch, input lock
and the original OpenJDK StringJoiner source in `build/dist/notices/`. See
[`THIRD_PARTY_NOTICES.md`](../../producers/javacs-teavm/THIRD_PARTY_NOTICES.md)
for the source correspondence. Preserve that material with the separate asset
distribution. The npm SDK remains code-only.
All six fresh package-install scenarios pass, including the standalone
container consumer's TypeScript check with Java runtime configuration and
without installing `@wasm-idle/lsp`. Production install budgets are unchanged.
After merging main's compiler-option support at `27996430`, all six scenarios
pass again. The LSP and aggregate installs measure 5,422,320 bytes / 820 files /
9 packages and 41,818,799 bytes / 3,313 files / 65 packages, respectively.
All eleven tarballs pass the code-only checks, and the package verifier's
36 unit tests pass. The Java aggregate budget remains 40 MiB / 3,350 files /
70 packages, including the compiler-option changes.
