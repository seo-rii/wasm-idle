# Original javacs browser host

The Java SDK provider runs the original
[georgewfraser/java-language-server](https://github.com/georgewfraser/java-language-server)
main class `org.javacs.Main`. It uses the upstream Java compiler API implementation,
JSON-RPC transport and language handlers. The browser adapter only supplies stdin,
stdout and a writable project directory. No remote language server is used.

Native and Chromium acceptance passed using the same original server and compiler:
cross-file completion, definition and method hover, empty baseline diagnostics,
and the exact javac type mismatch after editing. A package-free `Main.java` also
passes local-variable reference hover and diagnostics. Java 17 is the language/runtime
ceiling of this profile; newer Java language features are not supported.

## Pinned inputs

| Input                    | Identity                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Upstream package version | `0.2.38`                                                                                                         |
| Original commit          | `7fffb6c5929fe02c52e1c823ae990bad2b540ad1`                                                                       |
| Source archive           | <https://codeload.github.com/georgewfraser/java-language-server/tar.gz/7fffb6c5929fe02c52e1c823ae990bad2b540ad1> |
| Archive size             | `6538580` bytes                                                                                                  |
| Archive SHA-256          | `fb7e94a7594f2e6bc9031b328ac38841d28270043a3dd9cb1f1f23ab7bc46674`                                               |
| Gson                     | `2.8.5`, SHA-256 `233a0149fc365c9f6edbd683cfe266b19bdc773be98eabdaf6b3c924b48e7d81`                              |
| Protobuf Java            | `3.9.1`, SHA-256 `5a1e5c225791eccd3d67a598922e637406190c90155fb97f38e4eab29719324d`                              |
| Browser JVM              | CheerpJ `4.3`, Java `17`, official CDN                                                                           |
| Build                    | Unmodified upstream Java source, original source/target `13`, JDK `17`                                           |

This is the upstream commit immediately before its Java 18 build transition. Later
published tags require newer Java versions than the selected browser JVM. Source
files are verified against the pinned archive before compilation; the upstream
parser, compiler integration and handlers are unchanged. Only runtime dependencies
from the original POM are packaged. Annotation processing for upstream benchmarks
is unnecessary for the language server and is disabled during this probe build.

The native launcher uses the original `jdk.compiler/com.sun.tools.javac.*` exports
and `api` opening from upstream `dist/launch_linux.sh`. The browser checks the actual contracts used by upstream javacs:
`JavacTool.create()` and `ServiceLoader<JavaCompiler>`. These checks run in the
original main thread with the same context classloader. The separate
`ToolProvider.getSystemJavaCompiler()` result is recorded too: OpenJDK 17 filters
that lookup to the named `jdk.compiler` module, so null alone does not reject an
original compiler supplied on the classpath. The host supplies no replacement
compiler or JNI implementation.

## Reproducing

Requirements: Node.js, Python 3, `tar`, JDK 17 (`java`, `javac`, `jar`), the repository's
`playwright-core`, and Chromium.

```sh
node scripts/probe-java-javacs-browser.mjs \
  --mode native --stage features \
  --assets-directory .cache/java-javacs-assets \
  --output-directory .cache/java-javacs-native

node scripts/probe-java-javacs-browser.mjs \
  --mode browser --stage features --timeout-ms 300000 \
  --assets-directory .cache/java-javacs-assets \
  --output-directory .cache/java-javacs-browser
```

The browser probe serves only static JARs on loopback. Its `/files/java-project`
fixture contains `probe.Main` and `probe.Helper`. Native and browser runs use the
same fixture and protocol exercise: initialize, cross-file method hover,
definition, completion, empty baseline diagnostics, and the exact javac
`compiler.err.prob.found.req` type mismatch after an edit.

The cross-file fixture uses a conventional package declaration on its own line.
The original pinned server has default-package method/documentation hover and
inline-package discovery bugs. Default-package local-variable reference hover
works. The host does not rewrite user source to hide upstream limitations.

To evaluate an original JDK compiler supplied on the classpath, append both:

```sh
--jdk-compiler-module /path/to/jdk17/jmods/jdk.compiler.jmod \
--jdk-compiler-sha256 ORIGINAL_MODULE_SHA256
```

The experiment uses OpenJDK `17.0.20.1+1-1-deb12u1-Debian`, module SHA-256
`12ce7dcffc762642ca081add644fd2241e473c36ce1f05337624ee13f1c64c73`.
The module archive must match the explicit SHA-256 and describe `jdk.compiler@17`.
Its class bytes and legal notices are copied unchanged. The module descriptor's
original `provides` declarations become equivalent standard `META-INF/services`
resources for classpath discovery; the receipt lists those resources and the
original module description. The native full semantic control also passes with
this exact additional JAR on its classpath. CheerpJ's actual `jrt:/` filesystem is
checked for `java.base/java/lang/Object.class` before server startup.

`--stage compiler` checks the real browser compiler only; `--stage initialize`
stops after the original server's response. `--stage single-file` separately
checks a package-free `Main.java` with local-variable `int answer` hover, empty
baseline diagnostics, then the exact type mismatch after an edit. The browser deadline includes asset
preparation and startup. Upstream exit aborts pending RPCs immediately. Each run
writes `evidence.json`; browser phases also appear in `progress.json`. The assets'
`original-assets.json` records the source commit/hash, unchanged-source declaration,
compiler version, original module exports and output JAR hashes.

Run probes serially in background sessions with private logs and recorded exit
statuses. The browser host preserves COEP `require-corp` and scopes the credentialless
compiler-iframe workaround to its standalone JVM document, as described in the
[JDT LS probe](./java-jdtls-browser.md).

## Licensing and distribution

The upstream repository is MIT licensed, and individual copied OpenJDK sources
such as `ReusableCompiler.java` carry GPL-2.0 with the Classpath exception. Preserve
all applicable upstream notices and source obligations when publishing a compiled
artifact. Gson and Protobuf retain their own third-party licenses. The probe cache
contains the unchanged source archive for review; generated JARs are not committed.

CheerpJ is separately proprietary. The provider uses the official versioned CDN
and redistributes no CheerpJ runtime files. Its
[Community License](https://cheerpj.com/docs/licensing.html) permits personal,
one-person company and FOSS projects, including wasm-idle, to use the
`cjrtnc.leaningtech.com` CDN with appropriate credit. Java LSP is powered by
[javacs](https://github.com/georgewfraser/java-language-server),
[OpenJDK](https://openjdk.org/) and [CheerpJ by Leaning Technologies](https://cheerpj.com/).
Other business use, self-hosting CheerpJ Core, redistribution and OEM use require
the applicable commercial terms. Hosting the separately prepared javacs/JDK JARs
does not authorize hosting or redistributing CheerpJ Core.

## SDK and application host

Prepare the separately deployed static inputs with the exact JDK 17 compiler
module above. Node.js, Python 3 and JDK 17 are build-time requirements only:

```sh
pnpm run prepare:java-lsp \
  --assets-directory .cache/java-javacs-assets \
  --output-directory static/java-lsp \
  --jdk-compiler-module /path/to/jdk17/jmods/jdk.compiler.jmod

node scripts/probe-java-lsp-sdk.mjs --strict-csp \
  --output-directory .cache/java-lsp-sdk
```

The output contains five pinned JARs, `host.html`, `host.mjs`, the exact source
archive, third-party notices and `runtime-manifest.v1.json`. Generated binaries
are ignored and are not included in the npm package or committed to Git. The
default SDK receipts use the exact compiler/build identity above. When deliberately
rebuilding with a different JDK 17 build, pass that module's explicit
`--jdk-compiler-sha256` and the resulting five receipts as `java.assets`.
Review and satisfy the JDK's corresponding-source obligations before publishing
that separately supplied artifact.

```ts
import { getJavaLanguageServer } from '@wasm-idle/lsp/java';

const handle = await getJavaLanguageServer({
	java: {
		baseUrl: 'https://assets.example.com/java-lsp/',
		initialFiles: { 'file:///workspace/Main.java': editor.getValue() }
	},
	signal,
	startupTimeoutMs: 180000
});
// Connect handle.transport to an LSP client; dispose terminates its JVM iframe.
handle.dispose();
```

Java uses a dedicated hidden document (`provider.host === 'document'`), because
the original CheerpJ runtime requires DOM/iframe APIs. Chromium's credentialless
iframe support is required. The outer JVM document retains normal credentials;
only CheerpJ's internal compiler iframes are credentialless under COEP `require-corp`.
The document loads `https://cjrtnc.leaningtech.com/4.3/loader.js` directly. It invokes
the original `org.javacs.Main`, without a native process or remote LSP endpoint.

Each session has a fresh `/files/java-lsp-UUID/workspace` directory. Standard LSP
URIs are mapped into that directory and back, and editor writes generate standard
`workspace/didChangeWatchedFiles` events so upstream javacs discovers files created
after initialize. All parsing, compiler work and language handlers remain upstream.
`java.initialFiles` supplies an optional workspace snapshot (at most 16 MiB) before
the original `initialize` scans files. Its exact file URIs also preserve Java's
file-name case when a client lowercases URIs. Monaco supplies the current model
snapshot because its eager feature requests can precede `didOpen`; querying a
nonexistent file corrupts the original pinned server's compiler cache. The SDK
acceptance exercises real code-action, folding and symbol requests with lowercase
URIs before `didOpen`, followed by all semantic and diagnostic gates.
Maven/Gradle subprocesses and automatic dependency downloads are not supported;
the verified scope is plain Java files and the JDK platform library.

The page verifies each JAR's byte limit and SHA-256, reuses the shared verified
asset cache, and transfers the verified bytes directly into the host's `/str/`
mount. The JVM never re-fetches unverified server JARs. The SDK acceptance script
checks three actual JVM sessions, two repeated disposals per session, fresh clean
diagnostics, five initial JAR downloads followed by zero, early/during abort and
startup timeout after the real silent iframe is loaded. The Node test is opt-in
with `WASM_IDLE_RUN_REAL_BROWSER_LSP=1`.

## Content Security Policy

The application retains its strict script policy. Only the standalone
`/java-lsp/host.html` response permits CheerpJ's CDN, inline compiler bootstrap and
`unsafe-eval`; CheerpJ 4.3 calls `new Function` during `cj3Init`. It also permits
the CDN compiler iframe and runtime fetches. COOP/COEP/CORP remain enabled. The
preview configurations apply this policy by path while preserving the application
and worker policies. External deployments must configure the same dedicated host
response policy; a stricter overriding blanket response policy blocks the runtime.
The exported policy is `javaLanguageServerHostContentSecurityPolicy` in
`scripts/content-security-policy.mjs`.

`java.hostUrl` can select an explicitly deployed JVM document. When placing it on
a different origin, permit that origin in the application's `frame-src`, allow the
parent origin in the host's embedding policy, and serve the prepared host module
there. Do not loosen the application-wide script policy. Commercial deployments
can pass an applicable CheerpJ `java.licenseKey`; this provider does not bundle or
self-host proprietary runtime assets.
