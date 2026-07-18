import { evaluateDebugExpression } from '../expression.js';
import { selectInlineDebugLocals } from '../locals.js';
import type { DebugLanguageAdapter } from './types.js';

export const goDebugLanguageAdapter: DebugLanguageAdapter = {
	id: 'go',
	evaluateExpression: evaluateDebugExpression,
	selectInlineLocals: selectInlineDebugLocals
};
