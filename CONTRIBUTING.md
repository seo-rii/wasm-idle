# Contributing to wasm-idle

This guide covers the local setup, the checks to run before a pull request, and the commit
style. For deployment and new languages, see:

- [Deploying the playground](docs/deployment.md)
- [Adding a language](docs/adding-a-language.md)

New language support must run the real language implementation in the browser and include
stdin/stdout coverage with browser-path tests; handwritten parsers, translators, emulators and
subset executors are not accepted. The full policy is in `AGENTS.md` and the
[language checklist](docs/adding-a-language.md#policy).

## Prerequisites

- **Node.js** `^22.22.2 || ^24.15.0 || >=26.0.0` (`engines.node` in `package.json`). CI uses
  Node 24.
- **pnpm 12.9.1** exactly (`packageManager` and `engines.pnpm` in `package.json`). `.npmrc` sets
  `engine-strict=true`. If a version manager reads `.tool-versions`, take the pnpm version from
  `package.json`, which is the source of truth.
- **Chromium** for the real-browser tests only: `pnpm exec playwright-core install chromium`, or
  set `WASM_IDLE_CHROMIUM_EXECUTABLE` to an existing Chromium binary.

## Install

```sh
pnpm install
```

CI installs with `pnpm install --frozen-lockfile`. `producers/wasm-php` is a separate project
outside the root workspace with its own lockfile; install it with
`pnpm --dir producers/wasm-php install` only when you work on the PHP producer.

## Run the playground

```sh
pnpm dev
```

`pnpm dev` builds the publishable workspace packages (`prepare:app`) and starts the Vite dev
server, which sends the cross-origin isolation headers. The app is served under the `/wasm-idle/`
base path; Vite prints the full URL.

Most runtime assets are committed under `static/`, but some are ignored by Git and must be
prepared before their languages work: see the `static/` entries in `.gitignore`. For the groups it
knows (`clang`, `clangd`, `ocaml`, `c3`, `lfortran`, `lean4` and `commonlisp`), the browser test
asset script downloads pinned copies:

```sh
pnpm run prepare:test-assets -- clang c3
```

Other ignored assets come from their `sync:*` scripts (`pnpm sync:runtime list` lists the
runtimes that `sync:runtime` can sync) or from `pnpm run page:build`, described in
[Deploying the playground](docs/deployment.md#building-the-site).

## Tests

```sh
pnpm test
```

`pnpm test` builds the publishable workspace packages, runs `vitest run` over `src/**/*.test.ts`
(jsdom by default), then runs the Kotlin unit tests. The real-browser suites (`*.playwright.test.ts`) are
skipped unless their switch is set.

To run one file or one test, build the packages once (tests import the built `@wasm-idle/*`
packages) and call Vitest directly:

```sh
pnpm run build:publish-deps
pnpm exec vitest run src/lib/playground/commonlisp.test.ts
pnpm exec vitest run src/lib/playground/index.test.ts -t "Common Lisp"
```

`pnpm test:watch` starts Vitest in watch mode. Workspace packages with their own suites run with
`pnpm --dir packages/<name> test` (`debug`, `llvm-core`, `lsp` and `terminal`).

### Real-browser tests

Most `test:browser:*` scripts set a `WASM_IDLE_RUN_REAL_BROWSER_<NAME>=1` switch and run one
Playwright suite, usually against a local Vite server started by
`scripts/browser-preview-server.mjs`. For example:

```sh
pnpm run test:browser:commonlisp
```

Some suites need prepared assets first (see [Run the playground](#run-the-playground)). CI runs
the browser suites by family; the families are listed in `scripts/runtime-browser-registry.mjs`.
With `WASM_IDLE_REQUIRE_BROWSER_TESTS=1`, a run fails when a required browser test was skipped or
did not pass.

```sh
node scripts/run-all-language-browser-tests.mjs --family=<family>
pnpm run test:browser:languages:full   # the whole matrix
```

## Type checks, formatting and lint

- `pnpm run check` runs `svelte-check` over the app; `pnpm run check:packages` and
  `pnpm run check:runtimes` type-check the workspace packages and runtimes.
- Formatting uses Prettier with tabs, single quotes and a 100-column width (`.prettierrc`).
  Check the files you changed with `pnpm exec prettier --check <files>`, or rewrite them with
  `pnpm exec prettier --write <files>`. `pnpm run format` rewrites the whole repository.
- `pnpm run lint` runs `prettier --check .` and `eslint .`.
- Generated files have their own commands; do not edit them by hand:
    - the README support matrix: `pnpm run support:matrix` (checked by
      `pnpm run check:support-matrix`);
    - `packages/core/src/runtime-asset-lock.generated.ts`: `pnpm run assets:lock` (checked by
      `pnpm run check:assets-lock`);
    - version profiles whose header says they are generated, such as
      `src/lib/playground/wasmCommonLispVersion.ts`: rerun the sync script named there.

## Commits and pull requests

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), as in the
existing history: `type(scope): summary` with an optional scope, for example
`fix(clang): bound stdin and background Worker ownership` or
`feat(golfscript): run the original interpreter on Ruby/WASI`. The types in use are `fix`,
`feat`, `test`, `perf`, `chore`, `ci`, `build`, `docs`, `refactor` and `style`.

Keep each commit and pull request to one coherent change, include tests for behavior changes, and
list the commands you ran in the pull request description.

## Further reading

- [Deploying the playground](docs/deployment.md)
- [Adding a language](docs/adding-a-language.md)
- [Runtime execution and cleanup contract](docs/runtime-execution-contract.md)
- [Persistent runtime asset cache](docs/runtime-asset-cache.md)
