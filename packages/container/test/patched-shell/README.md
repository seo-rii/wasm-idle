# Actual patched SDK/Bash Chromium probe

This opt-in probe runs the real built SDK and the linked GNU Bash exec-shim
candidate in a private local Chromium origin. It reuses the G0 C ABI probe and
its byte-level evaluator. The only additional guest is a freestanding C program
that calls `environ_sizes_get` so `exec -c` must demonstrate an actually empty
environment. No JavaScript shell evaluator or substitute guest is included.

The independently supplied local package receipt is 2,604 bytes with SHA-256
`86b7993253952a735f0260edb693f217c26bd4e409cfd181c90b23ecfca50b34`.
It binds the successful binary receipt, the exact generated 0.2.101 host graph
and 9,044,795-byte SDK Wasm. Package entries and the real Bash WEBc are verified
before execution. The native Clang 16/lld digests match their complete pinned
WASI SDK 20.0 archive members; no build or download of those tools is performed.

`--check` validates inputs and source identities and reads Clang's version. It
does not build a fixture, create output or launch Chromium. `--run` repeats those
checks, compiles three small real freestanding Wasm fixtures, allocates a fresh
private output directory and starts the owned Chromium browser. The caller must
provide an absolute configuration file containing:

```json
{
  "packageReceipt": "/private/sdk-local-package/receipt.json",
  "packageReceiptSha256": "86b7993253952a735f0260edb693f217c26bd4e409cfd181c90b23ecfca50b34",
  "bashWebc": "/private/bash-build/candidate/bash-exec-shim.webc",
  "clang": "/private/bash-build/work/wasi-sdk/bin/clang-16",
  "output": "/private/new-patched-shell-probe"
}
```

```sh
node scripts/probe-patched-container-shell.mjs --check /private/probe-request.json
node --test scripts/probe-patched-container-shell.test.mjs

# Execute only after coordinating the bounded browser slot.
node --disable-wasm-trap-handler --wasm-num-compilation-tasks=1 \
  scripts/probe-patched-container-shell.mjs --run /private/probe-request.json
```

Use the already installed `playwright-core` and cached Chromium. The existing
`addBrowserTestCookies` helper supplies configured local cookies without logging
them. The server serves the verified in-memory SDK `index.mjs`/`worker.mjs` under
the package digest, immutable fixture URLs and COOP/COEP headers. The page checks
SDK Wasm bytes, compiles the actual Module, creates shared Memory with initial 34
and maximum 16,384 pages, and supplies both to the worker initializer. This
profile supplies all executable bytes and needs no worker-path Wasm refetch or
CDN resolution. Browser context routing rejects requests outside the exact local
origin/asset allowlist. Browser fetch APIs remain available: these are trusted
bootstrap observations, not guest or network security guarantees.

Ten cases cover builtins/stdin, spaces/Korean/empty/LF/CR argv, replaced and empty
environment, status 23, tail exec, cwd, binary pipes and filesystem visibility.
Each guest case has a 30-second deadline, with separate two-second cleanup
acknowledgement and five-second Worker retirement observations. Healthy runs are
expected to take tens of seconds; this is an estimate, not measured evidence.
Allow roughly seven minutes for ten timeouts and all cleanup phases. Long runs
must use the workspace's private background log/process supervisor.

`receipt.json` preserves actual results, nonzero codes, timeouts and failures.
The worker reports `instance.wait` completion before cleanup. CDP records all
dedicated Worker targets in the exclusively owned browser, nested worker counts,
the snapshot at result/failure, retirement after owned Worker cleanup and the
separate snapshot after closing the host context. Closing the context never
turns a timeout into backend completion. Evidence collection and acceptance are
separate, and failed acceptance exits nonzero. No cancellation/recovery gate is
claimed by this fixture set.

The fd/filesystem cases measure native WASIX `Directory` semantics. They do not
qualify the common public Container fd/VFS bindings; `shellBackendReady` and
`commonContainerFdVfsQualified` remain false even when all minimum observations
pass. License inventory, public host-command registry, common live ownership,
cancellation and the complete shell/browser acceptance remain separate gates.
