import {
	createContainer,
	createContainerPackageManager,
	createVerifiedAssetLoader,
	validateDistribution,
	extractTarPackage,
	type Container,
	type ContainerOptions,
	type HostCommandInvocation,
	type HostCommandRecord,
	type HostCommandRoute
} from '@wasm-idle/container';
import { createClangAdapter } from '@wasm-idle/container/adapters/clang';
import { createLiveClangAdapter } from '@wasm-idle/container/adapters/clang-live';
import { createLiveWasiAdapter } from '@wasm-idle/container/adapters/wasi-live';
import {
	createWasixShellSession,
	installWasixWorkerGroup,
	type WasixAssetReference,
	type WasixSdk,
	type WasixShellOptions,
	type WasixShellSession,
	type WasixWorkerGroup
} from '@wasm-idle/container/adapters/wasix';

export const BASH_BIN = '/usr/local/bin';
export const BASH_SYSROOT = '/usr/share/wasm-sysroot';
const TOOLCHAIN = '/opt/toolchains/llvm';

/** Pinned assets and worker URLs selected by trusted application code. */
export interface BashProfileConfiguration {
	manifest: string;
	manifestSha256: string;
	assetURLs: readonly string[];
	sdkUrl: string;
	sdkWorkerUrl: string;
	liveWorkerUrl: string;
	clangWorkerUrl: string;
	sdkAsset?: WasixAssetReference;
	shellAsset?: WasixAssetReference;
	bashWasmSha256: string;
	memory: WasixShellOptions['memory'];
	clangSha256: string;
	linkerSha256: string;
	cacheNamespace: string;
	commandTimeoutMs?: number;
	maxWorkers?: number;
	clangFilesystem?: string;
}

export interface BashProfileOptions {
	config: BashProfileConfiguration;
	sdk: WasixSdk;
	/** The injecting host retains the lifetime of this persistence workspace. */
	workspace?: ContainerOptions['workspace'];
	fetch?: typeof globalThis.fetch;
	onRecord?: (record: HostCommandRecord) => void;
	onInvocation?: (invocation: HostCommandInvocation) => void;
	adapters?: ContainerOptions['adapters'];
	commands?: ContainerOptions['commands'];
	workerGroup?: WasixWorkerGroup;
	/** Registered BusyBox commands chosen by the application's pinned distribution. */
	shellCommands?: readonly string[];
	shellRoutes?: Readonly<Record<string, HostCommandRoute>>;
}

const digest = async (bytes: Uint8Array) =>
	Array.from(
		new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))),
		(value) => value.toString(16).padStart(2, '0')
	).join('');

/** A shared Bash/Clang owner. Importing this module does not load any runtime assets. */
export async function createBashProfile({
	config,
	sdk,
	workspace,
	fetch: fetcher,
	onRecord,
	onInvocation,
	adapters = [],
	commands = {},
	workerGroup,
	shellCommands = [],
	shellRoutes = {}
}: BashProfileOptions) {
	const filesystem = config.clangFilesystem === undefined ? 'snapshot' : config.clangFilesystem;
	if (filesystem !== 'snapshot' && filesystem !== 'live')
		throw new TypeError('clangFilesystem must be snapshot or live');
	const adapterId =
		filesystem === 'live' ? 'llvm-clang-tool-host-live-v1' : 'llvm-clang-tool-host-v1';
	const distribution = await validateDistribution({
		bytes: new TextEncoder().encode(config.manifest),
		expectedSha256: config.manifestSha256,
		adapterIds: ['wasi-preview1-live', adapterId],
		allowedAssetURLs: config.assetURLs
	});
	const cache = Object.freeze({
		enabled: true,
		namespace: config.cacheNamespace,
		version: config.manifestSha256,
		storageReserveBytes: 0
	});
	const assetOptions = {
		distribution,
		fetch: fetcher,
		persistentCache: cache,
		maxCachedBytes: 192 * 1024 * 1024
	};
	const manager = createContainerPackageManager({
		...assetOptions,
		capabilities: ['wasi-preview1', 'llvm-tool-host-exec-v1']
	});
	const shellAssets = createVerifiedAssetLoader({
		...assetOptions,
		maxCachedBytes: 64 * 1024 * 1024
	});
	let workers: WasixWorkerGroup | undefined;
	let container: Container;
	try {
		workers = workerGroup ?? installWasixWorkerGroup({ maxWorkers: config.maxWorkers ?? 32 });
		container = createContainer({
			workspace,
			packages: manager,
			commands,
			maxBytes: workspace?.fs.maxBytes ?? 256 * 1024 * 1024,
			adapters: [
				...adapters,
				createLiveWasiAdapter({
					maxBlockedIoMs: 120000,
					workerFactory: () => new Worker(config.liveWorkerUrl, { type: 'module' })
				}),
				(filesystem === 'live' ? createLiveClangAdapter : createClangAdapter)({
					clangSha256: config.clangSha256,
					linkerSha256: config.linkerSha256,
					linkerPath: `${TOOLCHAIN}/bin/wasm-ld`,
					compilerPaths: [`${TOOLCHAIN}/bin/llvm`],
					executableOutputProfile: 'wasi-preview1-process',
					workerFactory: () => new Worker(config.clangWorkerUrl, { type: 'module' })
				})
			],
			artifactAdapter: 'wasi-preview1-live',
			maxMemoryBytes: 2 ** 32,
			maxProcesses: 8
		});
	} catch (error) {
		await workers?.dispose();
		await manager.dispose();
		await shellAssets.dispose();
		throw error;
	}
	const routes: Readonly<Record<string, HostCommandRoute>> = {
		...Object.fromEntries(
			shellCommands.map((name) => [`${BASH_BIN}/${name}`, { command: name }])
		),
		[`${BASH_BIN}/clang`]: {
			command: 'clang',
			stdio: filesystem === 'live' ? 'delegated' : 'forwarded'
		},
		[`${BASH_BIN}/wasm-run`]: { command: 'wasm-run' },
		...shellRoutes
	};
	let sysroot: { sha256: string; entries: number; files: number } | undefined;
	let session: WasixShellSession | undefined;
	let starting: Promise<WasixShellSession> | undefined;
	let disposal: Promise<void> | undefined;
	const stop = new AbortController();
	const prepareCommand = async (invocation: HostCommandInvocation, signal: AbortSignal) => {
		onInvocation?.(invocation);
		if (invocation.path !== `${BASH_BIN}/clang` || sysroot) return;
		// Each consumer owns its signal; the verified asset loader shares only fetches.
		const prepared = await manager.prepare('llvm', { signal });
		const archive = prepared.packages
			.find((pkg) => pkg.id === 'llvm')
			?.files.find((file) => file.path === 'sysroot.tar')?.bytes;
		if (!archive) throw new Error('Pinned LLVM profile has no sysroot archive');
		const entries = extractTarPackage(archive);
		const metadata = {
			sha256: await digest(archive),
			entries: entries.length,
			files: entries.filter((file) => file.type === 'file').length
		};
		signal.throwIfAborted();
		if (!sysroot) {
			container.fs.mountReadonly(BASH_SYSROOT, entries);
			sysroot = metadata;
		}
	};
	return Object.freeze({
		container,
		manager,
		shellAssets,
		workers,
		cache,
		clangFilesystem: filesystem,
		inspectSysroot: () => sysroot ?? null,
		prepareCommand,
		startShell(
			options: Pick<WasixShellOptions, 'mounts' | 'args' | 'cwd' | 'env'> = {},
			signal?: AbortSignal
		) {
			if (starting || stop.signal.aborted)
				return Promise.reject(
					new Error('The dedicated Bash owner has already started or retired')
				);
			starting = createWasixShellSession({
				container,
				sdk,
				workers,
				assets: shellAssets,
				sdkAsset: config.sdkAsset ?? { packageId: 'shell', assetId: 'sdk' },
				shellAsset: config.shellAsset ?? { packageId: 'shell', assetId: 'bash' },
				shellWasmSha256: config.bashWasmSha256,
				sdkUrl: config.sdkUrl,
				workerUrl: config.sdkWorkerUrl,
				memory: config.memory,
				routes,
				mounts: options.mounts,
				moduleDirectories: ['/workspace'],
				timeoutMs: config.commandTimeoutMs,
				args: options.args ?? ['--noprofile', '--norc'],
				cwd: options.cwd ?? '/workspace',
				env: {
					PATH: `${BASH_BIN}:/usr/bin:/bin`,
					HOME: '/workspace',
					LANG: 'C',
					...options.env
				},
				signal: signal ? AbortSignal.any([signal, stop.signal]) : stop.signal,
				prepareCommand,
				onRecord
			}).then((value) => {
				session = value;
				return value;
			});
			return starting;
		},
		dispose() {
			return (disposal ??= (async () => {
				stop.abort();
				const errors: unknown[] = [];
				for (const cleanup of [
					() => workers.dispose(),
					() => session?.dispose(),
					() => container.dispose(),
					() => manager.dispose(),
					() => shellAssets.dispose()
				]) {
					try {
						await cleanup();
					} catch (error) {
						errors.push(error);
					}
				}
				await starting?.catch(() => {});
				if (errors.length) throw new AggregateError(errors, 'Bash profile cleanup failed');
			})());
		}
	});
}
