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

## Prepare an immutable local distribution

After building the three packages, run:

```sh
pnpm prepare:container-distribution --input /absolute/recipe.json --output /absolute/new-release
pnpm verify:container-distribution --directory /absolute/new-release --expected-sha256 <returned-lock-digest>
```

The recipe has `schemaVersion: 1`, a canonical `baseURL` ending in `/`, `distribution`
(the existing schema-1 index), the application's `adapterIds`, and `inputs` containing
`{package, asset, path}` for every asset. Local paths resolve relative to the recipe.
Every asset must already have independent producer delivery/logical identities. The
preparer verifies both, replaces asset URLs with content-addressed object URLs, and uses
the runtime's own graph/schema validator. It never resolves mutable releases or runs
producer-supplied scripts. Files and gzip are supported; archive data is published as
one logical file and needs an explicit validated extraction step in the application.

Each package also requires one `provenance` record:

```json
{
  "package": "tools",
  "license": "MIT",
  "sourceStatus": "incomplete",
  "receipt": {"path": "receipt.json", "bytes": 123, "sha256": "<reviewed digest>"},
  "sources": [{"path": "sources.tar.gz", "bytes": 123, "sha256": "<reviewed digest>"}],
  "notices": [{"path": "NOTICE", "bytes": 123, "sha256": "<reviewed digest>"}]
}
```

The receipt digest must equal the producer receipt in the distribution. Source and
notice bodies are included and verified, but their contents still need producer-specific
review. `sourceStatus: "reviewed-complete"` records the release owner's review; the tool
never infers completeness or license compatibility from a digest. Incomplete source
closure remains visible in verification output. The placeholder sizes/digests above are
not a usable recipe.

Optional `hostFiles` entries specify `{path, destination, bytes, sha256, mediaType}`.
These are explicitly selected application modules, SDK glue, or Worker modules. Their
relative module graph is preserved under a content-addressed `host/<tree-digest>/`
directory. Applications import this trusted graph themselves; a distribution command
still selects only a registered adapter ID and cannot supply an import URL.

The output contains content-addressed objects, the immutable index, and
`application-lock.json`. No timestamps or machine paths enter the lock. Existing output
paths are refused. Failed preparation removes only its new output, and the lock is written
after its complete closure. Retain the returned lock digest independently in application
source or release configuration. Verification requires that digest, checks delivery and
logical bytes again, rejects unlisted files and symlinks, and does no network access.

This is **local byte-closure verification**. It does not run producer fixtures, verify
real hosting responses, certify licenses, or publish anything. Upload the full immutable
closure only through an explicitly authorized deployment, verify the actual response
bytes/headers and clean-origin browser suite, then switch the application lock. Preserve
the previous lock for rollback.

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

That batch test asserts `crossOriginIsolated` and verifies lazy Worker/assets under those
headers. Live WASI and the optional actual Bash session have independent fixtures; batch
results alone do not qualify them. The workbench's selected Bash profile uses a fixed static
SDK module graph, common filesystem mounts and tracked nested Workers. Its local immutable
release gate is described in [the workbench deployment guide](../examples/container/IMMUTABLE.md).
Cross-origin CDN CORS/CORP, redirects, iframe embedding and production responses require
qualification on the actual deployment.

## Reproduce and preserve evidence

After the three package builds:

```sh
node --test packages/container/test/unit/*.test.mjs packages/container/test/contract/*.test.mjs
pnpm --dir packages/llvm-core exec vitest run runtime/clang/test --maxWorkers=2
pnpm --dir packages/container verify:package-boundary
CONTAINER_EVIDENCE=.codex/container-batch.json node packages/container/scripts/test-browser.mjs
CONTAINER_ISOLATED=1 CONTAINER_EVIDENCE=.codex/container-isolated.json node packages/container/scripts/test-browser.mjs
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
The workbench exposes save failures, manual retry, buffer export and workspace backup.
Owner-controlled garbage collection preserves the root generations needed for recovery;
storage durability is still limited by browser guarantees.

Production promotion still requires the actual Clang CLI/header corpus, BusyBox B1 source and
notice closure, real shell acceptance, live cancellation/pipe tests, lifecycle UI and the
clean-origin immutable distribution on its real hosting headers. See the
[qualification ledger](./container-qualification.md).
