# Upstream Provenance

This runtime vendors the Popcorn `eval-in-wasm` example source that produced the
browser Elixir `bundle.avm` used by `wasm-idle`.

- Upstream repository: `https://github.com/software-mansion/popcorn.git`
- Upstream tag: `v0.2.2`
- Upstream commit: `c5d8f183a6d61416bf60272bf5ad7ea2215c2a65`
- Vendored source: `examples/eval-in-wasm`
- Vendored build dependency: `popcorn/elixir`

The `AtomVM.mjs` and `AtomVM.wasm` files in `static/wasm-elixir/` are copied from
the locked npm package `@swmansion/popcorn@0.2.2`.

To rebuild and publish the static runtime assets:

```bash
pnpm --dir runtimes/wasm-elixir run bundle
pnpm sync:wasm-elixir
```
