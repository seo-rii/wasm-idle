import { type ResolvedLanguageToolAssetConfig } from './assets.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from './types.js';
export declare function resolveCppLanguageServerRuntimeAssetConfig(options: EditorLanguageServerOptions | undefined, currentUrl?: string): ResolvedLanguageToolAssetConfig;
export declare function resolveCppLanguageServerBaseUrl(options: EditorLanguageServerOptions | undefined, currentUrl?: string): string;
export declare function resolvePythonLanguageServerBaseUrl(options: EditorLanguageServerOptions | undefined, currentUrl?: string): string;
export declare function resolveRustLanguageServerCompilerUrl(options: EditorLanguageServerOptions | undefined, currentUrl?: string): string;
export declare function resolveGoLanguageServerCompilerUrl(options: EditorLanguageServerOptions | undefined, currentUrl?: string): string;
export declare function resolveGleamLanguageServerBaseUrl(options: EditorLanguageServerOptions | undefined, currentUrl?: string): string;
export declare function resolveGleamLanguageServerManifestUrl(options: EditorLanguageServerOptions | undefined, currentUrl?: string): string;
export type { EditorLanguageServerRuntimeOptions };
//# sourceMappingURL=runtime.d.ts.map