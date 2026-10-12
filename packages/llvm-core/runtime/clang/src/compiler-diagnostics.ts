export type CompilerDiagnosticSeverity = 'error' | 'warning' | 'other';

export interface CompilerDiagnostic {
	fileName?: string | null;
	lineNumber: number;
	columnNumber?: number;
	endColumnNumber?: number;
	severity: CompilerDiagnosticSeverity;
	message: string;
}

export function extractCompilerDiagnostics(output: string): CompilerDiagnostic[] {
	const diagnostics: CompilerDiagnostic[] = [];
	for (const line of output.replace(/\x1b\[[0-9;]*m/gu, '').split(/\r?\n/)) {
		const match = line.match(
			/^(.*?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning|note):\s*(.+)$/
		);
		if (!match) continue;
		diagnostics.push({
			fileName: match[1] || undefined,
			lineNumber: Number(match[2]),
			columnNumber: match[3] ? Number(match[3]) : undefined,
			severity: match[4] === 'warning' ? 'warning' : match[4] === 'note' ? 'other' : 'error',
			message: match[5]
		});
	}
	return diagnostics;
}
