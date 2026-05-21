# wasm-typescript

Browser-loadable JavaScript and TypeScript runner module for `wasm-idle`.

The package bundles the SWC TypeScript strip-only WASM transform and exposes a
small Node-like CommonJS execution environment. It intentionally supports only
the runtime surface needed by browser playground snippets: `require('fs')`,
`require('node:fs')`, `require('path')`, `process.argv`, `process.env`,
`Buffer`, and console output capture. TypeScript is not type-checked.

Builtin imports from `fs`, `path`, `process`, and `buffer` are lowered to the
same CommonJS shims before execution. General ESM imports are intentionally not
resolved by this single-file browser runner.

`fs.readLineSync(0)` is a playground convenience for reading one stdin line
after Enter. `fs.readFileSync('/dev/stdin', 'utf8')` and
`fs.readFileSync(0, 'utf8')` read from the host-provided stdin callback until
EOF.
