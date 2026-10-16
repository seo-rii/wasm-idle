// Shared Node/Chromium regression: real guest operations, deterministic host interleavings.
import { createContainer } from '../../dist/container.js';
import { createLiveWasiAdapter } from '../../dist/adapters/wasi-live/index.js';
import { Operation, RPC_BYTES } from '../../dist/transport/rpc.js';
const encode = text => new TextEncoder().encode(text), decode = bytes => new TextDecoder().decode(bytes);
export const pathCases = ['read', 'write', 'nofollow', 'stat', 'mkdir', 'rmdir', 'unlink', 'readlink', 'symlink', 'rename', 'readdir'];
const assertion = (ok, message) => { if (!ok) throw new Error(message); };
const exists = (fs, path) => { try { fs.lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
export async function runPathCase(mode, bytes, nativeWorker) {
  let container, changed = false;
  const adapter = createLiveWasiAdapter({ workerFactory: () => {
    const worker = nativeWorker(); let buffer;
    const wrapper = {
      onmessage: null, onerror: null, onmessageerror: null,
      postMessage(data) { if (data.type === 'prepare') buffer = data.buffer; worker.postMessage(data); },
      terminate() { return worker.terminate(); }
    };
    worker.onmessage = event => {
      const header = buffer && new Int32Array(buffer, 0, 16);
      const operation = event.data.type === 'io' ? header[5] : 0;
      const args = operation ? JSON.parse(decode(new Uint8Array(buffer, 64, RPC_BYTES).slice(0, header[6]))) : [];
      const atomic = {
        read: Operation.PathOpen, write: Operation.PathOpen, nofollow: Operation.PathOpen,
        stat: Operation.PathStat, mkdir: Operation.PathMkdir, rmdir: Operation.PathRmdir,
        unlink: Operation.PathUnlink, readlink: Operation.PathReadlink,
        symlink: Operation.PathSymlink, rename: Operation.PathRename, readdir: Operation.DirectoryEntries
      }[mode];
      const intercept = !changed && (operation === atomic || (mode === 'nofollow'
        ? operation === Operation.Lstat
        : mode === 'rename' ? operation === Operation.DirectoryPath && args[0] === 5
        : operation === Operation.DirectoryPath));
      // The dispatch performs its synchronous portion before returning the Promise.
      // Interleave before the guest can issue its next request, without changing any reply.
      wrapper.onmessage?.(event);
      if (intercept) {
        changed = true;
        const fs = container.fs;
        if (mode === 'nofollow') {
          fs.unlink('/workspace/original/file');
          fs.symlink('target', '/workspace/original/file');
        } else if (mode === 'rename') {
          fs.rename('/workspace/from', '/workspace/saved-from');
          fs.rename('/workspace/to', '/workspace/saved-to');
          fs.mkdir('/workspace/from'); fs.mkdir('/workspace/to');
          fs.writeFile('/workspace/from/file', encode('replacement'));
        } else {
          fs.rename('/workspace/original', '/workspace/saved'); fs.mkdir('/workspace/original');
          if (mode === 'read' || mode === 'write' || mode === 'stat' || mode === 'unlink') fs.writeFile('/workspace/original/file', encode('replacement'));
          if (mode === 'rmdir') fs.mkdir('/workspace/original/empty');
          if (mode === 'readlink') fs.symlink('replacement-target', '/workspace/original/link');
          if (mode === 'readdir') fs.writeFile('/workspace/original/replacement-entry', encode('replacement'));
        }
      }
    };
    worker.onerror = event => wrapper.onerror?.(event);
    worker.onmessageerror = event => wrapper.onmessageerror?.(event);
    return wrapper;
  } });
  container = createContainer({ adapters: [adapter], commands: { path: { adapter: adapter.id, bytes } } });
  const fs = container.fs;
  fs.mkdir('/workspace/original');
  if (['read', 'write', 'nofollow', 'stat', 'unlink'].includes(mode)) fs.writeFile('/workspace/original/file', encode('original'));
  if (mode === 'nofollow') fs.writeFile('/workspace/original/target', encode('replacement-target'));
  if (mode === 'rmdir') fs.mkdir('/workspace/original/empty');
  if (mode === 'readlink') fs.symlink('original-target', '/workspace/original/link');
  if (mode === 'readdir') fs.writeFile('/workspace/original/original-entry', encode('original'));
  if (mode === 'rename') { fs.mkdir('/workspace/from'); fs.mkdir('/workspace/to'); fs.writeFile('/workspace/from/file', encode('original')); }
  const identity = mode === 'stat' ? fs.stat('/workspace/original/file').inode : mode === 'readdir' ? fs.stat('/workspace/original/original-entry').inode : undefined;
  try {
    const result = await container.run('path', [mode], { cwd: mode === 'rename' ? '/workspace' : '/workspace/original', timeoutMs: 15000 });
    assertion(changed, `${mode}: interleaving was not observed`);
    assertion(result.code === 0, `${mode}: guest exit ${result.code}/${result.reason}`);
    if (mode === 'read' || mode === 'nofollow') assertion(decode(result.stdout) === 'original', `${mode}: opened the replacement target`);
    if (mode === 'write') assertion(decode(fs.readFile('/workspace/saved/file')) === 'written' && decode(fs.readFile('/workspace/original/file')) === 'replacement', 'write: truncated the replacement directory');
    if (mode === 'stat') assertion(Number(new DataView(result.stdout.buffer, result.stdout.byteOffset).getBigUint64(8, true)) === identity, 'stat: returned the replacement inode');
    if (mode === 'mkdir' || mode === 'symlink') assertion(exists(fs, '/workspace/saved/created') && !exists(fs, '/workspace/original/created'), `${mode}: used the replacement directory`);
    if (mode === 'rmdir') assertion(!exists(fs, '/workspace/saved/empty') && exists(fs, '/workspace/original/empty'), 'rmdir: removed the replacement directory');
    if (mode === 'unlink') assertion(!exists(fs, '/workspace/saved/file') && exists(fs, '/workspace/original/file'), 'unlink: removed the replacement file');
    if (mode === 'readlink') assertion(decode(result.stdout) === 'original-target', 'readlink: read the replacement link');
    if (mode === 'rename') assertion(!exists(fs, '/workspace/saved-from/file') && decode(fs.readFile('/workspace/saved-to/moved')) === 'original' && decode(fs.readFile('/workspace/from/file')) === 'replacement', 'rename: failed to retain both directory identities');
    if (mode === 'readdir') {
      const view = new DataView(result.stdout.buffer, result.stdout.byteOffset);
      assertion(Number(view.getBigUint64(8, true)) === identity && decode(result.stdout.subarray(24)) === 'original-entry', 'readdir: mixed names or metadata from the replacement directory');
    }
    return { mode, code: result.code, interleaved: changed };
  } finally { await container.dispose(); fs.acquireSnapshot().discard(); }
}
