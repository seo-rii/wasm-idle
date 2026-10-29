import { DiagnosticLimitError } from '@wasm-idle/core';
import type { CompilerDiagnostic } from './options';

/** Convert the real Scala reporter's terminal headings into editor locations. */
export function parseScalaDiagnostics(
	lines: readonly string[],
	maxDiagnostics = 1000
): CompilerDiagnostic[] {
	const diagnostics: CompilerDiagnostic[] = [];
	const text = lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
	const headings = [
		...text.matchAll(/^-- (?:\[\w+\] )?(.+?): \/workspace\/(.+\.scala):(\d+):(\d+)\s*-*\s*$/gm)
	];
	for (let index = 0; index < headings.length; index++) {
		const heading = headings[index];
		if (diagnostics.length >= maxDiagnostics)
			throw new DiagnosticLimitError('Scala diagnostic limit exceeded', {
				runtimeId: 'SCALA',
				limit: maxDiagnostics,
				actual: diagnostics.length + 1
			});
		const body = text
			.slice(heading.index! + heading[0].length, headings[index + 1]?.index ?? text.length)
			.trim();
		diagnostics.push({
			fileName: heading[2],
			lineNumber: Number(heading[3]),
			columnNumber: Number(heading[4]),
			severity: /warning/i.test(heading[1]) ? 'warning' : 'error',
			message: `${heading[1]}${body ? `\n${body}` : ''}`
		});
	}
	return diagnostics;
}
