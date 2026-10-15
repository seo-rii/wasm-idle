# Caller-owned streams and exit-only completion

Patch `0016-streaming-instance-exit.patch` adds a separate completion API to the
pinned SDK's `Instance`:

```ts
type ExitStatus = {
  readonly code: number;
  readonly ok: boolean;
};

const { stdin, stdout, stderr } = instance;
const exited: Promise<ExitStatus> = instance.waitForExit();
```

Like the existing `wait()`, `waitForExit()` consumes the `Instance`; retain the
stream properties first. It waits for the same actual task exit receiver, returns
its original guest exit code and `ok: code === 0`. It rejects if the receiver is
lost or the runner reports setup failure or a runtime trap without a guest exit
status. The diagnostic chain is retained. A guest's deliberate exit 1 still
resolves with code 1; the consumer can distinguish it from a host/runtime failure.
It neither closes stdin nor reads, locks, cancels or buffers stdout/stderr.
Output can still be buffered when exit completes. The caller must drain both
outputs concurrently, deliver stdin EOF when appropriate, and release its stream
locks. Slow or absent consumers can keep a guest waiting under backpressure.
Owner-controlled cancellation and Worker-group cleanup are unchanged.

The legacy `wait()` behavior and output type are unchanged. It closes
unlocked stdin, captures unlocked outputs, and leaves already locked streams to
the caller through the existing `streams::read_to_end()` behavior. The new method
makes stream ownership explicit and independent of lock-acquisition timing.

The patch adds three `wasm_bindgen_test` cases using the SDK's real byte pipes:
unlocked streams and output endpoints that remain open when exit arrives;
retained binary output and still-writable input; statuses 0, 23, 126 and 255;
pre-existing caller readers/writer; a lost exit channel; and an actual runner
error classification reaching streaming rejection. These tests require
the actual patched SDK's browser test environment. A source/preparation test is
available without downloading or building the SDK:

```sh
CONTAINER_SDK_SOURCE=/absolute/path/to/verified/wasmer-sdk \
  node --test scripts/verify-container-shell-instance-exit.test.mjs
```

That command verifies application to the exact pinned source and preserved legacy
stream handling. The native bridge suite directly exercises the installed exit
classifier, including guest nonzero status and the legacy failure projection.
Neither check executes the Rust browser tests or qualifies actual Bash. The
combined SDK typecheck/build and shell streaming fixture establish separate gates.

The SDK/WASIX/virtual-fs source inventory at `37775cd3`, including runtime-error
classification and patch `0020` for an explicitly mounted `/tmp`, passes the real
offline Rust check, clean release build, matching web bindings, static Wasm
inspection, and local index/Worker packaging. See
[`evidence.streaming-startup-sdk-build.json`](./evidence.streaming-startup-sdk-build.json)
and its six process receipts. All 625 pinned source/tool inputs remained unchanged
and every owned build process was reaped. The shared module is 9,262,448 bytes,
SHA-256 `11063fe5d9d5d16880cb1027e50a07841271e78709788de5b65cc6b9100ea34a`.
The earlier `a63df266` build record remains historical evidence and does not include
these startup fixes.

The corresponding
[source-material receipt](./evidence.streaming-startup-source-pack.json) covers
the exact patched sources, Bash materials, Rust standard-library source and 477
locked registry archives. Source status remains `incomplete`: identified notice
and source-to-binary review gaps are retained in that receipt. Build and source
pack evidence do not claim that the Rust browser tests or actual Bash streaming
fixture ran; the consumer PR records those execution gates separately.
