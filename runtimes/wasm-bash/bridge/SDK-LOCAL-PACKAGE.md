# Local experimental SDK module and worker packaging

This layer prepares packaging after the actual SDK Wasm/bindgen gate succeeds.
It does not build the SDK, install npm dependencies, download a runtime, register
commands, or qualify guest execution. An independently known successful binary
receipt digest is mandatory. Until the actual generated web glue and receipt
exist, preparation fails; source patches or a passing type check cannot replace
that prerequisite.

The helper preserves the frozen source's `src-js/index.ts` and `worker.js`
bodies. Existing named SDK exports remain intact. A separate profile wrapper
accepts only `init({module, memory})`, where `module` is a `WebAssembly.Module`
compiled by the caller from the receipt-pinned verified bytes and `memory` is
shared. It passes those exact objects to the original SDK initializer, supplies
fixed package-local `index.mjs`/`worker.mjs` URLs, rejects caller URL overrides
and prevents a later binding change in that realm. A Module object itself has
no hash-inspection API; checking its type does not establish its provenance.
Verifying the bytes and constructing the matching memory remain host duties.

No `Response`, URL, byte array, deferred Module, default Wasm URL or unpkg
fallback is accepted by this profile's initializer. The original generated
glue is bundled unchanged, so unused fallback branches may remain in the code;
validated initializer inputs never select them. Direct use of other original
initializers/setters is outside this packaging profile. Their presence does not
establish synchronous initialization, arbitrary worker URLs or a sandbox.
The real generated 0.2.101 initializer/`initSync` API and actual browser behavior
must be verified after the binary build, rather than inferred from unit glue.

## Exact module graph and tools

`package-container-shell-sdk.mjs` verifies the successful binary receipt,
source-policy/build-plan digests, every recorded artifact, the exact web-glue
file inventory, all prepared source pins and the unchanged upstream index and
worker hashes. It bundles the index and all static generated JS/snippet imports
through an allowlist resolver. Bare, URL, missing, unregistered or unresolved
dynamic host imports in the index/glue closure fail. Wasm and unsupported host
module formats are not replaced by URL loaders.

Only existing local esbuild 0.28.2 is used. Independently expected hashes must be
supplied for its API JavaScript, package metadata, native executable and Node.
The native version must match the API package; `ESBUILD_BINARY_PATH` explicitly
selects that binary. No esbuild fallback download, npm install, Rollup/unpkg
entry, plugin from package metadata or remote JavaScript runs. The two bundles
use logical source names, fixed options and unchanged source bytes. Their
content, verified Wasm, generated declarations and SDK license determine a
content-addressed package directory. The full source archive remains referenced
by the verified binary receipt. Complete dependency notices remain a release
gate. Generated declarations are retained for inspection; they are not a
promise of a qualified public wrapper TypeScript API.

Before publication, all source/artifact/tool pins are checked again. Files are
staged privately, then renamed into the content-addressed directory; an output
receipt identifies the completed package. A failed package must not be mounted
or served as a qualified generation.

## Worker bootstrap and trust boundary

Pinned `src/tasks/worker_handle.rs` creates a module Worker. Its default is a
Blob containing `src-js/worker.js`, with `worker.mjs` as a fallback. Its init
message contains the same `wasm_bindgen::memory()` and current Module plus id
and SDK URL. The original worker buffers messages until it dynamically imports
that SDK URL, calls `init({module, memory, sdkUrl})` and creates ThreadPoolWorker.

This package selects `worker.mjs` explicitly, avoiding the Blob/fallback path.
The copied worker body is bundled with a wrapper that accepts only the exact
local SDK URL, shared memory, Module and a u32 worker id; duplicate init is
rejected. Its original dynamic import of the package-local index remains.
Each thread uses the received Module/memory, so this path has no Wasm refetch.

The Worker entry and its dynamic SDK import remain **trusted host JavaScript
module bootstrap**, served from a host-selected immutable content-addressed
directory with the reviewed module graph/CSP. Browser module loading does not
perform the runtime asset service's per-worker hash verification. A caller
must not supply a mutable deployment path, manifest-selected JavaScript URL or
claim that verified Wasm injection proves this JavaScript boundary. No global
fetch override or same-origin Worker isolation claim is made.

Ownership is still unresolved: WorkerHandle::Drop terminates only its directly
owned worker; ThreadPool uses a static default pool and its Drop does not close
the scheduler. Stopping a parent Worker does not demonstrate nested Worker
recovery. The original pre-init queue is also unbounded. The package adds no
fabricated runtime hook, resource-group registry, wait/cancel or fd/VFS success.
Actual descendant registration, blocked-read/CPU-loop cancellation, startup
failure, per-process capability and real shell browser fixtures are required.

## Bounded commands

After the real binary gate produces its checked successful receipt:

```sh
python3 scripts/prepare-container-shell-sdk-package.py \
  --binary-receipt /private/sdk-binary/receipt.json \
  --binary-receipt-sha256 "$container_sdk_binary_receipt_sha256" \
  --node /pinned/node/bin/node --node-sha256 "$container_node_sha256" \
  --esbuild-api /existing/esbuild/lib/main.js \
  --esbuild-api-sha256 "$container_esbuild_api_sha256" \
  --esbuild-package /existing/esbuild/package.json \
  --esbuild-package-sha256 "$container_esbuild_package_sha256" \
  --esbuild-binary /existing/esbuild/bin/esbuild \
  --esbuild-binary-sha256 "$container_esbuild_binary_sha256" \
  --output /private/new-sdk-local-package-attempt

python3 scripts/prepare-container-shell-sdk-package.py --check /private/new-sdk-local-package-attempt
python3 scripts/prepare-container-shell-sdk-package.py --launch /private/new-sdk-local-package-attempt
```

Preparation freezes the request/tools/helper files without bundling. The check
verifies the complete real input closure under the process owner without
loading esbuild or writing package entries. Launch returns a persistent PID,
private log and status path. The process owner has a 120-second wall deadline,
90/96-second per-process CPU limits, 12 GiB per-process address-space cap and
1 GiB disk floor, with owned descendant cleanup. Node uses the previously
probed trap-handler/compilation-task settings. Those are controls, not measured
package requirements. No guest is instantiated at any stage.

The unit tests exercise only pin rejection, local graph closure, deterministic
esbuild output and initialization argument policy. Their tiny JS glue is
explicitly a protocol fixture and cannot qualify SDK or shell execution:

```sh
WASM_IDLE_SDK_ESBUILD_ROOT=/existing/esbuild \
  node --disable-wasm-trap-handler --wasm-num-compilation-tasks=1 \
  --test scripts/package-container-shell-sdk.test.mjs
```
