import type { DebugVariable } from '$lib/playground/options';

export function selectInlineDebugLocals(lineText: string, locals: DebugVariable[]) {
	const sanitized = lineText
		.replace(/\/\/.*$/g, ' ')
		.replace(/"(?:\\.|[^"\\])*"/g, ' ')
		.replace(/'(?:\\.|[^'\\])*'/g, ' ');
	const identifiers = new Set(sanitized.match(/[A-Za-z_]\w*/g) || []);
	return locals.filter((variable) => identifiers.has(variable.name));
}
