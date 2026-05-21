# Runtime Packages

This directory contains the runtime/compiler projects that used to live as sibling repositories.
Those sibling checkouts are intentionally preserved, but the monorepo source of truth now keeps the
buildable runtime source, build scripts, package manifests, lockfiles, and original CI workflow files
under `runtimes/<name>/`.

Additional runtime-adjacent projects that should not participate in normal `pnpm build:runtimes`
live under `tools/`. In particular, `tools/dool` contains the Docker-based judge/toolchain project
for the non-browser language backend, including Elixir and the other server-side language modules.

Generated outputs are not part of the migration:

- `dist/`
- `node_modules/`
- `.cache/`
- downloaded toolchain archives
- final browser runtime assets under generated `public/tools` or `public/vendor` paths
- `.NET` `bin/` and `obj/` directories

Use this audit when sibling checkouts are available and you want to verify that build source and
scripts were not left behind:

```bash
pnpm audit:runtimes
```

The audit currently checks the migrated sibling/local projects for missing or changed non-generated
source files:

- `runtimes/wasm-*`
- `tools/dool`

External runtime distributions without local source checkouts, such as Pyodide and TeaVM, are
wrapped as JavaScript packages in their own runtime directories.
