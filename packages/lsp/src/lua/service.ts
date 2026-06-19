import {
	positionAt,
	type LspDiagnostic,
	type LspDocument,
	type LspDocumentContext,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';

export interface LuaWorkerOptions {
	moduleUrl: string;
}

interface LuaCompilerDiagnostic {
	fileName?: string | null;
	lineNumber?: number;
	columnNumber?: number;
	endColumnNumber?: number;
	severity?: 'error' | 'warning' | 'other';
	message?: string;
}

interface LuaCompilerResult {
	success: boolean;
	artifact?: unknown;
	diagnostics?: LuaCompilerDiagnostic[];
	stdout?: string;
	stderr?: string;
}

interface LuaCompiler {
	compile(request: { code: string; fileName: string; log: boolean }): Promise<LuaCompilerResult>;
}

type LoadLuaCompiler = (moduleUrl: string) => Promise<LuaCompiler>;

const LUA_KEYWORDS = [
	'and',
	'break',
	'do',
	'else',
	'elseif',
	'end',
	'false',
	'for',
	'function',
	'goto',
	'if',
	'in',
	'local',
	'nil',
	'not',
	'or',
	'repeat',
	'return',
	'then',
	'true',
	'until',
	'while'
] as const;

const LUA_GLOBALS = [
	'assert',
	'collectgarbage',
	'dofile',
	'error',
	'getmetatable',
	'ipairs',
	'load',
	'next',
	'pairs',
	'pcall',
	'print',
	'rawequal',
	'rawget',
	'rawlen',
	'rawset',
	'require',
	'select',
	'setmetatable',
	'tonumber',
	'tostring',
	'type',
	'xpcall',
	'coroutine',
	'debug',
	'io',
	'math',
	'os',
	'package',
	'string',
	'table',
	'utf8'
] as const;

const LUA_HOVER: Record<string, string> = {
	local: 'Declares a block-scoped local variable.',
	function: 'Declares a function.',
	nil: 'The absence of a useful value.',
	pairs: 'Iterates over table key-value pairs.',
	ipairs: 'Iterates over array-like table entries.',
	print: 'Writes values to standard output.',
	require: 'Loads a Lua module.',
	io: 'Standard input and output library.',
	math: 'Mathematical functions and constants.',
	string: 'String manipulation library.',
	table: 'Table manipulation library.'
};

const normalizePath = (value: string) => {
	const normalized = value
		.replaceAll('\\', '/')
		.replace(/^\/workspace\//u, '')
		.replace(/^\/+/u, '');
	return normalized || 'main.lua';
};

const diagnosticSeverity = (severity: LuaCompilerDiagnostic['severity']): 1 | 2 | 3 =>
	severity === 'warning' ? 2 : severity === 'other' ? 3 : 1;

const diagnosticFor = (diagnostic: LuaCompilerDiagnostic): LspDiagnostic => {
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
		source: 'lua',
		message: String(diagnostic.message || 'Lua diagnostic')
	};
};

async function loadLuaCompiler(moduleUrl: string): Promise<LuaCompiler> {
	const module = await import(/* @vite-ignore */ moduleUrl);
	const factory =
		typeof module.createLuaCompiler === 'function'
			? module.createLuaCompiler
			: typeof module.default === 'function'
				? module.default
				: null;
	if (!factory) {
		throw new Error('wasm-lua module must export createLuaCompiler or a default factory');
	}
	return await factory();
}

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	return (
		(line.slice(0, character).match(/[A-Za-z_][A-Za-z0-9_]*$/u)?.[0] || '') +
		(line.slice(character).match(/^[A-Za-z0-9_]*/u)?.[0] || '')
	);
};

export function createLuaWorkerService(
	loadCompiler: LoadLuaCompiler = loadLuaCompiler
): WorkerLanguageService {
	let compiler: LuaCompiler | null = null;
	let lastKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];

	return {
		name: 'wasm-idle-lua-lsp',
		diagnosticDelay: 500,
		capabilities: {
			completionProvider: { triggerCharacters: ['.', ':'] },
			hoverProvider: true
		},
		async initialize(options, context) {
			const config = (options || {}) as LuaWorkerOptions;
			if (!config.moduleUrl) {
				throw new Error('Lua language server requires a wasm-lua moduleUrl');
			}
			context.reportProgress('load-lua-compiler');
			compiler = await loadCompiler(config.moduleUrl);
		},
		async diagnostics(document: LspDocument, context: LspDocumentContext) {
			if (!compiler || !document.text.trim()) return [];
			const fileName = normalizePath(new URL(document.uri).pathname);
			const key = `${fileName}\n${document.text}`;
			if (key === lastKey) return lastDiagnostics;
			context.reportProgress('lua-diagnostics');
			const result = await compiler.compile({
				code: document.text,
				fileName,
				log: false
			});
			lastKey = key;
			lastDiagnostics = (result.diagnostics || []).map(diagnosticFor);
			if (!result.success && !lastDiagnostics.length) {
				lastDiagnostics = [
					{
						range: {
							start: positionAt(document.text, 0),
							end: positionAt(document.text, Math.min(document.text.length, 1))
						},
						severity: 1,
						source: 'lua',
						message: result.stderr || result.stdout || 'Lua compilation failed'
					}
				];
			}
			return lastDiagnostics;
		},
		completion() {
			return {
				isIncomplete: false,
				items: [
					...LUA_KEYWORDS.map((label) => ({ label, kind: 14 })),
					...LUA_GLOBALS.map((label) => ({
						label,
						kind: label.includes('.') ? 9 : 3,
						detail: LUA_HOVER[label] || 'Lua global'
					}))
				]
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = LUA_HOVER[word];
			if (!description) return null;
			return {
				contents: {
					kind: 'markdown',
					value: `\`${word}\`\n\n${description}`
				}
			};
		}
	};
}
