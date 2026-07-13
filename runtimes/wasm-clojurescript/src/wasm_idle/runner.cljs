(ns wasm-idle.runner
  (:require [cljs.js :as cljs]
            [clojure.string :as string]))

(defonce compiler-state (cljs/empty-state))
(defonce current-context (atom nil))

(def runtime-source
  "(ns wasm-idle.runtime)
   (defn context [] (.-__wasmIdleCljsContext js/globalThis))
   (defn args [] (vec (array-seq (.-args (context)))))
   (defn stdin [] (.-stdin (context)))
   (defn read-line [] (.shift (.-stdinLines (context))))")

(defn load-source [{:keys [name path]} callback]
  (if (= name 'wasm-idle.runtime)
    (callback {:lang :clj :source runtime-source})
    (let [files (js->clj (.-files @current-context))
          candidates [path (str path ".cljs") (str path ".cljc")]
          source (or
                   (some #(get files %) candidates)
                   (some
                     (fn [[file-path source]]
                       (when (some #(string/ends-with? file-path (str "/" %)) candidates)
                         source))
                     files))]
      (if source
        (callback {:lang :clj :source source})
        (callback {:error (str "Could not load ClojureScript namespace " name)})))))

(defn error-message [error]
  (or (.-message error) (str error)))

(defn ^:export execute [source filename context callback]
  (reset! current-context context)
  (set! (.-__wasmIdleCljsContext js/globalThis) context)
  (let [stdout (atom [])
        stderr (atom [])
        previous-print *print-fn*
        previous-print-err *print-err-fn*
        previous-print-newline *print-newline*]
    (set! *print-fn* (fn [& values] (swap! stdout conj (apply str values))))
    (set! *print-err-fn* (fn [& values] (swap! stderr conj (apply str values))))
    (set! *print-newline* true)
    (cljs/eval-str
      compiler-state
      source
      filename
      {:eval cljs/js-eval
       :load load-source
       :context :expr
       :ns 'cljs.user}
      (fn [{:keys [error value]}]
        (set! *print-fn* previous-print)
        (set! *print-err-fn* previous-print-err)
        (set! *print-newline* previous-print-newline)
        (callback
          (clj->js
            (if error
              {:ok false
               :stdout (string/join "" @stdout)
               :stderr (string/join "" (conj @stderr (error-message error)))}
              {:ok true
               :stdout (string/join "" @stdout)
               :stderr (string/join "" @stderr)
               :value (pr-str value)})))))))
