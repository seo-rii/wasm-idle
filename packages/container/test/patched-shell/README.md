# Actual patched SDK/Bash Chromium probe

This opt-in probe runs the real built SDK and the linked GNU Bash exec-shim
candidate in a private local Chromium origin. It reuses the G0 C ABI probe and
its byte-level evaluator. The only additional guest is a freestanding C program
that calls `environ_sizes_get` so `exec -c` must demonstrate an actually empty
environment. No JavaScript shell evaluator or substitute guest is included.

The independently supplied local package receipt is 2,604 bytes with SHA-256
`9d3a6094f057d52d7221c676965a03a366de6a0d709ffeaf11147193c0273525`.
It binds the successful binary receipt, the exact generated 0.2.101 host graph
and 9,071,791-byte SDK Wasm. Package entries and the real Bash WEBc are verified
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
	"packageReceiptSha256": "9d3a6094f057d52d7221c676965a03a366de6a0d709ffeaf11147193c0273525",
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

## First actual browser result: failed before guest entry

The attempt at application commit `96ea935d869594679a7c285310b6b3e013736b38`
completed collection on Chromium `153.0.8010.12`/Linux in 10.183 seconds. All ten
actual SDK initializers returned, but all ten `instance.wait()` results were
code **45** with empty stdout/stderr and the console error
`Error: Unable to initialize the context and store`. A completed SDK wait does
not demonstrate that Bash or any guest entry point ran. No argv/fd/filesystem
fixture passed; guest acceptance and shell qualification remain false.

The original [browser receipt](evidence/first-browser.json) and
[process receipt](evidence/first-browser-process.json) are preserved byte for
byte. [Metadata](evidence/first-browser-metadata.json) records their identities,
limits, result scope and a diagnostic correction: initial CDP creation events
have empty URLs, so the original URL-based nested count overcounts root Workers.
Recorded parent edges identify 30 nested targets among 40 total. All cases have
zero remaining targets after owner cleanup and after context close. The outer
Node process exited 1, the supervisor exited 3, and all owned OS processes were
reaped without forced signals. Cleanup success does not qualify guest execution.

The actual SDK Worker calls `WasiEnv::instantiate`, whose separate
`import_object_for_all_wasi_versions` resolver omits `wasm_idle_shell_v1`.
The existing patch registers that namespace only in
`generate_import_object_from_env`. Therefore the rebuilt Bash cannot link its
required `exec_v1` import on this path; instantiation failure maps to WASIX
`Errno::Noexec` (45). Fixing and rebuilding the actual resolver is the next gate.
The completed binary, local package and producer receipts remain valid for their
limited build/packaging scope.

## Worker resolver candidate

The current probe pins the six-patch SDK at application source
`7ceef67180e047d4703936482006a69b814662d2` on
[#196](https://github.com/seo-rii/wasm-idle/pull/196). Its actual fresh-source
typecheck completes in 373.991 seconds and release build in 586.098 seconds;
matching bindgen/static inspection also pass with complete owned-process cleanup.
The binary receipt has SHA-256
`e8d02ef4041beb868393f0f5c72c6a8858cdf1b9d43f57337044b8ab88dad08a`.
The unchanged local packaging helper produces the explicitly pinned package above.
Its shared-memory profile remains 34/16,384 pages. New browser observations must
be recorded separately; the original five-patch failure is retained unchanged.

The new [original local-package receipt](evidence/worker-package.json) is archived
unchanged beside its [process receipt](evidence/worker-package-process.json).
Packaging exits 0 in 1.762 seconds with complete cleanup, and all five published
entries pass independent byte/hash rechecks. [Metadata](evidence/worker-package-metadata.json)
keeps that scope separate from guest execution; the original host-module graph
and fixed SDK Worker URL policy are preserved.

## Fixed resolver browser result: 17 of 18 selected checks pass

At application `77c8dad608e642f5891d2bb389bbdabb41c2d7b8`, all ten real Bash
runs reach guest execution and return code 0 in Chromium 153.0.8010.12/Linux.
The outer gate completes in 17.671 seconds. Seventeen selected checks pass,
including UTF-8/empty/LF/CR argv, explicit and empty environment, raw stderr,
status 23, actual cwd, tail exec, binary pipes and the separate G0-FS sharing case.
No browser errors or blocked requests occur. All 60 observed Workers (50 nested)
retire to zero after owner cleanup and after closing the host context; all owned
OS descendants are reaped without forced signals.

The remaining check is **redirect-mount**: the actual pipeline returns the exact
nine stdout bytes, but host `Directory.readFile('/binary')` reports
`entry not found`. Successful pipe bytes do not establish that this redirect
created a file in the intended mount. This fails guest acceptance: the outer
process exits 1 and its supervisor exits 3. Full shell and common Container live
fd/VFS qualification remain false.

The [original browser receipt](evidence/worker-browser.json) and
[process receipt](evidence/worker-browser-process.json) retain their exact bytes;
[metadata](evidence/worker-browser-metadata.json) records source/binary/package,
browser/OS and cleanup scope. The first Noexec failure remains separate. No
assertion was removed to turn the missing file into a pass. Cancellation, public
host-command dispatch and real Clang/BusyBox shell acceptance remain separate gates.

The fixed `probe-container-shell-cwd-diagnostic.mjs` comparisons use the same
SDK/Bash bytes: unchanged relative redirect, absolute `/workspace` redirect,
an explicit initial `cd /workspace`, and a parent builtin's relative write.
Use its `--check`/`--run` interface with a fresh output configuration. It records
`fixtureSet: diagnostic-only`; exit 0 means collection completed, and diagnostics
always retain false guest/backend qualification. They do not replace the failing
original contract fixture.

The [actual cwd comparison receipt](evidence/cwd-diagnostic.json) and
[process receipt](evidence/cwd-diagnostic-process.json) complete collection in
7.133 seconds with all four actual commands exiting 0 and complete cleanup.
The host cwd guest reports `/workspace`, while relative pipeline and parent
builtin files are absent from the host mount. Absolute `/workspace` and explicit
initial `cd /workspace` both publish the exact nine binary bytes. The contrast
matches the pinned libc's separate legacy cwd used by relative `open`; only
`chdir` updates that state alongside WASIX cwd. [Metadata](evidence/cwd-diagnostic-metadata.json)
records binary/object identities and the startup-boundary inference. A selected
Bash producer initialization fix and a rerun of the unchanged contract are next;
these diagnostic scripts are not a production workaround or shell qualification.

## Startup cwd candidate

The current input pin selects the Bash startup constructor from
[#198](https://github.com/seo-rii/wasm-idle/pull/198), built from application
source `7d15375967ed557e724488e82bab75cb5c4b41cb`. The constructor reads the
actual WASIX cwd and calls libc `chdir` before Bash main, synchronizing the
pinned libc's legacy relative-open state. It does not modify the script, argv,
environment or the ten original contract fixtures. The SDK package is unchanged.

The new WEBc is 1,812,678 bytes with SHA-256
`045fe12ba2ae1b417c9413f85ac21a7370d9a8ee13a9de9bebaf4682e81e17c4`;
the contained Bash Wasm has SHA-256
`2728fc7856c5fc4d78da1ad239421b4198fe4f0a78e8d7ae4b244898d8cf770c`.
The producer exits 0 in 129.466 seconds, verifies the imports and reaps all owned
processes. The [new actual Chromium receipt](evidence/startup-cwd-browser.json)
then completes all ten unchanged commands at application
`7c7c32c3dc3c8f6842dd59bd677457e5e9613032`: **all 18 selected checks pass**.
The relative redirect creates `/binary` in the host Directory with the exact
nine bytes `[0, 255, 226, 130, 172, 10, 13, 97, 98]`. The SDK package, original
fixture sources and command scripts match the earlier 17-of-18 run byte for byte.

The [process receipt](evidence/startup-cwd-browser-process.json) records exit 0
in 15.812 seconds with complete cleanup and no forced signals. All 60 observed
Workers (50 nested) retire before host context close and remain absent afterward.
[Metadata](evidence/startup-cwd-browser-metadata.json) records original receipt
identities, browser/OS, all 14 private input rechecks and the earlier admission-only
attempt: it exited before launching Chromium because memory headroom was below
the unchanged 8 GiB threshold. The successful fresh attempt met that threshold.

This qualifies the selected native WASIX observations only. Common Container
fd/VFS, JavaScript command registry, cancellation/recovery and real Clang/BusyBox
shell acceptance remain open. Both `shellBackendReady` and
`commonContainerFdVfsQualified` stay false; historical failure receipts remain
unchanged.
