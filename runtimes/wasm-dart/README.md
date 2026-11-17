# Official Dart browser toolchain

The producer selects seven unchanged files from the official Dart 3.14.0
`dartpad.zip` release (SDK revision `fa8c1270c374c1346931583a17c3b7f278d3822d`).
It verifies the complete archive's 40,359,128-byte length and published SHA-256
`a47fad5844f91cfce800a20e2b3442847bf56b3332892cf8000b2abd0dd8a5f9`, then each
selected member's receipt. DevTools, Flutter and source maps are omitted.

```sh
node scripts/sync-wasm-dart.mjs
node scripts/sync-wasm-dart.mjs --check
```

No native Dart SDK or compiler build is required. An already downloaded exact
archive can be reused with `python3 runtimes/wasm-dart/prepare.py --archive /path/to/dartpad.zip`.
Sync downloads missing official payloads into ignored local files and verifies
the complete archive and every selected member before use. It retains no archive
on disk. Existing payloads are verified and reused; modified files are rejected.
Ordinary website builds and direct/grouped Dart browser tests prepare these files
automatically. The Git repository retains the pinned receipts, release metadata,
original license and generated host, rather than the upstream compiler payloads.

`host.dart` is a host bootstrap compiled by the original DDC along with the user's
unchanged source. It installs Dart `IOOverrides` to provide standard input/output
and process exit. The JavaScript script-loader shim permits the original SDK
sandbox scripts to run in a cancellable Worker; it does not implement a browser
DOM. The two upstream `worker.js` relative asset URLs are rebased after integrity
verification so the script can be imported from a verified Blob URL.

The SDK is BSD-3-Clause; the original license is distributed alongside the assets.
The public behavior and host restrictions are documented in [`docs/dart.md`](../../docs/dart.md).
