import type { SandboxWorkspaceFile } from '$lib/playground/options';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import {
	configureWorkerRuntimeAssets,
	handleWorkerAssetMessage,
	type WorkerRuntimeAssetConfig
} from '$lib/playground/worker/assets';
import type { BrowserClangArtifact, BrowserClangRuntime as Clang } from 'wasm-clang';
import {
	BrowserClangRuntime,
	executeBrowserClangArtifact,
	loadRuntimeManifest,
	resolveRuntimeManifestUrl
} from 'wasm-clang';

declare let self: any;
self.document = {
	querySelectorAll() {
		return [];
	}
};

interface ObjectiveCWorkerAssetConfig {
	libobjcUrl: string;
	headersUrl: string;
	libgnustepBaseUrl: string;
	libgnustepBaseObjectUrl: string;
	foundationHeadersUrl: string;
	libffiUrl: string;
}

type ObjectiveCSourceLanguage = 'c' | 'objective-c';
type ObjectiveCBrowserClangArtifact = BrowserClangArtifact & { needsLibffi: boolean };

const textDecoder = new TextDecoder();

const FFI_TYPE_VOID = 0;
const FFI_TYPE_INT = 1;
const FFI_TYPE_FLOAT = 2;
const FFI_TYPE_DOUBLE = 3;
const FFI_TYPE_UINT8 = 5;
const FFI_TYPE_SINT8 = 6;
const FFI_TYPE_UINT16 = 7;
const FFI_TYPE_SINT16 = 8;
const FFI_TYPE_UINT32 = 9;
const FFI_TYPE_SINT32 = 10;
const FFI_TYPE_UINT64 = 11;
const FFI_TYPE_SINT64 = 12;
const FFI_TYPE_POINTER = 14;
const freeObjectiveCTableIndexes: number[] = [];
const FOUNDATION_INCLUDE_PATTERN = /^\s*#\s*(?:include|import)(?:_next)?\s+[<"]([^>"]+)[>"]/gm;
const FOUNDATION_DIRECT_HEADER_PREFIXES = ['Foundation/', 'GNUstepBase/', 'CoreFoundation/'];
const FOUNDATION_OBJECTIVEC2_BLOCKS_HEADER = 'ObjectiveC2/blocks_runtime.h';
const FOUNDATION_OBJECTIVEC2_RUNTIME_HEADER = 'ObjectiveC2/objc/runtime.h';
const FOUNDATION_BLOCKS_MACRO_SHIM = `
#ifndef BLOCK_SCOPE
#define BLOCK_SCOPE __block
#endif
#ifndef DEFINE_BLOCK_TYPE
#define DEFINE_BLOCK_TYPE(name, retTy, argTys, ...) typedef retTy(^name)(argTys, ## __VA_ARGS__)
#endif
#ifndef DEFINE_BLOCK_TYPE_NO_ARGS
#define DEFINE_BLOCK_TYPE_NO_ARGS(name, retTy) typedef retTy(^name)()
#endif
#ifndef CALL_NON_NULL_BLOCK
#define CALL_NON_NULL_BLOCK(block, args, ...) block(args, ## __VA_ARGS__)
#endif
#ifndef CALL_NON_NULL_BLOCK_NO_ARGS
#define CALL_NON_NULL_BLOCK_NO_ARGS(block) block()
#endif
`;

const OBJC_CONSTRUCTOR_SOURCE = `extern void __wasm_idle_objc_load(void) __asm__(".objcv2_load_function") __attribute__((weak));

__attribute__((constructor))
static void __wasm_idle_objc_ctor(void)
{
    if (__wasm_idle_objc_load) __wasm_idle_objc_load();
}
`;

const FOUNDATION_LINK_ROOT_SYMBOLS = [
	'._OBJC_CLASS_NSObject',
	'._OBJC_CLASS_NSConstantString',
	'GSPrivateNotifyASAP'
];

let stdinBufferObjectiveC: Int32Array | null = null;
let clang: Clang | null = null;
let objectiveCAssetsObjectiveC: ObjectiveCWorkerAssetConfig | null = null;
let buildCounter = 0;
let preparedArtifactObjectiveC: ObjectiveCBrowserClangArtifact | null = null;
let preparedArtifactKeyObjectiveC = '';
let foundationAssetsLoadedObjectiveC = false;
let foundationHeadersObjectiveC: Record<string, string> | null = null;
let libgnustepBaseBytesObjectiveC: Uint8Array | null = null;
let libffiBytesObjectiveC: Uint8Array | null = null;
let foundationLibrariesInstalledObjectiveC = false;
const installedHeaderPathsObjectiveC = new Set<string>();
let hasInitialStdinObjectiveC = false;
let initialStdinObjectiveC: string | null = null;
let initialStdinConsumedObjectiveC = false;

const normalizeWorkspacePath = (value: string) =>
	value
		.replaceAll('\\', '/')
		.split('/')
		.filter((part) => part && part !== '.' && part !== '..')
		.join('/');

const basename = (value: string) => value.split('/').pop() || value;

const stemOf = (value: string) => basename(value).replace(/\.[^.]+$/, '') || 'main';

const ensureTrailingNewline = (source: string) => (source.endsWith('\n') ? source : `${source}\n`);

const resolveInputPath = (activePath?: string) => {
	const normalized = normalizeWorkspacePath(activePath || '');
	if (!normalized) return 'main.m';
	return /\.[A-Za-z0-9_-]+$/.test(normalized) ? normalized : `${normalized}.m`;
};

function hasGzipContentEncoding(response: Response) {
	const contentEncoding = response.headers.get('content-encoding') || '';
	return contentEncoding
		.toLowerCase()
		.split(',')
		.map((value) => value.trim())
		.includes('gzip');
}

async function inflateGzipResponse(response: Response, label: string) {
	if (hasGzipContentEncoding(response)) {
		return new Uint8Array(await response.arrayBuffer());
	}
	if (!response.body || typeof DecompressionStream !== 'function') {
		throw new Error(`${label} is gzip-compressed, but DecompressionStream is unavailable.`);
	}
	const decompressed = response.body.pipeThrough(new DecompressionStream('gzip'));
	return new Uint8Array(await new Response(decompressed).arrayBuffer());
}

async function fetchBytes(url: string, label: string) {
	const response = await fetch(url);
	if (!response.ok) {
		const compressedResponse = await fetch(`${url}.gz`).catch(() => null);
		if (!compressedResponse?.ok) {
			throw new Error(`Failed to load ${label}: ${response.status}`);
		}
		return inflateGzipResponse(compressedResponse, label);
	}
	return new Uint8Array(await response.arrayBuffer());
}

async function fetchJson(url: string, label: string) {
	return JSON.parse(textDecoder.decode(await fetchBytes(url, label))) as Record<string, string>;
}

function createObjectiveCLibffiImports(instanceRef: { current: WebAssembly.Instance | null }) {
	const dataView = () => {
		const memory = instanceRef.current?.exports.memory;
		if (!(memory instanceof WebAssembly.Memory)) {
			throw new Error('Objective-C libffi bridge missing exported memory');
		}
		return new DataView(memory.buffer);
	};
	const functionTable = () => {
		const table = instanceRef.current?.exports.__indirect_function_table;
		if (!(table instanceof WebAssembly.Table)) {
			throw new Error('Objective-C libffi bridge missing exported function table');
		}
		return table;
	};
	const malloc = () => {
		const exportedMalloc = instanceRef.current?.exports.malloc;
		if (typeof exportedMalloc !== 'function') {
			throw new Error('Objective-C libffi bridge missing exported malloc');
		}
		return exportedMalloc as (size: number) => number;
	};
	const free = () => {
		const exportedFree = instanceRef.current?.exports.free;
		if (typeof exportedFree !== 'function') {
			throw new Error('Objective-C libffi bridge missing exported free');
		}
		return exportedFree as (pointer: number) => void;
	};
	const emptyTableSlot = () => {
		const table = functionTable();
		const reused = freeObjectiveCTableIndexes.pop();
		if (reused != null) return reused;
		const index = table.length;
		table.grow(1);
		return index;
	};
	const readU32 = (view: DataView, pointer: number) => view.getUint32(pointer, true);
	const readTypeId = (view: DataView, typePointer: number) =>
		view.getUint16(typePointer + 6, true);
	const readArgument = (view: DataView, argPointer: number, typeId: number): number | bigint => {
		switch (typeId) {
			case FFI_TYPE_INT:
			case FFI_TYPE_UINT32:
				return view.getUint32(argPointer, true);
			case FFI_TYPE_SINT32:
				return view.getInt32(argPointer, true);
			case FFI_TYPE_FLOAT:
				return view.getFloat32(argPointer, true);
			case FFI_TYPE_DOUBLE:
				return view.getFloat64(argPointer, true);
			case FFI_TYPE_UINT8:
				return view.getUint8(argPointer);
			case FFI_TYPE_SINT8:
				return view.getInt8(argPointer);
			case FFI_TYPE_UINT16:
				return view.getUint16(argPointer, true);
			case FFI_TYPE_SINT16:
				return view.getInt16(argPointer, true);
			case FFI_TYPE_UINT64:
				return view.getBigUint64(argPointer, true);
			case FFI_TYPE_SINT64:
				return view.getBigInt64(argPointer, true);
			case FFI_TYPE_POINTER:
				return view.getUint32(argPointer, true);
			default:
				throw new Error(`Objective-C libffi bridge cannot marshal argument type ${typeId}`);
		}
	};
	const writeResult = (view: DataView, rvalue: number, typeId: number, result: unknown) => {
		if (!rvalue || typeId === FFI_TYPE_VOID) return;
		switch (typeId) {
			case FFI_TYPE_INT:
			case FFI_TYPE_UINT32:
				view.setUint32(rvalue, Number(result), true);
				break;
			case FFI_TYPE_SINT32:
				view.setInt32(rvalue, Number(result), true);
				break;
			case FFI_TYPE_FLOAT:
				view.setFloat32(rvalue, Number(result), true);
				break;
			case FFI_TYPE_DOUBLE:
				view.setFloat64(rvalue, Number(result), true);
				break;
			case FFI_TYPE_UINT8:
				view.setUint8(rvalue, Number(result));
				break;
			case FFI_TYPE_SINT8:
				view.setInt8(rvalue, Number(result));
				break;
			case FFI_TYPE_UINT16:
				view.setUint16(rvalue, Number(result), true);
				break;
			case FFI_TYPE_SINT16:
				view.setInt16(rvalue, Number(result), true);
				break;
			case FFI_TYPE_UINT64:
				view.setBigUint64(rvalue, BigInt(result as bigint | number), true);
				break;
			case FFI_TYPE_SINT64:
				view.setBigInt64(rvalue, BigInt(result as bigint | number), true);
				break;
			case FFI_TYPE_POINTER:
				view.setUint32(rvalue, Number(result), true);
				break;
			default:
				throw new Error(`Objective-C libffi bridge cannot marshal return type ${typeId}`);
		}
	};

	return {
		env: {
			ffi_call_js: (cif: number, fn: number, rvalue: number, avalue: number) => {
				const view = dataView();
				const nargs = readU32(view, cif + 4);
				const argTypesPointer = readU32(view, cif + 8);
				const returnTypePointer = readU32(view, cif + 12);
				const returnTypeId = readTypeId(view, returnTypePointer);
				const args: Array<number | bigint> = [];
				for (let index = 0; index < nargs; index += 1) {
					const argPointer = readU32(view, avalue + index * 4);
					const argTypePointer = readU32(view, argTypesPointer + index * 4);
					args.push(readArgument(view, argPointer, readTypeId(view, argTypePointer)));
				}
				const callable = functionTable().get(fn);
				if (typeof callable !== 'function') {
					throw new Error(`Objective-C libffi bridge missing function table entry ${fn}`);
				}
				writeResult(view, rvalue, returnTypeId, callable(...args));
			},
			ffi_closure_alloc_js: (size: number, code: number) => {
				const view = dataView();
				const closure = malloc()(size);
				const index = emptyTableSlot();
				if (code) view.setUint32(code, index, true);
				view.setUint32(closure, index, true);
				return closure;
			},
			ffi_closure_free_js: (closure: number) => {
				const view = dataView();
				const index = readU32(view, closure);
				freeObjectiveCTableIndexes.push(index);
				free()(closure);
			},
			ffi_prep_closure_loc_js: () => 2,
			GSLeftInsertionPointForKeyInSortedRange: (
				_key: number,
				_buffer: number,
				location = 0
			) => location,
			GSRightInsertionPointForKeyInSortedRange: (
				_key: number,
				_buffer: number,
				location = 0
			) => location,
			GSSortStable: () => undefined,
			GSSortStableConcurrent: () => undefined,
			GSSortUnstable: () => undefined,
			GSSortUnstableConcurrent: () => undefined
		}
	};
}

async function addFileWithDirectories(
	runtime: Clang,
	filePath: string,
	contents: string | Uint8Array
) {
	const parts = normalizeWorkspacePath(filePath).split('/').slice(0, -1);
	let directory = '';
	for (const part of parts) {
		directory = directory ? `${directory}/${part}` : part;
		try {
			runtime.memfs.addDirectory(directory);
		} catch {
			// Directory may already exist from another file in this runtime.
		}
	}
	runtime.memfs.addFile(filePath, contents);
}

async function loadObjectiveCRuntime(
	clangAssets: WorkerRuntimeAssetConfig | undefined,
	objectivecAssets: ObjectiveCWorkerAssetConfig,
	log: boolean
) {
	configureWorkerRuntimeAssets(clangAssets || null);
	const clangBaseUrl = clangAssets?.baseUrl || '';
	const manifest = await loadRuntimeManifest(resolveRuntimeManifestUrl(clangBaseUrl));
	clang = new BrowserClangRuntime({
		stdout: (output) => postMessage({ output }),
		stdin: () => '',
		progress: (value) => postMessage({ progress: value }),
		log,
		runtimeBaseUrl: clangBaseUrl,
		manifest
	});

	objectiveCAssetsObjectiveC = objectivecAssets;
	foundationAssetsLoadedObjectiveC = false;
	libgnustepBaseBytesObjectiveC = null;
	libffiBytesObjectiveC = null;
	foundationLibrariesInstalledObjectiveC = false;
	installedHeaderPathsObjectiveC.clear();
	const [libobjcBytes, headers] = await Promise.all([
		fetchBytes(objectivecAssets.libobjcUrl, 'libobjc.a'),
		fetchJson(objectivecAssets.headersUrl, 'Objective-C headers')
	]);
	await clang.ready;
	for (const [headerPath, headerSource] of Object.entries(headers)) {
		installedHeaderPathsObjectiveC.add(headerPath);
		await addFileWithDirectories(clang, headerPath, headerSource);
	}
	clang.memfs.addFile('libobjc.a', libobjcBytes);
}

async function ensureObjectiveCFoundationAssets() {
	if (!clang) throw new Error('Objective-C runtime is not loaded.');
	if (!objectiveCAssetsObjectiveC) {
		throw new Error('Objective-C runtime asset config is not loaded.');
	}
	if (foundationAssetsLoadedObjectiveC) return;
	const foundationHeaders = await fetchJson(
		objectiveCAssetsObjectiveC.foundationHeadersUrl,
		'Objective-C Foundation headers'
	);
	foundationHeadersObjectiveC = foundationHeaders;
	if (
		foundationHeaders['blocks_runtime.h'] != null &&
		!installedHeaderPathsObjectiveC.has('blocks_runtime.h')
	) {
		installedHeaderPathsObjectiveC.add('blocks_runtime.h');
		await addFileWithDirectories(
			clang,
			'blocks_runtime.h',
			foundationHeaders['blocks_runtime.h']
		);
	}
	foundationAssetsLoadedObjectiveC = true;
}

async function installObjectiveCFoundationLibraries() {
	if (!clang) throw new Error('Objective-C runtime is not loaded.');
	if (!objectiveCAssetsObjectiveC) {
		throw new Error('Objective-C runtime asset config is not loaded.');
	}
	if (foundationLibrariesInstalledObjectiveC) return;
	if (!libgnustepBaseBytesObjectiveC || !libffiBytesObjectiveC) {
		const [libgnustepBaseBytes, libffiBytes] = await Promise.all([
			fetchBytes(objectiveCAssetsObjectiveC.libgnustepBaseUrl, 'libgnustep-base.a'),
			fetchBytes(objectiveCAssetsObjectiveC.libffiUrl, 'libffi.a')
		]);
		libgnustepBaseBytesObjectiveC = libgnustepBaseBytes;
		libffiBytesObjectiveC = libffiBytes;
	}
	clang.memfs.addFile('libffi.a', libffiBytesObjectiveC);
	clang.memfs.addFile('libgnustep-base.a', libgnustepBaseBytesObjectiveC);
	foundationLibrariesInstalledObjectiveC = true;
}

function readProgramStdin() {
	if (hasInitialStdinObjectiveC) {
		if (initialStdinConsumedObjectiveC) return null;
		initialStdinConsumedObjectiveC = true;
		return initialStdinObjectiveC ?? '';
	}
	return waitForBufferedStdin(stdinBufferObjectiveC, () => postMessage({ buffer: true }));
}

function sourceLanguageForPath(filePath: string): ObjectiveCSourceLanguage | null {
	const normalized = filePath.toLowerCase();
	if (normalized.endsWith('.m')) return 'objective-c';
	if (normalized.endsWith('.c')) return 'c';
	return null;
}

function sourceImportsFoundation(source: string) {
	return /#\s*(?:include|import)\s+[<"]Foundation\/|@import\s+Foundation\b/u.test(source);
}

function resolveFoundationHeaderPath(
	currentPath: string,
	includeName: string,
	headers: Record<string, string>
) {
	if (includeName.startsWith('ObjectiveC2/')) {
		const aliasedHeader = includeName.slice('ObjectiveC2/'.length);
		if (headers[aliasedHeader] != null) return aliasedHeader;
		if (headers[`objc/${aliasedHeader}`] != null) return `objc/${aliasedHeader}`;
		return resolveFoundationHeaderPath(currentPath, aliasedHeader, headers);
	}
	if (headers[includeName] != null) return includeName;
	const currentDirectory = currentPath.includes('/')
		? currentPath.split('/').slice(0, -1).join('/')
		: '';
	if (currentDirectory && !includeName.includes('/')) {
		const relativePath = `${currentDirectory}/${includeName}`;
		if (headers[relativePath] != null) return relativePath;
	}
	for (const prefix of ['Foundation', 'CoreFoundation', 'GNUstepBase']) {
		const prefixedPath = `${prefix}/${includeName}`;
		if (headers[prefixedPath] != null) return prefixedPath;
	}
	return null;
}

function foundationHeaderSourceForInline(headerPath: string, headers: Record<string, string>) {
	const source = headers[headerPath];
	if (source == null) return '';
	if (headerPath === 'Foundation/NSObjCRuntime.h') {
		return `#include <stdint.h>
@class NSString;
#ifndef GSNativeChar
typedef char GSNativeChar;
#endif
${source
	.replace(/^\s*#\s*import\s*<GNUstepBase\/GSBlocks\.h>\s*$/m, FOUNDATION_BLOCKS_MACRO_SHIM)
	.replace(/^\s*#\s*import\s*<GNUstepBase\/GSObjCRuntime\.h>\s*$/m, '')}`;
	}
	return source;
}

function inlineFoundationHeader(
	headerPath: string,
	headers: Record<string, string>,
	seen = new Set<string>()
) {
	if (seen.has(headerPath)) return '';
	seen.add(headerPath);
	const source = foundationHeaderSourceForInline(headerPath, headers);
	if (!source) return '';
	let rewritten = '';
	let lastIndex = 0;
	FOUNDATION_INCLUDE_PATTERN.lastIndex = 0;
	for (const match of source.matchAll(FOUNDATION_INCLUDE_PATTERN)) {
		const includeName = match[1];
		const resolvedPath = resolveFoundationHeaderPath(headerPath, includeName, headers);
		const shouldInlineHeader =
			resolvedPath != null &&
			FOUNDATION_DIRECT_HEADER_PREFIXES.some((prefix) => resolvedPath.startsWith(prefix));
		rewritten += source.slice(lastIndex, match.index);
		if (
			resolvedPath &&
			shouldInlineHeader &&
			resolvedPath !== 'GNUstepBase/GSBlocks.h' &&
			resolvedPath !== 'GNUstepBase/GSObjCRuntime.h'
		) {
			rewritten += `\n${inlineFoundationHeader(resolvedPath, headers, seen)}\n`;
		} else if (includeName === FOUNDATION_OBJECTIVEC2_BLOCKS_HEADER) {
			rewritten += match[0].replace(includeName, 'blocks_runtime.h');
		} else if (includeName === FOUNDATION_OBJECTIVEC2_RUNTIME_HEADER) {
			rewritten += match[0].replace(includeName, 'objc/runtime.h');
		} else {
			rewritten += match[0];
		}
		lastIndex = match.index + match[0].length;
	}
	return rewritten + source.slice(lastIndex);
}

function inlineFoundationImportsForSource(sourcePath: string, source: string) {
	if (!foundationHeadersObjectiveC) return source;
	const seen = new Set<string>();
	let rewritten = '';
	let lastIndex = 0;
	FOUNDATION_INCLUDE_PATTERN.lastIndex = 0;
	for (const match of source.matchAll(FOUNDATION_INCLUDE_PATTERN)) {
		if (
			!FOUNDATION_DIRECT_HEADER_PREFIXES.some((prefix) => match[1].startsWith(prefix)) &&
			match[1] !== 'Foundation.h'
		) {
			continue;
		}
		const headerPath = resolveFoundationHeaderPath(
			sourcePath,
			match[1],
			foundationHeadersObjectiveC
		);
		if (!headerPath) continue;
		rewritten += source.slice(lastIndex, match.index);
		rewritten += `\n${inlineFoundationHeader(headerPath, foundationHeadersObjectiveC, seen)}\n`;
		lastIndex = match.index + match[0].length;
	}
	return rewritten + source.slice(lastIndex);
}

async function compileObjectiveCObject(
	input: string,
	code: string | null,
	obj: string,
	language: ObjectiveCSourceLanguage,
	compileArgs: string[] = []
) {
	if (!clang) throw new Error('Objective-C runtime is not loaded.');
	if (code != null) await addFileWithDirectories(clang, input, code);
	clang.memfs.addFile(obj, new Uint8Array(0));
	const clangModule = await clang.getModule(clang.assetUrls.clang);
	const clangRuntime = clang as Clang & { stdout: (chunk: string) => void };
	const originalStdout = clangRuntime.stdout;
	const compileOutput: string[] = [];
	const resourceDir = (clang as any).compilerConfig?.resourceDir || '/lib/clang/8.0.1';
	const resourceIncludeDir = `${resourceDir.replace(/\/+$/, '')}/include`;
	const args = [
		'-cc1',
		'-triple',
		'wasm32-wasi',
		'-emit-obj',
		'-disable-free',
		'-isysroot',
		'/',
		'-resource-dir',
		resourceDir,
		'-internal-isystem',
		resourceIncludeDir,
		'-internal-isystem',
		'/include/wasm32-wasi',
		'-internal-isystem',
		'/include',
		'-I.',
		'-ferror-limit',
		'20',
		'-O2',
		'-o',
		obj,
		'-x',
		language,
		...(language === 'objective-c' ? ['-fobjc-runtime=gnustep-2.0', '-fblocks'] : []),
		input,
		...compileArgs
	];
	try {
		clangRuntime.stdout = (chunk) => compileOutput.push(chunk);
		await clang.run(clangModule, true, 'clang', ...args);
	} catch (error) {
		const objectBytes = Uint8Array.from(clang.memfs.getFileContents(obj));
		if (objectBytes.length > 0) return;
		for (const chunk of compileOutput) postMessage({ output: chunk });
		throw error;
	} finally {
		clangRuntime.stdout = originalStdout;
	}
}

async function compileAndLinkObjectiveC(
	code: string,
	activePath: string | undefined,
	workspaceFiles: SandboxWorkspaceFile[],
	compileArgs: string[] = []
) {
	if (!clang) throw new Error('Objective-C runtime is not loaded.');
	const trace = (message: string) => console.log(`[wasm-idle:objectivec-worker] ${message}`);
	const inputPath = resolveInputPath(activePath);
	const prefix = `__wasm_idle_objc_${++buildCounter}`;
	const auxiliarySources: {
		path: string;
		prefixedPath: string;
		language: ObjectiveCSourceLanguage;
	}[] = [];
	const seenWorkspaceFiles = new Set<string>();
	for (const file of workspaceFiles) {
		const safePath = normalizeWorkspacePath(file.path);
		if (!safePath || safePath === inputPath || seenWorkspaceFiles.has(safePath)) continue;
		seenWorkspaceFiles.add(safePath);
		const prefixedPath = `${prefix}/${safePath}`;
		await addFileWithDirectories(clang, prefixedPath, file.content);
		const language = sourceLanguageForPath(safePath);
		if (language) auxiliarySources.push({ path: safePath, prefixedPath, language });
	}
	const stem = stemOf(inputPath);
	const input = `${prefix}/${inputPath}`;
	const mainObj = `${prefix}/${stem}.o`;
	const ctorSource = `${prefix}/objc_ctor.c`;
	const ctorObj = `${prefix}/objc_ctor.o`;
	const wasmPath = `${prefix}/${stem}.wasm`;
	const auxiliaryObjects: string[] = [];
	const mainLanguage = sourceLanguageForPath(inputPath) || 'objective-c';
	const needsFoundation =
		sourceImportsFoundation(code) ||
		workspaceFiles.some((file) => sourceImportsFoundation(file.content));
	const needsObjectiveCLoad =
		!needsFoundation &&
		mainLanguage === 'objective-c' &&
		(/@\s*(?:interface|implementation|protocol)\b/u.test(code) ||
			workspaceFiles.some(
				(file) =>
					sourceLanguageForPath(file.path) === 'objective-c' &&
					/@\s*(?:interface|implementation|protocol)\b/u.test(file.content)
			));
	const foundationCompileArgs = needsFoundation
		? ['-Wno-macro-redefined', '-Wno-nullability-completeness']
		: [];
	let mainCode = code;
	if (needsFoundation) {
		await ensureObjectiveCFoundationAssets();
		mainCode = inlineFoundationImportsForSource(inputPath, code);
	}
	if (needsObjectiveCLoad) {
		trace('compiling Objective-C load constructor');
		await compileObjectiveCObject(ctorSource, OBJC_CONSTRUCTOR_SOURCE, ctorObj, 'c');
	}
	trace(`compiling ${inputPath}`);
	await compileObjectiveCObject(input, ensureTrailingNewline(mainCode), mainObj, mainLanguage, [
		'-I',
		prefix,
		...foundationCompileArgs,
		...compileArgs
	]);
	for (const source of auxiliarySources) {
		const objectName = source.path.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/\.[^.]+$/, '');
		const objectPath = `${prefix}/${objectName}.o`;
		trace(`compiling ${source.path}`);
		await compileObjectiveCObject(source.prefixedPath, null, objectPath, source.language, [
			'-I',
			prefix,
			...foundationCompileArgs,
			...compileArgs
		]);
		auxiliaryObjects.push(objectPath);
	}

	const stackSize = 1024 * 1024;
	const libdir = 'lib/wasm32-wasi';
	const compilerRuntimeLibDir =
		(clang as any).compilerConfig?.compilerRuntimeLibDir || 'lib/clang/8.0.1/lib/wasi';
	const lld = await clang.getModule(clang.assetUrls.lld);
	if (needsFoundation) {
		await installObjectiveCFoundationLibraries();
	}
	await clang.run(
		lld,
		clang.log,
		'wasm-ld',
		...(needsFoundation ? ['--export=malloc', '--export=free'] : ['--export-dynamic']),
		'--gc-sections',
		...(needsFoundation ? ['--allow-undefined'] : []),
		...(needsFoundation ? ['--export-table'] : []),
		'-z',
		`stack-size=${stackSize}`,
		`-L${libdir}/noeh`,
		`-L${libdir}`,
		`${libdir}/crt1.o`,
		...(needsObjectiveCLoad ? [ctorObj] : []),
		mainObj,
		...auxiliaryObjects,
		...(needsFoundation
			? FOUNDATION_LINK_ROOT_SYMBOLS.flatMap((symbol) => ['-u', symbol])
			: []),
		...(needsFoundation ? ['libgnustep-base.a'] : []),
		'libobjc.a',
		...(needsFoundation ? ['libffi.a'] : []),
		'-lc',
		'-lc++',
		'-lc++abi',
		'-lm',
		`-L${compilerRuntimeLibDir}`,
		'-lclang_rt.builtins-wasm32',
		'-o',
		wasmPath
	);
	const bytes = Uint8Array.from(clang.memfs.getFileContents(wasmPath));
	const wasm = await WebAssembly.compile(bytes);
	return {
		bytes,
		wasm,
		target: 'wasm32-wasi',
		format: 'wasi-core-wasm',
		fileName: wasmPath,
		language: 'C',
		needsLibffi: needsFoundation
	} satisfies ObjectiveCBrowserClangArtifact;
}

function artifactCacheKey(
	code: string,
	activePath: string | undefined,
	workspaceFiles: SandboxWorkspaceFile[],
	compileArgs: string[]
) {
	return JSON.stringify({
		code,
		activePath: activePath || '',
		workspaceFiles,
		compileArgs
	});
}

self.onmessage = async (event: { data: any }) => {
	if (handleWorkerAssetMessage(event.data)) return;
	const {
		code,
		buffer,
		load,
		log,
		prepare,
		compileArgs,
		programArgs,
		activePath,
		workspaceFiles,
		stdin,
		clangAssets,
		objectivecAssets
	} = event.data;
	if (load) {
		try {
			await loadObjectiveCRuntime(clangAssets, objectivecAssets, log);
			postMessage({ load: true });
		} catch (error: any) {
			postMessage({ error: error.message });
		}
	} else if (typeof log === 'boolean' && !code) {
		if (clang) clang.log = log;
	} else if (code) {
		if (!clang) {
			postMessage({ error: 'Objective-C runtime is not loaded.' });
			return;
		}
		clang.log = log;
		stdinBufferObjectiveC = new Int32Array(buffer);
		hasInitialStdinObjectiveC = typeof stdin === 'string';
		initialStdinObjectiveC = hasInitialStdinObjectiveC ? stdin : null;
		initialStdinConsumedObjectiveC = false;

		try {
			const normalizedWorkspaceFiles = workspaceFiles || [];
			const normalizedCompileArgs = compileArgs || [];
			const cacheKey = artifactCacheKey(
				code,
				activePath,
				normalizedWorkspaceFiles,
				normalizedCompileArgs
			);
			let artifact: ObjectiveCBrowserClangArtifact;
			if (prepare) {
				artifact = await compileAndLinkObjectiveC(
					code,
					activePath,
					normalizedWorkspaceFiles,
					normalizedCompileArgs
				);
				preparedArtifactObjectiveC = artifact;
				preparedArtifactKeyObjectiveC = cacheKey;
				postMessage({ results: true });
				return;
			}
			if (preparedArtifactObjectiveC && preparedArtifactKeyObjectiveC === cacheKey) {
				artifact = preparedArtifactObjectiveC;
			} else {
				artifact = await compileAndLinkObjectiveC(
					code,
					activePath,
					normalizedWorkspaceFiles,
					normalizedCompileArgs
				);
				preparedArtifactObjectiveC = artifact;
				preparedArtifactKeyObjectiveC = cacheKey;
			}
			if (!prepare) {
				const result = await executeBrowserClangArtifact(artifact, {
					args: programArgs || [],
					stdin: readProgramStdin,
					stdout: (output) => postMessage({ output }),
					stderr: (output) => postMessage({ output }),
					extraImports: artifact.needsLibffi
						? ({ instance }) => createObjectiveCLibffiImports(instance)
						: undefined
				});
				if (result.exitCode) {
					throw new Error(`Objective-C program exited with ${result.exitCode}`);
				}
			}
			postMessage({ results: true });
		} catch (error: any) {
			postMessage({ error: error.message || error.stack });
		}
	}
};
