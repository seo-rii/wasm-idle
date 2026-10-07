import type { RuntimeAssetIntegrityEntry } from '@wasm-idle/core';
import type { ClangdHeaderAsset } from './headers.js';

export interface ClangdPreloadedAssets {
	objectiveCHeaders?: Record<string, string>;
	clangdJs: ArrayBuffer;
	clangdWasmGz?: ArrayBuffer;
	clangdWasmIntegrity?: RuntimeAssetIntegrityEntry;
	/** Only supplied after both transport and logical integrity gates have passed. */
	clangdModule?: WebAssembly.Module;
	clangdWasmBytes?: number;
	clangdWasmSha256?: string;
	clangdHeaders?: ClangdHeaderAsset;
}

export interface ClangdWorkerInitMessage {
	type: 'init';
	baseUrl: string;
	assets: ClangdPreloadedAssets;
	debug?: boolean;
	compileProfile?: { cppVersion?: string; cVersion?: string };
}

export interface ClangdWorkerSyncFileMessage {
	type: 'sync-file';
	name: string;
}

export type ClangdWorkerInboundMessage = ClangdWorkerInitMessage | ClangdWorkerSyncFileMessage;

export type ClangdWorkerOutboundMessage =
	| { type: 'progress'; value: number; max?: number; stage?: string }
	| { type: 'ready'; value: number }
	| { type: 'error'; message: string };
