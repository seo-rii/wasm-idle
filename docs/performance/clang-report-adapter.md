# Adapting the existing Clang browser report

## Purpose and scope

The existing benchmark-clang-browser.mjs runner executes genuine compiler/clangd workloads in Chromium. runtime-experiments.mjs compares a normalized evidence schema. adapt-clang-report.mjs connects recorded compiler reports to that comparator. It does not execute a browser, build a compiler, predict timings or turn native execution into browser evidence.

The adapter takes the runner's original report, original fixture definitions and explicit experiment context:

```sh
node scripts/performance/adapt-clang-report.mjs \
  baseline-browser.json fixtures.json baseline-context.json baseline-normalized.json
node scripts/performance/adapt-clang-report.mjs \
  candidate-browser.json fixtures.json candidate-context.json candidate-normalized.json
node scripts/performance/runtime-experiments.mjs compare \
  baseline-normalized.json candidate-normalized.json comparison.json
```

Context has revision (the actual 40-character commit SHA), device (an exact reproducible hardware/environment description), variant (the selected key in fixtures.compiler) and profiles (the originally planned subset of unconstrained/constrained). Do not substitute a branch name, a different device or a reduced profile list just to make incomplete results look complete. The same fixture file may contain both baseline and candidate variants.

Each workload must retain its name, language C/CPP, source, expected stdout, compile arguments and optional standard. Names alone are not identities: changing a source file or options changes the normalized workload hash. Profiles incorporate the actual constrained link rate and request latency, so two differently shaped runs cannot silently match under one label.

## Measurement unit: an ordered compiler suite

The original report records aggregate transferred payload bytes around the whole ordered suite, not around each individual program. The normalized sample therefore represents the whole suite once per network/cache/repeat combination. It sums measured compile-link, execution and emitted-artifact values across that suite, while retaining preparation, total duration and transferred payload bytes at their actual suite scope.

Transferred payload bytes exclude protocol overhead and must not be labeled wire traffic. Dividing them equally between programs or attaching the entire total to every program would manufacture measurements. firstOutputMs is the minimum recorded suite-relative timestamp only when output-producing workloads have complete timing coverage. An unmeasured earlier output cannot be replaced by a later program's timestamp. Peak memory stays absent because the source report does not measure it.

## Coverage, errors and provenance

The adapter enumerates the planned matrix: empty-cache, persistent-reload and warm phases for each declared profile and repeat. A missing position remains ok=false with failure.kind=not-recorded and no invented duration. This means execution status unknown, not an observed timeout. A recorded error and incorrect output have distinct reasons. Duplicate positions, unexpected phases/repeats, malformed metrics and incomplete allegedly successful suites are rejected.

The existing comparator treats any ok=false sample as unsuccessful coverage and suppresses comparative percentages. Its aggregate failure counters consequently include not-recorded entries; use the retained sample-level reason to distinguish missing observations from observed execution failures. Do not report that aggregate as an empirical crash rate. Matched output hashes and repeat positions are required for comparisons. Unmeasured metrics yield null comparisons; no zeros are filled in.

The CLI hashes the exact report, fixture and context files. The original runner did not cryptographically bind revision/device/fixture source to its output, so those bindings remain operator-attested and are explicitly labeled that way. Hashing a later context file is not retroactive proof of execution provenance. Future runner work should record these identities at experiment start. clangd samples are excluded and counted because their old report does not retain the exact semantic completion payloads needed for output-equivalence validation.

Exit 0 means complete valid selected evidence; exit 2 retains missing/failed observations in a written result; exit 1 rejects invalid input. No outcome automatically promotes a candidate or modifies a runtime receipt.

## Executed tests and remaining work

The combined local inventory/comparison/adapter suite passed 21 tests on Node 24.21.0. These use synthetic report fixtures and real temporary files. They test aggregation, coverage, failure suppression, source/network identity, validation, first-output absence and CLI file hashes. They do not constitute a new browser benchmark. The normal root Vitest collector and the read-only audit run these tests in CI.

The temporary nine-PR source collector and large offline dependency-export workflow used during diagnosis are removed from the final branch. The retained audit has read-only permissions, test execution and source evidence only. Actual combined Clang/LLD, PGO and console-first Python producer builds, a real Python browser measurement driver and authenticated runner-time provenance remain unfinished.
