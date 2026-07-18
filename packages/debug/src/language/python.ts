import type { DebugVariable } from '@wasm-idle/core';

import { evaluateDebugExpression } from '../expression.js';
import type { DebugLanguageAdapter } from './types.js';

const selectInlinePythonLocals = (lineText: string, locals: DebugVariable[]) => {
	const sanitized = lineText
		.replace(/#.*$/g, ' ')
		.replace(/"(?:\\.|[^"\\])*"/g, ' ')
		.replace(/'(?:\\.|[^'\\])*'/g, ' ');
	const identifiers = new Set(sanitized.match(/[A-Za-z_]\w*/g) || []);
	return locals.filter((variable) => identifiers.has(variable.name));
};

export const pythonDebugLanguageAdapter: DebugLanguageAdapter = {
	id: 'python',
	evaluateExpression: evaluateDebugExpression,
	selectInlineLocals: selectInlinePythonLocals
};
