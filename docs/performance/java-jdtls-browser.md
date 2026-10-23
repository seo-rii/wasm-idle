# Original JDT LS browser host

This probe runs the original Eclipse JDT LS JARs in CheerpJ with a browser stdin,
stdout and filesystem adapter. It contains no Java parser or language handlers.
This JDT LS candidate remains unsupported: the native semantic control passes, but
browser acceptance is blocked. The product instead uses the verified original
[javacs provider](./java-javacs-browser.md).

## Pinned inputs

| Input            | Identity                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| Eclipse JDT LS   | `1.36.0-202405301306`                                                                                 |
| Original archive | <https://download.eclipse.org/jdtls/milestones/1.36.0/jdt-language-server-1.36.0-202405301306.tar.gz> |
| Archive size     | `46696454` bytes                                                                                      |
| Archive SHA-256  | `028e274d06f4a61cad4ffd56f89ef414a8f65613c6d05d9467651b7fb03dae7b`                                    |
| Browser JVM      | CheerpJ `4.3`, Java `17`                                                                              |
| Runtime loader   | <https://cjrtnc.leaningtech.com/4.3/loader.js>                                                        |
| Adapter target   | Java class version `61` (`javac --release 17`)                                                        |

JDT LS 1.36 requires Java 17 and its original bundles avoid the mandatory JNA native
capability introduced in newer Eclipse resources bundles. The probe also pins
1.42.0 for comparison: its unchanged OSGi resolver rejects JNA on CheerpJ's actual
`os.arch=cheerpj`, so the JDT LS application cannot start. Neither CPU identity nor
upstream bundle manifests are modified. The documented Eclipse property
`eclipse.filesystem.useNatives=false` selects the original Java filesystem fallback.

The fixture exercises Java 17 source. This older server does not establish support
for current Java language versions; the
[pinned upstream README](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/v1.36.0/README.md)
documents its language/runtime requirements.

## Reproducing

Requirements: Node.js, Python 3, `tar`, JDK 17 (`java`, `javac`, `jar`), the
repository's `playwright-core` dependency, and Chromium. The browser launches its
own loopback-only static asset server. It never contacts a native language server.

```sh
node scripts/probe-java-jdtls-browser.mjs \
  --mode native --stage features --server-version 1.36.0 \
  --assets-directory .cache/java-jdtls-assets \
  --output-directory .cache/java-jdtls-native

node scripts/probe-java-jdtls-browser.mjs \
  --mode browser --stage features --server-version 1.36.0 \
  --credentialless-runtime --timeout-ms 300000 \
  --assets-directory .cache/java-jdtls-assets \
  --output-directory .cache/java-jdtls-browser
```

The archive SHA-256 and every extracted upstream file are checked. A cached server
tree must match the authenticated archive exactly; local ownership and permission
differences do not affect that comparison. `--archive-file` can reuse a local copy
of the same pinned archive. Both modes share one immutable server installation and
write their configuration/workspace in separate output directories.

`--stage initialize` stops after the original `initialize` response. Browser
`--timeout-ms` bounds the complete probe as well as each pending request. Server
exit immediately rejects pending requests. `evidence.json` records received LSP
messages, errors, Java properties, platform logs and completed startup phases;
`progress.json` records phases separately. `launch-receipt.json` records the original
archive identity, original/generated config hashes and exact omitted bundle IDs.

Run long probes in persistent background sessions with private logs and exit-status
files. Run one browser at a time on a machine under memory pressure. The bounded
probe is a compatibility check, not a startup performance measurement.

## Acceptance and observed blockers

Both modes use the same Eclipse Java project with `Main.java` and `Helper.java`:

1. Original completion and definition capabilities.
2. Completion of `Helper.` contains `doubleValue` from the other file.
3. Hover returns the original method signature.
4. Definition resolves to `Helper.java`.
5. Valid source receives empty diagnostics, then changing `int answer` to
   `String answer` produces JDT diagnostic `16777233` with severity 1.

The native JDK 17 control passed every gate on 2026-10-23, using both explicit
settings and the original default settings. No language features are supplied by
the adapter.

The browser with explicit settings reached the original `initialize` handler, which
returned JSON-RPC `-32603`. Maven's Guice initialization called
`Field.getAnnotatedType()` and CheerpJ raised
`UnsatisfiedLinkError: Java_java_lang_reflect_Field_getTypeAnnotationBytes0`.
Disabling Maven project import in the requested settings does not prevent this
upstream preference initialization.

The `upstream-defaults` launch profile omits `initializationOptions.settings`, using
the original handler's default branch. It passes the complete native control. Its
browser run exceeded the 300-second overall deadline inside Equinox before any LSP
response; that timeout does not identify an additional JVM incompatibility.

Removing integrations is not a supported shortcut for this pinned standard server.
Despite `resolution:=optional` in the original manifest, native controls prove:

| Diagnostic launch profile    | Original failure                                                               |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `without-build-integrations` | Activator unconditionally uses Maven's `ProblemSeverity`; exit 13              |
| `without-gradle`             | `InitHandler` unconditionally starts Buildship; missing bundle causes `-32603` |

Those profiles only change the Equinox launch list, and are available for reproducing
the failed hypothesis. They are not advertised as plain Java support. Replacing
core JNI functions, changing JARs/manifests, or substituting a diagnostic wrapper is
outside this implementation.

## Browser platform boundary

CheerpJ's `/app/` mount reads the original installation over HTTP. `/files/` is its
writable Java filesystem. The default copies only `config_linux/config.ini` into
`/files/jdtls/config_linux`; the fixture and workspace are also under `/files/`.
`--install-mode copy` is an alternative that copies the complete installation.

The HTTP host implements directory redirects, `index.list`, bounded/suffix byte
ranges and HEAD, which CheerpJ's filesystem requires. Node contract tests cover this
behavior, including cache tampering and path traversal rejection.

CheerpJ creates an internal compiler iframe on its CDN. With a normal iframe, the
observed CDN response cannot be embedded under COEP `require-corp`. The probe's
`--credentialless-runtime` marks iframes created inside its dedicated JVM document
credentialless before insertion. The Java adapter then loads while `require-corp`
remains enabled. No application or deployment security headers are changed. A
product host would have to scope the workaround to its own JVM frame and verify
browser support, editing and disposal before registration.

## Licensing and distribution

JDT LS uses [EPL-2.0](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/v1.36.0/LICENSE).
The archive's third-party bundles have their own notices and source obligations.
Any publisher must preserve the applicable notices and source offers.

CheerpJ is a proprietary runtime. Its
[Community License](https://cheerpj.com/docs/licensing.html) allows personal,
one-person company and FOSS projects, including wasm-idle, to use its CDN with
appropriate credit. Credit: [CheerpJ by Leaning Technologies](https://cheerpj.com/).
Other business use, self-hosting, redistribution and OEM use need the applicable
commercial terms. The probe loads the official versioned CDN and does not bundle
or republish CheerpJ assets.

The browser stream adapter is repository-owned MIT code. It only bridges platform
I/O and invokes the original upstream main class.
