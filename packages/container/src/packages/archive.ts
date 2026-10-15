import { ContainerError } from '../errors.js';
import type { SnapshotEntry } from '../fs/types.js';

export interface TarPackageLimits {
  readonly maxArchiveBytes?: number;
  readonly maxEntries?: number;
  readonly maxFileBytes?: number;
  readonly maxTotalBytes?: number;
  readonly maxDepth?: number;
}

/** Extract already verified logical USTAR data into an unpublished readonly tree. */
export function extractTarPackage(input: Uint8Array, options: TarPackageLimits = {}): readonly Omit<SnapshotEntry, 'inode'>[] {
  const limits = { maxArchiveBytes: 128 * 1024 * 1024, maxEntries: 16384, maxFileBytes: 64 * 1024 * 1024,
    maxTotalBytes: 128 * 1024 * 1024, maxDepth: 32, ...options };
  for (const [key, value] of Object.entries(limits)) {
    if (!['maxArchiveBytes', 'maxEntries', 'maxFileBytes', 'maxTotalBytes', 'maxDepth'].includes(key) ||
      !Number.isSafeInteger(value) || value < 1) throw new ContainerError('INVALID_ARGUMENT', 'Invalid tar package limit');
  }
  const invalid = (message: string): never => { throw new ContainerError('INVALID_DISTRIBUTION', message); };
  if (!(input instanceof Uint8Array) || input.length > limits.maxArchiveBytes || input.length < 1024 || input.length % 512 !== 0 ||
    typeof SharedArrayBuffer === 'function' && input.buffer instanceof SharedArrayBuffer) invalid('Invalid bounded non-shared tar input');
  const bytes = input;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const field = (offset: number, length: number): string => {
    const view = bytes.subarray(offset, offset + length), end = view.indexOf(0);
    if (end >= 0 && view.subarray(end).some(byte => byte !== 0)) invalid('Nonzero data after tar field terminator');
    try { return decoder.decode(end < 0 ? view : view.subarray(0, end)); }
    catch { return invalid('Tar paths must be valid UTF-8'); }
  };
  const octal = (offset: number, length: number): number => {
    const value = String.fromCharCode(...bytes.subarray(offset, offset + length)).replace(/[\0 ]+$/u, '').trimStart();
    if (!/^[0-7]+$/u.test(value)) invalid('Unsupported tar numeric encoding');
    const result = Number.parseInt(value, 8);
    if (!Number.isSafeInteger(result)) invalid('Tar number exceeds safe range');
    return result;
  };
  const entries = new Map<string, Omit<SnapshotEntry, 'inode'>>(), explicit = new Set<string>();
  let offset = 0, total = 0, headers = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (offset + 1024 > bytes.length || bytes.subarray(offset).some(byte => byte !== 0)) invalid('Invalid tar end marker');
      return [...entries.values()];
    }
    if (++headers > limits.maxEntries) invalid('Tar entry count exceeds limit');
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i]!;
    if (sum !== octal(offset + 148, 8)) invalid('Tar header checksum mismatch');
    if (field(offset + 257, 6) !== 'ustar' || String.fromCharCode(...header.subarray(263, 265)) !== '00') {
      invalid('Only POSIX USTAR regular files and directories are supported');
    }
    const type = header[156], directory = type === 53;
    if (type !== 0 && type !== 48 && !directory) invalid('Unsupported tar entry type');
    if (field(offset + 157, 100)) invalid('Link metadata is unsupported');
    const prefix = field(offset + 345, 155), name = field(offset, 100);
    let path = prefix ? `${prefix}/${name}` : name;
    if (directory && path.endsWith('/')) path = path.slice(0, -1);
    const parts = path.split('/');
    if (new TextEncoder().encode(path).length > 4096 || parts.length > limits.maxDepth ||
      parts.some(part => !part || part === '.' || part === '..') || explicit.has(path)) invalid('Tar paths must be unique canonical relative paths');
    explicit.add(path);
    const size = octal(offset + 124, 12);
    if (size > limits.maxFileBytes || directory && size !== 0) invalid('Invalid tar entry size');
    total += size;
    if (total > limits.maxTotalBytes) invalid('Tar logical byte budget exceeded');
    const start = offset + 512, end = start + size, padded = start + Math.ceil(size / 512) * 512;
    if (!Number.isSafeInteger(padded) || padded > bytes.length || bytes.subarray(end, padded).some(byte => byte !== 0)) invalid('Truncated tar entry or invalid padding');
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/'), existing = entries.get(parent);
      if (existing && existing.type !== 'directory') invalid('Tar file/directory prefix conflict');
      if (!existing) entries.set(parent, { path: parent, type: 'directory', mode: 0o555 });
    }
    const existing = entries.get(path);
    if (existing && (!directory || existing.type !== 'directory')) invalid('Tar file/directory prefix conflict');
    entries.set(path, directory ? { path, type: 'directory', mode: 0o555 }
      : { path, type: 'file', mode: 0o444, data: Uint8Array.from(bytes.subarray(start, end)) });
    if (entries.size > limits.maxEntries) invalid('Tar tree inode budget exceeded');
    offset = padded;
  }
  return invalid('Tar is missing its two-block end marker');
}
