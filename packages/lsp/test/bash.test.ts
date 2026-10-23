import { describe, expect, it, vi } from 'vitest';
import { getBashLanguageServer } from '../src/bash/language-server.js';
import {
	startBashLanguageServerWorker,
	type LoadBashLanguageServer
} from '../src/bash/worker-host.js';
import { resolveBashLanguageServerModuleUrl } from '../src/runtime.js';
import * as vfs from '../../../producers/bash-language-server/src/platform/fs.js';

class LocalWorker extends EventTarget {
	readonly terminate = vi.fn();
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	private readonly workerEvents = new EventTarget();
	constructor(load: LoadBashLanguageServer) {
		super();
		startBashLanguageServerWorker(
			{
				addEventListener: (_, listener) =>
					this.workerEvents.addEventListener('message', listener as EventListener),
				postMessage: (data) =>
					queueMicrotask(() => {
						const event = new MessageEvent('message', { data });
						this.dispatchEvent(event);
						this.onmessage?.(event);
					})
			},
			load
		);
	}
	postMessage(data: unknown) {
		queueMicrotask(() =>
			this.workerEvents.dispatchEvent(new MessageEvent('message', { data }))
		);
	}
}

describe('original Bash LSP host', () => {
	it('requires explicit assets and resolves deployment roots', () => {
		expect(() => resolveBashLanguageServerModuleUrl(undefined)).toThrow(
			/explicit provider URL or rootUrl/
		);
		expect(resolveBashLanguageServerModuleUrl('https://cdn.test/tools')).toBe(
			'https://cdn.test/tools/wasm-bash-lsp/runtime.mjs'
		);
		expect(
			resolveBashLanguageServerModuleUrl(
				{ bash: { moduleUrl: '/custom/bash.mjs' } },
				'https://example.test/app/'
			)
		).toBe('https://example.test/custom/bash.mjs');
	});
	it('delegates JSON-RPC transport ownership to upstream and forwards workspace files', async () => {
		const files = { 'lib.sh': 'greet() { echo hello; }\n' };
		const start = vi.fn(async ({ scope }: { scope: any }) => {
			scope.addEventListener('message', ({ data }: MessageEvent<any>) => {
				if (data.jsonrpc === '2.0')
					scope.postMessage({ jsonrpc: '2.0', id: data.id, result: data.params });
			});
		});
		const load = vi.fn(async () => ({ startBashLanguageServer: start }));
		const worker = new LocalWorker(load);
		const onStatus = vi.fn();
		const handle = await getBashLanguageServer({
			bash: { moduleUrl: 'https://cdn.test/runtime.mjs', files },
			createWorker: () => worker as unknown as Worker,
			onStatus
		});
		const received: unknown[] = [];
		handle.transport.reader.listen((message) => received.push(message));
		const request = {
			jsonrpc: '2.0',
			id: 7,
			method: 'upstream/customMethod',
			params: { opaque: true }
		};
		await handle.transport.writer.write(request);
		await vi.waitFor(() =>
			expect(received).toEqual([{ jsonrpc: '2.0', id: 7, result: request.params }])
		);
		expect(load).toHaveBeenCalledExactlyOnceWith('https://cdn.test/runtime.mjs');
		expect(start.mock.calls[0][0]).toMatchObject({ files });
		worker.postMessage({ type: 'init', options: { moduleUrl: 'ignored' } });
		await Promise.resolve();
		expect(start).toHaveBeenCalledOnce();
		handle.dispose();
		handle.dispose();
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(onStatus).toHaveBeenLastCalledWith({ state: 'disabled' });
	});
	it('fails startup and cleans up when the real runtime fails', async () => {
		const worker = new LocalWorker(async () => {
			throw new Error('grammar unavailable');
		});
		await expect(
			getBashLanguageServer({
				bash: { moduleUrl: 'https://cdn.test/runtime.mjs' },
				createWorker: () => worker as unknown as Worker
			})
		).rejects.toThrow('grammar unavailable');
		expect(worker.terminate).toHaveBeenCalledOnce();
	});
	it('cancels an in-flight runtime load', async () => {
		const load = vi.fn(() => new Promise<never>(() => {}));
		const worker = new LocalWorker(load);
		const controller = new AbortController();
		const pending = getBashLanguageServer({
			bash: { moduleUrl: 'https://cdn.test/runtime.mjs' },
			createWorker: () => worker as unknown as Worker,
			signal: controller.signal
		});
		await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
		controller.abort(new Error('language changed'));
		await expect(pending).rejects.toThrow('language changed');
		expect(worker.terminate).toHaveBeenCalledOnce();
	});
});

describe('Bash Node filesystem adapter', () => {
	it('provides file URLs, nested directories, binary reads and Node error codes', async () => {
		vfs.initializeFiles(
			{ 'nested/lib.sh': 'greet() { echo hello; }\n' },
			new Uint8Array([0, 97, 115, 109])
		);
		expect(vfs.readFileSync(new URL('file:///workspace/nested/lib.sh'), 'utf8')).toContain(
			'greet'
		);
		expect(vfs.readdirSync('/workspace', { withFileTypes: true })[0].isDirectory()).toBe(true);
		expect([...(await vfs.promises.readFile('/upstream/tree-sitter-bash.wasm'))]).toEqual([
			0, 97, 115, 109
		]);
		expect(vfs.realpathSync.native('/workspace/nested/../nested/lib.sh')).toBe(
			'/workspace/nested/lib.sh'
		);
		expect(() => vfs.statSync('/missing')).toThrow(expect.objectContaining({ code: 'ENOENT' }));
		expect(() => vfs.accessSync('/workspace/nested/lib.sh', vfs.constants.X_OK)).toThrow(
			expect.objectContaining({ code: 'EACCES' })
		);
		await new Promise<void>((resolve, reject) =>
			vfs.readdir('/workspace/nested', (error: unknown, names: string[]) => {
				if (error) {
					reject(error);
					return;
				}
				expect(names).toEqual(['lib.sh']);
				resolve();
			})
		);
	});
	it('rejects workspace snapshot paths outside the virtual workspace', () => {
		expect(() => vfs.initializeFiles({ '../outside.sh': 'bad' }, new Uint8Array())).toThrow(
			/under \/workspace/
		);
		expect(vfs.existsSync('/outside.sh')).toBe(false);
	});
});
