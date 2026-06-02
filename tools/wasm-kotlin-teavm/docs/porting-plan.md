# Kotlin TeaVM Porting Plan

## Constraints

- Keep wasm-idle open source friendly.
- Do not use CheerpJ or any runtime that requires a commercial self-hosting license.
- Do not add a server-side Kotlin compile route.
- Do not commit downloaded Kotlin compiler jars, TeaVM build outputs, or Gradle caches.

## Baseline Evidence

- `kotlin-compiler@2.3.21` is Apache-2.0.
- TeaVM is Apache-2.0 and already powers wasm-idle's browser Java worker.
- The existing TeaVM browser compiler API exposes `addJarFile` and `addOutputJarFile`.
- Directly feeding Kotlin compiler jars into the existing browser compiler is not sufficient:
    - classpath split mode failed with a class-not-found diagnostic.
    - all-output jar mode crashed inside TeaVM with a null pointer trap.
- JVM-hosted TeaVM did not finish a naive `K2JVMCompiler` WasmGC build in a practical time budget
  and reached about 9 GB RSS.

## Work Items

### ARCH-001: Reduce the Kotlin compiler reachable graph

Start from `KotlinCompilerProbe` instead of `K2JVMCompiler.main`. Keep plugin loading, scripting,
daemon support, JS/metadata compiler entry points, and service scanning unreachable where possible.

Current patch status:

- `CLICompiler.loadPlugins(...)` returns `ExitCode.OK`.
- `System.exit(int)` throws instead of trying to terminate the host VM.
- `DirectKotlinCompilerProbe` bypasses `K2JVMCompiler.exec(...)` and calls
  `KotlinToJVMBytecodeCompiler.compileBunchOfSources(...)` directly.
- The direct path compiles `fixtures/hello/Main.kt` to `MainKt.class` on the JVM.
- TeaVM precise analysis still times out after 300 seconds, but peak RSS dropped from about 9.25 GB
  to about 6.4 GB after using the direct path and trimming the compiler classpath.

### ARCH-002: Patch JVM management/performance APIs

Kotlin's CLI performance machinery can reach thread CPU time and related management APIs. Patch
`PerformanceManager` methods to no-op or call through only the user-supplied callback.

Current patch status:

- Phase notification methods are no-ops.
- `measureSideTime$compiler_common(...)` directly invokes the callback.
- Performance report generation returns an empty string.

### ARCH-003: Replace unavailable JDK APIs

The compiler distribution reaches `java.desktop`, `java.instrument`, `java.management`,
`java.scripting`, `jdk.compiler`, and `jdk.unsupported`. Each package must either be proven
unreachable from the browser compile path or replaced with a TeaVM-compatible stub.

Current TeaVM fast-analysis blockers:

- Cleared by transformer/classlib stubs:
    - `java.lang.reflect.Field.setInt(...)`
    - `java.util.concurrent.locks.ReentrantLock` and `ReentrantReadWriteLock`
    - `java.util.concurrent.Executors`, `ExecutorService`, `Future`, and `CompletableFuture`
    - `java.text.StringCharacterIterator`
    - `com.intellij.util.diff.Diff` and `FilesTooBigForDiffException`
    - `org.jetbrains.kotlin.javac.JavacWrapper` and `JavacBasedClassFinder` static bodies when
      `USE_JAVAC=false`
- Still blocking:
    - `kotlinx.coroutines.BuildersKt` and `kotlinx.coroutines.flow.SharedFlowKt`
    - `java.lang.Class.getResource(...)` and `ClassLoader.getSystemResource(...)`
    - `java.lang.invoke.MethodHandles.lookup()`
    - `Class.getTypeName()`, `Class.getGenericInterfaces()`, and `Type.getTypeName()`
    - `java.util.concurrent.atomic.AtomicReferenceArray`
    - `ConcurrentHashMap.newKeySet()` and the `(int, float, int)` constructor
    - `ConcurrentLinkedQueue` and `ForkJoinPool`
    - `Arrays.spliterator(...)`, `Spliterators.AbstractSpliterator`, and `StreamSupport.intStream(...)`

TeaVM did not load ordinary application jar classes placed in `java.*` packages. Classlib additions
must follow TeaVM's internal `T...` class naming under `org.teavm.classlib...`.

### ARCH-004: Split JVM fixture runner from browser entry point

`DirectKotlinCompilerProbe.main(...)` is useful for local JVM validation, but it configures the host
JDK through `java.home`. The browser compiler entry point should be a separate exported TeaVM API
that accepts source/classpath inputs from the worker and does not scan the local JVM.

Current status:

- `BrowserKotlinCompilerProbe` is the TeaVM `mainClass`.
- `BrowserKotlinCompilerProbe.compileKotlinSource(...)` calls the no-host-JDK compiler path.
- A guarded call keeps that compiler path reachable for TeaVM analysis while the browser API shape is
  still being determined.
- Fast analysis now fails without the previous `java.io.File.toPath()` host JDK blocker.

### ARCH-005: Remove statically reachable javac and parallel backend code

The probe sets `USE_JAVAC=false`, `COMPILE_JAVA=false`, and `PARALLEL_BACKEND_THREADS=1`, which are
the right runtime options for a browser-only Kotlin compile path. TeaVM fast analysis still reports
`org.jetbrains.kotlin.javac.JavacWrapper`, `java.util.concurrent.Executors`, and
`CompletableFuture`, so these branches need bytecode transformers or class stubs rather than only
configuration values.

### TEST-000: Keep the build probe reproducible

Use `scripts/probe-wasm-build.mjs` for long-running Wasm build experiments. The probe records exit
status, timeout status, and peak RSS under `.cache/probes/last-wasm-build.json`.

### TEST-001: Define a minimal success case

The first usable artifact should compile this program to a jar or class files:

```kotlin
fun main() {
    println("hi")
}
```

Do not wire this into wasm-idle's UI until that minimal compile path works and can be run repeatedly
without multi-minute, multi-gigabyte rebuilds.
