import {
	positionAt,
	type LspDiagnostic,
	type LspDocument,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';
import { runRuntimeWorkerDiagnostics } from '../runtime-worker.js';

export interface OctaveWorkerOptions {
	baseUrl: string;
	workerUrl: string;
	manifestUrl: string;
}

export interface OctaveDiagnosticRunnerRequest {
	baseUrl: string;
	workerUrl: string;
	manifestUrl: string;
	code: string;
	activePath: string;
}

export interface OctaveDiagnosticRunnerResult {
	error?: string;
	output?: string;
}

export type RunOctaveDiagnostics = (
	request: OctaveDiagnosticRunnerRequest
) => Promise<OctaveDiagnosticRunnerResult>;

const OCTAVE_KEYWORDS = [
	'break',
	'case',
	'catch',
	'classdef',
	'continue',
	'else',
	'elseif',
	'end',
	'endfor',
	'endfunction',
	'endif',
	'for',
	'function',
	'global',
	'if',
	'otherwise',
	'persistent',
	'return',
	'switch',
	'try',
	'while'
] as const;

const OCTAVE_BUILTINS = [
	'argv',
	'disp',
	'fgetl',
	'fprintf',
	'input',
	'isnan',
	'length',
	'printf',
	'size',
	'stdin',
	'str2double',
	'strtrim'
] as const;

const OCTAVE_HOVER: Record<string, string> = {
	argv: 'Returns the command-line arguments passed to the Octave script.',
	disp: 'Displays a value followed by a newline.',
	fgetl: 'Reads a line from a file handle such as stdin.',
	fprintf: 'Writes formatted output.',
	function: 'Defines an Octave function.',
	input: 'Reads a value from standard input.',
	printf: 'Writes formatted output.',
	stdin: 'Standard input file handle.',
	str2double: 'Converts a string to a floating-point number.',
	strtrim: 'Removes leading and trailing whitespace.'
};

const defaultRunDiagnostics: RunOctaveDiagnostics = (request) =>
	runRuntimeWorkerDiagnostics({
		workerUrl: request.workerUrl,
		timeoutMessage: 'Octave diagnostics timed out',
		message: {
			run: true,
			baseUrl: request.baseUrl,
			manifestUrl: request.manifestUrl,
			code: request.code,
			args: [],
			stdin: '',
			activePath: request.activePath,
			workspaceFiles: [],
			diagnose: true,
			log: false
		}
	});

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
		message.match(/(?:^|\s)(?:[\w./-]+\.m):(\d+):(?:(\d+):)?/iu) ||
		message.match(/\bnear\s+line\s+(\d+)(?:,\s*column\s+(\d+))?/iu) ||
		message.match(/\bline\s+(\d+)(?:\D+column\s+(\d+))?/iu) ||
		message.match(/:(\d+):(?:(\d+):)?/u);
	const line = Math.max(0, Number(location?.[1] || 1) - 1);
	const character = Math.max(0, Number(location?.[2] || 1) - 1);
	return {
		range: {
			start: { line, character },
			end: { line, character: character + 1 }
		},
		severity: 1,
		source: 'octave',
		message: message || 'Octave diagnostic'
	};
};

const symbol = (text: string, name: string, offset: number, length: number) => {
	const start = positionAt(text, offset);
	const end = positionAt(text, offset + length);
	return {
		name,
		kind: 12,
		range: { start, end },
		selectionRange: { start, end }
	};
};

export function createOctaveWorkerService(
	runDiagnostics: RunOctaveDiagnostics = defaultRunDiagnostics
): WorkerLanguageService {
	let config: OctaveWorkerOptions | null = null;
	let lastKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];

	return {
		name: 'wasm-idle-octave-lsp',
		diagnosticDelay: 500,
		capabilities: {
			completionProvider: { triggerCharacters: ['.', '('] },
			hoverProvider: true,
			documentSymbolProvider: true
		},
		initialize(options, context) {
			const nextConfig = (options || {}) as OctaveWorkerOptions;
			if (!nextConfig.baseUrl || !nextConfig.workerUrl || !nextConfig.manifestUrl) {
				throw new Error('Octave language server requires baseUrl, workerUrl, and manifestUrl');
			}
			context.reportProgress('load-octave-runtime');
			config = nextConfig;
		},
		async diagnostics(document: LspDocument, context) {
			if (!config || !document.text.trim()) return [];
			const activePath = document.uri.split('/').pop() || 'main.m';
			const key = `${config.baseUrl}\n${config.workerUrl}\n${config.manifestUrl}\n${activePath}\n${document.text}`;
			if (key === lastKey) return lastDiagnostics;
			context.reportProgress('octave-diagnostics');
			lastKey = key;
			const result = await runDiagnostics({
				baseUrl: config.baseUrl,
				workerUrl: config.workerUrl,
				manifestUrl: config.manifestUrl,
				code: document.text,
				activePath
			});
			const message = (result.error || result.output || '').trim();
			lastDiagnostics = message ? [diagnosticFromMessage(message)] : [];
			return lastDiagnostics;
		},
		completion() {
			return {
				isIncomplete: false,
				items: [
					...OCTAVE_KEYWORDS.map((label) => ({
						label,
						kind: 14,
						detail: OCTAVE_HOVER[label] || 'Octave keyword'
					})),
					...OCTAVE_BUILTINS.map((label) => ({
						label,
						kind: 3,
						detail: OCTAVE_HOVER[label] || 'Octave built-in'
					}))
				]
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = OCTAVE_HOVER[word];
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
			const functionPattern =
				/^\s*function(?:\s+(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s*=\s*)?\s*([A-Za-z_][A-Za-z0-9_]*)/gmu;
			for (const match of document.text.matchAll(functionPattern)) {
				const name = match[1];
				const nameOffset = (match.index || 0) + match[0].lastIndexOf(name);
				symbols.push(symbol(document.text, name, nameOffset, name.length));
			}
			const classPattern = /^\s*classdef\s+([A-Za-z_][A-Za-z0-9_]*)/gmu;
			for (const match of document.text.matchAll(classPattern)) {
				const name = match[1];
				const nameOffset = (match.index || 0) + match[0].lastIndexOf(name);
				symbols.push({
					...symbol(document.text, name, nameOffset, name.length),
					kind: 5
				});
			}
			return symbols;
		}
	};
}
