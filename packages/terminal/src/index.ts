import Terminal from './Terminal.svelte';
import registerAllPlugins from './plugin/index.js';
import Theme from './theme.js';
import type {
	BoundSandbox,
	CompilerDiagnostic,
	CompilerDiagnosticSeverity,
	DebugCommand,
	DebugFrame,
	DebugSessionEvent,
	DebugVariable,
	PlaygroundBinding,
	SandboxExecutionOptions,
	TerminalControl,
	TerminalExecutionOptions
} from './types.js';

export { Terminal, Theme, registerAllPlugins };
export type {
	BoundSandbox,
	CompilerDiagnostic,
	CompilerDiagnosticSeverity,
	DebugCommand,
	DebugFrame,
	DebugSessionEvent,
	DebugVariable,
	PlaygroundBinding,
	SandboxExecutionOptions,
	TerminalControl,
	TerminalExecutionOptions
};
export default Terminal;
