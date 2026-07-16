import * as zip from '@zip.js/zip.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { compile, getInstance, readBuffer } from '../src/wasm.js';

const emptyWasm = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);

async function zipBytes(filename: string, contents: Uint8Array) {
	const writer = new zip.ZipWriter(new zip.Uint8ArrayWriter());
	await writer.add(filename, new zip.Uint8ArrayReader(contents));
	return writer.close();
}

describe('WebAssembly loading utilities', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('rejects package-relative and file runtime assets', async () => {
		await expect(readBuffer('runtime.zip')).rejects.toThrow(
			/Runtime asset URL must be absolute/u
		);
		await expect(readBuffer('file:///tmp/runtime.zip')).rejects.toThrow(
			/Runtime assets must use HTTP\(S\)/u
		);
		await expect(readBuffer('data:application/zip;base64,AA==')).rejects.toThrow(
			/Runtime assets must use HTTP\(S\)/u
		);
	});

	it('extracts the first file from a zip response and reports completion', async () => {
		const progress = { set: vi.fn() };
		const archive = await zipBytes('fixture.bin', Uint8Array.of(1, 2, 3, 4));
		const url = 'https://cdn.test/llvm/fixture.bin.zip';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(archive))
		);

		await expect(readBuffer(url, progress)).resolves.toEqual(Uint8Array.of(1, 2, 3, 4));
		expect(progress.set).toHaveBeenLastCalledWith(1);
	});

	it('compiles zipped wasm and instantiates the resulting module', async () => {
		const archive = await zipBytes('fixture.wasm', emptyWasm);
		const url = 'https://cdn.test/llvm/fixture.wasm.zip';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(archive))
		);
		const module = await compile(url);
		const instance = await getInstance(module, {});

		expect(module).toBeInstanceOf(WebAssembly.Module);
		expect(instance).toBeInstanceOf(WebAssembly.Instance);
	});
});
