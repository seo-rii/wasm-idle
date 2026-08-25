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

/**
 * @param {{ sourceDir?: string; targetDir?: string; versionModulePath?: string }} [options]
 */
export function syncWasmTinyGoDist({ sourceDir, targetDir, versionModulePath }?: {
    sourceDir?: string;
    targetDir?: string;
    versionModulePath?: string;
}): Promise<{
    sourceDir: string;
    targetDir: string;
    fingerprint: string;
    profile: WasmTinyGoRuntimeProfile;
    versionModulePath: string;
}>;
