# Follow-up to the editor readiness repair

Head 26e03237805cc420c646fae4a91dbc245a047c75 fixed the original C/CPP model race
in real Chromium run 38023363199: lsp-browser-smoke (114128925208), including
its C/CPP/OBJC diagnostics matrix and separate Gleam CSP step, passed. LLDB run
38023363269 and performance audit 38023363151 also passed. Two other failures
were retained and repaired, rather than rerunning until green:

* The ninth readiness regression read a source file using new URL(import.meta.url).
  Vite rewrote that asset URL to HTTP under jsdom. The eight DOM cases passed, but
  the source contract could not read it. Use the repository-relative path under
  the root test runner; keep every assertion.
* Clang browser job 114129052985 compiled and executed the PCH test (exit 0,
  pch=80), but recorded Downloading bin/cpp-addon.tar.gz moving 100% to 99%.
  Reuse the exact shared loadingProgress.ts correction and two regression cases
  already implemented in #76, without copying its experimental compiler cache.
  Cap new estimates, not an existing completed byte measurement; preserve measured
  phase-local denominators and explicit ready/settled behavior. No browser
  assertion, compiler asset or timeout is relaxed.

These corrections are not browser speedup claims. The final CI results are
recorded against the subsequent exact commit in the PR discussion.
