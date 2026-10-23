import { createHash } from 'node:crypto';
import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJavaLanguageServer } from '../src/java/language-server.js';
import { JAVA_LANGUAGE_SERVER_ASSETS } from '../src/java/assets.js';

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('Java document host boundaries', () => {
	it('returns the original abort reason before creating a DOM host', async () => {
		const controller = new AbortController();
		const reason = new DOMException('Java cancelled', 'AbortError');
		controller.abort(reason);
		vi.stubGlobal('document', undefined);
		await expect(getJavaLanguageServer({ signal: controller.signal })).rejects.toBe(reason);
	});

	it('reports the document requirement in an SSR environment', async () => {
		vi.stubGlobal('document', undefined);
		await expect(getJavaLanguageServer()).rejects.toThrow('browser document');
	});

	it.each(['/', '/wasm-idle/', '/apps/editor/nested/'])(
		'keeps verified assets and the iframe under deployment base %s and disposes a timed-out host',
		async (rootUrl) => {
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			let appended!: () => void;
			const frameAppended = new Promise<void>((resolve) => {
				appended = resolve;
			});
			const frames: FakeFrame[] = [];
			class FakeFrame {
				credentialless = false;
				dataset: Record<string, string> = {};
				src = '';
				onload?: () => void;
				onerror?: () => void;
				remove = vi.fn();
				setAttribute = vi.fn();
				contentWindow = { postMessage: vi.fn() };
			}
			Object.defineProperty(FakeFrame.prototype, 'credentialless', {
				value: false,
				writable: true
			});
			vi.stubGlobal('HTMLIFrameElement', FakeFrame);
			vi.stubGlobal('MessageChannel', MessageChannel);
			vi.stubGlobal('document', {
				createElement: () => {
					const frame = new FakeFrame();
					frames.push(frame);
					return frame;
				},
				body: {
					append: (frame: FakeFrame) => {
						queueMicrotask(() => frame.onload?.());
						appended();
					}
				}
			});
			const bytes = new TextEncoder().encode(
				'transport boundary fixture; never executed as a language server'
			);
			const sha256 = createHash('sha256').update(bytes).digest('hex');
			const receipts = JAVA_LANGUAGE_SERVER_ASSETS.map((asset) => ({
				path: asset.path,
				bytes: bytes.byteLength,
				sha256
			}));
			const requested: URL[] = [];
			vi.stubGlobal(
				'fetch',
				vi.fn(async (input: string | URL) => {
					const url = new URL(String(input));
					requested.push(url);
					const response = new Response(bytes, {
						headers: { 'content-length': String(bytes.byteLength) }
					});
					Object.defineProperty(response, 'url', { value: url.href });
					return response;
				})
			);
			const timedOut = expect(
				getJavaLanguageServer({
					rootUrl,
					currentUrl: `https://app.example.com${rootUrl}`,
					java: { assets: receipts },
					persistentCache: false,
					startupTimeoutMs: 100
				})
			).rejects.toMatchObject({ name: 'LanguageServerStartupTimeoutError' });
			await frameAppended;
			await vi.advanceTimersByTimeAsync(100);
			await timedOut;
			expect(requested).toHaveLength(5);
			for (const url of requested) {
				expect(url.origin).toBe('https://app.example.com');
				expect(url.pathname.startsWith(`${rootUrl}java-lsp/`)).toBe(true);
				expect(url.searchParams.get('v')).toBe(sha256);
			}
			expect(frames).toHaveLength(1);
			expect(frames[0].src).toBe(`https://app.example.com${rootUrl}java-lsp/host.html`);
			expect(frames[0].remove).toHaveBeenCalledOnce();
		}
	);
});
