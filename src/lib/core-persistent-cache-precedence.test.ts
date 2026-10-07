import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	configureRuntimeAssetCache,
	createPlaygroundBinding,
	createRuntimeAssetsKey,
	type RuntimeAssetCacheOptions,
	type Sandbox,
	type SandboxExecutionOptions
} from '@wasm-idle/core';
import { resolveRuntimeAssetConfig, type PlaygroundRuntimeAssets } from './playground/assets';

vi.mock('$app/env/public', async () => {
	const { mockPublicEnv } = await import('./testPublicEnv');
	return mockPublicEnv();
});

function bindingFor(
	assets: PlaygroundRuntimeAssets,
	cache?: RuntimeAssetCacheOptions,
	runtime: 'clang' | 'python' = 'clang'
) {
	const received: Array<SandboxExecutionOptions['persistentCache']> = [];
	const effective: ReturnType<typeof resolveRuntimeAssetConfig>['persistentCache'][] = [];
	const record = (options: SandboxExecutionOptions = {}) => {
		received.push(options.persistentCache);
		effective.push(
			resolveRuntimeAssetConfig(runtime, assets, 'https://app.test/', options.persistentCache)
				.persistentCache
		);
	};
	const sandbox: Sandbox = {
		constructor: Object,
		eof: vi.fn(),
		terminate: vi.fn(),
		clear: vi.fn(async () => {}),
		load: async (_assets, _code, _log, _args, options) => record(options),
		run: async (_code, _prepare, _log, _progress, _args, options) => {
			record(options);
			return true;
		}
	};
	return {
		binding: createPlaygroundBinding(assets, async () => sandbox, { persistentCache: cache }),
		received,
		effective
	};
}

describe('binding persistent cache policy precedence', () => {
	afterEach(() => configureRuntimeAssetCache({}));

	it.each([
		['C', 'clang'],
		['PYTHON3', 'python']
	] as const)(
		'preserves nested %s configuration without manufacturing call-level defaults',
		async (language, runtime) => {
			configureRuntimeAssetCache({ enabled: true, maxBytes: 900, maxEntries: 20 });
			const { binding, received, effective } = bindingFor(
				{
					rootUrl: 'https://cdn.test/runtime/',
					persistentCache: { maxBytes: 800 },
					[runtime]: { persistentCache: { enabled: false, maxBytes: 700, maxEntries: 7 } }
				},
				undefined,
				runtime
			);
			const sandbox = await binding.load(language);
			await sandbox.load();
			expect(received).toEqual([undefined]);
			expect(effective[0]).toMatchObject({ enabled: false, maxBytes: 700, maxEntries: 7 });
			await binding.dispose();
		}
	);

	it('resolves global < root < runtime < binding < call and keeps omitted properties inherited', async () => {
		configureRuntimeAssetCache({ enabled: true, maxBytes: 900, maxEntries: 20 });
		const { binding, received, effective } = bindingFor(
			{
				rootUrl: 'https://cdn.test/runtime/',
				persistentCache: { maxBytes: 800, namespace: 'root' },
				clang: {
					persistentCache: {
						enabled: false,
						maxBytes: 700,
						maxEntryBytes: 400,
						eviction: 'none'
					}
				}
			},
			{ maxBytes: 600, maxEntries: 10 }
		);
		const sandbox = await binding.load('CPP');
		await sandbox.load('', true, [], {
			persistentCache: { enabled: true, maxBytes: 500, maxEntries: undefined }
		});
		expect(received[0]).toEqual({ enabled: true, maxBytes: 500, maxEntries: 10 });
		expect(effective[0]).toMatchObject({
			enabled: true,
			maxBytes: 500,
			maxEntries: 10,
			maxEntryBytes: 400,
			eviction: 'none',
			namespace: 'root'
		});
		expect(JSON.parse(JSON.stringify(effective[0]))).toEqual(effective[0]);
		await binding.dispose();
	});

	it('does not make a per-call disable sticky or let a budget override re-enable inherited false', async () => {
		const { binding, received, effective } = bindingFor(
			{ clang: { persistentCache: { enabled: true, maxBytes: 700 } } },
			{ maxEntries: 5 }
		);
		const sandbox = await binding.load('C');
		await sandbox.load('', true, [], { persistentCache: false });
		await sandbox.run('', false);
		expect(effective[0]).toMatchObject({ enabled: false });
		expect(effective[1]).toMatchObject({ enabled: true, maxBytes: 700, maxEntries: 5 });
		expect(received[0]).not.toBe(received[1]);
		await binding.dispose();
		const disabled = bindingFor({}, false);
		const other = await disabled.binding.load('C');
		await other.load('', true, [], { persistentCache: { maxBytes: 12 } });
		expect(disabled.effective[0]).toMatchObject({ enabled: false, maxBytes: 12 });
		await disabled.binding.dispose();
	});

	it.each(['clang', 'python', 'java', 'clangd'] as const)(
		'includes nested %s cache policy in runtime identity with stable property ordering',
		(runtime) => {
			const initial = createRuntimeAssetsKey({
				[runtime]: { persistentCache: { maxBytes: 20, enabled: false } }
			});
			expect(createRuntimeAssetsKey({ [runtime]: { persistentCache: false } })).not.toBe(
				initial
			);
			expect(
				createRuntimeAssetsKey({
					[runtime]: { persistentCache: { enabled: false, maxBytes: 20 } }
				})
			).toBe(initial);
			expect(
				createRuntimeAssetsKey({
					[runtime]: { persistentCache: { enabled: false, maxBytes: 21 } }
				})
			).not.toBe(initial);
		}
	);
});
