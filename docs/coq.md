# Coq

`COQ` runs the full Coq 8.17.1 kernel through the original jsCoq 0.17.1 browser
release in a fresh Worker. `Definition`, theorem proofs, tactics, `Check`, `Print`
and evaluation use the actual kernel. Messages, warnings and errors come from
Coq. The profile ships the release's matching `init` and `coq-base` archives and
their original tactic plugins. Only modules whose dependencies are present in
these archives can be loaded. Arithmetic, collections, reals and Ltac2 archives,
and user ML plugins, are outside this profile. The editor uses plain text.

The entire active source is passed unchanged to native `Load`. Additional `.v`
workspace sources can be loaded with `Load "helpers".`; paths are relative to the
workspace root. `Require Import` loads modules available in the bundled standard
library, such as `Coq.Logic.FunctionalExtensionality` and `Coq.Bool.Bool`.
`Coq.Logic.Classical` needs omitted arithmetic modules and is unavailable in this
minimal profile. User `.v` files are source files, not
precompiled `.vo` modules. Each loaded file must finish its proof blocks, as required by the original Coq
file loader. Each run starts with the normal Coq prelude and fresh definitions. There are no program or compiler arguments in this profile.

The SDK defaults to `main.v`. In the playground, `main.coq` selects Coq while the
existing `.v` association continues selecting V. Coq itself requires `Load` files
to end in `.v`, so `.coq` files have a private `.coq.v` alias containing identical
bytes. Diagnostic paths are mapped back to the user file name. Explicitly selected
Coq `.v` files work directly.

Standard input is a **Coq command stream**, as with commands supplied after a
loaded source file to `coqtop`. Source results appear first. Buffered or delayed
stdin is collected unchanged until EOF, then passed to a second native `Load` in
the same proof state. Definitions from the source are available to those commands.
For example, source `Definition answer := 42.` and stdin `Check answer. Compute
answer.` print its type and computed value. Periods in comments and strings,
multiline tactics and syntax errors are handled by Coq's parser.

In the playground, enter additional Coq commands in the terminal and press
**Ctrl+D** to execute the collected input and finish. Commands are not executed
one line at a time. In the SDK, supply `stdin: ''` for a source-only batch run,
or call `write(...)` followed by `eof()` for delayed commands. A session without
EOF continues waiting and remains subject to its execution timeout.

Asset bytes, virtual workspace files (including collected stdin), output,
diagnostics, startup/execution deadlines and cancellation are bounded. Workers
are terminated on cancellation, timeout or completion and later runs recover
with a fresh kernel. Bundled libraries are read-only. This js_of_ocaml build uses
the browser's JavaScript heap, not Wasm linear memory: `maxWasmMemoryBytes` does
not cap that heap. Native subprocesses, network library downloads and exported
artifacts are unavailable. Coq's native/bytecode evaluators are disabled by the
upstream browser build; ordinary `Compute` uses the original `cbv` fallback.

The served standard-library filenames use a `.bin` suffix so ordinary static hosts
serve the original ZIP bytes with the correct binary MIME type.
The production asset compressor retains these exact identity URLs, including the
original JavaScript kernel, so SDK startup works without a service worker. Browser
acceptance serves the actual output of that compressor to verify this contract.

Runtime payloads remain outside npm packages. Serve `static/wasm-coq` beneath
`runtimeAssets.rootUrl`. The source revisions, original build records, licenses
and artifact hashes are in `runtimes/wasm-coq` and the served build manifest.
