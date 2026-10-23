import { selectInlineDebugLocals } from '../locals.js';
import type { DebugLanguageAdapter } from './types.js';

export const javaDebugLanguageAdapter: DebugLanguageAdapter = {
	id: 'java',
	// TeaVM GC does not emit Java locals. Never emulate Java expressions in JS.
	evaluateExpression: () => '?',
	selectInlineLocals: selectInlineDebugLocals
};
