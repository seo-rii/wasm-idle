import { FsError } from '../../fs/errors.js';
import type { WasiStdio } from '../wasi/stdio.js';

/** Synchronous tool children inherit references, never ownership of their parent's fds. */
export function createToolStdio(base: WasiStdio) {
  const stack: Set<number>[] = [], references = [0, 0, 0];
  return {
    bind(depth: number) {
      if (depth !== stack.length + 1 || depth > 2) throw new Error('Invalid LLVM stdio nesting');
      const open = new Set(stack.at(-1) ?? [0, 1, 2].filter(fd => base.isOpen?.(fd) ?? true));
      for (const fd of open) references[fd]!++;
      stack.push(open);
      let disposed = false;
      const check = (fd: number) => { if (disposed || !open.has(fd)) throw new FsError('EBADF', 'Tool descriptor is closed'); };
      return {
        stdio: {
          isOpen: (fd: number) => !disposed && open.has(fd),
          read(length: number) { check(0); return base.read(length); },
          write(fd: 1 | 2, bytes: Uint8Array) { check(fd); return base.write(fd, bytes); },
          close(fd: number) {
            check(fd); open.delete(fd);
            if (--references[fd]! === 0) base.close?.(fd);
          },
          capture: () => ({ stdout: new Uint8Array(), stderr: new Uint8Array() })
        } satisfies WasiStdio,
        dispose() {
          if (disposed) return;
          if (stack.at(-1) !== open) throw new Error('LLVM stdio disposal is out of order');
          disposed = true; stack.pop();
          for (const fd of open) references[fd]!--;
          open.clear();
          // Owner cleanup closes owned streams. Delegated shell endpoints remain
          // caller-owned unless a guest explicitly closed its last reference.
        }
      };
    }
  };
}
