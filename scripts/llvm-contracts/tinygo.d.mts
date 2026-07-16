export declare const TINYGO_LLVM_PROFILE: Readonly<{
	id: 'tinygo-emception-llvm';
	version: 2;
	tinygoVersion: '0.40.1';
	llvmVersion: '16.0.0';
	llvmCommit: 'd5a963ab8b40fcf7a99acd834e5f10a1a30cc2e5';
	workerUrl: 'https://jprendes.github.io/emception/emception.worker.bundle.worker.js';
	patchedWorkerSha256: '2c2347f5869d1c08181f46bd1ae10723be242d66cdc233e201cad0d5acb8fcea';
}>;
export declare function patchEmceptionWorkerSource(source: string): string;
export declare function discoverEmceptionAssetNames(workerSource: string): string[];
export interface SyncEmceptionRuntimeOptions {
	workerUrl?: string;
	outputPath: string;
	fetchImpl?: typeof fetch;
	expectedWorkerSha256?: string | null;
}
export declare function syncEmceptionRuntime({
	workerUrl,
	outputPath,
	fetchImpl,
	expectedWorkerSha256
}: SyncEmceptionRuntimeOptions): Promise<{
	workerUrl: string;
	outputPath: string;
	assetNames: string[];
	reusedExistingWorker: boolean;
}>;
