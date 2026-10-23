# Experimental LLVM tool host

`createLlvmToolHost({ tools, createBindings })` is an opt-in low-level boundary for
existing producer command modules. `tools` contains `clang` and `wasm-ld`, each
with `{ bytes: Uint8Array, sha256: string }`. The host snapshots both inputs,
verifies their application-supplied SHA-256 pins with Core, then compiles them.
It does not fetch a URL, load a remote manifest, patch a binary, or change the
existing high-level compiler API. Producer receipts still require their existing
producer-specific verification before the host receives these pins.

`createLlvmToolHostFromServices({ services, createBindings, ... })` is the optional
owner-cache path. Each `clang`/`wasm-ld` service is a single-use endpoint created
with Core's `createPreparedRuntimeWasmModuleService`, together with its pinned
byte length/digest, authorization identity, compile key and asset limit. The
endpoint owns a snapshot of the actual source and verifies it even on a cache hit.
The client compares the returned receipt/profile before accepting the module.
These ports are trusted owner capabilities; this API does not accept a raw
`WebAssembly.Module` accompanied by a caller-claimed digest.

The owner must validate memory sections in the bytes before compilation and use
a distinct authorization/compile key for every different admission or transform
profile. The worker's `validateModule` callback still runs for every prepared host,
including cache hits. Only immutable modules are shared; every `run()` creates
fresh instances and bindings. Endpoint cancellation and timeouts release the
client ports. Hosts must close their owner endpoints when the invocation ends.

After preparation, `host.run({ executable, argv, cwd, env })` is synchronous.
`executable` is exactly `clang` or `wasm-ld`; `argv` is the complete original native
argument vector, including `argv[0]`. Later empty arguments are preserved. Cwd is
an absolute POSIX path; environment keys and values are snapshotted. The binding
factory receives those frozen values plus `{ identity, depth }`, where identity
contains `{ executable, sha256, bytes }`. It supplies synchronous
`{ imports, run(instance): { code }, dispose() }`. Its closure owns the filesystem,
cwd implementation and separate raw-byte fd endpoints, including sharing them
with child invocations. The tool host does not silently synthesize those resources.

The result is `{ code, provenance: { root, invocations } }`. Invocation records
contain pin identity, depth, code or null, and `exited`, `startup-failure` or
`runtime-error`, in completion order. They exclude source, argv, environment and
file contents. A normal nonzero exit is a result. Invalid startup, a Wasm trap,
invalid exit status and disposal failure are typed `LlvmToolHostError` failures.
Bindings are disposed after both normal and abnormal execution; instances are
never pooled. `host.dispose()` releases compiled modules and is idempotent.

## Producer bridge ABI

An opt-in producer patch can import the synchronous function:

```text
wasm_idle_tool_host.exec_v1(
  programPtr: i32, programLen: i32,
  argvPtr: i32, argc: i32,
  envPtr: i32, envc: i32, flags: i32
) -> i32
```

Program and table strings are length-delimited UTF-8 bytes without NUL. Each argv
or environment table entry is `{ ptr: u32, len: u32 }`, little-endian, stride 8.
`argc` includes argv[0]. Environment entries are `NAME=value`; empty values and
values containing `=` are preserved. Duplicate/empty names are rejected because
the structural environment contract is a record.

By default `wasm-ld`, `ld.lld`, `/usr/bin/wasm-ld` and `/usr/bin/ld.lld` resolve, always to
the pinned `wasm-ld` module. Trusted host code may add up to sixteen exact canonical
absolute filesystem names with `linkerPaths`. Other paths, dot traversal, URLs and names fail. Flags
1 inherit the caller's environment and require `envc = 0`. The unused pointer can
be nonzero because LLVM's empty SmallVector retains inline storage; the host never
dereferences it. Flags 0 provide
an explicit environment, including an empty one. Other bits are rejected. Cwd,
filesystem and fd ownership remain the parent's binding closure; no shell parser
or interpretation of diagnostic command text participates in dispatch.

Every guest pointer/table is checked against the current exported memory buffer.
Memory views are rebuilt after growth. Each table has at most 4096 entries, total
decoded request/invocation text is at most one MiB. Only a top-level Clang invocation
may dispatch its pinned linker, so execution depth is at most two including the
root. Arguments are copied into strings before child execution. Both modules can
import the same ABI; any linker request to start another child returns `-1`,
whether LLD was invoked directly or by Clang. LLD's optional error-handling script
is unsupported in this profile.
Successful child exit codes 0 through `INT32_MAX` return exactly; -1 means packet
rejection or child startup failure, and -2 means child runtime/cleanup failure.
The caller must treat negative returns as host failure, not a guest exit status.

The qualified multicall producer also requests `program: ''` with the exact argv
prefix `['', 'clang', '-cc1', ...]` or `['', 'clang', '-cc1as', ...]` for a compile
and link workflow. Trusted hosts may opt in with `allowClangCc1: true`; the same
verified compiler module executes the original array, including its empty first
argument. Public `run()` still requires a nonempty argv0. Other empty-program jobs,
arbitrary compiler paths, generic driver recursion, and child response-file-only
packets are unsupported and rejected before child bindings are created. Compiler
children cannot dispatch further commands; maximum execution depth remains two.
When the common filesystem exposes an executable command alias, the driver can
resolve that alias as its self path. Trusted hosts can register up to sixteen exact
canonical absolute aliases in `compilerPaths`, with `allowClangCc1: true`. The child
must supply that exact path as both `program` and `argv[0]`, followed by `clang` and
`-cc1` or `-cc1as`. It still executes the same pinned compiler bytes; filesystem
contents are not loaded as code. Aliases are copied before asynchronous preparation
and cannot overlap a linker identity. The container adapter additionally requires
each alias to resolve to an executable entry on a readonly mount. Other multicall
tool names and general driver recursion remain unsupported.

The selected multicall producer uses `argv[0]` to select its entrypoint. A common
command namespace must therefore expose its actual binary as `bin/llvm`, with the
Clang command mapping `argv0: '/opt/toolchains/llvm/bin/llvm'` and a first prefix
argument `clang`. Register that canonical binary path in `compilerPaths`. This
keeps the producer's own `[binaryPath, 'clang', '-cc1', ...]` child calls intact.
Using a canonical binary named `clang` with that multicall prefix selects the wrong
entrypoint; the host does not repair or discard those arguments. The public shell
name can remain `clang` through its registered virtual command entry.

The bridge must be called from the initialized command execution path, after
instantiation exposes memory. An instantiation-time start function cannot invoke
this bridge successfully. An unpatched module can still run commands such as
`clang -c` using bindings for its existing imports. General compile-and-link CLI
support requires a matching producer patch and real compiler acceptance evidence.

## Execution limits and qualification

Run this host in a dedicated Worker: synchronous guest execution can block forever.
Cancellation, elapsed-time deadlines and forced termination belong to that Worker
owner. This API alone does not enforce a Wasm memory ceiling; the adapter must
validate the selected modules' memory/import profile before invoking it. No JS heap
or process RSS hard limit is claimed. Public `run()` is non-reentrant, while the
specific synchronous linker bridge creates bounded nested instances.

`validateModule(executable, module)` optionally performs synchronous import/export
admission after byte verification and compilation, before a prepared host is returned.
It must throw on rejection; returning a Promise is an error. This does not replace
memory-section validation of the original bytes.

WASI Preview1 preopens do not initialize wasi-libc's current directory. A matching
producer can call `wasm_idle_process_v1.initial_cwd(ptr, capacity) -> i32` from a
startup constructor and then call real libc `chdir` before main. The host writes the
UTF-8 absolute cwd plus NUL and returns its byte length including NUL, or -1 for
an invalid buffer. This namespace belongs to the binding, separately from `exec_v1`.
Changing the PWD environment variable is not a cwd implementation. The container
adapter rejects a non-root cwd for LLVM modules lacking this initialization profile.

Protocol tests use real tiny core Wasm modules for parent/child dispatch, UTF-8,
empty arguments, explicit/inherited environments, memory growth, bounds, recursive
dispatch and failure cleanup. They do not qualify real Clang, LLD, C/C++ sysroot
coverage, producer subprocess semantics or a browser shell. Those gates require
the pinned real producer artifacts and their separate adapter/browser fixtures.
