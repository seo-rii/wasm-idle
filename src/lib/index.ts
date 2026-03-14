import Terminal from '$lib/terminal';
export {
	cppDebugLanguageAdapter,
	pythonDebugLanguageAdapter,
	evaluateDebugExpression,
	MonacoDebugView,
	selectInlineDebugLocals
} from '$lib/debug';
import playground from '$lib/playground';

export default Terminal;
export { playground };
export type {
	DebugCommand,
	DebugFrame,
	DebugSessionEvent,
	DebugVariable,
	SandboxExecutionOptions,
	TerminalControl
} from '$lib/terminal';
export type { CompilerDiagnostic } from '$lib/playground/options';
export type { DebugLanguageAdapter } from '$lib/debug';
