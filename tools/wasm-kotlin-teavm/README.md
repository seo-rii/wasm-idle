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

To run the PS-style numeric coerce fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-coerce/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-coerce-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-coerce-out MainKt
```

With this stdin:

```text
-3 100000000020 5.25
```

the expected output is:

```text
coerce=0,-3,2 long=100000000010,100000000000 double=4.5,3.0
```

To run the PS-style char-array fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-char-array/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-char-array-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-char-array-out MainKt
```

With this stdin:

```text
banana
```

the expected output is:

```text
chars=bz score=9
```

To run the PS-style for-loop fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-for-loop/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-for-loop-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-for-loop-out MainKt
```

With this stdin:

```text
5 1 2 3 4 5
```

the expected output is:

```text
for=15 rev=9 last=5
```

To run the PS-style `indices` for-loop fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-indices/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-indices-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-indices-out MainKt
```

With this stdin:

```text
4 3 1 4 1 algorithm
```

the expected output is:

```text
indices=4 sum=9 list=41 long=200000000007 string=72
```

To run the PS-style `lastIndex` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-last-index/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-last-index-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-last-index-out MainKt
```

With this stdin:

```text
4 3 1 4 1 algorithm
```

the expected output is:

```text
lastIndex=1413 score=25
```

To run the PS-style array-compound fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-array-compound/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-array-compound-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-array-compound-out MainKt
```

With this stdin:

```text
2 3 5 100000000000 1.5
```

the expected output is:

```text
arr=5,15,1 long=100000000005 double=5.0
```

To run the PS-style unary-minus fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-unary-minus/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-unary-minus-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-unary-minus-out MainKt
```

With this stdin:

```text
7 100000000000 2.5
```

the expected output is:

```text
neg=-7 long=-100000000000 double=-4.0
```

To run the PS-style repeat-loop fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-repeat/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-repeat-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-repeat-out MainKt
```

With this stdin:

```text
4 3 1 4 1
```

the expected output is:

```text
repeat=21 implicit=3
```

To run the PS-style break/continue fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-break-continue/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-break-continue-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-break-continue-out MainKt
```

The expected output is:

```text
flow=34 i=8
```

To run the PS-style when fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-when/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-when-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-when-out MainKt
```

With this stdin:

```text
0 2
```

the expected output is:

```text
when=10 23
```

To run the PS-style StringBuilder fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-string-builder/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-string-builder-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-string-builder-out MainKt
```

With this stdin:

```text
4 3 1 4 1
```

the expected output is:

```text
builder=3 1 4 1|done
```

To run the PS-style 2D primitive-array fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-2d-array/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-2d-array-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-2d-array-out MainKt
```

With this stdin:

```text
2 3 1 2 3 4 5 6
```

the expected output is:

```text
grid=6 edge=6 size=2,3
```

To run the PS-style non-Int 2D primitive-array fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-primitive-2d-arrays/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-primitive-2d-arrays-out
printf '2 3 100000000000 1.5 algorithm\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-primitive-2d-arrays-out MainKt
```

The expected output is:

```text
grid2=300000000017 double=9 chars=am bool=10 size=2,3,3,3,3
```

To run the PS-style primitive-array initializer fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-primitive-array-initializers/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-primitive-array-initializers-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-primitive-array-initializers-out MainKt
```

With this stdin:

```text
3 5 6 7 100000000000 10 20 1.5 2.5 abc
```

the expected output is:

```text
arrayInit=5,9,21 long=100000000000,22,100000000033 double=1,3 chars=ac flags=true,true
```

To run the PS-style primitive-array sort fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-array-sort/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-array-sort-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-array-sort-out MainKt
```

With this stdin:

```text
4 9 90 1 10 4 40 1 20 dcba
```

the expected output is:

```text
sort=1,9 long=10,90 chars=ad
```

To run the PS-style string numeric parse fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-string-parse/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-string-parse-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-string-parse-out MainKt
```

With this stdin:

```text
7 100000000000 2.5
```

the expected output is:

```text
parse=8 long=100000000002 double=3.0
```

To run the PS-style string equality fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-string-equality/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-string-equality-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-string-equality-out MainKt
```

With this stdin:

```text
go go
```

the expected output is:

```text
eq=true diff=true score=7
```

To run the PS-style primitive-array fill fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-array-fill/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-array-fill-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-array-fill-out MainKt
```

The expected output is:

```text
fill=7,8 long=100000000000 double=3.0 char=xx bool=true
```

To run the PS-style primitive-array copy fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-array-copy/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-array-copy-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-array-copy-out MainKt
```

With this stdin:

```text
4 3 1 4 1 100000000000 2.5 algorithm
```

The expected output is:

```text
arrayCopy=3,6,0,1,1 long=100000000007,100000000014 double=2.5,0.0 char=l,h flags=false,true,true
```

To run the PS-style numeric aggregate fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-numeric-aggregates/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-numeric-aggregates-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-numeric-aggregates-out MainKt
```

With this stdin:

```text
4 5 -2 7 1 100000000000 -4 9 12 1.5 -2.0 3.5 0.5
```

The expected output is:

```text
agg=11,-2,7 long=100000000017,-4,100000000000 double=3.5,-2.0,3.5 list=11,-2,7 longList=100000000017,-4,100000000000
```

To run the PS-style reverse and descending-sort fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-reverse-sort-desc/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-reverse-sort-desc-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-reverse-sort-desc-out MainKt
```

With this stdin:

```text
4 dbca 5 -2 7 1 100000000000 -4 9 12 1.5 -2.0 3.5 0.5 beta alpha delta gamma
```

The expected output is:

```text
desc=7,-2 long=100000000000,-4 double=3.5,-2.0 chars=da flags=false,true list=7,-2 longList=100000000000,-4 strings=gamma,alpha
```

To run the PS-style `ArrayList<Int>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-array-list/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-array-list-out
printf '4 5 1 4 1\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-array-list-out MainKt
```

The expected output is:

```text
list=1,6 size=5 sum=17 empty=false
```

To run the PS-style `Array<ArrayList<Int>>` adjacency-list fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-int-list-array/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-int-list-array-out
printf '4 3 0 1 1 2 2 3\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-int-list-array-out MainKt
```

The expected output is:

```text
adj=4,2,2 first=4 removed=1 total=32 flags=true,true tail=9,10
```

To run the PS-style `Array<ArrayList<Pair<Int, Int>>>` weighted-adjacency fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-pair-list-array/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-pair-list-array-out
printf '4 3 0 1 5 1 2 7 2 3 11\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-pair-list-array-out MainKt
```

The expected output is:

```text
weighted=4,2,2 first=4,1 removed=1,8 total=398 flags=true,true tail=9,10|11,12
```

To run the PS-style `MutableList<Long>` / `ArrayList<Long>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-long-list/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-long-list-out
printf '100000000000 7\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-long-list-out MainKt
```

The expected output is:

```text
longList=7,100000000007 removed=100000000000,true sorted=99999999993,100000000014 flags=true,true empty=true extra=7 size=0,2
```

To run the PS-style `PriorityQueue<Int>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-priority-queue/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-priority-queue-out
printf '5 3 1 4 1 5\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-priority-queue-out MainKt
```

The expected output is:

```text
pq=74 count=6 size=0
```

To run the PS-style `PriorityQueue<Pair<Int, Int>>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-pair-priority-queue/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-pair-priority-queue-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-pair-priority-queue-out MainKt
```

The expected output is:

```text
pairPq=4 peek=-1,8 first=-1,8 second=3,4 third=0,-10 score=807 flags=true,true,true,true empty=true size=0
```

To run the PS-style `PriorityQueue<Pair<Int, Int>>(compareBy { ... })` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-pair-priority-queue-compareby/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-pair-priority-queue-compareby-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-pair-priority-queue-compareby-out MainKt
```

The expected output is:

```text
pairPqSecond=4 peek=-3,-1 first=-3,-1 second=2,-1 third=-5,0 score=112 flags=true,true,true,true empty=true size=0 firstOrder=1,99
```

To run the PS-style `PriorityQueue<Pair<Long, Int>>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-long-int-pair-priority-queue/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-long-int-pair-priority-queue-out
printf '100000000000 10\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-long-int-pair-priority-queue-out MainKt
```

The expected output is:

```text
longIntPq=5 peek=-100000000000,9 first=-100000000000,9 second=99999999990,1 third=99999999990,2 fourth=100000000010,3 flags=true,true,true empty=true size=0
```

To run the PS-style `PriorityQueue<Long>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-long-priority-queue/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-long-priority-queue-out
printf '100000000000 7\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-long-priority-queue-out MainKt
```

The expected output is:

```text
longPq=7,7,99999999993 more=0 flags=true,true empty=false,false size=1,2
```

To run the PS-style `ArrayDeque<Int>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-array-deque/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-array-deque-out
printf '4 2 7 1 5\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-array-deque-out MainKt
```

The expected output is:

```text
deque=52 edge=19 removed=100 tail=5 count=5 size=0
```

To run the PS-style `ArrayDeque<Long>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-long-array-deque/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-long-array-deque-out
printf '100000000000 7\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-long-array-deque-out MainKt
```

The expected output is:

```text
longDeque=0,100000000014 peek=0,100000000014 removed=0,7,100000000014,100000000007,100000000000 edge=100000000000,100000000007 flags=true,true empty=false,false size=1,2 more=7,100000000000
```

To run the PS-style `ArrayDeque<Pair<Int, Int>>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-pair-array-deque/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-pair-array-deque-out
printf '5\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-pair-array-deque-out MainKt
```

The expected output is:

```text
pairDeque=298 peek=4,5 first=4,5 last=7,8 edge=9,1|2,8 flags=true,true size=0
```

To run the PS-style `ArrayDeque<Pair<Int, Long>>` and `ArrayDeque<Pair<Long, Int>>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-mixed-pair-array-deque/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-mixed-pair-array-deque-out
printf '100000000000 7\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-mixed-pair-array-deque-out MainKt
```

The expected output is:

```text
mixedPairDeque=300000000031,300000000047 weighted=6,99999999993|1,2|3,4 state=99999999993,6|5,6|7,8 flags=true,true,true,true size=0,0
```

To run the PS-style `ArrayDeque<Pair<Long, Long>>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-long-long-pair-array-deque/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-long-long-pair-array-deque-out
printf '100000000000 7\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-long-long-pair-array-deque-out MainKt
```

The expected output is:

```text
longLongPairDeque=600000000017 peek=99999999993,99999999986 first=99999999993,99999999986 last=100000000007,100000000014 edge=1,2|3,4 flags=true,true size=0
```

To run the PS-style `HashSet<Int>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-hash-set/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-hash-set-out
printf '5 1 2 1 3 2\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-hash-set-out MainKt
```

The expected output is:

```text
set=2,true had=true removed=true missing=false empty=true
```

To run the PS-style `HashSet<Long>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-long-set/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-long-set-out
printf '100000000000 7\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-long-set-out MainKt
```

The expected output is:

```text
longSet=0,2 flags=true,true,true,true,false,true empty=true,false
```

To run the PS-style `HashSet<String>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-string-set/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-string-set-out
printf 'Alpha beta\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-string-set-out MainKt
```

The expected output is:

```text
stringSet=0,2 count=2 flags=true,true,true,true,false,true empty=true,false
```

To run the PS-style `ArrayList<String>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-string-list/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-string-list-out
printf 'go lang\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-string-list-out MainKt
```

The expected output is:

```text
stringList=0,2 count=2 first=GO last=LANG removed=lang,true sorted=LANG,lang flags=true,true empty=true extra=lang,GO
```

To run the PS-style `HashMap<String, Int>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-string-int-map/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-string-int-map-out
printf 'go lang\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-string-int-map-out MainKt
```

The expected output is:

```text
stringMap=0,2 first=1 second=2 value=3 removed=1 fallback=-7 flags=true,true,true empty=true,false more=-6,3
```

To run the PS-style `HashMap<String, Long>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-string-long-map/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-string-long-map-out
printf 'go lang 100000000000 7\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-string-long-map-out MainKt
```

The expected output is:

```text
stringLongMap=0,2 first=100000000000 second=100000000007 value=100000000014 removed=7 fallback=-11 flags=true,true,true empty=true,false more=-4,100000000014
```

To run the PS-style `HashMap<Int, Int>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-hash-map/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-hash-map-out
printf '7 1 2 1 3 2 2 3\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-hash-map-out MainKt
```

The expected output is:

```text
map=3 removed=2 after=-1 had=true extra=3 empty=true size=0
```

To run the PS-style `HashMap<Int, Long>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-int-long-map/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-int-long-map-out
printf '3 100000000000 7\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-int-long-map-out MainKt
```

The expected output is:

```text
intLongMap=0,2 value=100000000007 removed=7 fallback=-5 flags=true,true empty=true,false more=2,100000000007
```

To run the PS-style `HashMap<Long, Int>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-long-int-map/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-long-int-map-out
printf '100000000000 7\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-long-int-map-out MainKt
```

The expected output is:

```text
longMap=0,2 value=3 removed=2 fallback=-7 flags=true,true,true empty=true,false more=-5,3
```

To run the PS-style `HashMap<Long, Long>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-long-long-map/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-long-long-map-out
printf '100000000000 7\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-long-long-map-out MainKt
```

The expected output is:

```text
longLongMap=0,2 value=200000000000 removed=99999999993 fallback=-9 flags=true,true,true empty=true,false more=99999999984,200000000000
```

To run the PS-style `in`/`!in` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-in-operator/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-in-operator-out
printf '4 1 2 3 2 algorithmgo\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-in-operator-out MainKt
```

The expected output is:

```text
in=131071 size=3,3
```

To run the PS-style scalar collection method fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-scalar-collection-methods/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-scalar-collection-methods-out
java -cp tools/wasm-kotlin-teavm/build/browser-ps-scalar-collection-methods-out MainKt
```

The expected output is:

```text
methods=list=true,true,false,1 queue=true,true,7,1 deque=true,true,5,1 long=true,true,100000000000,1 words=true,true,1 clear=true,true,0,true,0
```

To run the PS-style String API fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-string-api/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-string-api-out
printf 'algorithmgo\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-string-api-out MainKt
```

The expected output is:

```text
str=algor|ithmgo|orithm idx=3,2,9 score=15 case=kotlingo/KOTLINGO
```

To run the PS-style primitive-array `in`/`!in` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-array-in/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-array-in-out
printf 'banana\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-array-in-out MainKt
```

The expected output is:

```text
arrayIn=1023 size=3,6
```

To run the PS-style `Pair<Int, Int>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-pair-int/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-pair-int-out
printf '3 4\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-pair-int-out MainKt
```

The expected output is:

```text
pair=3,4 combined=10,24 diff=14
```

To run the PS-style `Pair<Long, Long>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-long-long-pair/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-long-long-pair-out
printf '100000000000 7\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-long-long-pair-out MainKt
```

The expected output is:

```text
longPair=100000000000,100000000007 shifted=100000000000,100000000007 tail=100000000014 direct=-100000000000,100000000014
```

To run the PS-style Pair destructuring fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-pair-destructuring/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-pair-destructuring-out
printf '100000000000 7\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-pair-destructuring-out MainKt
```

The expected output is:

```text
destructure=7,9|8,100000000007|-100000000000,9 tail=3 graph=16,100000000010
```

To run the PS-style for-each and Pair destructuring loop fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-foreach-pair/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-foreach-pair-out
printf '100000000000 7\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-foreach-pair-out MainKt
```

The expected output is:

```text
foreach=24,200000000007,1,21 pair=200000000010 state=200000000007 graph=45 text=4
```

To run the PS-style `ArrayList<Pair<Int, Int>>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-pair-list/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-pair-list-out
printf '2 1 2 3 4\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-pair-list-out MainKt
```

The expected output is:

```text
pairs=13,24|2,1 score=186 flags=true,true,true,true empty=false size=2
```

To run the PS-style `ArrayList<Pair<Int, Long>>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-int-long-pair-list/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-int-long-pair-list-out
printf '100000000000 7\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-int-long-pair-list-out MainKt
```

The expected output is:

```text
intLongPairs=1,7|6,100000000000 removed=13,100000000007 flags=true,true,true,true graph=100000000007 empty=true size=0,2
```

To run the PS-style `ArrayList<Pair<Long, Int>>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-long-int-pair-list/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-long-int-pair-list-out
printf '100000000000 7\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-long-int-pair-list-out MainKt
```

The expected output is:

```text
longIntPairs=100000000000,2|99999999993,1 removed=-100000000000,9 flags=true,true,true graph=200000000011 total=100000000000 empty=false size=1,2
```

To run the PS-style `ArrayList<Pair<Long, Long>>` fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-long-long-pair-list/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-long-long-pair-list-out
printf '100000000000 7\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-long-long-pair-list-out MainKt
```

The expected output is:

```text
longLongPairList=400000000068 first=100000000007,100000000014 last=100000000007,100000000014 removed=99999999993,99999999986 head=100000000007,100000000014 tail=100000000007,100000000014 edge=5,6 rev=7,8 flags=true,true,true,true size=2,1,0
```

To run the PS-style list helper fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-list-helpers/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-list-helpers-out
printf '5 9\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-list-helpers-out MainKt
```

The expected output is:

```text
list=5,9 removed=3 pair=3,4|5,6 removedPair=1,2 empty=true,true size=0,0
```

To run the PS-style double math fixture:

```bash
node --experimental-wasm-imported-strings \
  tools/wasm-kotlin-teavm/scripts/probe-kotlin-compile.mjs \
  --source tools/wasm-kotlin-teavm/fixtures/ps-double-math/Main.kt \
  --out tools/wasm-kotlin-teavm/build/browser-ps-double-math-out
printf '16 100000000000 2.5\n' | java -cp tools/wasm-kotlin-teavm/build/browser-ps-double-math-out MainKt
```

The expected output is:

```text
math=4,64 low=2 high=3 mix=100000000004
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
- The browser-compatible probe also compiles `fixtures/ps-coerce/Main.kt`, which exercises numeric
  `coerceAtLeast`, `coerceAtMost`, and `coerceIn` on `Int`, `Long`, and `Double` expressions by
  lowering to `java.lang.Math.min/max`. Running that generated class with
  `-3 100000000020 5.25` on stdin prints
  `coerce=0,-3,2 long=100000000010,100000000000 double=4.5,3.0`.
- The browser-compatible probe also compiles `fixtures/ps-char-array/Main.kt`, which exercises
  `String.toCharArray()`, `CharArray` reads and writes, array `.size`, and character output/string
  templates. Running that generated class with `banana` on stdin prints `chars=bz score=9`.
- The browser-compatible probe also compiles `fixtures/ps-for-loop/Main.kt`, which exercises
  Int `for` loops over `until`, inclusive `..`, and `downTo ... step ...` ranges. The minimal emitter
  lowers these loops directly to index comparisons and increments. Running that generated class with
  `5 1 2 3 4 5` on stdin prints `for=15 rev=9 last=5`.
- The browser-compatible probe also compiles `fixtures/ps-indices/Main.kt`, which exercises
  `indices` for-loops over primitive arrays, `String`, `CharArray`, `ArrayList<Int>`, and
  `ArrayList<Pair<Int, Long>>`, including `indices step 2`. These lower to `0 until size` loops.
  Running that generated class with `4 3 1 4 1 algorithm` on stdin prints
  `indices=4 sum=9 list=41 long=200000000007 string=72`.
- The browser-compatible probe also compiles `fixtures/ps-last-index/Main.kt`, which exercises
  `.lastIndex` on primitive arrays, `String`, `CharArray`, `ArrayList<Int>`, and
  `ArrayList<Pair<Int, Long>>`, including `lastIndex downTo 0` loops. Running that generated class
  with `4 3 1 4 1 algorithm` on stdin prints `lastIndex=1413 score=25`.
- The browser-compatible probe also compiles `fixtures/ps-array-compound/Main.kt`, which exercises
  compound assignments on `IntArray`, `LongArray`, and `DoubleArray` elements, including RHS numeric
  widening to `Long` and `Double`. Running that generated class with
  `2 3 5 100000000000 1.5` on stdin prints
  `arr=5,15,1 long=100000000005 double=5.0`.
- The browser-compatible probe also compiles `fixtures/ps-unary-minus/Main.kt`, which exercises
  unary minus on `Int`, `Long`, and `Double` values, including negative `Double` literals. Running
  that generated class with `7 100000000000 2.5` on stdin prints
  `neg=-7 long=-100000000000 double=-4.0`.
- The browser-compatible probe also compiles `fixtures/ps-repeat/Main.kt`, which exercises
  `repeat(n) { index -> ... }` and `repeat(n) { ... }` with implicit `it`. Running that generated
  class with `4 3 1 4 1` on stdin prints `repeat=21 implicit=3`.
- The browser-compatible probe also compiles `fixtures/ps-break-continue/Main.kt`, which exercises
  `break` and `continue` in `while` and `for` loops. Running that generated class prints
  `flow=34 i=8`.
- The browser-compatible probe also compiles `fixtures/ps-when/Main.kt`, which exercises subject
  `when` statements with comma-separated value conditions and condition-only `when` expressions.
  Running that generated class with `0 2` on stdin prints `when=10 23`.
- The browser-compatible probe also compiles `fixtures/ps-string-builder/Main.kt`, which exercises
  `StringBuilder()`, `append(...)` for primitive/string values, and `toString()`. Running that
  generated class with `4 3 1 4 1` on stdin prints `builder=3 1 4 1|done`.
- The browser-compatible probe also compiles `fixtures/ps-2d-array/Main.kt`, which exercises
  `Array(n) { IntArray(m) }`, nested primitive-array reads and writes, compound assignment on nested
  elements, outer `.size`, and row `.size`. Running that generated class with
  `2 3 1 2 3 4 5 6` on stdin prints `grid=6 edge=6 size=2,3`.
- The browser-compatible probe also compiles `fixtures/ps-primitive-2d-arrays/Main.kt`, which
  exercises `Array(n) { LongArray(m) }`, `Array(n) { DoubleArray(m) }`,
  `Array(n) { CharArray(m) }`, and `Array(n) { BooleanArray(m) }`, including nested get/set,
  compound assignment on nested numeric elements, outer `.size`, and row `.size`. With stdin
  `2 3 100000000000 1.5 algorithm` it prints
  `grid2=300000000017 double=9 chars=am bool=10 size=2,3,3,3,3`.
- The browser-compatible probe also compiles `fixtures/ps-primitive-array-initializers/Main.kt`,
  which exercises `IntArray(n) { ... }`, `LongArray(n) { ... }`, `DoubleArray(n) { ... }`,
  `CharArray(n) { ... }`, and `BooleanArray(n) { ... }` initializer lambdas with explicit
  parameters and implicit `it`. Running that generated class with
  `3 5 6 7 100000000000 10 20 1.5 2.5 abc` on stdin prints
  `arrayInit=5,9,21 long=100000000000,22,100000000033 double=1,3 chars=ac flags=true,true`.
- The browser-compatible probe also compiles `fixtures/ps-array-sort/Main.kt`, which exercises
  `sort()` on `IntArray`, `LongArray`, and `CharArray` values by lowering to `java.util.Arrays`.
  Running that generated class with `4 9 90 1 10 4 40 1 20 dcba` on stdin prints
  `sort=1,9 long=10,90 chars=ad`.
- The browser-compatible probe also compiles `fixtures/ps-string-parse/Main.kt`, which exercises
  `String.toInt()`, `String.toLong()`, and `String.toDouble()` on token input. Running that
  generated class with `7 100000000000 2.5` on stdin prints
  `parse=8 long=100000000002 double=3.0`.
- The browser-compatible probe also compiles `fixtures/ps-string-equality/Main.kt`, which exercises
  `String` `==`/`!=` comparisons in boolean expressions and conditions. Running that generated class
  with `go go` on stdin prints `eq=true diff=true score=7`.
- The browser-compatible probe also compiles `fixtures/ps-array-fill/Main.kt`, which exercises
  `fill(...)` on primitive arrays by lowering to `java.util.Arrays.fill`. Running that generated
  class prints `fill=7,8 long=100000000000 double=3.0 char=xx bool=true`.
- The browser-compatible probe also compiles `fixtures/ps-array-copy/Main.kt`, which exercises
  `copyOf()`, `copyOf(newSize)`, and `copyOfRange(from, to)` on primitive arrays by lowering to
  `java.util.Arrays.copyOf/copyOfRange`, plus primitive-array `first()`/`last()`. Running that
  generated class with
  `4 3 1 4 1 100000000000 2.5 algorithm` on stdin prints
  `arrayCopy=3,6,0,1,1 long=100000000007,100000000014 double=2.5,0.0 char=l,h flags=false,true,true`.
- The browser-compatible probe also compiles `fixtures/ps-numeric-aggregates/Main.kt`, which
  exercises `sum()`, `minOrNull()`, and `maxOrNull()` on `IntArray`, `LongArray`, `DoubleArray`,
  `ArrayList<Int>`, and `ArrayList<Long>`. With stdin
  `4 5 -2 7 1 100000000000 -4 9 12 1.5 -2.0 3.5 0.5` it prints
  `agg=11,-2,7 long=100000000017,-4,100000000000 double=3.5,-2.0,3.5 list=11,-2,7 longList=100000000017,-4,100000000000`.
- The browser-compatible probe also compiles `fixtures/ps-reverse-sort-desc/Main.kt`, which
  exercises `sortDescending()` on `IntArray`, `LongArray`, `DoubleArray`, `CharArray`,
  `ArrayList<Int>`, `ArrayList<Long>`, and `ArrayList<String>`, plus `reverse()` on
  `BooleanArray`. With stdin
  `4 dbca 5 -2 7 1 100000000000 -4 9 12 1.5 -2.0 3.5 0.5 beta alpha delta gamma` it prints
  `desc=7,-2 long=100000000000,-4 double=3.5,-2.0 chars=da flags=false,true list=7,-2 longList=100000000000,-4 strings=gamma,alpha`.
- The browser-compatible probe also compiles `fixtures/ps-array-list/Main.kt`, which exercises
  `ArrayList<Int>` construction, `add`, index get/set, `size`, `isEmpty`, and `sort()` by lowering
  to `java.util.ArrayList<Integer>` plus `java.util.Collections.sort`. With stdin `4 5 1 4 1` it
  prints `list=1,6 size=5 sum=17 empty=false`.
- The browser-compatible probe also compiles `fixtures/ps-int-list-array/Main.kt`, which exercises
  graph-style `Array<ArrayList<Int>>` construction with `Array(n) { ArrayList<Int>() }`, function
  parameters, `graph[u].add(v)`, nested index access, `first`, `removeAt`, element replacement,
  `size`, and `in`/`!in` by lowering to a `java.util.ArrayList<Integer>[]`. With stdin
  `4 3 0 1 1 2 2 3` it prints
  `adj=4,2,2 first=4 removed=1 total=32 flags=true,true tail=9,10`.
- The browser-compatible probe also compiles `fixtures/ps-pair-list-array/Main.kt`, which exercises
  weighted-graph `Array<ArrayList<Pair<Int, Int>>>` construction with
  `Array(n) { ArrayList<Pair<Int, Int>>() }`, function parameters, `graph[u].add(Pair(v, w))`,
  nested pair index access, `first`, `removeAt`, element replacement, `size`, and `in`/`!in` by
  lowering to a `java.util.ArrayList<AbstractMap.SimpleEntry<Integer, Integer>>[]`. With stdin
  `4 3 0 1 5 1 2 7 2 3 11` it prints
  `weighted=4,2,2 first=4,1 removed=1,8 total=398 flags=true,true tail=9,10|11,12`.
- The browser-compatible probe also compiles `fixtures/ps-priority-queue/Main.kt`, which exercises
  `PriorityQueue<Int>` construction, `add`, `offer`, `peek`, `poll`, `size`, and `isEmpty` by
  lowering to `java.util.PriorityQueue<Integer>`. With stdin `5 3 1 4 1 5` it prints
  `pq=74 count=6 size=0`.
- The browser-compatible probe also compiles `fixtures/ps-pair-priority-queue/Main.kt`, which
  exercises `PriorityQueue<Pair<Int, Int>>` construction, `add`, `offer`, `peek`, `poll`, `contains`,
  `remove`, `size`, `isEmpty`, and `in`/`!in` by lowering to a packed
  `java.util.PriorityQueue<Long>` ordered by signed `(first, second)`. Running the generated class
  prints
  `pairPq=4 peek=-1,8 first=-1,8 second=3,4 third=0,-10 score=807 flags=true,true,true,true empty=true size=0`.
- The browser-compatible probe also compiles `fixtures/ps-pair-priority-queue-compareby/Main.kt`,
  which exercises `PriorityQueue<Pair<Int, Int>>(compareBy { it.second })` and
  `compareBy { it.first }` construction by applying the comparator intent to the packed `Long`
  ordering. `it.second` orders by signed `(second, first)`, while `it.first` keeps signed
  `(first, second)`. Running the generated class prints
  `pairPqSecond=4 peek=-3,-1 first=-3,-1 second=2,-1 third=-5,0 score=112 flags=true,true,true,true empty=true size=0 firstOrder=1,99`.
- The browser-compatible probe also compiles `fixtures/ps-long-int-pair-priority-queue/Main.kt`,
  which exercises Dijkstra-style `PriorityQueue<Pair<Long, Int>>` construction, function
  parameters and returns, `add`, `offer`, `peek`, `poll`, `contains`, `remove`, `size`,
  `isEmpty`, and `in`/`!in`. It lowers queue entries to fixed-width signed-order string keys and
  decodes `peek`/`poll` back to `Pair<Long, Int>`. With stdin `100000000000 10` it prints
  `longIntPq=5 peek=-100000000000,9 first=-100000000000,9 second=99999999990,1 third=99999999990,2 fourth=100000000010,3 flags=true,true,true empty=true size=0`.
- The browser-compatible probe also compiles `fixtures/ps-long-priority-queue/Main.kt`, which
  exercises `PriorityQueue<Long>` construction, `add`, `offer`, `peek`, `poll`, `size`, `isEmpty`,
  and `in`/`!in` by lowering to `java.util.PriorityQueue<Long>`. With stdin `100000000000 7` it
  prints `longPq=7,7,99999999993 more=0 flags=true,true empty=false,false size=1,2`.
- The browser-compatible probe also compiles `fixtures/ps-array-deque/Main.kt`, which exercises
  `ArrayDeque<Int>` construction, `addFirst`, `addLast`, `offer`, `offerFirst`, `offerLast`,
  `first`, `last`, `getFirst`, `getLast`, `poll`, `pollLast`, `removeFirst`, `removeLast`, `size`,
  and `isEmpty` by lowering to `java.util.ArrayDeque<Integer>`. With stdin `4 2 7 1 5` it prints
  `deque=52 edge=19 removed=100 tail=5 count=5 size=0`.
- The browser-compatible probe also compiles `fixtures/ps-long-array-deque/Main.kt`, which exercises
  `ArrayDeque<Long>` construction, `add`, `addFirst`, `addLast`, `offer`, `offerFirst`,
  `offerLast`, `first`, `last`, `getFirst`, `getLast`, `peek`, `peekFirst`, `peekLast`, `poll`,
  `pollFirst`, `pollLast`, `removeFirst`, `removeLast`, `size`, `isEmpty`, and `in`/`!in` by
  lowering to `java.util.ArrayDeque<Long>`. With stdin `100000000000 7` it prints
  `longDeque=0,100000000014 peek=0,100000000014 removed=0,7,100000000014,100000000007,100000000000 edge=100000000000,100000000007 flags=true,true empty=false,false size=1,2 more=7,100000000000`.
- The browser-compatible probe also compiles `fixtures/ps-pair-array-deque/Main.kt`, which exercises
  BFS-style `ArrayDeque<Pair<Int, Int>>` construction, `add`, `addFirst`, `addLast`, `offer`,
  `offerFirst`, `offerLast`, `peek`, `poll`, `pollLast`, `removeFirst`, `first`, `last`, `size`,
  `isEmpty`, `in`/`!in`, and Pair destructuring by lowering to
  `java.util.ArrayDeque<AbstractMap.SimpleEntry<Integer, Integer>>`. With stdin `5` it prints
  `pairDeque=298 peek=4,5 first=4,5 last=7,8 edge=9,1|2,8 flags=true,true size=0`.
- The browser-compatible probe also compiles `fixtures/ps-mixed-pair-array-deque/Main.kt`, which
  exercises `ArrayDeque<Pair<Int, Long>>` and `ArrayDeque<Pair<Long, Int>>` construction, `add`,
  `addFirst`, `addLast`, `offer`, `offerFirst`, `offerLast`, `peek`, `peekFirst`, `poll`,
  `pollLast`, `removeFirst`, `first`, `last`, `getFirst`, `getLast`, `size`, `isEmpty`,
  `in`/`!in`, and Pair destructuring by lowering to
  `java.util.ArrayDeque<AbstractMap.SimpleEntry<...>>`. With stdin `100000000000 7` it prints
  `mixedPairDeque=300000000031,300000000047 weighted=6,99999999993|1,2|3,4 state=99999999993,6|5,6|7,8 flags=true,true,true,true size=0,0`.
- The browser-compatible probe also compiles `fixtures/ps-long-long-pair-array-deque/Main.kt`, which
  exercises `ArrayDeque<Pair<Long, Long>>` construction, `add`, `addFirst`, `addLast`, `offer`,
  `offerFirst`, `offerLast`, `peek`, `poll`, `pollLast`, `removeFirst`, `getFirst`, `getLast`,
  `size`, `isEmpty`, `in`/`!in`, and Pair destructuring by lowering to
  `java.util.ArrayDeque<AbstractMap.SimpleEntry<Long, Long>>`. With stdin `100000000000 7` it
  prints `longLongPairDeque=600000000017 peek=99999999993,99999999986 first=99999999993,99999999986 last=100000000007,100000000014 edge=1,2|3,4 flags=true,true size=0`.
- The browser-compatible probe also compiles `fixtures/ps-hash-set/Main.kt`, which exercises
  `HashSet<Int>` and `mutableSetOf<Int>()` construction, `add`, `contains`, `remove`, `clear`,
  `size`, and `isEmpty` by lowering to `java.util.HashSet<Integer>`. With stdin `5 1 2 1 3 2` it
  prints `set=2,true had=true removed=true missing=false empty=true`.
- The browser-compatible probe also compiles `fixtures/ps-long-set/Main.kt`, which exercises
  `HashSet<Long>` and `mutableSetOf<Long>()` construction, `add`, `contains`, `remove`, `clear`,
  `size`, `isEmpty`, and `in`/`!in` by lowering to `java.util.HashSet<Long>`. With stdin
  `100000000000 7` it prints
  `longSet=0,2 flags=true,true,true,true,false,true empty=true,false`.
- The browser-compatible probe also compiles `fixtures/ps-string-set/Main.kt`, which exercises
  `HashSet<String>`, `MutableSet<String>` parameters, and `mutableSetOf<String>()` construction,
  `add`, `contains`, `remove`, `clear`, `size`, `isEmpty`, and `in`/`!in` by lowering to
  `java.util.HashSet<String>`. With stdin `Alpha beta` it prints
  `stringSet=0,2 count=2 flags=true,true,true,true,false,true empty=true,false`.
- The browser-compatible probe also compiles `fixtures/ps-string-list/Main.kt`, which exercises
  `ArrayList<String>`, `MutableList<String>` parameters, and `mutableListOf<String>()` construction,
  `add`, indexed `add`, index get/set, `sort`, `first`, `last`, `removeAt`, `remove`, `clear`,
  `size`, `isEmpty`, and `in`/`!in` by lowering to `java.util.ArrayList<String>`. With stdin
  `go lang` it prints
  `stringList=0,2 count=2 first=GO last=LANG removed=lang,true sorted=LANG,lang flags=true,true empty=true extra=lang,GO`.
- The browser-compatible probe also compiles `fixtures/ps-string-int-map/Main.kt`, which exercises
  `HashMap<String, Int>`, `MutableMap<String, Int>` parameters, and `mutableMapOf<String, Int>()`
  construction, `map[key]`, `map[key] = value`, `put`, `get`, `getOrDefault`, `containsKey`,
  `remove`, `clear`, `size`, `isEmpty`, and `in`/`!in` by lowering to
  `java.util.HashMap<String, Integer>`. With stdin `go lang` it prints
  `stringMap=0,2 first=1 second=2 value=3 removed=1 fallback=-7 flags=true,true,true empty=true,false more=-6,3`.
- The browser-compatible probe also compiles `fixtures/ps-string-long-map/Main.kt`, which exercises
  `HashMap<String, Long>`, `MutableMap<String, Long>` parameters, and `mutableMapOf<String, Long>()`
  construction, `map[key]`, `map[key] = value`, `put`, `get`, `getOrDefault`, `containsKey`,
  `remove`, `clear`, `size`, `isEmpty`, and `in`/`!in` by lowering to
  `java.util.HashMap<String, Long>`. With stdin `go lang 100000000000 7` it prints
  `stringLongMap=0,2 first=100000000000 second=100000000007 value=100000000014 removed=7 fallback=-11 flags=true,true,true empty=true,false more=-4,100000000014`.
- The browser-compatible probe also compiles `fixtures/ps-hash-map/Main.kt`, which exercises
  `HashMap<Int, Int>` and `mutableMapOf<Int, Int>()` construction, `map[key]`, `map[key] = value`,
  `put`, `getOrDefault`, `containsKey`, `remove`, `clear`, `size`, and `isEmpty` by lowering to
  `java.util.HashMap<Integer, Integer>`. With stdin `7 1 2 1 3 2 2 3` it prints
  `map=3 removed=2 after=-1 had=true extra=3 empty=true size=0`.
- The browser-compatible probe also compiles `fixtures/ps-int-long-map/Main.kt`, which exercises
  `HashMap<Int, Long>` and `mutableMapOf<Int, Long>()` construction, `map[key]`,
  `map[key] = value`, `put`, `get`, `getOrDefault`, `containsKey`, `remove`, `clear`, `size`,
  `isEmpty`, and `in`/`!in` by lowering to `java.util.HashMap<Integer, Long>`. With stdin
  `3 100000000000 7` it prints
  `intLongMap=0,2 value=100000000007 removed=7 fallback=-5 flags=true,true empty=true,false more=2,100000000007`.
- The browser-compatible probe also compiles `fixtures/ps-long-int-map/Main.kt`, which exercises
  `HashMap<Long, Int>` and `mutableMapOf<Long, Int>()` construction, `map[key]`, `map[key] = value`,
  `put`, `get`, `getOrDefault`, `containsKey`, `remove`, `clear`, `size`, `isEmpty`, and
  `in`/`!in` by lowering to `java.util.HashMap<Long, Integer>`. With stdin `100000000000 7` it
  prints `longMap=0,2 value=3 removed=2 fallback=-7 flags=true,true,true empty=true,false more=-5,3`.
- The browser-compatible probe also compiles `fixtures/ps-long-long-map/Main.kt`, which exercises
  `HashMap<Long, Long>` and `mutableMapOf<Long, Long>()` construction, `map[key]`, `map[key] = value`,
  `put`, `get`, `getOrDefault`, `containsKey`, `remove`, `clear`, `size`, `isEmpty`, and `in`/`!in`
  by lowering to `java.util.HashMap<Long, Long>`. With stdin `100000000000 7` it prints
  `longLongMap=0,2 value=200000000000 removed=99999999993 fallback=-9 flags=true,true,true empty=true,false more=99999999984,200000000000`.
- The browser-compatible probe also compiles `fixtures/ps-in-operator/Main.kt`, which exercises
  `in`/`!in` for `Int` ranges, `String`/`Char` in `String`, `String` in `String`, and membership in
  the verified `Int` collection/map shapes above. With stdin `4 1 2 3 2 algorithmgo` it prints
  `in=131071 size=3,3`.
- The browser-compatible probe also compiles `fixtures/ps-scalar-collection-methods/Main.kt`, which
  exercises direct scalar `contains`/`remove` method calls on `ArrayList<Int>`, `PriorityQueue<Int>`,
  `ArrayDeque<Int>`, `PriorityQueue<Long>`, and `ArrayList<String>`, plus `clear` on scalar list,
  queue, and deque shapes. It prints
  `methods=list=true,true,false,1 queue=true,true,7,1 deque=true,true,5,1 long=true,true,100000000000,1 words=true,true,1 clear=true,true,0,true,0`.
- The browser-compatible probe also compiles `fixtures/ps-string-api/Main.kt`, which exercises
  `String.substring`, `startsWith`, `endsWith`, `contains` with `String` and `Char`, `indexOf`,
  `lastIndexOf`, `trim`, `lowercase`, and `uppercase`. With stdin `algorithmgo` it prints
  `str=algor|ithmgo|orithm idx=3,2,9 score=15 case=kotlingo/KOTLINGO`.
- The browser-compatible probe also compiles `fixtures/ps-array-in/Main.kt`, which exercises
  `in`/`!in` membership on `IntArray`, `LongArray`, `DoubleArray`, `CharArray`, and `BooleanArray`
  by emitting direct primitive-array scan loops. With stdin `banana` it prints
  `arrayIn=1023 size=3,6`.
- The browser-compatible probe also compiles `fixtures/ps-pair-int/Main.kt`, which exercises
  limited `Pair<Int, Int>` construction, `.first`, `.second`, and function return values by lowering
  to `java.util.AbstractMap.SimpleEntry<Integer, Integer>`. With stdin `3 4` it prints
  `pair=3,4 combined=10,24 diff=14`.
- The browser-compatible probe also compiles `fixtures/ps-long-long-pair/Main.kt`, which exercises
  `Pair<Long, Long>` construction, `.first`, `.second`, function return values, and destructuring by
  lowering to `java.util.AbstractMap.SimpleEntry<Long, Long>`. With stdin `100000000000 7` it prints
  `longPair=100000000000,100000000007 shifted=100000000000,100000000007 tail=100000000014 direct=-100000000000,100000000014`.
- The browser-compatible probe also compiles `fixtures/ps-pair-destructuring/Main.kt`, which
  exercises `val (a, b) = ...` destructuring for `Pair<Int, Int>`, `Pair<Int, Long>`, and
  `Pair<Long, Int>` values from direct construction, `PriorityQueue.poll()`, list indexing, and
  graph-list indexing. With stdin `100000000000 7` it prints
  `destructure=7,9|8,100000000007|-100000000000,9 tail=3 graph=16,100000000010`.
- The browser-compatible probe also compiles `fixtures/ps-foreach-pair/Main.kt`, which exercises
  `for (x in ...)` lowering over primitive arrays, `String`, and `ArrayList` values, plus
  `for ((v, w) in graph[u])`-style Pair destructuring over `ArrayList<Pair<Int, Long>>`,
  `ArrayList<Pair<Long, Int>>`, and `Array<ArrayList<Pair<Int, Int>>>`. With stdin
  `100000000000 7` it prints
  `foreach=24,200000000007,1,21 pair=200000000010 state=200000000007 graph=45 text=4`.
- The browser-compatible probe also compiles `fixtures/ps-pair-list/Main.kt`, which exercises
  `ArrayList<Pair<Int, Int>>` and `mutableListOf<Pair<Int, Int>>()` construction, `add`, index
  get/set, `.first`, `.second`, `in`/`!in`, `contains`, `remove`, `size`, and `isEmpty` by storing
  `java.util.AbstractMap.SimpleEntry<Integer, Integer>` values in `java.util.ArrayList`. With stdin
  `2 1 2 3 4` it prints
  `pairs=13,24|2,1 score=186 flags=true,true,true,true empty=false size=2`.
- The browser-compatible probe also compiles `fixtures/ps-int-long-pair-list/Main.kt`, which
  exercises `ArrayList<Pair<Int, Long>>` and `mutableListOf<Pair<Int, Long>>()` construction,
  `Array<ArrayList<Pair<Int, Long>>>`, function returns, indexed get/set, `.first`, `.second`,
  `in`/`!in`, `contains`, `remove`, `removeAt`, `first()`, `last()`, `clear()`, `size`, and
  `isEmpty` by storing
  `java.util.AbstractMap.SimpleEntry<Integer, Long>` values in `java.util.ArrayList`. With stdin
  `100000000000 7` it prints
  `intLongPairs=1,7|6,100000000000 removed=13,100000000007 flags=true,true,true,true graph=100000000007 empty=true size=0,2`.
- The browser-compatible probe also compiles `fixtures/ps-long-int-pair-list/Main.kt`, which
  exercises `ArrayList<Pair<Long, Int>>` and `mutableListOf<Pair<Long, Int>>()` construction,
  `Array<ArrayList<Pair<Long, Int>>>`, function parameters, indexed get/set, `.first`, `.second`,
  `in`/`!in`, `contains`, `remove`, `removeAt`, `first()`, `last()`, `size`, and `isEmpty` by
  storing `java.util.AbstractMap.SimpleEntry<Long, Integer>` values in `java.util.ArrayList`.
  With stdin `100000000000 7` it prints
  `longIntPairs=100000000000,2|99999999993,1 removed=-100000000000,9 flags=true,true,true graph=200000000011 total=100000000000 empty=false size=1,2`.
- The browser-compatible probe also compiles `fixtures/ps-long-long-pair-list/Main.kt`, which
  exercises `ArrayList<Pair<Long, Long>>` and `mutableListOf<Pair<Long, Long>>()` construction,
  `Array<ArrayList<Pair<Long, Long>>>`, indexed get/set, `.first`, `.second`, `in`/`!in`,
  `contains`, `remove`, `removeAt`, `indices`, `first()`, `last()`, `reverse`, `clear`, `size`,
  `isEmpty`, and Pair destructuring by storing `java.util.AbstractMap.SimpleEntry<Long, Long>`
  values in `java.util.ArrayList`. With stdin `100000000000 7` it prints
  `longLongPairList=400000000068 first=100000000007,100000000014 last=100000000007,100000000014 removed=99999999993,99999999986 head=100000000007,100000000014 tail=100000000007,100000000014 edge=5,6 rev=7,8 flags=true,true,true,true size=2,1,0`.
- The browser-compatible probe also compiles `fixtures/ps-list-helpers/Main.kt`, which exercises
  `MutableList<Int>` and `ArrayList<Pair<Int, Int>>` stack/list helpers: indexed `add`,
  `removeAt`, `first()`, `last()`, `clear()`, `size`, and `isEmpty`. With stdin `5 9` it prints
  `list=5,9 removed=3 pair=3,4|5,6 removedPair=1,2 empty=true,true size=0,0`.
- The browser-compatible probe also compiles `fixtures/ps-long-list/Main.kt`, which exercises
  `MutableList<Long>` and `ArrayList<Long>` construction, `add`, indexed `add`, index get/set,
  `sort()`, `first()`, `last()`, `removeAt`, `remove`, `in`/`!in`, `clear`, `size`, and `isEmpty`
  by lowering to `java.util.ArrayList<Long>`. With stdin `100000000000 7` it prints
  `longList=7,100000000007 removed=100000000000,true sorted=99999999993,100000000014 flags=true,true empty=true extra=7 size=0,2`.
- The browser-compatible probe also compiles `fixtures/ps-double-math/Main.kt`, which exercises
  numeric `toInt`/`toLong`/`toDouble` conversions and `sqrt`, `floor`, `ceil`, and `pow` by lowering
  to JVM numeric conversion opcodes and `java.lang.Math`. With stdin `16 100000000000 2.5` it
  prints `math=4,64 low=2 high=3 mix=100000000004`.
- This is not a full Kotlin/JVM backend yet. The browser path is currently a minimal emitter that
  supports the verified fixture shapes above. It does not yet support enough Kotlin for real
  competitive-programming use: full collections and common library helpers, classes/data classes,
  lambdas, generics, broader library calls, and stable classpath jar reads are still missing.
- Full Kotlin backend restoration is still blocked by Kotlin builtins deserialization in the TeaVM
  runtime: the `.kotlin_builtins` resource is readable, but `DefaultBuiltIns.getUnitType()` still
  reports that `kotlin.Unit` is missing. Virtual classpath jar reads also still warn with
  `NullPointerException`, so stable jar/class input remains unfinished.

See `docs/porting-plan.md` for the next patch targets.
