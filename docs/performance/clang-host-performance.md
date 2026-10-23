# Clang host filesystem and translation-unit reuse

`path_filestat_get` reads overlay/native node metadata without constructing a file-content copy. File opens retain an owned read snapshot, so overwriting or deleting the path cannot mutate an already-open descriptor. Compiler writes use synthetic handles and JS overlays rather than adding unreclaimable native MemFS nodes for each temporary output. Rename moves an owned overlay without another content copy; unlink removes the name. Native backing files retain tombstones because the existing MemFS producer has no free primitive. Compiler-created temporary outputs are retired on success and failure.

The host's optional trace predicate is consulted before decoding memory or formatting messages. The public runtime forwards its current debug/log state into both MemFS and App, so a forwarding callback no longer defeats the disabled trace path.

The public artifact runtime composes the existing dependency-validated object cache for normal multi-translation-unit builds. Single-file builds keep the original path, and trace/LLDB, PCH and unsupported compiler options bypass object reuse. `cacheTranslationUnits = false` is an instance escape hatch. Linked-artifact reuse remains the first shortcut when the whole workspace and build options are unchanged. The compiler module identity comes from the actual verified Module passed to the compiler, including application loaders with an external module cache.

Every build supplies a complete workspace snapshot. Files absent from the next snapshot are removed (or their pre-workspace bytes restored), ensuring header deletion and `__has_include` changes reach preprocessing. Failed rebuilds invalidate the published artifact. Neither compiler instances nor mutable guest state are reused.

Run the pinned Chromium comparison after `prepare:test-assets -- clang`:

```sh
node scripts/probe-clang-host-performance.mjs --baseline-ref <base-commit> --repeats 4 --json /tmp/clang-host-performance.json
```

The probe validates compressed and decoded asset receipts, uses the real verified streaming loader, compares baseline/candidate and object cache off/on, and executes every emitted program with stdin/stdout checks. It records compile/link time, bytes read through MemFS, temporary-file counts and cache statistics. Candidate correctness checks cover optional-header addition/removal, compiler flags, failed rebuild/recovery and the LLDB byte-only cache bypass. One warmup is excluded from medians. Timing comparisons are local evidence, subject to host load and engine tiering; copy counts and correctness checks are deterministic mechanisms.
