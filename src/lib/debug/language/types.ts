import type { DebugVariable } from '$lib/playground/options';

export interface DebugLanguageAdapter {
	id: string;
	evaluateExpression: (expression: string, locals: DebugVariable[]) => string;
	selectInlineLocals: (lineText: string, locals: DebugVariable[]) => DebugVariable[];
}
