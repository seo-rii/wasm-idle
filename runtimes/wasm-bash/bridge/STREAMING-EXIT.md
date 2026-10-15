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
its original exit code and `ok: code === 0`, and rejects if that receiver is lost.
It neither closes stdin nor reads, locks, cancels or buffers stdout/stderr.
Output can still be buffered when exit completes. The caller must drain both
outputs concurrently, deliver stdin EOF when appropriate, and release its stream
locks. Slow or absent consumers can keep a guest waiting under backpressure.
Owner-controlled cancellation and Worker-group cleanup are unchanged.

The legacy `wait()` implementation and output type are unchanged. It closes
unlocked stdin, captures unlocked outputs, and leaves already locked streams to
the caller through the existing `streams::read_to_end()` behavior. The new method
makes stream ownership explicit and independent of lock-acquisition timing.

The patch adds two `wasm_bindgen_test` cases using the SDK's real byte pipes:
unlocked streams and output endpoints that remain open when exit arrives;
retained binary output and still-writable input; statuses 0, 23, 126 and 255;
pre-existing caller readers/writer; and a lost exit channel. These tests require
the actual patched SDK's browser test environment. A source/preparation test is
available without downloading or building the SDK:

```sh
CONTAINER_SDK_SOURCE=/absolute/path/to/verified/wasmer-sdk \
  node --test scripts/verify-container-shell-instance-exit.test.mjs
```

That command verifies application to the exact pinned source and unchanged legacy
methods. It does not execute the Rust browser tests or qualify actual Bash. The
combined SDK typecheck/build and shell streaming fixture must establish those
separate gates before promotion.
