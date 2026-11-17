# Smalltalk (Amber)

`SMALLTALK` runs the original Amber 0.32.0 Smalltalk compiler, chunk importer and
kernel in a disposable browser Worker. The pinned npm source archive is packaged
offline with the unmodified RequireJS 2.3.8 AMD loader. Source is passed unchanged
to Amber's `Importer`; class and method definitions, blocks, collections and
compiler errors retain Amber semantics. This is the Amber dialect, not a GNU
Smalltalk image. The editor uses plain text and `.st` selects this runtime.

Use Amber's standard chunk/file-in format, including `!` chunk terminators:

```smalltalk
| line |
line := Stdin nextLine.
line ifNotNil: [Stdout nextPutAll: line; cr]!
```

The host installs these globals through Amber's original `JSObjectProxy`:

| Global | API |
| --- | --- |
| `Stdin` | `nextLine` returns a UTF-8 line without its LF/CRLF, or `nil` at EOF; `nextByte` returns 0–255 or `nil`; `upToEnd` reads UTF-8 through EOF |
| `Stdout`, `Stderr` | `nextPutAll:`, `cr`, `flush`; output is emitted immediately |
| `Arguments` | An Amber-compatible array of `programArgs` strings |
| `Files` | `readText: 'path'` reads a workspace text file; `fileIn: 'path'` loads it with the original Amber importer |

`Transcript` retains Amber's original console transcript behavior, routed to
stdout. In particular, each `show:` invokes the original console logger and adds
a newline; use `Stdout` for exact stream formatting.

`stdin` supplies buffered input and EOF; omitting it enables delayed interactive
input through the normal terminal/shared ring. A final partial line is returned
before EOF. Workspace paths are relative to the workspace root, never the host
filesystem. `activePath` defaults to `main.st`. Compiler flags are fixed; use
`programArgs` for `Arguments`. Each run gets a fresh VM and class namespace.

The host verifies source/worker sizes and SHA-256 receipts, bounds asset delivery,
workspace and output, and supports timeout, cancellation and recovery. Amber uses
the JavaScript heap; `maxWasmMemoryBytes` cannot cap that heap. Native OS processes,
native Smalltalk images, DOM integration, and arbitrary disk files are unavailable.
Amber's own JavaScript interoperability remains part of its language; this runtime
provides the same browser Worker trust boundary as the other script runtimes.

Run `pnpm run sync:wasm-smalltalk` to regenerate the distribution entirely from
the vendored archives; add `-- --check` to verify it without writing. Producer
inputs, exact versions, archive hashes, and original MIT notices live in
`runtimes/wasm-smalltalk`. `pnpm run test:browser:smalltalk` exercises the real
compiler, source, stdin/stdout, errors, limits, recovery and selector/terminal path.

The module source map is delivered as deterministic gzip with both compressed and
uncompressed sizes and SHA-256 receipts. The bounded preflight decodes and verifies
it before loading the compiler; it works without a service worker.
