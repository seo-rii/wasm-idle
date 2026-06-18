import { evaluateDebugExpression } from '$lib/debug/expression';
import { selectInlineDebugLocals } from '$lib/debug/locals';
import type { DebugLanguageAdapter } from './types';

export const goDebugLanguageAdapter: DebugLanguageAdapter = {
	id: 'go',
	evaluateExpression: evaluateDebugExpression,
	selectInlineLocals: selectInlineDebugLocals
};
