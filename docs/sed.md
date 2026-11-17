# sed browser execution

`SED` runs the real BusyBox 1.37.0 sed applet in a disposable private WASI execution.
The editor source is a sed script, passed as `sed -f /<activePath>`. Input streams
through stdin until EOF. For example, `s/world/sed/g` transforms `hello world` into
`hello sed`.

`programArgs` (or legacy `args`) are original sed options and input filenames.
Use `['-n']` for explicit-print mode, `['-E']` for extended regular expressions,
or `['data/input.txt']` to read a workspace file. Relative filenames resolve from
the private workspace root `/`; `activePath` defaults to `main.sed`. Workspace
files and the script are readonly snapshots, and private runtime writes are not
exported to the editor. The upstream WASI profile rejects `-i` in-place editing.
Stored POSIX permission metadata is explicitly unsupported by this adapter.
Compiler arguments are rejected because sed is interpreted.

The SDK uses the existing Wasm sandbox for output limits, timeouts, delayed stdin,
EOF, cancellation, disposal, and fresh execution after Stop. Prepare compiles the
interpreter but does not execute or syntax-check the user script; syntax errors
and nonzero guest exits are reported by the real interpreter at run time.

The 634,885-byte interpreter is the identical pinned artifact already used by the
reviewed BusyBox container distribution. Its SHA-256 is
`30ea0ce3a36013b343dddc0045c72f490c468268c1a1fd2050fdc8702f97bd40`.
Source archive, configuration, producer revision, patches and GPL-2.0 license
are recorded in `static/wasm-sed/runtime-build.json`. The source build recipe and
complete patch set remain in `runtimes/wasm-busybox/`.

`pnpm sync:wasm-sed` verifies the committed artifact and regenerates the license
and receipt. If the artifact is absent, it downloads only the exact pinned
artifact; `--source /path/to/busybox.wasm` supplies a local copy with the same
hash validation. `node scripts/sync-wasm-sed.mjs --check` verifies everything
offline. Hosts supply `static/wasm-sed/` under `runtimeAssets.rootUrl`; the optional
container package is not required.

Run `pnpm test:browser:sed` for actual Chromium source execution, stdin/EOF,
workspace files, original diagnostics, options, limits, cancellation and recovery.
