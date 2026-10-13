# Runtime execution and cleanup contract

`createPlaygroundBinding()` applies the same admission and lifecycle boundary to legacy
`load()` / `run()` and structured `execute()`. Structured execution retains its
`ExecutionRequest` / `ExecutionResult` contract; the legacy entry points remain supported.

## Requests and output

Admission copies argument arrays, compiler/program arguments, environment values, breakpoint
arrays and their source locations before asynchronous dispatch. Workspace validation copies
binary contents and resolves limits synchronously. Abort signals and streaming stdin remain
live capabilities, not copied data. Runtime-specific extension objects outside these common
options remain the adapter's responsibility.

Output and compiler diagnostics are delivered only while their operation is active and its
caller has not settled. Each installed sink captures an operation generation, so a captured
old sink cannot deliver into a subsequent operation. Adapters must capture these sinks for
their event producers, or check Worker/session/run identities before calling the current
sink. Untagged stale events that dynamically look up a new operation's `sandbox.output`
cannot be distinguished by the common boundary. `WorkerSession` provides identity checks
for Worker-backed adapters; a Worker boundary alone does not establish origin isolation.

## Cancellation and recovery

An adapter's `cancel()` must stop the current generation and settle every pending operation
from that generation before its cancellation promise resolves. `dispose()` must stop all
event producers and settle every pending operation. Cleanup must be idempotent.

An abort, timeout, explicit `cancel()` / `kill()` / `terminate()`, or output/diagnostic limit settles the caller promptly and immediately mutes
its sinks. The sandbox remains busy while the original operation and cancellation cleanup
settle. Successful cooperative cleanup permits reuse. If either is still pending after
1,000 ms, or cancellation throws/rejects, the binding retires the instance and attempts
disposal. The original cancellation/limit/timeout error remains authoritative.

Explicit cancellation methods return a promise that waits for both the cancelled operation
and its cleanup to settle; cleanup failure rejects it, and the same 1,000 ms deadline bounds
that wait. Repeated requests during cancellation share this promise. When there is no active
operation, these methods retain the adapter's own behavior. `cancel(runId)` also remains
adapter-owned: only the adapter can match its protocol run IDs, so cancelling an old run must
not retire an unrelated current operation.

A retired instance permanently rejects new operations with `RuntimeConfigurationError`
(`phase: 'dispose'`). Recover by calling `binding.load(language)` for a fresh instance; loaders
must produce distinct instances. The boundary never admits a second operation onto a retired
instance. Explicit disposal rejects with `TimeoutError` if adapter disposal does not settle
within 1,000 ms. This bounds the host's wait and isolates later execution; it cannot reclaim
resources that a broken adapter refuses to release, or preempt synchronous blocking JavaScript.

Individual disposal immediately unregisters the instance from its binding, including failed
or timed-out disposal. Disposal can be observed through that instance's cached promise; the
binding does not retain it to retry failed cleanup. Prewarming becomes eligible again once
the final live consumer for that language/asset key has disposed. Binding disposal attempts
all still-owned resources, waits for all attempts, and reports an `AggregateError` with each
failure. Worker lifetime bulk disposal and idle eviction likewise attempt every selected
Worker and aggregate synchronous cleanup errors; removed Workers are never offered for reuse.

Execution phase limits and Worker idle timeouts accept integer milliseconds from 1 through
2,147,483,647. Byte/resource budgets do not inherit that timer ceiling.

## Node outcomes

`runWasmIdleInNode()` preserves its `ok`, `result`, `error` and timing fields when cleanup
fails. It attempts disposal even if `clearAfterRun` fails, then returns the independent errors
in optional `cleanupErrors`. `ok` continues to describe program execution, not cleanup.

`executeWasmIdleInNode()` returns `NodeExecutionResult`, which extends `ExecutionResult` with
optional `cleanupErrors`. A successful result or structured runtime error remains intact if
disposal fails. If execution throws and cleanup also fails, it throws
`NodeExecutionCleanupError`: `cause` is the original execution error, `cleanupErrors` contains
cleanup failures, and `errors` contains both in execution-then-cleanup order. With successful
cleanup, thrown errors retain their original identity.

The focused suites inject stalled operations, stalled/throwing cleanup, late callbacks, caller
mutations and timer overflow. They validate the shared contract independently of real compiler
or browser integration tests; each adapter still needs to enforce its own event provenance and
resource termination.
