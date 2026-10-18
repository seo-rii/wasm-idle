# TeaVM Runtime Package

`@wasm-idle/runtime-teavm` wraps the TeaVM browser compiler/runtime assets with reusable asset
manifests, URL resolution, and fetch helpers.

Java execution uses TeaVM's browser compiler/runtime assets from `static/teavm/`:

- `compiler.wasm`
- `compiler.wasm-runtime.js`
- `compiler.wasm-deobfuscator.wasm`
- `compile-classlib-teavm.bin`
- `runtime-classlib-teavm.bin`

The checked-in generation is reproduced from `konsoletyper/teavm-javac` revision
`7e4a44cf521694a4e326e33850dd8aec165eb5c9`, TeaVM 0.13.1, and the Eclipse Temurin
25.0.3+9 Linux x64 JDK archive. Java-specific integration code lives in
`src/lib/playground/worker/java.ts` and `src/lib/playground/javaStdin.ts`.

The wrapper and browser application pin all five logical assets to the same exact byte counts and
SHA-256 receipts. `static/teavm/runtime-manifest.v2.json` binds those receipts to source, JDK,
Gradle, dependency-verification, local-overlay, storage, and license metadata. A custom base URL or
loader remains a mirror for the pinned generation unless the caller explicitly supplies a complete
replacement receipt set.

The stack deobfuscator is the unmodified `org/teavm/backend/wasm/deobfuscator.wasm` resource from
the pinned `teavm-wasm-gc-deobfuscator` 0.13.1 JAR. It resolves the debug metadata already embedded
in compiled programs to Java class, method, file, and line information, including calls to
`Throwable.printStackTrace()`.

The compiler is built from that revision with source patches. The first,
`scripts/teavm/patches/teavm-javac-pluggable-dependencies.patch`, addresses TeaVM issue #1322:
TeaVM skips `@PluggableDependency` dependency plugins when TeaVM itself is compiled by TeaVM, as it
is in the browser compiler, so `Object.clone()` results lost their types: `String.format("%.2f", x)`
and virtual calls on other cloned objects trapped with "dereferencing a null pointer". The patch
registers a dependency listener that applies the declared plugins. Only `compiler.wasm` changes;
the producer applies the patch with `git apply` before the Gradle build, and `upstreamOutputs`
records the receipts of that patched build.

A second source patch, `scripts/teavm/patches/teavm-javac-stdlib-rename.patch`, backports upstream
teavm-javac commit `199bed0` ("When converting TeaVM's class library methods, apply `@Rename`
annotation properly"). Without it the javac SDK (`compile-classlib-teavm.bin`) exposed TeaVM's
implementation names (`Throwable.getMessage0`, `Object.getClass0`, `ArrayList.clone0`), so
`e.getMessage()`, `x.getClass()` and `list.clone()` did not compile. It changes only
`compile-classlib-teavm.bin`.

A third source patch, `scripts/teavm/patches/teavm-javac-enum-constants.patch`, restores enum
reflection. TeaVM 0.13.1's `PlatformPlugin` installs `EnumDependencySupport` only when TeaVM is not
compiled by TeaVM, so the browser compiler never linked `values()` for enums reached through
`Class.getEnumConstants()`: it returned an empty array, and `Enum.valueOf`, `EnumSet` and `EnumMap`
trapped or printed `Main$Color@...`. The patch registers an equivalent listener that matches
`ClassSupport.getEnumConstants` by name, because the original refers to
`org.teavm.platform.Platform`, which the Wasm GC target does not support. It changes only
`compiler.wasm`.

A fourth source patch, `scripts/teavm/patches/teavm-javac-annotation-classlib.patch`, repairs
annotations in the javac SDK. TeaVM declares `TAnnotation` as an `@interface`, so after renaming the
SDK's `java.lang.annotation.Annotation` extended itself; javac does not check class files for cyclic
inheritance and `Types.rank()` recursed until the stack overflowed whenever it resolved an
annotation element, as in `@SuppressWarnings("unchecked")`. TeaVM's `SuppressWarnings` also has no
`value()` element. The patch drops self-referencing interfaces in `StdlibConverter` and adds a
`SuppressWarnings` with `value()` to teavm-javac's class-library emulation sources. It changes only
`compile-classlib-teavm.bin` and must be applied after the `199bed0` backport.

A fifth source patch, `scripts/teavm/patches/teavm-javac-array-clone.patch`, makes cloning primitive
arrays work. TeaVM 0.13.1 dependency analysis only connects a cloned array to `Object.clone()` when
the array variable escapes its method, and the Wasm GC backend installs a primitive array class's
clone function only for types that reach `Object.clone()`; so `int[] b = a.clone();` followed by
local use trapped with "dereferencing a null pointer". This is TeaVM behaviour, not specific to the
browser compiler. The patch registers a listener that infers the static type of cloned arrays in
reached methods and propagates primitive array types to `Object.clone()`. It changes only
`compiler.wasm`.

A sixth source patch, `scripts/teavm/patches/teavm-javac-reproducible-wasm.patch`, makes the
`compiler.wasm` build byte-reproducible. TeaVM 0.13.1 keeps dependency-node domains in a `HashSet`
of identity-hashed nodes (`TypeSet`), so the order in which classes are reached differs between JVM
runs, and `TagRegistry` numbers the class tags used by `Class.isInstance`/`isAssignableFrom` range
checks in that order; builds of identical sources produced `compiler.wasm` files that differed only
in those `i32.const` tags. The patch puts copies of both classes with deterministic iteration (a
`LinkedHashSet` domain and sorted class names) first on the classpath of the out-of-process TeaVM
build daemon. They are not part of the compiled program, and the build fails if the TeaVM version
changes.

A seventh source patch, `scripts/teavm/patches/teavm-javac-bootstrap-services.patch`, installs the
`ServiceLoader` and runtime-annotation support that TeaVM's `JCLPlugin` skips when TeaVM itself is
compiled by TeaVM, as the browser compiler is. Without it, `ServiceLoader.load(...)` failed with
"Method is not annotated with {{c0}}" and `Class.getAnnotation` of a `RUNTIME` annotation crashed
code generation. TeaVM 0.13.1's Wasm GC annotation support also propagates no type for `String` and
`String[]` element values, so using such a value, as in `tag.value() + "!"`, dereferenced a null
pointer even in JVM-hosted TeaVM; the patch adds a listener that propagates `String` to those
fields. Reflective field and method access stays unsupported, as in TeaVM's Wasm GC backend. It
changes only `compiler.wasm`.

An eighth source patch, `scripts/teavm/patches/teavm-javac-classlib-supplements.patch`, adds
`java.*` methods that the TeaVM 0.13.1 class library lacks. Small supplement classes compiled once
against that library carry the methods; teavm-javac copies them into the target classes both when it
converts the javac SDK and when it packs the runtime class library, so the two always declare the
same API, and the build fails if a supplement would replace an existing method. It adds
`PrintStream.print(boolean)`, `print(float)`, `println(char[])` and `writeBytes(byte[])`; without the
float and `char[]` overloads, javac picked `print(double)` and `println(Object)`, so
`System.out.print(0.1f)` printed `0.10000000149011612` and `System.out.println(chars)` printed
`[C@…`. It also adds `Integer.sum`, `toUnsignedLong` and `parseUnsignedInt`, `Long.sum`, `max`, `min`
and `parseUnsignedLong`, `Double` and `Float` `sum`, `max` and `min`, `Math.multiplyHigh` and
`multiplyFull`, `Character.toString(int)`, `Collection.parallelStream()` (sequential, like every
TeaVM stream), `Stream.ofNullable`, and `String.lines()` and `transform`. `Long::sum` also makes
`Collectors.counting()` work. It changes `compile-classlib-teavm.bin` and the canonical runtime class
library, not `compiler.wasm`.

The runtime class library intentionally carries one wasm-idle compatibility overlay for character
and byte stream I/O under Wasm GC. Starting from the pinned TeaVM 0.13.1 source JAR, it changes
exactly two `allocate`/`wrap` calls in each of `TByteBuffer`, `TCharBuffer`, `TShortBuffer`,
`TIntBuffer`, `TLongBuffer`, `TFloatBuffer`, and `TDoubleBuffer` from the typed array's
`fromJavaArray` to `copyFromJavaArray`. Those calls sit in JavaScript-backend branches that never
run under Wasm GC, but TeaVM 0.13.1 still rejects their `@JSByRef` parameters while generating Wasm
GC code. Without the overlay, any program reaching `CharBuffer` (for example `InputStreamReader`,
`BufferedReader`, `OutputStreamWriter`, `PrintWriter`, or `String.getBytes(Charset)`) fails before
it runs.

It also repairs two defects in the Wasm GC `System.out`/`System.err` byte path,
`JsConsolePrintStream`: `flush()` cleared its pending action before invoking it, trapping with a
null dereference on the first flush after a byte write (for example `BufferedWriter.flush()`), and
`write(byte[], off, len)` never advanced `off`, repeating the first 32 bytes of longer writes. Its
`ByteEncoder.flush()` also decoded pending bytes as the end of input, so the next byte write threw
`IllegalStateException` and a UTF-8 character split across a flush was replaced; it now keeps an
incomplete sequence pending until the rest arrives.

`TFormatter` handles `%n` and `%%` without consuming an argument, as `java.util.Formatter` does
(TeaVM issue #1317): `%n` emits the line separator instead of throwing
`UnknownFormatConversionException`, and `%%` no longer shifts later arguments. The overlay adds
`TIllegalFormatWidthException`, which TeaVM 0.13.1 lacks, for the `%5n` case; the producer appends
it to the archive and rejects an archive that already contains it. `%f` also rounds half up on the
shortest decimal representation, as `java.util.Formatter` does, instead of `DecimalFormat`'s default
half-even (TeaVM issue #1323): `"%.1f"` of `0.25` is `0.3` and `"%.2f"` of `1.005` is `1.01`.
`%e` and `%E`, which TeaVM 0.13.1 rejects as unknown conversions, format the same way in scientific
notation with the `-`, `#`, `+`, space, `0` and `(` flags. They round the digits by hand because
TeaVM 0.13.1's `BigDecimal.round` leaves a value unchanged when it would drop exactly one digit.

The producer verifies each original source entry, transform occurrence count, transformed source,
JDK 25 `javac --release 17` output (including nested classes), canonical 2,141-entry archive,
appended entries, and final byte receipts before publication. Do not broaden this overlay while
performing a provenance-only refresh.

To reproduce and publish the generation, check out the revision above, download the exact JDK
archive recorded in `scripts/wasm-teavm-assets.lock.json`, and run:

```bash
pnpm run sync:wasm-teavm /path/to/teavm-javac /path/to/OpenJDK25U-jdk_x64_linux_hotspot_25.0.3_9.tar.gz
```

The producer uses a fresh isolated Gradle cache, injects the checked-in SHA-256 dependency
verification metadata, verifies the Gradle and OpenJDK downloads, applies the locked overlay, and
transactionally replaces the static tree and both generated consumer receipt modules. It rejects
source, dependency, toolchain, intermediate, overlay, logical-output, or compressed-storage drift.
Third-party license texts and source correspondence are shipped in
`static/teavm/THIRD_PARTY_NOTICES.md`.

Build and type-check the wrapper package with:

```bash
pnpm --dir runtimes/teavm run build
pnpm --dir runtimes/teavm run check
```

For generic runtime-dispatch integration, `wasm-teavm` is registered as a manual,
source-required producer. Set `WASM_IDLE_TEAVM_JDK_ARCHIVE` to the pinned JDK archive before using
`scripts/sync-runtime.mjs wasm-teavm <sourceDir> [targetDir]`.
