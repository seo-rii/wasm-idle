# Deploying the playground

The playground is a SvelteKit app built with `@sveltejs/adapter-static`. Its only route is
prerendered (`src/routes/+page.ts`), so the build output in `build/` is a plain directory of
files. The reference deployment publishes that directory to GitHub Pages with `gh-pages.js`. Any
static host works if it meets the [host checklist](#host-checklist).

## Building the site

`pnpm run page:build` prepares every runtime and builds the site. The sync steps download pinned
runtime assets, so the build needs network access. In order, it:

1. Verifies that the C3 and LFortran bundles in `static/wasm-c3/` and `static/wasm-lfortran/` match
   their committed profiles (`verify:page-c3`, `verify:page-lfortran`). Both directories are
   ignored by Git; `pnpm run prepare:test-assets -- c3 lfortran` downloads the pinned copies.
2. Syncs Lean 4, the Clang assets, the page runtimes (`build:page-runtimes`,
   `sync:page-runtimes`), the bundled runtime modules (`build:static-runtime-modules`), the
   LLDB/WAMR debugger release (`prepare:wasm-debug-release`) and Common Lisp.
3. Packs and compresses runtime assets in `static/` (`layer:static-runtimes`,
   `compress:static-runtimes`); see [Compressed runtime assets](#compressed-runtime-assets).
4. Regenerates and checks the release asset lock (`assets:lock`, `check:assets-lock`); see
   [the persistent asset cache](runtime-asset-cache.md#updating-the-release-lock).
5. Runs `pnpm run build` (publishable workspace packages, `vite build` and the npm package
   output), compresses large files in `build/` (`compress:build-runtimes`) and verifies the C3 and
   LFortran bundles again in `build/`.

`pnpm run page` is the maintainer release command. It runs `page:build`, then the full browser
audit against the built site (`test:browser:audit:full --use-build`), then `node gh-pages.js`.
`gh-pages.js` verifies the C3, LFortran and debugger bundles in `build/` and refuses to deploy
when the OCaml `wasm_of_ocaml` bundle or `compressed-runtime-assets.v1.json` is missing. It deletes
any duplicate `build/wasm-tinygo/vendor/wasm-rust-runtime/` to stay under the GitHub Pages size
limit (the service worker maps that path to `wasm-rust/runtime/`), and pushes `build/` to the
`gh-pages` branch with a `.nojekyll` file and dotfiles included.

To check a finished `build/` locally with the deployment headers, use the release preview
configuration. Plain `pnpm preview` serves SvelteKit's intermediate output instead of `build/`.

```sh
pnpm exec vite preview --config scripts/release-preview.config.mjs
```

## Base path

The site is built for the `/wasm-idle` base path, set by `paths.base` in `sveltekit.config.mjs`.
There is no environment override: to serve the site at another path, change that value and
rebuild. The browser test harness (`scripts/browser-preview-server.mjs`) reads the same setting.

Everything is resolved relative to the base path. The page registers `<base>/worker.js` with the
base path as its scope, the service worker loads its manifests relative to that scope, and the
page uses the base path as the runtime asset root (`createApplicationRuntimeAssets` in
`src/lib/playground/applicationAssets.ts`). Serve the whole `build/` directory, unchanged, at that
path.

## Cross-origin isolation

Debugging and streaming (interactive) stdin need `SharedArrayBuffer`, which browsers expose only
to cross-origin-isolated pages. Without isolation, static-worker runtimes fall back to stdin that
is supplied before the run starts (`stdinMode` in `src/lib/playground/staticWorkerRuntime.ts`),
and features that require shared memory fail with an explanatory error
(`src/lib/playground/sharedBuffer.ts`).

The preferred setup is a host that sends these headers on every response:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

The Vite dev server (`server.headers` in `vite.config.ts`) and the release preview
(`createReleasePreviewSecurityHeaders` in `scripts/content-security-policy.mjs`) send all three.
`static/_headers` declares the same headers for every path; it is copied into `build/` for hosts
that read `_headers` files, such as Netlify or Cloudflare Pages.

### Service worker fallback

Hosts that cannot set headers, such as GitHub Pages, rely on `static/worker.js`.
`src/routes/+layout.svelte` registers it on page load with a `?build=<timestamp>` query, so every
build installs a new worker; the worker activates immediately and claims open pages. The worker
copies each response it serves and adds `Cross-Origin-Embedder-Policy: require-corp` and
`Cross-Origin-Opener-Policy: same-origin`. It does not add `Cross-Origin-Resource-Policy`.

The first document load is not served by the worker. When the page is still not cross-origin
isolated after the worker becomes ready, the layout reloads it so that the worker serves the
document. If the browser has no service worker support or registration fails, the page logs the
problem and continues without isolation.

Two kinds of responses pass through without the added headers: files under `/webr/` other than
`R.js` and `webr-worker.js`, and a fixed list of receipt-pinned Rust, TinyGo and AWK files
requested with their exact `?v=<sha256>` query. The worker returns the latter untouched so that
their `Response.url` survives for verification.

## Compressed runtime assets

Besides isolation, the service worker serves runtime files that do not exist on disk under their
logical names. The files take three forms.

### `.gz` siblings

`scripts/compress-static-runtime-assets.mjs` runs on `static/` (`compress:static-runtimes`) and on
`build/` (`compress:build-runtimes`). It compresses files of at least 256 KiB under `wasm-*`,
`clang`, `clangd`, `pyodide`, `teavm`, `webr`, `_app/immutable/assets` and
`_app/immutable/workers` with gzip level 9, writes `<file>.gz`, records each path and its original
size in `compressed-runtime-assets.v1.json`, and then **deletes the original**. Files that are
already compressed (`.gz`, `.br`, `.brotli`, `.tgz`, `.zip`, `.zst`, `.gz.bin`) and inert
JavaScript storage (`.js.bin`, `.js.gz.bin`) are skipped, so nothing is compressed twice. TinyGo's
receipt-pinned `upstream.js` and `upstream-compile-worker-*.js` stay uncompressed because their
exact URLs are verified.

When a request's scope-relative path is listed in the manifest, the worker fetches `<path>.gz`,
decompresses it with `DecompressionStream` (unless the response already carries
`Content-Encoding: gzip`) and returns it with a `Content-Type` derived from the extension and the
original `Content-Length`. Requests with a `Range` header are not rewritten. Because the originals
are deleted, these logical URLs work only while the service worker controls the page, unless a
loader requests the `.gz` delivery file itself.

### `.gz.bin` and `.bin` storage

Many sync scripts store the producer's pinned gzip bytes as `<file>.gz.bin`, and some store
uncompressed files as `<file>.bin`. The `.bin` suffix keeps static hosts from adding
`Content-Encoding` to them (see `scripts/sync-wasm-commonlisp.mjs` and
`src/lib/playground/commonlispAssets.ts`). Loaders download these files, verify the stored bytes
against their receipts and decompress them in the page or worker. Some loaders reject any
response that carries `Content-Encoding`, for example the Pascal compiler loader in
`packages/core/src/pascal-runtime.ts`.

Deployment builds keep both legacy `.gz` and canonical `.gz.bin` copies by default.
`pnpm run compact:build-runtimes` reports byte-identical pairs in `build/` without changing files.
With `pnpm run compact:build-runtimes --drop-legacy-aliases` it deletes the `.gz` copies and
patches the built `worker.js` to route their URLs to the `.gz.bin` files; that routing only helps
requests controlled by the service worker. The script refuses to run on `static/`.

### Layered `*.pack.gz` files

`scripts/build-layered-runtime-assets.mjs` (`layer:static-runtimes`) packs the .NET
`wasm-dotnet/runtime/{ref,csharp,fsharp,vbnet}/` files into gzip layers of at most 16 MiB decoded
each (`wasm-dotnet/runtime/layers/<runtime>-NN.pack.gz`). It handles TinyGo's
`wasm-tinygo/vendor/emception/` files the same way when they are present; the committed static
tree has none. `layered-runtime-assets.v1.json` records each layer's decoded length, compressed
length and SHA-256 of the compressed bytes, and each logical file's layer, offset and length. The
script removes layered files from the compressed manifest, deletes their sources and checks every
written layer against the manifest.

For a logical path in the layer manifest, the worker fetches the layer with a
`__wasm_idle_layer=<sha256>` query, decompresses it, and returns the file's byte range. It answers
`HEAD` and single-range requests itself and keeps up to 64 MiB of decompressed layers in memory.

The same script stores the Rust `wasm32-wasip2` and `wasm32-wasip3` sysroot packs as
`copy-literal-v1` deltas against the `wasm32-wasip1` pack (and the Go `js/wasm` pack against
`wasip1/wasm` when the Go manifest declares sysroot packs). The runtimes decode those deltas
themselves; the service worker does not.

### Other worker routes

The worker also maps requests under `wasm-tinygo/vendor/wasm-rust-runtime/` to
`wasm-rust/runtime/` and answers `__wasm_idle_dynamic_modules__/` requests from the
`wasm-idle-dynamic-modules-v1` CacheStorage cache. The Gleam runner writes the JavaScript modules
it compiles there before importing them, so Gleam execution depends on the service worker.

## Content Security Policy

The default build sends no Content Security Policy. Building with `WASM_IDLE_STRICT_CSP=1` enables
SvelteKit's `csp` option in hash mode (`sveltekit.config.mjs`), which adds a
`<meta http-equiv="content-security-policy">` tag with script hashes to the prerendered page. The
directives live in `applicationContentSecurityPolicyDirectives` in
`scripts/content-security-policy.mjs`:

- `script-src 'self' blob: 'wasm-unsafe-eval'`, without `'unsafe-eval'` or `'unsafe-inline'`.
- `worker-src 'self' blob:` and `connect-src 'self' blob: https: http:`.
- Google Fonts in `style-src` and `font-src`, and `blob:`/`data:` in `img-src` and `media-src`.

Module workers do not inherit the document's meta policy; they receive only the HTTP response
policy. With the same variable set, the release preview also sends
`releaseResponseContentSecurityPolicy` as a `Content-Security-Policy` header. It adds
`'unsafe-inline'` to `script-src`; the document's meta policy still limits inline scripts to
SvelteKit's hashes, and workers import verified compiler bytes through Blob URLs without
`'unsafe-eval'`. The static output carries only the meta tag, so a host that wants the strict
policy must send that response header itself.

CI exercises the strict policy in the Gleam LSP browser test (`pnpm run test:lsp:browser:gleam:csp`)
and in the debugger browser workflow (`.github/workflows/debug-browser.yml`). No other browser
suite runs with `WASM_IDLE_STRICT_CSP=1`.

## Host checklist

- Serve the complete `build/` directory, unchanged, at the configured base path (`/wasm-idle/`
  unless you changed `paths.base`).
- Send the three isolation headers on every response, or let the service worker supply COOP and
  COEP. Serve `worker.js` from the same origin and base path as the page.
- Do not add `Content-Encoding` to `.gz`, `.gz.bin`, `.bin` or `.pack.gz` files, and do not
  recompress or transcode them. The service worker tolerates a `Content-Encoding: gzip` response,
  but loaders that fetch storage files directly verify the stored bytes, and some reject
  `Content-Encoding` outright.
- Use standard MIME types: `application/wasm` for `.wasm`, a JavaScript type for `.js` and `.mjs`,
  and `application/json` for `.json`. Verified loaders reject a response whose `Content-Type`
  differs from the media type in their receipt when the receipt declares one
  (`packages/core/src/asset-integrity.ts`).
- Ignore query strings on static files: the app requests `worker.js?build=…`, `?v=<sha256>` and
  `?__wasm_idle_layer=<sha256>` URLs.
- Keep `compressed-runtime-assets.v1.json` and `layered-runtime-assets.v1.json` at the base path;
  the service worker fetches them with `cache: 'no-cache'`.
- Plan for a large site. `scripts/static-asset-budgets.v1.json` sets the size budget for
  `static/` (checked by `pnpm run check:asset-sizes`), and the built app adds to it.
- The compression and layering above are designed for same-origin assets. A runtime mirror on
  another origin cannot use this service worker and needs CORS and CORP headers that satisfy
  `require-corp`.
