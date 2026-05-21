# RISK_REGISTER.md

## ARCH-001 Upstream browser patch set is still draft-only

The repository contains patch intents for Binaryen bridging, sourcemap disabling, precompiled runtime enforcement, and browser `cps` defaults, but not apply-ready diffs against a pinned `js_of_ocaml` commit.

Plan:
- pin a `js_of_ocaml` source checkout in the frozen switch bootstrap flow
- turn each draft patch note into a real diff
- add fixture coverage once the patches apply cleanly

## ARCH-002 Bytecode substrate choice remains open

The compile API and worker contract are implemented, but the actual bytecode substrate is still unresolved between a WASI-based runner, an `ocamlrun.wasm` path, or a custom host bridge.

Plan:
- prototype one substrate behind `runtime/system-dispatch.ts`
- measure filesystem and subprocess assumptions
- lock the substrate before wiring real browser compile tests

## BUILD-001 Browser-native bundle prep still emits git metadata warnings

`prepare-browser-native` consistently logs `fatal: not a git repository` while rebuilding the browser-native tools. The build still succeeds, but the warning pollutes CI and may hide a real metadata dependency inside the generated tool path.

Plan:
- trace which upstream `js_of_ocaml` or `wasm_of_ocaml` code path shells out to git during browser bundle preparation
- either vendor the expected version metadata or patch the probe out in browser mode
- make the prepare step warning-clean before widening CI coverage further
