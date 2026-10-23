import type { FileVersion, MemoryFileSystem } from '../../fs/index.js';
import { isProcessCommand } from '../clang/artifacts.js';
import { checkMemoryProfile } from '../wasi/profile.js';

/** Exact synchronous mutation observations, independent of lossy editor watchers. */
export function createCompilerOutputs(fs: MemoryFileSystem, maxTrackedFiles = fs.maxInodes, mutationSource?: unknown) {
  if (!Number.isSafeInteger(maxTrackedFiles) || maxTrackedFiles < 1) throw new RangeError('Invalid compiler output tracking limit');
  const writes = new Map<number, { version: FileVersion; conflicted: boolean }>();
  let disposed = false, exhausted = false;
  return {
    record(kind: 'write' | 'rename', version: FileVersion, previous?: FileVersion) {
      if (disposed || exhausted) return;
      const old = writes.get(version.inode);
      if (kind === 'rename' && !old) return;
      if (!old && writes.size >= maxTrackedFiles) { exhausted = true; writes.clear(); return; }
      writes.set(version.inode, { version, conflicted: Boolean(old && (old.conflicted || old.version !== previous)) });
    },
    async qualify(code: number, imports: ReadonlySet<string>, maxMemoryBytes: number, signal: AbortSignal) {
      if (code !== 0 || exhausted) return;
      for (const { version, conflicted } of writes.values()) {
        if (disposed || signal.aborted) return;
        if (conflicted) continue;
        const file = fs.readFileVersion(version);
        if (!file?.path.startsWith('/workspace/') || ![0, 97, 115, 109, 1, 0, 0, 0].every((value, i) => file.bytes[i] === value)) continue;
        try {
          checkMemoryProfile(file.bytes, maxMemoryBytes);
          // Compilation is asynchronous, and no guest code executes on this owner.
          const module = await WebAssembly.compile(file.bytes as Uint8Array<ArrayBuffer>);
          if (disposed || signal.aborted) return;
          if (isProcessCommand(module, imports)) fs.withMutationSource(mutationSource, () => fs.grantExecutable(version));
        } catch {
          // Objects, unsupported modules and concurrently edited outputs remain data.
        }
      }
    },
    dispose() { disposed = true; writes.clear(); }
  };
}
