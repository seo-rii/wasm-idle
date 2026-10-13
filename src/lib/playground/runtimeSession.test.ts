import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeAssetCache } from './runtimeAssetCache';
const state = vi.hoisted(() => ({
	instances: [] as any[],
	loading: undefined as Promise<void> | undefined
}));
vi.mock('./index', () => ({
	default: vi.fn(async () => {
		await state.loading;
		const sandbox = {
			cache: undefined as RuntimeAssetCache | undefined,
			setRuntimeAssetCache(cache: RuntimeAssetCache) {
				this.cache = cache;
			},
			load: vi.fn(async () => {}),
			run: vi.fn(async () => true),
			clear: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
			terminate: vi.fn(),
			eof: vi.fn()
		};
		state.instances.push(sandbox);
		return sandbox;
	})
}));
vi.mock('./cachedClang', () => ({ createCachedClangSandbox: (sandbox: unknown) => sandbox }));
import { createRuntimeSession } from './runtimeSession';
beforeEach(() => {
	state.instances.length = 0;
	state.loading = undefined;
});

describe('language runtime session ownership', () => {
	it('reports a failed disposal once and permits later language selections and leases', async () => {
		const session = createRuntimeSession('https://assets.test');
		await session.createBinding().load('PYTHON3');
		const failure = new Error('dispose failed');
		state.instances[0].dispose.mockRejectedValueOnce(failure);
		await expect(session.selectLanguage('C')).rejects.toBe(failure);
		await expect(session.selectLanguage('C')).resolves.toBeUndefined();
		await session.createBinding().load('C');
		await expect(session.selectLanguage('CPP')).resolves.toBeUndefined();
		expect(state.instances[0].dispose).toHaveBeenCalledOnce();
		expect(state.instances[1].dispose).toHaveBeenCalledOnce();
		await expect(session.dispose()).resolves.toBeUndefined();
	});

	it('waits for the previous cleanup even when that cleanup eventually fails', async () => {
		const session = createRuntimeSession('https://assets.test');
		await session.createBinding().load('PYTHON3');
		let fail!: (error: Error) => void;
		state.instances[0].dispose.mockImplementation(
			() =>
				new Promise((_resolve, reject) => {
					fail = reject;
				})
		);
		const first = session.selectLanguage('C');
		const rejected = expect(first).rejects.toThrow('late cleanup failure');
		let settled = false;
		const second = session.selectLanguage('CPP').then(() => {
			settled = true;
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(settled).toBe(false);
		fail(new Error('late cleanup failure'));
		await rejected;
		await second;
		expect(settled).toBe(true);
		await session.dispose();
	});

	it('keeps cache across clear, panel close, and different problems; executions have separate owners', async () => {
		const session = createRuntimeSession({ rootUrl: 'https://assets.test/repl' });
		const panel = session.createBinding();
		const first = await panel.load('PYTHON3');
		const cache = state.instances[0].cache!;
		cache.set('trusted compiler', 'ready', 5);
		await first.clear();
		await panel.dispose();
		expect(state.instances[0].dispose).toHaveBeenCalledOnce();
		expect(cache.stats().disposed).toBe(false);
		const nextPanel = session.createBinding();
		await nextPanel.load('PYTHON3');
		expect(state.instances[1].cache).toBe(cache);
		expect(state.instances[1]).not.toBe(state.instances[0]);
		expect(cache.get('trusted compiler')).toBe('ready');
		await session.dispose();
		expect(cache.stats().disposed).toBe(true);
	});

	it('disposes active leases and cached assets when the language actually changes', async () => {
		const session = createRuntimeSession('https://assets.test');
		const first = session.createBinding();
		await first.load('C');
		const cache = state.instances[0].cache!;
		await session.selectLanguage('C');
		expect(state.instances[0].dispose).not.toHaveBeenCalled();
		await session.selectLanguage('CPP');
		expect(state.instances[0].dispose).toHaveBeenCalledOnce();
		expect(cache.stats().disposed).toBe(true);
		await expect(first.load('C')).rejects.toThrow(/disposed/);
		await session.createBinding().load('CPP');
		expect(state.instances[1].cache).not.toBe(cache);
		await session.dispose();
	});

	it('switching to a server-only language still releases the old browser compiler', async () => {
		const session = createRuntimeSession('https://assets.test');
		await session.createBinding().load('C');
		await session.selectLanguage('SERVER_ONLY');
		expect(state.instances[0].dispose).toHaveBeenCalledOnce();
		expect(session.getCacheStats().language).toBe('SERVER_ONLY');
		await session.dispose();
	});

	it('keeps simultaneous panels isolated while sharing only the immutable asset owner', async () => {
		const session = createRuntimeSession('https://assets.test');
		const a = session.createBinding(),
			b = session.createBinding();
		await Promise.all([a.load('PYTHON3'), b.load('PYTHON3')]);
		expect(state.instances[0].cache).toBe(state.instances[1].cache);
		await a.dispose();
		expect(state.instances[1].dispose).not.toHaveBeenCalled();
		await session.dispose();
		expect(state.instances[1].dispose).toHaveBeenCalledOnce();
	});

	it('rejects delayed construction after language selection changes', async () => {
		const session = createRuntimeSession('https://assets.test');
		let finish!: () => void;
		state.loading = new Promise((resolve) => {
			finish = resolve;
		});
		const pending = session.createBinding().load('PYTHON3');
		const rejected = expect(pending).rejects.toThrow(/disposed|language changed/);
		await Promise.resolve();
		const changing = session.selectLanguage('C');
		finish();
		await Promise.all([changing, rejected]);
		for (const sandbox of state.instances) expect(sandbox.dispose).toHaveBeenCalledOnce();
		await session.dispose();
	});

	it('disposes once and forbids new bindings or selections afterwards', async () => {
		const session = createRuntimeSession('https://assets.test');
		await session.createBinding().load('C');
		const first = session.dispose();
		expect(session.dispose()).toBe(first);
		await first;
		expect(state.instances[0].dispose).toHaveBeenCalledOnce();
		expect(() => session.createBinding()).toThrow(/disposed/);
		await expect(session.selectLanguage('PYTHON3')).rejects.toThrow(/disposed/);
	});
});
