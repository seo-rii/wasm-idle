import {
	type LspDiagnostic,
	type LspDocument,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';

export interface FortranWorkerOptions {
	analyzerUrl?: string;
}

export interface FortranAnalyzerDiagnostic {
	message: string;
	lineNumber?: number;
	columnNumber?: number;
	severity?: 'error' | 'warning' | 'info';
}

export interface FortranAnalyzer {
	analyze(code: string, fileName: string): Promise<FortranAnalyzerDiagnostic[]> | FortranAnalyzerDiagnostic[];
	dispose?: () => void | Promise<void>;
}

export type LoadFortranAnalyzer = (options: FortranWorkerOptions) => Promise<FortranAnalyzer>;

const FORTRAN_KEYWORDS = [
	'program',
	'module',
	'subroutine',
	'function',
	'implicit none',
	'integer',
	'real',
	'complex',
	'logical',
	'character',
	'parameter',
	'allocatable',
	'do',
	'if',
	'then',
	'else',
	'select case',
	'contains',
	'end',
	'use',
	'call',
	'print',
	'read',
	'write'
] as const;

const FORTRAN_HOVER: Record<string, string> = {
	program: 'Defines a main Fortran program unit.',
	module: 'Defines a module containing declarations and procedures.',
	subroutine: 'Defines a procedure called with CALL.',
	function: 'Defines a procedure that returns a value.',
	'implicit none': 'Requires explicit declarations for identifiers.',
	contains: 'Separates a program unit from its internal procedures.',
	allocatable: 'Marks an object whose storage can be allocated dynamically.'
};

async function loadExternalAnalyzer(options: FortranWorkerOptions): Promise<FortranAnalyzer> {
	if (!options.analyzerUrl) {
		throw new Error('Fortran language server requires analyzerUrl');
	}
	const module = await import(/* @vite-ignore */ options.analyzerUrl);
	const factory =
		typeof module.createFortranAnalyzer === 'function'
			? module.createFortranAnalyzer
			: typeof module.default === 'function'
				? module.default
				: null;
	if (!factory) {
		throw new Error('Fortran analyzer module must export createFortranAnalyzer or a default factory');
	}
	return await factory();
}

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	return (
		(line.slice(0, character).match(/[A-Za-z_][A-Za-z0-9_]*$/u)?.[0] || '') +
		(line.slice(character).match(/^[A-Za-z0-9_]*/u)?.[0] || '')
	).toLowerCase();
};

const diagnosticFor = (diagnostic: FortranAnalyzerDiagnostic): LspDiagnostic => {
	const line = Math.max(0, Number(diagnostic.lineNumber || 1) - 1);
	const character = Math.max(0, Number(diagnostic.columnNumber || 1) - 1);
	return {
		range: {
			start: { line, character },
			end: { line, character: character + 1 }
		},
		severity: diagnostic.severity === 'warning' ? 2 : diagnostic.severity === 'info' ? 3 : 1,
		source: 'fortran',
		message: diagnostic.message
	};
};

export function createFortranWorkerService(
	loadAnalyzer: LoadFortranAnalyzer = loadExternalAnalyzer
): WorkerLanguageService {
	let analyzer: FortranAnalyzer | null = null;
	let lastKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];

	return {
		name: 'wasm-idle-fortran-lsp',
		diagnosticDelay: 250,
		capabilities: {
			completionProvider: { triggerCharacters: [' ', ':', '%'] },
			hoverProvider: true,
			documentSymbolProvider: true
		},
		async initialize(options, context) {
			const config = (options || {}) as FortranWorkerOptions;
			context.reportProgress('load-fortran-analyzer');
			analyzer = await loadAnalyzer(config);
		},
		async diagnostics(document) {
			if (!analyzer) return [];
			const key = `${document.uri}\n${document.text}`;
			if (key === lastKey) return lastDiagnostics;
			lastKey = key;
			const diagnostics = await analyzer.analyze(
				document.text,
				document.uri.split('/').pop() || 'main.f90'
			);
			lastDiagnostics = diagnostics.map(diagnosticFor);
			return lastDiagnostics;
		},
		completion() {
			return {
				isIncomplete: false,
				items: FORTRAN_KEYWORDS.map((label) => ({
					label,
					kind: 14,
					detail: FORTRAN_HOVER[label] || 'Fortran keyword'
				}))
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = FORTRAN_HOVER[word];
			if (!description) return null;
			return {
				contents: {
					kind: 'markdown',
					value: `\`${word}\`\n\n${description}`
				}
			};
		},
		documentSymbols(document: LspDocument) {
			const symbols = [];
			const pattern = /^\s*(program|module|subroutine|function)\s+([A-Za-z_][A-Za-z0-9_]*)/gimu;
			for (const match of document.text.matchAll(pattern)) {
				const offset = match.index || 0;
				const before = document.text.slice(0, offset);
				const line = before.split('\n').length - 1;
				const character = offset - before.lastIndexOf('\n') - 1;
				symbols.push({
					name: match[2],
					kind: match[1].toLowerCase() === 'module' ? 2 : 12,
					range: {
						start: { line, character },
						end: { line, character: character + match[0].length }
					},
					selectionRange: {
						start: { line, character: character + match[0].indexOf(match[2]) },
						end: { line, character: character + match[0].indexOf(match[2]) + match[2].length }
					}
				});
			}
			return symbols;
		},
		async dispose() {
			await analyzer?.dispose?.();
			analyzer = null;
		}
	};
}
