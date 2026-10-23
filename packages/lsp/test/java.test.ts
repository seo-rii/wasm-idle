import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
	const readers: MockReader[] = [];
	const writers: MockWriter[] = [];
	class MockReader {
		dispose = vi.fn();
		onError = vi.fn();
		onClose = vi.fn();
		onPartialMessage = vi.fn();
		listen = vi.fn(() => ({ dispose: vi.fn() }));
		constructor() {
			readers.push(this);
		}
	}
	class MockWriter {
		dispose = vi.fn();
		write = vi.fn(async () => {});
		constructor() {
			writers.push(this);
		}
	}
	return { readers, writers, MockReader, MockWriter };
});

vi.mock('../src/jsonrpc.js', () => ({
	BrowserMessageReader: state.MockReader,
	BrowserMessageWriter: state.MockWriter
}));

// Public input and lifecycle tests do not execute generated runtime assets.
// Actual authenticated asset execution is covered by the Chromium acceptance.
vi.mock('../src/java/assets.generated.js', () => ({
	JAVA_LANGUAGE_SERVER_ASSETS: [
		{ path: 'javacs-runtime.mjs', bytes: 1, sha256: '1'.repeat(64) },
		{ path: 'javacs.wasm', bytes: 2, sha256: '2'.repeat(64) },
		{ path: 'jdk-platform.zip', bytes: 3, sha256: '3'.repeat(64) }
	]
}));

import { getJavaLanguageServer } from '../src/java/language-server.js';
import {
	snapshotJavaLanguageServerAssets,
	type JavaLanguageServerAsset
} from '../src/java/assets.js';

class FakeWorker {
	readonly listeners = new Map<string, Set<(event: unknown) => void>>();
	readonly messages: unknown[] = [];
	terminate = vi.fn();
	constructor(readonly ready = true) {}
	addEventListener(type: string, listener: (event: unknown) => void) {
		const listeners = this.listeners.get(type) || new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}
	removeEventListener(type: string, listener: (event: unknown) => void) {
		this.listeners.get(type)?.delete(listener);
	}
	postMessage(message: unknown) {
		this.messages.push(message);
		if (this.ready && (message as { type?: string }).type === 'init')
			queueMicrotask(() => this.emit({ type: 'ready' }));
	}
	emit(data: unknown) {
		for (const listener of this.listeners.get('message') || []) listener({ data });
	}
}

function launchOptions(worker: FakeWorker) {
	return {
		java: { baseUrl: 'https://assets.example.test/java/' },
		createWorker: vi.fn(() => worker as unknown as Worker)
	};
}

function initOptions(worker: FakeWorker) {
	return (
		worker.messages[0] as {
			options: {
				baseUrl: string;
				files: Record<string, string>;
				canonicalUris: Record<string, string>;
				assets: readonly JavaLanguageServerAsset[];
			};
		}
	).options;
}

describe('original javacs TeaVM public SDK boundaries', () => {
	beforeEach(() => {
		state.readers.length = 0;
		state.writers.length = 0;
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('preserves Unicode, source text, and canonical Java file-name case before startup', async () => {
		const worker = new FakeWorker();
		const options = launchOptions(worker);
		const uri = 'file:///workspace/src/%ED%95%9C%20%EA%B8%80.java';
		const handle = await getJavaLanguageServer({
			...options,
			java: {
				baseUrl: '../java',
				initialFiles: {
					'file:///workspace/src/Main.java': '/* 🐇 */ public class Main {}',
					[uri]: '/* 한글 */ class 이름 {}'
				}
			},
			currentUrl: 'https://assets.example.test/editor/index.html'
		});
		expect(initOptions(worker)).toMatchObject({
			baseUrl: 'https://assets.example.test/java/',
			files: {
				'src/Main.java': '/* 🐇 */ public class Main {}',
				'src/한 글.java': '/* 한글 */ class 이름 {}'
			},
			canonicalUris: {
				'file:///workspace/src/main.java': 'file:///workspace/src/Main.java',
				[uri.toLowerCase()]: uri
			}
		});
		expect(Object.getPrototypeOf(initOptions(worker).files)).toBe(null);
		expect(fetch).not.toHaveBeenCalled();
		handle.dispose();
	});

	it('resolves the Java directory from a runtime root', async () => {
		const worker = new FakeWorker();
		const handle = await getJavaLanguageServer({
			rootUrl: '/assets/v1/',
			currentUrl: 'https://app.example.test/editor',
			createWorker: () => worker as unknown as Worker
		});
		expect(initOptions(worker).baseUrl).toBe(
			'https://app.example.test/assets/v1/wasm-java-lsp/'
		);
		handle.dispose();
	});

	it.each([
		'file:///private/java/',
		'javascript:alert(1)',
		'https://user:password@example.test/java/',
		'https://example.test/java/?query=1',
		'https://example.test/java/#fragment'
	])('rejects an invalid asset origin before creating a worker: %s', async (baseUrl) => {
		const options = launchOptions(new FakeWorker());
		await expect(getJavaLanguageServer({ ...options, java: { baseUrl } })).rejects.toThrow();
		expect(options.createWorker).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});

	it.each([
		'https://example.test/Main.java',
		'file://example.test/workspace/Main.java',
		'file:///workspace/Main.java?query=1',
		'file:///workspace/Main.java#fragment',
		'file:///elsewhere/Main.java',
		'file:///workspace/%2e%2e/Elsewhere.java',
		'file:///workspace/%2e%2e%2fElsewhere.java',
		'file:///workspace/src%5cMain.java',
		'file:///workspace/%00Main.java',
		'file:///workspace/%zzMain.java'
	])('rejects a source URI that cannot name a workspace file: %s', async (uri) => {
		const options = launchOptions(new FakeWorker());
		await expect(
			getJavaLanguageServer({
				...options,
				java: { ...options.java, initialFiles: { [uri]: 'class Main {}' } }
			})
		).rejects.toThrow();
		expect(options.createWorker).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('rejects ambiguous Java file-name case before either source can be overwritten', async () => {
		const options = launchOptions(new FakeWorker());
		await expect(
			getJavaLanguageServer({
				...options,
				java: {
					...options.java,
					initialFiles: {
						'file:///workspace/Main.java': 'public class Main {}',
						'file:///workspace/main.java': 'class main {}'
					}
				}
			})
		).rejects.toThrow(/Ambiguous case/);
		expect(options.createWorker).not.toHaveBeenCalled();
	});

	it('rejects two URI encodings that name the same physical Java source', async () => {
		const options = launchOptions(new FakeWorker());
		await expect(
			getJavaLanguageServer({
				...options,
				java: {
					...options.java,
					initialFiles: {
						'file:///workspace/Main.java': 'public class Main {}',
						'file:///workspace/%4dain.java': 'class Main { int changed; }'
					}
				}
			})
		).rejects.toThrow(/Ambiguous|Duplicate|same|encoding/i);
		expect(options.createWorker).not.toHaveBeenCalled();
	});

	it('limits source UTF-8 bytes rather than JavaScript UTF-16 length', async () => {
		const options = launchOptions(new FakeWorker());
		const text = '한'.repeat(Math.floor((16 * 1024 * 1024) / 3) + 1);
		await expect(
			getJavaLanguageServer({
				...options,
				java: { ...options.java, initialFiles: { 'file:///workspace/Main.java': text } }
			})
		).rejects.toThrow(/16 MiB/);
		expect(options.createWorker).not.toHaveBeenCalled();
	});

	it('takes an immutable receipt snapshot instead of retaining caller-owned metadata', async () => {
		const worker = new FakeWorker();
		const options = launchOptions(worker);
		const assets = snapshotJavaLanguageServerAssets().map((asset) => ({ ...asset }));
		const originalBytes = assets[0].bytes;
		const startup = getJavaLanguageServer({ ...options, java: { ...options.java, assets } });
		assets[0].bytes++;
		assets[0].sha256 = 'f'.repeat(64);
		const handle = await startup;
		expect(initOptions(worker).assets[0].bytes).toBe(originalBytes);
		expect(Object.isFrozen(initOptions(worker).assets)).toBe(true);
		expect(Object.isFrozen(initOptions(worker).assets[0])).toBe(true);
		handle.dispose();
	});

	it.each(['missing', 'duplicate', 'unexpected', 'zero bytes', 'fractional bytes', 'bad hash'])(
		'rejects %s receipts before any worker can execute them',
		async (kind) => {
			const options = launchOptions(new FakeWorker());
			const assets = snapshotJavaLanguageServerAssets().map((asset) => ({ ...asset }));
			if (kind === 'missing') assets.pop();
			else if (kind === 'duplicate') assets[1] = { ...assets[0] };
			else if (kind === 'unexpected')
				assets[0].path = '../execute.mjs' as JavaLanguageServerAsset['path'];
			else if (kind === 'zero bytes') assets[0].bytes = 0;
			else if (kind === 'fractional bytes') assets[0].bytes = 1.5;
			else assets[0].sha256 = 'not-a-sha256';
			await expect(
				getJavaLanguageServer({ ...options, java: { ...options.java, assets } })
			).rejects.toThrow(/asset|receipt/i);
			expect(options.createWorker).not.toHaveBeenCalled();
			expect(fetch).not.toHaveBeenCalled();
		}
	);

	it('disposes both JSON-RPC sides and the actual worker handle once', async () => {
		const worker = new FakeWorker();
		const status = vi.fn();
		const handle = await getJavaLanguageServer({ ...launchOptions(worker), onStatus: status });
		handle.dispose();
		handle.dispose();
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(state.readers[0].dispose).toHaveBeenCalledOnce();
		expect(state.writers[0].dispose).toHaveBeenCalledOnce();
		expect(worker.listeners.get('message')?.size).toBe(0);
		expect(worker.listeners.get('error')?.size).toBe(0);
		expect(status.mock.calls.at(-1)).toEqual([{ state: 'disabled' }]);
	});

	it('does not create a worker for pre-aborted startup', async () => {
		const options = launchOptions(new FakeWorker());
		const controller = new AbortController();
		controller.abort(new Error('cancelled before Java startup'));
		await expect(
			getJavaLanguageServer({ ...options, signal: controller.signal })
		).rejects.toThrow('cancelled before Java startup');
		expect(options.createWorker).not.toHaveBeenCalled();
	});

	it('terminates a stalled worker when startup is aborted', async () => {
		const worker = new FakeWorker(false);
		const controller = new AbortController();
		const startup = getJavaLanguageServer({
			...launchOptions(worker),
			signal: controller.signal
		});
		const rejection = expect(startup).rejects.toThrow('cancelled during Java startup');
		await vi.waitFor(() => expect(worker.messages).toHaveLength(1));
		controller.abort(new Error('cancelled during Java startup'));
		await rejection;
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(worker.listeners.get('message')?.size).toBe(0);
	});

	it('terminates a worker that fails startup and preserves its integrity error', async () => {
		const worker = new FakeWorker(false);
		const startup = getJavaLanguageServer(launchOptions(worker));
		const rejection = expect(startup).rejects.toThrow('Java LSP javacs.wasm SHA-256 mismatch');
		await vi.waitFor(() => expect(worker.messages).toHaveLength(1));
		worker.emit({ type: 'error', message: 'Java LSP javacs.wasm SHA-256 mismatch' });
		await rejection;
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(state.readers).toHaveLength(0);
		expect(state.writers).toHaveLength(0);
	});

	it('terminates a silent worker at the configured startup deadline', async () => {
		vi.useFakeTimers();
		const worker = new FakeWorker(false);
		const startup = getJavaLanguageServer({ ...launchOptions(worker), startupTimeoutMs: 25 });
		const rejection = expect(startup).rejects.toThrow(
			'Language server startup timed out after 25 ms'
		);
		await vi.advanceTimersByTimeAsync(25);
		await rejection;
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});
});
