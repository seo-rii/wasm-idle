# wasm-idle Instructions

- New language support must run the real language implementation in the browser, normally through a
  WebAssembly compiler, interpreter, or runtime.
- Do not add handwritten parsers, translators, emulators, or subset executors as language support.
- New language support must include stdin/stdout coverage, including browser-path tests when the
  runtime is exposed through the web playground.
