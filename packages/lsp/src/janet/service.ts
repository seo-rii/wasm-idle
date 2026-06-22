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

export interface JanetWorkerOptions {
	baseUrl: string;
	workerUrl: string;
}

export type JanetDiagnosticRunnerRequest =
	StaticWorkerDiagnosticRequest<JanetWorkerOptions>;

export interface JanetDiagnosticRunnerResult {
	error?: string;
	output?: string;
}

export type RunJanetDiagnostics = StaticWorkerDiagnosticRunner<
	JanetWorkerOptions,
	JanetDiagnosticRunnerResult
>;

const JANET_KEYWORDS = [
	'break',
	'def',
	'defglobal',
	'defmacro',
	'defn',
	'do',
	'each',
	'eachk',
	'fn',
	'for',
	'if',
	'import',
	'let',
	'loop',
	'macex',
	'quote',
	'try',
	'var',
	'when',
	'while'
] as const;

const JANET_BUILTINS = [
	'array',
	'buffer',
	'error',
	'file/read',
	'getline',
	'length',
	'map',
	'print',
	'printf',
	'reduce',
	'scan-number',
	'string/trim',
	'table'
] as const;

const JANET_HOVER: Record<string, string> = {
	def: 'Binds a Janet symbol.',
	defn: 'Defines a named Janet function.',
	fn: 'Creates an anonymous function.',
	import: 'Loads a Janet module.',
	let: 'Creates lexical bindings.',
	var: 'Creates mutable lexical bindings.',
	getline: 'Reads a line from standard input.',
	print: 'Writes values followed by a newline.',
	'file/read': 'Reads a file or stream into memory.'
};

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	return (
		(line.slice(0, character).match(/[A-Za-z_*+\-!?/<>=][A-Za-z0-9_*+\-!?/<>=]*$/u)?.[0] ||
			'') +
		(line.slice(character).match(/^[A-Za-z0-9_*+\-!?/<>=]*/u)?.[0] || '')
	);
};

const diagnosticFromMessage = (message: string): LspDiagnostic => {
	const location =
		message.match(/(?:[\w./-]+\.janet):(\d+):(\d+)/iu) ||
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
		source: 'janet',
		message: message || 'Janet diagnostic'
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

export function createJanetWorkerService(
	runDiagnostics?: RunJanetDiagnostics
): WorkerLanguageService {
	const workerDiagnostics = createStaticWorkerDiagnostics<
		JanetWorkerOptions,
		JanetDiagnosticRunnerResult
	>({
		languageName: 'Janet',
		loadProgressStage: 'load-janet-runtime',
		diagnosticsProgressStage: 'janet-diagnostics',
		defaultActivePath: 'main.janet',
		timeoutMessage: 'Janet diagnostics timed out',
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
		name: 'wasm-idle-janet-lsp',
		diagnosticDelay: 500,
		capabilities: {
			completionProvider: { triggerCharacters: ['/', ':'] },
			hoverProvider: true,
			documentSymbolProvider: true
		},
		initialize: workerDiagnostics.initialize,
		diagnostics: workerDiagnostics.diagnostics,
		completion() {
			return {
				isIncomplete: false,
				items: [
					...JANET_KEYWORDS.map((label) => ({
						label,
						kind: 14,
						detail: JANET_HOVER[label] || 'Janet keyword'
					})),
					...JANET_BUILTINS.map((label) => ({
						label,
						kind: 3,
						detail: JANET_HOVER[label] || 'Janet built-in'
					}))
				]
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = JANET_HOVER[word];
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
			const pattern = /^\s*\((?:defn?|defmacro)\s+([A-Za-z_*+\-!?/<>=][A-Za-z0-9_*+\-!?/<>=]*)/gmu;
			for (const match of document.text.matchAll(pattern)) {
				symbols.push(symbol(document.text, match[1], match.index || 0, match[0].length));
			}
			return symbols;
		}
	};
}
