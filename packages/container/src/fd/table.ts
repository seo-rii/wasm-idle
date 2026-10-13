import { PipeError } from './pipe.js';

/** Each fd owns one reference. dup delegates to an endpoint's shared open description. */
export interface Descriptor {
  dup(): Descriptor;
  close(): void;
}
export class DescriptorTable<T extends Descriptor> {
  #entries = new Map<number, T>();
  constructor(readonly limit = 256) {
    if (!Number.isSafeInteger(limit) || limit < 3) throw new PipeError('EINVAL');
  }
  add(description: T, fd?: number): number {
    if (fd === undefined) {
      fd = 0;
      while (this.#entries.has(fd) && fd < this.limit) fd++;
    }
    if (!Number.isSafeInteger(fd) || fd < 0 || fd >= this.limit || this.#entries.has(fd)) {
      throw new PipeError('EBADF', 'Unavailable descriptor');
    }
    this.#entries.set(fd, description);
    return fd;
  }
  get(fd: number): T {
    const result = this.#entries.get(fd);
    if (!result) throw new PipeError('EBADF');
    return result;
  }
  dup(fd: number): number {
    const endpoint = this.get(fd).dup() as T;
    try { return this.add(endpoint); } catch (error) { endpoint.close(); throw error; }
  }
  close(fd: number): void {
    const endpoint = this.get(fd);
    this.#entries.delete(fd);
    endpoint.close();
  }
  dispose(): void {
    for (const fd of [...this.#entries.keys()]) this.close(fd);
  }
  get size(): number { return this.#entries.size; }
}
