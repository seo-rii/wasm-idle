import { FsError, type MemoryFileSystem } from '../fs/index.js';

export { createWorkspaceBackup, restoreWorkspaceBackup, WorkspaceBackupError } from './backup.js';
export type { WorkspaceBackupOptions, WorkspaceBackupErrorCode } from './backup.js';

export interface WorkspaceEditorOptions {
  /** Largest file an editor session will copy. Defaults to 8 MiB. */
  readonly maxFileBytes?: number;
}
export interface WorkspaceEditorInspection {
  readonly path: string;
  readonly inode: number;
  /** Filesystem generation from which the current published bytes were read. */
  readonly baseGeneration: number;
  readonly workspaceGeneration: number;
  readonly state: 'clean' | 'modified' | 'conflict' | 'disposed';
}
export interface WorkspaceEditor {
  read(): Uint8Array;
  edit(bytes: Uint8Array): void;
  inspect(): WorkspaceEditorInspection;
  /** Atomic compare-and-write on this file's inode/content, not a durable flush. */
  publish(): { readonly generation: number; readonly inode: number };
  /** Modified buffers require explicit discard, including after a conflict. */
  reload(options?: { discardChanges?: boolean }): void;
  dispose(): void;
}
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, i) => value === b[i]);

/** An editor buffer is explicit staging; the filesystem remains the published source of truth. */
export function openWorkspaceEditor(fs: MemoryFileSystem, path: string, options: WorkspaceEditorOptions = {}): WorkspaceEditor {
  const max = options.maxFileBytes ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(max) || max < 0 || max > 256 * 1024 * 1024) throw new FsError('EINVAL', 'Invalid editor file limit');
  const canonical = fs.realpath(path, { root: '/workspace', cwd: '/workspace' });
  const current = () => {
    const info = fs.stat(canonical, { root: '/workspace' });
    if (info.type !== 'file') throw new FsError('EISDIR', 'Editor requires a regular file');
    if (info.size > max) throw new FsError('ENOSPC', 'File exceeds editor byte limit');
    return { bytes: Uint8Array.from(fs.readFile(canonical, { root: '/workspace' })), inode: info.inode, generation: fs.generation };
  };
  let base = current(), buffer = base.bytes.slice(), state: WorkspaceEditorInspection['state'] = 'clean';
  const active = () => { if (state === 'disposed') throw new FsError('EBADF', 'Editor session is disposed'); };
  return {
    read() { active(); return buffer.slice(); },
    edit(bytes) {
      active();
      if (!(bytes instanceof Uint8Array)) throw new FsError('EINVAL', 'Editor content requires bytes');
      if (bytes.length > max) throw new FsError('ENOSPC', 'Editor buffer exceeds its byte limit');
      buffer = Uint8Array.from(bytes); if (state !== 'conflict') state = equal(buffer, base.bytes) ? 'clean' : 'modified';
    },
    inspect() { return Object.freeze({ path: canonical, inode: base.inode, baseGeneration: base.generation, workspaceGeneration: fs.generation, state }); },
    publish() {
      active();
      let disk: ReturnType<typeof current>;
      try { disk = current(); }
      catch (error) {
        if (error instanceof FsError && ['ENOENT', 'EISDIR', 'ENOTDIR', 'EACCES', 'ELOOP', 'ENOSPC'].includes(error.code)) { state = 'conflict'; throw new FsError('ECONFLICT', 'Published file disappeared or changed; editor bytes were preserved'); }
        throw error;
      }
      if (disk.inode !== base.inode || !equal(disk.bytes, base.bytes)) { state = 'conflict'; throw new FsError('ECONFLICT', 'Published file changed; reload or export the editor buffer before resolving'); }
      // Synchronous owner operations cannot interleave between comparison and write.
      // Snapshot leases reject the write with EBUSY and leave the staged buffer intact.
      if (!equal(buffer, disk.bytes)) fs.writeFile(canonical, buffer, { root: '/workspace' });
      base = { bytes: buffer.slice(), inode: disk.inode, generation: fs.generation }; state = 'clean';
      return Object.freeze({ generation: base.generation, inode: base.inode });
    },
    reload({ discardChanges = false } = {}) {
      active();
      if (!discardChanges && (state === 'modified' || state === 'conflict')) throw new FsError('ECONFLICT', 'Reload requires explicit discard of unpublished editor changes');
      const next = current(); base = next; buffer = next.bytes.slice(); state = 'clean';
    },
    dispose() { if (state === 'disposed') return; state = 'disposed'; buffer = new Uint8Array(); base = { ...base, bytes: new Uint8Array() }; }
  };
}
