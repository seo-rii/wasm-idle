# Original javacs on TeaVM

This producer compiles George Fraser's original java-language-server 0.2.38 and
the original OpenJDK 17 compiler bytecode with TeaVM 0.16.0 into WasmGC. Java
parsing, symbol resolution, type checking, completion, hover, references,
refactoring and the other language feature handlers remain upstream code.

Run from the repository root on Linux x86-64 with Python 3, dpkg-deb, tar and
Node.js 24 or newer available:

```sh
python3 producers/javacs-teavm/build.py
pnpm sync:java-lsp
```

The producer downloads its exact Debian OpenJDK and Gradle distribution into
`.cache/javacs-teavm/`. It verifies byte sizes and SHA-256 before extraction,
checks all seven input JDK module hashes and the actual Java version, and
checks restored Gradle distribution files against the authenticated archive.
It never installs packages or modifies the host JDK. Gradle uses the private
`.cache/javacs-teavm/gradle-user-home/` and reviewed SHA-256 dependency metadata.
The cache may be removed and rebuilt. Cache downloads, the JDK, Gradle and its
dependency cache; avoid caching generated sources or application outputs.
The ZIP packaging subprocess also uses a private, authenticated Debian zlib
1.2.13 shared library. Its actual runtime version is checked before writing
archives, so a different Linux distribution's deflater cannot change SDK bytes.

`prepare.py` authenticates the complete upstream source tree, copies it to a
separate browser source directory and verifies its generated changes against
the reviewed `browser-platform.patch`. No Java parser is handwritten or
substituted. The additional `CompilerPlatform.java` transformations adapt
native compiler/plugin entrypoints and missing TeaVM standard library methods.
Native plugins and annotation processing are disabled. A request for a runtime
annotation proxy fails explicitly. The standard file manager reads unmodified
OpenJDK class files from the supplied SDK archive and ordinary workspace source
files from TeaVM's memory filesystem.

The original `JavacTrees.instance(CompilationTask)` and private cleanup method
retain their exact reflection metadata. Their original method bodies run
unchanged. The real OpenJDK `BreakIterator.class` supplies an absent abstract
standard API. Javacs does not install a custom iterator, so the original
DocTreeMaker uses its own `defaultSentenceBreak`; no sentence parser or
null-returning stand-in is provided. The TeaVM `Path.of(URI)` implementation
mistakenly resolves `getFileSystem(file:///workspace)`, which only accepts the
filesystem root. Its platform compatibility hook delegates to the existing
provider's `getPath(uri)` with the original URI validation.
The corresponding `DefaultPath.toUri()` hook fixes an unconditional current
directory prefix that turns absolute paths into malformed file authorities.
Both path/URI directions, escaped Unicode filenames, directories, rejected URI
components and stream transfer are checked against native JDK APIs before AOT.
Browser filesystem setup also preserves native `createDirectories` behavior
when a one-component workspace directory already exists; an existing regular
file still produces the original error.

The browser profile supports plain Java projects and the included java.base,
java.logging, java.compiler, java.sql, java.xml and java.transaction.xa platform
modules. External class paths and dependency projects fail explicitly. Maven,
Bazel, annotation processors, native compiler plugins and JDK source ZIP
documentation are outside this profile. Project source Javadoc continues to
use the original javacs DocTree processing. Its XML platform operation is
provided by the worker host; source language analysis remains in Java.

The original Gson JSON parser, writer and primitive codecs are used. DTO
adapters are generated at build time from original JVM field/type metadata,
which avoids runtime reflection and preserves inherited fields, URI maps,
generic lists, null/default handling and the upstream MarkedString adapter.
An independent JVM differential check compares these codecs with unmodified
Gson on every original LSP DTO, CompletionData and SemanticColors before AOT.

`build.py` validates the actual Wasm in V8 and loads it through static CSP
factories before producing `build/dist/provenance.json`. Every reachable
TeaVM `@JSBody` factory is emitted into the eager module initializer by
`WasmGCJsoCommonGenerator.writeToInitializer`. `collect-bodies.mjs` therefore
captures the complete program inventory during module load, compares it with
`jso-bodies.expected.json` and fails on an unreviewed function. This collection
uses the same static CSP transformer as the SDK, without dynamic evaluation.
The raw TeaVM ESM loader remains unmodified in producer output; the repository
asset sync applies the reviewed CSP transformation and pins the final bytes.

The runtime contract is:

```js
const module = await load(wasmBytes, {
  stackDeobfuscator: { enabled: false }, noAutoImports: true
});
const session = module.exports.createSession(
  rootUri, JSON.stringify(files), sdkZipInt8Array, onMessage, formatJavaDocHtml
);
session.dispatch(JSON.stringify(jsonRpcMessage));
session.dispose();
```

Each worker owns one session because the original javacs FileStore uses static
state. Files are materialized before initialization; new opened files and saved
files also update the memory filesystem and original file watcher handler.
JSON-RPC responses and asynchronous server notifications share `onMessage`.
The upstream dispatch table is generated directly from original `LSP.java`.

Outputs are `javacs-runtime.mjs`, `javacs.wasm`, `jdk-platform.zip`, the build-only
`jso-bodies.json`, `provenance.json` and `notices/`. The receipt records source,
toolchain, reviewed recipe and artifact hashes without absolute host paths.
The native javacs oracle and browser SDK qualification are separate repository
checks; a successful AOT build alone does not establish language feature parity.
