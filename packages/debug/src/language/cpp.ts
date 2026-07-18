import { evaluateDebugExpression } from '../expression.js';
import { selectInlineDebugLocals } from '../locals.js';
import type { DebugLanguageAdapter } from './types.js';

export const cppDebugLanguageAdapter: DebugLanguageAdapter = {
	id: 'cpp',
	evaluateExpression: evaluateDebugExpression,
	selectInlineLocals: selectInlineDebugLocals
};
