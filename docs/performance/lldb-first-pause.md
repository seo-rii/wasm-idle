# LLDB first pause and runtime preparation

The product session requests one frame when the target stops. It publishes the navigable
source location, frame ID, source digest and stop reason before asking for scopes or deeper
frames. `pauseDetails` events carry the same `stopId` and fill in scope metadata and stack
pages of at most 20 frames, retaining the previous 100-frame limit. Continue, disconnect and
new stops invalidate pending results. The debug controller merges details without resetting
the selected frame, formatted argument summaries or in-flight variable requests. Variable
values and non-selected-frame scopes still use the existing demand-driven APIs.

Preflight downloads at most three runtime assets concurrently. Every retained network chunk
and cache hit is charged to the same 55,000,000-byte budget before hashing or allocation of
the owned chunk. Any failure aborts the other requests and settles their readers. All six
manifest hashes must pass before workers are created.

The current pinned LLDB glue explicitly rejects `Module.instantiateWasm`, and the WAMR glue
omits that hook. Their `wasmBinary` constructor input is also unavailable. An actual pinned
Chromium run caught this producer contract mismatch. Consequently this change preserves the
existing verified blob loader and fresh workers/instances, without injecting a compiled Module
or altering global WebAssembly functions. Immutable compiled-module reuse needs a producer
release that explicitly supports the hook, matching receipts, and browser validation; it is
not an optimization delivered by this consumer PR.

Run the pinned browser regression after `prepare:test-assets -- clang` and
`prepare:wasm-debug-release`:

```sh
node scripts/probe-lldb-first-pause.mjs --json /tmp/lldb-first-pause.json
```

The probe compiles real C DWARF, stops at the bottom of a 120-level recursion, checks the
one-frame initial pause and subsequent 100-frame stack, continues to successful output, then
repeats with fresh workers. It enforces strict CSP and cross-origin isolation, and verifies
correct top/caller locals on two fresh launches. Cold versus warm timing is
descriptive evidence; browser tiering, network/cache state and host load also affect it.

## Pinned Chromium evidence (2026-10-23)

[Raw results](../../scripts/performance-results/lldb-first-pause-20261023.json) passed under Chromium 153.0.8010.12 with cross-origin isolation and no CSP violations. Both fresh sessions stopped at the correct `main.c:4` location with one frame, then published cumulative stack lengths 21/41/61/81/100. All 100 frame IDs were unique. Demand-loaded locals were `n = 0` for the top frame and `n = 1` for its caller, and both sessions continued to `done` and exit zero.

| Fresh session | First pause (ms) | Scope metadata (ms) | Complete 100-frame stack (ms) |
| ------------- | ---------------: | ------------------: | ----------------------------: |
| 1             |          3,208.8 |             3,226.1 |                       3,360.6 |
| 2             |          4,343.8 |             4,544.9 |                       4,707.5 |

These clocks start before session startup and include preflight/runtime preparation. The first pause precedes complete stack details by 151.8 and 363.8 ms in these runs. This demonstrates progressive delivery in the new path, not a measured baseline speedup; additional paging requests and shared-host scheduling affect the later completion time. No cold/warm Module-cache claim is made. Gated unit tests separately verify that pending scopes/deep-stack responses cannot delay the initial pause or update a resumed/newer stop.

The targeted pinned probe passed; the broader playground UI Playwright suite was updated to wait for progressive stack completion where appropriate but was not executed for this change.
