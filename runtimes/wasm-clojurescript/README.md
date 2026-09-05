# wasm-clojurescript

This runtime packages the official ClojureScript `cljs.js` self-hosted compiler for a classic
Web Worker. User programs are compiled and evaluated in the browser; the server is not involved in
execution.

The build pins ClojureScript 1.12.134, Clojure CLI 1.12.4.1618, and Temurin JDK 21.0.11+10. On
Linux x64, run:

```sh
pnpm --filter @wasm-idle/runtime-clojurescript build
```

The first build downloads the pinned JDK and Clojure CLI archives and resolves the pinned Maven
dependency graph. It writes `dist/compiler.js`, `dist/LICENSE.txt`, and
`dist/runtime-build.json`. The producer rewrites embedded checkout paths to the stable
virtual root `/wasm-idle/runtimes/wasm-clojurescript`. This removes machine-local paths, but
Closure's line wrapping can still differ with the original checkout path length, so a locally
rebuilt compiler is not automatically a replacement for the release snapshot.

`pnpm run sync:wasm-clojurescript` refreshes the checked-in snapshot in
`static/wasm-clojurescript` and the current runtime worker. It decompresses `compiler.js.gz.bin`
with the input lock's size bound, then verifies the compiler, build metadata, and license against
`scripts/wasm-clojurescript-assets.lock.json` before replacing any output. It does not use an ignored
`dist/` cache or rebuild the compiler during deployment. Missing or corrupt snapshot files fail
closed; restore them from the intended release commit. This changes neither the pinned toolchain
nor the compiler binary.

To intentionally ingest a producer build, pass its source directory explicitly:

```sh
pnpm run sync:wasm-clojurescript runtimes/wasm-clojurescript/dist
```

Explicit inputs must match the same input lock and never fall back to the installed snapshot.

Programs can require `[wasm-idle.runtime :as runtime]`. The namespace exposes `read-line`, `stdin`,
and `args`. Workspace `.cljs` and `.cljc` namespaces can be required by their namespace name.
