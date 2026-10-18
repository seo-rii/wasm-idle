# Integrated stack verification

The executed application source is `b3305cccd734eb80bce31e9f66ae93066c88bb83`. These receipts qualify the reviewed container stack together with main baseline `af68215f26ffc72594bdee3e4481e8db0aecd010` and its workspace CI correction.

The actual Bash/Clang/BusyBox snapshot suite passed 83 checks across eight scenarios. The selected live compiler suite passed 50 checks across three scenarios. The rendered live workbench passed six checks across three runs. Every shell scenario retired its Workers before context closure. The rendered workbench owner remained available during editing and retired after explicit close. The outer process guards reaped every owned process without forced cleanup.

The same frozen source passed 246 container unit/contracts, 44 distribution/hosting/acceptance contracts, 220 existing Clang regressions and 35 package source contracts. The complete root `scripts/*.test.mjs` run reported 238 tests: 237 passed, none failed and one existing optional source test skipped. Actual counts, successful statuses and log identities are recorded in `metadata.json`. The package boundary used the freshly compiled host package, its exact metadata and documentation, and no compiler binaries.

`snapshot.json`, `live.json` and `ui.json` preserve the original raw browser receipts. Their corresponding process JSON files preserve the outer cleanup results. `metadata.json` records the executed commit, original output identities, fresh host build manifest, consumed source hashes, configuration and runner identities, resource policy and host results. Compiler, sysroot, Bash, BusyBox and SDK input identities remain in the raw receipts.

The first live attempt failed data-space admission before its inner browser stage started. Its failed supervisor status and original log identity remain recorded separately. The successful live result came from the explicit retry; the failed attempt was not relabelled as successful.

Earlier receipts remain unchanged. This evidence covers the selected snapshot/live profiles and rendered UI. It does not qualify PTY/job control, general POSIX/Linux compatibility, live C++, arbitrary simultaneous closed LLVM standard descriptors, complete offline bootstrap or production deployment. Existing source/license correspondence and clean producer source-to-binary release gates remain separate.
