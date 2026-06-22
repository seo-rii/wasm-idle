# wasm-clang

`wasm-clang` owns the browser Clang runtime and consumes packaged LLVM assets from
[`@seo-rii/wasm-llvm`](https://github.com/seo-rii/wasm-llvm).

Current status:

- the package stays `private` while the `wasm-idle` integration is being split out
- LLVM/Clang binary assets are owned by `@seo-rii/wasm-llvm`
- the default build copies packaged assets from the installed `@seo-rii/wasm-llvm` dependency

Current scope:

- reusable browser runtime class for compile/link/run
- runtime packaging for `clang.zip`, `lld.zip`, `memfs.zip`, `sysroot.tar.zip`, and `clangd`
- runtime manifest and build metadata under `dist/runtime/`
- high-level `createClangCompiler()`, `preloadBrowserClangRuntime()`,
  `executeBrowserClangArtifact()`, and `resolveRuntimeAssetUrls()` helpers
- a debug control wrapper in the root package plus a `wasm-clang/clangd` transport subpath
- unit tests ported from the current `wasm-idle` clang host

## Build

```bash
pnpm install
pnpm --dir packages/clang-common build
pnpm --dir runtimes/wasm-clang build
```

This build consumes `@seo-rii/wasm-llvm` and writes the JavaScript bundle plus packaged runtime
assets to `dist/`.

## Runtime assets

`@seo-rii/wasm-llvm` is the source of truth for LLVM/Clang runtime assets. The build resolves that
package's `artifacts/runtime-source/` directory, copies the assets into `dist/runtime/bin/` and
`dist/runtime/clangd/`, then writes:

- `dist/runtime/runtime-manifest.v1.json`
- `dist/runtime/runtime-build.json`

By default, the runtime resolves assets relative to the built module:

- `dist/index.js`
- `dist/runtime/runtime-manifest.v1.json`
- `dist/runtime/bin/{clang.zip,lld.zip,memfs.zip,sysroot.tar.zip}`
- `dist/runtime/clangd/{clangd.js,clangd.wasm.gz}`

If you host the assets somewhere else, pass `runtimeBaseUrl` to
`preloadBrowserClangRuntime()` and `createClangCompiler()`.

## Refreshing The Toolchain

Refresh LLVM/Clang assets in `seo-rii/wasm-llvm`, then update this package dependency. The normal
build reads `toolchain.json` from that package and emits matching `resourceDir` and
`compilerRuntimeLibDir` values into `dist/runtime/runtime-manifest.v1.json`.

After packaging a new toolchain, run:

```bash
pnpm --dir packages/clang-common build
pnpm --dir runtimes/wasm-clang validate:runtime
pnpm sync:wasm-clang
```

For local experiments only, set `WASM_CLANG_RUNTIME_SOURCE_DIR=/path/to/runtime-source` before
running `pnpm --dir runtimes/wasm-clang build`.

## Additional wrappers

For editor/LSP integration, import the clangd language-server transport from the package subpath
and pass the returned reader/writer pair to your editor client:

```ts
import { createClangdLanguageServer } from 'wasm-clang/clangd';

const clangd = await createClangdLanguageServer({
	baseUrl: new URL('./dist/runtime/', import.meta.url).href
});
```

For debug control, the root package also exposes a thin wrapper that owns the shared debug buffers
and command bridge:

```ts
import { createBrowserClangDebugDriver } from './dist/index.js';
```

## Consumer contract

```ts
import createClangCompiler, {
	executeBrowserClangArtifact,
	preloadBrowserClangRuntime
} from './dist/index.js';

await preloadBrowserClangRuntime({
	runtimeBaseUrl: new URL('./dist/runtime/', import.meta.url)
});

const compiler = await createClangCompiler({
	runtimeBaseUrl: new URL('./dist/runtime/', import.meta.url)
});
const result = await compiler.compile({
	language: 'CPP',
	fileName: 'hello.cpp',
	debug: true,
	breakpoints: [2],
	pauseOnEntry: true,
	code: '#include <iostream>\nint main(){ std::cout << "hi\\n"; }'
});

if (result.success && result.artifact) {
	const runtime = await executeBrowserClangArtifact(result.artifact);
	console.log(runtime.stdout);
}
```

`preloadBrowserClangRuntime()` is a warm-up helper. It resolves the manifest and eagerly loads the
runtime so later compiler instances can reuse browser fetch/wasm caching, but it does not hand
back a persistent compiler session.

The root application generates its legacy `static/clang/` and `static/clangd/` paths from this
package with `pnpm sync:wasm-clang`.
