# ADR-001: Container boundaries

Date: 2026-10-13. Status: accepted for the experimental command-container stack.

## Decision

Keep browser process/VFS/asset integration in one optional `@wasm-idle/container` package.
Reuse `@wasm-idle/core` validation/cache and the existing LLVM host with structural bindings.
Keep wasm-llvm producer-only. Root imports include no compiler/userland bytes, no automatic
fetch, no Wasmer dependency and no side-effectful worker startup. Adapters are separate exports.

The common contract is files, descriptors, argv/env/cwd, lifecycle and capabilities. Engine
memories are not shared. Real language tools and shells are mandatory. Unsupported profiles
fail explicitly. A snapshot adapter cannot advertise live filesystem compatibility.

## Alternatives

Making WASIX the entire SDK would prematurely lock every runtime and storage contract to an
unproved external-exec bridge. Rebuilding all compilers for a new ABI duplicates functioning
producers. A JavaScript shell parser fails the actual-interpreter requirement. Splitting many npm
packages before the contracts stabilize increases release coupling without evidence of reuse.

## Consequences

G0 decides the shell separately. Independent P1/P2 work may proceed while shell work is blocked.
0.1 command alpha requires real Clang CLI qualification, not only foundational interfaces.
Mutable runtime instances are per-process. Verified bytes/modules may be cached. Worker and
cache cleanup must not delete the user's workspace. Persistence, terminal control, preview and
full offline app bootstrap each have additional gates.

See [development plan](../container-development-plan.md) and
[compatibility ledger](../container-compatibility.md).

## Shared language-host entry (2026-10-23)

The website consumes the optional `wasm-idle/container` integration entry, which
other browser applications can reuse. Process/VFS/asset primitives remain in `@wasm-idle/container`; the root SDK
owns the higher-level language execution contract. This avoids making the container
package depend on the language SDK, or introducing another release unit.

The integration accepts an application-owned Worker factory, language binding
factory, and pinned Bash/SDK configuration. Importing it has no Worker, fetch, or
message-handler side effects. Website release modules, language selection, UI,
and application persistence are kept outside the published entry. See the
[host setup contract](../container-website.md#sharing-the-execution-host).
