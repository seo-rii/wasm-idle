/**
 * @param {{ sourceDir?: string; targetDir?: string; versionModulePath?: string; sharedLldDir?: string; canonicalLldDir?: string }} [options]
 */
export function syncWasmRustDist({ sourceDir, targetDir, versionModulePath, sharedLldDir, canonicalLldDir }?: {
    sourceDir?: string;
    targetDir?: string;
    versionModulePath?: string;
    sharedLldDir?: string;
    canonicalLldDir?: string;
}): Promise<{
    sourceDir: string;
    targetDir: string;
    fingerprint: string;
    versionModulePath: string;
}>;
