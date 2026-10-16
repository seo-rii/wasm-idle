import { inflateRawSync } from 'node:zlib';

const MAX_ARCHIVE_ENTRY_BYTES = 256 * 1024 * 1024;
const crcTable = Array.from({ length: 256 }, (_, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
	return value >>> 0;
});

/** @param {Uint8Array} bytes */
function crc32(bytes) {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
	return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Read the reviewed producer's non-ZIP64, single regular file contract.
 * Validate metadata before allocation and CRC after decompression; object unpacking
 * alone would hide duplicate names and does not verify the ZIP checksum.
 * @param {Uint8Array} bytes
 * @param {string} expectedName
 * @param {string} [label]
 */
export function readSingleZipEntry(bytes, expectedName, label = 'ZIP') {
	const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	/** @param {string} message @returns {never} */
	const fail = (message) => {
		throw new Error(`${label} ${message}`);
	};
	let end = -1;
	for (let offset = input.length - 22; offset >= Math.max(0, input.length - 65557); offset--) {
		if (
			input.readUInt32LE(offset) === 0x06054b50 &&
			offset + 22 + input.readUInt16LE(offset + 20) === input.length
		) {
			end = offset;
			break;
		}
	}
	if (end < 0) fail('has no complete ZIP directory');
	if (
		input.readUInt16LE(end + 4) !== 0 ||
		input.readUInt16LE(end + 6) !== 0 ||
		input.readUInt16LE(end + 8) !== 1 ||
		input.readUInt16LE(end + 10) !== 1
	)
		fail(`must contain only ${expectedName}`);
	const directorySize = input.readUInt32LE(end + 12);
	const directory = input.readUInt32LE(end + 16);
	if (
		directory + directorySize !== end ||
		directorySize < 46 ||
		directory + 46 > end ||
		input.readUInt32LE(directory) !== 0x02014b50
	)
		fail('has an invalid ZIP directory');
	const nameLength = input.readUInt16LE(directory + 28);
	const extraLength = input.readUInt16LE(directory + 30);
	const commentLength = input.readUInt16LE(directory + 32);
	const expectedBytes = Buffer.from(expectedName);
	if (
		directorySize !== 46 + nameLength + extraLength + commentLength ||
		!input.subarray(directory + 46, directory + 46 + nameLength).equals(expectedBytes) ||
		input.readUInt16LE(directory + 34) !== 0
	)
		fail(`must contain only ${expectedName}`);
	const flags = input.readUInt16LE(directory + 8);
	const method = input.readUInt16LE(directory + 10);
	const checksum = input.readUInt32LE(directory + 16);
	const compressedSize = input.readUInt32LE(directory + 20);
	const originalSize = input.readUInt32LE(directory + 24);
	const local = input.readUInt32LE(directory + 42);
	const externalAttributes = input.readUInt32LE(directory + 38);
	const unixType = (externalAttributes >>> 16) & 0xf000;
	if (
		(flags & ~0x080e) !== 0 ||
		(method === 0 && (flags & 6) !== 0) ||
		![0, 8].includes(method) ||
		![0, 0x8000].includes(unixType) ||
		(externalAttributes & 0x10) !== 0 ||
		originalSize > MAX_ARCHIVE_ENTRY_BYTES
	)
		fail('has an unsupported ZIP entry or excessive uncompressed size');
	if (
		local !== 0 ||
		local + 30 > directory ||
		input.readUInt32LE(local) !== 0x04034b50 ||
		input.readUInt16LE(local + 6) !== flags ||
		input.readUInt16LE(local + 8) !== method ||
		input.readUInt16LE(local + 26) !== nameLength ||
		!input.subarray(local + 30, local + 30 + nameLength).equals(expectedBytes)
	)
		fail('has inconsistent ZIP entry metadata');
	const payload = local + 30 + nameLength + input.readUInt16LE(local + 28);
	const payloadEnd = payload + compressedSize;
	if (payloadEnd > directory) fail('has a truncated ZIP payload');
	if (flags & 8) {
		let descriptor = payloadEnd;
		if (descriptor + 4 <= directory && input.readUInt32LE(descriptor) === 0x08074b50)
			descriptor += 4;
		if (
			descriptor + 12 !== directory ||
			input.readUInt32LE(descriptor) !== checksum ||
			input.readUInt32LE(descriptor + 4) !== compressedSize ||
			input.readUInt32LE(descriptor + 8) !== originalSize
		)
			fail('has an invalid ZIP data descriptor');
	} else if (
		payloadEnd !== directory ||
		input.readUInt32LE(local + 14) !== checksum ||
		input.readUInt32LE(local + 18) !== compressedSize ||
		input.readUInt32LE(local + 22) !== originalSize
	) {
		fail('has inconsistent ZIP entry metadata');
	}
	let result;
	try {
		const compressed = input.subarray(payload, payloadEnd);
		if (method === 0) result = compressed;
		else {
			// Node returns this documented shape for info:true; its current type
			// declaration describes only the default Buffer return value.
			const inflated = /** @type {{ buffer: Buffer; engine: { bytesWritten: number } }} */ (
				/** @type {unknown} */ (
					inflateRawSync(compressed, {
						info: true,
						maxOutputLength: Math.max(1, originalSize)
					})
				)
			);
			if (inflated.engine.bytesWritten !== compressed.length)
				fail('has trailing bytes after the ZIP deflate stream');
			result = inflated.buffer;
		}
	} catch (error) {
		fail(`could not be decompressed: ${error instanceof Error ? error.message : error}`);
	}
	if (result.length !== originalSize || crc32(result) !== checksum)
		fail('has an invalid ZIP size or CRC checksum');
	return result;
}

// A deliberately small TAR contract for producer artifacts: regular files and directories.
// PAX, GNU long names, links, sparse files, and base-256 sizes must be normalized by
// the producer before packaging instead of silently changing the meaning of a path.
/** @param {Uint8Array} bytes */
export function readTarEntries(bytes) {
	if (
		(!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) ||
		bytes.length < 1024 ||
		bytes.length % 512 !== 0
	)
		throw new Error('TAR must contain complete blocks and a two-block terminator');
	const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
	const entries = new Map();
	let terminated = false;
	for (let offset = 0; offset < bytes.length;) {
		const header = bytes.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) {
			if (offset + 1024 > bytes.length || !bytes.subarray(offset).every((byte) => byte === 0))
				throw new Error('TAR has an incomplete terminator or trailing data');
			terminated = true;
			break;
		}
		/** @param {number} start @param {number} length */
		const text = (start, length) => {
			const field = header.subarray(start, start + length);
			const end = field.indexOf(0);
			if (end >= 0 && !field.subarray(end).every((byte) => byte === 0))
				throw new Error('TAR text field contains data after NUL');
			return decoder.decode(end < 0 ? field : field.subarray(0, end));
		};
		/** @param {number} start @param {number} length */
		const octal = (start, length) => {
			// Numeric fields are ASCII, even when archive paths are UTF-8. Unicode
			// whitespace must not normalize malformed bytes into an accepted size.
			const value = Buffer.from(header.subarray(start, start + length)).toString('latin1');
			if (!/^ *[0-7]+[\0 ]*$/.test(value)) throw new Error('TAR has an invalid octal number');
			const number = Number.parseInt(value, 8);
			if (!Number.isSafeInteger(number))
				throw new Error('TAR number exceeds the safe integer range');
			return number;
		};
		const checksum = octal(148, 8);
		const actualChecksum = header.reduce(
			(sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte),
			0
		);
		if (checksum !== actualChecksum) throw new Error('TAR header checksum mismatch');
		const magic = decoder.decode(header.subarray(257, 263));
		if (magic !== 'ustar\0' && magic !== 'ustar ')
			throw new Error('TAR must use ustar or GNU headers');
		// The runtime reads bytes 345..499 as a POSIX path prefix for either
		// header format. GNU timestamps/sparse metadata occupy the same region,
		// so only the zero-extension GNU profile has matching extraction paths.
		if (magic === 'ustar ' && header.subarray(345, 500).some((byte) => byte !== 0))
			throw new Error('TAR GNU extension fields are unsupported by the consumer runtime');
		const type = header[156];
		if (![0, 48, 53].includes(type)) throw new Error(`TAR entry type ${type} is unsupported`);
		const prefix = magic === 'ustar\0' ? text(345, 155) : '';
		const rawName = prefix ? `${prefix}/${text(0, 100)}` : text(0, 100);
		const name = rawName.replace(/^\.\//, '').replace(/\/$/, '');
		const directory = type === 53;
		if (
			/[\x00-\x1f\x7f\\]/.test(rawName) ||
			rawName.startsWith('/') ||
			(name && name.split('/').some((part) => !part || part === '.' || part === '..')) ||
			(!name && (!directory || rawName !== './')) ||
			(!directory && rawName.endsWith('/'))
		)
			throw new Error(`TAR has an unsafe path: ${rawName}`);
		if (entries.has(name)) throw new Error(`TAR has a duplicate path: ${name}`);
		const size = octal(124, 12);
		if (directory && size !== 0) throw new Error(`TAR directory has a payload: ${name}`);
		const next = offset + 512 + Math.ceil(size / 512) * 512;
		if (!Number.isSafeInteger(next) || next <= offset || next > bytes.length)
			throw new Error(`TAR payload is truncated: ${name}`);
		entries.set(name, { name, directory, size, offset: offset + 512 });
		offset = next;
	}
	if (!terminated) throw new Error('TAR is missing its two-block terminator');
	for (const name of entries.keys()) {
		const parts = name.split('/');
		for (let i = 1; i < parts.length; i++) {
			const ancestor = entries.get(parts.slice(0, i).join('/'));
			if (ancestor && !ancestor.directory)
				throw new Error(`TAR file is also a directory: ${ancestor.name}`);
		}
	}
	return entries;
}

/** @param {Uint8Array} bytes @param {string[]} required @param {string} [label] */
export function requireTarFiles(bytes, required, label = 'TAR') {
	const entries = readTarEntries(bytes);
	for (const name of required) {
		const entry = entries.get(name.replace(/^\.\//, ''));
		if (!entry || entry.directory || entry.size === 0)
			throw new Error(`${label} requires a nonempty regular file: ${name}`);
	}
	return entries;
}
