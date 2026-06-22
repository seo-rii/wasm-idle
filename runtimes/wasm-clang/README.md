# wasm-clang

`wasm-clang` owns the browser Clang runtime and its bundled runtime assets.

Current status:

- the package stays `private` while the `wasm-idle` integration is being split out
- the repository includes vendored runtime assets under `artifacts/runtime-source/`
- the default build is self-contained

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
pnpm install
pnpm --dir packages/clang-common build
pnpm --dir runtimes/wasm-clang build
```

This build consumes the committed runtime sources under `artifacts/runtime-source/` and writes the
JavaScript bundle plus packaged runtime assets to `dist/`.

## Runtime assets

The committed `artifacts/runtime-source/` directory is the source of truth. The build copies those
assets into `dist/runtime/bin/` and `dist/runtime/clangd/`, then writes:

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

The runtime has two different binary contracts:

- `clang.zip` and `lld.zip` each contain one raw WASI WebAssembly module named `clang` and `lld`.
- `clangd/clangd.js` and `clangd/clangd.wasm.gz` are an Emscripten pthread build of `clangd`.

To build and package the toolchain in one pass:

```bash
LLVM_VERSION=22.1.8 \
WASI_SDK_VERSION=33 \
EMSDK_VERSION=6.0.0 \
pnpm --dir runtimes/wasm-clang build:toolchain
```

This clones LLVM, downloads the matching WASI SDK sysroot and compiler-rt archive, builds
`clang`/`wasm-ld` as raw WASI modules, builds `clangd` as an Emscripten worker module, stages the
current libc++ headers under `include/c++/v1`, and writes the packaged runtime assets.
Use `WASM_CLANG_TOOLCHAIN_WORK_DIR` and `WASM_CLANG_TOOLCHAIN_OUT_DIR` to override the build cache
and output directories.

If you already have toolchain outputs from another build, package them directly:

```bash
pnpm --dir runtimes/wasm-clang package:toolchain -- \
  --clang-wasm /path/to/clang.wasm \
  --lld-wasm /path/to/wasm-ld.wasm \
  --sysroot /path/to/wasi-sysroot \
  --clangd-js /path/to/clangd.js \
  --clangd-wasm /path/to/clangd.wasm \
  --llvm-version 22.1.8 \
  --wasi-sdk-version 33 \
  --emsdk-version 6.0.0
```

The script writes `artifacts/runtime-source/toolchain.json` next to the packaged assets. The normal
build reads that file and emits matching `resourceDir` and `compilerRuntimeLibDir` values into
`dist/runtime/runtime-manifest.v1.json`.

After packaging a new toolchain, run:

```bash
pnpm --dir packages/clang-common build
pnpm --dir runtimes/wasm-clang validate:runtime
pnpm sync:wasm-clang
```

The current clangd build references are `guyutongxue/clangd-in-browser` for the Emscripten clangd
shape and `WebAssembly/wasi-sdk` for sysroot layout. Cib-style clang builds are useful as historical
reference, but they must be adapted to this runtime's raw WASI module contract before packaging.

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
