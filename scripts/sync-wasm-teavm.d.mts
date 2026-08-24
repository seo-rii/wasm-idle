export interface TeaVmProducerOptions {
	sourceDir: string;
	jdkArchivePath?: string;
	targetDir?: string;
	coreGeneratedModulePath?: string;
	wrapperGeneratedModulePath?: string;
	lockFilePath?: string;
	repoRoot?: string;
}

export interface TeaVmSyncOptions {
	distDir: string;
	targetDir?: string;
	coreGeneratedModulePath?: string;
	wrapperGeneratedModulePath?: string;
	lockFilePath?: string;
	repoRoot?: string;
}

export interface TeaVmSyncResult {
	distDir: string;
	targetDir: string;
	coreGeneratedModulePath: string;
	wrapperGeneratedModulePath: string;
	manifestPath: string;
	fingerprint: string;
	legacyManifestRemoved: boolean;
}

export const TEAVM_MANIFEST_FORMAT: 'wasm-teavm-runtime-manifest-v2';

export function readTeaVmInputLock(lockFilePath?: string): Promise<Record<string, unknown>>;
export function computeTeaVmManifestFingerprint(manifest: Record<string, unknown>): string;
export function syncWasmTeaVmAssets(options: TeaVmSyncOptions): Promise<TeaVmSyncResult>;
export function produceWasmTeaVmAssets(options: TeaVmProducerOptions): Promise<TeaVmSyncResult>;
export function assertTeaVmProducerArgs(args: string[]): void;
