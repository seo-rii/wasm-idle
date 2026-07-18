import {
	ConsoleStdout,
	Directory,
	File,
	OpenFile,
	PreopenDirectory,
	WASI
} from '@bjorn3/browser_wasi_shim';
import { Unzip, UnzipInflate } from 'fflate';
import {
	positionAt,
	uriToPath,
	type LspDiagnostic,
	type LspDocument,
	type LspDocumentContext,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';

export type ZigLanguageServerTargetTriple = 'wasm64-wasi';

export interface ZigWorkerOptions {
	compilerUrl: string;
	stdlibUrl: string;
	targetTriple?: ZigLanguageServerTargetTriple;
	compileArgs?: string[];
}

interface ZigWorkspaceFile {
	path: string;
	content: string;
}

interface ZigCompilerDiagnostic {
	fileName?: string | null;
	lineNumber?: number;
	columnNumber?: number;
	endColumnNumber?: number;
	severity?: 'error' | 'warning' | 'other';
	message?: string;
}

interface ZigCompilerResult {
	success: boolean;
	diagnostics?: ZigCompilerDiagnostic[];
	stdout?: string;
	stderr?: string;
}

interface ZigCompilerHost {
	compile(request: {
		code: string;
		activePath: string;
		workspaceFiles: ZigWorkspaceFile[];
		targetTriple: ZigLanguageServerTargetTriple;
		compileArgs: string[];
		log: boolean;
		onProgress?: (progress: { stage?: string; completed?: number; total?: number }) => void;
	}): Promise<ZigCompilerResult>;
}

type LoadZigCompilerHost = (
	options: ZigWorkerOptions,
	context: LspDocumentContext
) => Promise<ZigCompilerHost>;

const ZIG_KEYWORDS = [
	'addrspace',
	'align',
	'allowzero',
	'and',
	'anyframe',
	'anytype',
	'asm',
	'async',
	'await',
	'break',
	'callconv',
	'catch',
	'comptime',
	'const',
	'continue',
	'defer',
	'else',
	'enum',
	'errdefer',
	'error',
	'export',
	'extern',
	'fn',
	'for',
	'if',
	'inline',
	'noalias',
	'noinline',
	'nosuspend',
	'opaque',
	'or',
	'orelse',
	'packed',
	'pub',
	'resume',
	'return',
	'struct',
	'suspend',
	'switch',
	'test',
	'threadlocal',
	'try',
	'union',
	'unreachable',
	'usingnamespace',
	'var',
	'volatile',
	'while'
] as const;

const ZIG_BUILTINS = [
	'@This',
	'@TypeOf',
	'@alignCast',
	'@as',
	'@bitCast',
	'@branchHint',
	'@cImport',
	'@compileError',
	'@compileLog',
	'@embedFile',
	'@enumFromInt',
	'@errorName',
	'@field',
	'@import',
	'@intCast',
	'@intFromEnum',
	'@intFromPtr',
	'@max',
	'@memcpy',
	'@memset',
	'@min',
	'@panic',
	'@ptrCast',
	'@sizeOf',
	'@tagName',
	'@truncate',
	'@typeInfo'
] as const;

const ZIG_TYPES = [
	'bool',
	'void',
	'noreturn',
	'type',
	'anyerror',
	'comptime_int',
	'comptime_float',
	'isize',
	'usize',
	'i8',
	'u8',
	'i16',
	'u16',
	'i32',
	'u32',
	'i64',
	'u64',
	'i128',
	'u128',
	'f16',
	'f32',
	'f64',
	'f80',
	'f128'
] as const;

const ZIG_HOVER: Record<string, string> = {
	const: 'Declares an immutable binding.',
	var: 'Declares a mutable binding.',
	comptime: 'Runs the expression or parameter evaluation at compile time.',
	defer: 'Runs a statement when leaving the current scope.',
	errdefer: 'Runs a statement when leaving the current scope with an error.',
	try: 'Propagates an error union value on failure.',
	catch: 'Handles an error union value.',
	fn: 'Declares a function.',
	struct: 'Declares a struct type.',
	union: 'Declares a union type.',
	enum: 'Declares an enum type.',
	'@import': 'Imports another Zig file or package.',
	'@This': 'Returns the innermost container type.',
	'@TypeOf': 'Returns the compile-time type of an expression.',
	'@as': 'Performs an explicit type coercion.',
	'@sizeOf': 'Returns the ABI size of a type in bytes.'
};

const normalizeWorkspacePath = (value: string, fallback = 'main.zig') => {
	const normalized = value
		.trim()
		.replaceAll('\\', '/')
		.replace(/^\/workspace\//u, '')
		.replace(/^\/+/u, '')
		.split('/')
		.filter((part) => part && part !== '.' && part !== '..')
		.join('/');
	return normalized || fallback;
};

const basename = (value: string) => {
	const normalized = normalizeWorkspacePath(value);
	const slashIndex = normalized.lastIndexOf('/');
	return slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
};

const addFile = (root: Directory, filePath: string, data: Uint8Array) => {
	const parts = normalizeWorkspacePath(filePath).split('/').filter(Boolean);
	let current = root;
	for (const part of parts.slice(0, -1)) {
		const next = current.contents.get(part);
		if (next instanceof Directory) {
			current = next;
			continue;
		}
		const directory = new Directory(new Map());
		current.contents.set(part, directory);
		current = directory;
	}
	current.contents.set(parts.at(-1) || 'main.zig', new File(data));
};

const diagnosticSeverity = (severity: ZigCompilerDiagnostic['severity']): 1 | 2 | 3 =>
	severity === 'warning' ? 2 : severity === 'other' ? 3 : 1;

const diagnosticFor = (diagnostic: ZigCompilerDiagnostic): LspDiagnostic => {
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
		source: 'zig',
		message: String(diagnostic.message || 'Zig diagnostic')
	};
};

function parseZigDiagnostics(output: string): ZigCompilerDiagnostic[] {
	const diagnostics: ZigCompilerDiagnostic[] = [];
	const pattern = /(?:^|\n)([^:\n]+\.zig):(\d+):(\d+):\s*(error|warning|note):\s*([^\n]+)/gu;
	for (const match of output.matchAll(pattern)) {
		diagnostics.push({
			fileName: match[1],
			lineNumber: Number(match[2]),
			columnNumber: Number(match[3]),
			severity: match[4] === 'warning' ? 'warning' : match[4] === 'note' ? 'other' : 'error',
			message: match[5].trim()
		});
	}
	return diagnostics;
}

async function fetchBytes(
	url: string,
	stage: string,
	reportProgress: LspDocumentContext['reportProgress']
) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to load ${stage} from ${url}: ${response.status}`);
	}
	const total = Number(response.headers.get('content-length') || 0) || undefined;
	const body = response.body?.getReader();
	if (!body) {
		const data = new Uint8Array(await response.arrayBuffer());
		reportProgress(stage, data.byteLength, total);
		return data;
	}
	const chunks: Uint8Array[] = [];
	let loaded = 0;
	while (true) {
		const { done, value } = await body.read();
		if (done) break;
		if (!value) continue;
		chunks.push(value);
		loaded += value.byteLength;
		reportProgress(stage, loaded, total);
	}
	const data = new Uint8Array(loaded);
	let offset = 0;
	for (const chunk of chunks) {
		data.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return data;
}

async function unzipStdDirectory(source: Uint8Array) {
	const root = new Directory(new Map());
	let archiveError: unknown;
	const unzip = new Unzip((file) => {
		if (!file.name || file.name.endsWith('/')) return;
		const chunks: Uint8Array[] = [];
		let length = 0;
		file.ondata = (error, data, final) => {
			if (error) {
				archiveError = error;
				return;
			}
			if (data.byteLength > 0) {
				chunks.push(data);
				length += data.byteLength;
			}
			if (!final) return;
			const contents = new Uint8Array(length);
			let offset = 0;
			for (const chunk of chunks) {
				contents.set(chunk, offset);
				offset += chunk.byteLength;
			}
			addFile(root, file.name, contents);
		};
		file.start();
	});
	unzip.register(UnzipInflate);
	unzip.push(source, true);
	if (archiveError) throw archiveError;
	const stdDirectory = root.contents.get('std');
	if (!(stdDirectory instanceof Directory)) {
		throw new Error('Zig standard library archive must contain a std/ directory');
	}
	return stdDirectory;
}

const instantiateResult = (
	result: WebAssembly.Instance | WebAssembly.WebAssemblyInstantiatedSource
) => (result instanceof WebAssembly.Instance ? result : result.instance);

async function loadDefaultZigCompilerHost(
	options: ZigWorkerOptions,
	context: LspDocumentContext
): Promise<ZigCompilerHost> {
	const [compilerBytes, stdlibBytes] = await Promise.all([
		fetchBytes(options.compilerUrl, 'load-zig-compiler', context.reportProgress),
		fetchBytes(options.stdlibUrl, 'load-zig-stdlib', context.reportProgress)
	]);
	const [compilerModule, stdDirectory] = await Promise.all([
		WebAssembly.compile(compilerBytes),
		unzipStdDirectory(stdlibBytes)
	]);

	return {
		async compile(request) {
			const encoder = new TextEncoder();
			const decoder = new TextDecoder();
			const root = new Directory(new Map());
			for (const file of request.workspaceFiles) {
				addFile(root, file.path, encoder.encode(file.content));
			}
			addFile(root, request.activePath, encoder.encode(request.code));
			let compilerOutput = '';
			const writeOutput = (chunk: Uint8Array) => {
				compilerOutput += decoder.decode(chunk, { stream: true });
			};
			const outputFd = new ConsoleStdout(writeOutput);
			const errorFd = new ConsoleStdout(writeOutput);
			const zigWasi = new WASI(
				[
					'zigc.wasm',
					'build-exe',
					request.activePath,
					`-Dtarget=${request.targetTriple}`,
					'-fno-llvm',
					'-fno-lld',
					'-O',
					'ReleaseSmall',
					'-femit-bin=output.wasm',
					...request.compileArgs
				],
				[],
				[
					new OpenFile(new File([])),
					outputFd,
					errorFd,
					new PreopenDirectory('.', root.contents),
					new PreopenDirectory('/lib', new Map([['std', stdDirectory]])),
					new PreopenDirectory('/cache', new Map())
				],
				{ debug: false }
			);
			request.onProgress?.({ stage: 'zig-diagnostics' });
			const instance = instantiateResult(
				await WebAssembly.instantiate(compilerModule, {
					wasi_snapshot_preview1: zigWasi.wasiImport
				})
			);
			const exitCode = Number(
				zigWasi.start(
					instance as { exports: { memory: WebAssembly.Memory; _start: () => unknown } }
				) || 0
			);
			compilerOutput += decoder.decode();
			return {
				success: exitCode === 0,
				diagnostics: parseZigDiagnostics(compilerOutput),
				stdout: compilerOutput,
				stderr: compilerOutput
			};
		}
	};
}

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	return (
		(line.slice(0, character).match(/@?[A-Za-z_][A-Za-z0-9_]*$/u)?.[0] || '') +
		(line.slice(character).match(/^[A-Za-z0-9_]*/u)?.[0] || '')
	);
};

export function createZigWorkerService(
	loadCompilerHost: LoadZigCompilerHost = loadDefaultZigCompilerHost
): WorkerLanguageService {
	let compiler: ZigCompilerHost | null = null;
	let targetTriple: ZigLanguageServerTargetTriple = 'wasm64-wasi';
	let compileArgs: string[] = [];
	let lastKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];

	const collectWorkspaceFiles = (document: LspDocument, context: LspDocumentContext) => {
		const activePath = normalizeWorkspacePath(uriToPath(document.uri));
		const files = new Map<string, string>();
		for (const nextDocument of context.documents.values()) {
			const path = normalizeWorkspacePath(uriToPath(nextDocument.uri));
			files.set(path, path === activePath ? document.text : nextDocument.text);
		}
		files.set(activePath, document.text);
		return {
			activePath,
			workspaceFiles: Array.from(files, ([path, content]) => ({ path, content })).sort(
				(a, b) => a.path.localeCompare(b.path)
			)
		};
	};

	const isCurrentDocumentDiagnostic = (diagnostic: ZigCompilerDiagnostic, activePath: string) => {
		if (!diagnostic.fileName) return true;
		const normalized = normalizeWorkspacePath(diagnostic.fileName);
		return normalized === activePath || basename(normalized) === basename(activePath);
	};

	return {
		name: 'wasm-idle-zig-lsp',
		diagnosticDelay: 900,
		capabilities: {
			completionProvider: { triggerCharacters: ['.', '@'] },
			hoverProvider: true
		},
		async initialize(options, context) {
			const config = (options || {}) as ZigWorkerOptions;
			if (!config.compilerUrl || !config.stdlibUrl) {
				throw new Error('Zig language server requires compilerUrl and stdlibUrl');
			}
			targetTriple = config.targetTriple || targetTriple;
			compileArgs = config.compileArgs || [];
			context.reportProgress('load-zig-compiler');
			compiler = await loadCompilerHost(
				{
					...config,
					targetTriple,
					compileArgs
				},
				context
			);
		},
		async diagnostics(document, context) {
			if (!compiler || !document.text.trim()) return [];
			const { activePath, workspaceFiles } = collectWorkspaceFiles(document, context);
			const key = JSON.stringify({ targetTriple, compileArgs, activePath, workspaceFiles });
			if (key === lastKey) return lastDiagnostics;
			context.reportProgress('zig-diagnostics');
			const result = await compiler.compile({
				code: document.text,
				activePath,
				workspaceFiles,
				targetTriple,
				compileArgs,
				log: false,
				onProgress(progress) {
					context.reportProgress(
						progress.stage || 'zig-diagnostics',
						progress.completed,
						progress.total
					);
				}
			});
			const diagnostics = (result.diagnostics || [])
				.filter((diagnostic) => isCurrentDocumentDiagnostic(diagnostic, activePath))
				.map(diagnosticFor);
			lastKey = key;
			lastDiagnostics =
				diagnostics.length || result.success
					? diagnostics
					: [
							{
								range: {
									start: positionAt(document.text, 0),
									end: positionAt(
										document.text,
										Math.min(document.text.length, 1)
									)
								},
								severity: 1,
								source: 'zig',
								message: result.stderr || result.stdout || 'Zig compilation failed'
							}
						];
			return lastDiagnostics;
		},
		completion() {
			return {
				isIncomplete: false,
				items: [
					...ZIG_KEYWORDS.map((label) => ({ label, kind: 14 })),
					...ZIG_TYPES.map((label) => ({ label, kind: 25 })),
					...ZIG_BUILTINS.map((label) => ({
						label,
						kind: 3,
						detail: ZIG_HOVER[label] || 'Zig builtin function'
					}))
				]
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = ZIG_HOVER[word];
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
