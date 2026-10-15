# Closed-input LLVM qualification

This follow-up qualifies commit `29435e8a9655e8b5140e796f305f3d50c2cb8089` with
the same pinned compiler, linker and complete process sysroot as the parent fixture.
The Node and Chromium receipts retain their original `applicationCommit`: the
base `b31093ce` at test launch. Every consumed source hash in both receipts was
subsequently compared against the committed Git blobs; see
[source-attestation.json](source-attestation.json). The captured receipts were
not rewritten to substitute a later commit.

Both [Node](node.json) and [Chromium](chromium.json) pass all 14 checks. They each
create and retire nine guest Workers, including real `clang --version` calls
with owned stdin EOF and initially closed stdin. Both calls return zero and the
same version bytes; the producer's native target-deprecation warning remains on
stderr. The remaining twelve live compiler checks still pass, including nested
cc1/linker execution, generated artifact execution, streamed stdin/live header
visibility, partial-write cancellation and concurrent output-edit protection.

Node took 10.034 seconds and Chromium took 9.058 seconds. Chromium observed zero
Worker targets before closing its context, after 1.445 ms of retirement polling.
Both process receipts report exit zero, all OS descendants reaped, and no cleanup
signals. The full unit/contract run passed 235 tests without skips, and the host
package boundary check passed. Raw private logs and guarded status are retained
under `/data/seorii-container-fixes-20261015/null-device-final/`.

[baseline.json](baseline.json) preserves the earlier real-Wasm diagnostic:
owned EOF returns zero/version output, while closed stdin returns guest one with
empty output. Its `passed` field means the diagnostic runner completed and
captured both results; it does not mean closed-input behavior passed. The
separate failed Bash receipt is retained under
`/data/container-shell-profiles-20261016-t2rbk7_j/live-browser/receipt.json`.

The pinned `clang_main` calls `Process::FixupStandardFileDescriptors`, which
`fstat`s each standard descriptor and opens `/dev/null` with read/write access
after `EBADF`. Under WASI it requires that open to return the missing descriptor
number. The old VFS lacked the null device and allocated guest files only at fd3
or above. The corrected host keeps the initial closed state, then performs a
real null-device open using the lowest free guest descriptor. It also correctly
routes ordinary files when they reuse fd0/1/2. The source attestation records the
prepared LLVM source hashes and a native EOF/closed-input comparison.

The qualified compiler case is one initially closed stdin. The upstream WASI
fixup has no `dup2` for several simultaneously closed standard descriptors; this
record does not claim that broader compiler behavior or full device support.
Actual Bash composition has its own distribution/browser qualification.

| Receipt | SHA-256 |
| --- | --- |
| [node.json](node.json) | `9de6bcffa7c9a2a8004cdd69c05d26cd7f0a2fd77239bc8a749664fd32611f46` |
| [chromium.json](chromium.json) | `ee633a4689dc8a6f3942f9aea67f01f8458f0b1684d51ae05610ef417e1da396` |
| [source-attestation.json](source-attestation.json) | `f415a64e969c197265fbc11711fc2bea07420cefa4d6eef97fad54ebda7e4671` |
| [baseline.json](baseline.json) | `abc07f82b8ea390c682b15966ef09f44e89b4b70a838fb909b6d3be278882416` |
| [node-process.json](node-process.json) | `1ec24af30ae6e9f323c4303b5babe8ce045882d50c21e3ed6532bff2082b2a80` |
| [chromium-process.json](chromium-process.json) | `8dc8231ffc0831612c92cca7e9671fd6d708d4fc7a8cd8de68d396c925961a59` |
| [contracts-process.json](contracts-process.json) | `0abcf27f936d841c9a3c2410c6d91b5323b5d78b111c950c91b49fb1b517e619` |
| [package-process.json](package-process.json) | `1ce76f0e6c7cd9cdc4a3db1a84008aea823bc138dd9101f559d020dfd1755aca` |
| [baseline-process.json](baseline-process.json) | `7b53a977ef1367f90b111f40a7f90e7d77cf94b89fadbd4391b256f3b45de9e1` |
