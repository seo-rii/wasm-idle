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
- The exported API call now completes the verified browser fixture set through the minimal
  PSI-based bytecode emitter. Full Kotlin/JVM backend restoration is tracked separately because
  Kotlin builtins and virtual classpath jar reads are still not stable under the TeaVM runtime.

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
- The browser-facing compile export also completes `fixtures/ps-stdin/Main.kt`, which covers
  numeric stdin through `readInt()` and `readLong()` browser-emitter intrinsics. The generated class
  contains private `System.in.read()`-based helpers, and with stdin
  `5 3 1 4 1 5 100000000000` it prints `weighted=46 total=100000000046`.
- The browser-facing compile export also completes `fixtures/ps-string-char/Main.kt`, which covers
  string-token stdin through `readString()`, `String.length`, `String[index]`, `Char` literals and
  comparisons, character appends in string templates, and character output. With stdin
  `algorithm queue` it prints `score=25 first=a secondLast=e`.
- The browser-facing compile export also completes `fixtures/ps-package-import/Main.kt`, which covers
  package declarations and common unused import headers. The browser API strips import directives
  before reduced Kotlin analysis; this avoids the current import-resolution diagnostic path while
  preserving package-based class output such as `solve/MainKt.class`. With stdin `42 30` it prints
  `pkg=6`.
- The browser-facing compile export also completes `fixtures/ps-boolean/Main.kt`, which covers
  `Boolean` parameters/returns/locals, `true`/`false`, `!`, `&&`, `||`, boolean equality,
  `BooleanArray` construction, reads and writes, boolean conditions, and boolean output/string
  templates. With stdin `5 2 3 2 0 5` it prints `bool=true count=4 two=true`.
- The browser-facing compile export also completes `fixtures/ps-increment/Main.kt`, which covers
  prefix/postfix `++` and `--` on numeric locals, including postfix increments used as array indexes
  and prefix decrement statements. With stdin `4 3 1 4 1` it prints `inc=15 last=1`.
- The browser-facing compile export also completes `fixtures/ps-double/Main.kt`, which covers
  `Double` parameters/returns/locals, double literals, `readDouble()`, `DoubleArray` construction,
  reads and writes, double arithmetic/comparisons, and double output/string templates. With stdin
  `3 1.5 2.5 4.0` it prints `double=4.0 first=1.5`.
- The browser-facing compile export also completes `fixtures/ps-math-helpers/Main.kt`, which covers
  `abs`, `minOf`, and `maxOf` for promoted `Int`, `Long`, and `Double` arguments. These helper calls
  lower directly to `java.lang.Math` overloads. With stdin `-7 5 123456789012 -3.5` it prints
  `math=12 long=123456789012 double=2.5`.
- The browser-facing compile export also completes `fixtures/ps-char-array/Main.kt`, which covers
  `String.toCharArray()`, `CharArray` reads and writes, array `.size`, and character output/string
  templates. With stdin `banana` it prints `chars=bz score=9`.
- The browser-facing compile export also completes `fixtures/ps-for-loop/Main.kt`, which covers
  Int `for` loops over `until`, inclusive `..`, and `downTo ... step ...` ranges. The minimal emitter
  lowers these loops directly to index comparisons and increments. With stdin `5 1 2 3 4 5` it
  prints `for=15 rev=9 last=5`.
- The browser-facing compile export also completes `fixtures/ps-array-compound/Main.kt`, which covers
  compound assignments on `IntArray`, `LongArray`, and `DoubleArray` elements, including RHS numeric
  widening to `Long` and `Double`. With stdin `2 3 5 100000000000 1.5` it prints
  `arr=5,15,1 long=100000000005 double=5.0`.
- The browser-facing compile export also completes `fixtures/ps-unary-minus/Main.kt`, which covers
  unary minus on `Int`, `Long`, and `Double` values, including negative `Double` literals. With
  stdin `7 100000000000 2.5` it prints `neg=-7 long=-100000000000 double=-4.0`.
- The browser-facing compile export also completes `fixtures/ps-repeat/Main.kt`, which covers
  `repeat(n) { index -> ... }` and `repeat(n) { ... }` with implicit `it`. With stdin
  `4 3 1 4 1` it prints `repeat=21 implicit=3`.
- The browser-facing compile export also completes `fixtures/ps-break-continue/Main.kt`, which
  covers `break` and `continue` in `while` and `for` loops. Running the generated class prints
  `flow=34 i=8`.
- The browser-facing compile export also completes `fixtures/ps-when/Main.kt`, which covers subject
  `when` statements with comma-separated value conditions and condition-only `when` expressions.
  With stdin `0 2` it prints `when=10 23`.
- The browser-facing compile export also completes `fixtures/ps-string-builder/Main.kt`, which
  covers `StringBuilder()`, `append(...)` for primitive/string values, and `toString()`. With stdin
  `4 3 1 4 1` it prints `builder=3 1 4 1|done`.
- The browser-facing compile export also completes `fixtures/ps-2d-array/Main.kt`, which covers
  `Array(n) { IntArray(m) }`, nested primitive-array reads and writes, compound assignment on nested
  elements, outer `.size`, and row `.size`. With stdin `2 3 1 2 3 4 5 6` it prints
  `grid=6 edge=6 size=2,3`.
- The browser-facing compile export also completes `fixtures/ps-array-sort/Main.kt`, which covers
  `sort()` on `IntArray`, `LongArray`, and `CharArray` values by lowering to `java.util.Arrays`.
  With stdin `4 9 90 1 10 4 40 1 20 dcba` it prints `sort=1,9 long=10,90 chars=ad`.
- The browser-facing compile export also completes `fixtures/ps-string-parse/Main.kt`, which covers
  `String.toInt()`, `String.toLong()`, and `String.toDouble()` on token input. With stdin
  `7 100000000000 2.5` it prints `parse=8 long=100000000002 double=3.0`.
- The browser-facing compile export also completes `fixtures/ps-string-equality/Main.kt`, which
  covers `String` `==`/`!=` comparisons in boolean expressions and conditions. With stdin `go go` it
  prints `eq=true diff=true score=7`.
- The browser-facing compile export also completes `fixtures/ps-array-fill/Main.kt`, which covers
  `fill(...)` on primitive arrays by lowering to `java.util.Arrays.fill`. Running the generated class
  prints `fill=7,8 long=100000000000 double=3.0 char=xx bool=true`.
- The browser-facing compile export also completes `fixtures/ps-array-list/Main.kt`, which covers
  `ArrayList<Int>` construction, `add`, index get/set, `size`, `isEmpty`, and `sort()` by lowering to
  `java.util.ArrayList<Integer>` plus `java.util.Collections.sort`. With stdin `4 5 1 4 1` it prints
  `list=1,6 size=5 sum=17 empty=false`.
- The browser-facing compile export also completes `fixtures/ps-priority-queue/Main.kt`, which covers
  `PriorityQueue<Int>` construction, `add`, `offer`, `peek`, `poll`, `size`, and `isEmpty` by
  lowering to `java.util.PriorityQueue<Integer>`. With stdin `5 3 1 4 1 5` it prints
  `pq=74 count=6 size=0`.
- The browser-facing compile export also completes `fixtures/ps-array-deque/Main.kt`, which covers
  `ArrayDeque<Int>` construction, `addFirst`, `addLast`, `offer`, `offerFirst`, `offerLast`, `first`,
  `last`, `getFirst`, `getLast`, `poll`, `pollLast`, `removeFirst`, `removeLast`, `size`, and
  `isEmpty` by lowering to `java.util.ArrayDeque<Integer>`. With stdin `4 2 7 1 5` it prints
  `deque=52 edge=19 removed=100 tail=5 count=5 size=0`.
- The browser-facing compile export also completes `fixtures/ps-hash-set/Main.kt`, which covers
  `HashSet<Int>` and `mutableSetOf<Int>()` construction, `add`, `contains`, `remove`, `clear`,
  `size`, and `isEmpty` by lowering to `java.util.HashSet<Integer>`. With stdin `5 1 2 1 3 2` it
  prints `set=2,true had=true removed=true missing=false empty=true`.
- The browser-facing compile export also completes `fixtures/ps-hash-map/Main.kt`, which covers
  `HashMap<Int, Int>` and `mutableMapOf<Int, Int>()` construction, `map[key]`, `map[key] = value`,
  `put`, `getOrDefault`, `containsKey`, `remove`, `clear`, `size`, and `isEmpty` by lowering to
  `java.util.HashMap<Integer, Integer>`. With stdin `7 1 2 1 3 2 2 3` it prints
  `map=3 removed=2 after=-1 had=true extra=3 empty=true size=0`.
- The browser-facing compile export also completes `fixtures/ps-in-operator/Main.kt`, which covers
  `in`/`!in` for `Int` ranges, `String`/`Char` in `String`, `String` in `String`, and membership in
  the verified `Int` collection/map shapes above. With stdin `4 1 2 3 2 algorithmgo` it prints
  `in=131071 size=3,3`.
- The browser-facing compile export also completes `fixtures/ps-string-api/Main.kt`, which covers
  `String.substring`, `startsWith`, `endsWith`, `contains` with `String` and `Char`, `indexOf`,
  `lastIndexOf`, `trim`, `lowercase`, and `uppercase`. With stdin `algorithmgo` it prints
  `str=algor|ithmgo|orithm idx=3,2,9 score=15 case=kotlingo/KOTLINGO`.
- The browser-facing compile export also completes `fixtures/ps-array-in/Main.kt`, which covers
  `in`/`!in` membership on `IntArray`, `LongArray`, `DoubleArray`, `CharArray`, and `BooleanArray`
  by emitting direct primitive-array scan loops. With stdin `banana` it prints
  `arrayIn=1023 size=3,6`.
- The browser-facing compile export also completes `fixtures/ps-pair-int/Main.kt`, which covers
  limited `Pair<Int, Int>` construction, `.first`, `.second`, and function return values by lowering
  to `java.util.AbstractMap.SimpleEntry<Integer, Integer>`. With stdin `3 4` it prints
  `pair=3,4 combined=10,24 diff=14`.
- The browser-facing compile export also completes `fixtures/ps-pair-list/Main.kt`, which covers
  `ArrayList<Pair<Int, Int>>` and `mutableListOf<Pair<Int, Int>>()` construction, `add`, index
  get/set, `.first`, `.second`, `in`/`!in`, `contains`, `remove`, `size`, and `isEmpty` by storing
  `java.util.AbstractMap.SimpleEntry<Integer, Integer>` values in `java.util.ArrayList`. With stdin
  `2 1 2 3 4` it prints
  `pairs=13,24|2,1 score=186 flags=true,true,true,true empty=false size=2`.
- The browser-facing compile export also completes `fixtures/ps-list-helpers/Main.kt`, which covers
  `MutableList<Int>` and `ArrayList<Pair<Int, Int>>` stack/list helpers: indexed `add`,
  `removeAt`, `first()`, `last()`, `clear()`, `size`, and `isEmpty`. With stdin `5 9` it prints
  `list=5,9 removed=3 pair=3,4|5,6 removedPair=1,2 empty=true,true size=0,0`.
- The browser-facing compile export also completes `fixtures/ps-double-math/Main.kt`, which covers
  numeric `toInt`/`toLong`/`toDouble` conversions plus `sqrt`, `floor`, `ceil`, and `pow` by lowering
  to JVM numeric conversion opcodes and `java.lang.Math`. With stdin `16 100000000000 2.5` it prints
  `math=4,64 low=2 high=3 mix=100000000004`.
- This success currently comes from a minimal PSI-based bytecode emitter for the verified fixture
  shapes, not from the full Kotlin/JVM backend. The full backend still fails because Kotlin builtins
  deserialization can read `kotlin/kotlin.kotlin_builtins` but cannot resolve `kotlin.Unit`; virtual
  classpath jar reads also still warn with `NullPointerException`.
- The next PS coverage targets are collection helpers, classes/data classes, lambdas/generics,
  broader library calls, and stable classpath jar reads. Most imported library symbols still need
  explicit helper support; import directives are currently accepted as boilerplate only.
