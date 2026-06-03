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

To smoke-test the generated WasmGC artifact in a browser-compatible Node runtime:

```bash
JAVA_TOOL_OPTIONS=-Xss64m gradle -p tools/wasm-kotlin-teavm buildWasmGC
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-wasm-runtime.mjs
```

The runtime probe writes `.cache/probes/last-wasm-runtime.json`. It first validates that Node can
compile the generated Wasm module with imported JS string support, then calls TeaVM's generated
runtime loader.

To call the exported Kotlin compiler probe against the minimal fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs
```

The compile probe writes `.cache/probes/last-kotlin-compile.json`. The current artifact loads and
exposes `compileKotlinSource`; for the minimal fixture it writes `MainKt.class` and
`META-INF/main.kotlin_module` under `build/browser-probe-out`.

The generated class can be checked with:

```bash
java -cp tools/wasm-kotlin-teavm/build/browser-probe-out MainKt
```

The expected output for the current fixture is:

```text
answer=42
```

To run the PS-style control-flow fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-basic/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-basic-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-basic-out MainKt
```

The expected output is:

```text
gcd=6 sum=9
```

To run the PS-style `Long` and primitive-array fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-long-array/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-long-array-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-long-array-out MainKt
```

The expected output is:

```text
chk=46 total=100000000007
```

To run the PS-style numeric stdin fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-stdin/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-stdin-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-stdin-out MainKt
```

With this stdin:

```text
5 3 1 4 1 5 100000000000
```

the expected output is:

```text
weighted=46 total=100000000046
```

To run the PS-style string and char fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-string-char/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-string-char-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-string-char-out MainKt
```

With this stdin:

```text
algorithm queue
```

the expected output is:

```text
score=25 first=a secondLast=e
```

To run the PS-style package/import fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-package-import/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-package-import-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-package-import-out solve.MainKt
```

With this stdin:

```text
42 30
```

the expected output is:

```text
pkg=6
```

To run the PS-style boolean fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-boolean/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-boolean-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-boolean-out MainKt
```

With this stdin:

```text
5 2 3 2 0 5
```

the expected output is:

```text
bool=true count=4 two=true
```

To run the PS-style increment fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-increment/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-increment-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-increment-out MainKt
```

With this stdin:

```text
4 3 1 4 1
```

the expected output is:

```text
inc=15 last=1
```

To run the PS-style double fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-double/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-double-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-double-out MainKt
```

With this stdin:

```text
3 1.5 2.5 4.0
```

the expected output is:

```text
double=4.0 first=1.5
```

To run the PS-style math helper fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-math-helpers/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-math-helpers-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-math-helpers-out MainKt
```

With this stdin:

```text
-7 5 123456789012 -3.5
```

the expected output is:

```text
math=12 long=123456789012 double=2.5
```

## Current Status

This folder is a porting scaffold, not an app integration. The current probe compiles a small Java
wrapper around Kotlin's direct JVM compiler API, installs TeaVM transformers for incompatible JVM
APIs, and uses a minimal PSI-based JVM bytecode emitter for the browser fixture path.

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
- Splitting the browser TeaVM entry point from the JVM fixture runner removed the host JDK scan from
  the browser graph. The current fast-analysis build fails in about 100 seconds at roughly 5.6 GB
  RSS; `java.io.File.toPath` is no longer in the first blocker set.
- The first transformer patches disable `System.exit`, Kotlin CLI plugin loading, Kotlin
  performance measurements that can reach JVM management APIs, and the reflective `Field.setInt`
  call used by IntelliJ's file-size limit setup.
- TeaVM ignores ordinary application jar classes in `java.*` packages for this classlib path. The
  working approach is to add TeaVM classlib-style `T...` classes under `org.teavm.classlib...`.
- Classlib-style stubs now cover the first lock/future/string-iterator blocker set:
  `ReentrantLock`, `ReentrantReadWriteLock`, `ExecutorService`, `Executors`, `CompletableFuture`,
  `Future`, `TimeoutException`, and `StringCharacterIterator`.
- The `JavacWrapper` and `JavacBasedClassFinder` transformer patches remove the statically
  reachable `com.sun.tools.javac`/`javax.tools` blocker group when `USE_JAVAC=false`.
- Additional classlib stubs cover `AtomicReferenceArray`, `ConcurrentLinkedQueue`, `ForkJoinPool`,
  and `ForkJoinTask`, while transformer patches cover `ConcurrentHashMap`'s missing constructor and
  `ContainerUtil.newConcurrentSet()`.
- JDK utility patches cover class resource lookup, class/type names, generic interface reflection,
  `Runtime.addShutdownHook`, `System.mapLibraryName`, `Long.parseUnsignedLong`, `StringJoiner`, and
  `LockSupport`.
- Replacing the compiler probe's `PrintingMessageCollector` with a minimal in-memory collector keeps
  `PlainTextMessageRenderer` and Jansi's native-loading path out of the current browser graph.
- The next JDK stub round covers `AtomicIntegerArray`, `AtomicLongArray`, primitive reflective
  `Field` setters, `Field.getGenericType()`, method-handle lookup metadata, array/spliterator
  helpers, `StreamSupport.intStream(...)`, and the `MockApplication.invokeLater(...)` path that was
  reaching Swing.
- With those patches, fast analysis fails in about 56 seconds at roughly 5.0 GB RSS. The next blocker
  group is coroutines, file-channel APIs, XML/StAX plugin descriptor parsing, IntelliJ unsafe
  method-handle CAS calls, `java.awt.Rectangle`, `java.lang.management.ManagementFactory`,
  `TypeNotPresentException`, and `ClassLoader.getResource(...)`.
- Pruning IntelliJ plugin descriptor registration and replacing the multiverse context manager with
  default-context behavior removes the current coroutines and XML/StAX descriptor paths from the
  browser graph.
- With those patches, fast analysis fails in about 64 seconds at roughly 4.7 GB RSS. The next blocker
  group is file-channel APIs, IntelliJ event multicaster proxy creation, JVM management/thread dump
  APIs, Swing transaction guard setup, `ConcurrentHashMap.newKeySet()`, unsafe method-handle CAS
  calls, `TypeNotPresentException`, and `ClassLoader.getResource(...)`.
- Additional IntelliJ runtime pruning removes the current `MockProject` coroutine initialization,
  application-info XML initialization, debug/thread-dump helpers, transaction guard Swing setup,
  event multicaster proxy creation, `ResourceBundle.clearCache(...)`, `ClassLoader.loadClass(...)`,
  EDT/threading assertions, cancellation checks, `Introspector`, and `TypeNotPresentException`
  paths.
- With those patches, fast analysis fails in about 67 seconds at roughly 5.1 GB RSS. The next blocker
  group is file-channel APIs, IntelliJ unsafe method-handle calls, `MethodType.methodType(...)`,
  `CharSequenceAccess`, `PropertyChangeSupport`, and Swing icon classes.
- `jdeps` reports that the Kotlin compiler distribution reaches beyond `java.base` into
  `java.desktop`, `java.instrument`, `java.management`, `java.scripting`, `jdk.compiler`, and
  `jdk.unsupported`.
- With `JAVA_TOOL_OPTIONS=-Xss64m`, `buildWasmGC` now succeeds and writes
  `build/generated/teavm/wasm-gc/kotlin-compiler-probe.wasm`.
- Node can compile the generated WasmGC module when run with
  `--experimental-wasm-imported-strings`, and the module exports `main`, `compileKotlinSource`, and
  `teavm.memory`.
- TeaVM's generated runtime loader now initializes successfully in Node. The startup trap was caused
  by TeaVM's JS string conversion path calling `Fiber.isResuming()` before a fiber existed; the probe
  patches `Fiber.isResuming()` and `Fiber.isSuspending()` for this browser compiler graph.
- The `compileKotlinSource` JSO export is present and callable. The browser-compatible probe
  compiles `fixtures/hello/Main.kt` to a runnable `MainKt.class`; running that class prints
  `answer=42`.
- The browser-compatible probe also compiles `fixtures/ps-basic/Main.kt`, which exercises top-level
  `Int` functions, `Int` parameters/returns, `var` reassignment, `while`, `if/else`, arithmetic,
  modulo, comparisons, `return`, function calls, string templates, and `print`/`println`. Running
  that generated class prints `gcd=6 sum=9`.
- The browser-compatible probe also compiles `fixtures/ps-long-array/Main.kt`, which exercises
  `Long` values/functions, `LongArray`, `IntArray`, array construction, array element reads/writes,
  and mixed fixture calls. Running that generated class prints `chk=46 total=100000000007`.
- The browser-compatible probe also compiles `fixtures/ps-stdin/Main.kt`, which exercises numeric
  stdin helpers. Calls to `readInt()` and `readLong()` are treated as browser-emitter intrinsics and
  generate private `System.in.read()`-based helper methods in the output class. Running that
  generated class with `5 3 1 4 1 5 100000000000` on stdin prints
  `weighted=46 total=100000000046`.
- The browser-compatible probe also compiles `fixtures/ps-string-char/Main.kt`, which exercises
  string-token input through `readString()`, `String.length`, `String[index]`, `Char` literals and
  comparisons, character appends in string templates, and character output support. Running that
  generated class with `algorithm queue` on stdin prints `score=25 first=a secondLast=e`.
- The browser-compatible probe also compiles `fixtures/ps-package-import/Main.kt`, which exercises a
  package declaration and a common unused import header. The browser source prepass strips import
  directives before reduced Kotlin analysis so the minimal emitter can accept typical PS boilerplate;
  imported library symbols are still part of the separate library-helper target. Running that
  generated class with `42 30` on stdin prints `pkg=6`.
- The browser-compatible probe also compiles `fixtures/ps-boolean/Main.kt`, which exercises
  `Boolean` parameters/returns/locals, `true`/`false`, `!`, `&&`, `||`, boolean equality,
  `BooleanArray` construction, reads and writes, boolean conditions, and boolean output/string
  templates. Running that generated class with `5 2 3 2 0 5` on stdin prints
  `bool=true count=4 two=true`.
- The browser-compatible probe also compiles `fixtures/ps-increment/Main.kt`, which exercises
  prefix/postfix `++` and `--` on numeric locals, including postfix increments used as array indexes
  and prefix decrement statements. Running that generated class with `4 3 1 4 1` on stdin prints
  `inc=15 last=1`.
- The browser-compatible probe also compiles `fixtures/ps-double/Main.kt`, which exercises
  `Double` parameters/returns/locals, double literals, `readDouble()`, `DoubleArray` construction,
  reads and writes, double arithmetic/comparisons, and double output/string templates. Running that
  generated class with `3 1.5 2.5 4.0` on stdin prints `double=4.0 first=1.5`.
- The browser-compatible probe also compiles `fixtures/ps-math-helpers/Main.kt`, which exercises
  `abs`, `minOf`, and `maxOf` for promoted `Int`, `Long`, and `Double` arguments. These helper calls
  lower directly to `java.lang.Math` overloads. Running that generated class with
  `-7 5 123456789012 -3.5` on stdin prints `math=12 long=123456789012 double=2.5`.
- This is not a full Kotlin/JVM backend yet. The browser path is currently a minimal emitter that
  supports the verified fixture shapes above. It does not yet support enough Kotlin for real
  competitive-programming use: collections and common library helpers, classes/data classes,
  lambdas, generics, broader library calls, and stable classpath jar reads are still missing.
- Full Kotlin backend restoration is still blocked by Kotlin builtins deserialization in the TeaVM
  runtime: the `.kotlin_builtins` resource is readable, but `DefaultBuiltIns.getUnitType()` still
  reports that `kotlin.Unit` is missing. Virtual classpath jar reads also still warn with
  `NullPointerException`, so stable jar/class input remains unfinished.

See `docs/porting-plan.md` for the next patch targets.
