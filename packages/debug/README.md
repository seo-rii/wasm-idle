# @wasm-idle/debug

Optional debugger UI, session controller, expression helpers, language adapters, and Monaco editor
integration for wasm-idle. Install it separately in applications that provide debugging:

```bash
pnpm add @wasm-idle/debug
```

The Monaco integration is available from `@wasm-idle/debug/editor`; `monaco-editor` is an optional
peer dependency. This package contains code only and includes no runtime, compiler, WebAssembly, or
toolchain assets.

Debug execution is exposed through one adapter contract:

- `TraceDebugAdapter` preserves the existing source-instrumentation controls.
- `LldbDapAdapter` maps standard DAP threads, frames, scopes, lazy variables, breakpoints, stepping,
  memory reads, output, and process lifecycle events.

`createAdapterDebugSessionController()` provides the shared view model. Variable children remain
lazy through `variablesReference`; consumers should not serialize an entire LLDB variable tree.
Supply an LLDB DAP session from `@wasm-idle/llvm-core/debug`. Runtime assets remain owned by the
`wasm-llvm` producer and are deliberately excluded from this package.

LLDB pause, frame, and breakpoint events carry the SHA-256 of the compiled source when the artifact
provides it. Hosts should call `markSourceRevisionStale(sourcePath)` when an editor model changes
during an active session. The controller keeps execution controls available but clears the paused
line for that source and exposes `sourceRevisionStale`, preventing a valid DWARF location from being
drawn against newer text.
