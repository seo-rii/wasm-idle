import { FsError, type FsErrorCode } from '../fs/index.js';

export const RPC_VERSION = 1;
export const RPC_BYTES = 65536;
const HEADER_BYTES = 64;
export const RPC_SIZE = HEADER_BYTES + 2 * RPC_BYTES;
const enum Field { State, Version, GenerationLow, GenerationHigh, Request, Operation, MetadataLength, DataLength, Error }
const enum State { Idle, Request, Response, Stopped }
export enum Operation {
  Open = 1, Close, Stat, Lstat, Fstat, DirectoryPath, Read, Pread, Write, Pwrite,
  Seek, Tell, Truncate, Realpath, Readdir, Mkdir, Unlink, Rmdir, Readlink, Symlink, Rename,
  Stdin, Stdout, StdioClose
}
export interface RpcNotice { type: 'io'; version: number; generation: number; id: number; }
export interface RpcReply { value?: unknown; bytes?: Uint8Array; }
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const errorCodes = new Set<FsErrorCode>(['EINVAL', 'ENOENT', 'ENOTDIR', 'EISDIR', 'EBADF', 'ELOOP', 'EXDEV', 'EACCES', 'EROFS', 'EEXIST', 'ENOTEMPTY', 'ENOSPC', 'EBUSY', 'ENOTSUP', 'ECONFLICT', 'EPIPE', 'EIO']);

function channel(buffer: SharedArrayBuffer, generation: number) {
  if (!(buffer instanceof SharedArrayBuffer) || buffer.byteLength !== RPC_SIZE || !Number.isSafeInteger(generation) || generation < 1) throw new Error('Invalid RPC channel');
  const header = new Int32Array(buffer, 0, HEADER_BYTES / 4);
  const metadata = new Uint8Array(buffer, HEADER_BYTES, RPC_BYTES), data = new Uint8Array(buffer, HEADER_BYTES + RPC_BYTES, RPC_BYTES);
  const identity = () => {
    if (Atomics.load(header, Field.Version) !== RPC_VERSION || (Atomics.load(header, Field.GenerationLow) >>> 0) !== (generation >>> 0) || Atomics.load(header, Field.GenerationHigh) !== Math.floor(generation / 2 ** 32)) throw new Error('Invalid RPC generation');
  };
  const lengths = () => {
    const a = Atomics.load(header, Field.MetadataLength), b = Atomics.load(header, Field.DataLength);
    if (a < 1 || a > RPC_BYTES || b < 0 || b > RPC_BYTES) throw new Error('Invalid RPC payload length');
    return [a, b] as const;
  };
  const stop = () => { Atomics.store(header, Field.State, State.Stopped); Atomics.notify(header, Field.State); };
  return { header, metadata, data, identity, lengths, stop };
}

export function createRpcBuffer(generation: number): SharedArrayBuffer {
  const buffer = new SharedArrayBuffer(RPC_SIZE), c = channel(buffer, generation);
  c.header[Field.Version] = RPC_VERSION;
  c.header[Field.GenerationLow] = generation >>> 0;
  c.header[Field.GenerationHigh] = Math.floor(generation / 2 ** 32);
  return buffer;
}

/** Only call in a dedicated Worker. The Supervisor must never synchronously wait. */
export function createRpcClient(buffer: SharedArrayBuffer, generation: number, post: (notice: RpcNotice) => void, maxBlockedIoMs: number) {
  if (!Number.isSafeInteger(maxBlockedIoMs) || maxBlockedIoMs < 1 || maxBlockedIoMs > 3600000) throw new Error('Invalid RPC wait deadline');
  const c = channel(buffer, generation); c.identity();
  let sequence = 0;
  return (operation: Operation, args: readonly unknown[], bytes: Uint8Array = new Uint8Array()): RpcReply => {
    c.identity();
    if (Atomics.load(c.header, Field.State) !== State.Idle || sequence === 0x7fffffff) throw new Error('RPC channel unavailable');
    const encoded = encoder.encode(JSON.stringify(args));
    if (encoded.length > RPC_BYTES || bytes.length > RPC_BYTES) throw new FsError('ENOSPC', 'RPC request exceeds bounded channel');
    const id = ++sequence;
    c.metadata.set(encoded); c.data.set(bytes);
    c.header[Field.Request] = id; c.header[Field.Operation] = operation;
    c.header[Field.MetadataLength] = encoded.length; c.header[Field.DataLength] = bytes.length; c.header[Field.Error] = 0;
    Atomics.store(c.header, Field.State, State.Request);
    post({ type: 'io', version: RPC_VERSION, generation, id });
    const deadline = performance.now() + maxBlockedIoMs;
    while (Atomics.load(c.header, Field.State) === State.Request) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) { c.stop(); throw new Error('RPC wait deadline exceeded'); }
      Atomics.wait(c.header, Field.State, State.Request, remaining);
    }
    c.identity();
    if (Atomics.load(c.header, Field.State) !== State.Response || c.header[Field.Request] !== id || c.header[Field.Operation] !== operation) throw new Error('RPC stopped or corrupt response');
    const [a, b] = c.lengths();
    // Browser TextDecoder rejects shared views; decode an owned response snapshot.
    const value: unknown = JSON.parse(decoder.decode(c.metadata.slice(0, a)));
    const resultBytes = c.data.slice(0, b), error = c.header[Field.Error];
    Atomics.store(c.header, Field.State, State.Idle);
    if (error === 1 && typeof value === 'string' && errorCodes.has(value as FsErrorCode)) throw new FsError(value as FsErrorCode, `Live I/O failed: ${value}`);
    if (error !== 0) throw new Error('Invalid RPC error response');
    return { value, bytes: resultBytes };
  };
}
export type RpcCall = ReturnType<typeof createRpcClient>;

/** A channel is bound to one process by closure, never by guest-supplied pid lookup. */
export function createRpcServer(buffer: SharedArrayBuffer, generation: number, dispatch: (operation: Operation, args: unknown[], bytes: Uint8Array) => Promise<RpcReply>) {
  const c = channel(buffer, generation);
  let sequence = 0, busy = false, stopped = false;
  return {
    stop() { stopped = true; c.stop(); },
    async accept(notice: RpcNotice) {
      if (stopped) return;
      c.identity();
      if (busy || !notice || notice.type !== 'io' || notice.version !== RPC_VERSION || notice.generation !== generation || notice.id !== sequence + 1 || notice.id > 0x7fffffff || Atomics.load(c.header, Field.State) !== State.Request || c.header[Field.Request] !== notice.id) throw new Error('Invalid RPC request sequence');
      const operation = c.header[Field.Operation]!;
      if (operation < Operation.Open || operation > Operation.StdioClose) throw new Error('Invalid RPC operation');
      const [a, b] = c.lengths();
      const args: unknown = JSON.parse(decoder.decode(c.metadata.slice(0, a)));
      if (!Array.isArray(args) || args.length > 4 || c.header[Field.Error] !== 0) throw new Error('Invalid RPC arguments');
      const bytes = c.data.slice(0, b);
      busy = true; sequence = notice.id;
      let response: RpcReply, failure = 0;
      try { response = await dispatch(operation, args, bytes); }
      catch (error) {
        if (!(error instanceof FsError)) throw error;
        response = { value: error.code }; failure = 1;
      }
      if (stopped) return;
      c.identity();
      if (Atomics.load(c.header, Field.State) !== State.Request || c.header[Field.Request] !== notice.id || c.header[Field.Operation] !== operation) throw new Error('RPC request changed during I/O');
      const encoded = encoder.encode(JSON.stringify(response.value ?? null));
      if (encoded.length > RPC_BYTES || (response.bytes?.length ?? 0) > RPC_BYTES) throw new Error('RPC response exceeds bounded channel');
      c.metadata.set(encoded); if (response.bytes) c.data.set(response.bytes);
      c.header[Field.MetadataLength] = encoded.length; c.header[Field.DataLength] = response.bytes?.length ?? 0; c.header[Field.Error] = failure;
      busy = false;
      Atomics.store(c.header, Field.State, State.Response); Atomics.notify(c.header, Field.State);
    }
  };
}
