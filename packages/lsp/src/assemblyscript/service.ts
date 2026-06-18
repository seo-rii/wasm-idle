import {
	uriToPath,
	type LspDiagnostic,
	type LspDocument,
	type LspDocumentContext,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';

export interface AssemblyScriptWorkerOptions {
	extraFiles?: Record<string, string>;
}

interface AssemblyScriptCompilerIo {
	stdout?: { write(chunk: Uint8Array | string): void };
	stderr?: { write(chunk: Uint8Array | string): void };
	readFile?: (filePath: string) => string | null;
	writeFile?: (filePath: string, contents: Uint8Array | string) => void;
	listFiles?: (dirPath: string) => string[];
}

interface AssemblyScriptCompiler {
	main(
		args: string[],
		options: AssemblyScriptCompilerIo
	): Promise<{ error?: Error }> | { error?: Error };
}

type LoadAssemblyScriptCompiler = () => Promise<AssemblyScriptCompiler>;

const ASSEMBLYSCRIPT_COMPLETIONS = [
	'i8',
	'i16',
	'i32',
	'i64',
	'isize',
	'u8',
	'u16',
	'u32',
	'u64',
	'usize',
	'f32',
	'f64',
	'bool',
	'void',
	'string',
	'Array',
	'StaticArray',
	'ArrayBuffer',
	'Uint8Array',
	'Int32Array',
	'Map',
	'Set',
	'Math',
	'assert',
	'changetype',
	'idof',
	'isDefined',
	'isFloat',
	'isInteger',
	'isNullable',
	'isReference',
	'memory',
	'unchecked',
	'abort',
	'trace',
	'class',
	'interface',
	'namespace',
	'enum',
	'function',
	'export',
	'import',
	'extends',
	'implements',
	'constructor',
	'public',
	'private',
	'protected',
	'static',
	'readonly',
	'let',
	'const',
	'var',
	'if',
	'else',
	'for',
	'while',
	'do',
	'switch',
	'case',
	'break',
	'continue',
	'return',
	'new',
	'null',
	'true',
	'false'
] as const;

const ASSEMBLYSCRIPT_HOVER: Record<string, string> = {
	i32: 'Signed 32-bit integer.',
	u32: 'Unsigned 32-bit integer.',
	i64: 'Signed 64-bit integer.',
	u64: 'Unsigned 64-bit integer.',
	f32: '32-bit IEEE-754 floating-point value.',
	f64: '64-bit IEEE-754 floating-point value.',
	isize: 'Signed pointer-sized integer.',
	usize: 'Unsigned pointer-sized integer.',
	changetype: 'Reinterprets a value as another compile-time type without conversion.',
	idof: 'Returns the runtime type id of a compile-time type.',
	unchecked: 'Disables bounds checks for the wrapped expression.',
	StaticArray: 'Fixed-length managed array with inline storage.'
};

const normalizeFileName = (value: string) =>
	value.replaceAll('\\', '/').replace(/^\/workspace\//u, '').replace(/^\/+/u, '');

const createStringSink = () => {
	let value = '';
	return {
		write(chunk: Uint8Array | string) {
			value += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
		},
		toString() {
			return value;
		}
	};
};

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	return (
		(line.slice(0, character).match(/[A-Za-z0-9_$]+$/u)?.[0] || '') +
		(line.slice(character).match(/^[A-Za-z0-9_$]+/u)?.[0] || '')
	);
};

function parseAssemblyScriptDiagnostics(message: string): LspDiagnostic[] {
	const diagnostics: LspDiagnostic[] = [];
	const pattern =
		/(ERROR|WARNING)\s+(TS\d+):\s*([^\n]+)[\s\S]*?└─ in ([^(]+)\((\d+),(\d+)\)/gu;
	for (const match of message.matchAll(pattern)) {
		const line = Math.max(0, Number(match[4]) - 1);
		const character = Math.max(0, Number(match[5]) - 1);
		diagnostics.push({
			range: {
				start: { line, character },
				end: { line, character: character + 1 }
			},
			severity: match[1] === 'WARNING' ? 2 : 1,
			code: match[2],
			source: 'assemblyscript',
			message: match[3].trim()
		});
	}
	return diagnostics;
}

async function importAssemblyScriptCompiler(): Promise<AssemblyScriptCompiler> {
	const workerGlobal = globalThis as Record<string, unknown>;
	const hadProcess = Object.prototype.hasOwnProperty.call(workerGlobal, 'process');
	const previousProcess = workerGlobal.process;
	if (!Reflect.deleteProperty(workerGlobal, 'process')) workerGlobal.process = undefined;
	try {
		return (await import('assemblyscript/asc')) as AssemblyScriptCompiler;
	} finally {
		if (hadProcess) workerGlobal.process = previousProcess;
		else Reflect.deleteProperty(workerGlobal, 'process');
	}
}

export function createAssemblyScriptWorkerService(
	loadCompiler: LoadAssemblyScriptCompiler = importAssemblyScriptCompiler
): WorkerLanguageService {
	let compiler: AssemblyScriptCompiler;
	let context: LspDocumentContext;
	let extraFiles: Record<string, string> = {};

	const collectFiles = () => {
		const files = { ...extraFiles };
		for (const document of context.documents.values()) {
			files[normalizeFileName(uriToPath(document.uri))] = document.text;
		}
		return files;
	};

	return {
		name: 'wasm-idle-assemblyscript-lsp',
		diagnosticDelay: 250,
		capabilities: {
			completionProvider: { triggerCharacters: ['.', '<'] },
			hoverProvider: true
		},
		async initialize(options, nextContext) {
			context = nextContext;
			extraFiles = Object.fromEntries(
				Object.entries((options as AssemblyScriptWorkerOptions | undefined)?.extraFiles || {}).map(
					([fileName, source]) => [normalizeFileName(fileName), source]
				)
			);
			context.reportProgress('load-assemblyscript');
			compiler = await loadCompiler();
		},
		async diagnostics(document: LspDocument) {
			const files = collectFiles();
			const entry = normalizeFileName(uriToPath(document.uri)) || 'assembly/index.ts';
			files[entry] = document.text;
			const stdout = createStringSink();
			const stderr = createStringSink();
			const result = await compiler.main([entry, '--noEmit', '--runtime', 'stub'], {
				stdout,
				stderr,
				readFile(filePath) {
					return files[normalizeFileName(filePath)] ?? null;
				},
				writeFile() {},
				listFiles(dirPath) {
					const prefix = normalizeFileName(dirPath);
					return Object.keys(files).filter((fileName) => fileName.startsWith(prefix));
				}
			});
			const message = stderr.toString();
			const diagnostics = parseAssemblyScriptDiagnostics(message);
			if (result.error && diagnostics.length === 0) {
				diagnostics.push({
					range: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 1 }
					},
					severity: 1,
					source: 'assemblyscript',
					message: message.trim() || result.error.message
				});
			}
			return diagnostics;
		},
		completion() {
			return {
				isIncomplete: false,
				items: ASSEMBLYSCRIPT_COMPLETIONS.map((label) => ({
					label,
					kind: ASSEMBLYSCRIPT_HOVER[label] ? 7 : 14,
					detail: ASSEMBLYSCRIPT_HOVER[label]
				}))
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = ASSEMBLYSCRIPT_HOVER[word];
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
