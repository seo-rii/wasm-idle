import { describe, expect, it, vi } from 'vitest';

import untar from '../src/tar.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function createTarEntry({
	name,
	type,
	contents = new Uint8Array(),
	prefix = ''
}: {
	name: string;
	type: string;
	contents?: Uint8Array;
	prefix?: string;
}) {
	const block = new Uint8Array(512);
	const writeAscii = (offset: number, length: number, value: string) => {
		const bytes = encoder.encode(value);
		block.set(bytes.subarray(0, length), offset);
	};
	const writeOctal = (offset: number, length: number, value: number) => {
		writeAscii(offset, length, value.toString(8).padStart(length - 1, '0') + '\0');
	};

	writeAscii(0, 100, name);
	writeOctal(100, 8, 0o644);
	writeOctal(108, 8, 0);
	writeOctal(116, 8, 0);
	writeOctal(124, 12, contents.byteLength);
	writeOctal(136, 12, 0);
	writeAscii(148, 8, '        ');
	writeAscii(156, 1, type);
	writeAscii(257, 6, 'ustar\0');
	writeAscii(263, 2, '00');
	writeAscii(345, 155, prefix);

	const checksum = block.reduce((sum, byte) => sum + byte, 0);
	writeAscii(148, 8, checksum.toString(8).padStart(6, '0') + '\0 ');

	const paddedSize = Math.ceil(contents.byteLength / 512) * 512;
	const entry = new Uint8Array(512 + paddedSize);
	entry.set(block);
	entry.set(contents, 512);
	return entry;
}

function createTar(entries: Uint8Array[]) {
	const terminator = new Uint8Array(1024);
	const size = entries.reduce((sum, entry) => sum + entry.byteLength, terminator.byteLength);
	const tar = new Uint8Array(size);
	let offset = 0;
	for (const entry of entries) {
		tar.set(entry, offset);
		offset += entry.byteLength;
	}
	tar.set(terminator, offset);
	return tar;
}

describe('untar', () => {
	it('reads GNU long names and ustar filename prefixes', () => {
		const longName =
			'include/c++/v1/__support/very/long/path/that/needs/gnu/longlink/header.hpp';
		const addFile = vi.fn();
		const addDirectory = vi.fn();

		untar(
			createTar([
				createTarEntry({
					name: '././@LongLink',
					type: 'L',
					contents: encoder.encode(`${longName}\0`)
				}),
				createTarEntry({
					name: 'ignored-name',
					type: '0',
					contents: encoder.encode('long-name')
				}),
				createTarEntry({
					name: 'assoc_container.hpp',
					prefix: 'include/c++/v1/ext/pb_ds',
					type: '0',
					contents: encoder.encode('prefixed-name')
				})
			]),
			{ addFile, addDirectory }
		);

		expect(addDirectory).not.toHaveBeenCalled();
		expect(addFile).toHaveBeenCalledWith(longName, expect.any(Uint8Array));
		expect(addFile).toHaveBeenCalledWith(
			'include/c++/v1/ext/pb_ds/assoc_container.hpp',
			expect.any(Uint8Array)
		);
		expect(decoder.decode(addFile.mock.calls[0][1])).toBe('long-name');
		expect(decoder.decode(addFile.mock.calls[1][1])).toBe('prefixed-name');
	});
});
