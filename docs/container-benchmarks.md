# Container measurements

`pnpm benchmark:container --config /absolute/pinned-config.json --output /absolute/new-run`
runs three independent actual Chromium shell acceptance suites and retains every receipt.
Use `--samples 1` for a single observation or up to ten samples for a recorded distribution.
The configuration is the same exact local SDK, Bash, BusyBox and compiler receipt/artifact
configuration used by `probe-container-shell-acceptance.mjs`; no synthetic compiler or
download substitution qualifies a result. Build the packages before running the command.

Only passing acceptance suites contribute measurements. Each suite has cold and warm
scripts in separate owner Workers under the same retained browser cache. The report records
artifact identities, source commit, Chromium/OS/CPU, load averages, script elapsed time,
Clang dispatch duration where instrumentation exists, served asset response body bytes,
retained logical asset bytes, and remaining Workers. Delivery bytes include SDK Wasm and
Bash WEBc as well as BusyBox, Clang, LLD and the full sysroot, with shell runtime and
compiler/userland subtotals. All six warm asset body counts must be zero. Preserve
`benchmark.json` alongside the full sample receipts when comparing changes.

The harness elapsed time includes bootstrap, script execution and owned Worker retirement.
Clang dispatch includes asset preparation and compilation/linking. Neither value separates
network, verification, decompression, Wasm compilation and instantiation. Reported response
bodies exclude protocol overhead and all host/SDK JavaScript modules; they are not a
browser network interface counter. Retained logical bytes sum both verified asset-service
caches and expose each subtotal. They exclude package trees, Worker copies, linear memory
and compiled modules, and are not browser heap or RSS measurements.

This baseline uses a loopback origin with no network shaping. Compare like browser, OS,
CPU, artifact, workload and cache profiles, and keep isolated changes separate. Store
sample counts and min/median/max instead of advertising a latency guarantee from one run.
L1 asset splits and compiled-module caching remain measurement-driven follow-up work; no
header removal, option dropping or compatibility reduction is a performance optimization.

## Recorded snapshot baseline

The [2026-10-16 observation](../packages/container/test/benchmarks/snapshot-20261016/benchmark.json)
contains three passing 72-check suites with the final 0001–0020 SDK and the full selected
sysroot. Chromium 153.0.8010.12 ran on a shared Linux host with eight logical EPYC 7B12 CPUs;
the recorded one-minute load average was 14.27 at start and 15.09 at completion. These
observations establish a reproducible workload and byte baseline, not a latency guarantee
or an isolated CPU benchmark. Every Worker and owned OS descendant was reclaimed.

| Measurement | Cold min / median / max | Warm min / median / max |
| --- | --- | --- |
| Complete script, including owner setup/cleanup | 11,831 / 12,191 / 12,973 ms | 10,866 / 11,605 / 11,959 ms |
| Clang dispatch, including preparation and link | 10,495 / 11,117 / 11,336 ms | 9,562 / 10,553 / 10,660 ms |
| Asset response bodies | 71,298,964 bytes each | 0 bytes each |

Cold delivery comprises 60,223,838 compiler/userland bytes and 11,075,126 SDK/Bash bytes.
Both asset services retain 123,754,217 logical bytes in total in each run; that value does
not include other runtime copies. The [metadata](../packages/container/test/benchmarks/snapshot-20261016/metadata.json)
pins all three full acceptance receipts and the process-cleanup record. It also records a
brief unrelated UI-fixture overlap after the first measured warm script had finished.
