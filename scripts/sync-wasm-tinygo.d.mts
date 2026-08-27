export interface WasmTinyGoAssetReceipt {
	bytes: number;
	sha256: string;
	uncompressedBytes?: number;
	uncompressedSha256?: string;
}

export interface WasmTinyGoRuntimeProfile {
	profileId: string;
	protocolVersion: number;
	manifestPath: string;
	manifestFingerprint: string;
	manifestReceipt: WasmTinyGoAssetReceipt;
	assetReceipts: Record<string, WasmTinyGoAssetReceipt>;
}

export type TinyGoExecutableGraphImportKind = 'static' | 'dynamic' | 'worker';

export interface TinyGoExecutableGraphImport {
	specifier: string;
	target: string;
	kind: TinyGoExecutableGraphImportKind;
}

export interface TinyGoExecutableGraphLockModule {
	path: string;
	bytes: number;
	sha256: string;
	imports: TinyGoExecutableGraphImport[];
}

export interface ParsedTinyGoExecutableGraphLock {
	entryPath: string;
	modules: Map<string, TinyGoExecutableGraphLockModule>;
}

export interface TinyGoExecutableGraphModule {
	readonly bytes: number;
	readonly sha256: string;
	readonly imports: readonly Readonly<TinyGoExecutableGraphImport>[];
}

export interface TinyGoExecutableGraphProfile {
	readonly schemaVersion: 1;
	readonly format: typeof TINYGO_EXECUTABLE_GRAPH_FORMAT;
	readonly entryPath: string;
	readonly fingerprint: string;
	readonly modules: Readonly<Record<string, TinyGoExecutableGraphModule>>;
}

export interface SyncWasmTinyGoOptions {
	sourceDir?: string;
	targetDir?: string;
	versionModulePath?: string;
	graphLockPath?: string;
	syncLockPath?: string;
	transactionMarkerPath?: string;
	renamePath?: typeof import('node:fs/promises').rename;
	beforeProtectedSnapshot?: () => void | Promise<void>;
	beforeStagedProfileSnapshot?: () => void | Promise<void>;
}

export const TINYGO_EXECUTABLE_GRAPH_FORMAT: 'wasm-idle-tinygo-executable-graph-v1';
export const TINYGO_EXECUTABLE_GRAPH_FINGERPRINT_DOMAIN: 'wasm-idle:tinygo-executable-graph:v1\n';
export const TINYGO_EXECUTABLE_GRAPH_MANIFEST_PATH: 'runtime-executable-graph.v1.json';

export function parseTinyGoExecutableGraphLock(
	bytes: Uint8Array
): Readonly<ParsedTinyGoExecutableGraphLock>;

export function extractTinyGoExecutableImports(
	source: string,
	importer: string
): TinyGoExecutableGraphImport[];

export function computeTinyGoExecutableGraphFingerprint(
	lock: Readonly<ParsedTinyGoExecutableGraphLock>
): string;

export function getTinyGoSyncControlPaths(targetDir: string): {
	syncLockPath: string;
	transactionMarkerPath: string;
};

export function syncWasmTinyGoDist(options?: SyncWasmTinyGoOptions): Promise<{
	sourceDir: string;
	sourceMode: 'explicit-graph-source' | 'published-static';
	targetDir: string;
	fingerprint: string;
	profile: Readonly<WasmTinyGoRuntimeProfile>;
	executableGraphProfile: TinyGoExecutableGraphProfile;
	graphManifestPath: string;
	versionModulePath: string;
}>;
