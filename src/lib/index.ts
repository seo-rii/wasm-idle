import Terminal from '$lib/terminal';
import playground, { createPlaygroundBinding } from '$lib/playground';

export default Terminal;
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
	SandboxExecutionOptions,
	TerminalControl
} from '$lib/terminal';
export type { CompilerDiagnostic } from '$lib/playground/options';
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
