# wasm-bash

This runtime packages the real GNU Bash WebAssembly binary published as
[`sharrattj/bash@1.0.17`](https://wasmer.io/sharrattj/bash/releases) for offline browser use.
The sync step reproducibly converts the pinned WAPM binary to `bash.webc` with Wasmer CLI 7.2.0.
The playground loads that local package with `@wasmer/sdk` and executes its WASIX entrypoint; it
does not query the Wasmer registry at runtime.

Run `pnpm --dir runtimes/wasm-bash build` to download and verify the upstream WAPM archive, extract
`bash.wasm`, build `bash.webc`, and write the runtime metadata and GNU GPL license to
`static/wasm-bash`. Run the
`check` script to verify an existing bundle without changing it.

The standalone binary provides Bash builtins. The upstream package declares
`sharrattj/coreutils@1.0.16` as a separate dependency, which is intentionally not bundled here;
external utilities such as `cat`, `sed`, and `ls` are therefore not available yet.

## Provenance

- Package: `sharrattj/bash@1.0.17`
- Archive SHA-256: `850c5d4257336a3ec8d7ab1b1b7e01e1e76f3fb0566196b0091989860cf20d74`
- `bash.wasm` SHA-256: `305e2a460068b45cca21583a6619c008dedea0b71c052e29446eb88b9c4438a9`
- `bash.webc` SHA-256: `7609fd1e023758d73096b042d9be3adb9e23c9aa357b272b84b9b4fd69b65311`
- WEBc builder: Wasmer CLI 7.2.0
- License: GNU GPL version 3 or later, as declared by GNU Bash

The exact source revision used by the third-party Wasmer package is not recorded in its package
metadata. Do not publish this binary outside the project until corresponding-source availability
has been confirmed with the package publisher.
