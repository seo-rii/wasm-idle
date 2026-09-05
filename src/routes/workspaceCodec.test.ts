// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { workspaceFileBlob, workspaceFileBytes, workspaceFileFromBytes } from './workspaceCodec';
import { createWorkspaceArchive, extractWorkspaceArchive } from './workspaceArchive.worker';

describe('workspace binary boundaries', () => {
	it.each([
		['module.wasm', Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0)],
		['data.bin', Uint8Array.from({ length: 256 }, (_, index) => index)],
		['unknown.txt', Uint8Array.of(255, 254, 128, 0, 10)],
		['bom.txt', Uint8Array.of(239, 187, 191, 65, 13, 10)],
		['unicode.txt', new TextEncoder().encode('한글😀𠀀\r\n')],
		['empty.bin', new Uint8Array()]
	])('preserves %s across storage, downloads, and external ZIPs', async (path, bytes) => {
		const file = workspaceFileFromBytes(path, bytes);
		const restored = JSON.parse(JSON.stringify(file));
		expect(workspaceFileBytes(restored)).toEqual(bytes);
		expect(new Uint8Array(await workspaceFileBlob(restored).arrayBuffer())).toEqual(bytes);
		const extracted = extractWorkspaceArchive(zipSync({ [path]: bytes }));
		expect(workspaceFileBytes(extracted[0])).toEqual(bytes);
		expect(unzipSync(createWorkspaceArchive(extracted))[path]).toEqual(bytes);
		if (path.endsWith('.wasm')) {
			expect(WebAssembly.validate(workspaceFileBytes(restored))).toBe(true);
			expect(workspaceFileBlob(restored).type).toBe('application/wasm');
		}
	});

	it('migrates legacy WASM data URLs without decoding explicitly textual content', () => {
		const file = { path: 'old.wasm', content: 'data:application/wasm;base64,AGFzbQEAAAA=' };
		expect(WebAssembly.validate(workspaceFileBytes(file))).toBe(true);
		expect(workspaceFileBytes({ ...file, encoding: 'utf-8' })).toEqual(
			new TextEncoder().encode(file.content)
		);
	});

	it('rejects malformed binary data instead of downloading it as text', () => {
		expect(() =>
			workspaceFileBytes({ path: 'bad.wasm', encoding: 'data-url', content: 'oops' })
		).toThrow(/Invalid binary/);
	});
});
