#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GCC_COMPATIBILITY_HEADERS } from '@wasm-idle/clang-common/gcc-compat';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const config = {
	llvmVersion: process.env.LLVM_VERSION || '22.1.8',
	wasiSdkVersion: process.env.WASI_SDK_VERSION || '33',
	emsdkVersion: process.env.EMSDK_VERSION || '6.0.0',
	targetTriple: process.env.TARGET_TRIPLE || 'wasm32-wasi',
	hostTriple: process.env.HOST_TRIPLE || 'wasm32-wasip1',
	yowaspWasiPatchRepo:
		process.env.YOWASP_WASI_PATCH_REPO || 'https://github.com/YoWASP/llvm-project',
	yowaspWasiPatchCommit:
		process.env.YOWASP_WASI_PATCH_COMMIT || '97196c8eeb1d495fa43bb8af2fb26af5ef5b89fb',
	llvmBuildType: process.env.LLVM_BUILD_TYPE || 'MinSizeRel',
	workDir: path.resolve(
		process.env.WASM_CLANG_TOOLCHAIN_WORK_DIR ||
			path.join(repoRoot, 'artifacts', 'toolchain-build')
	),
	outDir: path.resolve(
		process.env.WASM_CLANG_TOOLCHAIN_OUT_DIR ||
			path.join(repoRoot, 'artifacts', 'runtime-source')
	),
	ninjaJobs: process.env.NINJA_JOBS || ''
};

const args = process.argv.slice(2).filter((arg) => arg !== '--');
if (args.includes('--help') || args.includes('-h')) {
	console.log(`Usage: pnpm --dir runtimes/wasm-clang build:toolchain

Environment:
  LLVM_VERSION=${config.llvmVersion}
  WASI_SDK_VERSION=${config.wasiSdkVersion}
  EMSDK_VERSION=${config.emsdkVersion}
  TARGET_TRIPLE=${config.targetTriple}
  HOST_TRIPLE=${config.hostTriple}
  YOWASP_WASI_PATCH_REPO=${config.yowaspWasiPatchRepo}
  YOWASP_WASI_PATCH_COMMIT=${config.yowaspWasiPatchCommit}
  WASM_CLANG_TOOLCHAIN_WORK_DIR=${config.workDir}
  WASM_CLANG_TOOLCHAIN_OUT_DIR=${config.outDir}
  NINJA_JOBS=<optional ninja parallelism>

This is a large build. It builds raw WASI clang/wasm-ld and an Emscripten pthread clangd,
then calls package-toolchain.mjs to refresh artifacts/runtime-source.`);
	process.exit(0);
}

const run = (command, args, options = {}) =>
	new Promise((resolve, reject) => {
		console.log(`+ ${[command, ...args].map(shellQuote).join(' ')}`);
		const child = spawn(command, args, {
			stdio: 'inherit',
			...options,
			env: { ...process.env, ...(options.env || {}) }
		});
		child.on('error', reject);
		child.on('exit', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`${command} exited with code ${code}`));
		});
	});

function shellQuote(value) {
	if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
	return `'${value.replaceAll("'", "'\\''")}'`;
}

async function commandExists(command) {
	const paths = (process.env.PATH || '').split(path.delimiter);
	for (const directory of paths) {
		try {
			await fs.access(path.join(directory, command));
			return true;
		} catch {
			// Continue searching.
		}
	}
	return false;
}

async function requireCommand(command) {
	if (!(await commandExists(command))) throw new Error(`Missing required command: ${command}`);
}

async function download(url, target) {
	try {
		await fs.access(target);
		return;
	} catch {
		// Download below.
	}
	await fs.mkdir(path.dirname(target), { recursive: true });
	if (await commandExists('curl')) {
		await run('curl', ['-fL', url, '-o', target]);
	} else {
		await run('wget', [url, '-O', target]);
	}
}

function detectWasiSdkHost() {
	const platform = os.platform();
	const arch = os.arch();
	if (platform === 'linux' && arch === 'x64') return 'x86_64-linux';
	if (platform === 'linux' && arch === 'arm64') return 'arm64-linux';
	if (platform === 'darwin' && arch === 'x64') return 'x86_64-macos';
	if (platform === 'darwin' && arch === 'arm64') return 'arm64-macos';
	throw new Error(`Unsupported host ${platform}-${arch}; set WASI_SDK_PATH`);
}

async function extractOnce(archive, destination, marker) {
	try {
		await fs.access(marker);
		return;
	} catch {
		// Extract below.
	}
	await fs.mkdir(destination, { recursive: true });
	await run('tar', ['-xzf', archive, '-C', destination]);
	await fs.writeFile(marker, '');
}

async function findDirectory(parent, name) {
	const entries = await fs.readdir(parent, { withFileTypes: true }).catch(() => []);
	const match = entries.find((entry) => entry.isDirectory() && entry.name.startsWith(name));
	return match ? path.join(parent, match.name) : '';
}

async function findResourceIncludeDir(buildDir) {
	const clangDir = path.join(buildDir, 'lib', 'clang');
	const versions = await fs.readdir(clangDir, { withFileTypes: true }).catch(() => []);
	for (const version of versions) {
		if (!version.isDirectory()) continue;
		const includeDir = path.join(clangDir, version.name, 'include');
		try {
			await fs.access(includeDir);
			return includeDir;
		} catch {
			// Continue searching.
		}
	}
	return '';
}

async function findFile(root, predicate) {
	const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		const entryPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			const nested = await findFile(entryPath, predicate);
			if (nested) return nested;
			continue;
		}
		if (entry.isFile() && predicate(entryPath)) return entryPath;
	}
	return '';
}

function cmakeString(value) {
	return value.replaceAll('\\', '/').replaceAll('"', '\\"');
}

async function writeLlvmWasiToolchainFile(wasiSdkPath) {
	const suffix = process.platform === 'win32' ? '.exe' : '';
	const toolchainFile = path.join(toolsDir, 'llvm-wasi-generic-toolchain.cmake');
	const sysroot = path.join(wasiSdkPath, 'share', 'wasi-sysroot');
	const binDir = path.join(wasiSdkPath, 'bin');
	await fs.writeFile(
		toolchainFile,
		[
			'# Generated by wasm-clang/scripts/build-toolchain.mjs',
			'set(CMAKE_SYSTEM_NAME WASI)',
			'set(CMAKE_SYSTEM_VERSION 1)',
			'set(CMAKE_SYSTEM_PROCESSOR wasm32)',
			`set(CMAKE_SYSROOT "${cmakeString(sysroot)}")`,
			`set(CMAKE_C_COMPILER "${cmakeString(path.join(binDir, `clang${suffix}`))}")`,
			`set(CMAKE_CXX_COMPILER "${cmakeString(path.join(binDir, `clang++${suffix}`))}")`,
			`set(CMAKE_ASM_COMPILER "${cmakeString(path.join(binDir, `clang${suffix}`))}")`,
			`set(CMAKE_AR "${cmakeString(path.join(binDir, `llvm-ar${suffix}`))}")`,
			`set(CMAKE_RANLIB "${cmakeString(path.join(binDir, `llvm-ranlib${suffix}`))}")`,
			`set(CMAKE_LINKER "${cmakeString(path.join(binDir, `wasm-ld${suffix}`))}")`,
			`set(CMAKE_C_COMPILER_TARGET "${config.hostTriple}")`,
			`set(CMAKE_CXX_COMPILER_TARGET "${config.hostTriple}")`,
			`set(CMAKE_ASM_COMPILER_TARGET "${config.hostTriple}")`,
			`set(CMAKE_FIND_ROOT_PATH "${cmakeString(sysroot)}")`,
			'set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)',
			'set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)',
			'set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)',
			'set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)',
			''
		].join('\n')
	);
	return toolchainFile;
}

async function patchLlvmForWasiHost() {
	const marker = path.join(llvmSource, '.wasm-clang-yowasp-wasi-host.patch');
	let hasYowaspPatch = true;
	try {
		await fs.access(marker);
	} catch {
		hasYowaspPatch = false;
	}
	if (!hasYowaspPatch) {
		await run('git', [
			'-C',
			llvmSource,
			'fetch',
			'--depth',
			'2',
			config.yowaspWasiPatchRepo,
			config.yowaspWasiPatchCommit
		]);
		await run('git', [
			'-C',
			llvmSource,
			'cherry-pick',
			'--no-commit',
			config.yowaspWasiPatchCommit
		]);
		await fs.writeFile(
			marker,
			`${config.yowaspWasiPatchRepo}\n${config.yowaspWasiPatchCommit}\n`
		);
	}

	const signalsPath = path.join(llvmSource, 'llvm', 'lib', 'Support', 'Signals.cpp');
	const signalsSource = await fs.readFile(signalsPath, 'utf8');
	const wasiSignalsBlock = [
		'void llvm::sys::AddSignalHandler(sys::SignalHandlerCallback FnPtr,',
		'                                 void *Cookie) {}',
		'void llvm::sys::RunInterruptHandlers() {}'
	].join('\n');
	if (!signalsSource.includes('void llvm::sys::PrintStackTraceOnErrorSignal(StringRef Argv0,')) {
		await fs.writeFile(
			signalsPath,
			signalsSource.replace(
				wasiSignalsBlock,
				[
					wasiSignalsBlock,
					'void llvm::sys::PrintStackTraceOnErrorSignal(StringRef Argv0,',
					'                                           bool DisableCrashReporting) {}'
				].join('\n')
			)
		);
	}
}

const ninjaArgs = config.ninjaJobs ? ['-j', config.ninjaJobs] : [];
const wasiCompileFlags =
	'-DBYTE_ORDER=1234 -DLITTLE_ENDIAN=1234 -DBIG_ENDIAN=4321 -D_WASI_EMULATED_MMAN -flto';
const wasiLinkerFlags =
	'-lwasi-emulated-mman -Wl,--max-memory=4294967296 -Wl,-z,stack-size=8388608,--stack-first -flto -Wl,--strip-all';
const downloadDir = path.join(config.workDir, 'downloads');
const sourceDir = path.join(config.workDir, 'src');
const buildDir = path.join(config.workDir, 'build');
const toolsDir = path.join(config.workDir, 'tools');
const stagingSysroot = path.join(config.workDir, 'staging-sysroot');
const llvmSource = path.join(sourceDir, 'llvm-project');

for (const command of ['cmake', 'git', 'ninja', 'node', 'tar']) await requireCommand(command);
if (!(await commandExists('curl')) && !(await commandExists('wget'))) {
	throw new Error('Missing required command: curl or wget');
}

await fs.mkdir(config.workDir, { recursive: true });
await fs.mkdir(downloadDir, { recursive: true });
await fs.mkdir(sourceDir, { recursive: true });
await fs.mkdir(buildDir, { recursive: true });
await fs.mkdir(toolsDir, { recursive: true });

try {
	await fs.access(path.join(llvmSource, '.git'));
} catch {
	await run('git', [
		'clone',
		'--depth',
		'1',
		'--branch',
		`llvmorg-${config.llvmVersion}`,
		'https://github.com/llvm/llvm-project',
		llvmSource
	]);
}
await patchLlvmForWasiHost();

let wasiSdkPath = process.env.WASI_SDK_PATH || '';
if (wasiSdkPath) wasiSdkPath = path.resolve(wasiSdkPath);
if (!wasiSdkPath) {
	const host = process.env.WASI_SDK_HOST || detectWasiSdkHost();
	const archive = `wasi-sdk-${config.wasiSdkVersion}.0-${host}.tar.gz`;
	await download(
		`https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${config.wasiSdkVersion}/${archive}`,
		path.join(downloadDir, archive)
	);
	await extractOnce(
		path.join(downloadDir, archive),
		toolsDir,
		path.join(toolsDir, `.wasi-sdk-${config.wasiSdkVersion}.0-${host}-extracted`)
	);
	wasiSdkPath = await findDirectory(toolsDir, `wasi-sdk-${config.wasiSdkVersion}.0`);
}
if (!wasiSdkPath) throw new Error('Could not find WASI_SDK_PATH');
const llvmWasiToolchainFile = await writeLlvmWasiToolchainFile(wasiSdkPath);

const sysrootArchive = `wasi-sysroot-${config.wasiSdkVersion}.0+m.tar.gz`;
const clangRtArchive = `libclang_rt-${config.wasiSdkVersion}.0+m.tar.gz`;
await download(
	`https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${config.wasiSdkVersion}/wasi-sysroot-${config.wasiSdkVersion}.0%2Bm.tar.gz`,
	path.join(downloadDir, sysrootArchive)
);
await download(
	`https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${config.wasiSdkVersion}/libclang_rt-${config.wasiSdkVersion}.0%2Bm.tar.gz`,
	path.join(downloadDir, clangRtArchive)
);

const nativeBuild = path.join(buildDir, 'native');
await run('cmake', [
	'-G',
	'Ninja',
	'-S',
	path.join(llvmSource, 'llvm'),
	'-B',
	nativeBuild,
	'-DCMAKE_BUILD_TYPE=Release',
	'-DLLVM_ENABLE_PROJECTS=clang',
	'-DLLVM_TARGETS_TO_BUILD=WebAssembly',
	'-DLLVM_INCLUDE_TESTS=OFF',
	'-DLLVM_INCLUDE_EXAMPLES=OFF'
]);
await run('cmake', [
	'--build',
	nativeBuild,
	'--target',
	'llvm-tblgen',
	'clang-tblgen',
	...ninjaArgs
]);

const wasiBuild = path.join(buildDir, 'wasi-raw');
const lldBuild = path.join(buildDir, 'wasi-lld');
await run('cmake', [
	'-G',
	'Ninja',
	'-S',
	path.join(llvmSource, 'llvm'),
	'-B',
	wasiBuild,
	`-DCMAKE_TOOLCHAIN_FILE=${llvmWasiToolchainFile}`,
	`-DCMAKE_BUILD_TYPE=${config.llvmBuildType}`,
	`-DCMAKE_C_FLAGS=${wasiCompileFlags}`,
	`-DCMAKE_CXX_FLAGS=${wasiCompileFlags}`,
	`-DCMAKE_EXE_LINKER_FLAGS=${wasiLinkerFlags}`,
	`-DLLVM_HOST_TRIPLE=${config.hostTriple}`,
	`-DLLVM_DEFAULT_TARGET_TRIPLE=${config.targetTriple}`,
	'-DLLVM_TARGETS_TO_BUILD=WebAssembly',
	'-DLLVM_ENABLE_PROJECTS=clang;lld',
	`-DLLVM_TABLEGEN=${path.join(nativeBuild, 'bin', 'llvm-tblgen')}`,
	`-DCLANG_TABLEGEN=${path.join(nativeBuild, 'bin', 'clang-tblgen')}`,
	'-DLLVM_BUILD_STATIC=ON',
	'-DLLVM_BUILD_RUNTIME=OFF',
	'-DLLVM_BUILD_TOOLS=OFF',
	'-DLLVM_BUILD_UTILS=OFF',
	'-DLLVM_INCLUDE_DOCS=OFF',
	'-DLLVM_INCLUDE_TESTS=OFF',
	'-DLLVM_INCLUDE_EXAMPLES=OFF',
	'-DLLVM_INCLUDE_BENCHMARKS=OFF',
	'-DLLVM_INCLUDE_RUNTIMES=OFF',
	'-DLLVM_INCLUDE_UTILS=OFF',
	'-DLLVM_TOOL_LLVM_DRIVER_BUILD=ON',
	'-DLLVM_ENABLE_BACKTRACES=OFF',
	'-DLLVM_ENABLE_BINDINGS=OFF',
	'-DLLVM_ENABLE_CRASH_OVERRIDES=OFF',
	'-DLLVM_ENABLE_LIBEDIT=OFF',
	'-DLLVM_ENABLE_LIBXML2=OFF',
	'-DLLVM_ENABLE_PIC=OFF',
	'-DLLVM_ENABLE_TERMINFO=OFF',
	'-DLLVM_ENABLE_THREADS=OFF',
	'-DLLVM_ENABLE_UNWIND_TABLES=OFF',
	'-DLLVM_ENABLE_ZLIB=OFF',
	'-DLLVM_ENABLE_ZSTD=OFF',
	'-DCLANG_BUILD_EXAMPLES=OFF',
	'-DCLANG_BUILD_TOOLS=OFF',
	'-DCLANG_ENABLE_ARCMT=OFF',
	'-DCLANG_ENABLE_STATIC_ANALYZER=OFF',
	'-DCLANG_INCLUDE_DOCS=OFF',
	'-DCLANG_INCLUDE_TESTS=OFF',
	'-DCLANG_LINKS_TO_CREATE=clang;clang++',
	'-DLLD_BUILD_TOOLS=OFF'
]);
await run('cmake', [
	'--build',
	wasiBuild,
	'--target',
	'llvm-driver',
	'clang-resource-headers',
	...ninjaArgs
]);

await run('cmake', [
	'-G',
	'Ninja',
	'-S',
	path.join(llvmSource, 'llvm'),
	'-B',
	lldBuild,
	`-DCMAKE_TOOLCHAIN_FILE=${llvmWasiToolchainFile}`,
	`-DCMAKE_BUILD_TYPE=${config.llvmBuildType}`,
	`-DCMAKE_C_FLAGS=${wasiCompileFlags}`,
	`-DCMAKE_CXX_FLAGS=${wasiCompileFlags}`,
	`-DCMAKE_EXE_LINKER_FLAGS=${wasiLinkerFlags}`,
	`-DLLVM_HOST_TRIPLE=${config.hostTriple}`,
	`-DLLVM_DEFAULT_TARGET_TRIPLE=${config.targetTriple}`,
	'-DLLVM_TARGETS_TO_BUILD=WebAssembly',
	'-DLLVM_ENABLE_PROJECTS=lld',
	`-DLLVM_TABLEGEN=${path.join(nativeBuild, 'bin', 'llvm-tblgen')}`,
	'-DLLVM_BUILD_STATIC=ON',
	'-DLLVM_BUILD_RUNTIME=OFF',
	'-DLLVM_BUILD_TOOLS=OFF',
	'-DLLVM_BUILD_UTILS=OFF',
	'-DLLVM_INCLUDE_DOCS=OFF',
	'-DLLVM_INCLUDE_TESTS=OFF',
	'-DLLVM_INCLUDE_EXAMPLES=OFF',
	'-DLLVM_INCLUDE_BENCHMARKS=OFF',
	'-DLLVM_INCLUDE_RUNTIMES=OFF',
	'-DLLVM_INCLUDE_UTILS=OFF',
	'-DLLVM_TOOL_LLVM_DRIVER_BUILD=OFF',
	'-DLLVM_ENABLE_BACKTRACES=OFF',
	'-DLLVM_ENABLE_BINDINGS=OFF',
	'-DLLVM_ENABLE_CRASH_OVERRIDES=OFF',
	'-DLLVM_ENABLE_LIBEDIT=OFF',
	'-DLLVM_ENABLE_LIBXML2=OFF',
	'-DLLVM_ENABLE_PIC=OFF',
	'-DLLVM_ENABLE_TERMINFO=OFF',
	'-DLLVM_ENABLE_THREADS=OFF',
	'-DLLVM_ENABLE_UNWIND_TABLES=OFF',
	'-DLLVM_ENABLE_ZLIB=OFF',
	'-DLLVM_ENABLE_ZSTD=OFF',
	'-DLLD_BUILD_TOOLS=ON'
]);
await run('cmake', ['--build', lldBuild, '--target', 'lld', ...ninjaArgs]);

const resourceIncludeDir = await findResourceIncludeDir(wasiBuild);
if (!resourceIncludeDir) throw new Error('Could not find clang resource headers');
const resourceVersion = path.basename(path.dirname(resourceIncludeDir));

await fs.rm(stagingSysroot, { recursive: true, force: true });
await fs.mkdir(stagingSysroot, { recursive: true });
await run('tar', [
	'-xzf',
	path.join(downloadDir, sysrootArchive),
	'-C',
	stagingSysroot,
	'--strip-components=1'
]);
const libcxxShareDir = path.join(stagingSysroot, 'share', 'libc++', 'v1');
const libcxxIncludeDir = path.join(stagingSysroot, 'include', 'c++', 'v1');
let hasLibcxxInclude = false;
try {
	await fs.access(path.join(libcxxIncludeDir, 'vector'));
	hasLibcxxInclude = true;
} catch {
	for (const candidate of [
		libcxxShareDir,
		path.join(stagingSysroot, 'include', config.targetTriple, 'noeh', 'c++', 'v1'),
		path.join(stagingSysroot, 'include', config.targetTriple, 'eh', 'c++', 'v1')
	]) {
		try {
			await fs.access(path.join(candidate, 'vector'));
			await fs.mkdir(path.dirname(libcxxIncludeDir), { recursive: true });
			await fs.cp(candidate, libcxxIncludeDir, { recursive: true, force: true });
			hasLibcxxInclude = true;
			break;
		} catch {
			// Try the next libc++ location.
		}
	}
}
if (!hasLibcxxInclude) {
	throw new Error(`Could not find libc++ headers for ${config.targetTriple}`);
}
for (const header of GCC_COMPATIBILITY_HEADERS) {
	const target = path.join(stagingSysroot, header.path);
	await fs.mkdir(path.dirname(target), { recursive: true });
	await fs.writeFile(target, header.contents);
}
const stagedResourceIncludeDir = path.join(
	stagingSysroot,
	'lib',
	'clang',
	resourceVersion,
	'include'
);
await fs.rm(stagedResourceIncludeDir, { recursive: true, force: true });
await fs.mkdir(path.dirname(stagedResourceIncludeDir), { recursive: true });
await fs.cp(resourceIncludeDir, stagedResourceIncludeDir, { recursive: true, force: true });

const clangRtTemp = path.join(config.workDir, 'clang-rt');
await fs.rm(clangRtTemp, { recursive: true, force: true });
await fs.mkdir(clangRtTemp, { recursive: true });
await run('tar', [
	'-xzf',
	path.join(downloadDir, clangRtArchive),
	'-C',
	clangRtTemp,
	'--strip-components=1'
]);
const clangRtSource = await findFile(
	clangRtTemp,
	(filePath) =>
		filePath.endsWith('libclang_rt.builtins.a') &&
		(filePath.includes('wasm32-unknown-wasi') || filePath.includes('wasm32-unknown-wasip1'))
);
if (!clangRtSource) throw new Error('Could not find libclang_rt.builtins.a');
const clangRtTarget = path.join(
	stagingSysroot,
	'lib',
	'clang',
	resourceVersion,
	'lib',
	'wasi',
	'libclang_rt.builtins-wasm32.a'
);
await fs.mkdir(path.dirname(clangRtTarget), { recursive: true });
await fs.copyFile(clangRtSource, clangRtTarget);

const emsdkDir = path.join(config.workDir, 'emsdk');
try {
	await fs.access(emsdkDir);
} catch {
	await run('git', [
		'clone',
		'--branch',
		config.emsdkVersion,
		'--depth',
		'1',
		'https://github.com/emscripten-core/emsdk',
		emsdkDir
	]);
}
await run(path.join(emsdkDir, 'emsdk'), ['install', config.emsdkVersion]);
await run(path.join(emsdkDir, 'emsdk'), ['activate', config.emsdkVersion]);

const clangdBuild = path.join(buildDir, 'clangd');
const emsdkEnv = shellQuote(path.join(emsdkDir, 'emsdk_env.sh'));
const clangdConfigure = [
	'source',
	emsdkEnv,
	'&&',
	'emcmake',
	'cmake',
	'-G',
	'Ninja',
	'-S',
	shellQuote(path.join(llvmSource, 'llvm')),
	'-B',
	shellQuote(clangdBuild),
	shellQuote('-DCMAKE_CXX_FLAGS=-pthread -Dwait4=__syscall_wait4'),
	shellQuote(
		`-DCMAKE_EXE_LINKER_FLAGS=-pthread -s ENVIRONMENT=worker -s NO_INVOKE_RUN -s EXIT_RUNTIME -s INITIAL_MEMORY=2GB -s ALLOW_MEMORY_GROWTH -s MAXIMUM_MEMORY=4GB -s STACK_SIZE=256kB -s EXPORTED_RUNTIME_METHODS=FS,callMain -s MODULARIZE -s EXPORT_ES6 -s WASM_BIGINT -s ASSERTIONS -s ASYNCIFY -s PTHREAD_POOL_SIZE='Math.max(navigator.hardwareConcurrency, 8)' --embed-file=${stagingSysroot}/include@/usr/include`
	),
	`-DCMAKE_BUILD_TYPE=${config.llvmBuildType}`,
	'-DLLVM_TARGET_ARCH=wasm32-emscripten',
	`-DLLVM_DEFAULT_TARGET_TRIPLE=${config.targetTriple}`,
	'-DLLVM_TARGETS_TO_BUILD=WebAssembly',
	shellQuote('-DLLVM_ENABLE_PROJECTS=clang;clang-tools-extra'),
	shellQuote(`-DLLVM_TABLEGEN=${path.join(nativeBuild, 'bin', 'llvm-tblgen')}`),
	shellQuote(`-DCLANG_TABLEGEN=${path.join(nativeBuild, 'bin', 'clang-tblgen')}`),
	'-DLLVM_BUILD_STATIC=ON',
	'-DLLVM_INCLUDE_EXAMPLES=OFF',
	'-DLLVM_INCLUDE_TESTS=OFF',
	'-DLLVM_INCLUDE_BENCHMARKS=OFF',
	'-DLLVM_ENABLE_BACKTRACES=OFF',
	'-DLLVM_ENABLE_CRASH_OVERRIDES=OFF',
	'-DLLVM_ENABLE_LIBEDIT=OFF',
	'-DLLVM_ENABLE_LIBXML2=OFF',
	'-DLLVM_ENABLE_PIC=OFF',
	'-DLLVM_ENABLE_TERMINFO=OFF',
	'-DLLVM_ENABLE_ZLIB=OFF',
	'-DLLVM_ENABLE_ZSTD=OFF',
	'-DCLANG_ENABLE_ARCMT=OFF',
	'-DCLANG_ENABLE_STATIC_ANALYZER=OFF'
].join(' ');
await run('bash', ['-lc', clangdConfigure]);
await run('bash', [
	'-lc',
	`source ${emsdkEnv} && cmake --build ${shellQuote(clangdBuild)} --target clangd ${ninjaArgs.map(shellQuote).join(' ')}`
]);

for (const entry of await fs.readdir(path.join(stagingSysroot, 'include'), {
	withFileTypes: true
})) {
	if (!entry.isDirectory() || !entry.name.startsWith('wasm32-')) continue;
	if (entry.name !== config.targetTriple) {
		await fs.rm(path.join(stagingSysroot, 'include', entry.name), {
			recursive: true,
			force: true
		});
		continue;
	}
	for (const relativePath of ['c++', path.join('eh', 'c++'), path.join('noeh', 'c++')]) {
		await fs.rm(path.join(stagingSysroot, 'include', entry.name, relativePath), {
			recursive: true,
			force: true
		});
	}
}

const targetLibDir = path.join(stagingSysroot, 'lib', config.targetTriple);
for (const library of ['libc++.a', 'libc++abi.a']) {
	try {
		await fs.access(path.join(targetLibDir, library));
	} catch {
		await fs.copyFile(
			path.join(targetLibDir, 'noeh', library),
			path.join(targetLibDir, library)
		);
	}
}
for (const entry of await fs.readdir(path.join(stagingSysroot, 'lib'), {
	withFileTypes: true
})) {
	if (!entry.isDirectory() || !entry.name.startsWith('wasm32-')) continue;
	if (entry.name !== config.targetTriple) {
		await fs.rm(path.join(stagingSysroot, 'lib', entry.name), { recursive: true, force: true });
		continue;
	}
	for (const relativePath of ['eh', 'noeh', 'llvm-lto']) {
		await fs.rm(path.join(stagingSysroot, 'lib', entry.name, relativePath), {
			recursive: true,
			force: true
		});
	}
}
await fs.rm(path.join(stagingSysroot, 'share'), { recursive: true, force: true });
await fs.rm(path.join(stagingSysroot, 'VERSION'), { force: true });
for (const entry of await fs.readdir(targetLibDir, { withFileTypes: true }).catch(() => [])) {
	if (!entry.isFile()) continue;
	if (!['crt1.o', 'libc.a', 'libc++.a', 'libc++abi.a', 'libm.a'].includes(entry.name)) {
		await fs.rm(path.join(targetLibDir, entry.name), { force: true });
	}
}

const probeDir = path.join(config.workDir, 'sysroot-probes');
await fs.rm(probeDir, { recursive: true, force: true });
await fs.mkdir(probeDir, { recursive: true });
const cProbe = path.join(probeDir, 'probe.c');
const cppProbe = path.join(probeDir, 'probe.cpp');
const cDeps = path.join(probeDir, 'probe-c.d');
const cppDeps = path.join(probeDir, 'probe-cpp.d');
await fs.writeFile(cProbe, '#include <stdio.h>\nint main(void) { return puts("probe"); }\n');
await fs.writeFile(
	cppProbe,
	[
		'#include <bits/stdc++.h>',
		'#include <bits/extc++.h>',
		'#include <ext/rope>',
		'#include <ext/pb_ds/assoc_container.hpp>',
		'#include <ext/pb_ds/tree_policy.hpp>',
		'using namespace std;',
		'using namespace __gnu_cxx;',
		'using namespace __gnu_pbds;',
		'using ordered_set = tree<int, null_type, less<int>, rb_tree_tag, tree_order_statistics_node_update>;',
		'int main() {',
		'  ordered_set values;',
		'  gp_hash_table<int, int> table;',
		'  crope text("abc");',
		'  __gnu_pbds::priority_queue<int> heap;',
		'  cout << values.size() << table.size() << text.size() << heap.size() << "\\n";',
		'}',
		''
	].join('\n')
);
const wasiBinDir = path.join(wasiSdkPath, 'bin');
const cProbeCommand = [
	shellQuote(path.join(wasiBinDir, 'clang')),
	`--target=${config.targetTriple}`,
	`--sysroot=${shellQuote(stagingSysroot)}`,
	`-resource-dir ${shellQuote(path.join(stagingSysroot, 'lib', 'clang', resourceVersion))}`,
	`-I${shellQuote(path.join(stagingSysroot, 'include'))}`,
	`-isystem ${shellQuote(path.join(stagingSysroot, 'include', config.targetTriple))}`,
	'-E',
	'-M',
	shellQuote(cProbe),
	'>',
	shellQuote(cDeps)
].join(' ');
const cppProbeCommand = [
	shellQuote(path.join(wasiBinDir, 'clang++')),
	`--target=${config.targetTriple}`,
	`--sysroot=${shellQuote(stagingSysroot)}`,
	`-resource-dir ${shellQuote(path.join(stagingSysroot, 'lib', 'clang', resourceVersion))}`,
	'-std=gnu++20',
	`-I${shellQuote(path.join(stagingSysroot, 'include'))}`,
	`-isystem ${shellQuote(libcxxIncludeDir)}`,
	`-isystem ${shellQuote(path.join(stagingSysroot, 'include', config.targetTriple))}`,
	'-E',
	'-M',
	shellQuote(cppProbe),
	'>',
	shellQuote(cppDeps)
].join(' ');
await run('bash', ['-lc', cProbeCommand]);
await run('bash', ['-lc', cppProbeCommand]);

const dependencyFiles = new Set();
for (const depsFile of [cDeps, cppDeps]) {
	const deps = (await fs.readFile(depsFile, 'utf8')).replaceAll(/\\\r?\n/g, ' ');
	for (const token of deps.split(/\s+/).slice(1)) {
		const normalizedToken = token.replace(/\\$/, '');
		if (!normalizedToken || normalizedToken === ':') continue;
		const relative = path.relative(stagingSysroot, path.resolve(normalizedToken));
		if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
		dependencyFiles.add(relative.split(path.sep).join('/'));
	}
}

async function pruneFilesOutsideDependencyClosure(directory, isRoot = true) {
	let hasEntries = false;
	for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (await pruneFilesOutsideDependencyClosure(entryPath, false)) hasEntries = true;
			continue;
		}
		if (!entry.isFile()) {
			hasEntries = true;
			continue;
		}
		const relative = path.relative(stagingSysroot, entryPath).split(path.sep).join('/');
		if (dependencyFiles.has(relative)) {
			hasEntries = true;
			continue;
		}
		await fs.rm(entryPath, { force: true });
	}
	if (!isRoot && !hasEntries) {
		await fs.rm(directory, { recursive: true, force: true });
		return false;
	}
	return true;
}

await pruneFilesOutsideDependencyClosure(path.join(stagingSysroot, 'include'));
await pruneFilesOutsideDependencyClosure(stagedResourceIncludeDir);

await run('node', [
	path.join(scriptDir, 'package-toolchain.mjs'),
	'--clang-wasm',
	path.join(wasiBuild, 'bin', 'llvm'),
	'--lld-wasm',
	path.join(lldBuild, 'bin', 'lld'),
	'--sysroot',
	stagingSysroot,
	'--clangd-js',
	path.join(clangdBuild, 'bin', 'clangd.js'),
	'--clangd-wasm',
	path.join(clangdBuild, 'bin', 'clangd.wasm'),
	'--target-dir',
	config.outDir,
	'--llvm-version',
	config.llvmVersion,
	'--wasi-sdk-version',
	config.wasiSdkVersion,
	'--emsdk-version',
	config.emsdkVersion,
	'--resource-dir',
	`/lib/clang/${resourceVersion}`,
	'--compiler-runtime-lib-dir',
	`lib/clang/${resourceVersion}/lib/wasi`
]);

console.log(`Packaged wasm-clang toolchain into ${config.outDir}`);
