# Runtime Packages

This directory contains the runtime/compiler projects maintained by the monorepo. Runtime source,
build scripts, package manifests, lockfiles, and CI configuration live under `runtimes/<name>/`;
build and verification commands do not inspect repositories outside this checkout.

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

External runtime distributions without local source checkouts, such as Pyodide and TeaVM, are
wrapped as JavaScript packages in their own runtime directories.
