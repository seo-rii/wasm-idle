# Container workbench example

This view binds a file editor, raw process streams, workspace save status, backup/restore, and separate asset-cache controls to one private container-owner `MessagePort`. Published files live in the owner's workspace. The textarea is an explicitly unpublished editor buffer; **Save never publishes that buffer**.

From the repository root, after installing the workspace's development dependencies:

```sh
node examples/container/serve.mjs
```

Open `http://127.0.0.1:4174`. The local server binds only loopback and sends COOP/COEP and a restrictive same-origin CSP. It bundles trusted host code locally; it does not download JavaScript named by a distribution. `PORT` selects a different local port. `?workspace=my-project` selects a separate persistent workspace identifier. A second writer for the same identifier is refused visibly.

The default session is a **real checked-in WASI byte guest**, not a shell or compiler. It writes input bytes to stdout and `/workspace/input.bin` until EOF. Start downloads its verified Wasm only when requested. A second owner can reuse the selected persistent asset cache. The fixture receipt records the actual source, artifact and build-script hashes; starting this example does not rebuild or qualify a compiler. The existing C file is editable sample data.

`mountContainerWorkbench(element, client, options)` in `workbench.mjs` also accepts an actual Bash owner client from `createContainerOwnerClient`. The owning Worker supplies `serveContainerOwner` with the container, `startShell`, save controller, explicit cache-clear callback and persistence cleanup. Its `startShell` can call the public `createWasixShellSession` with the application's statically imported SDK, verified assets and owned Worker group. Pass a truthful `profileLabel`, `terminalDescription` and optional `startOptions` to the view. An application embedding this view still owns its distribution lock, SDK bootstrap, browser qualification and deployment. The owner protocol supports one session per owner; reload or explicitly create a fresh owner for another session.

`createExampleServer({ ownerEntry, profile })` accepts a trusted local owner entry and truthful view profile at build time. That entry uses the same one-time initialization message `{port, workspaceId}` and acknowledges `{ready:true}` only after ownership and serving are established, or `{ready:false, code, message}` on failure. This is a local application-build choice, not a runtime manifest or user URL. The shipped `main.mjs` exports an `application` promise with `{client, view}` for host controls. Worker errors abort the owner client so pending stream and control operations fail visibly. `view.dispose()` closes the owner and invokes the host cleanup callback; it does not save implicitly.

The editor reads UTF-8 files up to 8 MiB. A publish compares the original inode and bytes in the owner before writing; external edits and snapshot leases preserve the staged buffer and report a conflict or busy error. Switching files with unpublished edits is refused until explicit discard. Invalid UTF-8 is left intact and can be exported with the workspace. Browser text editing uses LF line endings; opening an untouched file does not rewrite its bytes. “Export editor buffer” and “Export published workspace” deliberately export different revisions.

Workspace backups are bounded to 32 MiB and validated before replacing files. Restore requires a selected file and explicit replacement checkbox, and refuses to discard a staged editor buffer. Restored memory is still dirty until saved. Save failure pauses autosave and leaves retry/export available. Browser storage is subject to quota, eviction and interruption; a successful save publishes a validated root using the browser's storage APIs, not an unlimited durability guarantee.

The editor and publication controls pause for the complete restore transaction, including reading the selected backup. A pending terminal input write pauses its text field and Send button until the bytes are accepted; EOF, interrupt and Stop remain available. This prevents a completed operation from clearing text typed while it was waiting.

“Clear downloaded assets” clears only this example's Core asset-cache namespace. It does not clear OPFS, workspace journals, another host's caches or loaded in-memory executable bytes. “Collect orphan workspace blobs” is explicit bounded maintenance that preserves every retained recovery root. Neither action deletes a workspace to fix a storage error.

Streams are bytes until the terminal binding decodes them for display. stdout and stderr remain separate and render through `textContent`, capped at 32,768 code units per channel. Input is UTF-8, capped by the binding's 64 KiB pending-byte budget; no shell parser, ANSI interpreter, PTY, job-control or global stdout/stderr ordering is supplied by this view. The default byte-guest profile's interrupt terminates that guest; an actual Bash profile supplies its own foreground-interrupt semantics.

The real Chromium UI regression runs with a separate trusted test owner that injects a storage-publication failure. The normal owner does not install its fault channel. Run it with a new evidence directory; previous receipts are never overwritten automatically:

```sh
CHROMIUM_PATH=/path/to/playwright/chromium \
CONTAINER_PRODUCT_TEST_OUTPUT=/path/to/new-evidence-directory \
node packages/container/scripts/test-product-browser.mjs
```

The suite exercises actual owner RPC, Workers, Wasm, OPFS/IndexedDB, conflicts, downloads, restore, cache cold/warm reuse, cancellation and writer ownership. Its fixture profile is not evidence that Bash, BusyBox or Clang passed their separate release gates.

For the actual Bash/BusyBox/Clang profile, provide the explicit local shell configuration used by the producer acceptance tools:

```sh
node examples/container/serve-bash.mjs /absolute/path/to/pinned-shell-config.json
```

This server reuses the existing receipt and artifact verifier. The configuration supplies local SDK package, Bash WEBc, BusyBox receipt/bytes, Clang producer/smoke receipts and compressed modules, and the complete process-profile sysroot with its derivation receipt. SDK pins must match the reviewed SDK profile in the repository. It does not build LLVM, find a mutable “latest” package, upload files or deploy infrastructure. The SDK remains a fixed static module import of the pinned host package; it is not inlined into a different module URL. Manifests select only pre-registered runtime adapters and verified data assets.

`bash-profile.mjs` is the trusted shared host setup for the browser acceptance owner and `bash-owner.mjs`. The workbench's Bash owner adds the OPFS workspace, save controller and distinct cache callback. The initial shell is `/bin/bash --noprofile --norc`, reading real script input from the process streams. It exposes only the qualified BusyBox applets, Clang profile and explicit `wasm-run` route. The default compiler filesystem is a snapshot adapter with a writer lease; live utility/artifact execution uses the common workspace directly. This profile does not promise a PTY, full POSIX compatibility, job control or a persistent SDK instance across page reloads.

Set `"clangFilesystem": "live"` in the trusted local shell configuration to select the optional live compiler profile. The application builder selects the fixed `llvm-clang-tool-host-live-v1` adapter and its static Worker entry; its manifest command and distribution identity change together. Live Clang inherits the actual shell descriptors, supports streamed stdin, and uses the shared workspace while other commands run. Completed writes remain visible after cancellation. Omitted configuration or explicit `"snapshot"` keeps the snapshot adapter and forwarded output; other values fail before starting. A guest message or remote manifest cannot supply a new host module URL. Preparing an immutable release uses this same selection and requires a new lock; existing prepared releases remain unchanged.

The pinned SDK reports terminal descriptors, so this Bash invocation emits its real prompts and readline input echo on stderr. The raw text view preserves those bytes, including any carriage returns and backspaces; it does not emulate a screen or remove prompts from captured diagnostics. Compiler diagnostics remain on stderr, and pipe/file bytes do not pass through this display handling.

The separate product gate sends the development plan's unchanged acceptance script through the rendered terminal, checks that source exists before Clang starts downloading, saves the output, reloads the owner, directly reruns the persisted executable, repeats a warm compile, and interrupts a real foreground command blocked on stdin. Its evidence is distinct from the small byte-guest UI regression:

```sh
CONTAINER_PRODUCT_SHELL_OUTPUT=/path/to/new-real-shell-evidence \
node packages/container/scripts/test-product-shell-browser.mjs \
  /absolute/path/to/pinned-shell-config.json
```

Use the resulting receipt's actual browser, source hashes and checks to determine qualification. The presence of this example or a successful host bundle alone is not a passing real-shell gate.

The live profile has an additional actual Bash gate:

```sh
node scripts/probe-container-shell-acceptance.mjs --run-live \
  /absolute/path/to/pinned-live-shell-config.json
```

It runs the unchanged plan script cold and warm, then an actual Bash producer→Clang stdin→BusyBox pipeline. While Clang waits for input, the owner edits a header and a concurrent real BusyBox reads the new bytes; only then does Bash finish its compiler input. A separate closed-input `clang --version` call checks shell descriptor inheritance. This gate records its own live receipt and does not reuse the snapshot gate's interrupted-output rollback expectations. The default `--run` still executes the eight snapshot scenarios.
