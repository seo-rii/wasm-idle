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

### ARCH-002: Patch JVM management/performance APIs

Kotlin's CLI performance machinery can reach thread CPU time and related management APIs. Patch
`PerformanceManager` methods to no-op or call through only the user-supplied callback.

### ARCH-003: Replace unavailable JDK APIs

The compiler distribution reaches `java.desktop`, `java.instrument`, `java.management`,
`java.scripting`, `jdk.compiler`, and `jdk.unsupported`. Each package must either be proven
unreachable from the browser compile path or replaced with a TeaVM-compatible stub.

### TEST-001: Define a minimal success case

The first usable artifact should compile this program to a jar or class files:

```kotlin
fun main() {
    println("hi")
}
```

Do not wire this into wasm-idle's UI until that minimal compile path works and can be run repeatedly
without multi-minute, multi-gigabyte rebuilds.
