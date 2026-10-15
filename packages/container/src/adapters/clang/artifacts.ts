import type { FileSystemSnapshot } from '../../fs/types.js';
import { checkMemoryProfile } from '../wasi/profile.js';

/** Qualify changed compiler outputs without inferring execution rights from a filename. */
export function qualifyExecutableOutputs(previous: FileSystemSnapshot, result: FileSystemSnapshot,
  exitCode: number, wasiImports: ReadonlySet<string>, maxMemoryBytes: number): FileSystemSnapshot {
  if (exitCode !== 0) return result;
  const before = new Map(previous.entries.map(entry => [entry.path, entry]));
  return { ...result, entries: result.entries.map(entry => {
    if (entry.type !== 'file' || !entry.path.startsWith('/workspace/') || !entry.data ||
      ![0, 97, 115, 109, 1, 0, 0, 0].every((byte, i) => entry.data![i] === byte)) return entry;
    const old = before.get(entry.path);
    if (old?.type === 'file' && old.data?.length === entry.data.length &&
      old.data.every((byte, i) => byte === entry.data![i])) return entry;
    try {
      checkMemoryProfile(entry.data, maxMemoryBytes);
      const module = new WebAssembly.Module(entry.data as Uint8Array<ArrayBuffer>);
      const imports = WebAssembly.Module.imports(module), exports = WebAssembly.Module.exports(module);
      if (!imports.some(item => item.module === 'wasm_idle_process_v1' && item.name === 'initial_cwd') ||
        imports.some(item => item.kind !== 'function' || !(item.module === 'wasi_snapshot_preview1' && wasiImports.has(item.name) ||
          item.module === 'wasm_idle_process_v1' && item.name === 'initial_cwd')) ||
        !exports.some(item => item.name === 'memory' && item.kind === 'memory') ||
        !exports.some(item => item.name === '_start' && item.kind === 'function')) return entry;
      // Preserve the compiler's read/write policy and grant execute only to readers.
      return { ...entry, mode: entry.mode | ((entry.mode & 0o444) >> 2) };
    } catch {
      // Other targets, relocatable objects and malformed outputs remain ordinary data.
      // Their eventual execution is still subject to the selected adapter's admission.
      return entry;
    }
  }) };
}
