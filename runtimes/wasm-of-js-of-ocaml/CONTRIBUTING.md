# Contributing

Thanks for taking the time to improve `wasm-of-js-of-ocaml`.

This project is still in an experimental bring-up phase. Contributions are most useful when they keep the frozen browser toolchain model explicit and avoid adding assumptions from a full native shell, opam switch, or dune workspace.

## Development Setup

Install JavaScript dependencies:

```sh
npm ci
```

Bootstrap host tools:

```sh
npm run bootstrap:host-tools
```

Build the pinned host switch:

```sh
PATH="$PWD/.cache/binaryen-version_129/bin:$PATH" npm run toolchain:bootstrap
```

Build TypeScript output:

```sh
npm run build
```

Prepare the browser-native bundle:

```sh
npm run prepare:browser-native -- --force
```

## Test Before Sending Changes

For TypeScript-only changes:

```sh
npm run check
```

For bundle metadata and bridge contract changes:

```sh
npm run test:browser-native-bundle
```

For full browser-native validation:

```sh
npx playwright install --with-deps chromium
npm run test:browser-native
```

For CI parity:

```sh
npm run test:ci
```

## Design Rules

- Keep browser subprocess support explicit and allowlisted.
- Prefer static local assets over runtime HTTP APIs.
- Do not add shell emulation as a workaround for upstream command assumptions.
- Keep browser output observable through `CompileResult` artifacts, diagnostics, stdout, and stderr.
- Treat package support as recipe-based and frozen.
- Preserve the `fast` Binaryen mode as the default unless a change demonstrably lowers browser memory use.

## Pull Request Guidelines

- Use conventional commit messages such as `feat: ...`, `fix: ...`, `docs: ...`, or `test: ...`.
- Include tests for bridge behavior, bundle metadata, or browser execution when changing runtime behavior.
- Update documentation when changing public API, manifest format, scripts, or bundle layout.
- Keep generated caches such as `.cache/`, `dist/`, and Playwright output out of commits.

## Adding A Package

Package support should stay explicit.

1. Add the package to `toolchain/recipes/frozen-toolchain.browser.json`.
2. Ensure it can be represented by bytecode archives and metadata copied from the frozen switch.
3. Add or update fixture coverage under `fixtures/`.
4. Extend browser-native tests to compile the fixture for the relevant targets.
5. Document runtime assets or limitations if the package requires special handling.

## Reporting Problems

Include:

- Operating system and Node.js version.
- Command that failed.
- Whether the failure is host pipeline, bundle preparation, browser-native compile, or runtime execution.
- Relevant `stderr`, diagnostics, and generated manifest details.
- Browser name/version for browser-native issues.
