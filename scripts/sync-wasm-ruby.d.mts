export interface RubyRuntimeLogicalAsset {
	path: string;
	mediaType: string;
	size: number;
	sha256: string;
}

export interface RubyRuntimeStorageAsset {
	path: string;
	logicalPath: string;
	encoding: 'gzip' | 'identity';
	size: number;
	sha256: string;
}

export interface RubyRuntimeFingerprintInput {
	format: string;
	runtime: string;
	profileId: string;
	provenanceLevel: string;
	licenseExpression: string;
	artifact: Record<string, unknown>;
	components: Record<string, unknown>;
	packages: unknown[];
	producer: Record<string, unknown>;
	transformations: unknown[];
	legalFiles: Array<{
		targetPath: string;
		mediaType: string;
		spdx: string;
		size: number;
		sha256: string;
	}>;
	metadata: {
		path: string;
		mediaType: string;
		size: number;
		sha256: string;
	};
	assets: RubyRuntimeLogicalAsset[];
	storage: RubyRuntimeStorageAsset[];
	fingerprint?: string;
}

export interface SyncWasmRubyOptions {
	repoRoot?: string;
	nodeModulesDir?: string;
	targetDir?: string;
	generatedModulePath?: string;
	lockFilePath?: string;
	packageJsonPath?: string;
	pnpmLockPath?: string;
	buildRuntime?: (options: {
		entryPath: string;
		outDir: string;
		repoRoot: string;
	}) => Promise<void>;
	renamePath?: (sourcePath: string, targetPath: string) => Promise<void>;
}

export interface SyncWasmRubyResult {
	sourceDir: string;
	targetDir: string;
	generatedModulePath: string;
	fingerprint: string;
}

export const RUBY_MANIFEST_FORMAT: 'wasm-ruby-runtime-manifest-v2';
export const RUBY_FINGERPRINT_DOMAIN: 'wasm-idle:ruby-runtime-manifest:v2';

export function computeRubyRuntimeFingerprint(manifest: RubyRuntimeFingerprintInput): string;

export function syncWasmRubyAssets(options?: SyncWasmRubyOptions): Promise<SyncWasmRubyResult>;
