# Forced owner cancellation probe

This opt-in probe uses the same pinned real SDK package and Bash WEBc as the
18-check startup-cwd suite. It runs the existing actual C ABI guest's CPU loop
and blocked-input modes, then cancels a genuinely pending approved Bash asset
response. The original successful suite and its receipts are unchanged.

The pinned SDK has no public `Instance.kill` or abort method. Its normal
`Command.run` thread pool closes only after guest completion. This experiment
explicitly terminates the trusted host's Worker group and its owner; recovery
creates a new owner and fresh SDK shared memory in the same browser page. It
reuses verified immutable bytes and the compiled SDK module. This does not
establish POSIX signals, a surviving shell or public Container process semantics.

For CPU/input cases the worker first reads the guest's exact `ready\n` bytes,
releases that output reader, then calls the SDK's consuming `wait()` once. It
requires the real wait to remain pending for 150 ms before the host requests
cleanup. The input case omits prebuffered stdin and holds the returned writer
open; otherwise `wait()` closes unlocked stdin. Omitted stdin selects this SDK's
TTY path. The readiness fixture is ASCII; no raw interactive bytes or PTY
qualification follows from it.

The download case streams the first actual 16 KiB of the pinned WEBc and holds
the remainder for at most 30 seconds. The worker observes a nonempty partial
body before its own AbortController is cancelled. The server must observe the
request close without completing the body, with zero active responses. Partial
bytes are never executable. This is an approved asset response experiment;
the Container asset service's deduplication/cache/cancellation contract is separate.

Use the same absolute configuration shape as [the main probe](README.md), with
a new private output path. No packages or tools are downloaded. `--check` only
validates pinned inputs and sources; it does not compile or launch a browser.

```sh
node scripts/probe-patched-container-shell-cancel.mjs --check /private/request.json
node --test scripts/probe-patched-container-shell-cancel.test.mjs

# Coordinate the private bounded browser slot first.
node --disable-wasm-trap-handler --wasm-num-compilation-tasks=1 \
  scripts/probe-patched-container-shell-cancel.mjs --run /private/request.json
```

Each operation has a 20-second deadline, cleanup acknowledgement has two seconds,
and observed Workers must retire within five seconds before starting recovery.
A timeout or context close cannot satisfy cancellation. CDP observes every
dedicated Worker in the exclusively owned Chromium browser. The same page then
runs real Bash `printf recovered` with a new owner and memory and requires all
recovery Workers to retire before closing the context. Each context blocks
service workers and uses the existing local cookie helper without logging secrets.

The receipt keeps actual readiness, pending wait, cleanup acknowledgement,
latency, request closure, recovery output, browser/OS/source/asset identities
and Worker targets. It always leaves `guestSignalQualified`,
`survivingShellQualified`, `commonContainerFdVfsQualified` and `shellBackendReady`
false. No actual browser result is claimed until a separate receipt is recorded.
