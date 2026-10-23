import type { DebugLanguageAdapter } from './types.js';

export const javascriptDebugLanguageAdapter: DebugLanguageAdapter = {
	id: 'javascript',
	// Compound expressions are evaluated only by the paused native JavaScript VM.
	evaluateExpression(expression, locals) {
		return locals.find((variable) => variable.name === expression.trim())?.value ?? '?';
	},
	selectInlineLocals(lineText, locals) {
		const code = lineText
			.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/gu, ' ')
			.replace(/\/\/.*$/u, ' ');
		const identifiers = new Set(
			code.match(/[$_\p{ID_Start}][$\u200C\u200D_\p{ID_Continue}]*/gu) ?? []
		);
		return locals.filter((variable) => identifiers.has(variable.name));
	}
};

export const typescriptDebugLanguageAdapter: DebugLanguageAdapter = {
	...javascriptDebugLanguageAdapter,
	id: 'typescript'
};
