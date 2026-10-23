# Original Grain language server

The Grain editor runs the byte-identical `grainlsp.bc.js` from the official
Grain 0.7.2 release, revision `49829d7966b38b177291f7e91f5eb81c65ec07aa`.
This is upstream's js_of_ocaml language server, distinct from `grainc.bc.js`.
Its parser, type checker, dispatcher and semantic handlers are unchanged.

The host supplies the existing Grain virtual filesystem and a synchronous stdin
backed by the shared byte queue from `@wasm-idle/llvm-core/debug`. JSON-RPC stream
framing uses `vscode-jsonrpc`. A dedicated Worker executes the original CLI loop;
no diagnostic output is converted into an alternative language server.

## Prepare and verify

```sh
pnpm install --frozen-lockfile
pnpm sync:grain-lsp
pnpm --dir packages/core build
pnpm --dir packages/llvm-core build
pnpm --dir packages/lsp build
pnpm test:lsp:grain
```

Preparation verifies the official release archive, extracts the original server
from its `pkg` snapshot, and mirrors the existing receipt-pinned standard library
pack. It produces `static/wasm-grain-lsp/`, including LGPL/MIT notices, without
committing generated assets or placing them inside the SDK package. The lock
pins both compressed and decoded bytes. `--release-binary PATH` permits offline
rebuilds; `--update-lock` is only for intentional reviewed artifact changes.

The browser verifies the runtime host, compressed server, standard library and
decoded payloads before execution. No LSP assets load before the provider starts.
The original JavaScript bundle runs without JavaScript `unsafe-eval`.

## SDK and project files

```ts
import { getGrainLanguageServer } from '@wasm-idle/lsp/grain';

const server = await getGrainLanguageServer({
	grain: {
		baseUrl: 'https://cdn.example.com/wasm-grain-lsp/',
		workspaceFiles: [
			{ path: 'greeting.gr', content: 'module Greeting\nprovide let message = "Hi"' }
		]
	}
});
```

Project snapshots are private to each Worker and mounted below
`file:///workspace/`. Paths must be relative; snapshots are bounded to 1,000
files and 16 MiB. Recreate the provider after changing its project snapshot.
The playground supplies other Grain files and uses normal document notifications
for edits to the current file.

Cross-origin isolation and `SharedArrayBuffer` are required for upstream's
synchronous stdin. Abort, startup timeout and dispose terminate the Worker;
dispose also closes the shared queue and interrupts any pending writer.

Capabilities are the original server's: diagnostics, hover, cross-file definition,
type definition, document symbols, formatting, code actions/lenses and inlay
hints. Upstream 0.7.2 does not advertise completion or rename. Hover and definition
on an imported field in a binding resolve to the original type and source file.
Some expression uses still return `null` for hover; the native CLI control and
browser preserve the same upstream behavior.

The real Chromium test checks SDK startup, project imports, type hover, local
definition, symbols, formatting, invalid-edit diagnostics and their clearing,
shutdown/dispose, and tampered host rejection under a CSP without JavaScript eval.
