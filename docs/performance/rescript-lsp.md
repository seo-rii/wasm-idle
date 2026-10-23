# Original ReScript language server in browser workers

The provider uses the original ReScript VS Code language server 1.74.0, commit
`76d30468cb05401c10dd1e9dcf5a2993f8fc7140`. Its TypeScript handlers are bundled unchanged.
The original ReScript 12.3.1 compiler **and its matching editor analysis** are compiled from
`679406560d169f1124653ab50795d5077570f078` with OCaml 5.2.1 and js_of_ocaml 6.4.1.
The editor analysis bundled with older extension releases cannot read the newer compiler's
typed artifacts, so the provider uses the analysis shipped with the selected compiler.

The full release compiler profile writes genuine `.cmi`, `.cmj`, `.cmt` and `.cmti` files.
The upstream `BROWSER` profile disables CMT output and is deliberately not used here.
The only OCaml source-tree adjustment adds a bytecode mode to the compiler's Dune executable.
Parser, type checker, completion, definition, rename, diagnostic and other handler bodies
remain upstream. Small js_of_ocaml bindings implement the compiler's original C hash, array,
file timestamp and realpath primitives; these are runtime services, without language analysis.

## Filesystem and processes

An isolated worker supplies a writable memfs workspace. Original synchronous analysis subprocess
calls run the matching compiled analysis CLI with its original arguments and environment.
Original incremental compiler subprocesses run the full compiler CLI. Its stderr is parsed by
the original server, producing upstream syntax/type diagnostics and edits.

The initial build uses the original compiler's `-bs-ast` dependency header to order source modules.
It reads the compiler-produced module list; it does not parse ReScript text. The host writes the
actual compiler flags into `lib/bs/build.ninja` so the unchanged server can derive incremental
flags. The official `@rescript/runtime@12.3.1` supplies unchanged CMI/CMT/source files for standard
library lookup. No package install, external process or server-side analysis runs in the browser.

Monaco can request features before `didOpen`. Those requests wait in a bounded queue until the
original open handler completes. A canonical URI map preserves snapshot file-name case for
clients that lowercase URIs. Standard configuration replies retain the platform's compiler and
runtime paths. Cancellation, language switches and `dispose()` terminate the entire worker.

## Supported project profile

The verified scope is plain ReScript 12.3.1 projects and their standard library, including local
cross-file modules and interfaces. Supply text files relative to `/workspace` and initialize
with root URI `file:///workspace`. The SDK bounds snapshots to 1000 text files, 16 MiB UTF-8 and
64 ReScript source files. When no `rescript.json` is supplied, the host derives a plain project
from the supplied source directories. Closed files are snapshots; recreate the provider when
they change. Unsaved edits use the original incremental type checker.

Namespaces, npm compiler dependencies, PPX and custom `bsc-flags` require another compiler profile
and fail explicitly. Build watcher subprocesses and npm installation are unavailable. The
playground includes other `.res`/`.resi` files and `rescript.json`, and adds the current editor
snapshot before startup. The existing execution compiler/runtime remains separate.

```ts
import { getReScriptLanguageServer } from '@wasm-idle/lsp/rescript';

const handle = await getReScriptLanguageServer({
	rootUrl: 'https://assets.example.com/',
	rescript: {
		workspaceFiles: [
			{ path: 'Greeting.res', content: 'let message = "hello"' },
			{ path: 'Main.res', content: 'let text = Greeting.message' }
		]
	},
	signal
});
// Connect handle.transport to the editor's standard LSP client.
handle.dispose();
```

## Assets and reproduction

The SDK contains receipts and the worker/transport host. Compiler, analysis, server and stdlib
bytes remain in externally deployed `wasm-rescript-lsp/` assets. Both compressed and decoded
bytes are verified before importing the script or mounting data. Loading is lazy and reuses
the existing verified asset cache. The profile works under the application's strict CSP with
script blobs and requires no JavaScript eval permission or cross-origin shared memory.

```sh
pnpm run sync:rescript-lsp
pnpm run test:lsp:browser:rescript
pnpm run test:lsp:assets:rescript
```

Producer requirements: Node, pnpm, OPAM, OCaml build prerequisites and `tar`. The producer installs
only into its isolated cache and pins every OPAM package version. For an existing isolated
toolchain, use `--opam-root PATH --switch NAME`. Test equivalents are
`WASM_IDLE_RESCRIPT_LSP_OPAM_ROOT` and `WASM_IDLE_RESCRIPT_LSP_OPAM_SWITCH`.
`--rebuild` verifies freshly produced assets against the committed receipts. `--update-lock`
is for deliberate reviewed producer changes. The producer checks immutable source archive
hashes and fails on missing js_of_ocaml primitives. Generated binaries are ignored by Git and
excluded from the SDK package.

ReScript compiler code is LGPL-3.0-or-later; server, syntax, runtime and Flow inputs have their
original licenses. js_of_ocaml runtime code carries its LGPL/linking-exception notices. Deploy
`THIRD_PARTY_NOTICES.txt` and `SOURCE.txt` with the complete asset directory; the source lock and
producer preserve corresponding source revisions and the exact build adaptation.
