import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const rustToolchainRoot =
	process.env.WASM_RUST_NATIVE_TOOLCHAIN_ROOT ||
	path.join(os.homedir(), '.rustup', 'toolchains', 'nightly-2024-04-12-x86_64-unknown-linux-gnu');
const rustcPath = path.join(rustToolchainRoot, 'bin', 'rustc');
const rustLldPath = path.join(rustToolchainRoot, 'lib', 'rustlib', 'x86_64-unknown-linux-gnu', 'bin', 'rust-lld');
const rustTargetTriple = process.env.WASM_RUST_NATIVE_TARGET_TRIPLE || 'wasm32-wasip1';
const sampleProgram = process.env.WASM_RUST_SAMPLE_PROGRAM || 'fn main() { println!("hi"); }';
const wasmIdleRoot =
	process.env.WASM_RUST_WASM_IDLE_ROOT || path.join(workspaceRoot, 'wasm-idle');
const staticRoot = path.join(wasmIdleRoot, 'static');
const wabtInterpPath =
	process.env.WASM_RUST_WABT_INTERP ||
	path.join(projectRoot, 'node_modules', '.bin', 'wasm-interp');

function normalizeMemfsPath(inputPath) {
	return inputPath.replaceAll(path.sep, '/').replace(/^\/+/, '');
}

async function withPatchedFetch(run) {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const requestUrl =
			typeof input === 'string' || input instanceof URL ? new URL(input.toString()) : new URL(input.url);
		const filePath = path.join(staticRoot, requestUrl.pathname);
		try {
			const body = await fs.readFile(filePath);
			return new Response(body, {
				status: 200,
				headers: {
					'Content-Length': String(body.byteLength)
				}
			});
		} catch (error) {
			if (error?.code !== 'ENOENT') {
				throw error;
			}
			return new Response(`not found: ${requestUrl.pathname}`, { status: 404 });
		}
	};
	try {
		return await run();
	} finally {
		globalThis.fetch = originalFetch;
	}
}

async function importBrowserClang() {
	const modulePath = pathToFileURL(path.join(wasmIdleRoot, 'dist', 'clang', 'index.js')).href;
	const mod = await import(modulePath);
	return mod.default;
}

async function prepareRustArtifacts(workDir) {
	const sourcePath = path.join(workDir, 'main.rs');
	const linkerLogPath = path.join(workDir, 'rust-lld-link-args.txt');
	const linkerWrapperPath = path.join(workDir, 'rust-lld-wrapper.sh');
	const llvmIrPath = path.join(workDir, 'main.ll');
	await fs.writeFile(sourcePath, sampleProgram);
	await fs.writeFile(
		linkerWrapperPath,
		[
			'#!/usr/bin/env bash',
			`printf '%s\\n' "$@" > ${JSON.stringify(linkerLogPath)}`,
			`exec ${JSON.stringify(rustLldPath)} "$@"`
		].join('\n'),
		{ mode: 0o755 }
	);

	await execFileAsync(
		rustcPath,
		[
			'--target',
			rustTargetTriple,
			'-Clinker=' + linkerWrapperPath,
			'-Cpanic=abort',
			'-Ccodegen-units=1',
			'-Csave-temps',
			sourcePath,
			'-o',
			path.join(workDir, 'native-main.wasm')
		],
		{ cwd: workDir }
	);
	await execFileAsync(
		rustcPath,
		[
			'--target',
			rustTargetTriple,
			'-Cpanic=abort',
			'-Ccodegen-units=1',
			'--emit=llvm-ir',
			sourcePath,
			'-o',
			llvmIrPath
		],
		{ cwd: workDir }
	);

	const entries = await fs.readdir(workDir);
	const noOptBitcodeName = entries.find((entry) => entry.endsWith('.bc'));
	if (!noOptBitcodeName) {
		throw new Error(`Failed to find .bc in ${workDir}`);
	}
	const tempObjectNames = entries.filter(
		(entry) => entry.endsWith('.rcgu.o') && !entry.includes('-cgu.0.')
	);
	if (tempObjectNames.length !== 1) {
		throw new Error(
			`Expected exactly one allocator shim object, found ${tempObjectNames.length}: ${tempObjectNames.join(', ')}`
		);
	}

		return {
			sourcePath,
			linkerLogPath,
			llvmIrPath,
			noOptBitcodePath: path.join(workDir, noOptBitcodeName),
			allocatorObjectPath: path.join(workDir, tempObjectNames[0])
		};
}

function translateLinkArgs(args, fileMap) {
	return args.map((arg) => {
		if (fileMap.has(arg)) {
			return fileMap.get(arg);
		}
		if (arg === 'c') {
			return arg;
		}
		if (arg.startsWith('-L')) {
			const linkedPath = arg.slice(2);
			if (fileMap.has(linkedPath)) {
				return `-L${fileMap.get(linkedPath)}`;
			}
		}
		return arg;
	});
}

async function addFileWithParents(clang, memfsPath, contents) {
	const normalized = normalizeMemfsPath(memfsPath);
	const segments = normalized.split('/');
	let current = '';
	for (const segment of segments.slice(0, -1)) {
		current = current ? `${current}/${segment}` : segment;
		try {
			clang.memfs.addDirectory(current);
		} catch {}
	}
	clang.memfs.addFile(normalized, contents);
}

async function lowerBitcodeToObject(clang, clangModule, bitcodePath, llvmIrPath, objectPath) {
	const attempts = [
		['clang', '--target=wasm32-wasi', '-c', bitcodePath, '-o', objectPath],
		['clang', '-cc1', '-triple', 'wasm32-wasi', '-emit-obj', '-x', 'ir', bitcodePath, '-o', objectPath],
		['clang', '--target=wasm32-wasi', '-c', llvmIrPath, '-o', objectPath],
		['clang', '-cc1', '-triple', 'wasm32-wasi', '-emit-obj', '-x', 'ir', llvmIrPath, '-o', objectPath]
	];

	const failures = [];
	for (const args of attempts) {
		const outputChunks = [];
		const previousStdout = clang.stdout;
		clang.stdout = (chunk) => {
			outputChunks.push(chunk);
			previousStdout(chunk);
		};
		try {
			await clang.run(clangModule, true, ...args);
			const compiled = Uint8Array.from(clang.memfs.getFileContents(objectPath));
			if (compiled.byteLength > 0) {
				return {
					args,
					output: outputChunks.join(''),
					size: compiled.byteLength
				};
			}
		} catch (error) {
			failures.push({
				args,
				message: error?.message || String(error),
				output: outputChunks.join('')
			});
		} finally {
			clang.stdout = previousStdout;
		}
	}

	throw new Error(`Failed to lower Rust LLVM IR with browser clang: ${JSON.stringify(failures, null, 2)}`);
}

async function main() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wasm-rust-browser-split-'));
	const outputLog = [];
	try {
		const {
			linkerLogPath,
			llvmIrPath,
			noOptBitcodePath,
			allocatorObjectPath
		} = await prepareRustArtifacts(tempRoot);
		const linkArgs = (await fs.readFile(linkerLogPath, 'utf8'))
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);

		const Clang = await withPatchedFetch(() => importBrowserClang());
		const clang = await withPatchedFetch(async () => {
			const instance = new Clang({
				stdin: () => '',
				stdout: (chunk) => outputLog.push(chunk),
				progress: () => {},
				path: 'http://wasm-idle.local'
			});
			await instance.ready;
			return instance;
		});
		const clangModule = await withPatchedFetch(() => clang.getModule('http://wasm-idle.local/clang/bin/clang.zip'));
		const lldModule = await withPatchedFetch(() => clang.getModule('http://wasm-idle.local/clang/bin/lld.zip'));

		const llvmIrMemfsPath = 'work/main.ll';
		const bitcodeMemfsPath = 'work/main.no-opt.bc';
		const browserObjectMemfsPath = 'work/main.browser.o';
		const allocatorMemfsPath = 'work/alloc-shim.o';
		const linkedWasmMemfsPath = 'work/main.browser.wasm';
		await addFileWithParents(clang, llvmIrMemfsPath, await fs.readFile(llvmIrPath));
		await addFileWithParents(clang, bitcodeMemfsPath, await fs.readFile(noOptBitcodePath));
		await addFileWithParents(clang, allocatorMemfsPath, await fs.readFile(allocatorObjectPath));

		const fileMap = new Map([
			[noOptBitcodePath, bitcodeMemfsPath],
			[llvmIrPath, llvmIrMemfsPath],
			[allocatorObjectPath, allocatorMemfsPath]
		]);
		const rustLibDir = path.join(rustToolchainRoot, 'lib', 'rustlib', rustTargetTriple, 'lib');
		const referencedLibPaths = linkArgs.filter(
			(arg) => path.isAbsolute(arg) && (arg.endsWith('.rlib') || arg.endsWith('.o'))
		);
		for (const libPath of referencedLibPaths) {
			const relativeFromLib = path.relative(rustLibDir, libPath);
			const relativeFromToolchain = path.relative(rustToolchainRoot, libPath);
			const memfsPath =
				!relativeFromLib.startsWith('..') && !path.isAbsolute(relativeFromLib)
					? `rustlib/${normalizeMemfsPath(relativeFromLib)}`
					: `toolchain/${normalizeMemfsPath(relativeFromToolchain)}`;
			fileMap.set(libPath, memfsPath);
			await addFileWithParents(clang, memfsPath, await fs.readFile(libPath));
		}

		const rustLibMemfsDir = 'rustlib';
		const selfContainedMemfsDir = 'rustlib/self-contained';
		fileMap.set(rustLibDir, rustLibMemfsDir);
		fileMap.set(path.join(rustLibDir, 'self-contained'), selfContainedMemfsDir);

		const mainObjectArgIndex = linkArgs.findIndex((arg) => arg.endsWith('-cgu.0.rcgu.o'));
		const allocatorArgIndex = linkArgs.findIndex(
			(arg, index) => arg.endsWith('.rcgu.o') && index !== mainObjectArgIndex
		);
		if (mainObjectArgIndex === -1 || allocatorArgIndex === -1) {
			throw new Error(`Failed to identify Rust object arguments in link args: ${JSON.stringify(linkArgs)}`);
		}
		fileMap.set(linkArgs[mainObjectArgIndex], browserObjectMemfsPath);
		fileMap.set(linkArgs[allocatorArgIndex], allocatorMemfsPath);

		const lowered = await lowerBitcodeToObject(
			clang,
			clangModule,
			bitcodeMemfsPath,
			llvmIrMemfsPath,
			browserObjectMemfsPath
		);

		const translatedLinkArgs = translateLinkArgs(linkArgs, fileMap).map((arg, index, all) => {
			if (arg === all[all.length - 1] && arg.endsWith('.wasm')) {
				return linkedWasmMemfsPath;
			}
			return arg;
		});
		if (translatedLinkArgs[0] && !translatedLinkArgs[0].startsWith('-')) {
			translatedLinkArgs.shift();
		}
		const outputIndex = translatedLinkArgs.findIndex((arg) => arg === '-o');
		if (outputIndex === -1 || outputIndex + 1 >= translatedLinkArgs.length) {
			throw new Error(`Missing -o in translated link args: ${JSON.stringify(translatedLinkArgs)}`);
		}
		translatedLinkArgs[outputIndex + 1] = linkedWasmMemfsPath;
		await clang.run(lldModule, true, 'wasm-ld', ...translatedLinkArgs.slice(1));

		const linkedWasm = Uint8Array.from(clang.memfs.getFileContents(linkedWasmMemfsPath));
		const wasmPath = path.join(tempRoot, 'main.browser.wasm');
		await fs.writeFile(wasmPath, linkedWasm);
		const runtime = await execFileAsync(wabtInterpPath, ['--wasi', wasmPath], {
			cwd: tempRoot
		});

		console.log(
			JSON.stringify(
				{
					success: true,
					tempRoot,
					loweredWith: lowered.args,
					loweredObjectSize: lowered.size,
					wasmBytes: linkedWasm.byteLength,
					runtimeStdout: runtime.stdout,
					runtimeStderr: runtime.stderr,
					linkArgs: translatedLinkArgs,
					logSnippet: outputLog.join('').slice(-4000)
				},
				null,
				2
			)
		);
	} catch (error) {
		console.error(
			JSON.stringify(
				{
					success: false,
					message: error?.message || String(error),
					stack: String(error?.stack || '')
						.split('\n')
						.slice(0, 12)
						.join('\n'),
					logSnippet: outputLog.join('').slice(-4000)
				},
				null,
				2
			)
		);
		process.exitCode = 1;
	}
}

await main();
