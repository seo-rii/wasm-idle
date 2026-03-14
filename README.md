## wasm-idle

![wasm-idle](static/image.jpeg)

Executes C++, Python, and Java code with working stdio.

Refer to src/lib/clang.

Java uses TeaVM's browser compiler/runtime. TeaVM compiler/runtime/classlib assets are bundled under `static/teavm/` by default, and the asset base URL can be overridden with `PUBLIC_TEAVM_BASE_URL`.

Powered by [wasm-clang](https://github.com/binji/wasm-clang), Pyodide, and TeaVM.
