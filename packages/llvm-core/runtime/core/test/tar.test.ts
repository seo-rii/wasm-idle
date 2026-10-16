import { describe, expect, it, vi } from 'vitest';

import untar from '../src/tar.js';
import { readOct } from '../src/encode.js';
import { readTarEntries } from '../../../../../scripts/llvm-contracts/archive.mjs';

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

function withSize(entry: Uint8Array, field: Uint8Array) {
	entry.fill(0, 124, 136);
	entry.set(field, 124);
	entry.fill(32, 148, 156);
	const checksum = entry.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
	entry.set(encoder.encode(checksum.toString(8).padStart(6, '0') + '\0 '), 148);
	return createTar([entry]);
}

describe('untar', () => {
	it.each([
		['UTF-8 BOM', '\ufeff0000001\0'],
		['non-breaking space', '\u00a00000001\0'],
		['tab', '\t0000001\0'],
		['final newline', '00000000001\n'],
		['final carriage return', '00000000001\r'],
		['negative number', '-0000001\0'],
		['positive sign', '+0000001\0'],
		['non-octal digit', '0000008\0'],
		['data after NUL', '1\0' + '1'],
		['embedded space', '1 1\0'],
		['missing digits', '\0']
	])('rejects %s size fields in both verifier and runtime', (_name, field) => {
		const tar = withSize(
			createTarEntry({ name: 'test.h', type: '0', contents: encoder.encode('x') }),
			encoder.encode(field)
		);
		const addFile = vi.fn();
		expect(() => readTarEntries(tar)).toThrow('invalid octal');
		expect(() => untar(tar, { addFile, addDirectory: vi.fn() })).toThrow('invalid octal');
		expect(addFile).not.toHaveBeenCalled();
	});

	it.each(['00000000001\0', ' 000000001\0 ', '1\0 \0'])(
		'accepts ASCII padding in %j',
		(field) => {
			const tar = withSize(
				createTarEntry({ name: 'test.h', type: '0', contents: encoder.encode('x') }),
				encoder.encode(field)
			);
			const addFile = vi.fn();
			expect(readTarEntries(tar).get('test.h')?.size).toBe(1);
			untar(tar, { addFile, addDirectory: vi.fn() });
			expect(addFile).toHaveBeenCalledOnce();
			expect(decoder.decode(addFile.mock.calls[0][1])).toBe('x');
		}
	);

	it.each([8192, 2 ** 32])('rejects declared payload size %d outside the archive', (size) => {
		const tar = withSize(
			createTarEntry({ name: 'test.h', type: '0' }),
			encoder.encode(size.toString(8).padStart(11, '0') + '\0')
		);
		expect(() => untar(tar, { addFile: vi.fn(), addDirectory: vi.fn() })).toThrow(
			'out-of-range payload'
		);
	});

	it('does not accept a partially available octal field', () => {
		expect(() => readOct(encoder.encode('123'), 0, 8)).toThrow('invalid octal');
	});

	it('handles an empty archive terminator without reading numeric fields', () => {
		const addFile = vi.fn();
		untar(new Uint8Array(1024), { addFile, addDirectory: vi.fn() });
		expect(addFile).not.toHaveBeenCalled();
	});

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
