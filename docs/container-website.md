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
The shared `/workspace` list also shows files in other projects and at the root,
so changing the editor language cannot hide a file written by the persistent
Bash session. Selecting a language leaves Bash's real cwd and shell state intact.
Clicking a shared file inside a language project opens that project's current
bytes in the editor; root files and symlinks are listed for terminal access.
The list uses metadata only, does not follow symlinks, and pages its rendered
rows. File events update it during Run/Debug; editor reconciliation resumes after
execution releases the buffers, without requiring a manual refresh.
Reconciliation preserves concurrent editor buffers and reports conflicts. The
explorer's refresh control explicitly resolves conflicting revisions. Existing
workspace saving/export remains responsible for the editor workspace; the
container owner itself has page lifetime, and asset-cache eviction never deletes
user workspace storage.

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
