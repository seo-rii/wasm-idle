import { Fd, Inode, wasi } from '@bjorn3/browser_wasi_shim';

const HEADER_WORDS = 8;
const SLOT_COUNT = 64;
const SLOT_WORDS = 8;
const SLOT_NAME_BYTES = 512;
const MIN_FILE_CAPACITY = 1024 * 1024;

const INITIALIZATION_INDEX = 0;
const NEXT_DATA_OFFSET_INDEX = 1;
const OVERFLOW_INDEX = 2;
const TABLE_LOCK_INDEX = 3;

const SLOT_STATE_INDEX = 0;
const SLOT_NAME_LENGTH_INDEX = 1;
const SLOT_DATA_OFFSET_INDEX = 2;
const SLOT_LENGTH_INDEX = 3;
const SLOT_CAPACITY_INDEX = 4;
const SLOT_LOCK_INDEX = 5;
const SLOT_SEQUENCE_INDEX = 6;
const SLOT_KIND_INDEX = 7;

const SLOT_STATE_EMPTY = 0;
const SLOT_STATE_ACTIVE = 1;
const SLOT_STATE_DELETED = 2;
const SLOT_KIND_FILE = 1;
const SLOT_KIND_DIRECTORY = 2;

const HEADER_BYTES = HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT;
const SLOT_METADATA_BYTES = SLOT_COUNT * SLOT_WORDS * Int32Array.BYTES_PER_ELEMENT;
const SLOT_NAMES_OFFSET = HEADER_BYTES + SLOT_METADATA_BYTES;
const DATA_OFFSET = Math.ceil(
	(SLOT_NAMES_OFFSET + SLOT_COUNT * SLOT_NAME_BYTES) / Int32Array.BYTES_PER_ELEMENT
) * Int32Array.BYTES_PER_ELEMENT;

function acquireLock(state: Int32Array, index: number) {
	while (Atomics.compareExchange(state, index, 0, 1) !== 0) {
		Atomics.wait(state, index, 1, 100);
	}
}

function releaseLock(state: Int32Array, index: number) {
	Atomics.store(state, index, 0);
	Atomics.notify(state, index);
}

export class SharedWorkspaceStore {
	private readonly buffer: SharedArrayBuffer;
	private readonly header: Int32Array;
	private readonly encoder = new TextEncoder();

	constructor(buffer: SharedArrayBuffer) {
		if (buffer.byteLength <= DATA_OFFSET + MIN_FILE_CAPACITY) {
			throw new Error(
				`shared rustc workspace is too small: ${buffer.byteLength} bytes; expected more than ${DATA_OFFSET + MIN_FILE_CAPACITY}`
			);
		}
		this.buffer = buffer;
		this.header = new Int32Array(buffer, 0, HEADER_WORDS);
		if (Atomics.compareExchange(this.header, INITIALIZATION_INDEX, 0, 1) === 0) {
			Atomics.store(this.header, NEXT_DATA_OFFSET_INDEX, DATA_OFFSET);
			Atomics.store(this.header, OVERFLOW_INDEX, 0);
			Atomics.store(this.header, TABLE_LOCK_INDEX, 0);
			Atomics.store(this.header, INITIALIZATION_INDEX, 2);
			Atomics.notify(this.header, INITIALIZATION_INDEX);
		} else {
			while (Atomics.load(this.header, INITIALIZATION_INDEX) !== 2) {
				Atomics.wait(this.header, INITIALIZATION_INDEX, 1, 100);
			}
		}
	}

	open(path: string, create: boolean) {
		const encodedPath = this.encodePath(path);
		acquireLock(this.header, TABLE_LOCK_INDEX);
		try {
			const existingSlot = this.findSlot(encodedPath, SLOT_KIND_FILE);
			if (existingSlot !== null) {
				return new SharedWorkspaceFile(this, existingSlot);
			}
			if (!create) {
				return null;
			}
			if (this.findSlot(encodedPath) !== null) {
				return null;
			}
			for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
				const metadata = this.slotMetadata(slot);
				if (Atomics.load(metadata, SLOT_STATE_INDEX) !== SLOT_STATE_EMPTY) {
					continue;
				}
				const initialOffset = this.allocateData(MIN_FILE_CAPACITY);
				if (initialOffset === null) {
					return null;
				}
				this.writeSlotName(slot, encodedPath);
				Atomics.store(metadata, SLOT_DATA_OFFSET_INDEX, initialOffset);
				Atomics.store(metadata, SLOT_LENGTH_INDEX, 0);
				Atomics.store(metadata, SLOT_CAPACITY_INDEX, MIN_FILE_CAPACITY);
				Atomics.store(metadata, SLOT_LOCK_INDEX, 0);
				Atomics.store(metadata, SLOT_SEQUENCE_INDEX, 0);
				Atomics.store(metadata, SLOT_KIND_INDEX, SLOT_KIND_FILE);
				Atomics.store(metadata, SLOT_STATE_INDEX, SLOT_STATE_ACTIVE);
				return new SharedWorkspaceFile(this, slot);
			}
			Atomics.store(this.header, OVERFLOW_INDEX, 1);
			return null;
		} finally {
			releaseLock(this.header, TABLE_LOCK_INDEX);
		}
	}

	createDirectory(path: string) {
		const encodedPath = this.encodePath(path);
		acquireLock(this.header, TABLE_LOCK_INDEX);
		try {
			if (this.findSlot(encodedPath) !== null) {
				return false;
			}
			for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
				const metadata = this.slotMetadata(slot);
				if (Atomics.load(metadata, SLOT_STATE_INDEX) !== SLOT_STATE_EMPTY) {
					continue;
				}
				this.writeSlotName(slot, encodedPath);
				Atomics.store(metadata, SLOT_KIND_INDEX, SLOT_KIND_DIRECTORY);
				Atomics.store(metadata, SLOT_STATE_INDEX, SLOT_STATE_ACTIVE);
				return true;
			}
			Atomics.store(this.header, OVERFLOW_INDEX, 1);
			return false;
		} finally {
			releaseLock(this.header, TABLE_LOCK_INDEX);
		}
	}

	hasDirectory(path: string) {
		const encodedPath = this.encodePath(path);
		acquireLock(this.header, TABLE_LOCK_INDEX);
		try {
			return this.findSlot(encodedPath, SLOT_KIND_DIRECTORY) !== null;
		} finally {
			releaseLock(this.header, TABLE_LOCK_INDEX);
		}
	}

	removeDirectory(path: string) {
		const encodedPath = this.encodePath(path);
		acquireLock(this.header, TABLE_LOCK_INDEX);
		try {
			const slot = this.findSlot(encodedPath, SLOT_KIND_DIRECTORY);
			if (slot === null) {
				return false;
			}
			Atomics.store(this.slotMetadata(slot), SLOT_STATE_INDEX, SLOT_STATE_DELETED);
			return true;
		} finally {
			releaseLock(this.header, TABLE_LOCK_INDEX);
		}
	}

	remove(path: string) {
		const encodedPath = this.encodePath(path);
		acquireLock(this.header, TABLE_LOCK_INDEX);
		try {
			const slot = this.findSlot(encodedPath, SLOT_KIND_FILE);
			if (slot === null) {
				return null;
			}
			Atomics.store(this.slotMetadata(slot), SLOT_STATE_INDEX, SLOT_STATE_DELETED);
			return new SharedWorkspaceFile(this, slot);
		} finally {
			releaseLock(this.header, TABLE_LOCK_INDEX);
		}
	}

	hasOverflowed() {
		return Atomics.load(this.header, OVERFLOW_INDEX) === 1;
	}

	getLength(slot: number) {
		return Atomics.load(this.slotMetadata(slot), SLOT_LENGTH_INDEX);
	}

	read(slot: number, offset: number, length: number) {
		const metadata = this.slotMetadata(slot);
		const fileLength = Atomics.load(metadata, SLOT_LENGTH_INDEX);
		const start = Math.min(offset, fileLength);
		const end = Math.min(fileLength, start + length);
		const dataOffset = Atomics.load(metadata, SLOT_DATA_OFFSET_INDEX);
		return new Uint8Array(this.buffer, dataOffset + start, end - start).slice();
	}

	write(slot: number, offset: number, data: Uint8Array) {
		const metadata = this.slotMetadata(slot);
		acquireLock(metadata, SLOT_LOCK_INDEX);
		try {
			const requiredLength = offset + data.byteLength;
			if (!this.ensureCapacityLocked(metadata, requiredLength)) {
				return false;
			}
			const dataOffset = Atomics.load(metadata, SLOT_DATA_OFFSET_INDEX);
			new Uint8Array(this.buffer, dataOffset + offset, data.byteLength).set(data);
			if (requiredLength > Atomics.load(metadata, SLOT_LENGTH_INDEX)) {
				Atomics.store(metadata, SLOT_LENGTH_INDEX, requiredLength);
			}
			Atomics.add(metadata, SLOT_SEQUENCE_INDEX, 1);
			Atomics.notify(metadata, SLOT_SEQUENCE_INDEX);
			return true;
		} finally {
			releaseLock(metadata, SLOT_LOCK_INDEX);
		}
	}

	truncate(slot: number, length: number) {
		const metadata = this.slotMetadata(slot);
		acquireLock(metadata, SLOT_LOCK_INDEX);
		try {
			if (!this.ensureCapacityLocked(metadata, length)) {
				return false;
			}
			const previousLength = Atomics.load(metadata, SLOT_LENGTH_INDEX);
			if (length < previousLength) {
				const dataOffset = Atomics.load(metadata, SLOT_DATA_OFFSET_INDEX);
				new Uint8Array(this.buffer, dataOffset + length, previousLength - length).fill(0);
			}
			Atomics.store(metadata, SLOT_LENGTH_INDEX, length);
			Atomics.add(metadata, SLOT_SEQUENCE_INDEX, 1);
			Atomics.notify(metadata, SLOT_SEQUENCE_INDEX);
			return true;
		} finally {
			releaseLock(metadata, SLOT_LOCK_INDEX);
		}
	}

	rename(slot: number, path: string) {
		const encodedPath = this.encodePath(path);
		acquireLock(this.header, TABLE_LOCK_INDEX);
		try {
			const existingSlot = this.findSlot(encodedPath);
			if (existingSlot !== null && existingSlot !== slot) {
				Atomics.store(
					this.slotMetadata(existingSlot),
					SLOT_STATE_INDEX,
					SLOT_STATE_DELETED
				);
			}
			this.writeSlotName(slot, encodedPath);
			Atomics.store(this.slotMetadata(slot), SLOT_STATE_INDEX, SLOT_STATE_ACTIVE);
			return true;
		} finally {
			releaseLock(this.header, TABLE_LOCK_INDEX);
		}
	}

	private encodePath(path: string) {
		const encodedPath = this.encoder.encode(path);
		if (encodedPath.byteLength === 0 || encodedPath.byteLength > SLOT_NAME_BYTES) {
			throw new Error(`shared rustc workspace path is invalid or too long: ${path}`);
		}
		return encodedPath;
	}

	private slotMetadata(slot: number) {
		return new Int32Array(
			this.buffer,
			HEADER_BYTES + slot * SLOT_WORDS * Int32Array.BYTES_PER_ELEMENT,
			SLOT_WORDS
		);
	}

	private slotName(slot: number) {
		return new Uint8Array(this.buffer, SLOT_NAMES_OFFSET + slot * SLOT_NAME_BYTES, SLOT_NAME_BYTES);
	}

	private writeSlotName(slot: number, encodedPath: Uint8Array) {
		const target = this.slotName(slot);
		target.fill(0);
		target.set(encodedPath);
		Atomics.store(this.slotMetadata(slot), SLOT_NAME_LENGTH_INDEX, encodedPath.byteLength);
	}

	private findSlot(encodedPath: Uint8Array, kind?: number) {
		for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
			const metadata = this.slotMetadata(slot);
			if (Atomics.load(metadata, SLOT_STATE_INDEX) !== SLOT_STATE_ACTIVE) {
				continue;
			}
			if (kind !== undefined && Atomics.load(metadata, SLOT_KIND_INDEX) !== kind) {
				continue;
			}
			const nameLength = Atomics.load(metadata, SLOT_NAME_LENGTH_INDEX);
			if (nameLength !== encodedPath.byteLength) {
				continue;
			}
			const name = this.slotName(slot);
			if (encodedPath.every((byte, index) => name[index] === byte)) {
				return slot;
			}
		}
		return null;
	}

	private allocateData(length: number) {
		const offset = Atomics.load(this.header, NEXT_DATA_OFFSET_INDEX);
		if (offset + length > this.buffer.byteLength) {
			Atomics.store(this.header, OVERFLOW_INDEX, 1);
			return null;
		}
		Atomics.store(this.header, NEXT_DATA_OFFSET_INDEX, offset + length);
		return offset;
	}

	private ensureCapacityLocked(metadata: Int32Array, requiredLength: number) {
		const currentCapacity = Atomics.load(metadata, SLOT_CAPACITY_INDEX);
		if (requiredLength <= currentCapacity) {
			return true;
		}
		let nextCapacity = currentCapacity;
		while (nextCapacity < requiredLength) {
			nextCapacity *= 2;
		}
		acquireLock(this.header, TABLE_LOCK_INDEX);
		try {
			const nextOffset = this.allocateData(nextCapacity);
			if (nextOffset === null) {
				return false;
			}
			const currentOffset = Atomics.load(metadata, SLOT_DATA_OFFSET_INDEX);
			const currentLength = Atomics.load(metadata, SLOT_LENGTH_INDEX);
			new Uint8Array(this.buffer, nextOffset, currentLength).set(
				new Uint8Array(this.buffer, currentOffset, currentLength)
			);
			Atomics.store(metadata, SLOT_DATA_OFFSET_INDEX, nextOffset);
			Atomics.store(metadata, SLOT_CAPACITY_INDEX, nextCapacity);
			return true;
		} finally {
			releaseLock(this.header, TABLE_LOCK_INDEX);
		}
	}
}

class OpenSharedWorkspaceFile extends Fd {
	private position = 0;
	private readonly file: SharedWorkspaceFile;

	constructor(file: SharedWorkspaceFile) {
		super();
		this.file = file;
	}

	fd_allocate(offset: bigint, length: bigint) {
		return this.file.truncate(Number(offset + length), false)
			? wasi.ERRNO_SUCCESS
			: wasi.ERRNO_NOSPC;
	}

	fd_fdstat_get() {
		return {
			ret: wasi.ERRNO_SUCCESS,
			fdstat: new wasi.Fdstat(wasi.FILETYPE_REGULAR_FILE, 0)
		};
	}

	fd_filestat_get() {
		return {
			ret: wasi.ERRNO_SUCCESS,
			filestat: this.file.stat()
		};
	}

	fd_filestat_set_size(size: bigint) {
		return this.file.truncate(Number(size), true) ? wasi.ERRNO_SUCCESS : wasi.ERRNO_NOSPC;
	}

	fd_read(size: number) {
		const data = this.file.read(this.position, size);
		this.position += data.byteLength;
		return { ret: wasi.ERRNO_SUCCESS, data };
	}

	fd_pread(size: number, offset: bigint) {
		return {
			ret: wasi.ERRNO_SUCCESS,
			data: this.file.read(Number(offset), size)
		};
	}

	fd_seek(offset: bigint, whence: number) {
		let nextPosition = this.position;
		if (whence === wasi.WHENCE_SET) {
			nextPosition = Number(offset);
		} else if (whence === wasi.WHENCE_CUR) {
			nextPosition += Number(offset);
		} else if (whence === wasi.WHENCE_END) {
			nextPosition = this.file.length + Number(offset);
		} else {
			return { ret: wasi.ERRNO_INVAL, offset: 0n };
		}
		if (!Number.isSafeInteger(nextPosition) || nextPosition < 0) {
			return { ret: wasi.ERRNO_INVAL, offset: 0n };
		}
		this.position = nextPosition;
		return { ret: wasi.ERRNO_SUCCESS, offset: BigInt(this.position) };
	}

	fd_tell() {
		return { ret: wasi.ERRNO_SUCCESS, offset: BigInt(this.position) };
	}

	fd_write(data: Uint8Array) {
		if (!this.file.write(this.position, data)) {
			return { ret: wasi.ERRNO_NOSPC, nwritten: 0 };
		}
		this.position += data.byteLength;
		return { ret: wasi.ERRNO_SUCCESS, nwritten: data.byteLength };
	}

	fd_pwrite(data: Uint8Array, offset: bigint) {
		return this.file.write(Number(offset), data)
			? { ret: wasi.ERRNO_SUCCESS, nwritten: data.byteLength }
			: { ret: wasi.ERRNO_NOSPC, nwritten: 0 };
	}
}

export class SharedWorkspaceFile extends Inode {
	private readonly store: SharedWorkspaceStore;
	private readonly slot: number;

	constructor(store: SharedWorkspaceStore, slot: number) {
		super();
		this.store = store;
		this.slot = slot;
	}

	get length() {
		return this.store.getLength(this.slot);
	}

	path_open(oflags: number) {
		if ((oflags & wasi.OFLAGS_TRUNC) === wasi.OFLAGS_TRUNC && !this.truncate(0, true)) {
			return { ret: wasi.ERRNO_NOSPC, fd_obj: null };
		}
		return {
			ret: wasi.ERRNO_SUCCESS,
			fd_obj: new OpenSharedWorkspaceFile(this)
		};
	}

	read(offset: number, length: number) {
		return this.store.read(this.slot, offset, length);
	}

	write(offset: number, data: Uint8Array) {
		return this.store.write(this.slot, offset, data);
	}

	truncate(length: number, updateLength: boolean) {
		if (!updateLength && length <= this.length) {
			return true;
		}
		return this.store.truncate(this.slot, length);
	}

	rename(path: string) {
		return this.store.rename(this.slot, path);
	}

	snapshot() {
		return this.read(0, this.length);
	}

	stat() {
		return new wasi.Filestat(this.ino, wasi.FILETYPE_REGULAR_FILE, BigInt(this.length));
	}
}
