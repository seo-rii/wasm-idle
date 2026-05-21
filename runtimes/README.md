# Runtime Packages

This directory contains the runtime/compiler projects that used to live as sibling repositories.
Those sibling checkouts are intentionally preserved, but the monorepo source of truth now keeps the
buildable runtime source, build scripts, package manifests, lockfiles, and original CI workflow files
under `runtimes/<name>/`.

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
