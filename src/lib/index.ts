import Terminal from '$lib/terminal';
export {
	cppDebugLanguageAdapter,
	pythonDebugLanguageAdapter,
	evaluateDebugExpression,
	createDebugSessionController,
	MonacoDebugView,
	attachMonacoDebugActions,
	selectInlineDebugLocals
} from '$lib/debug';
import playground, { createPlaygroundBinding } from '$lib/playground';

export default Terminal;
export { createPlaygroundBinding, playground };
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
	DebugSessionController,
	DebugSessionControllerOptions,
	DebugWatchValue,
	MonacoDebugActionsOptions
} from '$lib/debug';
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
export type { DebugLanguageAdapter } from '$lib/debug';
