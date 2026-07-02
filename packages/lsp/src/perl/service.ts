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

export interface PerlWorkerOptions {
	baseUrl: string;
	workerUrl: string;
}

export type PerlDiagnosticRunnerRequest = StaticWorkerDiagnosticRequest<PerlWorkerOptions>;

export interface PerlDiagnosticRunnerResult {
	error?: string;
	output?: string;
}

export type RunPerlDiagnostics = StaticWorkerDiagnosticRunner<
	PerlWorkerOptions,
	PerlDiagnosticRunnerResult
>;

const PERL_KEYWORDS = [
	'continue',
	'do',
	'else',
	'elsif',
	'for',
	'foreach',
	'if',
	'last',
	'my',
	'next',
	'our',
	'package',
	'return',
	'sub',
	'unless',
	'until',
	'use',
	'while'
] as const;

const PERL_BUILTINS = [
	'chomp',
	'defined',
	'die',
	'exists',
	'grep',
	'join',
	'length',
	'map',
	'open',
	'pop',
	'print',
	'push',
	'say',
	'shift',
	'split',
	'sprintf',
	'undef',
	'unshift',
	'warn'
] as const;

const PERL_HOVER: Record<string, string> = {
	my: 'Declares a lexically scoped Perl variable.',
	our: 'Declares a package variable visible under strict vars.',
	sub: 'Defines a Perl subroutine.',
	use: 'Loads a module at compile time.',
	print: 'Writes values to the selected output handle.',
	say: 'Writes values followed by a newline.',
	chomp: 'Removes an input record separator from the end of a string.',
	defined: 'Checks whether a scalar has a defined value.',
	split: 'Splits a string into a list.'
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
		message.match(/\bat\s+\S+\s+line\s+(\d+)(?:,\s+near\s+.+)?/iu) ||
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
		source: 'perl',
		message: message || 'Perl diagnostic'
	};
};

export function createPerlWorkerService(
	runDiagnostics?: RunPerlDiagnostics
): WorkerLanguageService {
	const workerDiagnostics = createStaticWorkerDiagnostics<
		PerlWorkerOptions,
		PerlDiagnosticRunnerResult
	>({
		languageName: 'Perl',
		loadProgressStage: 'load-perl-runtime',
		diagnosticsProgressStage: 'perl-diagnostics',
		defaultActivePath: 'main.pl',
		timeoutMessage: 'Perl diagnostics timed out',
		runDiagnostics,
		createMessage: (request) => ({
			baseUrl: request.baseUrl,
			code: request.code,
			activePath: request.activePath,
			diagnose: true,
			log: false
		}),
		diagnosticsFromResult: (result) => {
			const output = (result.output || '').trim();
			const error = (result.error || '').trim();
			const message =
				error && !/^Perl exited with status \d+\.$/u.test(error) ? error : output || error;
			return message ? [diagnosticFromMessage(message)] : [];
		}
	});

	return {
		name: 'wasm-idle-perl-lsp',
		diagnosticDelay: 500,
		capabilities: {
			completionProvider: { triggerCharacters: ['$', '@', '%', ':'] },
			hoverProvider: true,
			documentSymbolProvider: true
		},
		initialize: workerDiagnostics.initialize,
		diagnostics: workerDiagnostics.diagnostics,
		completion() {
			return {
				isIncomplete: false,
				items: [
					...PERL_KEYWORDS.map((label) => ({
						label,
						kind: 14,
						detail: PERL_HOVER[label] || 'Perl keyword'
					})),
					...PERL_BUILTINS.map((label) => ({
						label,
						kind: 3,
						detail: PERL_HOVER[label] || 'Perl built-in'
					}))
				]
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = PERL_HOVER[word];
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
			const pattern = /^\s*sub\s+([A-Za-z_][A-Za-z0-9_]*)/gmu;
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
