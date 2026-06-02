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

## Current Status

This folder is a porting scaffold, not an app integration. The current probe compiles a small Java
wrapper around `K2JVMCompiler.exec(...)` and installs a TeaVM transformer for the first known
incompatible JVM APIs.

Known findings from the initial experiments:

- wasm-idle's existing browser `compiler.wasm` can detect `K2JVMCompiler`, but direct Kotlin jar
  input either fails class resolution or crashes inside the TeaVM compiler.
- A JVM-hosted TeaVM Gradle build reaches `generateWasmGC`, but the unpatched Kotlin compiler graph
  uses roughly 9 GB RSS and does not produce a final Wasm artifact in a practical feedback loop.
- `jdeps` reports that the Kotlin compiler distribution reaches beyond `java.base` into
  `java.desktop`, `java.instrument`, `java.management`, `java.scripting`, `jdk.compiler`, and
  `jdk.unsupported`.

See `docs/porting-plan.md` for the next patch targets.
