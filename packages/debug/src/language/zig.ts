import type { DebugLanguageAdapter } from './types.js';

/** Read captured LLDB values; this does not evaluate Zig expressions. */
export const zigDebugLanguageAdapter: DebugLanguageAdapter = {
	id: 'zig',
	evaluateExpression(expression, locals) {
		return locals.find((variable) => variable.name === expression.trim())?.value ?? '?';
	},
	selectInlineLocals(lineText, locals) {
		const code = lineText
			.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu, ' ')
			.replace(/\/\/.*$/u, ' ');
		const identifiers = new Set(code.match(/[A-Za-z_]\w*/gu) ?? []);
		return locals.filter((variable) => identifiers.has(variable.name));
	}
};
