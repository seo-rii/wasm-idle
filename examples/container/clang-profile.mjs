// Trusted application selection. A manifest cannot choose host JavaScript.
const profiles = Object.freeze({
  snapshot: Object.freeze({ filesystem: 'snapshot', adapterId: 'llvm-clang-tool-host-v1',
    workerPath: 'packages/container/src/adapters/clang/worker.ts', stdio: 'forwarded' }),
  live: Object.freeze({ filesystem: 'live', adapterId: 'llvm-clang-tool-host-live-v1',
    workerPath: 'packages/container/src/adapters/clang-live/worker.ts', stdio: 'delegated' })
});

export function selectClangProfile(value) {
  if (value === undefined) return profiles.snapshot;
  if (typeof value !== 'string' || !Object.hasOwn(profiles, value)) throw new TypeError('clangFilesystem must be snapshot or live');
  return profiles[value];
}
