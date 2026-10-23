import type { DebugLanguageAdapter } from './types.js';

export const luaDebugLanguageAdapter: DebugLanguageAdapter = {
	id: 'lua',
	evaluateExpression(expression, locals) {
		return locals.find((variable) => variable.name === expression.trim())?.value ?? '?';
	},
	selectInlineLocals(lineText, locals) {
		const code = lineText
			.replace(/--.*$/u, ' ')
			.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu, ' ');
		const identifiers = new Set(code.match(/[A-Za-z_]\w*/gu) ?? []);
		return locals.filter((variable) => identifiers.has(variable.name));
	}
};
