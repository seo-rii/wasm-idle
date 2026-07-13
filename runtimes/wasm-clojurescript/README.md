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
`dist/runtime-build.json`. `pnpm run sync:wasm-clojurescript` copies these assets and the runtime
worker into `static/wasm-clojurescript`.

Programs can require `[wasm-idle.runtime :as runtime]`. The namespace exposes `read-line`, `stdin`,
and `args`. Workspace `.cljs` and `.cljc` namespaces can be required by their namespace name.
