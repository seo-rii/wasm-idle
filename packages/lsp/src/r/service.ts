import { ChannelType, WebR } from 'webr';
import {
	positionAt,
	type LspDiagnostic,
	type LspDocument,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';

export interface RWorkerOptions {
	baseUrl: string;
}

export interface RSyntaxDiagnostic {
	message: string;
	lineNumber?: number;
	columnNumber?: number;
}

export interface RSyntaxParser {
	parse(code: string): Promise<RSyntaxDiagnostic[]>;
	dispose?: () => void | Promise<void>;
}

export type LoadRSyntaxParser = (options: RWorkerOptions) => Promise<RSyntaxParser>;

const R_KEYWORDS = [
	'break',
	'else',
	'FALSE',
	'for',
	'function',
	'if',
	'Inf',
	'NA',
	'NaN',
	'next',
	'NULL',
	'repeat',
	'TRUE',
	'while'
] as const;

const R_BASE_FUNCTIONS = [
	'c',
	'cat',
	'data.frame',
	'factor',
	'length',
	'library',
	'list',
	'lm',
	'mean',
	'plot',
	'print',
	'readLines',
	'rep',
	'sapply',
	'seq',
	'source',
	'str',
	'sum',
	'typeof',
	'writeLines'
] as const;

const R_HOVER: Record<string, string> = {
	function: 'Defines an R function.',
	if: 'Runs a branch when a condition is true.',
	for: 'Iterates over a vector or sequence.',
	while: 'Repeats while a condition remains true.',
	TRUE: 'Logical true value.',
	FALSE: 'Logical false value.',
	NULL: 'The null object.',
	NA: 'Missing value marker.',
	c: 'Combines values into a vector.',
	'data.frame': 'Creates a tabular data frame.',
	library: 'Loads an installed package.',
	print: 'Prints an object.',
	readLines: 'Reads text lines from a connection.',
	writeLines: 'Writes text lines to a connection.'
};

async function loadWebRParser(options: RWorkerOptions): Promise<RSyntaxParser> {
	if (!options.baseUrl) {
		throw new Error('R language server requires a WebR baseUrl');
	}
	const webR = new WebR({
		baseUrl: options.baseUrl,
		serviceWorkerUrl: options.baseUrl,
		channelType: ChannelType.PostMessage,
		interactive: false,
		REnv: {
			R_HOME: '/usr/lib/R',
			R_ENABLE_JIT: '0'
		}
	});
	await webR.init();
	return {
		async parse(code) {
			try {
				await webR.evalRVoid(`parse(text = ${JSON.stringify(code)})`, {
					captureStreams: true,
					captureConditions: true,
					captureGraphics: false
				});
				return [];
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const location = message.match(/:(\d+):(\d+):/u);
				return [
					{
						lineNumber: Number(location?.[1] || 1),
						columnNumber: Number(location?.[2] || 1),
						message: message || 'R parse error'
					}
				];
			}
		},
		dispose() {
			return webR.close();
		}
	};
}

const diagnosticFor = (diagnostic: RSyntaxDiagnostic): LspDiagnostic => {
	const line = Math.max(0, Number(diagnostic.lineNumber || 1) - 1);
	const character = Math.max(0, Number(diagnostic.columnNumber || 1) - 1);
	return {
		range: {
			start: { line, character },
			end: { line, character: character + 1 }
		},
		severity: 1,
		source: 'r',
		message: diagnostic.message
	};
};

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	return (
		(line.slice(0, character).match(/[A-Za-z.][A-Za-z0-9._]*$/u)?.[0] || '') +
		(line.slice(character).match(/^[A-Za-z0-9._]*/u)?.[0] || '')
	);
};

export function createRWorkerService(
	loadParser: LoadRSyntaxParser = loadWebRParser
): WorkerLanguageService {
	let parser: RSyntaxParser | null = null;
	let lastKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];

	return {
		name: 'wasm-idle-r-lsp',
		diagnosticDelay: 500,
		capabilities: {
			completionProvider: { triggerCharacters: ['.', ':'] },
			hoverProvider: true,
			documentSymbolProvider: true
		},
		async initialize(options, context) {
			const config = (options || {}) as RWorkerOptions;
			context.reportProgress('load-r-runtime');
			parser = await loadParser(config);
		},
		async diagnostics(document: LspDocument, context) {
			if (!parser || !document.text.trim()) return [];
			const key = `${document.uri}\n${document.text}`;
			if (key === lastKey) return lastDiagnostics;
			context.reportProgress('r-diagnostics');
			lastKey = key;
			lastDiagnostics = (await parser.parse(document.text)).map(diagnosticFor);
			return lastDiagnostics;
		},
		completion() {
			return {
				isIncomplete: false,
				items: [
					...R_KEYWORDS.map((label) => ({ label, kind: 14, detail: 'R keyword' })),
					...R_BASE_FUNCTIONS.map((label) => ({
						label,
						kind: 3,
						detail: R_HOVER[label] || 'R base function'
					}))
				]
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = R_HOVER[word];
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
			const pattern = /^\s*([A-Za-z.][A-Za-z0-9._]*)\s*(?:<-|=)\s*function\s*\(/gmu;
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
						end: { line: start.line, character: start.character + match[1].length }
					}
				});
			}
			return symbols;
		},
		dispose() {
			return parser?.dispose?.();
		}
	};
}
