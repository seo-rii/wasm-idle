(require '[cljs.build.api :as build])

(build/build
  "src"
  {:main 'wasm-idle.runner
   :target :webworker
   :optimizations :simple
   :output-to "dist/compiler.js"
   :output-dir "dist/out"
   :asset-path "out"
   :pretty-print false
   :optimize-constants true
   :static-fns true
   :preloads []})
