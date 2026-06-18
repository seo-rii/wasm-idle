# wasm-clang

`wasm-clang` packages the existing browser clang runtime that currently lives inside `wasm-idle`
into a TypeScript module with bundled runtime assets.

Current status:

- the package stays `private` while the `wasm-idle` integration is being split out
- the repository includes vendored runtime assets under `artifacts/runtime-source/`
- the default build is self-contained and does not require a sibling `wasm-idle` checkout

Current scope:

- reusable browser runtime class for compile/link/run
- packaged `clang.zip`, `lld.zip`, `memfs.zip`, `sysroot.tar.zip`, and `clangd` browser assets
- runtime manifest and build metadata under `dist/runtime/`
- high-level `createClangCompiler()`, `preloadBrowserClangRuntime()`,
  `executeBrowserClangArtifact()`, and `resolveRuntimeAssetUrls()` helpers
- a debug control wrapper in the root package plus a `wasm-clang/clangd` transport subpath
- unit tests ported from the current `wasm-idle` clang host

## Build

```bash
cd wasm-clang
npm install
npm run build
```

This build consumes the committed runtime sources under `artifacts/runtime-source/` and writes the
JavaScript bundle plus packaged runtime assets to `dist/`.

If you need to refresh those vendored assets from a sibling `../wasm-idle` checkout, run:

```bash
npm run build:from-wasm-idle
```

## Runtime assets

The initial runtime source was seeded from the current `wasm-idle/static/clang/bin/` and
`wasm-idle/static/clangd/` bundles so the package can be integrated first. The build copies those
vendored assets into `dist/runtime/bin/` and `dist/runtime/clangd/`, then writes:

- `dist/runtime/runtime-manifest.v1.json`
- `dist/runtime/runtime-build.json`

By default, the runtime resolves assets relative to the built module:

- `dist/index.js`
- `dist/runtime/runtime-manifest.v1.json`
- `dist/runtime/bin/{clang.zip,lld.zip,memfs.zip,sysroot.tar.zip}`
- `dist/runtime/clangd/{clangd.js,clangd.wasm.gz}`

If you host the assets somewhere else, pass `runtimeBaseUrl` to
`preloadBrowserClangRuntime()` and `createClangCompiler()`.

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

The next step is to switch `wasm-idle` to import this package instead of keeping its own private
clang source/runtime copy.
