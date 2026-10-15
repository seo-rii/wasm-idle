# Container deployment contract

The stack adds a local deployment smoke and CI evidence collection. It does not publish an npm
release, upload assets, change infrastructure or qualify the full C-19 production gate.

## Host code and assets

Build `packages/core`, `packages/llvm-core` and `packages/container` in that order with the
repository's pinned pnpm/Node toolchain. The container tarball includes only JavaScript, types,
package metadata and documentation. Its root import neither loads the optional Clang adapter
nor fetches a compiler. Import WASI, Clang and persistence entrypoints explicitly.

Register trusted adapters in application code. A pinned distribution chooses an adapter ID
from that allowlist; it cannot provide JavaScript URLs. The application supplies the expected
manifest digest independently of the manifest. Publish the full immutable asset closure before
selecting its lock. Preserve exact URL, full-response status, MIME, delivery/logical size and
digest validation. No worker may re-fetch executable bytes after the host verifies them.

Assets must meet the existing [runtime asset cache contract](./runtime-asset-cache.md).
Identity and gzip logical files are supported; arbitrary archives, Range/chunk loading and
mutable `latest` resolution are not. Keep complete selected-target C/C++ headers in a compiler
distribution. Source and notice packs remain a separate release requirement; splitting host
code from GPL userland bytes does not itself settle the distribution's license obligations.

## Browser profiles and policy

Batch commands use ordinary dedicated module Workers and prebuffered stdin. They do not require
SharedArrayBuffer. OPFS persistence additionally requires a secure context, IndexedDB, Web
Crypto and Web Locks; loopback is used for local tests. A second writer fails explicitly.

The browser smoke serves a same-origin module graph and uses this policy, adding the SHA-256
hash of its inline import map to `script-src`:

```http
Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'sha256-<import-map-hash>'; worker-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
```

`wasm-unsafe-eval` permits WebAssembly compilation without enabling general JavaScript string
evaluation. See [MDN's script-src reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src).
Adapt the exact module/import-map hash and explicitly approved asset origin to the application;
do not copy the placeholder literally or allow all network origins. Return correct JavaScript
and Wasm MIME types on bootstrap modules and assets. Apply the relevant policy to Worker
responses as well as the document.

The same batch suite is also tested with:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

That test asserts `crossOriginIsolated` and verifies lazy Worker/assets under those headers.
It does not qualify an interactive profile: the live SAB bridge, shared fd scheduling and
actual shell integration are still absent. Cross-origin CDN CORS/CORP, redirects, nested shell
workers, iframe embedding and the production application's complete CSP require later tests.

## Reproduce and preserve evidence

After the three package builds:

```sh
node --test packages/container/test/unit/*.test.mjs packages/container/test/contract/*.test.mjs
pnpm --dir packages/llvm-core exec vitest run runtime/clang/test --maxWorkers=2
pnpm --dir packages/container verify:package-boundary
CONTAINER_EVIDENCE=.codex/container-batch.json node packages/container/scripts/test-browser.mjs
CONTAINER_ISOLATED=1 CONTAINER_EVIDENCE=.codex/container-isolated-headers.json node packages/container/scripts/test-browser.mjs
CONTAINER_PERSISTENCE_EVIDENCE=.codex/container-persistence.json node packages/container/scripts/test-persistence-browser.mjs
```

Use Chromium; `CHROMIUM_PATH` optionally selects an installed executable. The GitHub workflow
installs the Chromium revision selected by the frozen lockfile and uploads JSON receipts.
Receipts identify the source revision/hashes, browser, OS/kernel, GitHub image version when
available, isolation, asset hash, exits, exact byte checks and cache body-request count. The
hosted Ubuntu image label is still rolling; fixed release-image qualification is outstanding.

The cache fixture disables HTTP and in-memory asset reuse, reloads the page, and requires one
total body request for two executions. This proves reuse of a retained verified asset cache.
It does not prove that an app, its module graph or all worker bootstraps can start offline.

Workspace persistence has a separate storage namespace and explicit owner lifetime. Cache
cleanup never deletes the workspace. Successful `flush()` publishes a verified root within
browser API guarantees; eviction, quota, teardown and orphan accumulation remain relevant.
Hosts must expose save failures and user-controlled export before claiming a persistent IDE.

Production promotion still requires the actual Clang CLI/header corpus, BusyBox B1 source and
notice closure, real shell acceptance, live cancellation/pipe tests, lifecycle UI and the
clean-origin immutable distribution on its real hosting headers. See the
[qualification ledger](./container-qualification.md).
