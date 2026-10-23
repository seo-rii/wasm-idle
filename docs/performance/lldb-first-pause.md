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

The built-in worker path keeps at most two immutable `WebAssembly.Module` promises, keyed by
the verified runtime digest. It does not retain sessions, workers, queues, instances, memories
or filesystems. Emscripten receives an `instantiateWasm` hook that creates a new Instance with
the new factory's imports. Verified bytes and blob URLs remain subject to the existing
integrity and CSP gates. Custom worker factories retain their existing loading policy.

Run the pinned browser regression after `prepare:test-assets -- clang` and
`prepare:wasm-debug-release`:

```sh
node scripts/probe-lldb-first-pause.mjs --json /tmp/lldb-first-pause.json
```

The probe compiles real C DWARF, stops at the bottom of a 120-level recursion, checks the
one-frame initial pause and subsequent 100-frame stack, continues to successful output, then
repeats with fresh workers. It enforces strict CSP and cross-origin isolation, and verifies
that two relaunches share exactly two runtime compilations. Cold versus warm timing is
descriptive evidence; browser tiering, network/cache state and host load also affect it.
