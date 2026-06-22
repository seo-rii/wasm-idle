import {
	positionAt,
	type LspDiagnostic,
	type LspDocument,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';
import { runRuntimeWorkerDiagnostics } from '../runtime-worker.js';

export type BeamLanguageServerLanguage = 'elixir' | 'erlang';

export interface BeamWorkerOptions {
	language: BeamLanguageServerLanguage;
	bundleUrl: string;
	workerUrl: string;
}

export interface BeamDiagnosticRunnerRequest {
	language: BeamLanguageServerLanguage;
	bundleUrl: string;
	workerUrl: string;
	code: string;
	activePath: string;
}

export interface BeamDiagnosticRunnerResult {
	error?: string;
	output?: string;
}

export type RunBeamDiagnostics = (
	request: BeamDiagnosticRunnerRequest
) => Promise<BeamDiagnosticRunnerResult>;

const ELIXIR_KEYWORDS = [
	'defmodule',
	'def',
	'defp',
	'defmacro',
	'defstruct',
	'alias',
	'import',
	'require',
	'use',
	'case',
	'cond',
	'fn',
	'for',
	'if',
	'unless',
	'with',
	'try',
	'rescue',
	'after',
	'do',
	'end'
] as const;

const ERLANG_KEYWORDS = [
	'-module',
	'-export',
	'-import',
	'-record',
	'case',
	'catch',
	'end',
	'fun',
	'if',
	'of',
	'receive',
	'try',
	'when'
] as const;

const ELIXIR_HOVER: Record<string, string> = {
	defmodule: 'Defines an Elixir module.',
	def: 'Defines a public Elixir function.',
	defp: 'Defines a private Elixir function.',
	alias: 'Creates a shorter module alias.',
	import: 'Imports functions or macros from another module.',
	require: 'Loads macros from another module before use.'
};

const ERLANG_HOVER: Record<string, string> = {
	'-module': 'Declares the Erlang module name.',
	'-export': 'Exports Erlang functions by name and arity.',
	case: 'Branches by pattern matching an expression.',
	fun: 'Creates an anonymous Erlang function.',
	receive: 'Waits for a message that matches one of the clauses.'
};

const defaultRunDiagnostics: RunBeamDiagnostics = (request) =>
	runRuntimeWorkerDiagnostics({
		workerUrl: request.workerUrl,
		timeoutMessage: `${request.language === 'erlang' ? 'Erlang' : 'Elixir'} diagnostics timed out`,
		message: {
			bundleUrl: request.bundleUrl,
			code: request.code,
			activePath: request.activePath,
			language: request.language === 'erlang' ? 'ERLANG' : 'ELIXIR',
			diagnose: true,
			log: false
		}
	});

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	const left = line.slice(0, character).match(/-?[A-Za-z_][A-Za-z0-9_?!]*$/u)?.[0] || '';
	const right = line.slice(character).match(/^[A-Za-z0-9_?!]*/u)?.[0] || '';
	return left + right;
};

const diagnosticFromMessage = (
	language: BeamLanguageServerLanguage,
	text: string,
	message: string
): LspDiagnostic => {
	const location =
		message.match(/(?:nofile|[\w./-]+\.(?:exs?|erl|hrl)):(\d+):(?:(\d+):)?/iu) ||
		message.match(/\bline\s+(\d+)(?:[:,]\s*(\d+))?/iu);
	const line = Math.max(0, Number(location?.[1] || 1) - 1);
	const character = Math.max(0, Number(location?.[2] || 1) - 1);
	return {
		range: {
			start: { line, character },
			end: { line, character: character + 1 }
		},
		severity: 1,
		source: language,
		message:
			message ||
			`${language === 'erlang' ? 'Erlang' : 'Elixir'} runtime reported a diagnostic`
	};
};

const symbol = (text: string, name: string, kind: number, offset: number, length: number) => {
	const start = positionAt(text, offset);
	const end = positionAt(text, offset + length);
	return {
		name,
		kind,
		range: { start, end },
		selectionRange: { start, end }
	};
};

function elixirSymbols(document: LspDocument) {
	const symbols = [];
	const modulePattern = /^\s*defmodule\s+([A-Z][\w.]*)/gmu;
	for (const match of document.text.matchAll(modulePattern)) {
		symbols.push(symbol(document.text, match[1], 2, match.index || 0, match[0].length));
	}
	const functionPattern = /^\s*defp?\s+([a-z_][\w?!]*)/gmu;
	for (const match of document.text.matchAll(functionPattern)) {
		symbols.push(symbol(document.text, match[1], 12, match.index || 0, match[0].length));
	}
	return symbols;
}

function erlangSymbols(document: LspDocument) {
	const symbols = [];
	const moduleMatch = /^\s*-module\(\s*([a-z][A-Za-z0-9_@]*)\s*\)\s*\./mu.exec(document.text);
	if (moduleMatch) {
		symbols.push(
			symbol(document.text, moduleMatch[1], 2, moduleMatch.index || 0, moduleMatch[0].length)
		);
	}
	const functionPattern = /^([a-z][A-Za-z0-9_@]*)\s*\([^.\n]*\)\s*(?:when\s+[^-\n]+)?->/gmu;
	for (const match of document.text.matchAll(functionPattern)) {
		symbols.push(symbol(document.text, match[1], 12, match.index || 0, match[0].length));
	}
	return symbols;
}

export function createBeamWorkerService(
	language: BeamLanguageServerLanguage,
	runDiagnostics: RunBeamDiagnostics = defaultRunDiagnostics
): WorkerLanguageService {
	let config: BeamWorkerOptions | null = null;
	let lastKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];
	const label = language === 'erlang' ? 'Erlang' : 'Elixir';
	const keywords = language === 'erlang' ? ERLANG_KEYWORDS : ELIXIR_KEYWORDS;
	const hoverText = language === 'erlang' ? ERLANG_HOVER : ELIXIR_HOVER;

	return {
		name: `wasm-idle-${language}-lsp`,
		diagnosticDelay: 500,
		capabilities: {
			completionProvider: { triggerCharacters: ['.', ':', '-'] },
			hoverProvider: true,
			documentSymbolProvider: true
		},
		initialize(options, context) {
			const nextConfig = (options || {}) as BeamWorkerOptions;
			if (!nextConfig.bundleUrl || !nextConfig.workerUrl) {
				throw new Error(`${label} language server requires bundleUrl and workerUrl`);
			}
			config = {
				...nextConfig,
				language
			};
			context.reportProgress(`load-${language}-runtime`);
		},
		async diagnostics(document, context) {
			if (!config || !document.text.trim()) return [];
			const activePath =
				document.uri.split('/').pop() || (language === 'erlang' ? 'main.erl' : 'main.exs');
			const key = `${config.bundleUrl}\n${config.workerUrl}\n${activePath}\n${document.text}`;
			if (key === lastKey) return lastDiagnostics;
			context.reportProgress(`${language}-diagnostics`);
			lastKey = key;
			const result = await runDiagnostics({
				language,
				bundleUrl: config.bundleUrl,
				workerUrl: config.workerUrl,
				code: document.text,
				activePath
			});
			const message = (result.error || result.output || '').trim();
			lastDiagnostics = message
				? [diagnosticFromMessage(language, document.text, message)]
				: [];
			return lastDiagnostics;
		},
		completion() {
			return {
				isIncomplete: false,
				items: keywords.map((keyword) => ({
					label: keyword,
					kind: keyword.startsWith('-') ? 14 : 3,
					detail: hoverText[keyword] || `${label} keyword`
				}))
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = hoverText[word];
			if (!description) return null;
			return {
				contents: {
					kind: 'markdown',
					value: `\`${word}\`\n\n${description}`
				}
			};
		},
		documentSymbols(document) {
			return language === 'erlang' ? erlangSymbols(document) : elixirSymbols(document);
		}
	};
}
