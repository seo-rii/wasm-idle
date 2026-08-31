export const RUST_EXECUTABLE_GRAPH_FORMAT: 'wasm-idle-rust-executable-graph-v1';
export const RUST_EXECUTABLE_GRAPH_FINGERPRINT_DOMAIN: 'wasm-idle:rust-executable-graph:v1\n';
export const RUST_EXECUTABLE_GRAPH_MANIFEST_PATH: 'runtime-executable-graph.v1.json';
export const RUST_EXECUTABLE_GRAPH_INERT_SUFFIX: '.bin';
export const RUST_EXECUTABLE_GRAPH_LOCK_FORMAT: 'wasm-idle-rust-executable-graph-lock-v1';

export type RustExecutableGraphAuthority = 'published-static' | 'explicit-dist';
export type RustExecutableGraphEncoding = 'identity' | 'gzip';
export type RustExecutableGraphImportKind = 'static' | 'dynamic' | 'worker';

export interface RustExecutableGraphReceipt {
	readonly bytes: number;
	readonly sha256: string;
}

export interface RustExecutableGraphImport {
	readonly specifier: string;
	readonly target: string;
	readonly kind: RustExecutableGraphImportKind;
}

export interface RustExecutableGraphAsset {
	readonly specifier: string;
	readonly target: string;
	readonly kind: 'core-wasm';
}

export interface RustExecutableGraphExternal {
	readonly specifier: string;
	readonly kind: 'dynamic';
	readonly condition: 'node-only';
}

export interface RustExecutableGraphModule {
	readonly delivery: Readonly<{
		storagePath: string;
		encoding: RustExecutableGraphEncoding;
	}>;
	readonly storage: RustExecutableGraphReceipt;
	readonly logical: RustExecutableGraphReceipt;
	readonly imports: readonly RustExecutableGraphImport[];
	readonly assets: readonly RustExecutableGraphAsset[];
	readonly externals: readonly RustExecutableGraphExternal[];
}

export interface RustExecutableGraphProfile {
	readonly schemaVersion: 1;
	readonly format: typeof RUST_EXECUTABLE_GRAPH_FORMAT;
	readonly authority: RustExecutableGraphAuthority;
	readonly entryPath: 'index.js';
	readonly fingerprint: string;
	readonly modules: Readonly<Record<string, RustExecutableGraphModule>>;
}

export interface RustRuntimeAssetReceipt extends RustExecutableGraphReceipt {
	readonly uncompressedBytes?: number;
	readonly uncompressedSha256?: string;
}

export interface RustRuntimeProfileInputs {
	readonly assetReceipts: Readonly<Record<string, RustRuntimeAssetReceipt>>;
	readonly manifestReceipt: RustExecutableGraphReceipt;
}

export interface RustExecutableGraphLock {
	readonly format: 'wasm-idle-rust-executable-graph-lock-v1';
	readonly authorities: Readonly<
		Record<RustExecutableGraphAuthority, RustExecutableGraphProfile>
	>;
}

export interface SyncWasmRustDistOptions {
	readonly sourceDir?: string;
	readonly targetDir?: string;
	readonly versionModulePath?: string;
	readonly sharedLldDir?: string;
	readonly canonicalLldDir?: string;
	readonly graphLockPath?: string;
	readonly syncLockPath?: string;
	readonly transactionMarkerPath?: string;
	readonly renamePath?: typeof import('node:fs/promises').rename;
}

export interface SyncWasmRustDistResult {
	readonly sourceDir: string;
	readonly sourceMode: RustExecutableGraphAuthority;
	readonly targetDir: string;
	readonly fingerprint: string;
	readonly runtimeProfile: RustRuntimeProfileInputs;
	readonly executableGraphProfile: RustExecutableGraphProfile & {
		readonly authority: 'published-static';
	};
	readonly graphManifestPath: string;
	readonly versionModulePath: string;
}

export function extractRustExecutableModuleEdges(
	source: string,
	modulePath: string
): Readonly<{
	imports: readonly RustExecutableGraphImport[];
	assets: readonly RustExecutableGraphAsset[];
	externals: readonly RustExecutableGraphExternal[];
}>;

export function inspectRustExecutableGraph(
	rootDir: string,
	authority: RustExecutableGraphAuthority
): Promise<RustExecutableGraphProfile>;

export function computeRustExecutableGraphFingerprint(
	profile: Omit<RustExecutableGraphProfile, 'fingerprint'> | RustExecutableGraphProfile
): string;

export function parseRustExecutableGraphLock(bytes: Uint8Array): RustExecutableGraphLock;

export function createRustExecutableGraphLockSource(profiles: Readonly<{
	publishedStaticProfile: RustExecutableGraphProfile;
	explicitDistProfile: RustExecutableGraphProfile;
}>): string;

export function getRustSyncControlPaths(
	targetDir: string,
	versionModulePath?: string
): Readonly<{
	syncLockPath: string;
	versionSyncLockPath: string;
	transactionMarkerPath: string;
}>;

export function createRustExecutableGraphManifestSource(
	profile: RustExecutableGraphProfile
): string;

export function createRustVersionModuleSource(
	fingerprint: string,
	runtimeProfile: RustRuntimeProfileInputs,
	graphProfile: RustExecutableGraphProfile
): Promise<string>;

export function syncWasmRustDist(
	options?: SyncWasmRustDistOptions
): Promise<SyncWasmRustDistResult>;

export function refreshWasmRustRuntimeProfile(
	options?: Omit<SyncWasmRustDistOptions, 'sourceDir'>
): Promise<SyncWasmRustDistResult>;
