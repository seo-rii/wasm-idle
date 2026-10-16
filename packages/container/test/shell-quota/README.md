# Actual shell quota errno regression

This opt-in fixture uses real Bash, the selected patched WASIX SDK and the checked-in
`live.wasm` ABI guest. A 128-byte workspace rejects a redirected 64 KiB write with
`ENOSPC`. Both the raw SDK descriptor and the WASI guest must receive errno 51.
The fixture records the VFS error before the Rust boundary and checks that it stays
`ENOSPC`; an ordinary I/O error, errno 29, fails the gate.

The producer needs both `0021-retain-filesystem-io-errors.patch` (virtual-fs) and
`0022-preserve-filesystem-wasi-errno.patch` (WASIX). The source preparer applies and
receipts these patches. They retain the structured filesystem error across async
`std::io` traits and map `StorageFull` to `Nospc`. The container also preserves
`ENOSPC` from a delegated endpoint. A JS-only rebuild cannot repair an older SDK.

Build and package the modified SDK with the existing pinned producer, then supply
an independently pinned package receipt in an absolute JSON configuration:

```json
{
  "packageReceipt": "/inputs/rebuilt-sdk/local-package/receipt.json",
  "packageReceiptSha256": "<independently pinned SHA-256>",
  "bashWebc": "/inputs/bash-exec-shim.webc",
  "bashWebcSha256": "<independently pinned SHA-256>",
  "bashWasmSha256": "<independently pinned executable SHA-256>",
  "chromium": "/inputs/chromium/chrome",
  "output": "/evidence/new-quota-run"
}
```

```sh
pnpm --dir packages/container test:shell:quota /absolute/quota-config.json
```

The output directory must be new and outside the checkout. The runner checks the
SDK package and Bash pins, serves local assets with isolation headers and a bounded
CSP, drains both output streams, and records source hashes, browser version and
owned Worker cleanup in `receipt.json`. Expected output is `guest:51` and `raw:51`.
No Clang/LLVM build is required.

The producer patches include Rust regressions for exact filesystem-error round trips,
ordinary I/O fallback, and WASI errno conversion. The normal container contracts also
run the actual WASI guest against a quota-limited delegated filesystem endpoint.
These focused checks do not replace a fresh SDK build and this browser gate.
