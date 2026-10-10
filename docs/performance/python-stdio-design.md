# Python standard streams and bounded output delivery

## Preserve language behavior, optimize the transport

Replacing builtins.print with JavaScript makes every call cross the language boundary and risks changing sep, end, file, flush, binary-stream and error behavior. The browser worker instead retains native Python print/input and configures Pyodide's standard streams. stdout/stderr bytes pass through independent streaming UTF-8 decoders; split multibyte sequences must not corrupt output or mix decoder state across streams.

Output is accumulated into bounded messages, by default at most 16K UTF-16 code units. Batching reduces host message overhead, not the user's Python instruction count. Time checks occur during synchronous writes as well as timers: a timer alone cannot deliver output while Wasm occupies its event loop. The stream flush observer distinguishes explicit print(flush=True), sys.stdout.flush and binary flush from implicit line flushing, which must not force one message per line.

Pending output is drained before stdin waits, debug pauses, successful completion and errors. A prompt must be visible before the user is asked to answer it; an exception must not discard earlier output. Unsupported mutable-stream hooks fall back to unbatched native I/O instead of silently losing explicit flush semantics. Normal Python LF output replaces the old JavaScript imitation's unconditional CRLF; browser terminal presentation still needs its own test.

## Ownership and integration

The fixed observer factory is compiled once for a runtime. Per-run restore proxies, input buffers, pending timers and decoders belong to that execution and are cleaned up on success/error. Preserve native stream identity and custom file destinations. Aheui/APECode use their existing separate descriptor path and are not migrated by this change. Hy uses its real compiler and the shared normal stream boundary, not a replacement evaluator.

The helper/cache and debugger PRs touch the same python.ts and must be integrated deliberately. Combining them should remove obsolete callbacks once, retain native stream setup in normal/debug/Hy paths, and preserve the before-pause/before-input flush points. Three independent PR test passes do not prove their merged behavior.

## CI repair without dropping coverage

The prior Python/Hy dispatch mocks lacked setStdin/setStdout/setStderr and the fixed runPython flush factory. They now implement that explicit boundary and simulate user output through the configured byte writer. All asset receipt, lockfile, package allowlist, preparation lifetime, retry, module ordering, Blob URL disposal, Hy compiler invocation and failure assertions remain. These dispatch mocks test routing, not Python semantics.

A separately collected integration test boots the actual pinned Pyodide package and executes real Python. It checks empty input, Korean/emoji input and a 60000-byte input; byte count/checksum; immediate explicit prompt flushing; a UTF-8 character split across binary writes; bounded messages; unchanged native print/stdout identity; and exception cleanup. The native Python and actual-source JavaScript harnesses are now collected by normal root CI as well.

Actually executed locally using the CI dependency snapshot: Node 24.21.0 / TypeScript 6.0.3 / Vitest 5.0.3, 34 Python/Hy dispatch tests, the real-Pyodide matrix test, and both harness collection checks (14 nested JS tests and six native Python tests). The focused local configuration is not a full Svelte build. Pyodide runs here in Node; browser terminal rendering and browser speed are not inferred from it.

## Performance acceptance

Compare many short prints, large binary writes, stdin.buffer.read, interactive prompts, explicit flush followed by a long CPU loop, errors, and repeated executions. Record first-output latency, total wall time, output message count, bridge overhead and retained memory with equal output. A reduction in messages can still lose overall if hook overhead is larger. There is no measured browser speedup percentage or smaller Python interpreter binary in this PR.
