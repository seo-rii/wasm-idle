# BusyBox live WASI qualification

This fixture consumes the receipt and exact bytes of the B1 producer separately
from the container host. The producer's native and Node WASI gates must already
pass. It exercises the real BusyBox binary through the isolated live adapter,
first in Node Workers and then in Chromium Dedicated Workers.

```sh
node runtimes/wasm-busybox/scripts/test-live-container.mjs \
  --producer-work /path/to/verified/busybox-producer-output \
  --producer-revision <full-producer-commit> \
  --container-dist /path/to/packages/container/dist \
  --core-dist /path/to/packages/core/dist \
  --output /path/to/live-busybox-evidence.json
```

Use `--node-only` to run the initial probe before allocating Chromium. That
receipt remains explicitly browser-pending. The full run records artifact,
receipt, distribution, actual host module and fixture hashes, the application
commit, browser/OS versions, exits, output digests, and owned process/Worker
cleanup. The local server uses COOP/COEP and a restrictive CSP with same-origin
modules, Workers and asset requests. Each backend fetches the pinned asset body
once through the verified package loader; metadata lookup does not fetch it.
Persistent cache/reload qualification belongs to the separate batch fixture.
On shared Linux hosts, `BUSYBOX_MIN_AVAILABLE_KIB=2097152` optionally checks for
2 GiB of available memory immediately before Chromium starts. An admission
failure exits without launching it and preserves the Node-only evidence.

The fixture checks 262,147 binary bytes through `cat` using a 4,093-byte pipe
capacity, a real `cat | grep` pipeline, and early reader close with `grep -m 1`.
The host may save captured output as a workspace file; this is explicitly a
host operation and does not qualify actual shell redirection.

For live filesystem visibility, `cat - from-cp.bin` emits stdin bytes while EOF
is still withheld. A concurrent actual `cp` creates `from-cp.bin` in the same
workspace. Only then does stdin close, and the waiting `cat` opens and reads the
new file. Actual `mkdir`, directory `mv`, and 200-entry recursive `rm` exercise
the common directory namespace and stable readdir cookies. Cancellation of a
running `cat` with open stdin releases resources and permits another command.
A pipeline exceeding the two-process budget must fail before launching it.

This qualifies the selected producer modes against live byte streams and a
common memory filesystem. It does not qualify a shell, shell parsing or
redirection, terminal/PTY behavior, job control, unlisted BusyBox applets, or
unsupported producer modes. The producer's text-only grep and restricted copy
semantics continue to apply. No source programs or runtime binaries are
published by running this test.
