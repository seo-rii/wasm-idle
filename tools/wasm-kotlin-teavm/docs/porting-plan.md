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
    - `AtomicReferenceArray`, `ConcurrentLinkedQueue`, `ForkJoinPool`, and `ForkJoinTask`
    - `ConcurrentHashMap`'s `(int, float, int)` constructor and `ContainerUtil.newConcurrentSet()`
    - `Class.getResource(...)`, `ClassLoader.getSystemResource(...)`, class/type name helpers,
      `Runtime.addShutdownHook(...)`, `System.mapLibraryName(...)`, `StringJoiner`,
      `Long.parseUnsignedLong(...)`, and `LockSupport`
    - `PlainTextMessageRenderer`/Jansi native-loading path by using a minimal probe-local
      `MessageCollector`
    - `AtomicIntegerArray`, `AtomicLongArray`, primitive reflective `Field` setters,
      `Field.getGenericType()`, `MethodHandles.lookup()`, `Lookup.lookupClass()`,
      `Arrays.spliterator(...)`, `Spliterators.iterator(...)`,
      `Spliterators.AbstractSpliterator`, and `StreamSupport.intStream(...)`
    - Swing's `invokeLater(...)` path by no-oping the corresponding `MockApplication` methods
    - IntelliJ plugin descriptor loading and multiverse context coroutines by no-oping
      `CoreApplicationEnvironment.registerExtensionPointAndExtensions(...)` and replacing
      `CodeInsightContextManagerImpl` with default-context behavior
    - IntelliJ runtime utility paths including `MockProject` coroutine setup,
      application-info XML setup, debug/thread-dump helpers, transaction guard Swing setup,
      event multicaster proxy creation, `ResourceBundle.clearCache(...)`,
      `ClassLoader.loadClass(...)`, EDT/threading assertions, cancellation checks,
      `Introspector`, and `TypeNotPresentException`
    - `CompileEnvironmentUtil.writeToJar(...)` and runtime/reflect JAR copy helpers, removing the
      `FileInputStream.getChannel()` and `FileOutputStream.getChannel()` blockers from the current
      browser-directory-output path
    - File-based IntelliJ JAR readers in `JBZipFileWrapper`, `FastJarFileSystem`, and
      `FastJarHandler`, removing the remaining `RandomAccessFile.getChannel()`,
      `FileSystemProvider.newFileChannel(...)`, and `java.nio.channels.FileChannel` blockers
    - IntelliJ `Unsafe`, message bus invocation, and `UrlClassLoader` resource lookup paths,
      removing the current `MethodHandle.invokeExact(...)`, `MethodHandle.bindTo(...)`,
      `MethodHandle.invoke(...)`, `MethodType.methodType(...)`, and `CharSequenceAccess` blockers
    - JDK/IntelliJ runtime stubs for `PropertyChangeSupport`, `ConcurrentHashMap.KeySetView`,
      `ThreadMXBean`/low-memory watcher paths, generic superclass lookup, `ParameterizedType`,
      `Proxy`, Swing `Icon`, and IntelliJ coroutine thread context
    - Backend/runtime stubs for `MessageDigest`, `Character.UnicodeBlock`, executable generic
      parameter reflection, additional `MethodHandle`/`MethodType` descriptors,
      `ResourceBundle.Control`, `Locale.forLanguageTag(...)`, `File.toPath()`, Kotlin reflection
      `KClasses`, coroutine `Job`/`DisposableHandle`, scheduling futures/queues, `URLClassLoader`,
      `ThreadPoolExecutor` support types, `CountDownLatch`, and `RejectedExecutionException`
    - Synthetic TeaVM classes for missing original-name interfaces/classes that cannot be compiled
      directly on JDK 17 source path, including `javax.swing.Icon`,
      `ScheduledExecutorService`, `RunnableScheduledFuture`, and `AbstractExecutorService`
- WasmGC code generation blockers cleared by pruning:
    - Reflective `Field` primitive setters are no-op in the browser port while field metadata remains
      available for Kotlin container singleton lookup.
    - `Arrays.spliterator(...)` and `Spliterators.iterator(...)` no longer construct stream-backed
      iterator paths during generation.
    - `CachedValueBase`/`CachedValueImpl` diagnostics cache paths are stubbed for the current
      browser compile analysis.
    - `AppScheduledExecutorService.capturePropagationAndCancellationContext(...)` overloads are
      stubbed so WasmGC generation no longer hits TeaVM's local-variable codegen bug.
- Current WasmGC build result:
    - Without a larger JVM stack, TeaVM reaches `AsyncMethodFinder` recursion and throws
      `StackOverflowError`. `JAVA_TOOL_OPTIONS=-Xss64m` moves the probe past that point.
    - With `JAVA_TOOL_OPTIONS=-Xss64m`, `buildWasmGC` now succeeds in about 2 minutes and writes
      `build/generated/teavm/wasm-gc/kotlin-compiler-probe.wasm`.
    - The latest successful probe recorded `peakRssMb: 8151`, so memory use remains high even
      after the graph reduction.
    - The generated WasmGC module validates in Node with
      `--experimental-wasm-imported-strings`, and exports `main`, `compileKotlinSource`, and
      `teavm.memory`.
    - TeaVM's generated runtime loader now initializes successfully in Node with
      `--experimental-wasm-imported-strings`.
    - `compileKotlinSource(...)` is exported as a JSO wrapper and is callable from Node. The current
      compile smoke probe records the next runtime blocker under
      `.cache/probes/last-kotlin-compile.json`.

TeaVM did not load ordinary application jar classes placed in `java.*` packages. Most classlib
additions must follow TeaVM's internal `T...` class naming under `org.teavm.classlib...`; a few
missing original-name interfaces/classes are submitted synthetically by the TeaVM plugin because
JDK 17 rejects direct source stubs for packages like `javax.swing`.

### ARCH-004: Split JVM fixture runner from browser entry point

`DirectKotlinCompilerProbe.main(...)` is useful for local JVM validation, but it configures the host
JDK through `java.home`. The browser compiler entry point should be a separate exported TeaVM API
that accepts source/classpath inputs from the worker and does not scan the local JVM.

Current status:

- `BrowserKotlinCompilerProbe` is the TeaVM `mainClass`.
- `BrowserKotlinCompilerProbe.compileKotlinSource(...)` calls the no-host-JDK compiler path.
- The `main(...)` body is intentionally a no-op; the browser-facing API is exposed through TeaVM JSO
  exports.
- `buildWasmGC` now produces a WasmGC artifact when run with `JAVA_TOOL_OPTIONS=-Xss64m`.
- Node can compile the WasmGC module, load TeaVM's generated runtime, and see the exported
  `compileKotlinSource` API.
- The exported API call starts the Kotlin compiler path, but fixture compilation is not complete yet.
  The current blocker is still in the reduced IntelliJ runtime stubs, after passing runtime startup,
  `ConcurrentHashMap.newKeySet()`, `SystemInfoRt`, event multicaster, VFS listener, and command
  publisher initialization issues.

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

Current status:

- The JVM fixture runner still compiles `fixtures/hello/Main.kt` to `MainKt.class`.
- The WasmGC artifact builds successfully, validates as a module in Node, and loads through TeaVM's
  generated runtime.
- The browser-facing compile export now completes the minimal fixture in a browser-compatible Node
  runtime. It writes `MainKt.class`, and `java -cp build/browser-probe-out MainKt` prints
  `answer=42`.
- The browser-facing compile export also completes `fixtures/ps-basic/Main.kt`, which covers a
  PS-style slice: top-level `Int` functions, parameters/returns, `var`, reassignment, `while`,
  `if/else`, arithmetic, modulo, comparisons, `return`, function calls, string templates, and
  `print`/`println`. Running the generated class prints `gcd=6 sum=9`.
- The browser-facing compile export also completes `fixtures/ps-long-array/Main.kt`, which covers
  `Long` values/functions, `IntArray`, `LongArray`, primitive array reads/writes, and long
  arithmetic. Running the generated class prints `chk=46 total=100000000007`.
- This success currently comes from a minimal PSI-based bytecode emitter for the verified fixture
  shapes, not from the full Kotlin/JVM backend. The full backend still fails because Kotlin builtins
  deserialization can read `kotlin/kotlin.kotlin_builtins` but cannot resolve `kotlin.Unit`; virtual
  classpath jar reads also still warn with `NullPointerException`.
- The next PS coverage targets are simple input parsing, strings/chars, packages/imports, collection
  helpers, and stable classpath jar reads.
