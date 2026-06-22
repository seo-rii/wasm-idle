import {
	positionAt,
	uriToPath,
	type LspDiagnostic,
	type LspDocument,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';
import { runRuntimeWorkerDiagnostics } from '../runtime-worker.js';

export interface PascalWorkerOptions {
	baseUrl: string;
	workerUrl: string;
}

export interface PascalDiagnosticRunnerRequest {
	baseUrl: string;
	workerUrl: string;
	code: string;
	activePath: string;
}

export interface PascalDiagnosticRunnerResult {
	error?: string;
	output?: string;
}

export type RunPascalDiagnostics = (
	request: PascalDiagnosticRunnerRequest
) => Promise<PascalDiagnosticRunnerResult>;

const PASCAL_KEYWORDS = [
	'and',
	'array',
	'begin',
	'case',
	'class',
	'const',
	'constructor',
	'destructor',
	'div',
	'do',
	'downto',
	'else',
	'end',
	'except',
	'for',
	'function',
	'if',
	'implementation',
	'in',
	'inherited',
	'interface',
	'mod',
	'not',
	'object',
	'of',
	'or',
	'procedure',
	'program',
	'record',
	'repeat',
	'then',
	'to',
	'try',
	'type',
	'unit',
	'until',
	'uses',
	'var',
	'while',
	'with',
	'xor'
] as const;

const PASCAL_BUILTINS = [
	'Boolean',
	'Char',
	'Integer',
	'ReadLn',
	'Real',
	'String',
	'Write',
	'WriteLn'
] as const;

const PASCAL_HOVER: Record<string, string> = {
	begin: 'Starts a Pascal statement block.',
	end: 'Ends a Pascal statement block.',
	function: 'Declares a routine that returns a value.',
	procedure: 'Declares a routine that does not return a value.',
	program: 'Declares the main Pascal program.',
	readln: 'Reads one line from standard input.',
	repeat: 'Starts a loop that runs until its condition becomes true.',
	unit: 'Declares a reusable Pascal module.',
	uses: 'Imports units into the current program or unit.',
	var: 'Starts a variable declaration section.',
	while: 'Runs a loop while its condition remains true.',
	writeln: 'Writes values followed by a newline.'
};

export function createPascalWorkerService(
	runDiagnostics: RunPascalDiagnostics = (request) =>
		runRuntimeWorkerDiagnostics({
			workerUrl: request.workerUrl,
			timeoutMessage: 'Pascal diagnostics timed out',
			message: {
				baseUrl: request.baseUrl,
				code: request.code,
				args: [],
				stdin: '',
				activePath: request.activePath,
				diagnose: true,
				log: false
			}
		})
): WorkerLanguageService {
	let config: PascalWorkerOptions | null = null;
	let lastKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];

	return {
		name: 'wasm-idle-pascal-lsp',
		diagnosticDelay: 600,
		capabilities: {
			completionProvider: { triggerCharacters: ['.'] },
			hoverProvider: true,
			documentSymbolProvider: true
		},
		initialize(options, context) {
			const nextConfig = (options || {}) as PascalWorkerOptions;
			if (!nextConfig.baseUrl || !nextConfig.workerUrl) {
				throw new Error('Pascal language server requires baseUrl and workerUrl');
			}
			context.reportProgress('load-pascal-runtime');
			config = nextConfig;
		},
		async diagnostics(document: LspDocument, context) {
			if (!config || !document.text.trim()) return [];
			const activePath =
				uriToPath(document.uri).split('/').filter(Boolean).pop() || 'main.pas';
			const key = `${config.baseUrl}\n${config.workerUrl}\n${activePath}\n${document.text}`;
			if (key === lastKey) return lastDiagnostics;
			context.reportProgress('pascal-diagnostics');
			lastKey = key;
			const result = await runDiagnostics({
				baseUrl: config.baseUrl,
				workerUrl: config.workerUrl,
				code: document.text,
				activePath
			});
			const message = (result.error || result.output || '').trim();
			if (!message) {
				lastDiagnostics = [];
				return lastDiagnostics;
			}
			const parsedDiagnostics: Array<LspDiagnostic & { hasLocation?: boolean }> = [];
			for (const lineText of message.split(/\r\n|\n|\r/u)) {
				const trimmed = lineText.trim();
				if (!trimmed) continue;
				const match = trimmed.match(
					/^(?:(?:[^()\s]+)\((\d+),(\d+)\)\s*)?(Fatal|Error|Warning|Note|Hint):\s*(.*)$/iu
				);
				if (!match) continue;
				const line = Math.max(0, Number(match[1] || 1) - 1);
				const character = Math.max(0, Number(match[2] || 1) - 1);
				const severityName = match[3].toLowerCase();
				parsedDiagnostics.push({
					range: {
						start: { line, character },
						end: { line, character: character + 1 }
					},
					severity:
						severityName === 'warning'
							? 2
							: severityName === 'note' || severityName === 'hint'
								? 3
								: 1,
					source: 'pascal',
					message: match[4] || trimmed,
					hasLocation: !!match[1]
				});
			}
			const hasLocatedDiagnostic = parsedDiagnostics.some(
				(diagnostic) => diagnostic.hasLocation
			);
			lastDiagnostics = (
				hasLocatedDiagnostic
					? parsedDiagnostics.filter((diagnostic) => diagnostic.hasLocation)
					: parsedDiagnostics
			).map(({ hasLocation: _hasLocation, ...diagnostic }) => diagnostic);
			if (!lastDiagnostics.length) {
				lastDiagnostics = [
					{
						range: {
							start: positionAt(document.text, 0),
							end: positionAt(document.text, Math.min(document.text.length, 1))
						},
						severity: 1,
						source: 'pascal',
						message
					}
				];
			}
			return lastDiagnostics;
		},
		completion() {
			return {
				isIncomplete: false,
				items: [
					...PASCAL_KEYWORDS.map((label) => ({
						label,
						kind: 14,
						detail: PASCAL_HOVER[label] || 'Pascal keyword'
					})),
					...PASCAL_BUILTINS.map((label) => ({
						label,
						kind: 3,
						detail: PASCAL_HOVER[label.toLowerCase()] || 'Pascal built-in'
					}))
				]
			};
		},
		hover(document, position: LspPosition) {
			const line = document.text.split('\n')[position.line] || '';
			const character = Math.max(0, Math.min(position.character, line.length));
			const word =
				(line.slice(0, character).match(/[A-Za-z_][A-Za-z0-9_]*$/u)?.[0] || '') +
				(line.slice(character).match(/^[A-Za-z0-9_]*/u)?.[0] || '');
			const description = PASCAL_HOVER[word.toLowerCase()];
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
			const pattern = /^\s*(program|unit|procedure|function)\s+([A-Za-z_][A-Za-z0-9_]*)/gimu;
			for (const match of document.text.matchAll(pattern)) {
				const name = match[2];
				const nameOffset = (match.index || 0) + match[0].lastIndexOf(name);
				const start = positionAt(document.text, nameOffset);
				const end = positionAt(document.text, nameOffset + name.length);
				symbols.push({
					name,
					kind:
						match[1].toLowerCase() === 'function' ||
						match[1].toLowerCase() === 'procedure'
							? 12
							: 2,
					range: { start, end },
					selectionRange: { start, end }
				});
			}
			return symbols;
		}
	};
}
