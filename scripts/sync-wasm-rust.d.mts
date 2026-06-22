/**
 * @param {{ sourceDir?: string; targetDir?: string; versionModulePath?: string; sharedLldDir?: string }} [options]
 */
export function syncWasmRustDist({ sourceDir, targetDir, versionModulePath, sharedLldDir }?: {
    sourceDir?: string;
    targetDir?: string;
    versionModulePath?: string;
    sharedLldDir?: string;
}): Promise<{
    sourceDir: string;
    targetDir: string;
    fingerprint: string;
    versionModulePath: string;
}>;
