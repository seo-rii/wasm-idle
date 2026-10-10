# Object reuse, preambles and progress: separate contracts

## What this cache reuses

A translation unit is a source file after its includes and preprocessing decisions have been resolved. The session object cache stores that unit's relocatable Wasm object, not the final linked executable and not a reusable compiler process. Editing helper.cpp can therefore leave main.cpp reusable; changing a header used by both must invalidate both. A whole-program artifact cache instead answers whether the complete source/workspace/options are unchanged, which is sufficient for input-only reruns but not for partial project edits.

The existing bits/stdc++.h PCH caches parsed header state. An editable main-file preamble is a third mechanism with a stricter main-file remapping, location and macro-state contract. An ordinary PCH generated from a source prefix is not that contract. This PR retains its failing native demonstration rather than adding -fno-validate-pch. General preamble generation remains unimplemented.

## Why a hit still preprocesses

A handwritten include list misses conditional includes, macro-expanded paths and negative dependencies such as an absent __has_include header. The actual Clang preprocessor is the dependency authority. Each eligible invocation emits preprocessed source and a full depfile including system headers. The key fingerprints that output, dependency paths and original bytes, compile flags, compiler Module identity and probe diagnostics. Raw bytes retain changes that influence source diagnostics even when generated code is unchanged.

Output object names are normalized because moving the storage location does not change the compiled unit. Input filenames are retained because they can affect source semantics and diagnostics. Compiler identity is session-local; this is not a persistent cross-release cache. Debugging, Objective-C, existing PCH consumption, transformations and unsupported caller flags remain on the unchanged path. Time-dependent macros and ambiguous depfiles fail closed.

A miss costs preprocessing plus normal compilation; a hit costs preprocessing, dependency reads/hashes and an object copy. The tradeoff is favorable only when saved parsing/semantic analysis/code generation exceed these costs. Single-file edit-on-every-run workloads can get slower. No speedup follows merely from a positive hit counter. Linking is still performed where required, and generated user-object size is not reduced by caching.

## Ownership and failure model

Default accounting allows 16 entries and 32 MiB of object bytes, diagnostics and key storage, with independent probe limits. These are admission/retention budgets, not hard limits on Clang or the Wasm heap. LRU eviction and explicit clearing release cache references. Saved bytes and hit outputs are defensive copies. An incomplete diagnostic stream or failed compiler run cannot populate the cache; clear during an in-flight compile prevents later insertion. Failed rebuilds invalidate inherited whole-build reuse rather than returning an old successful program.

One runtime instance is single-operation. Do not mutate its MemFS during preprocessing/compilation. Independent runtimes do not share this cache. The separate artifact-runtime PR must be composed explicitly; independently importing both subclasses does not combine their behavior.

## CI progress defect

The preceding Clang browser run executed C++ successfully but failed the existing same-label progress assertion. A complete byte measurement could be followed by unmeasured activity with the same label. The old estimate expression capped the already measured value at 0.99, producing 100% -> 99%.

The repair caps only new estimates and preserves the measured value. It does not make all phases globally monotonic: a newly measured verification phase can legitimately begin at 10% after a download phase reached 100%. Readiness remains an explicit ready/settled event, never a percentage guess. Regressions cover unmeasured and invalid-denominator follow-ups, subsequent local measurements and explicit hiding; all previous phase/operation tests remain unchanged.

## Evidence and rollout

The CI-version focused run (Node 24.21.0, TypeScript 6.0.3, Vitest 5.0.3) passed 30 existing progress tests, two new regressions and the harness check that executes the 17 cache/adapter/native-Clang tests. The harness is now part of normal root CI collection. Native compiler tests report skips when native Clang/wasm-ld are missing; they are not labeled browser proof.

The class remains explicit opt-in and is not selected by the default playground worker. Existing browser CI therefore checks compatibility of the default path, not cache-hit performance. Before default activation, run the shipped compiler through the explicit class in a browser, verify hit/miss/bypass counts and output after header/source/options changes, test PCH/debug fallbacks, and compare cold/warm/multi-TU edits plus memory. Record unsuccessful samples rather than discarding them.
