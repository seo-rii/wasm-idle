# Adding a language

This checklist lists every place a new playground language touches. It is derived from two recent
additions and the coverage rules that were added after them.

## Policy

`AGENTS.md` sets three rules for new language support:

- It must run the **real language implementation in the browser**, normally a WebAssembly
  compiler, interpreter or runtime.
- Handwritten parsers, translators, emulators or subset executors do **not** count as language
  support.
- It must include **stdin/stdout coverage**, including browser-path tests when the runtime is
  exposed through the web playground.

If the real implementation cannot run in the browser yet, do not register the language. Record it
in `blockedCandidateRows` in `scripts/support-matrix.mjs` (rendered as the blocked-candidates table
in the README) and, where useful, describe the remaining port work under `docs/language-ports/`.
`pnpm run check:support-matrix` fails if a blocked candidate is also registered.

## Reference examples

- **Common Lisp** (`c096b065`, `feat(lang): add Common Lisp via ECL`): upstream ECL built to Wasm
  by a pinned producer, downloaded by a sync script, and run in a fresh static Worker per run with
  streaming stdin. This is the complete pattern for a standalone runtime.
- **GolfScript** (`fab4147e`, merged in #63): the unchanged upstream `golfscript.rb` interpreter
  running on the existing CRuby/WASI runtime. This is the pattern for a language hosted by a runtime
  that is already bundled.

Later changes made more of the list mandatory: `309f6385` (#130) requires every registered
language to have a browser CI owner, and `190d93d8` lets `prepare:test-assets` download ignored
bundles for browser tests.

The paths below use `<lang>` for the lower-case runtime name, `<Lang>` for its file-name form and
`<LANG>` for the canonical language ID (`commonlisp`, `CommonLisp` and `COMMONLISP` for Common
Lisp).

## 1. Runtime assets

- [ ] **Static bundle** in `static/wasm-<lang>/`. Small reviewed assets can be committed
      (`static/wasm-golfscript/`). Downloaded bundles are ignored instead: Common Lisp added
      `/static/wasm-commonlisp/` to `.gitignore`.
- [ ] **Sync script** `scripts/sync-wasm-<lang>.mjs` and a `sync:wasm-<lang>` script in
      `package.json`. Common Lisp also registered its sync in `RUNTIMES` in
      `scripts/sync-runtime.mjs`, so `pnpm sync:runtime wasm-commonlisp` runs it; `manual: true`
      keeps it out of `pnpm sync:runtimes`. Sources built in this repository live in `runtimes/`
      (`runtimes/esolangs/golfscript/` holds the vendored GolfScript interpreter).
- [ ] **Asset lock** `scripts/wasm-<lang>-assets.lock.json` with the pinned producer revision and
      the size and SHA-256 of every file, including decoded hashes for gzip payloads.
- [ ] **Version profile** `src/lib/playground/wasm<Lang>Version.ts`. In the Common Lisp pattern
      the sync script generates it from the lock together with the runner Worker's receipt, so it
      is never edited by hand.
- [ ] **Delivery format**: store gzip payloads as `.gz.bin` so hosts never add
      `Content-Encoding` (see [Deploying the playground](deployment.md#gzbin-and-bin-storage)).
- [ ] **Page build**: run the sync from `page:build`, directly or through `sync:page-runtimes`,
      when deployments must rebuild the bundle. Common Lisp added `sync:wasm-commonlisp` to
      `page:build`.
- [ ] **Browser test assets**: for an ignored bundle, add a group to `ASSET_GROUPS` in
      `scripts/prepare-browser-test-assets.mjs`, with its downloads in
      `scripts/browser-test-assets.v1.json` or a call to the sync script (as Lean 4 and Common
      Lisp do). Then map the test's `WASM_IDLE_RUN_REAL_BROWSER_<LANG>` switch to that group in
      `BROWSER_TEST_ASSET_ENVIRONMENTS` in `scripts/run-all-language-browser-tests.mjs`; CI
      prepares only the groups mapped from the switches a browser run sets.
- [ ] **Size budget**: a `wasm-<lang>` entry in `scripts/static-asset-budgets.v1.json`
      (`"optional": true` for ignored bundles) and a raised `total` if needed; checked by
      `pnpm run check:asset-sizes`.
- [ ] **Release lock**: `pnpm run assets:lock` regenerates
      `packages/core/src/runtime-asset-lock.generated.ts`, which covers the files under
      `static/wasm-*` (see
      [the persistent asset cache](runtime-asset-cache.md#updating-the-release-lock)).

## 2. Worker

- [ ] **Runner Worker**. Static runtimes keep their Worker source in
      `scripts/runtime-workers/wasm-<lang>-runner-worker.js`; the sync script copies it to
      `static/wasm-<lang>/runner-worker.js` and records its receipt in the generated profile.
      Runtimes with a TypeScript Worker use `src/lib/playground/worker/<lang>.ts`; GolfScript
      extended `worker/ruby.ts` and added `worker/golfscriptMount.ts`.
- [ ] **Shared stdin ring**. A Worker that reads stdin through the `wasm-idle-static-stdin-ring`
      protocol must be listed in `src/lib/playground/staticStdinRingConsumers.test.ts`, which fails
      when a Worker in `scripts/runtime-workers/` uses the protocol without an entry. Add the reader
      to the wake-up race tests in `src/lib/playground/staticStdinRingWorker.test.ts` too.

## 3. Adapter

- [ ] **Sandbox class** `src/lib/playground/<lang>.ts` with a default export. Common Lisp extends
      `StaticWorkerRuntimeSandbox` (`src/lib/playground/staticWorkerRuntime.ts`) and sets
      `languageId`, `defaultActivePath`, `workerLifetime`, `stdin` (`mode: 'streaming'` with a
      `sourceHintPattern`), and asset resolution and preflight hooks. GolfScript subclasses the
      Ruby sandbox.
- [ ] **Asset module** `src/lib/playground/<lang>Assets.ts` that resolves the runtime asset
      configuration and verifies downloads against the generated profile before the Worker starts.
- [ ] Follow the [runtime execution and cleanup contract](runtime-execution-contract.md) for
      output, cancellation and disposal.

## 4. Registration

- [ ] `packages/core/src/languages.ts`: add the canonical ID to `canonicalLanguageIds` (exported
      as `supportedLanguageIds`) and any aliases to `languageAliasDefinitions` with their kind
      (`spelling`, `compatibility`, `dialect` or `implementation`).
- [ ] `packages/core/src/runtime-assets.ts`: add the runtime's options to `RuntimeAssetKeySource`
      and each field to `RUNTIME_ASSET_KEY_FIELDS` (or `RUNTIME_ASSET_LOADER_FIELDS` for loader
      callbacks). The `RUNTIME_ASSET_FIELD_COVERAGE` type check fails when a declared field has
      no entry.
- [ ] `src/lib/playground/index.ts`: add a `sandboxRoutes` entry that lazily imports the adapter.
- [ ] `src/lib/playground/applicationAssets.ts`: add the default asset URLs under the application
      root in `createApplicationRuntimeAssets`. Runtimes with a resolver in
      `src/lib/playground/assets.ts` (GolfScript, Gleam) add it there.

## 5. Editor and page

- [ ] `src/routes/language-registry.ts`: add a `playgroundLanguageDescriptors` entry with `label`
      and `editorLanguage`, plus `supportsArgs`/`argsLabel`, `compilerDiagnostics`,
      `diagnosticMarkers` or an LSP field where they apply. If the Monaco language needs a
      basic-language contribution, add its loader to `monacoLanguageContributionLoaders`.
- [ ] `src/routes/editor-defaults.ts`: add the key to the `EditorDefaultLanguage` union and the
      `editorDefaults` type, a sample program that reads stdin, and the sample to
      `isEditorDefaultSource`.
- [ ] `src/routes/+page.svelte`: file extensions in `languageForPath`, the default file name in
      `defaultPathForLanguage`, the editor-default key in `defaultSourceForLanguage`, `?lang=`
      aliases in `normalizeRequestedLanguage`, and an optional `{#if language === '<LANG>'}` hint.

## 6. Language server (optional)

- [ ] A server under `packages/lsp/src/<lang>/` and a value in `RuntimeLspCapability` used as the
      descriptor's `runtimeLspCapability`. Languages served by clangd, .NET or TypeScript set
      `lspProvider` instead.
- [ ] Wire the enable flag and runtime configuration through `src/routes/+page.svelte` and
      `src/routes/Monaco.svelte`, and cover it with `src/routes/<lang>-lsp-integrity.test.ts`.
- [ ] Add a case to `src/routes/monaco-lsp.playwright.test.ts`.

## 7. Support matrix and browser CI

- [ ] `scripts/support-matrix.mjs`: add a `supportMatrixRows` entry (`language`, `ids`,
      `runtime`, `stdin`, `editorSupport`, `debug` and `browserTest` with the test `file`, its `env`
      switch and a `marker` or `language`) and a `runtimeDetailsByLanguage` entry. Then run
      `pnpm run support:matrix`, which regenerates the README support matrix.
      `pnpm run check:support-matrix` (run in CI) checks that the rows match
      `supportedLanguageIds`, that the browser test file contains the switch and marker, and that
      the README is current.
- [ ] `scripts/runtime-browser-registry.mjs`: assign the runtime to one browser CI family.
      `src/lib/changed-browser-families.test.ts` fails unless every supported language has exactly
      one owner.
- [ ] `package.json`: add `test:browser:<lang>`, setting `WASM_IDLE_RUN_REAL_BROWSER_<LANG>=1`.

## 8. Tests

Unit tests:

- [ ] `src/lib/playground/<lang>.test.ts` for the adapter, plus runtime tests where the real
      implementation can run under Node (GolfScript's `worker/golfscript.runtime.test.ts` runs the
      interpreter on the bundled Ruby VM).
- [ ] `src/lib/playground/index.test.ts`: a `vi.mock('$lib/playground/<lang>')` entry and alias
      routing. Its "loads every canonical language declared by Core" test covers every ID.
- [ ] `src/lib/playground/runtime-progress-readiness.test.ts`: a `runtimeReadinessAudit` entry;
      the test requires one for every supported language.
- [ ] `src/lib/playground/applicationAssets.test.ts` for new default asset keys, and
      `src/lib/sync-wasm-<lang>.test.ts` for the sync script.

Browser tests:

- [ ] A real-browser test in `src/lib/playground/<lang>.playwright.test.ts`, or a case in a
      shared suite (`stdin.playwright.test.ts`, `static-worker-runtimes.playwright.test.ts`,
      `esolangs.playwright.test.ts`). Skip it unless `WASM_IDLE_RUN_REAL_BROWSER_<LANG>=1` is set,
      and set `requiredBrowser` in the test meta when the switch is on, so that a run with
      `WASM_IDLE_REQUIRE_BROWSER_TESTS=1` fails if the test was filtered, skipped or did not pass
      (`scripts/required-browser-reporter.mjs`).
- [ ] Cover stdout and stdin through the page: delayed input, EOF and a nonzero exit or error.
      The Common Lisp test checks delayed stdin, EOF, conditions, workspace files, limits and
      cancellation, and drives the language selector, Monaco editor and terminal.

## 9. Documentation

- [ ] The README support matrix comes from `pnpm run support:matrix`; do not edit it by hand.
- [ ] Add `docs/<lang>.md` when the runtime has setup or limits worth explaining
      (`docs/commonlisp.md`, `docs/lean4.md`).

## Validation

```sh
pnpm run build:publish-deps
pnpm exec vitest run src/lib/playground/<lang>.test.ts src/lib/playground/index.test.ts \
	src/lib/playground/runtime-progress-readiness.test.ts src/lib/changed-browser-families.test.ts
pnpm run check:support-matrix
pnpm run check:asset-sizes
pnpm run test:browser:<lang>
```
