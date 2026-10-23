import type {
	CommandAdapter,
	CommandDefinition,
	Container,
	ContainerPackageManager,
	VerifiedAssetLoader,
	HostCommandInvocation,
	HostCommandRoute,
	HostCommandRecord
} from '@wasm-idle/container';
import type {
	WasixSdk,
	WasixShellSession,
	WasixWorkerGroup
} from '@wasm-idle/container/adapters/wasix';
import type { PersistentWorkspace } from '@wasm-idle/container/persistence';
export const BASH_BIN: '/usr/local/bin';
export const BASH_SYSROOT: '/usr/share/wasm-sysroot';
export const C_SYSROOT: '/usr/share/wasm-sysroot-c';
export const BASH_APPLETS: readonly string[];
export interface BashProfileConfiguration {
	manifest: string;
	manifestSha256: string;
	assetURLs: readonly string[];
	sdkUrl: string;
	sdkWorkerUrl: string;
	liveWorkerUrl: string;
	clangWorkerUrl: string;
	sdkAsset: { packageId: string; assetId: string };
	shellAsset: { packageId: string; assetId: string };
	bashWasmSha256: string;
	memory: { initial: number; maximum: number };
	clangSha256: string;
	linkerSha256: string;
	cacheNamespace: string;
	commandTimeoutMs?: number;
	maxWorkers?: number;
	clangFilesystem?: string;
	sysrootProfile?: string;
	sysrootLayers?: {
		schemaVersion: number;
		basePackage: string;
		cxxPackage: string;
		full: { bytes: number; sha256: string };
	};
}
export interface BashProfile {
	readonly container: Container;
	readonly manager: ContainerPackageManager;
	readonly shellAssets: VerifiedAssetLoader;
	readonly workers: WasixWorkerGroup;
	readonly cache: {
		enabled: true;
		namespace: string;
		version: string;
		storageReserveBytes: number;
	};
	readonly clangFilesystem: 'snapshot' | 'live';
	readonly sysrootProfile: 'full' | 'c-base-v1';
	inspectSysroot(
		profile?: 'c' | 'full'
	): { sha256: string; entries: number; files: number } | null;
	prepareClang(profile: 'c' | 'full', signal: AbortSignal): Promise<string[]>;
	prepareCommand(
		invocation: Pick<HostCommandInvocation, 'path'>,
		signal: AbortSignal
	): Promise<void>;
	startShell(
		options?: {
			args?: readonly string[];
			mounts?: readonly string[];
			cwd?: string;
			env?: Readonly<Record<string, string>>;
		},
		signal?: AbortSignal
	): Promise<WasixShellSession>;
	dispose(): Promise<void>;
}
export function createBashProfile(options: {
	config: BashProfileConfiguration;
	sdk: WasixSdk;
	workspace?: PersistentWorkspace;
	fetch?: typeof fetch;
	onRecord?: (record: HostCommandRecord) => void;
	onInvocation?: (invocation: HostCommandInvocation) => void;
	adapters?: readonly CommandAdapter[];
	commands?: Readonly<Record<string, CommandDefinition>>;
	workerGroup?: WasixWorkerGroup;
	shellRoutes?: Readonly<Record<string, HostCommandRoute>>;
}): Promise<BashProfile>;
