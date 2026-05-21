# Pyodide Assets

`wasm-idle` consumes Pyodide from the locked npm dependency in the root package:

- package: `pyodide`
- pinned version: see the root `package.json` and `pnpm-lock.yaml`
- vendored browser assets: `static/pyodide/`
- central sync script: `scripts/sync-pyodide.mjs`

Refresh the vendored assets after changing the package version:

```bash
pnpm install
pnpm sync:pyodide
```

Pyodide itself is an external runtime distribution, not a local sibling source repository.
