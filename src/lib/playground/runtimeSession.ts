import {
	createPlaygroundBinding,
	normalizeLanguageId,
	RuntimeConfigurationError,
	type PlaygroundBindingOptions
} from '@wasm-idle/core';
import playground from './index';
import type { PlaygroundBinding, Sandbox, SandboxRuntimeAssets } from './sandbox';
import { RuntimeAssetCache } from './runtimeAssetCache';
import { CompiledArtifactCache } from './compiledArtifactCache';
import { createCachedClangSandbox } from './cachedClang';

export interface PlaygroundRuntimeSession {
	createBinding(): PlaygroundBinding & { dispose(): Promise<void> };
	selectLanguage(language: string): Promise<void>;
	dispose(): Promise<void>;
	getCacheStats(): {
		language: string | undefined;
		assets: ReturnType<RuntimeAssetCache['stats']>;
		artifacts: ReturnType<CompiledArtifactCache['stats']>;
	};
}

/**
 * A browser-owned language session. Panels own disposable execution leases, not the
 * compiler cache. A problem/editor change may release all leases without cooling it.
 */
export function createRuntimeSession(
	runtimeAssets: SandboxRuntimeAssets,
	options: PlaygroundBindingOptions = {}
): PlaygroundRuntimeSession {
	let language: string | undefined;
	let epoch = 0;
	let disposed = false;
	let disposal: Promise<void> | undefined;
	let assetCache = new RuntimeAssetCache();
	let artifactCache = new CompiledArtifactCache();
	const leases = new Set<{ epoch?: number; dispose(): Promise<void> }>();
	let retiring: Promise<void> = Promise.resolve();
	const stale = () =>
		new RuntimeConfigurationError('Runtime session was disposed or its language changed', {
			phase: 'dispose'
		});
	const release = (owned: Array<{ dispose(): Promise<void> }>) => {
		const previous = retiring;
		retiring = Promise.allSettled([previous, ...owned.map((lease) => lease.dispose())]).then(
			(results) => {
				const failure = results.find((result) => result.status === 'rejected');
				if (failure?.status === 'rejected') throw failure.reason;
			}
		);
		// Errors remain visible to the caller without unhandled background rejections.
		void retiring.catch(() => undefined);
		return retiring;
	};

	const session: PlaygroundRuntimeSession = {
		async selectLanguage(value) {
			if (disposed) throw stale();
			const next = normalizeLanguageId(value) || value.trim().toUpperCase();
			if (!next) return;
			if (next === language) return await retiring;
			language = next;
			epoch++;
			assetCache.dispose();
			artifactCache.clear();
			assetCache = new RuntimeAssetCache();
			artifactCache = new CompiledArtifactCache();
			await release([...leases].filter((lease) => lease.epoch !== undefined));
		},
		createBinding() {
			if (disposed) throw stale();
			let closed = false;
			let closing: Promise<void> | undefined;
			const lease = {
				epoch: undefined as number | undefined,
				dispose() {
					if (closing) return closing;
					closed = true;
					leases.delete(lease);
					closing = Promise.resolve().then(() => core.dispose());
					return closing;
				}
			};
			const core = createPlaygroundBinding(
				runtimeAssets,
				async (target) => {
					if (closed || disposed) throw stale();
					const selected = session.selectLanguage(target);
					const selectedEpoch = epoch;
					await selected;
					if (closed || disposed || epoch !== selectedEpoch) throw stale();
					lease.epoch = selectedEpoch;
					const cache = assetCache;
					const artifacts = artifactCache;
					const sandbox = (await playground(target)) as Sandbox & {
						setRuntimeAssetCache?: (cache: RuntimeAssetCache) => void;
					};
					if (closed || disposed || epoch !== selectedEpoch) {
						if (sandbox.dispose) await sandbox.dispose();
						else await sandbox.terminate();
						throw stale();
					}
					sandbox.setRuntimeAssetCache?.(cache);
					return target === 'C' || target === 'CPP'
						? createCachedClangSandbox(sandbox as never, target, cache, artifacts)
						: (sandbox as never);
				},
				options
			);
			leases.add(lease);
			const binding = core as unknown as PlaygroundBinding & { dispose(): Promise<void> };
			// Do not override core.dispose in place: the lease calls that exact owner method.
			return new Proxy(binding, {
				get(target, property) {
					if (property === 'dispose') return lease.dispose;
					const value = Reflect.get(target, property);
					return typeof value === 'function' ? value.bind(target) : value;
				}
			});
		},
		dispose() {
			if (disposal) return disposal;
			disposed = true;
			epoch++;
			assetCache.dispose();
			artifactCache.clear();
			disposal = release([...leases]);
			return disposal;
		},
		getCacheStats: () => ({
			language,
			assets: assetCache.stats(),
			artifacts: artifactCache.stats()
		})
	};
	return session;
}
