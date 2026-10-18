import { describe, expect, it } from 'vitest';
import { readTarEntries } from '../../../../../scripts/llvm-contracts/archive.mjs';
import untar from '../../core/src/tar.js';
import { readVRootArchive } from '../src/index.js';

const encoder = new TextEncoder();

function entry(name: string, contents: string, prefix = '', type = '0') {
	const data = encoder.encode(contents);
	const bytes = new Uint8Array(512 + Math.ceil(data.length / 512) * 512);
	const write = (offset: number, text: string) => bytes.set(encoder.encode(text), offset);
	const octal = (offset: number, length: number, value: number) =>
		write(offset, value.toString(8).padStart(length - 1, '0') + '\0');
	write(0, name);
	octal(100, 8, 0o644);
	octal(108, 8, 0);
	octal(116, 8, 0);
	octal(124, 12, data.length);
	octal(136, 12, 0);
	bytes.fill(32, 148, 156);
	write(156, type);
	write(257, 'ustar\0' + '00');
	write(345, prefix);
	const checksum = bytes.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
	write(148, checksum.toString(8).padStart(6, '0') + '\0 ');
	bytes.set(data, 512);
	return bytes;
}

function archive(...entries: Uint8Array[]) {
	const builtin = entry('v/vlib/builtin/builtin.v', 'module builtin\n');
	const all = [builtin, ...entries, new Uint8Array(1024)];
	const bytes = new Uint8Array(all.reduce((sum, bytes) => sum + bytes.length, 0));
	let offset = 0;
	for (const part of all) {
		bytes.set(part, offset);
		offset += part.length;
	}
	return bytes;
}

describe('V root archive paths', () => {
	it.each(['é.v', '한글.v', '😀.v'])(
		'preserves UTF-8 filename %s through verification and loading',
		(name) => {
			const path = `v/vlib/유니코드/${name}`;
			const tar = archive(entry(name, 'module example\n', 'v/vlib/유니코드'));
			expect(readTarEntries(tar).has(path)).toBe(true);
			const files = readVRootArchive(tar);
			expect([...files.keys()]).toEqual(['v/vlib/builtin/builtin.v', path]);
			expect(files.get(path)).toEqual(encoder.encode('module example\n'));
		}
	);

	it('decodes GNU long paths at the same V boundary', () => {
		const path = `v/vlib/${'한글/'.repeat(30)}é.v`;
		const tar = archive(
			entry('././@LongLink', `${path}\0`, '', 'L'),
			entry('ignored', 'source')
		);
		expect(readVRootArchive(tar).get(path)).toEqual(encoder.encode('source'));
	});

	it('preserves the raw path bytes passed to MemFS-style consumers', () => {
		const path = 'v/vlib/한글/é.v';
		const tar = archive(entry(path, 'source'));
		let received = '';
		untar(tar, {
			addDirectory() {},
			addFile(name) {
				if (name !== 'v/vlib/builtin/builtin.v') received = name;
			}
		});
		expect(Uint8Array.from(received, (byte) => byte.charCodeAt(0))).toEqual(
			encoder.encode(path)
		);
	});

	it('rejects invalid UTF-8 instead of replacing it in a V path', () => {
		const invalid = entry('v/vlib/test.v', 'source');
		invalid[7] = 0xff;
		expect(() => readVRootArchive(archive(invalid))).toThrow();
	});
});
