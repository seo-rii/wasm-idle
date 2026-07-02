import { Buffer } from 'buffer';
import { transformSync, type Options as SwcTypeScriptOptions } from '@swc/wasm-typescript';

export type BrowserTypeScriptLanguage = 'javascript' | 'typescript';
export type BrowserTypeScriptDiagnosticSeverity = 'error' | 'warning' | 'other';

export interface BrowserTypeScriptDiagnostic {
	fileName?: string | null;
	lineNumber: number;
	columnNumber?: number;
	endColumnNumber?: number;
	severity: BrowserTypeScriptDiagnosticSeverity;
	message: string;
}

export interface BrowserTypeScriptCompileRequest {
	code: string;
	language?: BrowserTypeScriptLanguage;
	fileName?: string;
	compilerOptions?: Partial<SwcTypeScriptOptions>;
	log?: boolean;
}

export interface BrowserTypeScriptArtifact {
	javascript: string;
	source: string;
	language: BrowserTypeScriptLanguage;
	fileName: string;
}

export interface BrowserTypeScriptCompileResult {
	success: boolean;
	artifact?: BrowserTypeScriptArtifact;
	diagnostics: BrowserTypeScriptDiagnostic[];
	stdout: string;
	stderr: string;
}

export interface BrowserTypeScriptCompiler {
	compile(request: BrowserTypeScriptCompileRequest): Promise<BrowserTypeScriptCompileResult>;
}

export type BrowserTypeScriptCompilerFactory = () => Promise<BrowserTypeScriptCompiler>;

export interface BrowserTypeScriptVirtualFile {
	path: string;
	content: string | Uint8Array;
}

export interface BrowserTypeScriptExecutionOptions {
	args?: string[];
	env?: Record<string, string>;
	stdin?: () => string | null;
	stdout?: (chunk: string) => void;
	stderr?: (chunk: string) => void;
	files?: BrowserTypeScriptVirtualFile[];
	activePath?: string;
}

export interface BrowserTypeScriptExecutionResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

class ProcessExit extends Error {
	constructor(readonly code: number) {
		super(`Process exited with code ${code}`);
	}
}

function normalizeLanguage(language: BrowserTypeScriptLanguage | undefined, fileName = '') {
	if (language) return language;
	return fileName.toLowerCase().endsWith('.ts') ? 'typescript' : 'javascript';
}

function defaultFileName(language: BrowserTypeScriptLanguage) {
	return language === 'typescript' ? 'main.ts' : 'main.js';
}

const NODE_BUILTIN_SPECIFIERS = new Set([
	'buffer',
	'fs',
	'node:buffer',
	'node:fs',
	'node:path',
	'node:process',
	'path',
	'process'
]);

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NODE_BUILTIN_PATTERN = [...NODE_BUILTIN_SPECIFIERS]
	.sort((a, b) => b.length - a.length)
	.map(escapeRegExp)
	.join('|');

function createDiagnostic(
	message: string,
	fileName: string,
	lineNumber = 1,
	columnNumber?: number
): BrowserTypeScriptDiagnostic {
	const diagnostic: BrowserTypeScriptDiagnostic = {
		fileName,
		lineNumber,
		severity: 'error',
		message
	};
	if (columnNumber !== undefined) diagnostic.columnNumber = columnNumber;
	return diagnostic;
}

function namedImportToDestructuring(value: string) {
	const names = value
		.trim()
		.replace(/^\{/, '')
		.replace(/\}$/, '')
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => part.replace(/\s+as\s+/u, ': '))
		.join(', ');
	return names ? `{ ${names} }` : '{}';
}

function isIdentifier(value: string) {
	return /^[A-Za-z_$][\w$]*$/u.test(value);
}

function rewriteImportClause(importClause: string, specifier: string): string | null {
	const clause = importClause.trim();
	if (!clause) return `require(${JSON.stringify(specifier)});`;
	if (clause.startsWith('{')) {
		return `const ${namedImportToDestructuring(clause)} = require(${JSON.stringify(specifier)});`;
	}
	const namespaceMatch = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/u.exec(clause);
	if (namespaceMatch) {
		return `const ${namespaceMatch[1]} = require(${JSON.stringify(specifier)});`;
	}
	const commaIndex = clause.indexOf(',');
	if (commaIndex !== -1) {
		const defaultName = clause.slice(0, commaIndex).trim();
		const rest = clause.slice(commaIndex + 1).trim();
		if (!isIdentifier(defaultName)) return null;
		const moduleName = `__wasmTypeScriptBuiltin_${defaultName}`;
		const rewrittenRest: string | null = rewriteImportClause(rest, moduleName);
		if (!rewrittenRest) return null;
		return `const ${moduleName} = require(${JSON.stringify(specifier)});\nconst ${defaultName} = ${moduleName};\n${rewrittenRest.replace(
			`require(${JSON.stringify(moduleName)})`,
			moduleName
		)}`;
	}
	if (!isIdentifier(clause)) return null;
	return `const ${clause} = require(${JSON.stringify(specifier)});`;
}

function rewriteNodeBuiltinImports(code: string) {
	const sideEffectImport = new RegExp(
		`^\\s*import\\s+(['"])(${NODE_BUILTIN_PATTERN})\\1\\s*;?`,
		'gmu'
	);
	const fromImport = new RegExp(
		`^\\s*import\\s+([^;]*?)\\s+from\\s+(['"])(${NODE_BUILTIN_PATTERN})\\2\\s*;?`,
		'gmu'
	);
	return code
		.replace(fromImport, (_match, importClause: string, _quote: string, specifier: string) => {
			const rewritten = rewriteImportClause(importClause, specifier);
			return rewritten ?? _match;
		})
		.replace(sideEffectImport, (_match, _quote: string, specifier: string) => {
			return `require(${JSON.stringify(specifier)});`;
		});
}

function findUnsupportedModuleSyntax(code: string, fileName: string) {
	const pattern = /^(\s*)(import\s+|export\s+)/gmu;
	const match = pattern.exec(code);
	if (!match) return null;
	const before = code.slice(0, match.index);
	const lineNumber = before.split('\n').length;
	const columnNumber = (match[1]?.length || 0) + 1;
	return createDiagnostic(
		'Only Node builtin imports are supported in this browser runner. Use require(...) or import from fs/path/process/buffer.',
		fileName,
		lineNumber,
		columnNumber
	);
}

function normalizeSwcError(error: unknown, fileName: string) {
	const message = error instanceof Error ? error.message : String(error);
	return createDiagnostic(message, fileName);
}

export async function compileTypeScript(
	request: BrowserTypeScriptCompileRequest
): Promise<BrowserTypeScriptCompileResult> {
	const language = normalizeLanguage(request.language, request.fileName);
	const fileName = request.fileName || defaultFileName(language);
	try {
		const stripped =
			language === 'typescript'
				? transformSync(request.code, {
						filename: fileName,
						mode: 'strip-only',
						module: true,
						sourceMap: false,
						...request.compilerOptions,
						transform: {
							noEmptyExport: true,
							...request.compilerOptions?.transform
						}
					}).code
				: request.code;
		const javascript = rewriteNodeBuiltinImports(stripped);
		const unsupportedModuleSyntax = findUnsupportedModuleSyntax(javascript, fileName);
		const diagnostics = unsupportedModuleSyntax ? [unsupportedModuleSyntax] : [];
		const success = diagnostics.length === 0;
		const result: BrowserTypeScriptCompileResult = {
			success,
			diagnostics,
			stdout: '',
			stderr: success ? '' : diagnostics.map((diagnostic) => diagnostic.message).join('\n')
		};
		if (success) {
			result.artifact = {
				javascript,
				source: request.code,
				language,
				fileName
			};
		}
		return result;
	} catch (error) {
		const diagnostics = [normalizeSwcError(error, fileName)];
		return {
			success: false,
			diagnostics,
			stdout: '',
			stderr: diagnostics.map((diagnostic) => diagnostic.message).join('\n')
		};
	}
}

function normalizePath(value: string) {
	const normalized = value.replaceAll('\\', '/');
	const absolute = normalized.startsWith('/');
	const parts: string[] = [];
	for (const part of normalized.split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') {
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	return `${absolute ? '/' : ''}${parts.join('/')}` || (absolute ? '/' : '.');
}

function dirname(value: string) {
	const normalized = normalizePath(value);
	if (normalized === '/' || normalized === '.') return normalized;
	const index = normalized.lastIndexOf('/');
	if (index <= 0) return normalized.startsWith('/') ? '/' : '.';
	return normalized.slice(0, index);
}

function basename(value: string) {
	const normalized = normalizePath(value);
	if (normalized === '/') return '/';
	const index = normalized.lastIndexOf('/');
	return index === -1 ? normalized : normalized.slice(index + 1);
}

function extname(value: string) {
	const base = basename(value);
	const index = base.lastIndexOf('.');
	return index <= 0 ? '' : base.slice(index);
}

function resolvePath(...values: string[]) {
	let result = '';
	for (const value of values) {
		if (!value) continue;
		if (value.startsWith('/')) result = value;
		else result = result ? `${result}/${value}` : value;
	}
	return normalizePath(result || '/');
}

function joinPath(...values: string[]) {
	return normalizePath(values.filter(Boolean).join('/'));
}

type EncodingOption =
	| BufferEncoding
	| {
			encoding?: BufferEncoding | null;
	  }
	| null
	| undefined;

function resolveEncoding(option: EncodingOption): BufferEncoding | null {
	if (typeof option === 'string') return option;
	if (option && typeof option === 'object') return option.encoding ?? null;
	return null;
}

function toFileString(value: string | number | URL) {
	if (typeof value === 'number') return String(value);
	if (value instanceof URL) return value.pathname;
	return String(value);
}

function makeNodeError(code: string, syscall: string, path: string): Error & { code: string } {
	const error = new Error(`${code}: ${syscall}, '${path}'`) as Error & { code: string };
	error.code = code;
	return error;
}

function createVirtualFileMap(files: BrowserTypeScriptVirtualFile[] = []) {
	const map = new Map<string, string | Uint8Array>();
	for (const file of files) {
		const normalized = normalizePath(file.path);
		map.set(normalized, file.content);
		if (!normalized.startsWith('/')) {
			map.set(`/${normalized}`, file.content);
		}
	}
	return map;
}

function encodeFileResult(value: string | Uint8Array, encoding: BufferEncoding | null) {
	const bytes = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value);
	return encoding ? bytes.toString(encoding) : bytes;
}

function createFsModule(options: BrowserTypeScriptExecutionOptions) {
	const files = createVirtualFileMap(options.files);
	const writes = new Map<string, string | Uint8Array>();
	let stdinCache: string | null = null;
	let stdinRemainder = '';
	let stdinReachedEof = false;

	function readStdinChunk() {
		if (!options.stdin || stdinReachedEof) return null;
		const chunk = options.stdin();
		if (chunk == null) {
			stdinReachedEof = true;
			return null;
		}
		return chunk;
	}

	function readAllStdin() {
		if (stdinCache !== null) return stdinCache;
		let result = stdinRemainder;
		stdinRemainder = '';
		for (;;) {
			const chunk = readStdinChunk();
			if (chunk == null) break;
			result += chunk;
		}
		stdinCache = result;
		return stdinCache;
	}

	function readStdinLine() {
		if (stdinCache !== null) {
			stdinRemainder = stdinCache;
			stdinCache = null;
		}
		for (;;) {
			const newlineIndex = stdinRemainder.indexOf('\n');
			if (newlineIndex !== -1) {
				const rawLine = stdinRemainder.slice(0, newlineIndex);
				stdinRemainder = stdinRemainder.slice(newlineIndex + 1);
				return rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
			}
			const chunk = readStdinChunk();
			if (chunk == null) {
				const line = stdinRemainder;
				stdinRemainder = '';
				return line;
			}
			stdinRemainder += chunk;
		}
	}

	function lookup(pathLike: string | number | URL) {
		const rawPath = toFileString(pathLike);
		if (rawPath === '0' || rawPath === '/dev/stdin' || rawPath === 'dev/stdin') {
			return readAllStdin();
		}
		const normalized = normalizePath(rawPath);
		if (writes.has(normalized)) return writes.get(normalized)!;
		if (files.has(normalized)) return files.get(normalized)!;
		if (!normalized.startsWith('/') && files.has(`/${normalized}`))
			return files.get(`/${normalized}`)!;
		throw makeNodeError('ENOENT', 'open', rawPath);
	}

	function readFileSync(pathLike: string | number | URL, encodingOption?: EncodingOption) {
		return encodeFileResult(lookup(pathLike), resolveEncoding(encodingOption));
	}

	function readLineSync(pathLike: string | number | URL = 0) {
		const rawPath = toFileString(pathLike);
		if (rawPath !== '0' && rawPath !== '/dev/stdin' && rawPath !== 'dev/stdin') {
			throw makeNodeError('EINVAL', 'read', rawPath);
		}
		return readStdinLine();
	}

	function writeFileSync(
		pathLike: string | number | URL,
		data: string | Uint8Array,
		encodingOption?: EncodingOption
	) {
		const rawPath = toFileString(pathLike);
		const normalized = normalizePath(rawPath);
		const encoding = resolveEncoding(encodingOption) || 'utf8';
		writes.set(
			normalized,
			typeof data === 'string' ? Buffer.from(data, encoding).toString() : data
		);
	}

	function existsSync(pathLike: string | number | URL) {
		try {
			lookup(pathLike);
			return true;
		} catch {
			return false;
		}
	}

	function statSync(pathLike: string | number | URL) {
		lookup(pathLike);
		return {
			isFile: () => true,
			isDirectory: () => false,
			isSymbolicLink: () => false,
			size: Buffer.byteLength(String(lookup(pathLike)))
		};
	}

	function readdirSync(pathLike: string | number | URL) {
		const rawPath = toFileString(pathLike);
		const normalized = normalizePath(rawPath);
		const prefix = normalized === '/' ? '/' : `${normalized.replace(/\/$/, '')}/`;
		const names = new Set<string>();
		for (const key of [...files.keys(), ...writes.keys()]) {
			if (!key.startsWith(prefix)) continue;
			const rest = key.slice(prefix.length);
			if (!rest || rest.includes('/')) continue;
			names.add(rest);
		}
		if (!names.size && normalized !== '.' && normalized !== '/') {
			throw makeNodeError('ENOENT', 'scandir', rawPath);
		}
		return [...names].sort();
	}

	const promises = {
		readFile: async (pathLike: string | number | URL, encodingOption?: EncodingOption) =>
			readFileSync(pathLike, encodingOption),
		writeFile: async (
			pathLike: string | number | URL,
			data: string | Uint8Array,
			encodingOption?: EncodingOption
		) => writeFileSync(pathLike, data, encodingOption),
		readdir: async (pathLike: string | number | URL) => readdirSync(pathLike)
	};

	return {
		constants: {
			F_OK: 0,
			R_OK: 4,
			W_OK: 2,
			X_OK: 1
		},
		existsSync,
		promises,
		readFileSync,
		readLineSync,
		readdirSync,
		statSync,
		writeFileSync
	};
}

function inspectValue(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'bigint') return `${value}n`;
	if (value instanceof Error) return value.stack || value.message;
	if (typeof value === 'undefined') return 'undefined';
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function formatConsoleArgs(args: unknown[]) {
	if (!args.length) return '';
	if (typeof args[0] !== 'string') return args.map(inspectValue).join(' ');
	let index = 1;
	const first = args[0].replace(/%[sdifoOj%]/g, (match) => {
		if (match === '%%') return '%';
		if (index >= args.length) return match;
		const value = args[index++];
		if (match === '%d' || match === '%i') return String(Number(value));
		if (match === '%f') return String(Number(value));
		return inspectValue(value);
	});
	return [first, ...args.slice(index).map(inspectValue)].join(' ');
}

function createConsole(stdout: (chunk: string) => void, stderr: (chunk: string) => void) {
	const writeLine = (write: (chunk: string) => void, args: unknown[]) => {
		write(`${formatConsoleArgs(args)}\n`);
	};
	return {
		log: (...args: unknown[]) => writeLine(stdout, args),
		info: (...args: unknown[]) => writeLine(stdout, args),
		warn: (...args: unknown[]) => writeLine(stderr, args),
		error: (...args: unknown[]) => writeLine(stderr, args)
	};
}

function createRequire(options: BrowserTypeScriptExecutionOptions) {
	const fsModule = createFsModule(options);
	const pathModule = {
		basename,
		dirname,
		extname,
		join: joinPath,
		normalize: normalizePath,
		resolve: resolvePath,
		sep: '/',
		delimiter: ':'
	};
	const processModule = {
		argv: ['node', options.activePath || 'main.js', ...(options.args || [])],
		env: { ...(options.env || {}) },
		exit(code = 0) {
			throw new ProcessExit(Number(code) || 0);
		},
		cwd: () => '/',
		platform: 'browser',
		browser: true
	};
	const modules: Record<string, unknown> = {
		buffer: { Buffer },
		fs: fsModule,
		'node:fs': fsModule,
		path: pathModule,
		'node:path': pathModule,
		process: processModule,
		'node:process': processModule
	};

	return {
		require(specifier: string) {
			if (Object.hasOwn(modules, specifier)) return modules[specifier];
			throw makeNodeError('MODULE_NOT_FOUND', 'require', specifier);
		},
		processModule
	};
}

export async function executeBrowserTypeScriptArtifact(
	artifact: BrowserTypeScriptArtifact,
	options: BrowserTypeScriptExecutionOptions = {}
): Promise<BrowserTypeScriptExecutionResult> {
	let stdout = '';
	let stderr = '';
	const writeStdout = (chunk: string) => {
		stdout += chunk;
		options.stdout?.(chunk);
	};
	const writeStderr = (chunk: string) => {
		stderr += chunk;
		options.stderr?.(chunk);
	};
	const localConsole = createConsole(writeStdout, writeStderr);
	const { require, processModule } = createRequire(options);
	const module = { exports: {} };
	const dirnameValue = dirname(options.activePath || artifact.fileName);
	const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
		...args: string[]
	) => (...values: unknown[]) => Promise<unknown>;

	try {
		const execute = new AsyncFunction(
			'require',
			'module',
			'exports',
			'process',
			'console',
			'Buffer',
			'__filename',
			'__dirname',
			`${artifact.javascript}\n//# sourceURL=${artifact.fileName}`
		);
		await execute(
			require,
			module,
			module.exports,
			processModule,
			localConsole,
			Buffer,
			options.activePath || artifact.fileName,
			dirnameValue
		);
		return { exitCode: 0, stdout, stderr };
	} catch (error) {
		if (error instanceof ProcessExit) {
			return { exitCode: error.code, stdout, stderr };
		}
		const message = error instanceof Error ? error.stack || error.message : String(error);
		writeStderr(`${message}\n`);
		return { exitCode: 1, stdout, stderr };
	}
}

export async function createTypeScriptCompiler(): Promise<BrowserTypeScriptCompiler> {
	return {
		compile: compileTypeScript
	};
}

const defaultFactory: BrowserTypeScriptCompilerFactory = createTypeScriptCompiler;

export default defaultFactory;
