# Actual live LLVM qualification

The [closed-input follow-up](null-device/README.md) qualifies the null device and
fd reuse fix at `29435e8a`: 14 real checks in each environment, nine retired Workers
each, and 235 unit/contract tests. The original evidence below remains unchanged.

The Node and isolated Chromium receipts qualify `llvm-clang-tool-host-live-v1`
at application commit `66ac18fa9c1ec4bec4bfa92c7e9aca43c21608ed`. Both run the same
`fixture.mjs` with the real pinned Clang, cc1 and LLD modules and the complete
selected-target process sysroot. Each receipt records 79 consumed source hashes,
which the runner rechecks after execution, plus the emitted bundle digests.

Both profiles passed all 12 checks. Each created and retired seven actual guest
Workers; process inspection was empty. Chromium reported no browser/CSP failures
and zero worker targets before closing its context (bounded retirement deadline:
10 seconds; observed 2.58 ms). The independent process records report exit 0,
all OS descendants reaped, and no cleanup signals or remaining processes.

The fixture proves:

- Native Clang multicall self-dispatch, compile/link and real generated Wasm
  execution in a cwd containing spaces and Korean, despite deliberately wrong PWD.
- Actual cc1 consumption of streamed stdin beyond the 4,093-byte channel capacity,
  followed by reading a header changed by the editor before input EOF.
- A real preprocessor temporary file visible while its process still runs;
  foreground cancellation preserves that completed write and permits a new command.
- A same-byte editor write during actual linker output changes the inode revision.
  The successful output remains data, while explicit `wasm-run` still executes it.
- New compiler output without intervening edits gains read-derived execute bits only after
  the supported process ABI and bounded memory checks.

The generated hello artifact is 191,817 bytes with SHA-256
`0b8ed5d137b1f871fc4d4b43d2b70d27e7c075ee034e8e30e89aee0eb08b3f2a`.
The cancellation case leaves the compiler's temporary `.i.tmp` file; it does not
claim that Clang had already renamed it to the requested final output.

The same source passed all 228 unit/contract tests without skips and the host-only
npm package boundary check (108 files, 478,786 unpacked bytes). These are separate
from real compiler qualification and do not substitute for it.

The script accepts the reviewed Clang producer/smoke/process-sysroot fields from
a local shell acceptance configuration. It does not execute or load SDK/Bash
assets. This receipt qualifies a command adapter and its live resource boundary;
actual Bash composition is a separate distribution/browser gate. It does not
qualify every Clang option, source headers, browser engine or memory configuration.

| Receipt | SHA-256 |
| --- | --- |
| [node.json](node.json) | `95625f7f11b11db3868a5ace71326b6ced02e4a529a93e2bf0567c896a44a561` |
| [chromium.json](chromium.json) | `7ae59d6362bd1ef3d32ce0fdfaca16ecee77770bcf5ebb6265384a2101268ab4` |
| [node-process.json](node-process.json) | `6d41b7d2a440887d25c8b06d1d6410d38572a7c1c499bc87414bbfbeb69e4a69` |
| [chromium-process.json](chromium-process.json) | `125f3ddd4796b59723dbda4e6194a0ed7fe858735fd5fbadd710cc1c28ab195f` |
| [contracts-process.json](contracts-process.json) | `0f31a04ed17d8f291e8279a071c795dd2ff607089d0586fa619e650fb9c9c499` |
| [package-process.json](package-process.json) | `0acd9d80bb25ad8708e3d11bdd894a16dc8e33d5f39ed26e164a263ccfc3ff7b` |
