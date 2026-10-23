# Reusing the website's last successful C/C++ build

The container website prepares C/C++ before running the executable. Preparation now
reuses the last successful executable when the effective compiler inputs and the
common filesystem generation are unchanged. Changing stdin or program arguments
does not rebuild it. This applies to repeated UI preparation as well as direct run
calls; no mutable compiler instance or compiler WebAssembly module is retained.

The entry belongs to one runtime session and language. It records the effective
compiler arguments, source path and contents, language standard, environment,
filesystem generation, and the output's exact owner-only inode revision. Any
filesystem mutation invalidates reuse, including shell edits outside the editor's
file list, new or removed headers, response files, timestamps, symlinks, and replaced
or removed executables. This deliberately favors conservative invalidation over
handwritten include discovery. Compiler assets and sysroots remain immutable and
verified by their existing loaders.

Cross-Run reuse is limited to default compiler flags and an empty environment
override. Opaque arguments, including response files, can request extra outputs or
driver side effects, so each preparation still invokes the real compiler for those
requests. Their successful artifact can be handed to the immediately following run
once. Successful compiler output and editor diagnostics are retained within a
64 KiB / 256-event budget and replayed for a reused preparation with its new request
identifier; exceeding the budget disables reuse. Failure or cancellation cannot
publish a cache entry or revive an older executable.

Cached replay rechecks cancellation and filesystem validity after the progress
callback and before each event. It sends retained terminal output before editor
diagnostics, so an output callback that edits the workspace stops replay before
old diagnostics can mix with the rebuild's diagnostics. An invalidation rebuilds
the program; terminal output already delivered before the edit cannot be retracted.
Diagnostic callbacks also stop further replay if they invalidate the build.

A build also must qualify for reuse while it is running. The filesystem's bounded,
synchronous mutation observer records trusted owner sources independently of lossy
editor watches. The live adapter attributes filesystem syscalls to its bound
opaque process token, and executable qualification attributes its final metadata
grant to that same source. Tokens remain distinct when containers share a filesystem
and their numeric process identifiers overlap. Any other mutation during preparation disables
cross-Run reuse, even if a header's original bytes are restored before completion.
Compiler temporary objects and PCH writes remain ordinary live filesystem changes.
They do not cause the build to reject itself. Observer or source overflow fails
closed, and subscriptions are released on every exit.

This is reuse of an existing build, as in an ordinary incremental build system.
Clock-dependent macros retain the preceding build's value until an input change
causes a rebuild. Arbitrary compiler-side effects are not replayed from this cache.

Focused tests use the real container memory filesystem and website input boundary,
with explicit compiler-process fixtures. They verify repeated prepare/run calls,
runtime-only input changes, shell/header/output mutations, transient concurrent
edits, environment/flag bypass, diagnostics, failure and cancellation. These tests
establish cache orchestration and invalidation; they do not claim a measured browser
speedup. Browser measurements must exercise actual UI prepare/run calls and separate
new-owner asset caching from retained-owner executable reuse.
