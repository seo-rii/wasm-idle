# Persistent runtime asset cache

wasm-idle can retain verified compiler, runtime, debugger and language-server downloads across
page reloads. It stores binary bodies in **CacheStorage**, with SHA-256, version references and
LRU metadata in **IndexedDB**. It does not use localStorage for binaries or store user programs,
stdin, execution state, credentials or mutable Wasm instances.

This is separate from the in-memory compiler and compiled-program caches owned by
`createRuntimeSession`. Session `clear()`, language changes and `dispose()` do not delete the
persistent asset cache. Persistent bytes avoid downloading again; they do not eliminate Wasm
compilation, decompression or interpreter initialization.

## Configuration

The cache is enabled by default and downloads lazily. Importing the package never downloads
all languages. Configure defaults once in the browser before creating sessions or LSP workers:

```ts
import { configureRuntimeAssetCache, createRuntimeSession } from 'wasm-idle';

configureRuntimeAssetCache({
	enabled: true,
	maxBytes: 512 * 1024 * 1024,
	maxEntryBytes: 128 * 1024 * 1024,
	maxEntries: 4096,
	storageReserveBytes: 64 * 1024 * 1024,
	eviction: 'lru',
	namespace: 'my-editor'
});

const session = createRuntimeSession(
	{ rootUrl: '/runtime-assets/' },
	{ persistentCache: { maxBytes: 256 * 1024 * 1024 } }
);
const panel = session.createBinding();
const sandbox = await panel.load('PYTHON');
await sandbox.load('print("hello")', false, [], { persistentCache: false });
```

Use `configureRuntimeAssetCache(false)` to disable persistent reads and writes globally.
Use `persistentCache: false` in session/binding options or a `load`, `run`, or `execute` call
to disable them at that scope. A `run`/`execute` override does not change the following
execution's policy. A direct `load` supplies the worker's initialization policy and the baseline
for its later lazy downloads until the next load.
This does **not** disable the browser's ordinary HTTP cache or existing in-memory caches.
`configureRuntimeAssetCache({})` resets the global defaults. A later `{ enabled: true }`
explicitly re-enables caching; changing only a byte budget does not undo an earlier `false`.

Precedence is global defaults, shared `runtimeAssets.persistentCache`, runtime-specific
configuration (where supported), binding/session options, then function options. For example,
`runtimeAssets.python.persistentCache` can differ from `runtimeAssets.clang.persistentCache`.
LSP creation options and LLDB session options also accept `persistentCache`.
Worker startup receives a serializable policy snapshot. Changing global configuration does
not retroactively reconfigure an already initialized independent worker.

| Option                | Default                   | Meaning                                                  |
| --------------------- | ------------------------- | -------------------------------------------------------- |
| `enabled`             | `true`                    | Persistent reads and writes allowed                      |
| `maxBytes`            | 512 MiB                   | Stored binary body budget per namespace                  |
| `maxEntryBytes`       | 512 MiB                   | Largest individually cacheable body                      |
| `maxEntries`          | 4096                      | Maximum distinct content hashes                          |
| `storageReserveBytes` | 64 MiB                    | Leave estimated origin quota headroom                    |
| `eviction`            | `'lru'`                   | Evict oldest bodies; `'none'` skips new writes when full |
| `namespace`           | `'wasm-idle'`             | Isolate independently managed cache owners               |
| `version`             | wasm-idle release version | Reference label; does not replace SHA verification       |

Byte limits exclude browser implementation overhead and IndexedDB metadata. Other storage on
the same application origin shares the browser quota. Quota estimates are advisory, not a
reservation. A zero byte/entry budget bypasses storage. Oversized assets still load subject to
the runtime's independent execution/download limits; they simply are not persisted.

## Version pinning and storage lifetime

The generated release lock records expected asset hashes and compressed/logical byte lengths.
Cache hits are checked against the expected hash before use. Versions can reference the same
content-addressed body without making duplicate copies. URL, redirect, MIME and size-validation
policies remain part of loader eligibility: a permissive loader does not vouch for a stricter one.

Storage belongs to the **application's origin**, not the asset CDN's origin. Two applications
on different origins cannot share this cache. CacheStorage, IndexedDB and Web Locks must be
available; blocked/private-mode storage, missing APIs, corruption and quota failures fall back
to the normal verified download path. Integrity mismatches still fail rather than accepting
unverified bytes. Concurrent tabs coordinate storage updates using a namespace-scoped lock.

The browser may evict best-effort data. Persistence is an explicit host action, never an automatic
permission request:

```ts
import {
	getRuntimeAssetCacheStats,
	clearRuntimeAssetCache,
	pruneRuntimeAssetCache,
	requestRuntimeAssetCachePersistence
} from 'wasm-idle';

const stats = await getRuntimeAssetCacheStats(); // available, bytes, entries, versions, quota
const persisted = await requestRuntimeAssetCachePersistence(); // browser may return false
await clearRuntimeAssetCache({ version: 'old-release' }); // keeps bodies another version uses
await pruneRuntimeAssetCache(); // enforce current limits, remove orphaned bodies
await clearRuntimeAssetCache(); // this namespace only; never other applications' caches
```

Management operations respect `enabled: false` too. To explicitly delete while global caching
is disabled, pass `clearRuntimeAssetCache({ cache: { enabled: true } })`.

## Explicit downloads and prefetch

Custom byte loaders can use the same storage with trusted, caller-supplied receipts:

```ts
import { fetchPinnedRuntimeAsset, prefetchRuntimeAssets } from 'wasm-idle';

const asset = { url: wasmUrl, receipt: { sha256: expectedSha256, bytes: expectedBytes } };
await prefetchRuntimeAssets({ assets: [asset], concurrency: 2, signal });
const bytes = await fetchPinnedRuntimeAsset({ ...asset, signal });
```

These helpers require an absolute HTTP(S) URL and a full exact-URL response, omit credentials,
reject redirects and partial responses, enforce bounds, and verify the expected digest.
`prefetchRuntimeAssets` returns `{ completed, stored, skipped }`. Disabled/unavailable storage
skips downloads. `stored` counts accepted hits/writes at processing time, not guaranteed future
retention. Prefetch is for the paired pinned loader; it does not initialize a language, traverse
an import graph, or bypass another loader's stricter validation policy.

Producer adapters can use `createRuntimeAssetCacheBackend(options)` from `@wasm-idle/core`
or `wasm-idle`. It returns receipt-keyed `read(identity, signal?)` and
`write(identity, bytes, signal?)` methods bound to an immutable policy snapshot. Create the
backend for the operation whose options it represents. The structural contract lets a producer
accept it without importing Core. Nested Workers use the producer's explicit MessagePort bridge,
not functions inside `postMessage` or a mutable, process-wide fetch interceptor.

## Integration boundaries

The shared verified preflight/byte loaders, Clang/Python/TeaVM asset bridge, LLVM streaming
compiler path, static-runtime preflights, LSP verified asset loaders, and LLDB/WAMR loaders use
this cache. Explicitly provided integrity receipts remain authoritative. Custom base URLs or
custom loaders are not treated as a stock release merely because filenames match.

TinyGo's exact profile-pinned gzip toolchain payloads, JSON manifests and root archive also use
the cache. Its raw logical-URL probes and query variants retain their native fetch/fallback
behavior. Lisp caches its raw manifest only with a byte-level `manifestReceipt`; a canonical
manifest fingerprint alone is not a raw-byte SHA. The stock Lisp configuration supplies the
receipt from the release lock, while custom distributions must provide their own.

Rust's inner compiler Worker and OCaml's nested native-tool Workers receive an explicit,
receipt-authorized MessagePort cache bridge. Their compiler, sysroot, preload and runtime-pack
byte loaders retain their existing integrity and download-limit checks on both network and
cached paths. Host `load`/`run` policies are captured per operation; an opt-out does not become
sticky for later executions. Custom distributions need their own trusted receipts.

This is **not an all-language offline mode**. Native browser `import()`/`importScripts()`
and URL-based Worker startup are not globally intercepted. Application bootstrap and native
module loading can still require network access. Python LSP does not persist arbitrary custom
lock files or wheels. Unpinned custom assets are not persisted. No service worker is registered
or installed by this feature.

## Updating the release lock

After changing verified static assets, run `pnpm run assets:lock` and review the generated lock
along with the asset changes. `pnpm run check:assets-lock` detects version or content drift.
Application preparation checks this lock; Pages builds regenerate it after preparing static
assets, and npm release preparation regenerates it after version synchronization.
The generated source is shipped in `@wasm-idle/core`, not fetched from an
untrusted remote manifest at runtime.
