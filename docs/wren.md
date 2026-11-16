# Wren

`WREN` runs the real upstream Wren 0.4.0 compiler and VM in a browser Worker using
WASI. The bundled VM sources are unchanged and pinned to
`4a18fc489f9ea3d253b20dd40f4cdad0d6bb40eb`; their MIT license and individual SHA-256
receipts are included under `runtimes/wasm-wren/`. No source is executed during preparation.
Every execution creates fresh WASI memory and VM state.

The host provides a synchronous `io` module:

```wren
import "io" for Stdin, Stdout

while (true) {
  var line = Stdin.readLine()
  if (line == null) break
  Stdout.print(line)
}
```

`Stdin.readLine()` returns a UTF-8 string without its trailing newline, removes a
CR before LF, and returns `null` at EOF. A final unterminated line is returned
before EOF. `Stdin.readByte()` returns a byte from 0 to 255, or `null` at EOF.
`Stdout.write(value)`, `Stdout.print(value)` and `Stdout.flush()` write through the
terminal. `System.print` remains the upstream VM implementation.
The terminal is a stream (`isTerminal` and `isRaw` are false).

These are synchronous host bindings: waiting for stdin pauses the Worker, including
other Wren fibers. Core fibers, classes, closures, collections and the optional
`random` and `meta` modules use their original VM implementations. This host does
not include wren-cli's libuv scheduler, timers, raw-terminal mode, filesystem API or
process APIs. Program arguments are not supported.

Workspace imports load `.wren` files relative to the importing module. Paths are
normalized so equivalent imports share one module, and imports cannot traverse
above the workspace root. For example, `import "./lib/value" for Value` loads
`lib/value.wren` alongside the active source. Files live in the in-memory WASI
workspace and do not access the user's filesystem.

Shared terminal input supports delayed chunks and EOF. The common WASI sandbox
enforces asset, workspace, output and time limits and terminates its Worker for
cancellation. The module has a 256 MiB memory ceiling and a 1 MiB C stack.
`System.clock` uses WASI's wall-clock emulation because browsers do not provide
process CPU time.

Rebuild with wasi-sdk 33.0:

```sh
WASI_SDK_PATH=/path/to/wasi-sdk-33 pnpm run build:wasm-wren
pnpm run sync:wasm-wren
pnpm run assets:lock
pnpm run test:browser:wren
```

The build script verifies every vendored upstream source receipt, records the host
hash, compiler and flags, and generates the runtime profile. The small runtime
bundle is committed; normal site builds verify it without downloading a toolchain.
