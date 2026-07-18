import { evaluateDebugExpression } from '../expression.js';
import { selectInlineDebugLocals } from '../locals.js';
import type { DebugLanguageAdapter } from './types.js';

export const rustDebugLanguageAdapter: DebugLanguageAdapter = {
	id: 'rust',
	evaluateExpression: evaluateDebugExpression,
	selectInlineLocals: selectInlineDebugLocals
};
