import { evaluateDebugExpression } from '$lib/debug/expression';
import { selectInlineDebugLocals } from '$lib/debug/locals';
import type { DebugLanguageAdapter } from './types';

export const cppDebugLanguageAdapter: DebugLanguageAdapter = {
	id: 'cpp',
	evaluateExpression: evaluateDebugExpression,
	selectInlineLocals: selectInlineDebugLocals
};
