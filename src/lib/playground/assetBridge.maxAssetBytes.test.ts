import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

import { WorkerAssetBridge } from '$lib/playground/assetBridge';
import { RUNTIME_LOAD_ASSETS } from '$lib/playground/assets';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('WorkerAssetBridge execution asset limit', () => {
	it('enforces the active limit and includes it in bridge lifecycle identity', async () => {
		const firstPostMessage = vi.fn();
		const secondPostMessage = vi.fn();
		const loader = vi.fn().mockResolvedValue(Uint8Array.of(1, 2, 3, 4));
		const config = { baseUrl: '/clang/', loader, useAssetBridge: true };
		const bridge = new WorkerAssetBridge(
			{ postMessage: firstPostMessage } as unknown as Worker,
			'clang',
			config,
			undefined,
			3
		);
		const asset = RUNTIME_LOAD_ASSETS.clang[0];

		expect(bridge.matches(config)).toBe(true);
		expect(bridge.matches(config, 4)).toBe(false);
		bridge.handleMessage({
			data: { assetRequest: { id: 1, asset } }
		} as MessageEvent);
		await vi.waitFor(() => expect(firstPostMessage).toHaveBeenCalledOnce());
		expect(firstPostMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 1,
				ok: false,
				error: expect.stringContaining('exceeds the 3 byte limit')
			}
		});

		bridge.rebind(
			{ postMessage: secondPostMessage } as unknown as Worker,
			config,
			undefined,
			4
		);
		expect(bridge.matches(config, 4)).toBe(true);
		bridge.handleMessage({
			data: { assetRequest: { id: 2, asset } }
		} as MessageEvent);
		await vi.waitFor(() => expect(secondPostMessage).toHaveBeenCalledOnce());
		expect(secondPostMessage.mock.calls[0]?.[0]).toMatchObject({
			assetResponse: { id: 2, ok: true }
		});
	});

	it('rejects declared TeaVM bytes above the exact receipt before opening a reader', async () => {
		const postMessage = vi.fn();
		const cancel = vi.fn(async () => undefined);
		const getReader = vi.fn();
		const asset = RUNTIME_LOAD_ASSETS.java[0];
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				url: '',
				headers: new Headers({ 'content-length': '5' }),
				body: { cancel, getReader }
			})
		);
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'java', {
			baseUrl: 'https://assets.example.com/teavm/',
			integrity: { [asset]: { bytes: 4, sha256: 'a'.repeat(64) } },
			useAssetBridge: true
		});

		bridge.handleMessage({
			data: { assetRequest: { id: 3, asset } }
		} as MessageEvent);
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());

		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 3,
				ok: false,
				error: `Runtime asset ${asset} exceeds the 4 byte limit`
			}
		});
		expect(cancel).toHaveBeenCalledOnce();
		expect(getReader).not.toHaveBeenCalled();
	});

	it('cancels a TeaVM stream as soon as it crosses the exact receipt size', async () => {
		const postMessage = vi.fn();
		const cancel = vi.fn(async () => undefined);
		const releaseLock = vi.fn();
		const reader = {
			read: vi
				.fn()
				.mockResolvedValueOnce({ done: false, value: Uint8Array.of(1, 2, 3) })
				.mockResolvedValueOnce({ done: false, value: Uint8Array.of(4, 5) }),
			cancel,
			releaseLock
		};
		const asset = RUNTIME_LOAD_ASSETS.java[0];
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				url: '',
				headers: new Headers(),
				body: { getReader: () => reader, cancel: vi.fn() }
			})
		);
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'java', {
			baseUrl: 'https://assets.example.com/teavm/',
			integrity: { [asset]: { bytes: 4, sha256: 'a'.repeat(64) } },
			useAssetBridge: true
		});

		bridge.handleMessage({
			data: { assetRequest: { id: 4, asset } }
		} as MessageEvent);
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());

		expect(postMessage).toHaveBeenCalledWith({
			assetResponse: {
				id: 4,
				ok: false,
				error: `Runtime asset ${asset} exceeds the 4 byte limit`
			}
		});
		expect(cancel).toHaveBeenCalledOnce();
		expect(releaseLock).toHaveBeenCalledOnce();
	});

	it('accepts an exact zero-byte receipt for generic runtime assets', async () => {
		const postMessage = vi.fn();
		const loader = vi.fn().mockResolvedValue(new Uint8Array());
		const asset = RUNTIME_LOAD_ASSETS.clang[0];
		const bridge = new WorkerAssetBridge({ postMessage } as unknown as Worker, 'clang', {
			baseUrl: '/clang/',
			loader,
			integrity: {
				[asset]: {
					bytes: 0,
					sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
				}
			},
			useAssetBridge: true
		});

		bridge.handleMessage({
			data: { assetRequest: { id: 5, asset } }
		} as MessageEvent);
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());

		expect(postMessage.mock.calls[0]?.[0]).toMatchObject({
			assetResponse: { id: 5, ok: true }
		});
	});

	it('rejects invalid limits at construction and rebind boundaries', () => {
		const config = { baseUrl: '/clang/', useAssetBridge: true };
		expect(
			() =>
				new WorkerAssetBridge(
					{ postMessage: vi.fn() } as unknown as Worker,
					'clang',
					config,
					undefined,
					0
				)
		).toThrow('positive safe integer');

		const bridge = new WorkerAssetBridge(
			{ postMessage: vi.fn() } as unknown as Worker,
			'clang',
			config
		);
		expect(() =>
			bridge.rebind(
				{ postMessage: vi.fn() } as unknown as Worker,
				config,
				undefined,
				Number.NaN
			)
		).toThrow('positive safe integer');
		expect(bridge.matches(config)).toBe(true);
	});
});
