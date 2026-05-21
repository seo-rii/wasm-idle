# Pyodide Runtime Package

`@wasm-idle/runtime-pyodide` wraps the locked Pyodide distribution with reusable asset manifests,
URL resolution, and a loader helper.

- package: `pyodide`
- pinned version: see the root `package.json` and `pnpm-lock.yaml`
- vendored browser assets: `static/pyodide/`
- central sync script: `scripts/sync-pyodide.mjs`

Build and type-check the wrapper package with:

```bash
pnpm --dir runtimes/pyodide run build
pnpm --dir runtimes/pyodide run check
```

Refresh the vendored assets after changing the package version:

```bash
pnpm install
pnpm sync:pyodide
```

Pyodide itself is an external runtime distribution, not a local sibling source repository.
