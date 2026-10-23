import type { DebugLanguageAdapter } from './types.js';

export const rubyDebugLanguageAdapter: DebugLanguageAdapter = {
	id: 'ruby',
	// Expressions are evaluated by CRuby Binding while paused, never by a JS parser.
	evaluateExpression(expression, locals) {
		return locals.find((variable) => variable.name === expression.trim())?.value ?? '?';
	},
	selectInlineLocals(line, locals) {
		const code = line
			.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu, ' ')
			.replace(/#.*$/u, ' ');
		const names = new Set(code.match(/[_\p{ID_Start}][_\p{ID_Continue}]*/gu) ?? []);
		return locals.filter((variable) => names.has(variable.name));
	}
};
