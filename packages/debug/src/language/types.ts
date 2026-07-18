import type { DebugVariable } from '@wasm-idle/core';

export interface DebugLanguageAdapter {
	id: string;
	evaluateExpression: (expression: string, locals: DebugVariable[]) => string;
	selectInlineLocals: (lineText: string, locals: DebugVariable[]) => DebugVariable[];
}
