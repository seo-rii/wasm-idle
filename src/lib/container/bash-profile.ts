import {
	createContainer,
	createContainerPackageManager,
	createVerifiedAssetLoader,
	validateDistribution,
	extractTarPackage,
	type Container,
	type ContainerOptions,
	type SnapshotEntry,
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
export const C_SYSROOT = '/usr/share/wasm-sysroot-c';
const TOOLCHAIN = '/opt/toolchains/llvm';

/** Expose the verified legacy sysroot through the canonical driver's automatic search paths. */
export function withCanonicalWasiPaths(entries: readonly Omit<SnapshotEntry, 'inode'>[]) {
	const additions: Omit<SnapshotEntry, 'inode'>[] = [];
	for (const parent of ['include', 'lib']) {
		if (
			entries.some(
				(entry) => entry.path === `${parent}/wasm32-wasi` && entry.type === 'directory'
			) &&
			!entries.some((entry) => entry.path === `${parent}/wasm32-wasip1`)
		)
			additions.push({
				path: `${parent}/wasm32-wasip1`,
				type: 'symlink',
				mode: 0o777,
				target: 'wasm32-wasi'
			});
	}
	const directory = 'lib/clang/22/lib/wasm32-unknown-wasip1';
	const path = `${directory}/libclang_rt.builtins.a`;
	if (
		!entries.some((entry) => entry.path === path) &&
		entries.some(
			(entry) =>
				entry.path === 'lib/clang/22/lib/wasi/libclang_rt.builtins-wasm32.a' &&
				entry.type === 'file'
		)
	) {
		if (!entries.some((entry) => entry.path === directory))
			additions.push({ path: directory, type: 'directory', mode: 0o755 });
		additions.push({
			path,
			type: 'symlink' as const,
			mode: 0o777,
			target: '../wasi/libclang_rt.builtins-wasm32.a'
		});
	}
	return additions.length ? [...entries, ...additions] : entries;
}

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
	/** Requires a matching host Worker with module reuse services. */
	clangModuleServices?: boolean;
	sysrootProfile?: 'full' | 'c-base-v1';
	sysrootLayers?: {
		schemaVersion: 1;
		basePackage: 'llvm-sysroot-c';
		cxxPackage: 'llvm-sysroot-cxx';
		full: { sha256: string; bytes: number };
	};
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

/** Compose verified USTAR layers without changing retained header or file bytes. */
export function composeSysrootLayers(base: Uint8Array, cxx: Uint8Array) {
	for (const layer of [base, cxx]) {
		if (
			!(layer instanceof Uint8Array) ||
			layer.length < 1024 ||
			layer.length % 512 ||
			layer.subarray(-1024).some((byte) => byte !== 0)
		)
			throw new Error('Invalid sysroot layer terminator');
	}
	const length = base.length + cxx.length - 1024;
	if (length > 128 * 1024 * 1024) throw new Error('Composed sysroot exceeds its archive budget');
	const archive = new Uint8Array(length);
	archive.set(base.subarray(0, -1024));
	archive.set(cxx.subarray(0, -1024), base.length - 1024);
	return archive;
}

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
	const layers = config.sysrootLayers;
	if (
		(config.sysrootProfile !== undefined &&
			!['full', 'c-base-v1'].includes(config.sysrootProfile)) ||
		Boolean(layers) !== (config.sysrootProfile === 'c-base-v1')
	)
		throw new Error('Explicit C base profile and pinned layers must be configured together');
	if (
		layers &&
		(layers.schemaVersion !== 1 ||
			layers.basePackage !== 'llvm-sysroot-c' ||
			layers.cxxPackage !== 'llvm-sysroot-cxx' ||
			!/^[a-f0-9]{64}$/.test(layers.full?.sha256) ||
			!Number.isSafeInteger(layers.full?.bytes) ||
			layers.full.bytes < 1024 ||
			layers.full.bytes > 128 * 1024 * 1024)
	)
		throw new Error('Invalid pinned sysroot layer configuration');
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
	let compiler:
		| (NonNullable<ContainerOptions['adapters']>[number] & { clearModuleCache?: () => void })
		| undefined;
	try {
		workers = workerGroup ?? installWasixWorkerGroup({ maxWorkers: config.maxWorkers ?? 32 });
		compiler = (filesystem === 'live' ? createLiveClangAdapter : createClangAdapter)({
			clangSha256: config.clangSha256,
			linkerSha256: config.linkerSha256,
			linkerPath: `${TOOLCHAIN}/bin/wasm-ld`,
			compilerPaths: [`${TOOLCHAIN}/bin/llvm`],
			...(filesystem === 'live'
				? { moduleServices: config.clangModuleServices === true }
				: {}),
			executableOutputProfile: 'wasi-preview1-process',
			workerFactory: () => new Worker(config.clangWorkerUrl, { type: 'module' })
		});
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
				compiler
			],
			artifactAdapter: 'wasi-preview1-live',
			maxMemoryBytes: 2 ** 32,
			maxProcesses: 8
		});
	} catch (error) {
		compiler?.clearModuleCache?.();
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
	const sysroots = new Map<string, { sha256: string; entries: number; files: number }>();
	let session: WasixShellSession | undefined;
	let starting: Promise<WasixShellSession> | undefined;
	let disposal: Promise<void> | undefined;
	const stop = new AbortController();
	const prepareSysroot = async (requestedProfile: 'c' | 'full', signal: AbortSignal) => {
		if (requestedProfile !== 'c' && requestedProfile !== 'full')
			throw new Error('Unknown Clang sysroot profile');
		const profile =
			!layers || requestedProfile === 'full' || sysroots.has('full') ? 'full' : 'c';
		const root = profile === 'c' ? C_SYSROOT : BASH_SYSROOT;
		const args =
			profile === 'c'
				? [`--sysroot=${C_SYSROOT}`, `-resource-dir=${C_SYSROOT}/lib/clang/22`]
				: [];
		if (sysroots.has(profile)) return args;
		// Each consumer owns its signal; the verified asset loader shares only fetches.
		const prepared = await manager.prepare('llvm', { signal });
		let archive: Uint8Array | undefined;
		if (layers) {
			const base = await manager.prepare(layers.basePackage, { signal });
			archive = base.packages
				.find((pkg) => pkg.id === layers.basePackage)
				?.files.find((file) => file.path === 'sysroot.tar')?.bytes;
			if (!archive) throw new Error('Pinned LLVM profile has no base sysroot archive');
			if (profile === 'full') {
				const cxx = await manager.prepare(layers.cxxPackage, { signal });
				const delta = cxx.packages
					.find((pkg) => pkg.id === layers.cxxPackage)
					?.files.find((file) => file.path === 'sysroot.tar')?.bytes;
				if (!delta) throw new Error('Pinned LLVM profile has no C++ sysroot archive');
				archive = composeSysrootLayers(archive, delta);
			}
		} else
			archive = prepared.packages
				.find((pkg) => pkg.id === 'llvm')
				?.files.find((file) => file.path === 'sysroot.tar')?.bytes;
		if (!archive) throw new Error('Pinned LLVM profile has no sysroot archive');
		const sha256 = await digest(archive);
		signal.throwIfAborted();
		if (
			layers &&
			profile === 'full' &&
			(archive.length !== layers.full.bytes || sha256 !== layers.full.sha256)
		)
			throw new Error('Composed sysroot does not match its pinned identity');
		const entries = extractTarPackage(archive);
		const metadata = {
			sha256,
			entries: entries.length,
			files: entries.filter((file) => file.type === 'file').length
		};
		signal.throwIfAborted();
		if (!sysroots.has(profile)) {
			container.fs.mountReadonly(root, withCanonicalWasiPaths(entries));
			sysroots.set(profile, metadata);
		}
		return args;
	};
	const prepareCommand = async (invocation: HostCommandInvocation, signal: AbortSignal) => {
		onInvocation?.(invocation);
		if (invocation.path === `${BASH_BIN}/clang`) await prepareSysroot('full', signal);
	};
	return Object.freeze({
		container,
		manager,
		shellAssets,
		workers,
		cache,
		clangFilesystem: filesystem,
		sysrootProfile: layers ? ('c-base-v1' as const) : ('full' as const),
		inspectSysroot: (profile = 'full') => sysroots.get(profile) ?? null,
		prepareCommand,
		prepareClang(profile: 'c' | 'full', signal: AbortSignal) {
			onInvocation?.({
				path: `${BASH_BIN}/clang`,
				argv: ['clang'],
				env: [],
				cwd: '/workspace',
				stdin: null,
				stdout: null,
				stderr: null
			});
			return prepareSysroot(profile, signal);
		},
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
					() => compiler?.clearModuleCache?.(),
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
