# wasm-kotlin-jvm browser patch

This directory contains the small JVM class patch required to run the Kotlin/JVM compiler inside
CheerpJ under browser isolation. CheerpJ 4.3 does not support the thread CPU-time API used by
Kotlin's performance manager, so the patch shadows `org.jetbrains.kotlin.util.PerformanceManager`
with no-op performance accounting while leaving normal compilation behavior intact.

The browser runtime itself is not vendored here. CheerpJ self-hosting requires a suitable CheerpJ
license, so use `pnpm run sync:wasm-kotlin-jvm` with a licensed CheerpJ runtime directory and a
Kotlin compiler distribution to populate ignored local assets under `static/`.
