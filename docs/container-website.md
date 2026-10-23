# Container integration in the existing playground

The existing editor, file explorer, terminal, Run, Debug, Stop, stdin and debugger
controls communicate with one dedicated container-owner Worker. There is no
separate container page or iframe. The existing terminal starts actual GNU Bash
when shared memory is available; typing while a program runs goes to that
program, and idle input goes to Bash.

`src/lib/playground/container/binding.ts` preserves the existing playground and
Terminal interfaces. Its private versioned Worker channel carries operations,
stream bytes, progress, diagnostics and debugger events. The owner registers
actual language-engine executions with the Container supervisor and owns their
cancellation. The real existing LLDB and language-specific debug backends remain
separate execution profiles; normal browser execution is not described as a
debugger attach target.

Editor files publish into `/workspace/<LANGUAGE>/`. Existing language workspaces
remain distinct within the shared filesystem; shell commands can access their
absolute paths. Normal C/C++ commands use the live Clang adapter and leave their
Wasm artifact in that workspace. Other existing language engines and debugging
receive source snapshots from the shared VFS and keep their runtime-private
filesystems; those private runtime writes are not claimed as live shared files.

Shell-created files and compiled artifacts appear in the existing explorer.
The selected language's editor project is labelled `/workspace/<LANGUAGE>`.
The shared `/workspace` explorer supports folder entry, breadcrumbs, parent
navigation and independent expansion/collapse. It also shows empty directories.
Selecting a language opens its project and changes the persistent Bash session's
actual cwd to `/workspace/<LANGUAGE>` while retaining variables and editing state.
The opt-in producer imports one host-supplied Bash function through Bash's
standard environment function-import path, makes it readonly and removes its
export flag before reading terminal input. The fixed SDK requests inherited write
access even for `O_RDONLY`, so startup does not attempt to read a readonly rcfile.
The source copy remains readonly in the host VFS for inspection. The host publishes a bounded generation-tagged mailbox; the opt-in native Bash
Readline hook applies it only at a genuine primary input boundary. No `cd` text
or control keystrokes are injected into stdin. Foreground commands, `read`,
heredocs and continuation prompts retain their current input and directory;
the latest requested language is applied when Bash returns to its primary prompt.
A visible pending status distinguishes that queued transition from completion.
Clicking a shared file inside a language project opens that project's current
bytes in the editor; root files and symlinks are listed for terminal access.
The explorer uses metadata only, does not follow symlinks, and pages its rendered
rows. File events update it during Run/Debug; editor reconciliation resumes after
execution releases the buffers, without requiring a manual refresh.
Reconciliation preserves concurrent editor buffers and reports conflicts. The
explorer's refresh control explicitly resolves conflicting revisions. Existing
workspace saving/export remains responsible for the editor workspace; the
container owner itself has page lifetime, and asset-cache eviction never deletes
user workspace storage.

Editor publication sends changed file bodies and only their touched baseline bodies;
unchanged files contribute path/size metadata for whole-project admission. The owner
still validates every touched conflict before publishing a batch and preserves unknown
shell files. Worker reads use a per-project cursor and exact VFS file revisions, returning
changed bodies and deletions. A missing or stale cursor receives a full reset, so bounded
watch-queue rescans recover without trusting missed events. The facade continues to return
owned complete file arrays to the existing editor API. Metadata enumeration and the private
source snapshots passed to language engines remain complete project operations.

Initial language and files resolve before the editor, terminal or runtime starts.
A valid shared snapshot takes precedence, followed by explicit URL inputs, the
current workspace snapshot, legacy preferences in the base workspace, and the
default. URL imports receive their own storage context and do not read unrelated
private files. Invalid saved bytes remain available through workspace recovery.

The terminal is a byte stream UI, without a full PTY or job-control promise.
Closing Bash input ends that shell session; reload opens a fresh SDK realm.
Runtime commands and debugging continue through the owner after shell EOF.
Browsers without isolation can use supported batch commands but cannot start
the interactive Bash profile.

The application depends on the workspace `@wasm-idle/container` package. Build
the workspace packages before preparing the website; the local package's actual
version is retained, and no npm publication is required. Preparation pins the
actual Bash/BusyBox/LLVM assets and emits a fixed application asset table in
`src/lib/playground/container/release.ts`. It bundles only the qualified runtime
worker entries, not a second UI. The SDK remains a native module at its fixed
hash path, preserving its `import.meta.url`. Runtime manifests cannot supply
arbitrary host JavaScript paths.

```sh
pnpm install --frozen-lockfile
pnpm --filter @wasm-idle/container... run build
WASM_IDLE_PAGE_CONTAINER_CONFIG=/absolute/path/to/pinned-shell-config.json \
  pnpm run prepare:page-container
```

The configuration supplies the existing pinned shell producer inputs, exact SDK
package receipt, matching source/notice archives, and canonical asset `baseURL`
such as `https://seo-rii.github.io/wasm-idle/container-app/`. Generated runtime
files live in ignored `static/container-app/`. The compiled application rebases
only its fixed object and host paths onto the application's same-origin base,
so local and deployed website paths use the same verified byte identities.

Full selected-target sysroot delivery remains the default, using the original single tar
asset and complete header namespace. To opt into reduced C delivery, add this field to the
existing pinned configuration passed through `WASM_IDLE_PAGE_CONTAINER_CONFIG`:

```json
{ "sysrootProfile": "c-base-v1" }
```

Only this explicit build profile derives a C base and C++ delta. The website C Run path
uses the base for a lowercase `.c` source without custom compiler arguments or environment
overrides. This reduced profile omits the C++ subtree even when a header there is usable
from C, and changes include-presence probes involving that subtree. It is an explicit
choice of available headers, not a claim of equivalence for arbitrary C preprocessing.
No source-text heuristic is used to infer equivalence. C++, other source extensions,
response files, custom arguments/environment, and shell `clang` retain the full tree.
The full profile reuses the base and adds the delta; C and full readonly trees use separate
fixed mount paths. Already available full trees also serve later C requests. Under this
opt-in, full preparation needs two archive requests instead of the default one.
Once the full tree is mounted, later C requests use it without another C mount or download.
`c-base-v1` admits the current Clang 22 layout: derivation requires
`lib/clang/22/include` and uses the matching fixed resource directory. Other producer
resource-directory versions require a separately qualified profile.

The derivation moves only `include/c++/` and the known `libc++.a`/`libc++abi.a` archives.
Unknown paths stay in the base. Every original USTAR header and file body, including its
mode fields, is retained unchanged in exactly one layer. The complete tar is recomposed
with a new independently pinned SHA-256 before extraction; grouping records and normalizing
the zero terminator changes its byte identity. `provenance.json` retains the original
receipt, derived logical/delivery identities, and derivation source hashes. The VFS retains
its existing readonly file/directory mode policy.

For the pinned 35,328,000-byte source tar with SHA-256
`b5c51389ce2f2b404f8b354788aa4a19a65d7e4af746cf52d24e7276d2eabf7f`, local deterministic
gzip derivation produced these file bodies:

| Profile     | Logical tar bytes | Gzip delivery bytes | Original records |
| ----------- | ----------------: | ------------------: | ---------------: |
| C base      |        11,945,472 |           1,965,206 |              506 |
| C++ delta   |        23,380,992 |           4,776,132 |            1,779 |
| Both layers |        35,326,464 |           6,741,338 |            2,285 |

The existing deployed full tar already uses HTTP gzip (observed body 6,793,809 bytes).
Opted-in C skips the 4,776,132-byte encoded C++ package body; that is a package-byte saving,
not a measured browser wire delta. The reduction comes from omitting the C++ layer, rather
than simply adding compression. These are artifact/HTTP body sizes, not end-to-end browser timing or a
measurement of a deployed layered release. Host JavaScript, Clang, LLD, and protocol overhead
are additional bytes.

The checked-in generated `release.ts` and previously prepared assets retain their full-tar
fallback. New preparation records `sysrootProfile: "full"` by default; selecting
`"c-base-v1"` emits the split assets and supplies pinned `sysrootLayers` configuration
through the generated application release. Reusing old prepared assets does not enable
layering, and rebuilding without the opt-in keeps full delivery. This code change does
not upload or deploy a release.

After a workspace install, preparation detects the locally resolved Container
package. Set `"containerSource": "workspace"` in the build configuration to
select `packages/container` explicitly, including isolated validation that
reuses an older dependency installation. Only the fixed built exports and
worker entries are accepted; configuration cannot supply host JavaScript paths.
The selected source, package version, profile and compiled entry hashes are
recorded in `provenance.json` and included in the immutable host identity.
`page-config.json` records the selected source and profile as well.

Legacy asset preparation can explicitly set `"containerSource": "published"`
when the installed Container package is the qualified `0.1.0` release. This
option does not fetch or publish a package. BusyBox builds importing
`wasm_idle_fs_v1` for virtual modes require the workspace SDK; published `0.1.0`
cannot run that metadata profile. An old installed SDK is never selected
implicitly. The browser application's dependency remains the workspace package.

Run `node --test scripts/prepare-page-container.test.mjs` for the preparation
source-selection and legacy compatibility checks.

Normal `npm run page` keeps its existing asset preparation, verification and
browser audit. For an explicitly requested deployment with prepared runtime
assets and no asset qualification:

```sh
WASM_IDLE_SKIP_ASSET_VERIFICATION=1 \
WASM_IDLE_PAGE_REUSE_ASSETS=1 \
WASM_IDLE_PAGE_CONTAINER_CONFIG=/absolute/path/to/pinned-shell-config.json \
  npm run page
```

These invocation flags rebuild and deploy the existing website and preserve
normal runtime byte verification. They do not alter default verification policy.

With the pinned website assets prepared and the integrated website built, run
`pnpm run test:browser:container-sidebar` for the real Bash append/automatic
sidebar regression. `WASM_IDLE_BROWSER_URL` can select an existing test origin.
The fixture changes languages, enters `echo 1 >> hi.txt` through the terminal,
opens the actual shared file, and appends again without a manual refresh.
