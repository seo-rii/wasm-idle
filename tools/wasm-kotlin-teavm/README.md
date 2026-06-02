# wasm-kotlin-teavm

This is a separate porting workspace for running the Kotlin/JVM compiler in the browser through
TeaVM. It is intentionally outside `runtimes/*`, so normal wasm-idle runtime/package checks do not
pick it up while the port is still experimental.

## Goal

Produce an open-source, self-hosted Kotlin compiler path:

1. Run a TeaVM-built Kotlin compiler module in the browser.
2. Compile Kotlin source to JVM class files or a jar.
3. Feed those JVM outputs to wasm-idle's existing TeaVM Java worker.

No server-side compile route and no CheerpJ runtime are allowed for this path.

## Inputs

The Kotlin compiler distribution is not committed. Prepare local inputs with:

```bash
cd tools/wasm-kotlin-teavm
node scripts/prepare-inputs.mjs
```

This creates ignored files under `.cache/`:

- `.cache/kotlin-compiler/package/lib/*.jar`
- `.cache/trove4j/trove4j-1.0.20200330.jar`

You can also provide inputs explicitly:

```bash
KOTLIN_COMPILER_LIB_DIR=/path/to/kotlin-compiler/lib \
TROVE4J_JAR=/path/to/trove4j.jar \
./gradlew buildWasmGC
```

If this repo does not have a Gradle wrapper available, use any Gradle 8/9 compatible launcher:

```bash
gradle -p tools/wasm-kotlin-teavm compileJava
```

To run the Wasm build with a timeout and memory report:

```bash
GRADLE=/path/to/gradle \
KOTLIN_COMPILER_LIB_DIR=/path/to/kotlin-compiler/lib \
TROVE4J_JAR=/path/to/trove4j.jar \
node scripts/probe-wasm-build.mjs --timeout-ms 300000
```

The probe writes `.cache/probes/last-wasm-build.json`, which is ignored by git. Use it to compare
peak RSS and timeout behavior after each transformer patch.

To verify the direct Kotlin compiler API path on the JVM:

```bash
gradle -p tools/wasm-kotlin-teavm compileJava
java -cp "tools/wasm-kotlin-teavm/build/classes/java/main:/path/to/kotlin-compiler/lib/kotlin-compiler.jar:/path/to/kotlin-compiler/lib/kotlin-stdlib.jar:/path/to/kotlin-compiler/lib/annotations-13.0.jar:/path/to/trove4j.jar" \
  org.wasmidle.kotlin.teavm.DirectKotlinCompilerProbe \
  tools/wasm-kotlin-teavm/fixtures/hello/Main.kt \
  tools/wasm-kotlin-teavm/build/direct-probe-out \
  /path/to/kotlin-compiler/lib/kotlin-stdlib.jar
```

## Current Status

This folder is a porting scaffold, not an app integration. The current probe compiles a small Java
wrapper around Kotlin's direct JVM compiler API and installs a TeaVM transformer for the first known
incompatible JVM APIs.

Known findings from the initial experiments:

- wasm-idle's existing browser `compiler.wasm` can detect `K2JVMCompiler`, but direct Kotlin jar
  input either fails class resolution or crashes inside the TeaVM compiler.
- A JVM-hosted TeaVM Gradle build reaches `generateWasmGC`, but the unpatched Kotlin compiler graph
  uses roughly 9 GB RSS and does not produce a final Wasm artifact in a practical feedback loop.
- Replacing `K2JVMCompiler.exec(...)` with `KotlinCoreEnvironment` +
  `KotlinToJVMBytecodeCompiler.compileBunchOfSources(...)` successfully emits `MainKt.class` on the
  JVM for `fixtures/hello/Main.kt`.
- The direct API path can run on the JVM with only `kotlin-compiler.jar`, `kotlin-stdlib.jar`,
  `annotations-13.0.jar`, and `trove4j`; `kotlin-reflect`, `kotlin-script-runtime`, and coroutines
  are not needed for this fixture.
- The same direct API path still does not produce Wasm yet. With precise analysis it timed out after
  300 seconds at roughly 6.4 GB RSS. With fast global analysis it failed in about 80 seconds at
  roughly 5.8 GB RSS and exposed the next missing APIs: `java.io.File.toPath`, reflection field
  mutation, `java.util.concurrent` locks/futures, `javax.tools`/`javac`, and IntelliJ diff helpers.
- The first transformer patches disable `System.exit`, Kotlin CLI plugin loading, and Kotlin
  performance measurements that can reach JVM management APIs.
- `jdeps` reports that the Kotlin compiler distribution reaches beyond `java.base` into
  `java.desktop`, `java.instrument`, `java.management`, `java.scripting`, `jdk.compiler`, and
  `jdk.unsupported`.

See `docs/porting-plan.md` for the next patch targets.
