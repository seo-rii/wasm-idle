#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	BrowserClangRuntime,
	executeBrowserClangArtifact,
	loadRuntimeManifest,
	resolveRuntimeManifestUrl
} from 'wasm-clang';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_ROOT = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(RUNTIME_ROOT, '..', '..');
const FOUNDATION_CACHE_ROOT =
	process.env.WASM_IDLE_OBJECTIVEC_FOUNDATION_CACHE_DIR ||
	path.join(os.tmpdir(), 'wasm-idle-objectivec-foundation');
const LIBFFI_DIR = path.join(FOUNDATION_CACHE_ROOT, 'libffi');
const CLANG_BASE_URL = pathToFileURL(path.join(REPO_ROOT, 'static', 'clang') + path.sep);
const CLANG_MANIFEST_URL = resolveRuntimeManifestUrl(CLANG_BASE_URL);

const LIBFFI_URL = 'https://github.com/libffi/libffi.git';
const LIBFFI_REF = 'v3.6.0';
const strictWasmBackend = process.argv.includes('--strict-wasm-backend');
const textEncoder = new TextEncoder();

const libffiSources = ['src/prep_cif.c', 'src/types.c'];
const wasmBackendSource = 'src/wasm/ffi.c';
const libffiRuntimeProbeSource = `#include <ffi.h>
#include <stdio.h>

static int add_ints(int left, int right)
{
  return left + right;
}

int main(void)
{
  ffi_cif cif;
  ffi_type *args[2] = { &ffi_type_sint32, &ffi_type_sint32 };
  int left = 7;
  int right = 35;
  int result = -1;
  void *values[2] = { &left, &right };

  if (ffi_prep_cif(&cif, FFI_DEFAULT_ABI, 2, &ffi_type_sint32, args) != FFI_OK) {
    puts("ffi_prep_cif failed");
    return 1;
  }

  ffi_call(&cif, (void (*)(void))add_ints, &result, values);
  printf("ffi=%d\\n", result);
  return result == 42 ? 0 : 2;
}
`;

function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd || REPO_ROOT,
			stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
			env: process.env
		});
		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr?.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) resolve({ stdout, stderr });
			else reject(new Error(`${command} ${args.join(' ')} failed\n${stderr}`));
		});
	});
}

async function exists(filePath) {
	return !!(await stat(filePath).catch(() => null));
}

async function ensureGitCheckout(directory, url, ref) {
	if (!(await exists(path.join(directory, '.git')))) {
		await mkdir(path.dirname(directory), { recursive: true });
		await rm(directory, { recursive: true, force: true });
		await run('git', ['clone', url, directory]);
	}
	await run('git', ['fetch', '--tags', '--quiet'], { cwd: directory });
	await run('git', ['checkout', '--quiet', ref], { cwd: directory });
}

async function gitOutput(directory, args) {
	const { stdout } = await run('git', args, { cwd: directory, capture: true });
	return stdout.trim();
}

function generateFfiHeader(source) {
	return source
		.replaceAll('@VERSION@', '3.6.0')
		.replaceAll('@TARGET@', 'WASM')
		.replaceAll('@HAVE_LONG_DOUBLE@', '0')
		.replaceAll('@FFI_VERSION_STRING@', '3.6.0')
		.replaceAll('@FFI_VERSION_NUMBER@', '30600')
		.replaceAll('@FFI_EXEC_TRAMPOLINE_TABLE@', '0');
}

async function readLibffiHeaders() {
	return {
		ffi: generateFfiHeader(
			await readFile(path.join(LIBFFI_DIR, 'include', 'ffi.h.in'), 'utf8')
		),
		ffitarget: await readFile(path.join(LIBFFI_DIR, 'src', 'wasm', 'ffitarget.h'), 'utf8'),
		ffiCommon: await readFile(path.join(LIBFFI_DIR, 'include', 'ffi_common.h'), 'utf8'),
		ffiConfig: `#pragma once
#define HAVE_ALLOCA_H 1
#define HAVE_MEMCPY 1
#define HAVE_LONG_DOUBLE_VARIANT 0
#define HAVE_INT128 1
#define STDC_HEADERS 1
#define FFI_HIDDEN __attribute__((visibility("hidden")))
`
	};
}

async function addFileWithDirs(runtime, filePath, contents) {
	const parts = filePath.split('/').slice(0, -1);
	let directory = '';
	for (const part of parts) {
		directory = directory ? `${directory}/${part}` : part;
		try {
			runtime.memfs.addDirectory(directory);
		} catch {
			// Existing directories are fine.
		}
	}
	runtime.memfs.addFile(
		filePath,
		typeof contents === 'string' ? textEncoder.encode(contents) : contents
	);
}

async function createRuntime(output) {
	const manifest = await loadRuntimeManifest(CLANG_MANIFEST_URL);
	const clang = new BrowserClangRuntime({
		stdout: (chunk) => output.push(chunk),
		stdin: () => '',
		log: process.env.WASM_IDLE_OBJECTIVEC_LIBFFI_PROBE_LOG === '1',
		runtimeBaseUrl: CLANG_BASE_URL,
		manifest
	});
	await clang.ready;
	return clang;
}

function objectPathFor(sourcePath) {
	return `${sourcePath.replace(/[^A-Za-z0-9]+/g, '_')}.o`;
}

function compileArgsFor(sourcePath, clang, objectPath, options = {}) {
	const resourceDir = clang.compilerConfig?.resourceDir || '/lib/clang/8.0.1';
	const resourceIncludeDir = `${resourceDir.replace(/\/+$/, '')}/include`;
	return [
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
		'-Iinclude',
		'-Isrc',
		'-Isrc/wasm',
		'-ferror-limit',
		'20',
		'-O0',
		'-D__wasm__=1',
		'-D__wasm32__=1',
		'-DFFI_BUILDING=1',
		'-DFFI_STATIC_BUILD=1',
		...(options.emscriptenImportStubs ? ['-D__EMSCRIPTEN__=1'] : []),
		'-o',
		objectPath,
		'-x',
		'c',
		sourcePath
	];
}

async function installLibffiProbeHeaders(clang, headers, options = {}) {
	await addFileWithDirs(clang, 'ffi.h', headers.ffi);
	await addFileWithDirs(clang, 'include/ffi.h', headers.ffi);
	await addFileWithDirs(clang, 'ffitarget.h', headers.ffitarget);
	await addFileWithDirs(clang, 'include/ffitarget.h', headers.ffitarget);
	await addFileWithDirs(clang, 'ffi_common.h', headers.ffiCommon);
	await addFileWithDirs(clang, 'include/ffi_common.h', headers.ffiCommon);
	await addFileWithDirs(clang, 'fficonfig.h', headers.ffiConfig);
	await addFileWithDirs(clang, 'include/fficonfig.h', headers.ffiConfig);
	if (options.emscriptenImportStubs) {
		await addFileWithDirs(
			clang,
			'emscripten/emscripten.h',
			`#pragma once
#define EM_JS(ret, name, args, ...) ret name args;
#define EM_JS_DEPS(tag, deps)
`
		);
	}
}

async function compileProvidedObject(sourcePath, source, headers, options = {}) {
	const output = [];
	const clang = await createRuntime(output);
	await installLibffiProbeHeaders(clang, headers, options);
	await addFileWithDirs(clang, sourcePath, source);

	const objectPath = objectPathFor(sourcePath);
	clang.memfs.addFile(objectPath, new Uint8Array(0));
	const clangModule = await clang.getModule(clang.assetUrls.clang);
	try {
		await clang.run(
			clangModule,
			true,
			'clang',
			...compileArgsFor(sourcePath, clang, objectPath, options)
		);
	} catch (error) {
		const objectBytes = Uint8Array.from(clang.memfs.getFileContents(objectPath));
		if (objectBytes.length > 0) {
			return {
				bytes: objectBytes.length,
				objectBytes,
				objectPath,
				output: output.join(''),
				recovered: true
			};
		}
		throw new Error(output.join('') || error?.message || String(error), { cause: error });
	}
	const objectBytes = Uint8Array.from(clang.memfs.getFileContents(objectPath));
	if (!objectBytes.length) throw new Error(`${sourcePath} did not produce an object file`);
	return {
		bytes: objectBytes.length,
		objectBytes,
		objectPath,
		output: output.join(''),
		recovered: false
	};
}

async function compileObject(sourcePath, headers, options = {}) {
	return compileProvidedObject(
		sourcePath,
		await readFile(path.join(LIBFFI_DIR, sourcePath), 'utf8'),
		headers,
		options
	);
}

function summarizeError(error) {
	return (error?.message || String(error)).split('\n').filter(Boolean).slice(0, 14).join('\n');
}

async function linkRuntimeProbe(objects) {
	const output = [];
	const clang = await createRuntime(output);
	for (const object of objects) {
		await addFileWithDirs(clang, object.objectPath, object.objectBytes);
	}
	const wasmPath = 'libffi-call-probe.wasm';
	clang.memfs.addFile(wasmPath, new Uint8Array(0));
	const libdir = 'lib/wasm32-wasi';
	const compilerRuntimeLibDir =
		clang.compilerConfig?.compilerRuntimeLibDir || 'lib/clang/8.0.1/lib/wasi';
	const lld = await clang.getModule(clang.assetUrls.lld);
	await clang.run(
		lld,
		clang.log,
		'wasm-ld',
		'--export-dynamic',
		'--export-table',
		'--allow-undefined',
		'-z',
		'stack-size=1048576',
		`-L${libdir}/noeh`,
		`-L${libdir}`,
		`${libdir}/crt1.o`,
		...objects.map((object) => object.objectPath),
		'-lc',
		'-lm',
		`-L${compilerRuntimeLibDir}`,
		'-lclang_rt.builtins-wasm32',
		'-o',
		wasmPath
	);
	const bytes = Uint8Array.from(clang.memfs.getFileContents(wasmPath));
	if (!bytes.length) throw new Error('libffi runtime probe link produced an empty wasm artifact');
	return {
		bytes,
		wasm: await WebAssembly.compile(bytes),
		target: 'wasm32-wasi',
		format: 'wasi-core-wasm',
		fileName: wasmPath
	};
}

function createLibffiRuntimeProbeImports(instanceRef) {
	const dataView = () => {
		const memory = instanceRef.current?.exports.memory;
		if (!(memory instanceof WebAssembly.Memory)) {
			throw new Error('libffi probe missing exported memory');
		}
		return new DataView(memory.buffer);
	};
	const functionTable = () => {
		const table = instanceRef.current?.exports.__indirect_function_table;
		if (!(table instanceof WebAssembly.Table)) {
			throw new Error('libffi probe missing exported __indirect_function_table');
		}
		return table;
	};
	const readU32 = (view, pointer) => view.getUint32(pointer, true);
	const readI32 = (view, pointer) => view.getInt32(pointer, true);

	return {
		env: {
			ffi_call_js: (_cif, fn, rvalue, avalue) => {
				const view = dataView();
				const leftPointer = readU32(view, avalue);
				const rightPointer = readU32(view, avalue + 4);
				const left = readI32(view, leftPointer);
				const right = readI32(view, rightPointer);
				const callable = functionTable().get(fn);
				if (typeof callable !== 'function') {
					throw new Error(`libffi probe missing function table entry ${fn}`);
				}
				const result = callable(left, right);
				view.setInt32(rvalue, result, true);
			},
			ffi_closure_alloc_js: () => 0,
			ffi_closure_free_js: () => {},
			ffi_prep_closure_loc_js: () => 1
		}
	};
}

async function runLibffiRuntimeProbe(headers) {
	const sources = [
		...libffiSources.map((sourcePath) => ({
			sourcePath,
			source: readFile(path.join(LIBFFI_DIR, sourcePath), 'utf8')
		})),
		{
			sourcePath: wasmBackendSource,
			source: readFile(path.join(LIBFFI_DIR, wasmBackendSource), 'utf8')
		},
		{
			sourcePath: 'ffi_call_probe.c',
			source: Promise.resolve(libffiRuntimeProbeSource)
		}
	];
	const objects = [];
	for (const source of sources) {
		objects.push(
			await compileProvidedObject(source.sourcePath, await source.source, headers, {
				emscriptenImportStubs: true
			})
		);
	}
	const artifact = await linkRuntimeProbe(objects);
	const result = await executeBrowserClangArtifact(artifact, {
		extraImports: ({ instance }) => createLibffiRuntimeProbeImports(instance)
	});
	if (result.exitCode !== 0) {
		throw new Error(
			`libffi runtime probe exited with ${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
		);
	}
	return result;
}

async function main() {
	await ensureGitCheckout(LIBFFI_DIR, LIBFFI_URL, LIBFFI_REF);
	const commit = await gitOutput(LIBFFI_DIR, ['rev-parse', 'HEAD']);
	const headers = await readLibffiHeaders();
	console.log(`[libffi-probe] libffi ${LIBFFI_REF} ${commit}`);

	for (const sourcePath of libffiSources) {
		const result = await compileObject(sourcePath, headers);
		console.log(
			`[libffi-probe] ${sourcePath} object bytes: ${result.bytes}` +
				`${result.recovered ? ' (recovered after clang output stream exit)' : ''}`
		);
	}

	try {
		const result = await compileObject(wasmBackendSource, headers);
		console.log(
			`[libffi-probe] ${wasmBackendSource} object bytes: ${result.bytes}` +
				`${result.recovered ? ' (recovered after clang output stream exit)' : ''}`
		);
	} catch (error) {
		console.log('[libffi-probe] direct WASI compile of src/wasm/ffi.c is not ready:');
		console.log(summarizeError(error));
		if (strictWasmBackend) throw error;
		console.log(
			'[libffi-probe] The upstream wasm backend is Emscripten-oriented; Objective-C Foundation still needs a real WASI-compatible ffi_call/closure path.'
		);
		const stubbedResult = await compileObject(wasmBackendSource, headers, {
			emscriptenImportStubs: true
		});
		console.log(
			`[libffi-probe] ${wasmBackendSource} object bytes with EM_JS import stubs: ${stubbedResult.bytes}` +
				`${stubbedResult.recovered ? ' (recovered after clang output stream exit)' : ''}`
		);
		console.log(
			'[libffi-probe] EM_JS import stubs prove the C backend can be packaged as a WASI object, but runtime ffi_call/closure support still requires JS imports and linker wiring.'
		);
	}

	const runtimeProbe = await runLibffiRuntimeProbe(headers);
	console.log(
		`[libffi-probe] ffi_call import bridge runtime output: ${runtimeProbe.stdout.trim()}`
	);
}

main().catch((error) => {
	console.error('\n[libffi-probe] failed:');
	console.error(error?.stack || error?.message || error);
	process.exitCode = 1;
});
