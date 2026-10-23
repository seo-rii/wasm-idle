# LLDB first pause and runtime preparation

The product session requests one frame when the target stops. It publishes the navigable
source location, frame ID, source digest and stop reason before asking for scopes or deeper
frames. `pauseDetails` events carry the same `sessionId`/`stopId` and fill in scope metadata and stack
pages of at most 20 frames, retaining the previous 100-frame limit. Continue, disconnect and
new stops invalidate pending results. The debug controller merges details without resetting
the selected frame, formatted argument summaries or in-flight variable requests. Variable
values and non-selected-frame scopes still use the existing demand-driven APIs.
The `callStackComplete` flag becomes true when the retained stack is complete. Variable
comparison waits for complete caller identities, preserving the previous stop's values
and saved expansion paths while pages arrive. Partial stacks never seed the next baseline.

Preflight downloads at most three runtime assets concurrently. Every retained network chunk
and cache hit is charged to the same 55,000,000-byte budget before hashing or allocation of
the owned chunk. Any failure aborts the other requests and settles their readers. All six
manifest hashes must pass before workers are created.

The pinned LLDB/WAMR glue does not support `Module.instantiateWasm`, so its verified blob
loader remains unchanged. New producer assets may advertise the versioned
`moduleInstantiation: "emscripten-instantiate-wasm-v1"` contract, bound to their receipts.
With **both** that contract and `compiledModuleCache: true`, preflight first verifies all six
assets and then compiles/reuses immutable Modules keyed by Wasm SHA-256 and byte length.
The bounded LRU holds at most two Modules representing 55,000,000 source Wasm bytes. This
is an input-size accounting bound, **not a bound on engine compiled-code RSS**.
Every launch creates fresh workers, imports, memory, queues and WebAssembly instances;
failed compiles are evicted and disposal prevents late compilation from creating workers.
No generated glue or global WebAssembly function is patched.

Module reuse is **opt-in and disabled by default**, including for new producer assets.
The initial sequential candidate samples did not establish an end-to-end speedup, so
producer support alone does not promote the cache into the default execution path.
The current release pin is unchanged. A normal producer build, validated release receipts,
and separate release/pin approval remain necessary before new deployed assets are selected.

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

The preview playground UI also passed the actual C data-breakpoint, C++ data-breakpoint and C trap callbacks under strict CSP. The fixture waits for non-empty scopes on the observed stopped frame ID. Broader cases are left to remote CI; missing local Container assets and a dev-worker setup failure were excluded from passing evidence.

## Producer-backed immutable Module experiment

The optional `--debug-assets DIR --debug-manifest-sha256 SHA256 --cache-mode both` probe
path consumes a locally assembled candidate with matching producer receipts. It uses the
same candidate bytes for two cache-disabled sessions followed by two cache-enabled
sessions. A test-only observation in our loader boundary counts successful
`instantiateWasm` callbacks; generated Emscripten glue is unchanged. The probe asserts one
callback per supported runtime on enabled launches, zero when disabled, identical Module
IDs across enabled launches, eight fresh workers and eight fresh queues, stack/source/locals
correctness, successful output and strict CSP. These sequential clocks are exploratory:
Chromium internal code caching, tiering and shared-host load are not isolated.

The LLDB candidate was derived through the pinned Emscripten 6.0.0 official experimental
`--post-link` path from the verified release Wasm; it is not a full source rebuild and its
Wasm bytes changed during reoptimization. WAMR was rebuilt from its pinned source and
current patch set. The producer experiment receipt binds the original manifest, source
Wasm digest, feature-recovery/post-link commands and generated output digests. Normal
release assembly rejects an experimental derivation. Baseline correctness and candidate
cache behavior are reported separately; no baseline-to-candidate timing delta is
attributed to module caching.

Final Chromium 153.0.8010.12 evidence:

- [Pinned baseline](../../scripts/performance-results/lldb-module-cache-baseline-20261023.json): two successful fresh sessions, zero injected hook calls, four distinct workers/queues and no CSP violations.
- [Identical candidate, cache off/on](../../scripts/performance-results/lldb-module-cache-candidate-20261023.json): four successful fresh sessions, zero hook calls in each disabled runtime and exactly one actual callback in each enabled runtime per launch; both Module IDs are reused across enabled launches, with eight distinct workers/queues and no CSP violations.

The two producer runtimes remain disabled from Module caching by default. These results
prove the supported callback and state isolation, not an end-to-end latency improvement.
