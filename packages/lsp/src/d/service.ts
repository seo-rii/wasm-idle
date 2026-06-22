import {
	positionAt,
	uriToPath,
	type LspDiagnostic,
	type LspDocument,
	type LspDocumentContext,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';

export interface DWorkerOptions {
	moduleUrl: string;
	compileArgs?: string[];
}

interface DCompilerDiagnostic {
	fileName?: string | null;
	lineNumber?: number;
	columnNumber?: number;
	endColumnNumber?: number;
	severity?: 'error' | 'warning' | 'other';
	message?: string;
}

interface DCompilerResult {
	success: boolean;
	diagnostics?: DCompilerDiagnostic[];
	stdout?: string;
	stderr?: string;
}

interface DCompilerHost {
	compile(request: {
		code: string;
		fileName: string;
		target: 'wasm32-wasi';
		compileArgs: string[];
		log: boolean;
		onProgress?: (progress: {
			stage?: string;
			completed?: number;
			total?: number;
			percent?: number;
		}) => void;
	}): Promise<DCompilerResult>;
}

export type LoadDCompilerHost = (
	options: DWorkerOptions,
	context: LspDocumentContext
) => Promise<DCompilerHost>;

const D_KEYWORDS = [
	'abstract',
	'alias',
	'align',
	'asm',
	'assert',
	'auto',
	'bool',
	'break',
	'case',
	'cast',
	'catch',
	'class',
	'const',
	'continue',
	'debug',
	'default',
	'delegate',
	'deprecated',
	'do',
	'double',
	'else',
	'enum',
	'extern',
	'false',
	'final',
	'finally',
	'for',
	'foreach',
	'function',
	'if',
	'import',
	'in',
	'interface',
	'invariant',
	'is',
	'long',
	'mixin',
	'module',
	'new',
	'nothrow',
	'null',
	'override',
	'private',
	'protected',
	'public',
	'pure',
	'return',
	'scope',
	'shared',
	'static',
	'struct',
	'super',
	'switch',
	'synchronized',
	'template',
	'throw',
	'true',
	'try',
	'typeof',
	'union',
	'unittest',
	'version',
	'void',
	'while',
	'with'
] as const;

const D_BUILTINS = [
	'__FILE__',
	'__LINE__',
	'assert',
	'import',
	'main',
	'readln',
	'stderr',
	'stdin',
	'stdout',
	'write',
	'writeln'
] as const;

const D_HOVER: Record<string, string> = {
	class: 'Declares a reference type.',
	enum: 'Declares an enum or manifest constant.',
	function: 'Declares a function type or function literal.',
	import: 'Imports a D module.',
	module: 'Declares the module name for a source file.',
	struct: 'Declares a value type.',
	template: 'Declares a compile-time template.',
	unittest: 'Declares a unit test block.',
	void: 'The absence of a value.',
	readln: 'Reads a line from standard input.',
	writeln: 'Writes values followed by a newline.'
};

const severityFor = (severity: DCompilerDiagnostic['severity']): 1 | 2 | 3 =>
	severity === 'warning' ? 2 : severity === 'other' ? 3 : 1;

const diagnosticFor = (diagnostic: DCompilerDiagnostic): LspDiagnostic => {
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
		severity: severityFor(diagnostic.severity),
		source: 'd',
		message: String(diagnostic.message || 'D diagnostic')
	};
};

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	return (
		(line.slice(0, character).match(/[A-Za-z_][A-Za-z0-9_]*$/u)?.[0] || '') +
		(line.slice(character).match(/^[A-Za-z0-9_]*/u)?.[0] || '')
	);
};

async function defaultLoadDCompilerHost(options: DWorkerOptions): Promise<DCompilerHost> {
	const module = await import(/* @vite-ignore */ options.moduleUrl);
	const factory =
		typeof module.createDCompiler === 'function'
			? module.createDCompiler
			: typeof module.default === 'function'
				? module.default
				: null;
	if (!factory) {
		throw new Error('wasm-d module must export createDCompiler or a default factory');
	}
	const runtimeBaseUrl = new URL('runtime/', options.moduleUrl).href;
	return await factory({ runtimeBaseUrl });
}

const activePathFor = (document: LspDocument) =>
	uriToPath(document.uri).split('/').filter(Boolean).pop() || 'main.d';

export function createDWorkerService(
	loadDCompilerHost: LoadDCompilerHost = defaultLoadDCompilerHost
): WorkerLanguageService {
	let compiler: DCompilerHost | null = null;
	let config: DWorkerOptions | null = null;
	let lastKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];

	return {
		name: 'wasm-idle-d-lsp',
		diagnosticDelay: 900,
		capabilities: {
			completionProvider: { triggerCharacters: ['.'] },
			hoverProvider: true,
			documentSymbolProvider: true
		},
		async initialize(options, context) {
			const nextConfig = (options || {}) as DWorkerOptions;
			if (!nextConfig.moduleUrl) {
				throw new Error('D language server requires a wasm-d moduleUrl');
			}
			config = {
				moduleUrl: nextConfig.moduleUrl,
				compileArgs: nextConfig.compileArgs || []
			};
			context.reportProgress('load-d-compiler');
			compiler = await loadDCompilerHost(config, context);
		},
		async diagnostics(document, context) {
			if (!compiler || !config || !document.text.trim()) return [];
			const activePath = activePathFor(document);
			const compileArgs = config.compileArgs || [];
			const key = `${config.moduleUrl}\n${activePath}\n${compileArgs.join('\0')}\n${document.text}`;
			if (key === lastKey) return lastDiagnostics;
			context.reportProgress('d-diagnostics');
			const result = await compiler.compile({
				code: document.text,
				fileName: activePath,
				target: 'wasm32-wasi',
				compileArgs,
				log: false,
				onProgress(progress) {
					context.reportProgress(
						progress.stage || 'd-diagnostics',
						progress.completed,
						progress.total
					);
				}
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
						source: 'd',
						message: result.stderr || result.stdout || 'D compilation failed'
					}
				];
			}
			return lastDiagnostics;
		},
		completion() {
			return {
				isIncomplete: false,
				items: [
					...D_KEYWORDS.map((label) => ({
						label,
						kind: 14,
						detail: D_HOVER[label] || 'D keyword'
					})),
					...D_BUILTINS.map((label) => ({
						label,
						kind: 3,
						detail: D_HOVER[label] || 'D symbol'
					}))
				]
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = D_HOVER[word];
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
				/^\s*(?:(?:public|private|protected|static|extern|export|final|override|nothrow|pure|@safe|@trusted|@nogc)\s+)*(?:(class|struct|interface|enum|union)\s+([A-Za-z_][A-Za-z0-9_]*)|(?:[A-Za-z_][A-Za-z0-9_.!\[\]]*\s+)+([A-Za-z_][A-Za-z0-9_]*)\s*\()/gmu;
			for (const match of document.text.matchAll(pattern)) {
				const kind = match[1] ? 5 : 12;
				const name = match[2] || match[3];
				const nameOffset = (match.index || 0) + match[0].lastIndexOf(name);
				const start = positionAt(document.text, nameOffset);
				const end = positionAt(document.text, nameOffset + name.length);
				symbols.push({
					name,
					kind,
					range: { start, end },
					selectionRange: { start, end }
				});
			}
			return symbols;
		}
	};
}
