import type { FileSystemChange } from './types.js';

/** A slow UI gets a bounded invalidation hint instead of an unbounded event history. */
export function createFileSystemWatch(root: string, capacity: number, signal: AbortSignal | undefined, disposed: () => void) {
  let controller: ReadableStreamDefaultController<FileSystemChange>;
  const queue: FileSystemChange[] = [];
  let closed = false, pending = false, overflow = false;
  const cleanup = () => {
    if (closed) return;
    closed = true; queue.length = 0; signal?.removeEventListener('abort', abort); disposed();
  };
  const abort = () => { cleanup(); controller.close(); };
  const stream = new ReadableStream<FileSystemChange>({
    start(value) { controller = value; signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort(); },
    pull(value) {
      const next = queue.shift();
      if (next) { if (!queue.length) overflow = false; value.enqueue(next); }
      else pending = true;
    },
    cancel: cleanup
  }, { highWaterMark: 0 });
  return {
    stream,
    get closed() { return closed; },
    push(change: FileSystemChange) {
      if (closed) return;
      if (pending) { pending = false; controller.enqueue(change); return; }
      if (overflow || queue.length >= capacity) {
        queue.length = 0; overflow = true;
        queue.push(Object.freeze({ kind: 'rescan', path: root, generation: change.generation }));
      } else queue.push(change);
    }
  };
}
