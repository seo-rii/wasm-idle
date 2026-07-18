import playground, { createPlaygroundBinding } from '$lib/playground';

export default playground;
export { createPlaygroundBinding, playground };
export {
	isSharedArrayBufferAvailable,
	requireSharedArrayBuffer
} from '$lib/playground/sharedBuffer';
export type {
	DebugCommand,
	DebugFrame,
	DebugSessionEvent,
	DebugVariable,
	TerminalControl
} from '@wasm-idle/core';
export type { CompilerDiagnostic, SandboxExecutionOptions } from '$lib/playground/options';
export type {
	PlaygroundRuntimeAssets,
	RuntimeAssetConfig,
	RuntimeAssetLoadRequest,
	RuntimeAssetLoader,
	RuntimeAssetLoaderResult
} from '$lib/playground/assets';
export type {
	BoundSandbox,
	PlaygroundBinding,
	PlaygroundTerminalProps,
	SandboxProgress,
	SandboxRuntimeAssets
} from '$lib/playground/sandbox';
