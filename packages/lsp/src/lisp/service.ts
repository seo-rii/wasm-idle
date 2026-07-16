import {
	positionAt,
	type LspDiagnostic,
	type LspDocument,
	type LspDocumentContext,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';

export interface LispWorkerOptions {
	moduleUrl: string;
}

interface LispCompilerDiagnostic {
	fileName?: string | null;
	lineNumber?: number;
	columnNumber?: number;
	endColumnNumber?: number;
	severity?: 'error' | 'warning' | 'other';
	message?: string;
}

interface LispCompilerResult {
	success: boolean;
	artifact?: unknown;
	diagnostics?: LispCompilerDiagnostic[];
	stdout?: string;
	stderr?: string;
}

interface LispCompiler {
	compile(request: {
		code: string;
		fileName: string;
		files: { path: string; content: string }[];
		log: boolean;
	}): Promise<LispCompilerResult>;
}

export type LoadLispCompiler = (moduleUrl: string) => Promise<LispCompiler>;

const LISP_KEYWORDS = [
	'and',
	'begin',
	'case',
	'cond',
	'define',
	'define-library',
	'define-syntax',
	'delay',
	'do',
	'else',
	'if',
	'import',
	'lambda',
	'let',
	'let*',
	'letrec',
	'or',
	'quote',
	'set!',
	'unless',
	'when'
] as const;

const LISP_BUILTINS = [
	'append',
	'apply',
	'car',
	'cdr',
	'cons',
	'display',
	'for-each',
	'length',
	'list',
	'map',
	'newline',
	'read-char',
	'read-line',
	'string->number'
] as const;

const LISP_HOVER: Record<string, string> = {
	define: 'Binds a Scheme name.',
	lambda: 'Creates an anonymous procedure.',
	let: 'Creates local bindings.',
	'let*': 'Creates sequential local bindings.',
	letrec: 'Creates recursive local bindings.',
	cond: 'Branches through ordered tests.',
	display: 'Writes a value to the current output port.',
	newline: 'Writes a line break.',
	'read-line': 'Reads one line from input.',
	'string->number': 'Parses a string as a number.'
};

const normalizePath = (value: string) => {
	const normalized = value
		.replaceAll('\\', '/')
		.replace(/^\/workspace\//u, '')
		.replace(/^\/+/u, '');
	return normalized || 'main.scm';
};

const diagnosticSeverity = (severity: LispCompilerDiagnostic['severity']): 1 | 2 | 3 =>
	severity === 'warning' ? 2 : severity === 'other' ? 3 : 1;

const diagnosticFor = (diagnostic: LispCompilerDiagnostic): LspDiagnostic => {
	const line = Math.max(0, Number(diagnostic.lineNumber || 1) - 1);
	const character = Math.max(0, Number(diagnostic.columnNumber || 1) - 1);
	const endCharacter = Math.max(
		character + 1,
		Number(diagnostic.endColumnNumber || diagnostic.columnNumber || character + 2) - 1
	);
	return {
		range: {
			start: { line, character },
			end: { line, character: endCharacter }
		},
		severity: diagnosticSeverity(diagnostic.severity),
		source: 'lisp',
		message: String(diagnostic.message || 'Scheme diagnostic')
	};
};

async function loadLispCompiler(moduleUrl: string): Promise<LispCompiler> {
	const module = await import(/* @vite-ignore */ moduleUrl);
	const factory =
		typeof module.createLispCompiler === 'function'
			? module.createLispCompiler
			: typeof module.default === 'function'
				? module.default
				: null;
	if (!factory) {
		throw new Error('wasm-lisp module must export createLispCompiler or a default factory');
	}
	return await factory();
}

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	return (
		(line.slice(0, character).match(/[A-Za-z_*+\-!?/<>=][A-Za-z0-9_*+\-!?/<>=]*$/u)?.[0] ||
			'') + (line.slice(character).match(/^[A-Za-z0-9_*+\-!?/<>=]*/u)?.[0] || '')
	);
};

export function createLispWorkerService(
	loadCompiler: LoadLispCompiler = loadLispCompiler
): WorkerLanguageService {
	let compiler: LispCompiler | null = null;
	let lastKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];

	return {
		name: 'wasm-idle-lisp-lsp',
		diagnosticDelay: 500,
		capabilities: {
			completionProvider: { triggerCharacters: ['(', '-'] },
			hoverProvider: true,
			documentSymbolProvider: true
		},
		async initialize(options, context) {
			const config = (options || {}) as LispWorkerOptions;
			if (!config.moduleUrl) {
				throw new Error('Scheme language server requires a wasm-lisp moduleUrl');
			}
			context.reportProgress('load-lisp-compiler');
			compiler = await loadCompiler(config.moduleUrl);
		},
		async diagnostics(document: LspDocument, context: LspDocumentContext) {
			if (!compiler || !document.text.trim()) return [];
			const fileName = normalizePath(new URL(document.uri).pathname);
			const key = `${fileName}\n${document.text}`;
			if (key === lastKey) return lastDiagnostics;
			context.reportProgress('lisp-diagnostics');
			const result = await compiler.compile({
				code: document.text,
				fileName,
				files: [],
				log: false
			});
			lastKey = key;
			lastDiagnostics = (result.diagnostics || []).map(diagnosticFor);
			if (!lastDiagnostics.length) {
				// Puppy Scheme is permissive about incomplete forms, so retain basic editor feedback.
				const openings: Array<{ character: '(' | '['; offset: number }> = [];
				let blockCommentDepth = 0;
				let blockCommentOffset = -1;
				let inLineComment = false;
				let inString = false;
				let stringOffset = -1;
				let escaped = false;
				let structuralError: { message: string; offset: number } | null = null;
				for (let offset = 0; offset < document.text.length; offset += 1) {
					const character = document.text[offset];
					const next = document.text[offset + 1] || '';
					if (inLineComment) {
						if (character === '\n') inLineComment = false;
						continue;
					}
					if (blockCommentDepth > 0) {
						if (character === '#' && next === '|') {
							blockCommentDepth += 1;
							offset += 1;
						} else if (character === '|' && next === '#') {
							blockCommentDepth -= 1;
							offset += 1;
						}
						continue;
					}
					if (inString) {
						if (escaped) {
							escaped = false;
						} else if (character === '\\') {
							escaped = true;
						} else if (character === '"') {
							inString = false;
						}
						continue;
					}
					if (character === ';') {
						inLineComment = true;
						continue;
					}
					if (character === '#' && next === '|') {
						blockCommentDepth = 1;
						blockCommentOffset = offset;
						offset += 1;
						continue;
					}
					if (character === '#' && next === '\\') {
						offset += 2;
						continue;
					}
					if (character === '"') {
						inString = true;
						stringOffset = offset;
						continue;
					}
					if (character === '(' || character === '[') {
						openings.push({ character, offset });
						continue;
					}
					if (character !== ')' && character !== ']') continue;
					const opening = openings.pop();
					if (
						!opening ||
						(opening.character === '(' && character !== ')') ||
						(opening.character === '[' && character !== ']')
					) {
						structuralError = { message: `Unexpected ${character}`, offset };
						break;
					}
				}
				if (!structuralError && inString) {
					structuralError = { message: 'Unterminated string', offset: stringOffset };
				}
				if (!structuralError && blockCommentDepth > 0) {
					structuralError = {
						message: 'Unterminated block comment',
						offset: blockCommentOffset
					};
				}
				if (!structuralError && openings.length > 0) {
					const opening = openings.at(-1)!;
					structuralError = {
						message: `Unclosed ${opening.character}`,
						offset: opening.offset
					};
				}
				if (structuralError) {
					const start = positionAt(document.text, structuralError.offset);
					const end = positionAt(
						document.text,
						Math.min(document.text.length, structuralError.offset + 1)
					);
					lastDiagnostics = [
						{
							range: { start, end },
							severity: 1,
							source: 'lisp',
							message: structuralError.message
						}
					];
				}
			}
			if (!result.success && !lastDiagnostics.length) {
				lastDiagnostics = [
					{
						range: {
							start: positionAt(document.text, 0),
							end: positionAt(document.text, Math.min(document.text.length, 1))
						},
						severity: 1,
						source: 'lisp',
						message: result.stderr || result.stdout || 'Scheme compilation failed'
					}
				];
			}
			return lastDiagnostics;
		},
		completion() {
			return {
				isIncomplete: false,
				items: [
					...LISP_KEYWORDS.map((label) => ({
						label,
						kind: 14,
						detail: LISP_HOVER[label] || 'Scheme keyword'
					})),
					...LISP_BUILTINS.map((label) => ({
						label,
						kind: 3,
						detail: LISP_HOVER[label] || 'Scheme procedure'
					}))
				]
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = LISP_HOVER[word];
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
			const pattern =
				/^\s*\(define\s+(?:\(\s*)?([A-Za-z_*+\-!?/<>=][A-Za-z0-9_*+\-!?/<>=]*)/gmu;
			for (const match of document.text.matchAll(pattern)) {
				const offset = match.index || 0;
				const start = positionAt(document.text, offset);
				const end = positionAt(document.text, offset + match[0].length);
				symbols.push({
					name: match[1],
					kind: 12,
					range: { start, end },
					selectionRange: { start, end }
				});
			}
			return symbols;
		}
	};
}
