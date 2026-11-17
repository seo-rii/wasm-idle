import { WorkerAssetBridge } from '$lib/playground/assetBridge';
import type { resolveRuntimeAssetConfig } from '$lib/playground/assets';
import type { RuntimeAssetCache } from './runtimeAssetCache';

/** Keys built (or being built) by this realm; a failed build may be retried by a later load. */
const builds = new Map<string, Promise<boolean>>();

export const PYTHON_SNAPSHOT_BUILD_DELAY_MS = 1500;
export const PYTHON_SNAPSHOT_BUILD_TIMEOUT_MS = 120_000;

export interface PythonSnapshotBuildRequest {
	key: string;
	assetConfig: ReturnType<typeof resolveRuntimeAssetConfig>;
	maxAssetBytes: number;
	/** Shares the requesting runtime's verified bytes and compiled module. */
	cache: RuntimeAssetCache;
	createWorker: () => Promise<Worker>;
	delayMs?: number;
	timeoutMs?: number;
}

/**
 * Build a Pyodide memory snapshot in a dedicated helper worker. Pyodide records JavaScript access
 * paths while it can snapshot, so the snapshotting interpreter is never the one that runs user
 * code: the requesting worker keeps its ordinary globals and later workers restore the snapshot.
 * The build is speculative: every failure only means the next start boots normally.
 */
export function buildPythonSnapshot(request: PythonSnapshotBuildRequest): Promise<boolean> {
	const existing = builds.get(request.key);
	if (existing) return existing;
	const policy = request.assetConfig.persistentCache;
	if (!policy || policy.enabled !== true) return Promise.resolve(false);
	const build = new Promise<boolean>((resolve) => {
		let worker: Worker | undefined;
		let bridge: WorkerAssetBridge | undefined;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let settled = false;
		const finish = (stored: boolean) => {
			if (settled) return;
			settled = true;
			if (timeout !== undefined) clearTimeout(timeout);
			try {
				bridge?.dispose();
			} catch {
				/* The helper result does not depend on bridge cleanup. */
			}
			if (worker) {
				worker.onmessage = null;
				worker.onerror = null;
				worker.terminate();
			}
			if (!stored && builds.get(request.key) === build) builds.delete(request.key);
			resolve(stored);
		};
		const start = async () => {
			if (settled) return;
			try {
				const created = await request.createWorker();
				if (settled) {
					created.terminate();
					return;
				}
				worker = created;
				bridge = new WorkerAssetBridge(
					worker,
					'python',
					request.assetConfig,
					undefined,
					request.maxAssetBytes,
					false,
					request.cache
				);
				worker.onerror = () => finish(false);
				worker.onmessage = (event: MessageEvent<any>) => {
					if (bridge?.handleMessage(event)) return;
					const result = event.data?.pythonSnapshot;
					if (result) finish(result.stored === true);
				};
				worker.postMessage({
					buildSnapshot: request.key,
					persistentCache: request.assetConfig.persistentCache,
					assets: {
						baseUrl: request.assetConfig.baseUrl,
						maxAssetBytes: request.maxAssetBytes,
						useAssetBridge: request.assetConfig.useAssetBridge,
						useModuleBridge: true
					}
				});
			} catch {
				finish(false);
			}
		};
		timeout = setTimeout(
			() => finish(false),
			(request.delayMs ?? PYTHON_SNAPSHOT_BUILD_DELAY_MS) +
				(request.timeoutMs ?? PYTHON_SNAPSHOT_BUILD_TIMEOUT_MS)
		);
		// Let the requesting runtime's first execution start before the helper competes for CPU.
		setTimeout(() => void start(), request.delayMs ?? PYTHON_SNAPSHOT_BUILD_DELAY_MS);
	});
	builds.set(request.key, build);
	return build;
}

/** Test hook: forget completed builds. */
export function resetPythonSnapshotBuilds() {
	builds.clear();
}
