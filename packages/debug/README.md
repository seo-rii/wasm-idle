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

The playground-facing controller also exposes `readMemory(memoryReference, offset, count)` while
the target is paused. `DebugMemory` crosses the framework-neutral Sandbox and Terminal contracts
as a `Uint8Array`; browser automation and other serialization boundaries should explicitly convert
that array to plain byte values instead of relying on implicit typed-array serialization.

LLDB pause, frame, and breakpoint events carry the SHA-256 of the compiled source when the artifact
provides it. Hosts should call `markSourceRevisionStale(sourcePath)` when an editor model changes
during an active session. This includes non-selected workspace sources that are added, replaced, or
removed through a programmatic workspace update; compare the complete replacement against the
session workspace instead of tracking only the active editor model. The controller keeps execution
controls available but clears the paused line for that source and exposes `sourceRevisionStale`,
preventing a valid DWARF location from being drawn against newer text.

Command serialization also treats a runtime `pause` event as completion of the command that resumed
the target. Locks are versioned so a late `continue` promise cannot unlock a newer step request;
hosts may therefore issue the next step as soon as the stopped state is published.

When a selected LLDB stack frame names another `/workspace/...` source, the host should await
`selectFrame()`, open the matching workspace file, and then update the controller source path. This
keeps the Monaco model, selected frame, paused line, and per-source revision state synchronized.
