// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
	createWasixShellSession,
	type WasixSdk,
	type WasixShellSession,
	type WasixWorkerGroup
} from '@wasm-idle/container/adapters/wasix';
import { MemoryFileSystem, type SnapshotEntry } from '@wasm-idle/container';
import {
	createBashProfile,
	withCanonicalWasiBuiltins,
	type BashProfileConfiguration
} from './bash-profile.js';

vi.mock('@wasm-idle/container/adapters/wasix', async (original) => ({
	...(await original<typeof import('@wasm-idle/container/adapters/wasix')>()),
	createWasixShellSession: vi.fn()
}));

async function fixture(clangFilesystem: 'snapshot' | 'live') {
	const manifest = JSON.stringify({
		schemaVersion: 1,
		distributionId: 'test-distribution',
		packages: [],
		commands: []
	});
	const manifestSha256 = Array.from(
		new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(manifest))),
		(value) => value.toString(16).padStart(2, '0')
	).join('');
	const config: BashProfileConfiguration = {
		manifest,
		manifestSha256,
		assetURLs: [],
		sdkUrl: 'https://app.test/sdk.js',
		sdkWorkerUrl: 'https://app.test/sdk.worker.js',
		liveWorkerUrl: 'https://app.test/wasi.worker.js',
		clangWorkerUrl: 'https://app.test/clang.worker.js',
		bashWasmSha256: 'a'.repeat(64),
		memory: { initial: 35, maximum: 16384 },
		clangSha256: 'b'.repeat(64),
		linkerSha256: 'c'.repeat(64),
		cacheNamespace: 'test-container-host',
		clangFilesystem
	};
	const workerGroup = { dispose: vi.fn(async () => {}) } as unknown as WasixWorkerGroup;
	const session = { dispose: vi.fn(async () => {}) } as unknown as WasixShellSession;
	vi.mocked(createWasixShellSession).mockReset().mockResolvedValue(session);
	const fetcher = vi.fn();
	return { config, workerGroup, session, fetcher };
}

describe('canonical WASI compiler runtime paths', () => {
	const directory = (path: string) => ({ path, type: 'directory' as const, mode: 0o755 });
	const legacy = 'lib/clang/22/lib/wasi/libclang_rt.builtins-wasm32.a';
	const canonical = 'lib/clang/22/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a';
	it('resolves the canonical name to the original bytes inside the readonly sysroot', () => {
		const bytes = Uint8Array.of(1, 2, 3);
		const entries: Omit<SnapshotEntry, 'inode'>[] = [
			...[
				'lib',
				'lib/clang',
				'lib/clang/22',
				'lib/clang/22/lib',
				'lib/clang/22/lib/wasi'
			].map(directory),
			{ path: legacy, type: 'file', mode: 0o644, data: bytes }
		];
		const fs = new MemoryFileSystem();
		fs.mountReadonly('/toolchain', withCanonicalWasiBuiltins(entries));
		expect(fs.readFile(`/toolchain/${canonical}`)).toEqual(bytes);
		expect(fs.readFile(`/toolchain/${legacy}`)).toEqual(bytes);
		expect(() => fs.writeFile(`/toolchain/${canonical}`, Uint8Array.of(9))).toThrow();
		expect(entries).toHaveLength(6);
	});
	it('preserves an existing canonical runtime and leaves unrelated sysroots alone', () => {
		const existing: Omit<SnapshotEntry, 'inode'>[] = [
			{ path: canonical, type: 'file', mode: 0o644, data: Uint8Array.of(4) },
			{ path: legacy, type: 'file', mode: 0o644, data: Uint8Array.of(5) }
		];
		expect(withCanonicalWasiBuiltins(existing)).toBe(existing);
		const empty: Omit<SnapshotEntry, 'inode'>[] = [];
		expect(withCanonicalWasiBuiltins(empty)).toBe(empty);
	});
});

describe('shared Bash profile configuration', () => {
	it.each([null, 'unknown'])(
		'rejects an unsupported compiler filesystem selector: %s',
		async (value) => {
			const { config, workerGroup, fetcher } = await fixture('snapshot');
			await expect(
				createBashProfile({
					config: { ...config, clangFilesystem: value } as BashProfileConfiguration,
					sdk: {} as WasixSdk,
					workerGroup,
					fetch: fetcher
				})
			).rejects.toThrow('clangFilesystem must be snapshot or live');
			expect(fetcher).not.toHaveBeenCalled();
		}
	);

	it.each(['snapshot', 'live'] as const)(
		'uses application command routes and preserves the %s compiler filesystem contract',
		async (filesystem) => {
			const { config, workerGroup, session, fetcher } = await fixture(filesystem);
			const profile = await createBashProfile({
				config,
				sdk: {} as WasixSdk,
				workerGroup,
				fetch: fetcher,
				shellCommands: ['cat', 'pwd'],
				shellRoutes: { '/usr/local/bin/app-control': { command: 'app-control' } }
			});
			try {
				expect(fetcher).not.toHaveBeenCalled();
				expect(profile.clangFilesystem).toBe(filesystem);
				await expect(profile.startShell()).resolves.toBe(session);
				const settings = vi.mocked(createWasixShellSession).mock.lastCall![0];
				expect(settings.routes).toEqual({
					'/usr/local/bin/cat': { command: 'cat' },
					'/usr/local/bin/pwd': { command: 'pwd' },
					'/usr/local/bin/clang': {
						command: 'clang',
						stdio: filesystem === 'live' ? 'delegated' : 'forwarded'
					},
					'/usr/local/bin/wasm-run': { command: 'wasm-run' },
					'/usr/local/bin/app-control': { command: 'app-control' }
				});
				await expect(profile.startShell()).rejects.toThrow(/already started or retired/);
			} finally {
				await profile.dispose();
			}
			expect(workerGroup.dispose).toHaveBeenCalledOnce();
			expect(session.dispose).toHaveBeenCalledOnce();
		}
	);

	it('rejects a changed distribution before creating its owner or fetching any assets', async () => {
		const { config, workerGroup, fetcher } = await fixture('live');
		await expect(
			createBashProfile({
				config: { ...config, manifest: `${config.manifest} ` },
				sdk: {} as WasixSdk,
				workerGroup,
				fetch: fetcher
			})
		).rejects.toMatchObject({ code: 'INTEGRITY' });
		expect(fetcher).not.toHaveBeenCalled();
		expect(workerGroup.dispose).not.toHaveBeenCalled();
	});
});
