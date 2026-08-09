export type TinyGoCompilerDiagnostic = {
	message: string;
	severity: 'error' | 'warning' | 'other';
	fileName?: string | null;
	lineNumber: number;
	columnNumber?: number;
	endColumnNumber?: number;
};

export function emitTinyGoCompilerDiagnostics(
	diagnostics: readonly unknown[],
	report: ((diagnostic: TinyGoCompilerDiagnostic) => void) | undefined
) {
	if (!report) return;
	for (const diagnostic of diagnostics) {
		if (typeof diagnostic !== 'string') continue;
		for (const rawLine of diagnostic.split(/\r?\n/u)) {
			const line = rawLine.trim();
			if (!line) continue;
			let fileName: string | null = null;
			let lineNumber = 1;
			let columnNumber: number | undefined;
			let message = line;
			let context = '';
			const location = /^(.+?):(\d+)(?::(\d+))?:\s*(.*)$/u.exec(message);
			if (location) {
				const locatedFileName = location[1] || '';
				const wrapperSeparator = locatedFileName.lastIndexOf(': ');
				const wrappedCandidate =
					wrapperSeparator < 0 ? '' : locatedFileName.slice(wrapperSeparator + 2);
				if (
					wrappedCandidate &&
					(/^(?:[A-Za-z]:[\\/]|\.{0,2}[\\/]|\/)/u.test(wrappedCandidate) ||
						/[\\/]|\.go$/u.test(wrappedCandidate))
				) {
					fileName = wrappedCandidate;
					context = locatedFileName.slice(0, wrapperSeparator);
				} else {
					fileName = locatedFileName || null;
				}
				lineNumber = Number(location[2]);
				columnNumber = location[3] === undefined ? undefined : Number(location[3]);
				message = location[4] || line;
			}
			let severity: TinyGoCompilerDiagnostic['severity'] = 'error';
			const severityPrefix = /^(error|warning|note|info(?:rmation)?):\s*(.*)$/iu.exec(
				message
			);
			if (severityPrefix) {
				severity =
					severityPrefix[1]?.toLowerCase() === 'warning'
						? 'warning'
						: severityPrefix[1]?.toLowerCase() === 'error'
							? 'error'
							: 'other';
				message = severityPrefix[2] || message;
			}
			if (context) message = `${context}: ${message}`;
			report({
				message,
				severity,
				fileName,
				lineNumber,
				...(columnNumber === undefined ? {} : { columnNumber })
			});
		}
	}
}
