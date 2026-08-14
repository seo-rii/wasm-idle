export const HASKELL_MANIFEST_FORMAT: 'wasm-haskell-runtime-manifest-v2';
export const HASKELL_FINGERPRINT_DOMAIN: 'wasm-idle:haskell-runtime-manifest:v2';

export function canonicalHaskellRuntimeJson(value: unknown): string;
export function haskellPackageTreeReceipt(packageDir: string): Promise<{
	files: number;
	bytes: number;
	treeSha256: string;
}>;
export function assertNonOverlappingHaskellPaths(
	entries: ReadonlyArray<readonly [string, string]>
): void;
export function readPinnedHaskellResponse(
	response: Response,
	expectedBytes: number,
	label: string,
	signal: AbortSignal
): Promise<Uint8Array>;
export function updateHaskellCompressedAssetManifest(source: string, bsdtarBytes: number): string;
export function patchHaskellDyldSource(source: string): string;
export function buildHaskellModuleBundle(options: {
	sourceDir: string;
	shimPackageDir: string;
	outDir: string;
	repoRoot?: string;
}): Promise<Uint8Array>;
export function validateHaskellRuntimePublication(targetDir: string): Promise<unknown>;
export function syncWasmHaskellAssets(options?: SyncWasmHaskellOptions): Promise<{
	sourceDir: string | null;
	targetDir: string;
	generatedModulePath: string;
	versionModulePath: string;
	compressedManifestPath: string;
	fingerprint: string;
}>;

export type SyncWasmHaskellOptions = {
	sourceDir?: string;
	targetDir?: string;
	generatedModulePath?: string;
	versionModulePath?: string;
	compressedManifestPath?: string;
	lockFilePath?: string;
	nodeModulesDir?: string;
	pnpmLockPath?: string;
	fetch?: typeof fetch;
	renamePath?: (sourcePath: string, targetPath: string) => Promise<void>;
};
