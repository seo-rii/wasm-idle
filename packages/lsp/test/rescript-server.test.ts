import { describe, expect, it, vi } from 'vitest';
import { createReScriptServer } from '../src/rescript/host.js';
import { getReScriptLanguageServer } from '../src/rescript/language-server.js';

describe('ReScript workspace boundaries', () => {
	it.each([
		'../Main.res',
		'/Main.res',
		'a//Main.res',
		'a/./Main.res',
		'a\\Main.res',
		'a\0Main.res'
	])('rejects %j before starting a worker', async (path) => {
		const createWorker = vi.fn();
		await expect(
			getReScriptLanguageServer({
				rootUrl: 'https://example.com/',
				createWorker,
				rescript: { workspaceFiles: [{ path, content: 'let value = 1' }] }
			})
		).rejects.toThrow('Invalid ReScript workspace file');
		expect(createWorker).not.toHaveBeenCalled();
	});

	it('rejects ambiguous case for clients that normalize file URIs', async () => {
		const createWorker = vi.fn();
		await expect(
			getReScriptLanguageServer({
				rootUrl: 'https://example.com/',
				createWorker,
				rescript: {
					workspaceFiles: [
						{ path: 'Main.res', content: '' },
						{ path: 'main.res', content: '' }
					]
				}
			})
		).rejects.toThrow('Ambiguous ReScript workspace');
		expect(createWorker).not.toHaveBeenCalled();
	});

	it('bounds the number of compiler inputs before allocating a worker', async () => {
		const createWorker = vi.fn();
		const workspaceFiles = Array.from({ length: 65 }, (_, i) => ({
			path: `Module${i}.res`,
			content: ''
		}));
		await expect(
			getReScriptLanguageServer({
				rootUrl: 'https://example.com/',
				createWorker,
				rescript: { workspaceFiles }
			})
		).rejects.toThrow('64 source files');
		expect(createWorker).not.toHaveBeenCalled();
	});

	it('bounds UTF-8 workspace bytes before allocating a worker', async () => {
		const createWorker = vi.fn();
		await expect(
			getReScriptLanguageServer({
				rootUrl: 'https://example.com/',
				createWorker,
				rescript: {
					workspaceFiles: [{ path: 'Main.res', content: '한'.repeat(6 * 1024 * 1024) }]
				}
			})
		).rejects.toThrow('16 MiB');
		expect(createWorker).not.toHaveBeenCalled();
	});
});

describe('ReScript executable asset integrity', () => {
	it('rejects a substituted executable before importing or sending messages', async () => {
		const fetch = vi.fn(
			async () =>
				new Response('export function start() { throw Error("unverified code ran") }')
		);
		vi.stubGlobal('fetch', fetch);
		const send = vi.fn();
		try {
			await expect(
				createReScriptServer(
					{
						baseUrl: 'https://assets.example.com/wasm-rescript-lsp/',
						workspaceFiles: []
					},
					send
				)
			).rejects.toThrow(/integrity|receipt|size|bytes/i);
			expect(send).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
