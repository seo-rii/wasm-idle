import Theme from './theme';
import registerAllPlugins from './plugin';
import Terminal from './Terminal.svelte';
import type {
	DebugCommand,
	DebugFrame,
	DebugSessionEvent,
	DebugVariable,
	SandboxExecutionOptions,
	TerminalControl
} from './types';

export { Theme, registerAllPlugins };
export type {
	DebugCommand,
	DebugFrame,
	DebugSessionEvent,
	DebugVariable,
	SandboxExecutionOptions,
	TerminalControl
};
export default Terminal;
