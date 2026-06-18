import { evaluateDebugExpression } from '$lib/debug/expression';
import { selectInlineDebugLocals } from '$lib/debug/locals';
import type { DebugLanguageAdapter } from './types';

export const rustDebugLanguageAdapter: DebugLanguageAdapter = {
	id: 'rust',
	evaluateExpression: evaluateDebugExpression,
	selectInlineLocals: selectInlineDebugLocals
};
