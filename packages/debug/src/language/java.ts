import { selectInlineDebugLocals } from '../locals.js';
import type { DebugLanguageAdapter } from './types.js';

export const javaDebugLanguageAdapter: DebugLanguageAdapter = {
	id: 'java',
	// Inline rendering reads captured values without interpreting Java expressions.
	evaluateExpression: (expression, locals) =>
		locals.find((variable) => variable.name === expression.trim())?.value ?? '?',
	selectInlineLocals: selectInlineDebugLocals
};
