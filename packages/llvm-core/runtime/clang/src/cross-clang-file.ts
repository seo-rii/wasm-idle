import { File, OpenFile, wasi } from '@bjorn3/browser_wasi_shim';

function growStorage(length: number, capacity: number): Uint8Array {
	const preferred = Math.max(length, capacity * 2);
	try {
		return new Uint8Array(preferred);
	} catch (error) {
		if (!(error instanceof RangeError) || preferred === length) throw error;
		// The engine may allow the requested length even when doubling exceeds its limit.
		return new Uint8Array(length);
	}
}

/** The shim reads, seeks and stats through file.data. Keep that view at the logical EOF
 * while sharing the backing buffer's spare capacity between descriptors of the same inode. */
export class CompilerOpenFile extends OpenFile {
	constructor(fd: OpenFile) {
		super(fd.file);
		this.file_pos = fd.file_pos;
	}

	override fd_filestat_set_size(size: bigint): number {
		if (size < 0n) return wasi.ERRNO_INVAL;
		// WASI uses 64-bit file offsets, while typed array indices must be exact JS numbers.
		if (size > BigInt(Number.MAX_SAFE_INTEGER)) return wasi.ERRNO_FBIG;
		const length = Number(size);
		const previous = this.file.data;
		if (previous.byteLength === length) return wasi.ERRNO_SUCCESS;
		const capacity = previous.buffer.byteLength - previous.byteOffset;
		try {
			if (length > capacity) {
				const storage = growStorage(length, capacity);
				storage.set(previous);
				this.file.data = storage.subarray(0, length);
			} else {
				const bytes = new Uint8Array(previous.buffer, previous.byteOffset, length);
				if (length > previous.length) bytes.fill(0, previous.length);
				this.file.data = bytes;
			}
		} catch (error) {
			if (error instanceof RangeError) return wasi.ERRNO_NOMEM;
			throw error;
		}
		return wasi.ERRNO_SUCCESS;
	}

	override fd_allocate(offset: bigint, len: bigint) {
		if (offset < 0n || len < 0n) return wasi.ERRNO_INVAL;
		return offset + len > this.file.size ? this.fd_filestat_set_size(offset + len) : wasi.ERRNO_SUCCESS;
	}

	override fd_pwrite(data: Uint8Array, offset: bigint) {
		if (data.length === 0) return { ret: wasi.ERRNO_SUCCESS, nwritten: 0 };
		const ret = this.fd_allocate(offset, BigInt(data.length));
		if (ret !== wasi.ERRNO_SUCCESS) return { ret, nwritten: 0 };
		return super.fd_pwrite(data, offset);
	}

	override fd_write(data: Uint8Array) {
		const result = this.fd_pwrite(data, this.file_pos);
		this.file_pos += BigInt(result.nwritten);
		return result;
	}
}

/** The invocation releases its working files before returning. Keep the public artifact's
 * buffer exactly as long as its data, including when the caller transfers it to a Worker. */
export function takeCompilerOutput(file: File): Uint8Array {
	const bytes = file.data;
	if (file.readonly || bytes.byteOffset !== 0) return bytes.slice();
	if (bytes.byteLength === bytes.buffer.byteLength) return bytes;
	const buffer = bytes.buffer;
	if (buffer instanceof ArrayBuffer && 'transferToFixedLength' in buffer && typeof buffer.transferToFixedLength === 'function') {
		return new Uint8Array(buffer.transferToFixedLength(bytes.byteLength));
	}
	return bytes.slice();
}
