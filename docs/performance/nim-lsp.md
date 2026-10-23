# Nim: upstream nimlsp with embedded nimsuggest

The browser runs the original PMunch/nimlsp server, including Nim's compiler and
nimsuggest implementation. It does not run a separate nimsuggest subprocess or replace
its parser, semantic analyzer, or LSP handlers.

## Pinned inputs and build

`scripts/nim-lsp-assets.lock.json` pins the archive length and SHA-256 for:

- [nimlsp 0.4.7 snapshot 5fa2846f](https://github.com/PMunch/nimlsp/tree/5fa2846f04600c2cf1173625976e037389db4489) (MIT).
- [Nim 2.2.4, f7145dd2](https://github.com/nim-lang/Nim/tree/f7145dd26efeeeb6eeae6fff649db244d81b212d), from the official Linux x86_64 binary/source distribution (MIT and bundled notices).
- Original jsonschema 0.2.1, asynctools 0.1.1, and ast_pattern_matching 1.0.0 sources (MIT).
- The official Emscripten 6.0.0 Linux release archive and its original Emscripten/musl notices.

`python3 producers/nim-lsp/build.py` uses those inputs without fetching ambient Nimble
packages. `pnpm run sync:nim-lsp` compresses and verifies the JavaScript loader, Wasm,
and original standard-library/configuration snapshot. Licenses, source URLs and receipts
are deployed with them under ignored `static/wasm-nim-lsp/`. The code-only SDK includes
none of the compiler, standard library or binary assets.

The build applies two exact-anchor platform changes: select the server's existing
synchronous stdio branch for Emscripten, and report that the unused asynchronous
process-wait primitive is unavailable. Browser builds select Nim's official
[ORC memory runtime](https://nim-lang.org/docs/mm.html), which does not depend on
conservative C-stack scanning, together with malloc. Native oracle builds preserve the
original upstream source and mark-and-sweep configuration. No compiler/nimsuggest or
LSP handler code is rewritten.

## Browser host and behavior

A dedicated worker uses SharedByteQueue and vscode-jsonrpc stdio framing. It needs
cross-origin isolation and SharedArrayBuffer. The verified module is imported as a
blob, without JavaScript eval. Wasm compilation requires the usual `wasm-unsafe-eval`
CSP permission. Startup is ready when the actual CLI first reads stdin.

The original `lib/` and `config/` files are mounted at `/nim`; `/proc/self/exe` points
to the actual verified Wasm executable for Nim's Linux executable/config discovery.
Workspace sources live under `/workspace`. The adapter observes standard JSON-RPC file
notifications to mirror opened and saved document bytes before the original CLI reads
them; it never parses Nim source. Other files come from a bounded initial workspace
snapshot. Temporary files stay inside the worker filesystem.

Original nimlsp advertises full document synchronization and publishes compiler
checks on **didSave**. SDK defaults preserve that behavior. The Playground is an
autosaving host and explicitly enables `nim.autoSave`, which sends the same standard
save notification after opening or full document changes. Correcting a real type
error therefore clears the upstream diagnostic without replacing its messages.
Monaco can emit ranged edits even after the original server advertises Full sync.
Its Nim route forwards the editor's actual complete snapshot as a standard Full
`didChange`; it does not interpret edits or Nim syntax.

Completion, hover, definition, references, rename, signature help, document symbols,
shutdown and exit are handled by the original server. Source imports from the pinned
standard library are available. Dependency sources can be included in `workspaceFiles`;
external Nimble, compiler/linker execution, and other OS subprocesses are unavailable
in this worker. Recreate a provider when closed workspace snapshot files change.

## Validation

`pnpm run test:lsp:browser:nim` builds an unmodified native CLI and runs the same
fixture against it and actual Chromium. It compares complete normalized language
results, imports original `strutils`, observes an actual type mismatch followed by
empty diagnostics after a full change/save, checks completion/hover/navigation/
references/rename/signature/symbols, and requires original shutdown/exit code zero.
It also checks that imports alone fetch no heavy assets and disposal leaves no worker.

`pnpm run test:lsp:assets:nim` opts into actual producer/delivery verification. Default
Node tests exercise integrity failures without requiring a compiler download. The
Monaco browser matrix includes Nim's disabled-to-enabled lazy loading and real
error-to-clear editor markers, actual keyboard edits/undo, and original hover text. Lifecycle tests cover every registered provider.

Reproducible builds require Linux, `bubblewrap` (`bwrap`), and enabled unprivileged
user/mount namespaces. Each browser build creates a private mount namespace with the
original verified inputs mounted at `/tmp/nim-lsp-build` and its output at
`/tmp/nim-lsp-output`. The host's filesystem paths and mounts stay unchanged. This
preserves the original compiler's path-sensitive type signature hashing and assertion
filenames while producing identical bytes across different physical checkouts.
No generated C or analyzer logic is rewritten. The asset qualification rebuilds from
independently extracted inputs and compares every compressed and decoded receipt.
