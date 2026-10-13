# @wasm-idle/container

Experimental command-container foundation, version `0.1.0-alpha.0`. This package is opt-in;
existing playground and compiler APIs are unchanged. Only host JavaScript, types and documents
belong in the npm tarball. Runtime assets are separate verified distributions.

The API uses argv arrays and raw byte streams. A normal nonzero guest exit is a process result;
validation/startup failures are typed host errors. `exited` marks cleanup, not consumption of
remaining output. Callers of `spawn` must drain both output streams to release backpressure.
`run` will drain both and deliver stdin EOF. Cancellation and disposal do not delete workspace
data. Persistent storage, actual shell, Clang CLI and BusyBox require separate qualification.

This first stack layer exports API types and errors. Runtime construction is added by the
Supervisor layer; declarations are not a claim that unimplemented adapters are available.

See [development plan](../../docs/container-development-plan.md) and
[compatibility ledger](../../docs/container-compatibility.md).
