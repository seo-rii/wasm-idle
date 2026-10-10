# Aheui on Pyodide

This runtime runs the original [rpaheui](https://github.com/aheui/rpaheui) **1.2.5**
package on the existing Pyodide browser runtime. It uses rpaheui's own supported
CPython path, including its compiler, optimizer, storage implementations and
instruction execution. No custom language parser or subset executor is involved.
The release is available from [PyPI](https://pypi.org/project/aheui/1.2.5/); the
upstream source reference is `d11187ebcc40ff3f17ebf93c03275f2d85da5b79`.

`vendor/aheui-1.2.5.tar.gz` is the original, unchanged source distribution. Its URL,
25,115-byte size and SHA256 are pinned in `scripts/sync-wasm-aheui.mjs`. The original
BSD-2-Clause license is retained in `LICENSE`, distributed as
`static/wasm-aheui/LICENSE.txt`, and included in the wheel. All 12 Python package
files in the wheel are byte-for-byte identical to the source distribution. Only
the standard wheel packaging metadata and executable script headers are generated
by setuptools. The build receipt records the source, license and wheel hashes.

The dependency-free, pure Python wheel is 24,259 bytes with SHA256
`118d21234ba7e8252542286c825d01ea078b3b9468b56afdd1fae28238f869a3`.
The worker fetches it from the configured local runtime asset path, checks its size
and hash before extraction, installs it into Pyodide's site-packages and verifies
`aheui.version.VERSION`. PyPI is used only when sourcing a release, never while
running browser code. Each dedicated worker installs one language extension and
rejects changes to its language or already-installed version.

## Execution and I/O

The worker writes the unchanged program to a private source file at
`/tmp/__wasm_idle_aheui__/<activePath>`. It invokes the genuine entry point with
`["aheui", "--no-c", "--warning-limit=0", filename]`; those original options disable
automatic bytecode files and the interpreter's CPython performance warning.
The source file is removed after execution, including executions that raise an
exception. Preparation stages the runtime without scanning Aheui source for Python
imports or executing the user program. Python debugging is unavailable for Aheui.

Rpaheui reads and writes actual file descriptors through `os.read` and `os.write`.
The worker therefore configures Pyodide's standard stream APIs: stdin receives raw
UTF-8 byte arrays without adding newlines, terminal input can arrive in several
chunks, and EOF persists until the next run. Separate streaming UTF-8 decoders
preserve partial writes to stdout and stderr, then flush when execution ends.
Reloading the original `aheui.aheui` module before each run resets its input buffer
and warnings; the original interpreter creates fresh storages for every program.

The implementation retains the original 26 stacks, queue and communication port,
two-dimensional movement, storage transfers and CPython's arbitrary-precision
integer behavior. Character input reads a Unicode code point and returns `-1` at
EOF. Number input accepts the original signed decimal format. The original
character output replaces out-of-range values and zero with U+FFFD, so NUL input
can be inspected as `0` with numeric output but prints U+FFFD as a character. The
interpreter's normal halt return value may be the selected storage's remaining
integer; normal return counts as a completed playground run. Python exceptions are
reported as runtime failures. Cancellation, execution timeouts and output limits
are enforced by the dedicated host worker lifecycle.

## Rebuild and verify

From the repository root, with `uv` available:

```sh
node scripts/sync-wasm-aheui.mjs --check

TMPDIR=/data UV_CACHE_DIR=/data/uv-cache node scripts/sync-wasm-aheui.mjs
```

`--check` verifies the committed original source archive, license, wheel and build
receipt without network access or a Python toolchain. Rebuilding uses the vendored
source archive, a build constraint of `setuptools==84.0.0`, and
`SOURCE_DATE_EPOCH=315532800`; it requires the produced wheel to match the pinned
bytes before writing any runtime artifact. The build backend may be downloaded by
`uv` when it is absent from the developer's cache. Temporary files are removed after
the build. The reproducible receipt contains no timestamp or machine-specific path.
