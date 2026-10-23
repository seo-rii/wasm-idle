# Original SuperBOL OSS language server in browser workers

The provider mirrors OCamlPro's official universal SuperBOL Studio OSS 0.3.0 VSIX from Open VSX,
pinned to source commit `bf5491727e140334a1ec437ff1a3c3363f7bbe4e`. Its original 10,864,987-byte
`superbol-free.js` includes the OCaml parser, GnuCOBOL dialect configuration, copybook processing
and LSP handlers compiled with js_of_ocaml 5.3.0. The SDK contains only the transport/worker host
and pinned receipts; the generated server, data and licenses are deployed externally.

## Browser platform

The original stdio protocol runs over `SharedByteQueue` and VS Code JSON-RPC stream framing.
A worker announces readiness when the original CLI first reads stdin. Cancellation, language
switches and explicit `dispose()` close the queue and terminate the worker. The existing
js_of_ocaml Node filesystem host supplies workspace text snapshots and bundled dialect data.
No COBOL parsing, completion or diagnostic rules are implemented in the adapter.

Browser workers have less native JavaScript stack space than the Node environment targeted by
the universal VSIX. The browser asset changes the js_of_ocaml runtime's `caml_callback` trampoline
budget from 40 to 4. The exact original file hash and one unique runtime-primitive anchor guard
this adaptation. All COBOL parser and handler bytes remain unchanged; the raw original script is
also preserved as an external asset for the native reference test. The runtime primitive comes
from [js_of_ocaml 5.3.0](https://github.com/ocsigen/js_of_ocaml/blob/5.3.0/runtime/jslib.js).

Hosts need cross-origin isolation (`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`) for shared memory. CSP must permit the verified
script blobs. No JavaScript eval permission is used by the tested feature path.

## Dialects and project files

The default dialect remains upstream's GnuCOBOL-compatible `default`. In this release, upstream
publishes diagnostics only for projects configured with `cobol85`; syntax support for other
dialects is deliberately restricted by upstream. Completion, hover, copybook definitions,
references, paragraph rename and symbols remain available for the default dialect.

For a project using the supported diagnostics profile, include `superbol.toml`:

```toml
[cobol]
dialect = "cobol85"
source-format = "fixed"
```

Supply the project's text files through `cobol.workspaceFiles`, with paths relative to
`/workspace`, and initialize the LSP client with root URI `file:///workspace`. Copybooks and
`superbol.toml` are read from this snapshot. Recreate the server when closed files change. The
playground supplies other text files and recreates its worker on file switches or snapshot
changes. The original server handles incremental edits to the active document.

The filesystem snapshot is read-only. Original commands that write project configuration and
persistent on-disk cache files are unavailable. The official js_of_ocaml release also fails its
persistent `Marshal.Closures` cache during protocol shutdown under Node. Close/shutdown cannot
be relied on to terminate this profile; SDK hosts must call `dispose()`. The adapter propagates
original protocol behavior and guarantees worker termination through disposal.

## Reproduce and deploy

```sh
pnpm run sync:cobol-lsp
pnpm run test:lsp:assets:cobol
pnpm run test:lsp:browser:cobol
```

`scripts/cobol-lsp-assets.lock.json` pins the official VSIX size/SHA-256, every mirrored
GnuCOBOL configuration file, source revisions, licenses and emitted assets. The sync script
extracts only the server, dialect files and original license. It verifies all inputs and emits
`static/wasm-cobol-lsp/`:

| File                          | Purpose                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| `superbol-free.js.gz.bin`     | Unmodified official JavaScript, reference/provenance           |
| `superbol-browser.mjs.gz.bin` | Same server with the browser VM trampoline budget              |
| `gnucobol-config.json.gz.bin` | All 38 original dialect/configuration files                    |
| `host.mjs`                    | Filesystem and stdio platform adapter                          |
| `LICENSE.superbol.md`         | Original AGPL/MIT/ISC notices from the release                 |
| `LICENSE.gnucobol.txt`        | Original bundled configuration's GNU GPL license               |
| `SOURCE.txt`                  | Pinned corresponding source links and reproduction information |
| `runtime-manifest.json`       | Version and SHA-256/size receipts                              |

Deploy this complete directory alongside the page; its size is within the optional 4 MB asset
budget. Page runtime synchronization prepares it automatically. Server/data assets are ignored
by Git and excluded from the SDK tarball. Importing the SDK requests no language assets before
the provider is selected and enabled. Unexpected input hashes and startup failures fail normally.

The asset-build test is opt-in because it downloads the pinned official VSIX/license when not
cached. The default Node test suite verifies receipt rejection and the runtime adaptation using
local inputs, without requiring a producer install or network downloads.

## Validation

The real Chromium test runs the same protocol fixture against the original Node CLI and the
browser worker, comparing complete language results after normalizing workspace paths. Both the default GnuCOBOL-compatible and explicit COBOL85 projects are compared. It
covers an unterminated literal diagnostic in COBOL85, incremental correction and diagnostic clearing,
copybook completion/hover/definition/references, paragraph rename and document symbols. It
records the original CLI's cache failure, then verifies that SDK disposal removes browser
workers. Unit tests cover UTF-8 stdio framing, failure/cancellation, idempotent disposal and
read-only filesystem errors. The Monaco matrix uses an explicit COBOL85 project/copybook fixture
to test lazy loading and diagnostics that clear after editing.
