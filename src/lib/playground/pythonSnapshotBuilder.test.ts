import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridges = vi.hoisted(() => [] as Array<{ dispose: ReturnType<typeof vi.fn> }>);
vi.mock('$lib/playground/assetBridge', () => ({
	WorkerAssetBridge: class {
		dispose = vi.fn();
		handleMessage = vi.fn(() => false);
		constructor() {
			bridges.push(this);
		}
	}
}));

import {
	PYTHON_SNAPSHOT_BUILD_DELAY_MS,
	PYTHON_SNAPSHOT_BUILD_TIMEOUT_MS,
	buildPythonSnapshot,
	resetPythonSnapshotBuilds
} from './pythonSnapshotBuilder';
import type { RuntimeAssetCache } from './runtimeAssetCache';

class FakeWorker {
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: (() => void) | null = null;
	postMessage = vi.fn();
	terminate = vi.fn();
	reply(data: unknown) {
		this.onmessage?.({ data } as MessageEvent);
	}
}

const assetConfig = {
	baseUrl: 'https://assets.example.test/python/',
	useAssetBridge: true,
	persistentCache: { enabled: true, namespace: 'test' }
} as any;

function request(workers: FakeWorker[], overrides: Record<string, unknown> = {}) {
	return {
		key: 'snapshot-key',
		assetConfig,
		maxAssetBytes: 1024,
		cache: {} as RuntimeAssetCache,
		createWorker: async () => {
			const worker = new FakeWorker();
			workers.push(worker);
			return worker as unknown as Worker;
		},
		...overrides
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	bridges.length = 0;
	resetPythonSnapshotBuilds();
});
afterEach(() => vi.useRealTimers());

describe('Python snapshot builder', () => {
	it('waits before starting one helper per key and cleans it up after storing', async () => {
		const workers: FakeWorker[] = [];
		const first = buildPythonSnapshot(request(workers));
		const second = buildPythonSnapshot(request(workers));
		expect(second).toBe(first);
		await vi.advanceTimersByTimeAsync(PYTHON_SNAPSHOT_BUILD_DELAY_MS - 1);
		expect(workers).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(1);
		expect(workers).toHaveLength(1);
		expect(workers[0].postMessage).toHaveBeenCalledWith({
			buildSnapshot: 'snapshot-key',
			persistentCache: assetConfig.persistentCache,
			assets: {
				baseUrl: assetConfig.baseUrl,
				maxAssetBytes: 1024,
				useAssetBridge: true,
				useModuleBridge: true
			}
		});
		workers[0].reply({ pythonSnapshot: { stored: true } });
		await expect(first).resolves.toBe(true);
		expect(workers[0].terminate).toHaveBeenCalledOnce();
		expect(bridges[0].dispose).toHaveBeenCalledOnce();
		// A stored snapshot is never rebuilt in the same realm.
		await expect(buildPythonSnapshot(request(workers))).resolves.toBe(true);
		expect(workers).toHaveLength(1);
	});

	it('allows a later retry after a failed build', async () => {
		const workers: FakeWorker[] = [];
		const failed = buildPythonSnapshot(request(workers));
		await vi.advanceTimersByTimeAsync(PYTHON_SNAPSHOT_BUILD_DELAY_MS);
		workers[0].reply({ pythonSnapshot: { stored: false, error: 'quota' } });
		await expect(failed).resolves.toBe(false);
		const retry = buildPythonSnapshot(request(workers));
		expect(retry).not.toBe(failed);
		await vi.advanceTimersByTimeAsync(PYTHON_SNAPSHOT_BUILD_DELAY_MS);
		expect(workers).toHaveLength(2);
	});

	it('terminates a helper that never answers', async () => {
		const workers: FakeWorker[] = [];
		const build = buildPythonSnapshot(request(workers));
		await vi.advanceTimersByTimeAsync(
			PYTHON_SNAPSHOT_BUILD_DELAY_MS + PYTHON_SNAPSHOT_BUILD_TIMEOUT_MS
		);
		await expect(build).resolves.toBe(false);
		expect(workers[0].terminate).toHaveBeenCalledOnce();
	});

	it('does nothing when persistent storage is disabled', async () => {
		const workers: FakeWorker[] = [];
		const build = buildPythonSnapshot(
			request(workers, {
				assetConfig: { ...assetConfig, persistentCache: { enabled: false } }
			})
		);
		await vi.advanceTimersByTimeAsync(PYTHON_SNAPSHOT_BUILD_DELAY_MS);
		await expect(build).resolves.toBe(false);
		expect(workers).toHaveLength(0);
	});
});
