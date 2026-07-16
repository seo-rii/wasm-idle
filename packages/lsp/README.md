# @wasm-idle/lsp

Framework-neutral browser language-server hosts for wasm-idle. The npm package contains code only.
Language tools and standard-library data must be deployed separately and passed as HTTP(S) URLs.

In particular:

- TypeScript and JavaScript require `typescript.libUrl` or `javascript.libUrl` unless the host
  supplies `libFiles` directly.
- SQLite requires `sql.wasmUrl`.
- DuckDB requires `sql.duckdbBundles` with externally hosted module and worker URLs.
- Clangd and other compiler-backed language servers use their corresponding runtime asset config.

No WASM modules, compressed standard libraries, compiler archives, or worker assets are included in
the package tarball.
