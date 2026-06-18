## wasm-idle

![wasm-idle](static/image.jpeg)

Executes C, C++, Python, Java, Rust, Go, D, C#, F#, VB.NET, Elixir, Erlang, Prolog,
Gleam, Perl, OCaml, TinyGo, JavaScript, TypeScript, AssemblyScript, WAT, Lua, Zig,
Scheme, Ruby, Haskell, R, Octave, SQLite, and PHP code.

Refer to src/lib/clang.

## Language support policy

wasm-idle language support must run user code through the real language implementation in the
browser, normally via a WebAssembly compiler, interpreter, or runtime. Do not add handwritten
parsers, translators, emulators, or "subset" executors as language support. A language should be
listed only after normal user code runs on that actual runtime and stdin/stdout behavior is covered
by tests.

## Support matrix

All entries run in the browser through real runtime, compiler, or interpreter implementations.
`Editor support` lists browser LSP/compiler diagnostics when wired; `syntax` means Monaco syntax
highlighting only. `Debug` means wasm-idle's trace/debug controls, not a native debugger.

| Language       | Browser runtime/compiler             | Stdin | Editor support       | Debug |
| -------------- | ------------------------------------ | ----- | -------------------- | ----- |
| C              | wasm-clang / Clang WASI              | Yes   | clangd               | -     |
| C++            | wasm-clang / Clang WASI              | Yes   | clangd               | Trace |
| Python         | Pyodide                              | Yes   | Python LSP           | Trace |
| Java           | TeaVM                                | Yes   | syntax               | -     |
| Rust           | wasm-rust / browser rustc            | Yes   | rustc diagnostics    | Trace |
| Go             | wasm-go / browser Go compiler        | Yes   | compiler diagnostics | Trace |
| D              | wasm-d                               | Yes   | syntax               | -     |
| C#             | wasm-dotnet                          | Yes   | compiler diagnostics | -     |
| F#             | wasm-dotnet                          | Yes   | compiler diagnostics | -     |
| VB.NET         | wasm-dotnet                          | Yes   | compiler diagnostics | -     |
| Elixir         | AtomVM / Popcorn                     | Yes   | syntax               | -     |
| Erlang         | AtomVM / Popcorn                     | Yes   | syntax               | -     |
| Prolog         | SWI-Prolog WASM worker               | Yes   | syntax               | -     |
| Gleam          | Gleam precompiled browser runtime    | Yes   | compiler diagnostics | -     |
| Perl           | Perl WASM worker                     | Yes   | syntax               | -     |
| OCaml          | wasm-of-js-of-ocaml / js_of_ocaml    | Yes   | syntax               | -     |
| TinyGo         | wasm-tinygo                          | Yes   | syntax               | -     |
| JavaScript     | wasm-typescript / TypeScript service | Yes   | TypeScript LSP       | -     |
| TypeScript     | wasm-typescript / TypeScript service | Yes   | TypeScript LSP       | -     |
| AssemblyScript | AssemblyScript compiler              | Yes   | AssemblyScript LSP   | -     |
| WAT            | WABT                                 | Yes   | WAT LSP              | -     |
| Lua            | Wasmoon                              | Yes   | syntax               | -     |
| Zig            | zig_small.wasm                       | Yes   | syntax               | -     |
| Scheme         | Puppy Scheme / wasm-lisp             | Yes   | syntax               | -     |
| Ruby           | CRuby WASI                           | Yes   | syntax               | -     |
| Haskell        | ghc-in-browser                       | Yes   | syntax               | -     |
| R              | WebR                                 | Yes   | syntax               | -     |
| Octave         | wasm-octave                          | Yes   | syntax               | -     |
| SQLite         | sql.js                               | n/a   | syntax               | -     |
| PHP            | php-wasm                             | Yes   | syntax               | -     |

## Monorepo layout

`wasm-idle` is now managed as a pnpm workspace. The existing sibling repositories are intentionally
left in place, but the default development path is inside this repo:

- `packages/core`: framework-neutral contracts, runtime asset keys, progress helpers, and playground
  binding helpers.
- `packages/svelte`: Svelte store/binding helpers around `@wasm-idle/core`.
- `packages/react`: React hooks around `@wasm-idle/core`.
- `packages/vue`: Vue composables around `@wasm-idle/core`.
- `packages/node`: Node.js host helpers for Node-capable sandbox loaders.
- `runtimes/*`: imported runtime/compiler packages such as `wasm-rust`,
  `wasm-of-js-of-ocaml`, `wasm-go`, `wasm-tinygo`, `wasm-dotnet`, `wasm-typescript`,
  `wasm-wat`, `wasm-lua`, `wasm-lisp`, `wasm-elixir`, `pyodide`, `teavm`,
  `assemblyscript`, `ruby`, `r`, `php`, and `js-sandbox`.
- `static/wasm-zig` and `static/wasm-haskell`: bundled browser compiler assets synced from
  upstream asset builds rather than local workspace packages.
- `tools/*`: migrated local toolchain projects that are too broad or infrastructure-heavy to run as
  normal runtime workspace packages. `tools/dool` contains the Docker judge backend for Elixir and
  the other server-side language runners.

Useful workspace commands:

```bash
pnpm workspace:list
pnpm build:packages
pnpm check:packages
pnpm build:runtimes
pnpm check:runtimes
pnpm sync:runtime list
pnpm sync:runtimes
pnpm audit:runtimes
```

The sync scripts now default to `runtimes/<name>/dist`. To sync from one of the preserved sibling
repositories, pass explicit source and target paths to the underlying script, for example:

```bash
node scripts/sync-wasm-rust.mjs ../wasm-rust/dist static/wasm-rust
```

Java uses TeaVM's browser compiler/runtime. TeaVM compiler/runtime/classlib assets are bundled under `static/teavm/` by default, and the asset base URL can be overridden with `PUBLIC_TEAVM_BASE_URL`.

Pyodide core assets are vendored under `static/pyodide/`. Refresh them after bumping the `pyodide`
package with:

```bash
cd wasm-idle
pnpm run sync:pyodide
```

Elixir and Erlang browser execution use an AtomVM/Popcorn AVM bundle. The Popcorn `eval-in-wasm`
source and vendored Popcorn Elixir build dependency now live under `runtimes/wasm-elixir/`;
rebuild and sync with:

```bash
cd wasm-idle
pnpm --dir runtimes/wasm-elixir run bundle
pnpm run sync:wasm-elixir
```

Erlang support uses Popcorn's upstream `eval_erlang` and `eval_erlang_module` paths. This is not a
handwritten wasm-idle subset, but it inherits AtomVM/Popcorn runtime limits and is not full
Erlang/OTP ERTS coverage. Some OTP paths that rely on missing NIFs can fail in the current bundle,
so the browser starter and stdin coverage use `io:get_line`/`io:format` only.

## Rust browser integration

The demo app now bundles a local `wasm-rust` browser compiler under `static/wasm-rust/` and points the example `Terminal` at `/wasm-rust/index.js` by default. Refresh that bundle after rebuilding the sibling `wasm-rust` project with:

```bash
cd wasm-idle
pnpm run sync:wasm-rust
```

The built-in Rust route now supports both `wasm32-wasip1` and `wasm32-wasip2`. The page exposes a
target selector when Rust is active, defaults to `wasm32-wasip1`, and persists that choice in local
storage.

## TinyGo browser integration

The demo app can also vendor the sibling `wasm-tinygo` browser build under `static/wasm-tinygo/`
and load its `runtime.js` entry directly inside the TinyGo playground sandbox. The example page
uses the bundled browser runtime by default, including on `localhost` during `vite dev` /
`vite preview`. Refresh the
bundled runtime assets after rebuilding the sibling `wasm-tinygo` project with:

```bash
cd wasm-tinygo
npm run build

cd ../wasm-idle
pnpm run sync:wasm-tinygo
```

TinyGo exposes `wasm`, `wasip1`, `wasip2`, and `wasip3` targets through the example page. The
browser pipeline still lives inside `wasm-tinygo`; `wasm-idle` imports its reusable `runtime.js`
library entry directly, forwards the selected target into the build request, then runs the emitted
artifact with browser WASI so terminal stdin/EOF behavior stays consistent with the other runtimes.
The default bundled browser path loads the vendored TinyGo runtime in `direct` mode, skips the old
bootstrap-only compile step, and runs runnable WASI artifacts locally. The `wasip2` and `wasip3`
entries use the preview target profiles shipped by the bundled `wasm-tinygo` runtime, so they may
produce non-runnable preview artifacts until the matching execution path is available.

## C# / F# / VB.NET / .NET browser integration

The demo app vendors the sibling `wasm-dotnet` browser module under `static/wasm-dotnet/` and exposes
C# as `CSHARP`, F# as `FSHARP`, and VB.NET as `VBNET` in the shared playground selector. Refresh the
browser module after rebuilding the sibling project with:

```bash
cd wasm-dotnet
npm run build
dotnet workload install wasm-tools
dotnet workload install wasm-experimental
npm run build:runtime

cd ../wasm-idle
pnpm run sync:wasm-dotnet
```

C#, F#, and VB.NET compile in the browser through the bundled .NET `browser-wasm` compiler app.
`wasm-idle` loads the static `wasm-dotnet` module, which loads `runtime/dotnet.js`, invokes exported
compiler methods, and runs the generated assembly in the same browser runtime. No server-side dotnet
compile route is involved. For a hosted app, pass `runtimeAssets.dotnet.moduleUrl` or set
`PUBLIC_WASM_DOTNET_MODULE_URL`. The current .NET browser path forwards CLI args and buffered
terminal stdin into `Console.In`.

## Browser regression commands

Browser-level Rust and TinyGo checks are reproducible from this repo:

```bash
cd wasm-idle
pnpm run probe:rust-browser
pnpm run test:browser:playwright
pnpm run probe:tinygo-browser
pnpm run test:browser:tinygo

WASM_IDLE_BROWSER_URL='http://localhost:5173/absproxy/5173/' \
WASM_IDLE_REUSE_LOCAL_PREVIEW=1 \
pnpm run probe:rust-browser

WASM_IDLE_BROWSER_URL='http://localhost:5173/absproxy/5173/' \
WASM_IDLE_REUSE_LOCAL_PREVIEW=1 \
pnpm run probe:tinygo-browser

WASM_IDLE_RUN_REAL_BROWSER_RUST=1 \
WASM_IDLE_BROWSER_URL='http://localhost:5173/absproxy/5173/' \
WASM_IDLE_REUSE_LOCAL_PREVIEW=1 \
pnpm exec vitest run src/lib/playground/rust.playwright.test.ts

WASM_IDLE_RUN_REAL_BROWSER_TINYGO=1 \
WASM_IDLE_BROWSER_URL='http://localhost:5173/absproxy/5173/' \
WASM_IDLE_REUSE_LOCAL_PREVIEW=1 \
pnpm exec vitest run src/lib/playground/tinygo.playwright.test.ts
```

Both runtime probes exercise the real Chromium page path. The default Rust probe now feeds stdin with a
single line (`5\n`) and expects the page to finish without sending EOF, which keeps the regression
aligned with the default Rust sample and proves that pressing Enter is enough for line-based stdin.
Programs that intentionally read stdin until EOF can still be finished with `Ctrl+D` or the toolbar
`Send EOF` button while the process is running.
The browser helper writes stdin through the page-owned `window.__wasmIdleDebug.writeTerminalInput(...)`
hook instead of trying to click xterm's hidden helper textarea, which proved too flaky for repeatable
Playwright runs.
The TinyGo probe follows the same pattern. The browser path should load the vendored runtime in
`direct` mode and avoid the old bootstrap compile command altogether.
The TinyGo browser commands currently default to `vite dev`.
If Rust ever reports `invalid metadata files for crate core` or `Unsupported archive identifier`,
the browser almost always fetched a stale or wrong `wasm-rust` sysroot asset. Hard refresh the page
and resync `static/wasm-rust/` from the sibling `wasm-rust/dist/`.
When browser-rustc does retry, it now emits a visible warning instead of only a debug-level
transition into attempt `2/5`, `3/5`, and so on.
When the Rust `log` option is enabled, those compile-time `wasm-rust` progress and retry lines are
also forwarded into the terminal transcript before the final runtime output, so the browser console
is no longer required to inspect build progress.
They also resync the vendored `wasm-rust` bundle and rebuild `wasm-idle` first, so the browser run is
checked against the current assets rather than a stale preview output.
The probe/test helper also claims a dedicated local preview port by default instead of reusing
whatever already answers on `localhost`, which keeps the regression target tied to the current build.
If you point the probe at `dev.seorii.io`, remember that route currently requires an authenticated
session; the repo-owned regression target is the local preview path above.

## Runtime expectations

Rust still supports an external browser compiler module for library consumers. Point `PUBLIC_WASM_RUST_COMPILER_URL` at a built `wasm-rust` ESM entry such as `.../wasm-rust/dist/index.js`, or pass `runtimeAssets.rust.compilerUrl` at runtime.
TinyGo expects a browser-loadable `wasm-tinygo` runtime module. Point
`PUBLIC_WASM_TINYGO_MODULE_URL` at a built entry such as `.../wasm-tinygo/dist/runtime.js`, or
pass `runtimeAssets.tinygo.moduleUrl` at runtime. The older `PUBLIC_WASM_TINYGO_APP_URL` /
`runtimeAssets.tinygo.appUrl` document path is still accepted and normalized to `runtime.js`.
WAT uses the bundled `static/wasm-wat/` WABT browser module by default. Override it with
`PUBLIC_WASM_WAT_MODULE_URL`, or pass `runtimeAssets.wat.moduleUrl`.
Lua uses the bundled `static/wasm-lua/` wasmoon browser module plus its local `glue.wasm`
payload by default. Override it with `PUBLIC_WASM_LUA_MODULE_URL`, or pass
`runtimeAssets.lua.moduleUrl`.
Zig uses the bundled `static/wasm-zig/zig_small.wasm` compiler and `static/wasm-zig/std.zip`
standard library by default. Override them with `PUBLIC_WASM_ZIG_COMPILER_URL` and
`PUBLIC_WASM_ZIG_STDLIB_URL`, or pass `runtimeAssets.zig.compilerUrl` and
`runtimeAssets.zig.stdlibUrl`. The compiler runs under browser WASI, emits a `wasm64-wasi`
artifact with the self-hosted backend, and wasm-idle executes that artifact locally in the worker.
Scheme uses the bundled `static/wasm-lisp/` Puppy Scheme compiler module by default. Override it
with `PUBLIC_WASM_LISP_MODULE_URL`, or pass `runtimeAssets.lisp.moduleUrl`.
Ruby uses the bundled `@ruby/3.4-wasm-wasi` CRuby `ruby+stdlib.wasm` asset by default. Override it
with `PUBLIC_WASM_RUBY_WASM_URL`, or pass `runtimeAssets.ruby.wasmUrl`.
AssemblyScript uses the bundled `assemblyscript` browser compiler and instantiates the emitted
WebAssembly locally. `_start` or `main` runs first; otherwise zero-argument numeric, boolean, and
string exports are printed to the terminal. AssemblyScript programs can import stdin helpers from
`env`: `readLine(): string | null`, `readAll(): string`, and `readByte(): i32`. `readLine` waits for
Enter-submitted terminal input, while `readAll` reads until Ctrl+D or the EOF button.
WAT modules can import `env.readByte(): i32` for byte-oriented stdin; it returns `-1` at EOF.
Haskell uses the bundled `static/wasm-haskell/` `ghc-in-browser` assets by default. Override them
with `PUBLIC_WASM_HASKELL_MODULE_URL`, `PUBLIC_WASM_HASKELL_ROOTFS_URL`, and
`PUBLIC_WASM_HASKELL_BSDTAR_URL`, or pass `runtimeAssets.haskell`. The worker extracts the wasm GHC
root filesystem, loads `dyld.mjs`, and invokes the browser GHC/GHCi entry point locally.

The Rust browser path now executes returned artifacts through the target-appropriate runtime inside
the Rust worker:

- `wasm32-wasip1` runs as preview1 core wasm through `@bjorn3/browser_wasi_shim`
- `wasm32-wasip2` runs as a preview2 component through `preview2-shim` plus transpiled `jco` output

The generic `src/lib/clang/app.ts` host remains in place for other runtimes, but Rust now delegates
execution to `wasm-rust` so the selected target and returned artifact format stay aligned.

`Terminal` and `playground(...).load(...)` support either the legacy shared `path`/`rootUrl` or per-runtime asset config:

```ts
import type { PlaygroundRuntimeAssets } from 'wasm-idle';

const runtimeAssets: PlaygroundRuntimeAssets = {
	rootUrl: 'https://cdn.example.com/repl',
	python: {
		loader: async ({ asset }) => ({ url: `https://cdn.example.com/repl/pyodide/${asset}` })
	},
	java: {
		baseUrl: 'https://cdn.example.com/repl/teavm/'
	},
	clang: {
		loader: async ({ asset }) => ({ url: `https://cdn.example.com/repl/clang/${asset}` })
	},
	clangd: {
		loader: async ({ asset }) => ({ url: `https://cdn.example.com/repl/clangd/${asset}` })
	},
	rust: {
		compilerUrl: 'https://cdn.example.com/wasm-rust/index.js'
	},
	dotnet: {
		moduleUrl: 'https://cdn.example.com/wasm-dotnet/index.js'
	},
	tinygo: {
		moduleUrl: 'https://cdn.example.com/wasm-tinygo/runtime.js'
	},
	wat: {
		moduleUrl: 'https://cdn.example.com/wasm-wat/index.js'
	},
	lua: {
		moduleUrl: 'https://cdn.example.com/wasm-lua/index.js'
	},
	zig: {
		compilerUrl: 'https://cdn.example.com/wasm-zig/zig_small.wasm',
		stdlibUrl: 'https://cdn.example.com/wasm-zig/std.zip'
	},
	lisp: {
		moduleUrl: 'https://cdn.example.com/wasm-lisp/index.js'
	},
	haskell: {
		moduleUrl: 'https://cdn.example.com/wasm-haskell/dyld.mjs',
		rootfsUrl: 'https://cdn.example.com/wasm-haskell/rootfs.tar.zst',
		bsdtarUrl: 'https://cdn.example.com/wasm-haskell/bsdtar.wasm'
	}
};
```

Python custom loaders receive file names under the Pyodide asset root and can serve both core assets and package files. TeaVM custom loaders receive file names under the TeaVM asset root. Clang custom loaders receive `bin/memfs.zip`, `bin/clang.zip`, `bin/lld.zip`, and `bin/sysroot.tar.zip`; clangd custom loaders receive `clangd.js` and `clangd.wasm.gz`, with the worker decompressing the gzip payload before instantiation. Rust expects a browser-loadable compiler module URL; that module is responsible for serving its own nested runtime assets. C# and F# expect a browser-loadable `wasm-dotnet` module with its static .NET `browser-wasm` runtime assets. TinyGo expects a browser-loadable runtime module. The browser runtime now ships a direct-mode execution path that can produce and run the bundled TinyGo WASI artifact locally, alongside its sibling `tools/go-probe.wasm` and vendored emception assets. TinyGo also accepts a runtime asset loader + pack bundle in `runtimeAssets.tinygo` when you need to serve runtime assets out of a single compressed archive. Compressed TeaVM runtime assets are no longer unpacked inside the library; provide the final file URL or handle decompression in your own loader.

If you want a host app to reuse the same runtime asset configuration for both `<Terminal>` and direct `playground(...)` access, bind it once:

```ts
import Terminal, { createPlaygroundBinding } from 'wasm-idle';

const wasmIdle = createPlaygroundBinding({
	rootUrl: 'https://cdn.example.com/repl',
	rust: {
		compilerUrl: 'https://cdn.example.com/wasm-rust/index.js'
	},
	dotnet: {
		moduleUrl: 'https://cdn.example.com/wasm-dotnet/index.js'
	},
	tinygo: {
		moduleUrl: 'https://cdn.example.com/wasm-tinygo/runtime.js',
		assetPacks: [
			{
				index: 'https://cdn.example.com/wasm-tinygo/runtime-pack/runtime-pack.index.json',
				asset: 'https://cdn.example.com/wasm-tinygo/runtime-pack/runtime-pack.bin',
				fileCount: 12,
				totalBytes: 123456
			}
		]
	}
});

const sandbox = await wasmIdle.load('PYTHON');
await sandbox.load('print("hi")', false);
```

```svelte
<Terminal {...wasmIdle.terminalProps} bind:terminal />
```

Powered by [wasm-clang](https://github.com/binji/wasm-clang), Pyodide, TeaVM, `wasm-rust`,
`wasm-tinygo`, `wasm-dotnet`, `wasm-of-js-of-ocaml`, `wasm-typescript`, `wasm-lisp`,
`wasm-wat`, `wasm-lua`, `wasm-zig`, AtomVM/Popcorn, and `ghc-in-browser`.
