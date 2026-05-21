# Eval in WASM

A textarea-based code runner using Popcorn. Type Elixir or Erlang code and run it fully in the browser via WebAssembly.

## Usage

From the repository root:

```bash
pnpm install
mise run dev --example eval-in-wasm
```

or directly from the example directory:

```bash
mix dev
```

and visit [localhost:4000](http://localhost:4000)

The page can be served by any other HTTP server as well, but it must add the following response headers:

```
Cross-Origin-Opener-Policy: "same-origin"
Cross-Origin-Embedder-Policy: "require-corp"
```

for the WASM runtime to work.

## wasm-idle usage

This directory is vendored from Popcorn `v0.2.2` so the browser Elixir AVM bundle can be rebuilt
from source instead of only storing `static/wasm-elixir/bundle.avm`.

```bash
pnpm --dir runtimes/wasm-elixir run bundle
pnpm sync:wasm-elixir
```

See `UPSTREAM.md` for the exact upstream repository, tag, commit, and vendored dependency layout.
