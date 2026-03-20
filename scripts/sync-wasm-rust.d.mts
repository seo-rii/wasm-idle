/**
 * @param {{ sourceDir?: string; targetDir?: string; versionModulePath?: string }} [options]
 */
export function syncWasmRustDist({ sourceDir, targetDir, versionModulePath }?: {
    sourceDir?: string;
    targetDir?: string;
    versionModulePath?: string;
}): Promise<{
    sourceDir: string;
    targetDir: string;
    fingerprint: string;
    versionModulePath: string;
}>;
