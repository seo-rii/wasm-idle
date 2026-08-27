import {
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	unlink,
	writeFile
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { format } from 'prettier';
import ts from 'typescript';
import { validateSharedEmscriptenLldAssets } from './llvm-contracts/emscripten-lld.mjs';
import {
	assertCanonicalRustRuntimeAssetPath,
	validateRustRuntimeProfile
} from './llvm-contracts/rust.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-rust');
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmRustVersion.ts'
);
const DEFAULT_SHARED_LLD_DIR = path.resolve(REPO_ROOT, 'static', 'shared', 'emscripten-lld');
const DEFAULT_GRAPH_LOCK_PATH = path.resolve(THIS_DIR, 'wasm-rust-assets.lock.json');
export const RUST_EXECUTABLE_GRAPH_LOCK_FORMAT = 'wasm-idle-rust-executable-graph-lock-v1';
export const RUST_EXECUTABLE_GRAPH_FORMAT = 'wasm-idle-rust-executable-graph-v1';
export const RUST_EXECUTABLE_GRAPH_FINGERPRINT_DOMAIN = 'wasm-idle:rust-executable-graph:v1\n';
export const RUST_EXECUTABLE_GRAPH_MANIFEST_PATH = 'runtime-executable-graph.v1.json';
export const RUST_EXECUTABLE_GRAPH_INERT_SUFFIX = '.bin';
const SYNC_LOCK_FORMAT = 'wasm-idle-rust-sync-lock-v1';
const SYNC_TRANSACTION_FORMAT = 'wasm-idle-rust-sync-transaction-v1';
const RUST_GRAPH_AUTHORITIES = new Set(['published-static', 'explicit-dist']);
const ALLOWED_RAW_JAVASCRIPT_PATHS = new Set(['debug-instrumenter.js']);
const UNVERIFIED_JAVASCRIPT_STORAGE_PATTERN = /\.(?:c|m)?js(?:\.(?:br|gz))?$/iu;
const RUST_GRAPH_LOCAL_EDGE_KINDS = new Set(['static', 'dynamic', 'worker']);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_GRAPH_MODULES = 256;
const MAX_GRAPH_EDGES = 4096;
const MAX_GRAPH_MODULE_STORAGE_BYTES = 32 * 1024 * 1024;
const MAX_GRAPH_MODULE_LOGICAL_BYTES = 32 * 1024 * 1024;
const SHARED_LLD_ASSET_NAMES = Object.freeze(['lld.js', 'lld.wasm.gz', 'lld.data.gz']);

const RUNTIME_DYNAMIC_MODULE_SPECIFIERS = Object.freeze([
	'../vendor/jco/src/browser.js',
	'../vendor/jco/obj/wasm-tools.js',
	'../vendor/preview2-shim/lib/browser/cli.js',
	'../vendor/preview2-shim/lib/browser/clocks.js',
	'../vendor/preview2-shim/lib/browser/filesystem.js',
	'../vendor/preview2-shim/lib/browser/http.js',
	'../vendor/preview2-shim/lib/browser/io.js',
	'../vendor/preview2-shim/lib/browser/random.js',
	'../vendor/preview2-shim/lib/browser/sockets.js'
]);

const WORKER_EDGE_RULES = Object.freeze({
	'compiler.js': Object.freeze([
		Object.freeze({
			specifier: './compiler-worker.js',
			target: 'compiler-worker.js',
			binding: 'workerUrl',
			factory: 'compiler-dependency'
		})
	]),
	'compiler-worker.js': Object.freeze([
		Object.freeze({
			specifier: './rustc-thread-worker.js',
			target: 'rustc-thread-worker.js',
			semantic: 'threadWorkerUrl.toString',
			binding: 'threadWorkerUrl',
			factory: 'createModuleWorker'
		})
	]),
	'rustc-thread-worker.js': Object.freeze([
		Object.freeze({
			specifier: './rustc-thread-worker.js',
			target: 'rustc-thread-worker.js',
			semantic: 'request.rustcThreadWorkerUrl',
			binding: 'nestedThreadWorkerUrl',
			factory: 'createModuleWorker'
		})
	])
});

const NON_LITERAL_DYNAMIC_IMPORT_RULES = Object.freeze({
	'browser-component-tools.js': Object.freeze({ argumentKind: 'CallExpression', count: 1 }),
	'browser-execution.js': Object.freeze({ argumentIdentifier: 'entryUrl', count: 1 }),
	'browser-linker.js': Object.freeze({ argumentIdentifier: 'assetUrl', count: 1 }),
	'compiler-preload.js': Object.freeze({ argumentIdentifier: 'assetUrl', count: 1 })
});

const JCO_CORE_ASSET_RULES = Object.freeze({
	'vendor/jco/obj/js-component-bindgen-component.js': Object.freeze([
		Object.freeze({
			specifier: './js-component-bindgen-component.core.wasm',
			target: 'vendor/jco/obj/js-component-bindgen-component.core.wasm.gz'
		}),
		Object.freeze({
			specifier: './js-component-bindgen-component.core2.wasm',
			target: 'vendor/jco/obj/js-component-bindgen-component.core2.wasm'
		})
	]),
	'vendor/jco/obj/wasm-tools.js': Object.freeze([
		Object.freeze({
			specifier: './wasm-tools.core.wasm',
			target: 'vendor/jco/obj/wasm-tools.core.wasm.gz'
		}),
		Object.freeze({
			specifier: './wasm-tools.core2.wasm',
			target: 'vendor/jco/obj/wasm-tools.core2.wasm'
		})
	])
});

const NODE_ONLY_EXTERNAL_IMPORT_RULES = Object.freeze({
	'vendor/jco/obj/js-component-bindgen-component.js': 'node:fs/promises',
	'vendor/jco/obj/wasm-tools.js': 'node:fs/promises'
});

/** @param {string} left @param {string} right */
function compareCodeUnits(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

/** @param {Uint8Array} bytes */
function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

/** @param {unknown} value */
function isObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @param {string} label */
function expectObject(value, label) {
	if (!isObject(value)) throw new Error(`${label} must be an object`);
	return /** @type {Record<string, unknown>} */ (value);
}

/** @param {Record<string, unknown>} value @param {string[]} keys @param {string} label */
function assertExactKeys(value, keys, label) {
	const actual = Object.keys(value).sort(compareCodeUnits);
	const expected = [...keys].sort(compareCodeUnits);
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} must contain exactly: ${expected.join(', ')}`);
	}
}

/** @param {unknown} value @param {string} label */
function requireSafeInteger(value, label) {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new Error(`${label} must be a non-negative safe integer`);
	}
	return Number(value);
}

/** @param {unknown} value @param {string} label */
function requireSha256(value, label) {
	if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
		throw new Error(`${label} must be a lowercase full SHA-256`);
	}
	return value;
}

/** @param {unknown} value @param {string} label */
function requireSafeRelativePath(value, label) {
	if (typeof value !== 'string' || !value || value.length > 512) {
		throw new Error(`${label} must be a non-empty relative path`);
	}
	const segments = value.split('/');
	if (
		value.startsWith('/') ||
		value.includes('\\') ||
		value.includes('\0') ||
		value.includes('\n') ||
		value.includes('\r') ||
		value.includes('?') ||
		value.includes('#') ||
		value.includes(':') ||
		segments.some((segment) => !segment || segment === '.' || segment === '..') ||
		path.posix.normalize(value) !== value
	) {
		throw new Error(`${label} must be a safe canonical relative path`);
	}
	return value;
}

/** @param {unknown} value @param {string} label */
function requireModuleSpecifier(value, label) {
	if (
		typeof value !== 'string' ||
		!value ||
		value.length > 512 ||
		value.includes('\\') ||
		value.includes('\0') ||
		value.includes('\n') ||
		value.includes('\r') ||
		value.includes('?') ||
		value.includes('#') ||
		value.includes(':') ||
		value.startsWith('/')
	) {
		throw new Error(`${label} must be a safe local module specifier`);
	}
	return value;
}

/** @param {string} importer @param {string} specifier @param {'static'|'dynamic'|'worker'} kind */
function resolveLocalGraphTarget(importer, specifier, kind) {
	const base =
		kind === 'dynamic' &&
		['browser-component-tools.js', 'browser-linker.js', 'compiler-preload.js'].includes(
			importer
		)
			? 'runtime/placeholder.js'
			: importer;
	const target = path.posix.normalize(path.posix.join(path.posix.dirname(base), specifier));
	return requireSafeRelativePath(target, `resolved ${kind} edge ${importer} -> ${specifier}`);
}

/**
 * @param {string} sourcePath
 */
function shouldSkipCopy(sourcePath) {
	return (
		sourcePath.endsWith('.d.ts') ||
		sourcePath.endsWith('.tsbuildinfo') ||
		path.basename(sourcePath).startsWith('tmp-public-api-types-')
	);
}

/**
 * @param {string} sourceDir
 * @param {string} targetDir
 */
async function copyDirectory(sourceDir, targetDir) {
	const before = await lstat(sourceDir, { bigint: true }).catch(() => null);
	if (!before?.isDirectory()) {
		throw new Error(
			`wasm-rust source tree contains a missing or unsafe directory: ${sourceDir}`
		);
	}
	await mkdir(targetDir, { recursive: true });
	for (const name of (await readdir(sourceDir)).sort(compareCodeUnits)) {
		const sourcePath = path.join(sourceDir, name);
		if (shouldSkipCopy(sourcePath)) continue;
		const targetPath = path.join(targetDir, name);
		const stats = await lstat(sourcePath, { bigint: true });
		if (stats.isDirectory()) {
			await copyDirectory(sourcePath, targetPath);
			continue;
		}
		if (!stats.isFile()) {
			throw new Error(`wasm-rust source tree contains a non-regular path: ${sourcePath}`);
		}
		const bytes = await readRegularFileOnce(sourcePath, 'wasm-rust source file');
		await writeFile(targetPath, bytes, { flag: 'wx', mode: Number(stats.mode & 0o777n) });
	}
	const after = await lstat(sourceDir, { bigint: true }).catch(() => null);
	if (
		!after?.isDirectory() ||
		before.dev !== after.dev ||
		before.ino !== after.ino ||
		before.mtimeNs !== after.mtimeNs ||
		before.ctimeNs !== after.ctimeNs
	) {
		throw new Error(`wasm-rust source directory changed while it was copied: ${sourceDir}`);
	}
}

/**
 * @param {string} rootDir
 * @returns {Promise<string[]>}
 */
async function listFiles(rootDir) {
	const rootStats = await lstat(rootDir).catch(() => null);
	if (!rootStats?.isDirectory()) {
		throw new Error(`wasm-rust tree contains a missing or unsafe directory: ${rootDir}`);
	}
	const entries = await readdir(rootDir, { withFileTypes: true });
	const files = [];
	for (const entry of entries.sort((left, right) => compareCodeUnits(left.name, right.name))) {
		const entryPath = path.join(rootDir, entry.name);
		if (shouldSkipCopy(entryPath)) continue;
		if (entry.isDirectory()) {
			files.push(...(await listFiles(entryPath)));
			continue;
		}
		if (!entry.isFile()) {
			throw new Error(`wasm-rust tree contains a non-regular path: ${entryPath}`);
		}
		files.push(entryPath);
	}
	return files.sort(compareCodeUnits);
}

/** @param {string} rootDir */
async function removeUnverifiedRawJavaScript(rootDir) {
	const rawJavaScriptPaths = (await listFiles(rootDir)).filter((filePath) =>
		UNVERIFIED_JAVASCRIPT_STORAGE_PATTERN.test(filePath)
	);
	for (const filePath of rawJavaScriptPaths) {
		const relativePath = path.relative(rootDir, filePath).replaceAll(path.sep, '/');
		if (ALLOWED_RAW_JAVASCRIPT_PATHS.has(relativePath)) continue;
		await unlink(filePath);
	}
	const unexpected = (await listFiles(rootDir))
		.map((filePath) => path.relative(rootDir, filePath).replaceAll(path.sep, '/'))
		.filter(
			(relativePath) =>
				UNVERIFIED_JAVASCRIPT_STORAGE_PATTERN.test(relativePath) &&
				!ALLOWED_RAW_JAVASCRIPT_PATHS.has(relativePath)
		);
	if (unexpected.length > 0) {
		throw new Error(
			`wasm-rust publication retains executable JavaScript outside the verified graph: ${unexpected.join(', ')}`
		);
	}
}

/** @param {string} filePath @param {string} label */
async function readRegularFileOnce(filePath, label) {
	const before = await lstat(filePath, { bigint: true }).catch(() => null);
	if (!before?.isFile()) throw new Error(`${label} must be a regular file: ${filePath}`);
	const bytes = await readFile(filePath);
	const after = await lstat(filePath, { bigint: true }).catch(() => null);
	if (
		!after?.isFile() ||
		before.dev !== after.dev ||
		before.ino !== after.ino ||
		before.size !== after.size ||
		before.mtimeNs !== after.mtimeNs ||
		before.ctimeNs !== after.ctimeNs
	) {
		throw new Error(`${label} changed while it was being read: ${filePath}`);
	}
	return bytes;
}

/** @param {string} rootDir @param {string} relativePath @param {string} label */
async function lstatContainedGraphPath(rootDir, relativePath, label) {
	requireSafeRelativePath(relativePath, label);
	let cursor = rootDir;
	const segments = relativePath.split('/');
	for (const [index, segment] of segments.entries()) {
		cursor = path.join(cursor, segment);
		const stats = await lstat(cursor).catch(() => null);
		if (!stats) return null;
		if (index < segments.length - 1) {
			if (!stats.isDirectory()) {
				throw new Error(
					`${label} crosses a non-directory or symbolic-link boundary: ${cursor}`
				);
			}
		} else if (!stats.isFile()) {
			throw new Error(`${label} must be a regular file: ${cursor}`);
		}
	}
	return await lstat(cursor);
}

/** @param {string} rootDir @param {string} candidate @param {string} label */
async function requireRealpathInsideGraphRoot(rootDir, candidate, label) {
	const resolvedRoot = await realpath(rootDir);
	const resolvedCandidate = await realpath(candidate);
	if (
		resolvedCandidate === resolvedRoot ||
		!resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
	) {
		throw new Error(`${label} escapes its executable graph root: ${candidate}`);
	}
	return resolvedCandidate;
}

function toImportPath(fromFilePath, targetPath) {
	const relativePath = path
		.relative(path.dirname(fromFilePath), targetPath)
		.replaceAll(path.sep, '/');
	return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

function replaceQuotedSpecifier(input, specifier, replacement) {
	return input
		.replaceAll(`'${specifier}'`, `'${replacement}'`)
		.replaceAll(`"${specifier}"`, `"${replacement}"`);
}

/**
 * @param {string} rootDir
 */
async function rewriteBrowserWasiShimImports(rootDir) {
	const replacementTargets = [
		{
			specifier: '@bjorn3/browser_wasi_shim',
			relativeTargetPath: path.join('vendor', 'browser_wasi_shim', 'index.js')
		},
		{
			specifier: '@bjorn3/browser_wasi_shim/dist/fd.js',
			relativeTargetPath: path.join('vendor', 'browser_wasi_shim', 'fd.js')
		},
		{
			specifier: '@bjorn3/browser_wasi_shim/dist/fs_mem.js',
			relativeTargetPath: path.join('vendor', 'browser_wasi_shim', 'fs_mem.js')
		},
		{
			specifier: '@bjorn3/browser_wasi_shim/dist/wasi.js',
			relativeTargetPath: path.join('vendor', 'browser_wasi_shim', 'wasi.js')
		},
		{
			specifier: '@bjorn3/browser_wasi_shim/dist/wasi_defs.js',
			relativeTargetPath: path.join('vendor', 'browser_wasi_shim', 'wasi_defs.js')
		}
	];
	const bundleFiles = await listFiles(rootDir);

	for (const filePath of bundleFiles) {
		if (!filePath.endsWith('.js')) continue;

		const current = await readFile(filePath, 'utf8');
		let next = current;

		for (const rule of replacementTargets) {
			if (!next.includes(rule.specifier)) continue;

			const targetPath = path.join(rootDir, rule.relativeTargetPath);
			const targetStats = await stat(targetPath).catch(() => null);
			if (!targetStats?.isFile()) {
				throw new Error(
					`wasm-rust browser bundle is incomplete. Expected vendored browser_wasi_shim at ${targetPath}.`
				);
			}

			next = replaceQuotedSpecifier(next, rule.specifier, toImportPath(filePath, targetPath));
		}

		if (next !== current) {
			await writeFile(filePath, next, 'utf8');
		}
	}
}

/**
 * @param {string} sourceDir
 */
/** @param {string} sourceDir @param {Array<string|{filePath:string,bytes:Uint8Array}>} [additionalFiles] */
async function computeBundleFingerprint(sourceDir, additionalFiles = []) {
	const hash = createHash('sha256');
	for (const filePath of await listFiles(sourceDir)) {
		hash.update(path.relative(sourceDir, filePath).split(path.sep).join('/'));
		hash.update('\0');
		hash.update(await readRegularFileOnce(filePath, 'wasm-rust fingerprint input'));
		hash.update('\n');
	}
	for (const input of [...additionalFiles].sort((left, right) =>
		compareCodeUnits(
			typeof left === 'string' ? left : left.filePath,
			typeof right === 'string' ? right : right.filePath
		)
	)) {
		const filePath = typeof input === 'string' ? input : input.filePath;
		hash.update(`shared/${path.basename(filePath)}`);
		hash.update('\0');
		hash.update(
			typeof input === 'string'
				? await readRegularFileOnce(filePath, 'wasm-rust shared fingerprint input')
				: input.bytes
		);
		hash.update('\n');
	}
	return hash.digest('hex');
}

/**
 * @typedef {'published-static'|'explicit-dist'} RustGraphAuthority
 * @typedef {'identity'|'gzip'} RustGraphEncoding
 * @typedef {{specifier:string,target:string,kind:'static'|'dynamic'|'worker'}} RustGraphImport
 * @typedef {{specifier:string,target:string,kind:'core-wasm'}} RustGraphAsset
 * @typedef {{specifier:string,kind:'dynamic',condition:'node-only'}} RustGraphExternal
 * @typedef {{bytes:number,sha256:string}} RustGraphReceipt
 * @typedef {{
 *   delivery:{storagePath:string,encoding:RustGraphEncoding},
 *   storage:RustGraphReceipt,
 *   logical:RustGraphReceipt,
 *   imports:RustGraphImport[],
 *   assets:RustGraphAsset[],
 *   externals:RustGraphExternal[]
 * }} RustGraphModule
 */

/** @param {import('typescript').Expression | undefined} node */
function literalText(node) {
	return node && ts.isStringLiteralLike(node) ? node.text : null;
}

/** @param {import('typescript').Expression} expression @param {string} name */
function isIdentifierNamed(expression, name) {
	return ts.isIdentifier(expression) && expression.text === name;
}

/** @param {import('typescript').Expression | undefined} expression */
function isExactNodeEnvironmentGuard(expression) {
	if (
		!expression ||
		!ts.isBinaryExpression(expression) ||
		expression.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken ||
		!ts.isBinaryExpression(expression.left) ||
		expression.left.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken
	) {
		return false;
	}
	const environmentCheck = expression.left.left;
	const versionsCheck = expression.left.right;
	const nodeCheck = expression.right;
	return (
		ts.isBinaryExpression(environmentCheck) &&
		environmentCheck.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
		ts.isTypeOfExpression(environmentCheck.left) &&
		isIdentifierNamed(environmentCheck.left.expression, 'process') &&
		literalText(environmentCheck.right) === 'undefined' &&
		ts.isPropertyAccessExpression(versionsCheck) &&
		isIdentifierNamed(versionsCheck.expression, 'process') &&
		versionsCheck.name.text === 'versions' &&
		ts.isPropertyAccessExpression(nodeCheck) &&
		ts.isPropertyAccessExpression(nodeCheck.expression) &&
		isIdentifierNamed(nodeCheck.expression.expression, 'process') &&
		nodeCheck.expression.name.text === 'versions' &&
		nodeCheck.name.text === 'node'
	);
}

/** @param {import('typescript').Expression} expression */
function unwrapParentheses(expression) {
	let current = expression;
	while (ts.isParenthesizedExpression(current)) current = current.expression;
	return current;
}

/**
 * @param {import('typescript').CallExpression} call
 * @param {import('typescript').Identifier} argumentBinding
 * @param {import('typescript').TypeChecker} checker
 */
function isCreateModuleWorkerCall(call, argumentBinding, checker) {
	return (
		isIdentifierNamed(call.expression, 'createModuleWorker') &&
		call.arguments.length === 1 &&
		ts.isIdentifier(call.arguments[0]) &&
		identifiersShareSymbol(checker, call.arguments[0], argumentBinding)
	);
}

/**
 * @param {import('typescript').CallExpression} call
 * @param {import('typescript').Identifier} workerUrlBinding
 * @param {import('typescript').TypeChecker} checker
 */
function isExactCompilerDependencyWorkerCall(call, workerUrlBinding, checker) {
	if (
		call.arguments.length !== 1 ||
		!ts.isIdentifier(call.arguments[0]) ||
		!identifiersShareSymbol(checker, call.arguments[0], workerUrlBinding)
	) {
		return false;
	}
	const factory = unwrapParentheses(call.expression);
	if (
		!ts.isBinaryExpression(factory) ||
		factory.operatorToken.kind !== ts.SyntaxKind.BarBarToken ||
		!ts.isPropertyAccessExpression(factory.left) ||
		!isIdentifierNamed(factory.left.expression, 'dependencies') ||
		factory.left.name.text !== 'createWorker'
	) {
		return false;
	}
	const fallback = unwrapParentheses(factory.right);
	if (
		!ts.isArrowFunction(fallback) ||
		fallback.parameters.length !== 1 ||
		!ts.isIdentifier(fallback.parameters[0].name)
	) {
		return false;
	}
	return (
		ts.isCallExpression(fallback.body) &&
		isCreateModuleWorkerCall(fallback.body, fallback.parameters[0].name, checker)
	);
}

/** @param {import('typescript').NewExpression} constructor */
function isExactModuleWorkerConstructor(constructor) {
	const argumentsList = constructor.arguments;
	if (
		!argumentsList ||
		argumentsList.length !== 2 ||
		!isIdentifierNamed(argumentsList[0], 'moduleUrl') ||
		!ts.isObjectLiteralExpression(argumentsList[1]) ||
		argumentsList[1].properties.length !== 1
	) {
		return false;
	}
	const option = argumentsList[1].properties[0];
	return (
		ts.isPropertyAssignment(option) &&
		((ts.isIdentifier(option.name) && option.name.text === 'type') ||
			(ts.isStringLiteralLike(option.name) && option.name.text === 'type')) &&
		literalText(option.initializer) === 'module'
	);
}

/** @param {import('typescript').CallExpression} dynamicImport */
function findExactNodeOnlyGuardIdentifier(dynamicImport) {
	let cursor = dynamicImport.parent;
	while (cursor) {
		if (ts.isIfStatement(cursor)) {
			return isIdentifierNamed(cursor.expression, 'isNode') &&
				dynamicImport.pos >= cursor.thenStatement.pos &&
				dynamicImport.end <= cursor.thenStatement.end
				? cursor.expression
				: null;
		}
		cursor = cursor.parent;
	}
	return null;
}

/**
 * Bind the already-parsed source file so identity checks use TypeScript symbols instead of
 * accepting same-spelled identifiers from a nested scope.
 * @param {import('typescript').SourceFile} sourceFile
 * @param {string} modulePath
 */
function createIsolatedTypeChecker(sourceFile, modulePath) {
	/** @type {import('typescript').CompilerOptions} */
	const options = {
		allowJs: true,
		checkJs: true,
		noLib: true,
		noResolve: true,
		target: ts.ScriptTarget.Latest,
		module: ts.ModuleKind.ESNext
	};
	/** @type {import('typescript').CompilerHost} */
	const host = {
		fileExists: (fileName) => fileName === modulePath,
		readFile: (fileName) => (fileName === modulePath ? sourceFile.text : undefined),
		getSourceFile: (fileName) => (fileName === modulePath ? sourceFile : undefined),
		getDefaultLibFileName: () => 'lib.d.ts',
		writeFile: () => {},
		getCurrentDirectory: () => '',
		getDirectories: () => [],
		getCanonicalFileName: (fileName) => fileName,
		useCaseSensitiveFileNames: () => true,
		getNewLine: () => '\n'
	};
	return ts.createProgram([modulePath], options, host).getTypeChecker();
}

/**
 * @param {import('typescript').TypeChecker} checker
 * @param {import('typescript').Identifier} left
 * @param {import('typescript').Identifier} right
 */
function identifiersShareSymbol(checker, left, right) {
	const leftSymbol = checker.getSymbolAtLocation(left);
	return leftSymbol !== undefined && leftSymbol === checker.getSymbolAtLocation(right);
}

/**
 * @param {import('typescript').Identifier} identifier
 * @param {import('typescript').TypeChecker} checker
 * @param {string} ownerName
 */
function hasMatchingEnclosingParameter(identifier, checker, ownerName) {
	let cursor = identifier.parent;
	while (cursor) {
		if (ts.isFunctionLike(cursor)) {
			const parameter = cursor.parameters.find(
				(entry) =>
					ts.isIdentifier(entry.name) &&
					entry.name.text === identifier.text &&
					identifiersShareSymbol(checker, identifier, entry.name)
			);
			if (!parameter) {
				cursor = cursor.parent;
				continue;
			}
			if (
				(ts.isFunctionDeclaration(cursor) || ts.isFunctionExpression(cursor)) &&
				cursor.name?.text === ownerName
			) {
				return true;
			}
			let owner = cursor.parent;
			while (owner && !ts.isFunctionLike(owner) && !ts.isSourceFile(owner)) {
				if (
					ts.isVariableDeclaration(owner) &&
					ts.isIdentifier(owner.name) &&
					owner.name.text === ownerName
				) {
					return true;
				}
				owner = owner.parent;
			}
			return false;
		}
		cursor = cursor.parent;
	}
	return false;
}

/**
 * @param {import('typescript').CallExpression} dynamicImport
 * @param {string} modulePath
 * @param {import('typescript').TypeChecker} checker
 */
function validateNonLiteralDynamicImportDataflow(dynamicImport, modulePath, checker) {
	const argument = dynamicImport.arguments[0];
	if (modulePath === 'browser-linker.js' || modulePath === 'compiler-preload.js') {
		const ownerName =
			modulePath === 'browser-linker.js' ? 'loadRuntimeModule' : 'defaultImportRuntimeModule';
		return (
			argument !== undefined &&
			ts.isIdentifier(argument) &&
			argument.text === 'assetUrl' &&
			hasMatchingEnclosingParameter(argument, checker, ownerName)
		);
	}
	if (modulePath === 'browser-execution.js') {
		if (!argument || !ts.isIdentifier(argument) || argument.text !== 'entryUrl') return false;
		const declaration = checker.getSymbolAtLocation(argument)?.valueDeclaration;
		if (
			!declaration ||
			!ts.isVariableDeclaration(declaration) ||
			!ts.isIdentifier(declaration.name) ||
			!declaration.initializer ||
			!ts.isCallExpression(declaration.initializer)
		) {
			return false;
		}
		const initializer = declaration.initializer;
		return (
			identifiersShareSymbol(checker, argument, declaration.name) &&
			ts.isPropertyAccessExpression(initializer.expression) &&
			isIdentifierNamed(initializer.expression.expression, 'URL') &&
			initializer.expression.name.text === 'createObjectURL' &&
			initializer.arguments.length === 1 &&
			ts.isNewExpression(initializer.arguments[0]) &&
			isIdentifierNamed(initializer.arguments[0].expression, 'Blob')
		);
	}
	if (modulePath === 'browser-component-tools.js') {
		if (
			!argument ||
			!ts.isCallExpression(argument) ||
			!isIdentifierNamed(argument.expression, 'resolveRuntimeAssetUrl') ||
			argument.arguments.length !== 2 ||
			!ts.isIdentifier(argument.arguments[0]) ||
			!ts.isIdentifier(argument.arguments[1]) ||
			argument.arguments[0].text !== 'runtimeBaseUrl' ||
			argument.arguments[1].text !== 'assetPath'
		) {
			return false;
		}
		return argument.arguments.every((entry) =>
			hasMatchingEnclosingParameter(
				/** @type {import('typescript').Identifier} */ (entry),
				checker,
				'importRuntimeModule'
			)
		);
	}
	return false;
}

/** @param {import('typescript').Expression} expression */
function isImportMetaUrl(expression) {
	return (
		ts.isPropertyAccessExpression(expression) &&
		expression.name.text === 'url' &&
		ts.isMetaProperty(expression.expression) &&
		expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword
	);
}

/**
 * @param {import('typescript').SourceFile} sourceFile
 * @param {import('typescript').TypeChecker} checker
 * @param {import('typescript').NewExpression[]} coreAssetUrls
 */
function validateJcoCoreAssetDataflow(sourceFile, checker, coreAssetUrls) {
	/** @type {import('typescript').FunctionDeclaration[]} */
	const fetchCompileFunctions = [];
	/** @param {import('typescript').Node} node */
	const collect = (node) => {
		if (ts.isFunctionDeclaration(node) && node.name?.text === 'fetchCompile' && node.body) {
			fetchCompileFunctions.push(node);
		}
		ts.forEachChild(node, collect);
	};
	collect(sourceFile);
	if (fetchCompileFunctions.length !== 1) return false;
	const fetchCompile = fetchCompileFunctions[0];
	if (
		fetchCompile.parameters.length !== 1 ||
		!ts.isIdentifier(fetchCompile.parameters[0].name) ||
		!fetchCompile.body ||
		!fetchCompile.name
	) {
		return false;
	}
	const urlBinding = fetchCompile.parameters[0].name;
	/** @type {import('typescript').Identifier[]} */
	const assetUrlBindings = [];
	/** @type {import('typescript').Identifier[]} */
	const gzipGuardBindings = [];
	/** @type {import('typescript').Identifier[]} */
	const gzipMutationBindings = [];
	/** @type {import('typescript').Identifier[]} */
	const fetchBindings = [];
	/** @param {import('typescript').Node} node */
	const inspectBody = (node) => {
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === 'assetUrl' &&
			node.initializer &&
			ts.isNewExpression(node.initializer) &&
			isIdentifierNamed(node.initializer.expression, 'URL') &&
			node.initializer.arguments?.length === 1 &&
			ts.isIdentifier(node.initializer.arguments[0]) &&
			identifiersShareSymbol(checker, node.initializer.arguments[0], urlBinding)
		) {
			assetUrlBindings.push(node.name);
		}
		if (
			ts.isIfStatement(node) &&
			ts.isCallExpression(node.expression) &&
			ts.isPropertyAccessExpression(node.expression.expression) &&
			node.expression.expression.name.text === 'endsWith' &&
			ts.isPropertyAccessExpression(node.expression.expression.expression) &&
			node.expression.expression.expression.name.text === 'pathname' &&
			ts.isIdentifier(node.expression.expression.expression.expression) &&
			literalText(node.expression.arguments[0]) === '.core.wasm'
		) {
			const guardBinding = node.expression.expression.expression.expression;
			gzipGuardBindings.push(guardBinding);
			const mutation = ts.isBlock(node.thenStatement)
				? node.thenStatement.statements.length === 1
					? node.thenStatement.statements[0]
					: undefined
				: node.thenStatement;
			if (
				mutation &&
				ts.isExpressionStatement(mutation) &&
				ts.isBinaryExpression(mutation.expression) &&
				mutation.expression.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
				ts.isPropertyAccessExpression(mutation.expression.left) &&
				mutation.expression.left.name.text === 'pathname' &&
				ts.isIdentifier(mutation.expression.left.expression) &&
				literalText(mutation.expression.right) === '.gz'
			) {
				gzipMutationBindings.push(mutation.expression.left.expression);
			}
		}
		if (
			ts.isCallExpression(node) &&
			isIdentifierNamed(node.expression, 'fetchRuntimeAssetBytes') &&
			node.arguments.length >= 1 &&
			ts.isIdentifier(node.arguments[0])
		) {
			fetchBindings.push(node.arguments[0]);
		}
		ts.forEachChild(node, inspectBody);
	};
	inspectBody(fetchCompile.body);
	if (
		assetUrlBindings.length !== 1 ||
		gzipGuardBindings.length !== 1 ||
		gzipMutationBindings.length !== 1 ||
		fetchBindings.length !== 1 ||
		![gzipGuardBindings[0], gzipMutationBindings[0], fetchBindings[0]].every((binding) =>
			identifiersShareSymbol(checker, binding, assetUrlBindings[0])
		)
	) {
		return false;
	}
	return coreAssetUrls.every((assetUrl) => {
		const parent = assetUrl.parent;
		return (
			assetUrl.arguments?.length === 2 &&
			isImportMetaUrl(assetUrl.arguments[1]) &&
			ts.isCallExpression(parent) &&
			parent.arguments[0] === assetUrl &&
			ts.isIdentifier(parent.expression) &&
			identifiersShareSymbol(checker, parent.expression, fetchCompile.name)
		);
	});
}

/** @param {RustGraphImport[]} imports */
function sortGraphImports(imports) {
	return imports.sort(
		(left, right) =>
			compareCodeUnits(left.kind, right.kind) ||
			compareCodeUnits(left.specifier, right.specifier) ||
			compareCodeUnits(left.target, right.target)
	);
}

/** @param {RustGraphAsset[]} assets */
function sortGraphAssets(assets) {
	return assets.sort(
		(left, right) =>
			compareCodeUnits(left.specifier, right.specifier) ||
			compareCodeUnits(left.target, right.target)
	);
}

/** @param {RustGraphExternal[]} externals */
function sortGraphExternals(externals) {
	return externals.sort((left, right) => compareCodeUnits(left.specifier, right.specifier));
}

/** @param {string} source @param {string} modulePath */
export function extractRustExecutableModuleEdges(source, modulePath) {
	requireSafeRelativePath(modulePath, 'wasm-rust executable module path');
	const sourceFile = ts.createSourceFile(
		modulePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS
	);
	const parseDiagnostics = sourceFile.parseDiagnostics || [];
	if (parseDiagnostics.length > 0) {
		throw new Error(`wasm-rust executable module ${modulePath} is not valid JavaScript`);
	}
	const checker = createIsolatedTypeChecker(sourceFile, modulePath);
	/** @type {RustGraphImport[]} */
	const imports = [];
	/** @type {RustGraphAsset[]} */
	const assets = [];
	/** @type {RustGraphExternal[]} */
	const externals = [];
	/** @type {import('typescript').CallExpression[]} */
	const nonLiteralDynamicImports = [];
	/** @type {string[]} */
	const coreAssetSpecifiers = [];
	/** @type {import('typescript').NewExpression[]} */
	const coreAssetUrls = [];
	/** @type {string[]} */
	const versionedAssetSpecifiers = [];
	/** @type {Map<string,import('typescript').Identifier[]>} */
	const versionedWorkerBindings = new Map();
	/** @type {import('typescript').Identifier[]} */
	const nestedThreadWorkerBindings = [];
	/** @type {import('typescript').CallExpression[]} */
	const allCallExpressions = [];
	/** @type {import('typescript').CallExpression[]} */
	const createModuleWorkerCalls = [];
	/** @type {import('typescript').NewExpression[]} */
	const workerConstructors = [];
	/** @type {Map<string,string>} */
	const stringConstants = new Map();
	let previewAssetLoopCount = 0;
	let threadRequestPassThroughCount = 0;
	let threadPoolUrlDispatchCount = 0;
	/** @type {import('typescript').Identifier[]} */
	const nodeEnvironmentGuardBindings = [];
	/** @type {import('typescript').Identifier[]} */
	const nodeOnlyImportGuardBindings = [];
	let isNodeBindingCount = 0;

	/** @param {'static'|'dynamic'|'worker'} kind @param {string} specifier @param {string} [target] */
	const addLocal = (kind, specifier, target) => {
		if (!specifier.endsWith('.js')) {
			throw new Error(
				`wasm-rust executable module ${modulePath} has an unsupported ${kind} import: ${specifier}`
			);
		}
		requireModuleSpecifier(specifier, `wasm-rust executable module ${modulePath} import`);
		imports.push({
			kind,
			specifier,
			target: target || resolveLocalGraphTarget(modulePath, specifier, kind)
		});
	};

	/** @param {import('typescript').Node} node */
	const visit = (node) => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
			const value = literalText(node.initializer);
			if (value !== null) stringConstants.set(node.name.text, value);
			if (node.name.text === 'isNode') {
				isNodeBindingCount += 1;
				if (isExactNodeEnvironmentGuard(node.initializer)) {
					nodeEnvironmentGuardBindings.push(node.name);
				}
			}
			if (
				node.initializer &&
				ts.isCallExpression(node.initializer) &&
				isIdentifierNamed(node.initializer.expression, 'resolveVersionedAssetUrl')
			) {
				const specifier = literalText(node.initializer.arguments[1]);
				if (specifier !== null) {
					const bindings = versionedWorkerBindings.get(specifier) || [];
					bindings.push(node.name);
					versionedWorkerBindings.set(specifier, bindings);
				}
			}
			if (
				node.name.text === 'nestedThreadWorkerUrl' &&
				node.initializer &&
				ts.isNewExpression(node.initializer) &&
				isIdentifierNamed(node.initializer.expression, 'URL') &&
				node.initializer.arguments?.length === 1 &&
				ts.isPropertyAccessExpression(node.initializer.arguments[0]) &&
				isIdentifierNamed(node.initializer.arguments[0].expression, 'request') &&
				node.initializer.arguments[0].name.text === 'rustcThreadWorkerUrl'
			) {
				nestedThreadWorkerBindings.push(node.name);
			}
		}
		if (ts.isCallExpression(node)) {
			allCallExpressions.push(node);
			if (isIdentifierNamed(node.expression, 'createModuleWorker')) {
				createModuleWorkerCalls.push(node);
			}
		}
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier
		) {
			const specifier = literalText(node.moduleSpecifier);
			if (specifier === null) {
				throw new Error(
					`wasm-rust executable module ${modulePath} has a non-literal import`
				);
			}
			if (!specifier.startsWith('.')) {
				throw new Error(
					`wasm-rust executable module ${modulePath} has a bare static import: ${specifier}`
				);
			}
			addLocal('static', specifier);
		}
		if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const specifier = literalText(node.arguments[0]);
			if (specifier === null) {
				nonLiteralDynamicImports.push(node);
			} else if (specifier.startsWith('.')) {
				addLocal('dynamic', specifier);
			} else {
				const allowed = NODE_ONLY_EXTERNAL_IMPORT_RULES[modulePath];
				if (specifier !== allowed) {
					throw new Error(
						`wasm-rust executable module ${modulePath} has an unapproved external import: ${specifier}`
					);
				}
				externals.push({ specifier, kind: 'dynamic', condition: 'node-only' });
				const guardBinding = findExactNodeOnlyGuardIdentifier(node);
				if (guardBinding) nodeOnlyImportGuardBindings.push(guardBinding);
			}
		}
		if (
			ts.isCallExpression(node) &&
			isIdentifierNamed(node.expression, 'resolveVersionedAssetUrl')
		) {
			const specifier = literalText(node.arguments[1]);
			if (specifier !== null) versionedAssetSpecifiers.push(specifier);
		}
		if (ts.isNewExpression(node) && isIdentifierNamed(node.expression, 'Worker')) {
			workerConstructors.push(node);
		}
		if (ts.isNewExpression(node) && isIdentifierNamed(node.expression, 'URL')) {
			const specifier = literalText(node.arguments?.[0]);
			if (specifier?.endsWith('.core.wasm') || specifier?.endsWith('.core2.wasm')) {
				coreAssetSpecifiers.push(specifier);
				coreAssetUrls.push(node);
			}
		}
		if (
			ts.isPropertyAssignment(node) &&
			((ts.isIdentifier(node.name) && node.name.text === 'rustcThreadWorkerUrl') ||
				(ts.isStringLiteralLike(node.name) && node.name.text === 'rustcThreadWorkerUrl')) &&
			ts.isPropertyAccessExpression(node.initializer) &&
			isIdentifierNamed(node.initializer.expression, 'request') &&
			node.initializer.name.text === 'rustcThreadWorkerUrl'
		) {
			threadRequestPassThroughCount += 1;
		}
		if (
			ts.isPropertyAssignment(node) &&
			((ts.isIdentifier(node.name) && node.name.text === 'rustcThreadWorkerUrl') ||
				(ts.isStringLiteralLike(node.name) && node.name.text === 'rustcThreadWorkerUrl')) &&
			ts.isCallExpression(node.initializer) &&
			ts.isPropertyAccessExpression(node.initializer.expression) &&
			isIdentifierNamed(node.initializer.expression.expression, 'threadWorkerUrl') &&
			node.initializer.expression.name.text === 'toString' &&
			node.initializer.arguments.length === 0
		) {
			threadPoolUrlDispatchCount += 1;
		}
		if (
			ts.isForOfStatement(node) &&
			isIdentifierNamed(node.expression, 'PREVIEW2_COMPONENT_RUNTIME_ASSETS')
		) {
			previewAssetLoopCount += 1;
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	const nonLiteralRule = NON_LITERAL_DYNAMIC_IMPORT_RULES[modulePath];
	if (nonLiteralDynamicImports.length > 0 && !nonLiteralRule) {
		throw new Error(
			`wasm-rust executable module ${modulePath} has an unapproved non-literal dynamic import`
		);
	}
	if (nonLiteralRule) {
		if (nonLiteralDynamicImports.length !== nonLiteralRule.count) {
			throw new Error(
				`wasm-rust executable module ${modulePath} changed its dynamic import boundary`
			);
		}
		for (const dynamicImport of nonLiteralDynamicImports) {
			const argument = dynamicImport.arguments[0];
			if (
				nonLiteralRule.argumentIdentifier &&
				(!argument || !isIdentifierNamed(argument, nonLiteralRule.argumentIdentifier))
			) {
				throw new Error(
					`wasm-rust executable module ${modulePath} changed its dynamic import argument`
				);
			}
			if (
				nonLiteralRule.argumentKind === 'CallExpression' &&
				(!argument || !ts.isCallExpression(argument))
			) {
				throw new Error(
					`wasm-rust executable module ${modulePath} changed its dynamic import resolver`
				);
			}
			if (!validateNonLiteralDynamicImportDataflow(dynamicImport, modulePath, checker)) {
				throw new Error(
					`wasm-rust executable module ${modulePath} changed its dynamic import dataflow`
				);
			}
		}
	}

	const workerRules = WORKER_EDGE_RULES[modulePath] || [];
	for (const rule of workerRules) {
		const matchingBindings =
			rule.semantic === 'request.rustcThreadWorkerUrl'
				? nestedThreadWorkerBindings.filter((binding) => binding.text === rule.binding)
				: (versionedWorkerBindings.get(rule.specifier) || []).filter(
						(binding) => binding.text === rule.binding
					);
		const factoryCallCount =
			matchingBindings.length !== 1
				? 0
				: rule.factory === 'compiler-dependency'
					? allCallExpressions.filter((call) =>
							isExactCompilerDependencyWorkerCall(call, matchingBindings[0], checker)
						).length
					: createModuleWorkerCalls.filter((call) =>
							isCreateModuleWorkerCall(call, matchingBindings[0], checker)
						).length;
		if (rule.semantic === 'request.rustcThreadWorkerUrl') {
			if (
				matchingBindings.length !== 1 ||
				threadRequestPassThroughCount !== 1 ||
				factoryCallCount !== 1 ||
				versionedAssetSpecifiers.includes(rule.specifier)
			) {
				throw new Error(
					`wasm-rust executable module ${modulePath} changed worker URL pass-through`
				);
			}
		} else if (
			versionedAssetSpecifiers.filter((specifier) => specifier === rule.specifier).length !==
				1 ||
			matchingBindings.length !== 1 ||
			factoryCallCount !== 1 ||
			(rule.semantic === 'threadWorkerUrl.toString' && threadPoolUrlDispatchCount !== 1)
		) {
			throw new Error(
				`wasm-rust executable module ${modulePath} changed worker edge ${rule.specifier}`
			);
		}
		addLocal('worker', rule.specifier, rule.target);
	}
	const expectedCreateModuleWorkerCallCount = workerRules.length === 1 ? 1 : 0;
	if (createModuleWorkerCalls.length !== expectedCreateModuleWorkerCallCount) {
		throw new Error(
			`wasm-rust executable module ${modulePath} changed its module worker factory boundary`
		);
	}
	if (workerConstructors.length > 0) {
		if (
			modulePath !== 'module-worker.js' ||
			workerConstructors.length !== 1 ||
			!isExactModuleWorkerConstructor(workerConstructors[0])
		) {
			throw new Error(
				`wasm-rust executable module ${modulePath} has an unapproved Worker boundary`
			);
		}
	}

	if (modulePath === 'browser-component-tools.js') {
		const expectedConstants = [
			'JCO_BROWSER_MODULE',
			'JCO_WASM_TOOLS_MODULE',
			'PREVIEW2_CLI_MODULE',
			'PREVIEW2_CLOCKS_MODULE',
			'PREVIEW2_FILESYSTEM_MODULE',
			'PREVIEW2_HTTP_MODULE',
			'PREVIEW2_IO_MODULE',
			'PREVIEW2_RANDOM_MODULE',
			'PREVIEW2_SOCKETS_MODULE'
		];
		for (const [index, constantName] of expectedConstants.entries()) {
			const specifier = RUNTIME_DYNAMIC_MODULE_SPECIFIERS[index];
			if (stringConstants.get(constantName) !== specifier) {
				throw new Error(
					`wasm-rust executable module ${modulePath} changed runtime module ${constantName}`
				);
			}
			addLocal(
				'dynamic',
				specifier,
				resolveLocalGraphTarget(modulePath, specifier, 'dynamic')
			);
		}
	}
	if (modulePath === 'compiler-preload.js') {
		if (previewAssetLoopCount !== 1) {
			throw new Error(
				'wasm-rust compiler preload changed its component runtime module boundary'
			);
		}
		for (const specifier of RUNTIME_DYNAMIC_MODULE_SPECIFIERS) {
			addLocal(
				'dynamic',
				specifier,
				resolveLocalGraphTarget(modulePath, specifier, 'dynamic')
			);
		}
	}

	const expectedCoreAssets = JCO_CORE_ASSET_RULES[modulePath] || [];
	if (coreAssetSpecifiers.length > 0 && expectedCoreAssets.length === 0) {
		throw new Error(
			`wasm-rust executable module ${modulePath} has an unapproved core asset edge`
		);
	}
	if (expectedCoreAssets.length > 0) {
		if (!validateJcoCoreAssetDataflow(sourceFile, checker, coreAssetUrls)) {
			throw new Error(
				`wasm-rust executable module ${modulePath} changed core asset dataflow`
			);
		}
		for (const expected of expectedCoreAssets) {
			if (
				coreAssetSpecifiers.filter((specifier) => specifier === expected.specifier)
					.length !== 1
			) {
				throw new Error(
					`wasm-rust executable module ${modulePath} changed core asset ${expected.specifier}`
				);
			}
			assets.push({ kind: 'core-wasm', ...expected });
		}
		if (coreAssetSpecifiers.length !== expectedCoreAssets.length) {
			throw new Error(
				`wasm-rust executable module ${modulePath} has an unknown core asset edge`
			);
		}
	}

	const allowedExternal = NODE_ONLY_EXTERNAL_IMPORT_RULES[modulePath];
	if (allowedExternal) {
		if (
			externals.filter((entry) => entry.specifier === allowedExternal).length !== 1 ||
			nodeEnvironmentGuardBindings.length !== 1 ||
			isNodeBindingCount !== 1 ||
			nodeOnlyImportGuardBindings.length !== 1 ||
			!identifiersShareSymbol(
				checker,
				nodeOnlyImportGuardBindings[0],
				nodeEnvironmentGuardBindings[0]
			)
		) {
			throw new Error(
				`wasm-rust executable module ${modulePath} changed its node-only import`
			);
		}
	} else if (
		nodeEnvironmentGuardBindings.length !== 0 ||
		nodeOnlyImportGuardBindings.length !== 0
	) {
		throw new Error(
			`wasm-rust executable module ${modulePath} has an unknown node-only boundary`
		);
	}

	const uniqueImports = new Map();
	for (const graphImport of imports) {
		uniqueImports.set(
			`${graphImport.kind}\0${graphImport.specifier}\0${graphImport.target}`,
			graphImport
		);
	}
	return Object.freeze({
		imports: Object.freeze(sortGraphImports([...uniqueImports.values()])),
		assets: Object.freeze(sortGraphAssets(assets)),
		externals: Object.freeze(sortGraphExternals(externals))
	});
}

/** @param {string} rootDir @param {string} modulePath @param {RustGraphAuthority} authority */
async function readExecutableModule(rootDir, modulePath, authority) {
	const explicitStats = await lstatContainedGraphPath(
		rootDir,
		modulePath,
		`wasm-rust executable module ${modulePath}`
	);
	const legacyGzipStats = await lstatContainedGraphPath(
		rootDir,
		`${modulePath}.gz`,
		`wasm-rust executable module ${modulePath} legacy gzip storage`
	);
	const inertIdentityStats = await lstatContainedGraphPath(
		rootDir,
		`${modulePath}${RUST_EXECUTABLE_GRAPH_INERT_SUFFIX}`,
		`wasm-rust executable module ${modulePath} inert identity storage`
	);
	const inertGzipStats = await lstatContainedGraphPath(
		rootDir,
		`${modulePath}.gz${RUST_EXECUTABLE_GRAPH_INERT_SUFFIX}`,
		`wasm-rust executable module ${modulePath} inert gzip storage`
	);
	if (authority === 'explicit-dist') {
		if (legacyGzipStats || inertIdentityStats || inertGzipStats) {
			throw new Error(
				`wasm-rust explicit dist must contain only logical JavaScript: ${modulePath}`
			);
		}
	} else if (explicitStats || legacyGzipStats) {
		throw new Error(
			`wasm-rust published executable module retains executable storage: ${modulePath}`
		);
	}
	if (inertIdentityStats && inertGzipStats) {
		throw new Error(`wasm-rust executable module has ambiguous inert storage: ${modulePath}`);
	}
	let storagePath;
	/** @type {RustGraphEncoding} */
	let encoding;
	if (authority === 'explicit-dist' && explicitStats) {
		storagePath = modulePath;
		encoding = 'identity';
	} else if (authority === 'published-static' && inertIdentityStats) {
		storagePath = `${modulePath}${RUST_EXECUTABLE_GRAPH_INERT_SUFFIX}`;
		encoding = 'identity';
	} else if (authority === 'published-static' && inertGzipStats) {
		storagePath = `${modulePath}.gz${RUST_EXECUTABLE_GRAPH_INERT_SUFFIX}`;
		encoding = 'gzip';
	} else {
		throw new Error(`wasm-rust executable module is missing: ${modulePath}`);
	}
	const storageFile = path.join(rootDir, ...storagePath.split('/'));
	await requireRealpathInsideGraphRoot(
		rootDir,
		storageFile,
		`wasm-rust executable module ${modulePath}`
	);
	const storageBytes = await readRegularFileOnce(
		storageFile,
		`wasm-rust executable module ${modulePath}`
	);
	if (storageBytes.byteLength > MAX_GRAPH_MODULE_STORAGE_BYTES) {
		throw new Error(`wasm-rust executable module storage is too large: ${modulePath}`);
	}
	let logicalBytes = storageBytes;
	if (encoding === 'gzip') {
		try {
			logicalBytes = gunzipSync(storageBytes, {
				maxOutputLength: MAX_GRAPH_MODULE_LOGICAL_BYTES
			});
		} catch (error) {
			throw new Error(`wasm-rust executable module gzip is invalid: ${modulePath}`, {
				cause: error
			});
		}
	}
	if (logicalBytes.byteLength === 0 || logicalBytes.byteLength > MAX_GRAPH_MODULE_LOGICAL_BYTES) {
		throw new Error(`wasm-rust executable module logical size is invalid: ${modulePath}`);
	}
	let source;
	try {
		source = new TextDecoder('utf-8', { fatal: true }).decode(logicalBytes);
	} catch (error) {
		throw new Error(`wasm-rust executable module is not valid UTF-8: ${modulePath}`, {
			cause: error
		});
	}
	const edges = extractRustExecutableModuleEdges(source, modulePath);
	return Object.freeze({
		delivery: Object.freeze({ storagePath, encoding }),
		storage: Object.freeze({ bytes: storageBytes.byteLength, sha256: sha256(storageBytes) }),
		logical: Object.freeze({ bytes: logicalBytes.byteLength, sha256: sha256(logicalBytes) }),
		imports: edges.imports,
		assets: edges.assets,
		externals: edges.externals
	});
}

/**
 * Materialize the lock-selected published representation only after the explicit source graph
 * has been parsed and verified. All outputs use an inert suffix so a static host cannot expose
 * the verified source bytes as directly executable JavaScript.
 *
 * @param {string} rootDir
 * @param {Awaited<ReturnType<typeof inspectRustExecutableGraph>>} explicitProfile
 * @param {Awaited<ReturnType<typeof inspectRustExecutableGraph>>} publishedProfile
 */
async function publishInertExecutableGraphStorage(rootDir, explicitProfile, publishedProfile) {
	if (
		explicitProfile.authority !== 'explicit-dist' ||
		publishedProfile.authority !== 'published-static'
	) {
		throw new Error('wasm-rust executable graph publication authorities are invalid');
	}
	const modulePaths = Object.keys(explicitProfile.modules).sort(compareCodeUnits);
	if (
		JSON.stringify(modulePaths) !==
		JSON.stringify(Object.keys(publishedProfile.modules).sort(compareCodeUnits))
	) {
		throw new Error(
			'wasm-rust published executable graph module set differs from explicit dist'
		);
	}
	const publications = [];
	for (const modulePath of modulePaths) {
		const sourceModule = explicitProfile.modules[modulePath];
		const publishedModule = publishedProfile.modules[modulePath];
		if (
			sourceModule.logical.bytes !== publishedModule.logical.bytes ||
			sourceModule.logical.sha256 !== publishedModule.logical.sha256
		) {
			throw new Error(
				`wasm-rust published executable module logical receipt differs: ${modulePath}`
			);
		}
		const sourcePath = path.join(rootDir, ...modulePath.split('/'));
		const sourceStats = await lstat(sourcePath, { bigint: true }).catch(() => null);
		if (!sourceStats?.isFile()) {
			throw new Error(`wasm-rust explicit executable module is missing: ${modulePath}`);
		}
		await requireRealpathInsideGraphRoot(
			rootDir,
			sourcePath,
			`wasm-rust explicit executable module ${modulePath}`
		);
		const logicalBytes = await readRegularFileOnce(
			sourcePath,
			`wasm-rust explicit executable module ${modulePath}`
		);
		if (
			logicalBytes.byteLength !== sourceModule.logical.bytes ||
			sha256(logicalBytes) !== sourceModule.logical.sha256
		) {
			throw new Error(`wasm-rust explicit executable module changed: ${modulePath}`);
		}
		const storageBytes =
			publishedModule.delivery.encoding === 'gzip'
				? gzipSync(logicalBytes, { level: 9 })
				: logicalBytes;
		if (
			storageBytes.byteLength !== publishedModule.storage.bytes ||
			sha256(storageBytes) !== publishedModule.storage.sha256
		) {
			throw new Error(
				`wasm-rust published executable module storage receipt differs: ${modulePath}`
			);
		}
		const storagePath = publishedModule.delivery.storagePath;
		if (!storagePath.endsWith(RUST_EXECUTABLE_GRAPH_INERT_SUFFIX)) {
			throw new Error(
				`wasm-rust published executable module storage is not inert: ${modulePath}`
			);
		}
		const targetPath = path.join(rootDir, ...storagePath.split('/'));
		if (await lstat(targetPath).catch(() => null)) {
			throw new Error(
				`wasm-rust published executable module storage already exists: ${modulePath}`
			);
		}
		publications.push({
			logicalPath: sourcePath,
			storageBytes,
			storagePath: targetPath,
			mode: Number(sourceStats.mode & 0o777n)
		});
	}
	for (const publication of publications) {
		await writeFile(publication.storagePath, publication.storageBytes, {
			flag: 'wx',
			mode: publication.mode
		});
	}
	for (const publication of publications) await unlink(publication.logicalPath);
}

/** @param {string} rootDir */
async function collectManifestDynamicModuleSpecifiers(rootDir) {
	const manifestPath = path.join(rootDir, 'runtime', 'runtime-manifest.v3.json');
	await lstatContainedGraphPath(
		rootDir,
		'runtime/runtime-manifest.v3.json',
		'wasm-rust executable graph runtime manifest'
	);
	await requireRealpathInsideGraphRoot(
		rootDir,
		manifestPath,
		'wasm-rust executable graph runtime manifest'
	);
	const bytes = await readRegularFileOnce(
		manifestPath,
		'wasm-rust executable graph runtime manifest'
	);
	let manifest;
	try {
		manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch (error) {
		throw new Error('wasm-rust executable graph runtime manifest is invalid', { cause: error });
	}
	const targets = expectObject(
		expectObject(manifest, 'wasm-rust runtime manifest').targets,
		'wasm-rust runtime manifest targets'
	);
	/** @type {Map<string,string>} */
	const semanticEdges = new Map();
	for (const rawTarget of Object.values(targets)) {
		if (!isObject(rawTarget) || !isObject(rawTarget.compile)) continue;
		const compile = rawTarget.compile;
		if (String(compile.kind || '').startsWith('integrated-rustc')) continue;
		if (!isObject(compile.llvm)) {
			throw new Error('wasm-rust non-integrated target is missing its LLVM module profile');
		}
		for (const field of ['llc', 'lld']) {
			const specifier = compile.llvm[field];
			if (typeof specifier !== 'string' || !specifier.endsWith('.js')) {
				throw new Error(`wasm-rust runtime manifest LLVM ${field} module is invalid`);
			}
			requireModuleSpecifier(specifier, `wasm-rust runtime manifest LLVM ${field} module`);
			const target = path.posix.normalize(path.posix.join('runtime', specifier));
			requireSafeRelativePath(target, `wasm-rust runtime manifest LLVM ${field} target`);
			semanticEdges.set(`${specifier}\0${target}`, target);
		}
	}
	return [...semanticEdges.entries()]
		.map(([key, target]) => ({ specifier: key.slice(0, key.indexOf('\0')), target }))
		.sort(
			(left, right) =>
				compareCodeUnits(left.specifier, right.specifier) ||
				compareCodeUnits(left.target, right.target)
		);
}

/** @param {RustGraphModule} module @param {string} modulePath @param {Array<{specifier:string,target:string}>} semanticEdges */
function addManifestSemanticEdges(module, modulePath, semanticEdges) {
	if (!['browser-linker.js', 'compiler-preload.js'].includes(modulePath)) return module;
	const imports = [...module.imports];
	for (const { specifier, target } of semanticEdges) {
		imports.push({
			specifier,
			target,
			kind: 'dynamic'
		});
	}
	const unique = new Map();
	for (const graphImport of imports) {
		unique.set(
			`${graphImport.kind}\0${graphImport.specifier}\0${graphImport.target}`,
			graphImport
		);
	}
	return Object.freeze({
		...module,
		imports: Object.freeze(sortGraphImports([...unique.values()]))
	});
}

/** @param {string} rootDir @param {RustGraphAuthority} authority */
export async function inspectRustExecutableGraph(rootDir, authority) {
	if (!RUST_GRAPH_AUTHORITIES.has(authority)) {
		throw new Error('wasm-rust executable graph authority is invalid');
	}
	const resolvedRoot = path.resolve(rootDir);
	const rootStats = await lstat(resolvedRoot).catch(() => null);
	if (!rootStats?.isDirectory()) {
		throw new Error(`wasm-rust executable graph root is missing or unsafe: ${resolvedRoot}`);
	}
	const entryPath = 'index.js';
	/** @type {Array<{specifier:string,target:string}> | null} */
	let manifestDynamicSpecifiers = null;
	/** @type {Map<string,RustGraphModule>} */
	const modules = new Map();
	const queue = [entryPath];
	while (queue.length > 0) {
		const modulePath = /** @type {string} */ (queue.shift());
		if (modules.has(modulePath)) continue;
		if (modules.size >= MAX_GRAPH_MODULES) {
			throw new Error('wasm-rust executable graph contains too many modules');
		}
		if (
			manifestDynamicSpecifiers === null &&
			['browser-linker.js', 'compiler-preload.js'].includes(modulePath)
		) {
			manifestDynamicSpecifiers = await collectManifestDynamicModuleSpecifiers(resolvedRoot);
		}
		const graphModule = addManifestSemanticEdges(
			await readExecutableModule(resolvedRoot, modulePath, authority),
			modulePath,
			manifestDynamicSpecifiers || []
		);
		modules.set(modulePath, graphModule);
		for (const graphImport of graphModule.imports) {
			if (!modules.has(graphImport.target)) queue.push(graphImport.target);
		}
		for (const asset of graphModule.assets) {
			const assetPath = path.join(resolvedRoot, ...asset.target.split('/'));
			const assetStats = await lstatContainedGraphPath(
				resolvedRoot,
				asset.target,
				`wasm-rust executable graph core asset ${asset.target}`
			);
			if (!assetStats) {
				throw new Error(
					`wasm-rust executable graph core asset is missing or unsafe: ${asset.target}`
				);
			}
			await requireRealpathInsideGraphRoot(
				resolvedRoot,
				assetPath,
				`wasm-rust executable graph core asset ${asset.target}`
			);
		}
	}
	const moduleRecord = {};
	for (const modulePath of [...modules.keys()].sort(compareCodeUnits)) {
		moduleRecord[modulePath] = modules.get(modulePath);
	}
	const withoutFingerprint = Object.freeze({
		schemaVersion: 1,
		format: RUST_EXECUTABLE_GRAPH_FORMAT,
		authority,
		entryPath,
		modules: Object.freeze(moduleRecord)
	});
	return Object.freeze({
		...withoutFingerprint,
		fingerprint: computeRustExecutableGraphFingerprint(withoutFingerprint)
	});
}

/** @param {{schemaVersion:1,format:string,authority:RustGraphAuthority,entryPath:string,modules:Record<string,RustGraphModule>}} profile */
export function computeRustExecutableGraphFingerprint(profile) {
	let canonical = RUST_EXECUTABLE_GRAPH_FINGERPRINT_DOMAIN;
	canonical += `schema\0${profile.format}\0${profile.schemaVersion}\n`;
	canonical += `authority\0${profile.authority}\n`;
	canonical += `entry\0${profile.entryPath}\n`;
	const modulePaths = Object.keys(profile.modules).sort(compareCodeUnits);
	for (const modulePath of modulePaths) {
		const module = profile.modules[modulePath];
		canonical += `module\0${modulePath}\0${module.delivery.storagePath}\0${module.delivery.encoding}\0${module.storage.bytes}\0${module.storage.sha256}\0${module.logical.bytes}\0${module.logical.sha256}\n`;
	}
	const imports = modulePaths
		.flatMap((modulePath) =>
			profile.modules[modulePath].imports.map((graphImport) => ({
				importer: modulePath,
				...graphImport
			}))
		)
		.sort(
			(left, right) =>
				compareCodeUnits(left.importer, right.importer) ||
				compareCodeUnits(left.kind, right.kind) ||
				compareCodeUnits(left.specifier, right.specifier) ||
				compareCodeUnits(left.target, right.target)
		);
	for (const edge of imports) {
		canonical += `edge\0${edge.importer}\0${edge.kind}\0${edge.specifier}\0${edge.target}\n`;
	}
	const assets = modulePaths
		.flatMap((modulePath) =>
			profile.modules[modulePath].assets.map((asset) => ({ importer: modulePath, ...asset }))
		)
		.sort(
			(left, right) =>
				compareCodeUnits(left.importer, right.importer) ||
				compareCodeUnits(left.specifier, right.specifier) ||
				compareCodeUnits(left.target, right.target)
		);
	for (const asset of assets) {
		canonical += `asset\0${asset.importer}\0${asset.kind}\0${asset.specifier}\0${asset.target}\n`;
	}
	const externals = modulePaths
		.flatMap((modulePath) =>
			profile.modules[modulePath].externals.map((external) => ({
				importer: modulePath,
				...external
			}))
		)
		.sort(
			(left, right) =>
				compareCodeUnits(left.importer, right.importer) ||
				compareCodeUnits(left.specifier, right.specifier)
		);
	for (const external of externals) {
		canonical += `external\0${external.importer}\0${external.kind}\0${external.specifier}\0${external.condition}\n`;
	}
	return sha256(new TextEncoder().encode(canonical));
}

/** @param {unknown} value @param {string} label */
function parseGraphReceipt(value, label) {
	const receipt = expectObject(value, label);
	assertExactKeys(receipt, ['bytes', 'sha256'], label);
	const bytes = requireSafeInteger(receipt.bytes, `${label}.bytes`);
	if (bytes === 0) throw new Error(`${label}.bytes must be positive`);
	return Object.freeze({ bytes, sha256: requireSha256(receipt.sha256, `${label}.sha256`) });
}

/** @param {unknown} value @param {string} modulePath @param {RustGraphAuthority} authority */
function parseGraphLockModule(value, modulePath, authority) {
	const module = expectObject(value, `wasm-rust ${authority} graph module ${modulePath}`);
	assertExactKeys(
		module,
		['assets', 'delivery', 'externals', 'imports', 'logical', 'path', 'storage'],
		`wasm-rust ${authority} graph module ${modulePath}`
	);
	const parsedPath = requireSafeRelativePath(module.path, 'wasm-rust graph module path');
	if (parsedPath !== modulePath || !parsedPath.endsWith('.js')) {
		throw new Error(`wasm-rust graph module path is invalid: ${String(module.path)}`);
	}
	const delivery = expectObject(module.delivery, `wasm-rust graph module ${modulePath}.delivery`);
	assertExactKeys(
		delivery,
		['encoding', 'storagePath'],
		`wasm-rust graph module ${modulePath}.delivery`
	);
	const storagePath = requireSafeRelativePath(
		delivery.storagePath,
		`wasm-rust graph module ${modulePath} storagePath`
	);
	if (delivery.encoding !== 'identity' && delivery.encoding !== 'gzip') {
		throw new Error(`wasm-rust graph module ${modulePath} encoding is invalid`);
	}
	const expectedStoragePath =
		authority === 'explicit-dist'
			? modulePath
			: delivery.encoding === 'gzip'
				? `${modulePath}.gz${RUST_EXECUTABLE_GRAPH_INERT_SUFFIX}`
				: `${modulePath}${RUST_EXECUTABLE_GRAPH_INERT_SUFFIX}`;
	if (
		storagePath !== expectedStoragePath ||
		(authority === 'explicit-dist' && delivery.encoding !== 'identity') ||
		(authority === 'published-static' &&
			!storagePath.endsWith(RUST_EXECUTABLE_GRAPH_INERT_SUFFIX))
	) {
		throw new Error(
			`wasm-rust graph module ${modulePath} delivery is invalid for ${authority}`
		);
	}
	const storage = parseGraphReceipt(
		module.storage,
		`wasm-rust graph module ${modulePath}.storage`
	);
	const logical = parseGraphReceipt(
		module.logical,
		`wasm-rust graph module ${modulePath}.logical`
	);
	if (
		delivery.encoding === 'identity' &&
		(storage.bytes !== logical.bytes || storage.sha256 !== logical.sha256)
	) {
		throw new Error(`wasm-rust graph module ${modulePath} identity receipts differ`);
	}
	if (!Array.isArray(module.imports)) {
		throw new Error(`wasm-rust graph module ${modulePath}.imports must be an array`);
	}
	/** @type {RustGraphImport[]} */
	const imports = [];
	const importKeys = new Set();
	for (const [index, value] of module.imports.entries()) {
		const graphImport = expectObject(
			value,
			`wasm-rust graph module ${modulePath}.imports[${index}]`
		);
		assertExactKeys(
			graphImport,
			['kind', 'specifier', 'target'],
			`wasm-rust graph module ${modulePath}.imports[${index}]`
		);
		if (
			typeof graphImport.kind !== 'string' ||
			!RUST_GRAPH_LOCAL_EDGE_KINDS.has(graphImport.kind)
		) {
			throw new Error(`wasm-rust graph module ${modulePath} import kind is invalid`);
		}
		const kind = /** @type {'static'|'dynamic'|'worker'} */ (graphImport.kind);
		const specifier = requireModuleSpecifier(
			graphImport.specifier,
			`wasm-rust graph module ${modulePath} import specifier`
		);
		const target = requireSafeRelativePath(
			graphImport.target,
			`wasm-rust graph module ${modulePath} import target`
		);
		if (resolveLocalGraphTarget(modulePath, specifier, kind) !== target) {
			throw new Error(
				`wasm-rust graph module ${modulePath} import ${specifier} does not resolve to ${target}`
			);
		}
		const key = `${kind}\0${specifier}\0${target}`;
		if (importKeys.has(key)) {
			throw new Error(`wasm-rust graph module ${modulePath} repeats import ${specifier}`);
		}
		importKeys.add(key);
		imports.push({ kind, specifier, target });
	}
	if (!Array.isArray(module.assets)) {
		throw new Error(`wasm-rust graph module ${modulePath}.assets must be an array`);
	}
	/** @type {RustGraphAsset[]} */
	const assets = [];
	const assetKeys = new Set();
	for (const [index, value] of module.assets.entries()) {
		const asset = expectObject(value, `wasm-rust graph module ${modulePath}.assets[${index}]`);
		assertExactKeys(
			asset,
			['kind', 'specifier', 'target'],
			`wasm-rust graph module ${modulePath}.assets[${index}]`
		);
		if (asset.kind !== 'core-wasm') {
			throw new Error(`wasm-rust graph module ${modulePath} asset kind is invalid`);
		}
		const specifier = requireModuleSpecifier(
			asset.specifier,
			`wasm-rust graph module ${modulePath} asset specifier`
		);
		if (!specifier.startsWith('./') || !/\.core2?\.wasm$/u.test(specifier)) {
			throw new Error(`wasm-rust graph module ${modulePath} core asset specifier is invalid`);
		}
		const target = requireSafeRelativePath(
			asset.target,
			`wasm-rust graph module ${modulePath} asset target`
		);
		const key = `${specifier}\0${target}`;
		if (assetKeys.has(key)) {
			throw new Error(`wasm-rust graph module ${modulePath} repeats core asset ${specifier}`);
		}
		assetKeys.add(key);
		assets.push({ kind: 'core-wasm', specifier, target });
	}
	if (!Array.isArray(module.externals)) {
		throw new Error(`wasm-rust graph module ${modulePath}.externals must be an array`);
	}
	/** @type {RustGraphExternal[]} */
	const externals = [];
	for (const [index, value] of module.externals.entries()) {
		const external = expectObject(
			value,
			`wasm-rust graph module ${modulePath}.externals[${index}]`
		);
		assertExactKeys(
			external,
			['condition', 'kind', 'specifier'],
			`wasm-rust graph module ${modulePath}.externals[${index}]`
		);
		if (
			external.kind !== 'dynamic' ||
			external.condition !== 'node-only' ||
			external.specifier !== NODE_ONLY_EXTERNAL_IMPORT_RULES[modulePath] ||
			externals.length > 0
		) {
			throw new Error(`wasm-rust graph module ${modulePath} external import is invalid`);
		}
		externals.push({
			specifier: /** @type {string} */ (external.specifier),
			kind: 'dynamic',
			condition: 'node-only'
		});
	}
	if (NODE_ONLY_EXTERNAL_IMPORT_RULES[modulePath] && externals.length !== 1) {
		throw new Error(`wasm-rust graph module ${modulePath} omits its node-only import`);
	}
	return Object.freeze({
		delivery: Object.freeze({
			storagePath,
			encoding: /** @type {RustGraphEncoding} */ (delivery.encoding)
		}),
		storage,
		logical,
		imports: Object.freeze(sortGraphImports(imports)),
		assets: Object.freeze(sortGraphAssets(assets)),
		externals: Object.freeze(sortGraphExternals(externals))
	});
}

/** @param {unknown} value @param {RustGraphAuthority} authority */
function parseGraphLockAuthority(value, authority) {
	const raw = expectObject(value, `wasm-rust graph lock ${authority}`);
	assertExactKeys(raw, ['entryPath', 'modules'], `wasm-rust graph lock ${authority}`);
	const entryPath = requireSafeRelativePath(
		raw.entryPath,
		`wasm-rust graph lock ${authority}.entryPath`
	);
	if (entryPath !== 'index.js') {
		throw new Error(`wasm-rust graph lock ${authority} entry must be index.js`);
	}
	if (
		!Array.isArray(raw.modules) ||
		raw.modules.length === 0 ||
		raw.modules.length > MAX_GRAPH_MODULES
	) {
		throw new Error(
			`wasm-rust graph lock ${authority}.modules must be a bounded non-empty array`
		);
	}
	const moduleRecord = {};
	let edgeCount = 0;
	for (const [index, value] of raw.modules.entries()) {
		const candidate = expectObject(
			value,
			`wasm-rust graph lock ${authority}.modules[${index}]`
		);
		const modulePath = requireSafeRelativePath(
			candidate.path,
			`wasm-rust graph lock ${authority}.modules[${index}].path`
		);
		if (Object.prototype.hasOwnProperty.call(moduleRecord, modulePath)) {
			throw new Error(`wasm-rust graph lock ${authority} repeats module ${modulePath}`);
		}
		const module = parseGraphLockModule(candidate, modulePath, authority);
		edgeCount += module.imports.length + module.assets.length + module.externals.length;
		if (edgeCount > MAX_GRAPH_EDGES) {
			throw new Error(`wasm-rust graph lock ${authority} contains too many edges`);
		}
		moduleRecord[modulePath] = module;
	}
	if (!moduleRecord[entryPath]) {
		throw new Error(`wasm-rust graph lock ${authority} entry is missing`);
	}
	for (const [modulePath, module] of Object.entries(moduleRecord)) {
		for (const graphImport of module.imports) {
			if (!moduleRecord[graphImport.target]) {
				throw new Error(
					`wasm-rust graph lock ${authority} has an unknown edge ${modulePath} -> ${graphImport.target}`
				);
			}
		}
	}
	const reachable = new Set([entryPath]);
	const queue = [entryPath];
	while (queue.length > 0) {
		const modulePath = /** @type {string} */ (queue.shift());
		for (const graphImport of moduleRecord[modulePath].imports) {
			if (!reachable.has(graphImport.target)) {
				reachable.add(graphImport.target);
				queue.push(graphImport.target);
			}
		}
	}
	if (reachable.size !== Object.keys(moduleRecord).length) {
		const unreachable = Object.keys(moduleRecord)
			.filter((modulePath) => !reachable.has(modulePath))
			.sort(compareCodeUnits);
		throw new Error(
			`wasm-rust graph lock ${authority} contains unreachable modules: ${unreachable.join(', ')}`
		);
	}
	const orderedModules = {};
	for (const modulePath of Object.keys(moduleRecord).sort(compareCodeUnits)) {
		orderedModules[modulePath] = moduleRecord[modulePath];
	}
	const withoutFingerprint = Object.freeze({
		schemaVersion: 1,
		format: RUST_EXECUTABLE_GRAPH_FORMAT,
		authority,
		entryPath,
		modules: Object.freeze(orderedModules)
	});
	return Object.freeze({
		...withoutFingerprint,
		fingerprint: computeRustExecutableGraphFingerprint(withoutFingerprint)
	});
}

/** @param {Uint8Array} bytes */
export function parseRustExecutableGraphLock(bytes) {
	let parsed;
	try {
		parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch (error) {
		throw new Error('wasm-rust executable graph lock is not valid UTF-8 JSON', {
			cause: error
		});
	}
	const root = expectObject(parsed, 'wasm-rust executable graph lock');
	assertExactKeys(root, ['authorities', 'format'], 'wasm-rust executable graph lock');
	if (root.format !== RUST_EXECUTABLE_GRAPH_LOCK_FORMAT) {
		throw new Error('wasm-rust executable graph lock has an unsupported format');
	}
	const authorities = expectObject(root.authorities, 'wasm-rust executable graph authorities');
	assertExactKeys(
		authorities,
		['explicit-dist', 'published-static'],
		'wasm-rust executable graph authorities'
	);
	return Object.freeze({
		format: RUST_EXECUTABLE_GRAPH_LOCK_FORMAT,
		authorities: Object.freeze({
			'published-static': parseGraphLockAuthority(
				authorities['published-static'],
				'published-static'
			),
			'explicit-dist': parseGraphLockAuthority(authorities['explicit-dist'], 'explicit-dist')
		})
	});
}

/** @param {{publishedStaticProfile:Awaited<ReturnType<typeof inspectRustExecutableGraph>>;explicitDistProfile:Awaited<ReturnType<typeof inspectRustExecutableGraph>>}} profiles */
export function createRustExecutableGraphLockSource({
	publishedStaticProfile,
	explicitDistProfile
}) {
	if (
		publishedStaticProfile.authority !== 'published-static' ||
		explicitDistProfile.authority !== 'explicit-dist'
	) {
		throw new Error('wasm-rust executable graph lock profiles have swapped authorities');
	}
	for (const profile of [publishedStaticProfile, explicitDistProfile]) {
		if (
			profile.schemaVersion !== 1 ||
			profile.format !== RUST_EXECUTABLE_GRAPH_FORMAT ||
			profile.entryPath !== 'index.js' ||
			profile.fingerprint !== computeRustExecutableGraphFingerprint(profile)
		) {
			throw new Error(`wasm-rust ${profile.authority} graph profile is not canonical`);
		}
	}
	/** @param {Awaited<ReturnType<typeof inspectRustExecutableGraph>>} profile */
	const serializeAuthority = (profile) => ({
		entryPath: profile.entryPath,
		modules: Object.keys(profile.modules)
			.sort(compareCodeUnits)
			.map((modulePath) => ({ path: modulePath, ...profile.modules[modulePath] }))
	});
	const source = `${JSON.stringify(
		{
			format: RUST_EXECUTABLE_GRAPH_LOCK_FORMAT,
			authorities: {
				'published-static': serializeAuthority(publishedStaticProfile),
				'explicit-dist': serializeAuthority(explicitDistProfile)
			}
		},
		null,
		2
	)}\n`;
	parseRustExecutableGraphLock(new TextEncoder().encode(source));
	return source;
}

/** @param {Awaited<ReturnType<typeof inspectRustExecutableGraph>>} observed @param {ReturnType<typeof parseRustExecutableGraphLock>} lock */
function assertExecutableGraphMatchesLock(observed, lock) {
	const expected = lock.authorities[observed.authority];
	if (
		expected.entryPath !== observed.entryPath ||
		expected.fingerprint !== observed.fingerprint
	) {
		throw new Error(`wasm-rust ${observed.authority} executable graph differs from its lock`);
	}
}

/** @param {string} directoryPath */
async function syncDirectory(directoryPath) {
	const handle = await open(directoryPath, 'r');
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

/** @param {string} filePath */
async function syncFile(filePath) {
	const handle = await open(filePath, 'r');
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

/** @param {string} rootDir */
async function syncTree(rootDir) {
	const files = await listFiles(rootDir);
	for (const filePath of files) await syncFile(filePath);
	const directories = new Set([rootDir]);
	for (const filePath of files) {
		let directory = path.dirname(filePath);
		while (directory.startsWith(`${rootDir}${path.sep}`)) {
			directories.add(directory);
			directory = path.dirname(directory);
		}
	}
	for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
		await syncDirectory(directory);
	}
}

/** @param {string} filePath @param {string | Uint8Array} contents @param {number} [mode] */
async function writeDurableExclusiveFile(filePath, contents, mode = 0o600) {
	const handle = await open(filePath, 'wx', mode);
	try {
		await handle.writeFile(contents);
		await handle.sync();
	} finally {
		await handle.close();
	}
}

/** @param {string} candidate */
async function resolveBoundaryPath(candidate) {
	let cursor = path.resolve(candidate);
	const suffix = [];
	for (;;) {
		try {
			return path.join(await realpath(cursor), ...suffix);
		} catch (error) {
			const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
			if (code !== 'ENOENT') throw error;
			const parent = path.dirname(cursor);
			if (parent === cursor) throw error;
			suffix.unshift(path.basename(cursor));
			cursor = parent;
		}
	}
}

/** @param {string} left @param {string} right */
function pathsOverlap(left, right) {
	return (
		left === right ||
		left.startsWith(`${right}${path.sep}`) ||
		right.startsWith(`${left}${path.sep}`)
	);
}

/** @param {string} targetDir @param {string} [versionModulePath] */
export function getRustSyncControlPaths(targetDir, versionModulePath) {
	const resolved = path.resolve(targetDir);
	const resolvedVersion = path.resolve(
		versionModulePath ||
			(resolved === DEFAULT_TARGET_DIR
				? DEFAULT_VERSION_MODULE_PATH
				: `${resolved}.version.ts`)
	);
	const parent = path.dirname(resolved);
	const base = path.basename(resolved);
	return Object.freeze({
		syncLockPath: path.join(parent, `.${base}.sync.lock`),
		versionSyncLockPath: path.join(
			path.dirname(resolvedVersion),
			`.${path.basename(resolvedVersion)}.sync.lock`
		),
		transactionMarkerPath: path.join(parent, `.${base}.sync-transaction.json`)
	});
}

/** @param {string} lockPath */
async function acquireSyncLock(lockPath) {
	const token = randomUUID();
	let handle;
	try {
		handle = await open(lockPath, 'wx', 0o600);
	} catch (error) {
		const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
		if (code === 'EEXIST') {
			throw new Error(
				`wasm-rust sync lock already exists; remove it only after verifying no sync is active: ${lockPath}`
			);
		}
		throw error;
	}
	try {
		await handle.writeFile(
			`${JSON.stringify({ format: SYNC_LOCK_FORMAT, pid: process.pid, token }, null, 2)}\n`,
			'utf8'
		);
		await handle.sync();
		await syncDirectory(path.dirname(lockPath));
		return { handle, lockPath, token, stats: await handle.stat() };
	} catch (error) {
		const owned = await handle.stat().catch(() => null);
		await handle.close().catch(() => undefined);
		const current = await lstat(lockPath).catch(() => null);
		if (owned && current && owned.dev === current.dev && owned.ino === current.ino) {
			await unlink(lockPath);
			await syncDirectory(path.dirname(lockPath));
		}
		throw error;
	}
}

/** @param {{handle: import('node:fs/promises').FileHandle;lockPath:string;token:string;stats:import('node:fs').Stats}} lock */
async function releaseSyncLock(lock) {
	try {
		const current = await lstat(lock.lockPath).catch(() => null);
		if (!current || current.dev !== lock.stats.dev || current.ino !== lock.stats.ino) {
			throw new Error('wasm-rust sync lock ownership changed during publication');
		}
		const parsed = JSON.parse(
			(await readRegularFileOnce(lock.lockPath, 'wasm-rust sync lock')).toString('utf8')
		);
		if (
			!isObject(parsed) ||
			parsed.format !== SYNC_LOCK_FORMAT ||
			parsed.pid !== process.pid ||
			parsed.token !== lock.token
		) {
			throw new Error('wasm-rust sync lock ownership changed during publication');
		}
		const finalStats = await lstat(lock.lockPath).catch(() => null);
		if (!finalStats || finalStats.dev !== lock.stats.dev || finalStats.ino !== lock.stats.ino) {
			throw new Error('wasm-rust sync lock ownership changed during publication');
		}
		await unlink(lock.lockPath);
		await syncDirectory(path.dirname(lock.lockPath));
	} finally {
		await lock.handle.close();
	}
}

/** @param {string[]} lockPaths */
async function acquireSyncLocks(lockPaths) {
	const locks = [];
	try {
		for (const lockPath of [...new Set(lockPaths)].sort(compareCodeUnits)) {
			locks.push(await acquireSyncLock(lockPath));
		}
		return locks;
	} catch (error) {
		const releaseErrors = [];
		for (const lock of [...locks].reverse()) {
			try {
				await releaseSyncLock(lock);
			} catch (releaseError) {
				releaseErrors.push(releaseError);
			}
		}
		if (releaseErrors.length > 0) {
			throw new AggregateError(
				[error, ...releaseErrors],
				'wasm-rust lock acquisition and cleanup both failed'
			);
		}
		throw error;
	}
}

/** @param {Awaited<ReturnType<typeof acquireSyncLocks>>} locks */
async function releaseSyncLocks(locks) {
	const errors = [];
	for (const lock of [...locks].reverse()) {
		try {
			await releaseSyncLock(lock);
		} catch (error) {
			errors.push(error);
		}
	}
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) {
		throw new AggregateError(errors, 'wasm-rust sync lock releases failed');
	}
}

/** @param {string} target @param {string} transactionId @param {'staging'|'previous'} role */
function transactionSiblingPath(target, transactionId, role) {
	return path.join(path.dirname(target), `.${path.basename(target)}.${role}-${transactionId}`);
}

/** @param {Array<{target:string;kind:'directory'|'file'}>} base @param {string} transactionId */
function createPublications(base, transactionId) {
	return base.map((publication) => ({
		...publication,
		staging: transactionSiblingPath(publication.target, transactionId, 'staging'),
		previous: transactionSiblingPath(publication.target, transactionId, 'previous'),
		hadTarget: false
	}));
}

/** @param {string} markerPath @param {Record<string,unknown>} marker */
async function writeTransactionMarker(markerPath, marker) {
	const temporary = `${markerPath}.next`;
	await writeDurableExclusiveFile(temporary, `${JSON.stringify(marker, null, 2)}\n`);
	await rename(temporary, markerPath);
	await syncDirectory(path.dirname(markerPath));
}

/** @param {string} candidate @param {'directory'|'file'} kind */
async function requirePublicationType(candidate, kind) {
	const stats = await lstat(candidate).catch(() => null);
	if (!stats) return null;
	if (kind === 'directory' ? !stats.isDirectory() : !stats.isFile()) {
		throw new Error(`wasm-rust transaction path has an unsafe type: ${candidate}`);
	}
	return stats;
}

/** @param {string} candidate @param {'directory'|'file'} kind */
async function removePublicationPath(candidate, kind) {
	if (!(await requirePublicationType(candidate, kind))) return;
	await rm(candidate, { recursive: kind === 'directory', force: false });
	await syncDirectory(path.dirname(candidate));
}

/** @param {string} markerPath @param {Array<{target:string;kind:'directory'|'file'}>} base */
async function readTransactionMarker(markerPath, base) {
	let parsed;
	try {
		parsed = JSON.parse(
			(await readRegularFileOnce(markerPath, 'wasm-rust transaction marker')).toString('utf8')
		);
	} catch (error) {
		throw new Error(`wasm-rust transaction marker is invalid: ${markerPath}`, { cause: error });
	}
	const marker = expectObject(parsed, 'wasm-rust transaction marker');
	assertExactKeys(
		marker,
		['format', 'phase', 'publications', 'transactionId'],
		'wasm-rust transaction marker'
	);
	if (
		marker.format !== SYNC_TRANSACTION_FORMAT ||
		typeof marker.transactionId !== 'string' ||
		!UUID_PATTERN.test(marker.transactionId) ||
		!['preparing', 'prepared', 'committed'].includes(/** @type {string} */ (marker.phase)) ||
		!Array.isArray(marker.publications) ||
		marker.publications.length !== base.length
	) {
		throw new Error('wasm-rust transaction marker has invalid metadata');
	}
	const publications = createPublications(base, marker.transactionId);
	for (const [index, publication] of publications.entries()) {
		const raw = expectObject(marker.publications[index], 'wasm-rust transaction publication');
		assertExactKeys(
			raw,
			['hadTarget', 'kind', 'previous', 'staging', 'target'],
			'wasm-rust transaction publication'
		);
		if (
			raw.target !== publication.target ||
			raw.kind !== publication.kind ||
			raw.previous !== publication.previous ||
			raw.staging !== publication.staging ||
			typeof raw.hadTarget !== 'boolean'
		) {
			throw new Error('wasm-rust transaction marker does not match this publication');
		}
		publication.hadTarget = raw.hadTarget;
	}
	return { ...marker, publications };
}

/** @param {string} markerPath @param {Array<{target:string;kind:'directory'|'file'}>} base */
async function recoverTransaction(markerPath, base) {
	const temporary = `${markerPath}.next`;
	const temporaryStats = await lstat(temporary).catch(() => null);
	if (temporaryStats) {
		if (!temporaryStats.isFile()) {
			throw new Error(
				`wasm-rust transaction temporary path has an unsafe type: ${temporary}`
			);
		}
		await unlink(temporary);
		await syncDirectory(path.dirname(temporary));
	}
	if (!(await lstat(markerPath).catch(() => null))) return false;
	const marker = await readTransactionMarker(markerPath, base);
	if (marker.phase === 'committed') {
		for (const publication of marker.publications) {
			if (!(await requirePublicationType(publication.target, publication.kind))) {
				throw new Error(
					`wasm-rust committed publication is missing: ${publication.target}`
				);
			}
			await removePublicationPath(publication.previous, publication.kind);
			await removePublicationPath(publication.staging, publication.kind);
		}
	} else {
		for (const publication of [...marker.publications].reverse()) {
			const previous = await requirePublicationType(publication.previous, publication.kind);
			const target = await requirePublicationType(publication.target, publication.kind);
			const staging = await requirePublicationType(publication.staging, publication.kind);
			if (previous) {
				if (target) await removePublicationPath(publication.target, publication.kind);
				await rename(publication.previous, publication.target);
				await syncDirectory(path.dirname(publication.target));
			} else if (publication.hadTarget && !target) {
				throw new Error(
					`wasm-rust cannot recover missing prior publication: ${publication.target}`
				);
			} else if (!publication.hadTarget && target && !staging) {
				await removePublicationPath(publication.target, publication.kind);
			}
			await removePublicationPath(publication.staging, publication.kind);
		}
	}
	await unlink(markerPath);
	await syncDirectory(path.dirname(markerPath));
	return true;
}

const COMPONENT_BINARY_ASSET_PATHS = [
	'wasm-rust/vendor/jco/lib/wasi_snapshot_preview1.command.wasm',
	'wasm-rust/vendor/jco/obj/wasm-tools.core.wasm.gz',
	'wasm-rust/vendor/jco/obj/wasm-tools.core2.wasm',
	'wasm-rust/vendor/jco/obj/js-component-bindgen-component.core.wasm.gz',
	'wasm-rust/vendor/jco/obj/js-component-bindgen-component.core2.wasm'
];

function runtimeReceiptPath(assetPath) {
	const sharedLldPrefix = '../../shared/emscripten-lld/';
	assertCanonicalRustRuntimeAssetPath(assetPath, true);
	const relativePath = assetPath.startsWith(sharedLldPrefix)
		? assetPath.slice(sharedLldPrefix.length)
		: assetPath;
	if (assetPath.startsWith(sharedLldPrefix)) {
		return `shared/emscripten-lld/${relativePath}`;
	}
	return `wasm-rust/runtime/${assetPath}`;
}

function collectPackAssetPaths(pack, assetPaths) {
	if (!pack || typeof pack !== 'object') return;
	if (typeof pack.asset === 'string') assetPaths.add(runtimeReceiptPath(pack.asset));
	if (typeof pack.index === 'string') assetPaths.add(runtimeReceiptPath(pack.index));
	collectPackAssetPaths(pack.delta?.base, assetPaths);
}

function collectRuntimeManifestAssetPaths(manifest) {
	const assetPaths = new Set();
	if (typeof manifest.compiler?.rustcWasm === 'string') {
		assetPaths.add(runtimeReceiptPath(manifest.compiler.rustcWasm));
	}
	let needsComponentAssets = false;
	for (const target of Object.values(manifest.targets || {})) {
		if (!target || typeof target !== 'object') continue;
		collectPackAssetPaths(target.sysrootPack, assetPaths);
		for (const entry of target.sysrootFiles || []) {
			if (typeof entry?.asset === 'string') assetPaths.add(runtimeReceiptPath(entry.asset));
		}
		const compile = target.compile;
		if (
			compile &&
			typeof compile === 'object' &&
			!String(compile.kind).startsWith('integrated-rustc')
		) {
			assetPaths.add(runtimeReceiptPath(compile.llvm?.llcWasm || 'llvm/llc.wasm'));
			assetPaths.add(runtimeReceiptPath(compile.llvm?.lldWasm || 'llvm/lld.wasm'));
			assetPaths.add(runtimeReceiptPath(compile.llvm?.lldData || 'llvm/lld.data'));
			collectPackAssetPaths(compile.link?.pack, assetPaths);
			if (typeof compile.link?.allocatorObjectAsset === 'string') {
				assetPaths.add(runtimeReceiptPath(compile.link.allocatorObjectAsset));
			}
			for (const entry of compile.link?.files || []) {
				if (typeof entry?.asset === 'string')
					assetPaths.add(runtimeReceiptPath(entry.asset));
			}
		}
		needsComponentAssets ||=
			target.artifactFormat === 'component' ||
			target.execution?.kind === 'preview2-component' ||
			String(target.compile?.kind || '').endsWith('+component-encoder');
	}
	if (needsComponentAssets) {
		for (const assetPath of COMPONENT_BINARY_ASSET_PATHS) assetPaths.add(assetPath);
	}
	return [...assetPaths].sort();
}

/** @param {Uint8Array} storageBytes */
function receiptForBytes(storageBytes) {
	const storageSha256 = sha256(storageBytes);
	if (storageBytes[0] !== 0x1f || storageBytes[1] !== 0x8b) {
		return { bytes: storageBytes.byteLength, sha256: storageSha256 };
	}
	const logicalBytes = gunzipSync(storageBytes, { maxOutputLength: 2 * 1024 * 1024 * 1024 });
	return {
		bytes: storageBytes.byteLength,
		sha256: storageSha256,
		uncompressedBytes: logicalBytes.byteLength,
		uncompressedSha256: sha256(logicalBytes)
	};
}

/** @param {string} targetDir @param {string} sharedLldDir @param {ReadonlyMap<string,Uint8Array>} [sharedAssetSnapshot] */
async function writeRuntimeAssetReceipts(targetDir, sharedLldDir, sharedAssetSnapshot = new Map()) {
	const runtimeDir = path.join(targetDir, 'runtime');
	const manifestPath = path.join(runtimeDir, 'runtime-manifest.v3.json');
	const manifest = JSON.parse(
		(
			await readRegularFileOnce(manifestPath, 'wasm-rust runtime manifest receipt input')
		).toString('utf8')
	);
	delete manifest.assetReceipts;
	/** @type {Record<string,ReturnType<typeof receiptForBytes>>} */
	const assetReceipts = {};
	for (const assetPath of collectRuntimeManifestAssetPaths(manifest)) {
		const isSharedLldAsset = assetPath.startsWith('shared/emscripten-lld/');
		const assetRootDir = path.resolve(isSharedLldAsset ? sharedLldDir : targetDir);
		const relativePath = isSharedLldAsset
			? assetPath.slice('shared/emscripten-lld/'.length)
			: assetPath.slice('wasm-rust/'.length);
		const filePath = path.resolve(assetRootDir, relativePath);
		const relativeFilePath = path.relative(assetRootDir, filePath);
		if (
			relativeFilePath === '..' ||
			relativeFilePath.startsWith(`..${path.sep}`) ||
			path.isAbsolute(relativeFilePath)
		) {
			throw new Error(`wasm-rust runtime receipt asset escapes its root: ${assetPath}`);
		}
		const storageBytes = isSharedLldAsset
			? sharedAssetSnapshot.get(assetPath) ||
				(await readRegularFileOnce(
					filePath,
					`wasm-rust runtime receipt asset ${assetPath}`
				))
			: await readRegularFileOnce(filePath, `wasm-rust runtime receipt asset ${assetPath}`);
		assetReceipts[assetPath] = receiptForBytes(storageBytes);
	}
	manifest.assetReceipts = assetReceipts;
	const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
	await writeFile(manifestPath, manifestBytes);
	return {
		assetReceipts,
		manifestReceipt: {
			bytes: manifestBytes.byteLength,
			sha256: sha256(manifestBytes)
		}
	};
}

/** @param {string} sourceAssetDir @param {string} sharedLldDir */
async function snapshotSharedLldAssets(sourceAssetDir, sharedLldDir) {
	/** @type {Map<string,Uint8Array>} */
	const snapshot = new Map();
	/** @type {Array<{filePath:string,bytes:Uint8Array}>} */
	const fingerprintInputs = [];
	for (const assetName of SHARED_LLD_ASSET_NAMES) {
		const sourceBytes = await readRegularFileOnce(
			path.join(sourceAssetDir, assetName),
			`wasm-rust staged Emscripten LLD source ${assetName}`
		);
		const filePath = path.join(sharedLldDir, assetName);
		const sharedBytes = await readRegularFileOnce(
			filePath,
			`wasm-rust shared Emscripten LLD input ${assetName}`
		);
		const comparableSource =
			assetName === 'lld.js'
				? Buffer.from(sourceBytes.toString('utf8').replace(/[ \t]+$/gmu, ''))
				: sourceBytes;
		const comparableShared =
			assetName === 'lld.js'
				? Buffer.from(sharedBytes.toString('utf8').replace(/[ \t]+$/gmu, ''))
				: sharedBytes;
		if (!Buffer.from(comparableSource).equals(Buffer.from(comparableShared))) {
			throw new Error(
				`Emscripten LLD asset ${assetName} changed after validation in ${sharedLldDir}`
			);
		}
		const receiptPath = `shared/emscripten-lld/${assetName}`;
		snapshot.set(receiptPath, sharedBytes);
		fingerprintInputs.push({ filePath, bytes: sharedBytes });
	}
	return Object.freeze({ snapshot, fingerprintInputs: Object.freeze(fingerprintInputs) });
}

/** @param {Awaited<ReturnType<typeof inspectRustExecutableGraph>>} graphProfile */
export function createRustExecutableGraphManifestSource(graphProfile) {
	return `${JSON.stringify(graphProfile, null, 2)}\n`;
}

/** @param {Awaited<ReturnType<typeof inspectRustExecutableGraph>>} graphProfile @param {Awaited<ReturnType<typeof writeRuntimeAssetReceipts>>} runtimeProfile */
function assertGraphCoreAssetReceipts(graphProfile, runtimeProfile) {
	for (const [modulePath, module] of Object.entries(graphProfile.modules)) {
		for (const asset of module.assets) {
			const receiptPath = `wasm-rust/${asset.target}`;
			if (!runtimeProfile.assetReceipts[receiptPath]) {
				throw new Error(
					`wasm-rust executable graph core asset ${modulePath} -> ${asset.target} has no runtime receipt`
				);
			}
		}
	}
}

/** @param {string} fingerprint @param {Awaited<ReturnType<typeof writeRuntimeAssetReceipts>>} runtimeProfile @param {Awaited<ReturnType<typeof inspectRustExecutableGraph>>} graphProfile */
export async function createRustVersionModuleSource(fingerprint, runtimeProfile, graphProfile) {
	const unformattedModuleSource = `export const WASM_RUST_RUNTIME_PROFILE = Object.freeze(${JSON.stringify(
		{
			profileId: `wasm-rust-${fingerprint}`,
			protocolVersion: 1,
			manifestPath: 'runtime/runtime-manifest.v3.json',
			manifestFingerprint: fingerprint,
			manifestReceipt: runtimeProfile.manifestReceipt,
			assetReceipts: runtimeProfile.assetReceipts
		},
		null,
		2
	)} as const);\n\nexport const WASM_RUST_EXECUTABLE_GRAPH_FORMAT = ${JSON.stringify(
		RUST_EXECUTABLE_GRAPH_FORMAT
	)} as const;\nexport const WASM_RUST_EXECUTABLE_GRAPH_FINGERPRINT_DOMAIN = ${JSON.stringify(
		RUST_EXECUTABLE_GRAPH_FINGERPRINT_DOMAIN
	)} as const;\nexport const WASM_RUST_EXECUTABLE_GRAPH_MANIFEST_PATH = ${JSON.stringify(
		RUST_EXECUTABLE_GRAPH_MANIFEST_PATH
	)} as const;\nexport const WASM_RUST_EXECUTABLE_GRAPH_PROFILE = Object.freeze(${JSON.stringify(
		graphProfile,
		null,
		2
	)} as const);\n\nexport const WASM_RUST_ASSET_VERSION = WASM_RUST_RUNTIME_PROFILE.manifestFingerprint;\n`;
	return format(unformattedModuleSource, {
		parser: 'typescript',
		printWidth: 100,
		singleQuote: true,
		tabWidth: 4,
		trailingComma: 'none',
		useTabs: true
	});
}

export async function refreshWasmRustRuntimeProfile(options = {}) {
	return syncWasmRustDist(options);
}

/**
 * @typedef {object} SyncWasmRustDistOptions
 * @property {string} [sourceDir]
 * @property {string} [targetDir]
 * @property {string} [versionModulePath]
 * @property {string} [sharedLldDir]
 * @property {string} [canonicalLldDir]
 * @property {string} [graphLockPath]
 * @property {string} [syncLockPath]
 * @property {string} [transactionMarkerPath]
 * @property {typeof rename} [renamePath]
 */

/**
 * @param {SyncWasmRustDistOptions} [options]
 */
export async function syncWasmRustDist(options = {}) {
	const targetDir = path.resolve(options.targetDir || DEFAULT_TARGET_DIR);
	const sourceDir = path.resolve(options.sourceDir || targetDir);
	const sourceMode = /** @type {RustGraphAuthority} */ (
		options.sourceDir ? 'explicit-dist' : 'published-static'
	);
	const versionModulePath = path.resolve(
		options.versionModulePath ||
			(targetDir === DEFAULT_TARGET_DIR
				? DEFAULT_VERSION_MODULE_PATH
				: `${targetDir}.version.ts`)
	);
	const sharedLldDir = path.resolve(options.sharedLldDir || DEFAULT_SHARED_LLD_DIR);
	const canonicalLldDir = path.resolve(options.canonicalLldDir || sharedLldDir);
	const graphLockPath = path.resolve(options.graphLockPath || DEFAULT_GRAPH_LOCK_PATH);
	const controlDefaults = getRustSyncControlPaths(targetDir, versionModulePath);
	const syncLockPath = path.resolve(options.syncLockPath || controlDefaults.syncLockPath);
	const versionSyncLockPath = path.resolve(controlDefaults.versionSyncLockPath);
	const transactionMarkerPath = path.resolve(
		options.transactionMarkerPath || controlDefaults.transactionMarkerPath
	);
	const transactionMarkerTemporaryPath = `${transactionMarkerPath}.next`;
	const renamePath = options.renamePath || rename;
	if (
		(options.syncLockPath && syncLockPath !== path.resolve(controlDefaults.syncLockPath)) ||
		(options.transactionMarkerPath &&
			transactionMarkerPath !== path.resolve(controlDefaults.transactionMarkerPath))
	) {
		throw new Error(
			'wasm-rust custom sync control paths are not supported because they split the publication lock domain'
		);
	}
	if (targetDir === path.parse(targetDir).root) {
		throw new Error('wasm-rust target must not be a filesystem root');
	}
	const [
		targetBoundary,
		sourceBoundary,
		versionBoundary,
		sharedBoundary,
		canonicalBoundary,
		graphLockBoundary,
		syncLockBoundary,
		versionSyncLockBoundary,
		markerBoundary,
		markerTemporaryBoundary
	] = await Promise.all(
		[
			targetDir,
			sourceDir,
			versionModulePath,
			sharedLldDir,
			canonicalLldDir,
			graphLockPath,
			syncLockPath,
			versionSyncLockPath,
			transactionMarkerPath,
			transactionMarkerTemporaryPath
		].map(resolveBoundaryPath)
	);
	if (options.sourceDir && sourceBoundary === targetBoundary) {
		throw new Error(
			'wasm-rust explicit dist source must be distinct from the published static target'
		);
	}
	if (pathsOverlap(targetBoundary, versionBoundary)) {
		throw new Error('wasm-rust runtime target and generated module must not overlap');
	}
	if (
		sourceBoundary !== targetBoundary &&
		(pathsOverlap(sourceBoundary, targetBoundary) ||
			pathsOverlap(sourceBoundary, versionBoundary))
	) {
		throw new Error('wasm-rust explicit dist source must not overlap publication outputs');
	}
	if (
		pathsOverlap(sharedBoundary, targetBoundary) ||
		pathsOverlap(sharedBoundary, versionBoundary) ||
		pathsOverlap(canonicalBoundary, targetBoundary) ||
		pathsOverlap(canonicalBoundary, versionBoundary)
	) {
		throw new Error('wasm-rust shared LLVM inputs must not overlap publication outputs');
	}
	if (
		pathsOverlap(graphLockBoundary, targetBoundary) ||
		pathsOverlap(graphLockBoundary, versionBoundary) ||
		pathsOverlap(graphLockBoundary, sourceBoundary)
	) {
		throw new Error(
			'wasm-rust executable graph lock must not overlap source or publication outputs'
		);
	}
	const controls = [
		syncLockBoundary,
		versionSyncLockBoundary,
		markerBoundary,
		markerTemporaryBoundary
	];
	const boundaries = [
		targetBoundary,
		sourceBoundary,
		versionBoundary,
		sharedBoundary,
		canonicalBoundary,
		graphLockBoundary
	];
	for (let index = 0; index < controls.length; index += 1) {
		for (let other = index + 1; other < controls.length; other += 1) {
			if (pathsOverlap(controls[index], controls[other])) {
				throw new Error('wasm-rust sync control paths must not overlap');
			}
		}
		for (const boundary of boundaries) {
			if (pathsOverlap(controls[index], boundary)) {
				throw new Error('wasm-rust sync controls must not overlap inputs or outputs');
			}
		}
	}
	await Promise.all([
		mkdir(path.dirname(targetDir), { recursive: true }),
		mkdir(path.dirname(versionModulePath), { recursive: true }),
		mkdir(path.dirname(syncLockPath), { recursive: true }),
		mkdir(path.dirname(versionSyncLockPath), { recursive: true }),
		mkdir(path.dirname(transactionMarkerPath), { recursive: true })
	]);
	const basePublications = [
		{ target: targetDir, kind: /** @type {'directory'} */ ('directory') },
		{ target: versionModulePath, kind: /** @type {'file'} */ ('file') }
	];
	const syncLocks = await acquireSyncLocks([syncLockPath, versionSyncLockPath]);
	let result;
	let operationError;
	try {
		await recoverTransaction(transactionMarkerPath, basePublications);
		const sourceStats = await lstat(sourceDir).catch(() => null);
		if (!sourceStats?.isDirectory()) {
			throw new Error(
				sourceMode === 'explicit-dist'
					? `wasm-rust dist directory was not found at ${sourceDir}. Build wasm-rust first with "pnpm --dir runtimes/wasm-rust build".`
					: `wasm-rust published runtime directory is missing or unsafe: ${sourceDir}`
			);
		}
		const graphLock = parseRustExecutableGraphLock(
			await readRegularFileOnce(graphLockPath, 'wasm-rust executable graph lock')
		);
		const transactionId = randomUUID();
		const publications = createPublications(basePublications, transactionId);
		for (const publication of publications) {
			publication.hadTarget = Boolean(
				await requirePublicationType(publication.target, publication.kind)
			);
			if (await lstat(publication.staging).catch(() => null)) {
				throw new Error(`wasm-rust staging path already exists: ${publication.staging}`);
			}
			if (await lstat(publication.previous).catch(() => null)) {
				throw new Error(`wasm-rust previous path already exists: ${publication.previous}`);
			}
		}
		const marker = {
			format: SYNC_TRANSACTION_FORMAT,
			transactionId,
			phase: 'preparing',
			publications: publications.map(({ target, kind, staging, previous, hadTarget }) => ({
				target,
				kind,
				staging,
				previous,
				hadTarget
			}))
		};
		await writeTransactionMarker(transactionMarkerPath, marker);
		try {
			const runtimePublication = publications[0];
			const versionPublication = publications[1];
			await copyDirectory(sourceDir, runtimePublication.staging);
			const stagedGraphManifestPath = path.join(
				runtimePublication.staging,
				RUST_EXECUTABLE_GRAPH_MANIFEST_PATH
			);
			const priorGraphManifestStats = await lstat(stagedGraphManifestPath).catch(() => null);
			if (priorGraphManifestStats) {
				if (!priorGraphManifestStats.isFile()) {
					throw new Error(
						`wasm-rust staged graph manifest has an unsafe type: ${stagedGraphManifestPath}`
					);
				}
				await unlink(stagedGraphManifestPath);
			}
			const rustRuntimeProfile = await validateRustRuntimeProfile(runtimePublication.staging);
			if (
				sourceMode === 'explicit-dist' &&
				rustRuntimeProfile.profile.id !== 'rustc-integrated-llvm'
			) {
				throw new Error(
					'wasm-rust explicit dist executable graph requires the integrated Rust producer; legacy split-LLVM dist is outside this graph trust contract'
				);
			}
			const hasSharedLldAssets =
				rustRuntimeProfile.hasEmscriptenLld && rustRuntimeProfile.llvmAssetDir
					? await validateSharedEmscriptenLldAssets({
							sourceAssetDir: rustRuntimeProfile.llvmAssetDir,
							sharedAssetDir: canonicalLldDir
						})
					: false;
			if (hasSharedLldAssets && canonicalBoundary !== sharedBoundary) {
				throw new Error(
					'wasm-rust canonical and published shared LLVM directories must match before publication'
				);
			}
			const sharedLldSnapshot =
				hasSharedLldAssets && rustRuntimeProfile.llvmAssetDir
					? await snapshotSharedLldAssets(rustRuntimeProfile.llvmAssetDir, sharedLldDir)
					: Object.freeze({
							snapshot: new Map(),
							fingerprintInputs: Object.freeze([])
						});
			if (sourceMode === 'explicit-dist') {
				await rewriteBrowserWasiShimImports(runtimePublication.staging);
			}
			const runtimeProfile = await writeRuntimeAssetReceipts(
				runtimePublication.staging,
				sharedLldDir,
				sharedLldSnapshot.snapshot
			);
			const sourceGraphProfile = await inspectRustExecutableGraph(
				runtimePublication.staging,
				sourceMode
			);
			assertExecutableGraphMatchesLock(sourceGraphProfile, graphLock);
			if (sourceMode === 'explicit-dist') {
				await publishInertExecutableGraphStorage(
					runtimePublication.staging,
					sourceGraphProfile,
					graphLock.authorities['published-static']
				);
			}
			await removeUnverifiedRawJavaScript(runtimePublication.staging);
			const executableGraphProfile = await inspectRustExecutableGraph(
				runtimePublication.staging,
				'published-static'
			);
			assertExecutableGraphMatchesLock(executableGraphProfile, graphLock);
			assertGraphCoreAssetReceipts(executableGraphProfile, runtimeProfile);
			await writeFile(
				path.join(runtimePublication.staging, RUST_EXECUTABLE_GRAPH_MANIFEST_PATH),
				createRustExecutableGraphManifestSource(executableGraphProfile),
				{ flag: 'wx', mode: 0o644 }
			);
			const fingerprint = await computeBundleFingerprint(runtimePublication.staging, [
				...sharedLldSnapshot.fingerprintInputs
			]);
			const versionModuleSource = await createRustVersionModuleSource(
				fingerprint,
				runtimeProfile,
				executableGraphProfile
			);
			await writeDurableExclusiveFile(versionPublication.staging, versionModuleSource, 0o644);
			await syncTree(runtimePublication.staging);
			marker.phase = 'prepared';
			await writeTransactionMarker(transactionMarkerPath, marker);
			for (const publication of publications) {
				if (publication.hadTarget) {
					await renamePath(publication.target, publication.previous);
					await syncDirectory(path.dirname(publication.target));
				}
				await renamePath(publication.staging, publication.target);
				await syncDirectory(path.dirname(publication.target));
			}
			marker.phase = 'committed';
			await writeTransactionMarker(transactionMarkerPath, marker);
			for (const publication of publications) {
				await removePublicationPath(publication.previous, publication.kind);
			}
			await unlink(transactionMarkerPath);
			await syncDirectory(path.dirname(transactionMarkerPath));
			result = {
				sourceDir,
				sourceMode,
				targetDir,
				fingerprint,
				runtimeProfile,
				executableGraphProfile,
				graphManifestPath: path.join(targetDir, RUST_EXECUTABLE_GRAPH_MANIFEST_PATH),
				versionModulePath
			};
		} catch (error) {
			try {
				await recoverTransaction(transactionMarkerPath, basePublications);
			} catch (recoveryError) {
				throw new AggregateError(
					[error, recoveryError],
					'wasm-rust publication and rollback both failed'
				);
			}
			throw error;
		}
	} catch (error) {
		operationError = error;
	}
	try {
		await releaseSyncLocks(syncLocks);
	} catch (releaseError) {
		if (operationError) {
			throw new AggregateError(
				[operationError, releaseError],
				'wasm-rust sync and lock release both failed'
			);
		}
		throw releaseError;
	}
	if (operationError) throw operationError;
	return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const result = await syncWasmRustDist({
		...(sourceDirArg ? { sourceDir: path.resolve(sourceDirArg) } : {}),
		...(targetDirArg ? { targetDir: path.resolve(targetDirArg) } : {})
	});
	console.log(
		result.sourceMode === 'published-static'
			? `Refreshed wasm-rust profile from checked static assets at ${result.targetDir}`
			: `Synced wasm-rust from explicit dist ${result.sourceDir} to ${result.targetDir}`
	);
}
