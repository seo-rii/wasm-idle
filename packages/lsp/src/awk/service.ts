import {
	positionAt,
	type LspDiagnostic,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';
import {
	createStaticWorkerDiagnostics,
	type StaticWorkerDiagnosticRequest,
	type StaticWorkerDiagnosticRunner
} from '../static-worker-service.js';

export interface AwkWorkerOptions {
	baseUrl: string;
	workerUrl: string;
}

export type AwkDiagnosticRunnerRequest = StaticWorkerDiagnosticRequest<AwkWorkerOptions>;

export interface AwkDiagnosticRunnerResult {
	error?: string;
	output?: string;
}

export type RunAwkDiagnostics = StaticWorkerDiagnosticRunner<
	AwkWorkerOptions,
	AwkDiagnosticRunnerResult
>;

const AWK_KEYWORDS = [
	'BEGIN',
	'END',
	'BEGINFILE',
	'ENDFILE',
	'break',
	'continue',
	'delete',
	'do',
	'else',
	'exit',
	'for',
	'function',
	'if',
	'in',
	'next',
	'nextfile',
	'print',
	'printf',
	'return',
	'while'
] as const;

const AWK_BUILTINS = [
	'atan2',
	'close',
	'cos',
	'exp',
	'fflush',
	'gsub',
	'index',
	'int',
	'length',
	'log',
	'match',
	'rand',
	'sin',
	'split',
	'sprintf',
	'sqrt',
	'srand',
	'sub',
	'substr',
	'system',
	'tolower',
	'toupper'
] as const;

const AWK_HOVER: Record<string, string> = {
	BEGIN: 'Runs before AWK reads input records.',
	END: 'Runs after AWK finishes reading input records.',
	function: 'Defines an AWK function.',
	print: 'Writes fields or expressions followed by a newline.',
	printf: 'Writes formatted output.',
	next: 'Skips to the next input record.',
	NF: 'Number of fields in the current record.',
	NR: 'Number of records read so far.',
	FS: 'Input field separator.',
	OFS: 'Output field separator.',
	RS: 'Input record separator.'
};

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	return (
		(line.slice(0, character).match(/[A-Za-z_][A-Za-z0-9_]*$/u)?.[0] || '') +
		(line.slice(character).match(/^[A-Za-z0-9_]*/u)?.[0] || '')
	);
};

const diagnosticFromMessage = (message: string): LspDiagnostic => {
	const location =
		message.match(/\bat\s+(\d+):(\d+)/iu) ||
		message.match(/\bline\s+(\d+)(?:[:,]\s*(\d+))?/iu) ||
		message.match(/:(\d+):(?:(\d+):)?/u);
	const line = Math.max(0, Number(location?.[1] || 1) - 1);
	const character = Math.max(0, Number(location?.[2] || 1) - 1);
	return {
		range: {
			start: { line, character },
			end: { line, character: character + 1 }
		},
		severity: 1,
		source: 'awk',
		message: message || 'AWK diagnostic'
	};
};

export function createAwkWorkerService(runDiagnostics?: RunAwkDiagnostics): WorkerLanguageService {
	const workerDiagnostics = createStaticWorkerDiagnostics<
		AwkWorkerOptions,
		AwkDiagnosticRunnerResult
	>({
		languageName: 'AWK',
		loadProgressStage: 'load-awk-runtime',
		diagnosticsProgressStage: 'awk-diagnostics',
		defaultActivePath: 'main.awk',
		timeoutMessage: 'AWK diagnostics timed out',
		runDiagnostics,
		createMessage: (request) => ({
			baseUrl: request.baseUrl,
			code: request.code,
			activePath: request.activePath,
			args: [],
			stdin: '',
			diagnose: true,
			log: false
		}),
		diagnosticsFromResult: (result) => {
			const message = (result.error || result.output || '').trim();
			return message ? [diagnosticFromMessage(message)] : [];
		}
	});

	return {
		name: 'wasm-idle-awk-lsp',
		diagnosticDelay: 500,
		capabilities: {
			completionProvider: { triggerCharacters: ['$', '@'] },
			hoverProvider: true,
			documentSymbolProvider: true
		},
		initialize: workerDiagnostics.initialize,
		diagnostics: workerDiagnostics.diagnostics,
		completion() {
			return {
				isIncomplete: false,
				items: [
					...AWK_KEYWORDS.map((label) => ({
						label,
						kind: 14,
						detail: AWK_HOVER[label] || 'AWK keyword'
					})),
					...AWK_BUILTINS.map((label) => ({ label, kind: 3, detail: 'AWK built-in' }))
				]
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = AWK_HOVER[word];
			if (!description) return null;
			return {
				contents: {
					kind: 'markdown',
					value: `\`${word}\`\n\n${description}`
				}
			};
		},
		documentSymbols(document) {
			const symbols = [];
			const pattern = /^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gmu;
			for (const match of document.text.matchAll(pattern)) {
				const offset = match.index || 0;
				const start = positionAt(document.text, offset);
				const end = positionAt(document.text, offset + match[0].length);
				symbols.push({
					name: match[1],
					kind: 12,
					range: { start, end },
					selectionRange: {
						start,
						end: { line: start.line, character: start.character + match[0].length }
					}
				});
			}
			return symbols;
		}
	};
}
