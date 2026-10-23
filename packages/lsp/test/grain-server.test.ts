import { describe, expect, it, vi } from 'vitest';
import { getGrainLanguageServer } from '../src/grain/language-server.js';

describe('Grain server project snapshot admission', () => {
	it.each(['/absolute.gr', '../escape.gr', 'sub/../escape.gr', 'sub\\escape.gr'])(
		'rejects unsafe project path %s before creating a worker',
		async (path) => {
			const createWorker = vi.fn();
			await expect(
				getGrainLanguageServer({
					grain: {
						baseUrl: 'https://example.test/wasm-grain-lsp/',
						workspaceFiles: [{ path, content: 'module Main' }]
					},
					createWorker
				})
			).rejects.toThrow('Invalid Grain LSP workspace file');
			expect(createWorker).not.toHaveBeenCalled();
		}
	);
	it('bounds workspace snapshot count before starting a worker', async () => {
		const createWorker = vi.fn();
		await expect(
			getGrainLanguageServer({
				grain: {
					baseUrl: 'https://example.test/wasm-grain-lsp/',
					workspaceFiles: Array.from({ length: 1001 }, (_, index) => ({
						path: `module${index}.gr`,
						content: 'module Main'
					}))
				},
				createWorker
			})
		).rejects.toThrow('1000 files');
		expect(createWorker).not.toHaveBeenCalled();
	});
});
