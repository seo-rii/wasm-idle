import type { SyncWasmRubyOptions, SyncWasmRubyResult } from './sync-wasm-ruby.mjs';
export interface RubySplitAssetOptions {
    nodeModulesDir?: string;
    targetDir?: string;
    generatedPath?: string;
    verify?: boolean;
}
export function buildRubySplitAssets(options?: RubySplitAssetOptions): Promise<{
    bundle: unknown;
    fileCount: number;
    directoryCount: number;
    totalLogicalBytes: number;
}>;
export function syncWasmRubyProfiles(options?: SyncWasmRubyOptions & { splitGeneratedPath?: string }): Promise<SyncWasmRubyResult>;
