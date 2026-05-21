# Ruby Runtime Package

`@wasm-idle/runtime-ruby` wraps the CRuby WebAssembly packages published by `ruby.wasm`.

- runtime API package: `@ruby/wasm-wasi`
- default Ruby build package: `@ruby/3.4-wasm-wasi`
- default binary assets: `ruby.wasm`, `ruby+stdlib.wasm`, and `ruby.debug+stdlib.wasm`

The package exposes URL helpers for vendored Ruby assets and dynamic import helpers for the browser,
browser script, and Node entrypoints.

```bash
pnpm --dir runtimes/ruby run build
pnpm --dir runtimes/ruby run check
```
