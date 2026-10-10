# C LSP failure: workspace restoration must precede language selection

## Observed failure

The completed #74 CI run 38021565979, job 114123483557, failed the initial clean-C
assertion: three markers were returned instead of zero. Its trace records a ready
clangd, `language=CPP`, `file:///workspace/main.cpp`, `-x c++`, and the C fixture
`int class = 42`. That identifier is valid C but not C++. This was not a compiler
crash, an asset hash failure, or a missing diagnostic timeout. The browser matrix
stopped at C; a successful static matrix-selection test is not proof that every
language case completed. This corrects the earlier PR description's less precise
failure characterization.

The selector previously became actionable before the parent's initial shared or
stored workspace restoration completed. The existing `workspaceInitialized` state
already expresses that ownership boundary, but the selector did not use it.

## Repair

The real product disables the language selector until `workspaceInitialized` and
ignores premature programmatic change events. It exposes that same state as a
non-privileged DOM data attribute. No runtime/language is enabled by this flag.

The LSP browser probe waits for the restored workspace and a live Monaco model,
then selects a language. After the existing selector/tab/textarea checks, it checks
the exact selected language and active model URI together. It does not rewrite a
mismatched model, retry the language switch, relax diagnostics, or insert a sleep.
The clean → broken → corrected source assertions, asset pins and CSP checks remain.

Nine focused tests exercise the actual readiness predicates with controlled DOM
states, including the precise C-selection/C++-model mismatch, missing editor,
disabled selector, wrong directory and a legitimately empty restored document.
A source contract ties the product selector and event guard to restoration state.
These are deterministic host tests, not browser execution. The normal real Chromium
LSP matrix is the separate integration gate.

## Validation and editing provenance

The interactive container was unavailable during this follow-up. Actual execution
results must therefore come from linked GitHub Actions runs, not a claimed local
run. Two large existing files were transformed from fixed Git blobs in a temporary
Actions job that verified unique replacement contexts and only created unreferenced
Git blobs. It neither checked out/executed PR code nor updated any branch. The job
file is removed in the repair commit; no automatic write-back workflow remains.
Final branch updates use a checked, non-forced Git ref lease through the connector.

The product change is a startup correctness fix, not measured compiler speedup.
Playwright's hydration guidance also recommends keeping controls disabled until
they are functional: https://playwright.dev/docs/navigations#hydration.
