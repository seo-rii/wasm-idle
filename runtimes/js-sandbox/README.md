# JavaScript Sandbox Runtime Package

`@wasm-idle/runtime-js-sandbox` wraps `quickjs-emscripten`, a QuickJS runtime compiled to
WebAssembly.

- package: `quickjs-emscripten`
- primary entry: `getQuickJS()`
- helper: `evaluateQuickJs(code, { timeoutMs, memoryLimitBytes })`

This runtime is separate from native browser JavaScript execution; it is intended for isolated,
resource-limited JavaScript evaluation inside a WebAssembly VM.

```bash
pnpm --dir runtimes/js-sandbox run build
pnpm --dir runtimes/js-sandbox run check
```
