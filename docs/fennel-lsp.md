# Original Fennel language server in the browser

The Fennel editor provider runs upstream `fennel-ls` revision
`107fd29d4771440f4b5d8221caf6ccaeac969863` in a dedicated Wasmoon Lua Worker.
Its parser, analyser, dispatcher, completion, hover, definition, rename, signature,
and diagnostic handlers are unchanged. The host calls upstream's existing
`cli.handle-one-message` entry, which also drains the original diagnostic queue.
This replaces the CLI byte-stream loop with browser messages without replacing
the server's analysis or implementing another language server.
The transport holds early document requests until the client sends `didOpen`;
Monaco can request code actions while its document synchronization is starting.

## Prepare assets

```sh
pnpm install --frozen-lockfile
pnpm sync:fennel-lsp
pnpm test:lsp:fennel
```

The sync command verifies the source archive before reading it into a private
Lua build filesystem, then uses the bundled original Fennel compiler and the
same bundling switches as upstream's Makefile. Wasmoon, its Wasm, the compiled
server, and their license notices are external deployment assets under
`static/wasm-fennel-lsp/`; none are included in the `@wasm-idle/lsp` npm tarball.
The reviewed lock pins the archive and every generated asset by size/SHA-256.
`--source-archive PATH` supports offline preparation. Maintainers use
`--update-lock` only when reviewing an intentional source/toolchain change.

## SDK

```ts
import { getFennelLanguageServer } from '@wasm-idle/lsp/fennel';
const handle = await getFennelLanguageServer({
	fennel: { baseUrl: 'https://cdn.example.com/wasm-fennel-lsp/' }
});
// Pass handle.transport to an LSP client and dispose when the session ends.
```

The provider downloads nothing until selected and enabled. A custom base URL
must mirror the pinned assets; bytes are verified before executing the Lua
runtime or server. The browser build uses the original server's in-memory open
documents; it does not mount a project filesystem. Filesystem-based module
discovery and project macro loading are unavailable in this host. Server
capabilities come directly from upstream, including its UTF-16 position
negotiation and incremental edits.

`scripts/fennel-lsp.browser.test.mjs` exercises the real server and runtime in
Chromium, including diagnostics after invalid edits and clearing them after
correction, local completion, hover, definition, rename, and asset tampering.
