import { selectInlineDebugLocals } from '../locals.js';
import type { DebugLanguageAdapter } from './types.js';

export const javaDebugLanguageAdapter: DebugLanguageAdapter = {
	id: 'java',
	// The Java hook backend exposes genuine stacks but no local-value handles.
	evaluateExpression: () => '?',
	selectInlineLocals: selectInlineDebugLocals
};
