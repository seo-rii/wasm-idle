import { runInNewContext } from 'node:vm';
import { createPlaygroundBinding, validateWorkspaceFiles, type Sandbox } from '@wasm-idle/core';
import { describe, expect, it, vi } from 'vitest';

function maskedLength(value: unknown) {
	const content = new Uint8Array(256);
	Object.defineProperty(content, 'byteLength', { value });
	return content;
}

describe('native workspace byte spans', () => {
	it.each([undefined, 0, 1, NaN])('enforces the file quota despite byteLength=%s', (value) => {
		expect(() =>
			validateWorkspaceFiles([{ path: 'data.bin', content: maskedLength(value) }], {
				maxFileBytes: 16,
				maxTotalBytes: 1024
			})
		).toThrow(expect.objectContaining({ code: 'file-size-limit', actual: 256, limit: 16 }));
	});

	it('enforces the total quota against actual bytes before copying', () => {
		expect(() =>
			validateWorkspaceFiles([{ path: 'data.bin', content: maskedLength(undefined) }], {
				maxFileBytes: 1024,
				maxTotalBytes: 16
			})
		).toThrow(expect.objectContaining({ code: 'total-size-limit', actual: 256, limit: 16 }));
	});

	it('copies the actual subarray without evaluating shadowed span getters', () => {
		const content = Uint8Array.of(0, 1, 2, 3, 4, 5).subarray(2, 5);
		for (const key of ['byteLength', 'byteOffset', 'buffer', Symbol.toStringTag]) {
			Object.defineProperty(content, key, {
				get() {
					throw new Error('Caller span getter must not be evaluated');
				}
			});
		}
		const [file] = validateWorkspaceFiles([{ path: 'data.bin', content }], {
			maxFileBytes: 3,
			maxTotalBytes: 3
		});
		expect(Array.from(file.content as Uint8Array)).toEqual([2, 3, 4]);
		content.fill(99);
		expect(Array.from(file.content as Uint8Array)).toEqual([2, 3, 4]);
	});

	it.each([
		{ name: 'Uint16Array', content: new Uint16Array(3) },
		{ name: 'DataView', content: new DataView(new ArrayBuffer(3)) }
	])('rejects a $name disguised with a Uint8Array string tag', ({ content }) => {
		Object.defineProperty(content, Symbol.toStringTag, { value: 'Uint8Array' });
		expect(() =>
			validateWorkspaceFiles([
				{ path: 'data.bin', content: content as unknown as Uint8Array }
			])
		).toThrow(expect.objectContaining({ code: 'invalid-content' }));
	});

	it('accepts a real Uint8Array with an overridden string tag', () => {
		const content = Uint8Array.of(1, 2, 3);
		Object.defineProperty(content, Symbol.toStringTag, { value: 'Uint16Array' });
		expect(
			Array.from(validateWorkspaceFiles([{ path: 'data.bin', content }])[0].content)
		).toEqual([1, 2, 3]);
	});

	it('checks intrinsic lengths of foreign-realm views', () => {
		const content = runInNewContext(
			'const bytes = new Uint8Array(256); Object.defineProperty(bytes, "byteLength", {value: undefined}); bytes'
		) as Uint8Array;
		expect(() =>
			validateWorkspaceFiles([{ path: 'data.bin', content }], { maxFileBytes: 16 })
		).toThrow(expect.objectContaining({ code: 'file-size-limit', actual: 256 }));
	});

	it('rejects oversized binary files at the actual SDK run boundary', async () => {
		const run = vi.fn(async () => true);
		const runtime: Sandbox = {
			constructor: Object,
			eof() {},
			async load() {},
			run,
			terminate() {},
			async clear() {}
		};
		const binding = createPlaygroundBinding('/runtime', async () => runtime);
		try {
			const sandbox = await binding.load('C');
			await expect(
				sandbox.run('x', false, false, undefined, [], {
					workspaceFiles: [{ path: 'data.bin', content: maskedLength(undefined) }],
					workspaceLimits: { maxFileBytes: 16 },
					limits: { maxWorkspaceBytes: 1024 }
				})
			).rejects.toMatchObject({ code: 'file-size-limit', actual: 256, limit: 16 });
			expect(run).not.toHaveBeenCalled();
		} finally {
			await binding.dispose();
		}
	});
});
