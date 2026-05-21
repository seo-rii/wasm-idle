# Kotlin Runtime Package

`@wasm-idle/runtime-kotlin` wraps Kotlin/Wasm build metadata and generated browser asset loading.

Kotlin/Wasm is produced by the Kotlin Gradle plugin rather than by an npm-hosted browser compiler.
This package therefore centralizes:

- Gradle task command construction for `wasmJs` browser distributions
- generated `.mjs`/`.wasm` asset manifests
- dynamic import access to JetBrains `kotlin-web-helpers`

```bash
pnpm --dir runtimes/kotlin run build
pnpm --dir runtimes/kotlin run check
```
