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

The application uses published `@wasm-idle/container@0.1.0`. Preparation pins the
actual Bash/BusyBox/LLVM assets and emits a fixed application asset table in
`src/lib/playground/container/release.ts`. It bundles only the qualified runtime
worker entries, not a second UI. The SDK remains a native module at its fixed
hash path, preserving its `import.meta.url`. Runtime manifests cannot supply
arbitrary host JavaScript paths.

```sh
WASM_IDLE_PAGE_CONTAINER_CONFIG=/absolute/path/to/pinned-shell-config.json \
  pnpm run prepare:page-container
```

The configuration supplies the existing pinned shell producer inputs, exact SDK
package receipt, matching source/notice archives, and canonical asset `baseURL`
such as `https://seo-rii.github.io/wasm-idle/container-app/`. Generated runtime
files live in ignored `static/container-app/`. The compiled application rebases
only its fixed object and host paths onto the application's same-origin base,
so local and deployed website paths use the same verified byte identities.

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
