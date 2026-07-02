import { describe, expect, it } from 'vitest';
import { parseTar } from '../src/tar.js';

function writeString(bytes: Uint8Array, offset: number, length: number, value: string) {
	const encoded = new TextEncoder().encode(value);
	bytes.set(encoded.slice(0, length), offset);
}

function octal(value: number, length: number) {
	return value.toString(8).padStart(length - 1, '0') + '\0';
}

function createTar(files: Record<string, string>) {
	const chunks: Uint8Array[] = [];
	for (const [filePath, contents] of Object.entries(files)) {
		const body = new TextEncoder().encode(contents);
		const header = new Uint8Array(512);
		writeString(header, 0, 100, filePath);
		writeString(header, 100, 8, octal(0o644, 8));
		writeString(header, 124, 12, octal(body.byteLength, 12));
		header[156] = '0'.charCodeAt(0);
		chunks.push(
			header,
			body,
			new Uint8Array(Math.ceil(body.byteLength / 512) * 512 - body.byteLength)
		);
	}
	chunks.push(new Uint8Array(1024));
	const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const result = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

describe('tar parser', () => {
	it('parses uncompressed ustar file entries', () => {
		const entries = parseTar(createTar({ 'etc/ldc2.conf/30-compiler.conf': 'ok' }));

		expect(entries).toEqual([
			{
				path: 'etc/ldc2.conf/30-compiler.conf',
				type: 'file',
				bytes: new TextEncoder().encode('ok')
			}
		]);
	});

	it('rejects path traversal entries', () => {
		expect(() => parseTar(createTar({ '../escape': 'bad' }))).toThrow(/escapes/);
	});
});
