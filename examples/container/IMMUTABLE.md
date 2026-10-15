# Local immutable workbench qualification

The real Bash workbench can be assembled as a locked host-module graph and content-addressed asset closure. This is a local preparation and browser-validation workflow. It does not upload files, change a domain, install a service worker or deploy infrastructure.

Prepare a new directory with the explicit producer configuration and independently reviewed provenance identities:

```sh
node scripts/prepare-container-bash-release.mjs \
  --config /absolute/path/to/pinned-shell-config.json \
  --provenance /absolute/path/to/pinned-provenance.json \
  --base-url http://127.0.0.1:4187/container-release/ \
  --output /absolute/path/to/new-immutable-release
```

Select an available loopback port before preparation. Asset URLs are part of the pinned manifest; changing the port or base path requires preparing a new release and lock. Preserve the independent `lockSha256` returned by preparation. The distribution's own hash fields cannot authenticate a substituted application lock.

The host graph lives below `host/<hash>/`. HTML, main-module and Worker references are relative, and Bash's bootstrap URLs resolve against its owner module. The SDK stays a literal static import of `./sdk/index.mjs`, with its unchanged pinned `index.mjs` and `worker.mjs` bytes. Inlining that SDK relocates `import.meta.url` and violates its fixed-module-URL contract. Runtime manifests contain data assets and registered adapter IDs; they do not choose host JavaScript to import.

Verify the complete local inventory with the independent lock digest:

```sh
node scripts/verify-container-distribution.mjs \
  --directory /absolute/path/to/new-immutable-release \
  --expected-sha256 THE_INDEPENDENT_LOCK_DIGEST
```

Run the **same** rendered real-shell acceptance used by the development server against that exact graph:

```sh
node packages/container/scripts/test-product-release-browser.mjs \
  --directory /absolute/path/to/new-immutable-release \
  --expected-sha256 THE_INDEPENDENT_LOCK_DIGEST \
  --config /absolute/path/to/pinned-shell-config.json \
  --output /absolute/path/to/new-browser-evidence
```

Evidence must be outside the release directory. Existing browser receipts are rejected rather than overwritten. The wrapper checks the producer/package inputs and lock, starts the local server on the manifest's loopback port, and closes it after the browser gate. The release directory is read-only during serving.

`createReleaseExampleServer` serves only the lock's inventory. It checks each response's size and SHA-256 before returning bytes, including native JavaScript module imports that bypass the runtime asset loader. It preserves MIME and file compression, sets `Cache-Control: no-store`, COOP/COEP and the example's restrictive same-origin CSP, and records asset-body counts. Unknown paths and changed host bytes fail explicitly. The small Node contract suite validates these hosting boundaries without claiming that a compiler or shell executed:

```sh
node --test scripts/container-release-server.test.mjs
```

The actual browser gate checks source creation before Clang downloads, the unchanged Bash→Clang→artifact→BusyBox script, common workspace files, executable metadata, explicit save, reload, direct execution of the persisted artifact, warm compilation without repeated asset-body downloads, foreground interruption and Worker cleanup. Its receipt includes the lock, host graph and manifest identities, response records, browser/OS and tested source hashes.

The checked-in [immutable browser receipt](../../packages/container/test/fixtures/product-release-browser-evidence.json) passes all six checks across three real runs in Chromium `153.0.8010.12` on Linux. The independent lock is `e7392ffb2ec6af345f848ae675d2eecf890e2536cffa9cf9ce051d40801c201b`; its host graph is `26beff170c7330d850e2abbedfba7e9601de352a104ee1297ba421341382198c`. Each of the six pinned asset bodies is fetched once across the workflow and reloads, and all owned Workers and browser descendants are reaped. The [metadata](../../packages/container/test/fixtures/product-release-browser-metadata.json) preserves the 33 locked files' preparation identities and exact build-source mapping. The host includes the restore/input transaction fixes, also covered by the separate [16-case real WASI UI regression](../../packages/container/test/fixtures/product-transaction-browser-evidence.json).

A passing local runtime gate does not qualify production hosting, another browser profile, all upstream tool features, a fully offline app bootstrap or source/license completeness. Provenance `sourceStatus` remains explicit; the receipt reports `sourceClosureReviewed` independently. Inspect those fields and the browser receipt before promoting a release. Production response verification and deployment require their own explicit target and authorization.
