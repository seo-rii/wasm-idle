import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

import {
	Directory,
	Fd,
	File,
	Inode,
	OpenFile,
	PreopenDirectory,
	WASI,
	wasi
} from '@bjorn3/browser_wasi_shim';
import { NodePreopenDirectory } from './wasi-node-fs.mjs';

const DEFAULT_WASM_RUSTC_ROOT = '/tmp/wasm-rustc-20260315';
const DEFAULT_TOOLCHAIN_ROOT =
	path.join(os.homedir(), '.rustup', 'toolchains', 'nightly-2024-04-12-x86_64-unknown-linux-gnu');
const DEFAULT_TARGET_TRIPLE = 'wasm32-wasip1';
const EXPECTED_TOOLCHAIN_VERSION = 'rustc 1.79.0-nightly (a07f3eb43 2024-04-11)';
const EXPECTED_WASM_RUSTC_VERSION = 'rustc 1.79.0-dev';
const SAMPLE_PROGRAM = process.env.WASM_RUST_SAMPLE_PROGRAM || 'fn main() { println!("hi"); }';
const THREAD_COUNTER_BYTES = 4;
const THREAD_READY_BYTES = 4;
const THREAD_DEBUG = process.env.WASM_RUST_THREAD_DEBUG === '1';
const USE_NODE_FS = process.env.WASM_RUST_NODE_FS === '1';
const THREAD_STARTUP_STATE_FAILED = -1;
const THREAD_STARTUP_STATE_STARTING = 1;
const THREAD_STARTUP_STATE_INSTANTIATED = 2;
const THREAD_STARTUP_STATE_ENTERING = 3;
const MEMORY_INITIAL_PAGES = Number(process.env.WASM_RUST_MEMORY_INITIAL_PAGES || '256');
const MEMORY_MAXIMUM_PAGES = Number(process.env.WASM_RUST_MEMORY_MAXIMUM_PAGES || '16384');
const HOST_ROOT_PATH = process.env.WASM_RUST_HOST_ROOT_PATH || null;
const KEEP_HOST_ROOT = process.env.WASM_RUST_KEEP_HOST_ROOT === '1';
const RUSTC_STRING_GROW_BY_IMPORT =
	'_ZNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE9__grow_byEmmmmmm';

class CaptureFd extends Fd {
	constructor(outputStream = null) {
		super();
		this.ino = Inode.issue_ino();
		this.decoder = new TextDecoder();
		this.text = '';
		this.outputStream = outputStream;
	}

	fd_filestat_get() {
		return {
			ret: wasi.ERRNO_SUCCESS,
			filestat: new wasi.Filestat(this.ino, wasi.FILETYPE_CHARACTER_DEVICE, 0n)
		};
	}

	fd_fdstat_get() {
		const fdstat = new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0);
		fdstat.fs_rights_base = BigInt(wasi.RIGHTS_FD_WRITE);
		return {
			ret: wasi.ERRNO_SUCCESS,
			fdstat
		};
	}

	fd_write(data) {
		const chunk = this.decoder.decode(data, { stream: true });
		this.text += chunk;
		if (this.outputStream) {
			this.outputStream.write(chunk);
		}
		return {
			ret: wasi.ERRNO_SUCCESS,
			nwritten: data.byteLength
		};
	}

	getText() {
		const trailing = this.decoder.decode();
		if (trailing && this.outputStream) {
			this.outputStream.write(trailing);
		}
		return this.text + trailing;
	}
}

function runCommand(command, args, cwd) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString();
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				reject(
					new Error(
						`${command} ${args.join(' ')} failed with code ${code}\n${stdout}\n${stderr}`.trim()
					)
				);
				return;
			}
			resolve({ stdout, stderr });
		});
	});
}

async function dirFromFs(base) {
	const entries = await fs.readdir(base, { withFileTypes: true });
	const map = new Map();
	for (const entry of entries) {
		const full = path.join(base, entry.name);
		if (entry.isDirectory()) {
			map.set(entry.name, await dirFromFs(full));
			continue;
		}
		if (entry.isFile()) {
			map.set(entry.name, new File(await fs.readFile(full), { readonly: true }));
		}
	}
	return new Directory(map);
}

async function ensureExists(target) {
	await fs.access(target);
}

async function patchTargetStdlib(toolchainRoot, targetTriple) {
	const sourceDir = path.join(toolchainRoot, 'lib', 'rustlib', targetTriple);
	const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'wasm-rust-target-'));
	const destinationDir = path.join(destination, targetTriple);
	await fs.cp(sourceDir, destinationDir, { recursive: true });
	const libraryDir = path.join(destinationDir, 'lib');
	const entries = await fs.readdir(libraryDir);
	const patched = [];

	for (const entry of entries) {
		if (!entry.endsWith('.rlib')) continue;
		const archivePath = path.join(libraryDir, entry);
		const extractDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wasm-rust-rlib-'));
		try {
			await runCommand('ar', ['x', archivePath], extractDir);
			const rmetaPath = path.join(extractDir, 'lib.rmeta');
			const blob = await fs.readFile(rmetaPath);
			const needle = Buffer.from(EXPECTED_TOOLCHAIN_VERSION);
			const index = blob.indexOf(needle);
			if (index === -1) continue;
			if (index < 1) {
				throw new Error(`Unable to locate rmeta length byte for ${archivePath}`);
			}
			const lengthIndex = index - 1;
			if (blob[lengthIndex] !== needle.length) {
				throw new Error(
					`Unexpected rmeta string length byte ${blob[lengthIndex]} for ${archivePath}`
				);
			}
			const replacement = Buffer.from(EXPECTED_WASM_RUSTC_VERSION);
			const patchedBlob = Buffer.concat([
				blob.subarray(0, lengthIndex),
				Buffer.from([replacement.length]),
				replacement,
				blob.subarray(index + needle.length)
			]);
			await fs.writeFile(rmetaPath, patchedBlob);
			const members = await fs.readdir(extractDir);
			await runCommand('ar', ['rcs', archivePath, ...members], extractDir);
			patched.push(entry);
		} finally {
			await fs.rm(extractDir, { recursive: true, force: true });
		}
	}

	return {
		targetRoot: destinationDir,
		patchedArchives: patched
	};
}

async function buildSysrootDirectory(wasmRustcRoot, toolchainRoot, targetTriple, patchTargetMetadata) {
	const hostRustlib = await dirFromFs(path.join(wasmRustcRoot, 'lib', 'rustlib'));
	let patchedMetadata = null;
	let targetRoot = path.join(toolchainRoot, 'lib', 'rustlib', targetTriple);
	if (patchTargetMetadata) {
		patchedMetadata = await patchTargetStdlib(toolchainRoot, targetTriple);
		targetRoot = patchedMetadata.targetRoot;
	}
	const targetDirectory = await dirFromFs(targetRoot);
	hostRustlib.contents.set(targetTriple, targetDirectory);
	const sysrootDir = new Directory(
		new Map([
			[
				'lib',
				new Directory(
					new Map([
						['rustlib', hostRustlib]
					])
				)
			]
		])
	);
	return { sysrootDir, patchedMetadata };
}

function createSharedSafeRandomGet(memory) {
	return (buf, bufLen) => {
		const target = new Uint8Array(memory.buffer, buf, bufLen);
		if (globalThis.crypto?.getRandomValues) {
			for (let offset = 0; offset < bufLen; offset += 65536) {
				const chunkLen = Math.min(65536, bufLen - offset);
				const chunk = new Uint8Array(chunkLen);
				globalThis.crypto.getRandomValues(chunk);
				target.set(chunk, offset);
			}
			return wasi.ERRNO_SUCCESS;
		}
		for (let index = 0; index < bufLen; index += 1) {
			target[index] = Math.floor(Math.random() * 256);
		}
		return wasi.ERRNO_SUCCESS;
	};
}

function waitForThreadStartupState(state, minimumState, timeoutMs, failureMessage, timeoutMessage) {
	const deadline = Date.now() + timeoutMs;
	while (true) {
		const currentState = Atomics.load(state, 0);
		if (currentState >= minimumState) {
			return currentState;
		}
		if (currentState <= THREAD_STARTUP_STATE_FAILED) {
			throw new Error(failureMessage);
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			throw new Error(timeoutMessage);
		}
		Atomics.wait(state, 0, currentState, Math.min(remaining, 1000));
	}
}

async function instantiateThreadContext({
	rustcModule,
	rustcWasmPath,
	memory,
	args,
	env,
	wasmRustcRoot,
	toolchainRoot,
	targetTriple,
	patchTargetMetadata,
	sampleProgram,
	threadCounterBuffer,
	hostRootPath,
	workHostPath,
	useRealThreads
}) {
	if (THREAD_DEBUG) {
		console.error(
			`[wasm-rust-thread] context:start nodeFs=${USE_NODE_FS ? '1' : '0'} hostRoot=${hostRootPath ?? 'null'}`
		);
	}
	const module =
		rustcModule ?? (await WebAssembly.compile(await fs.readFile(rustcWasmPath)));
	if (THREAD_DEBUG) {
		console.error('[wasm-rust-thread] context:module-ready');
	}
	const stdin = new OpenFile(new File(new Uint8Array(), { readonly: true }));
	const stdout = new CaptureFd();
	const stderr = new CaptureFd();
	const fds = USE_NODE_FS
		? [
				stdin,
				stdout,
				stderr,
				new NodePreopenDirectory('/tmp', os.tmpdir(), false),
				new NodePreopenDirectory('/sysroot', toolchainRoot, true),
				new NodePreopenDirectory('/', hostRootPath, false)
			]
		: await (async () => {
				const { sysrootDir } = await buildSysrootDirectory(
					wasmRustcRoot,
					toolchainRoot,
					targetTriple,
					patchTargetMetadata
				);
				const workDir = new Directory(
					new Map([
						['main.rs', new File(new TextEncoder().encode(sampleProgram))]
					])
				);
				const rootDir = new Directory(
					new Map([
						['sysroot', sysrootDir],
						['work', workDir]
					])
				);
				return [
					stdin,
					stdout,
					stderr,
					new PreopenDirectory('/tmp', []),
					new PreopenDirectory('/sysroot', Array.from(sysrootDir.contents.entries())),
					new PreopenDirectory('/', Array.from(rootDir.contents.entries()))
				];
			})();
	if (THREAD_DEBUG) {
		console.error(`[wasm-rust-thread] context:fds-ready count=${fds.length}`);
	}
	const wasiInstance = new WASI(args, env, fds, { debug: false });
	wasiInstance.wasiImport.random_get = createSharedSafeRandomGet(memory);
	if (THREAD_DEBUG) {
		console.error('[wasm-rust-thread] context:wasi-ready');
	}
	let instance;
	let nextThreadId = 1;
	const threadSpawner = useRealThreads
		? createRealThreadSpawner({
				rustcModule: module,
				rustcWasmPath,
				memory,
				args,
				env,
				wasmRustcRoot,
				toolchainRoot,
				targetTriple,
				patchTargetMetadata,
				sampleProgram,
				threadCounterBuffer,
				hostRootPath,
				workHostPath
			})
		: (startArg) => {
				const threadId = nextThreadId++;
				instance.exports.wasi_thread_start(threadId, startArg);
				return threadId;
			};
	if (THREAD_DEBUG) {
		console.error('[wasm-rust-thread] context:instantiate-begin');
	}
	instance = await WebAssembly.instantiate(module, {
		env: {
			memory,
			[RUSTC_STRING_GROW_BY_IMPORT]: () => {}
		},
		wasi: {
			'thread-spawn': threadSpawner
		},
		wasi_snapshot_preview1: wasiInstance.wasiImport
	});
	if (THREAD_DEBUG) {
		console.error('[wasm-rust-thread] context:instantiate-done');
	}
	return { instance, wasiInstance, stdout, stderr, workDir: null };
}

function createRealThreadSpawner({
	rustcModule,
	rustcWasmPath,
	memory,
	args,
	env,
	wasmRustcRoot,
	toolchainRoot,
	targetTriple,
	patchTargetMetadata,
	sampleProgram,
	threadCounterBuffer,
	hostRootPath,
	workHostPath
}) {
	const counter = new Int32Array(threadCounterBuffer);
	return (startArg) => {
		const threadId = Atomics.add(counter, 0, 1) + 1;
		const readyBuffer = new SharedArrayBuffer(THREAD_READY_BYTES);
		const readyState = new Int32Array(readyBuffer);
		if (THREAD_DEBUG) {
			console.error(`[wasm-rust-thread] spawn ${threadId} startArg=${startArg}`);
		}
		const worker = new Worker(new URL(import.meta.url), {
			type: 'module',
			workerData: {
				kind: 'wasi-thread',
				rustcModule,
				rustcWasmPath,
				memory,
				threadId,
				startArg,
				args,
				env,
				wasmRustcRoot,
				toolchainRoot,
				targetTriple,
				patchTargetMetadata,
				sampleProgram,
				threadCounterBuffer,
				hostRootPath,
				workHostPath,
				readyBuffer,
				useRealThreads: true
			},
			stdout: THREAD_DEBUG,
			stderr: THREAD_DEBUG
		});
		worker.on('online', () => {
			if (THREAD_DEBUG) {
				console.error(`[wasm-rust-thread] online ${threadId}`);
			}
		});
		if (THREAD_DEBUG) {
			worker.stdout?.on('data', (chunk) => {
				process.stderr.write(`[wasm-rust-thread][stdout ${threadId}] ${chunk}`);
			});
			worker.stderr?.on('data', (chunk) => {
				process.stderr.write(`[wasm-rust-thread][stderr ${threadId}] ${chunk}`);
			});
		}
		worker.on('message', (message) => {
			if (THREAD_DEBUG) {
				console.error(`[wasm-rust-thread] message ${threadId} ${JSON.stringify(message)}`);
			}
		});
		worker.on('exit', (code) => {
			if (THREAD_DEBUG) {
				console.error(`[wasm-rust-thread] exit ${threadId} code=${code}`);
			}
		});
		worker.on('error', (error) => {
			console.error(`wasi thread ${threadId} failed`, error);
		});
		let readyResult = 'not-needed';
		try {
			waitForThreadStartupState(
				readyState,
				THREAD_STARTUP_STATE_ENTERING,
				120000,
				`wasi thread ${threadId} failed before entering wasi_thread_start`,
				`wasi thread ${threadId} timed out before entering wasi_thread_start`
			);
		} catch (error) {
			readyResult = error instanceof Error ? error.message : String(error);
			throw error;
		}
		if (THREAD_DEBUG) {
			console.error(
				`[wasm-rust-thread] ready ${threadId} result=${readyResult} state=${Atomics.load(readyState, 0)}`
			);
		}
		return threadId;
	};
}

async function runThreadWorkerEntry() {
	const {
		rustcModule,
		rustcWasmPath,
		memory,
		threadId,
		startArg,
		args,
		env,
		wasmRustcRoot,
		toolchainRoot,
		targetTriple,
		patchTargetMetadata,
		sampleProgram,
		threadCounterBuffer,
		hostRootPath,
		workHostPath,
		readyBuffer,
		useRealThreads
	} = workerData;
	const threadLogPath =
		USE_NODE_FS && workHostPath ? path.join(workHostPath, `.thread-${threadId}.log`) : null;
	const writeThreadLog = async (label, payload = null) => {
		if (!threadLogPath) return;
		const line = JSON.stringify({
			label,
			payload,
			at: new Date().toISOString()
		});
		await fs.appendFile(threadLogPath, `${line}\n`);
	};
	const readyState = new Int32Array(readyBuffer);
	if (THREAD_DEBUG) {
		console.error(`[wasm-rust-thread] enter ${threadId} startArg=${startArg}`);
	}
	await writeThreadLog('enter', { startArg });
	Atomics.store(readyState, 0, THREAD_STARTUP_STATE_STARTING);
	Atomics.notify(readyState, 0);
	const { instance, wasiInstance } = await instantiateThreadContext({
		rustcModule,
		rustcWasmPath,
		memory,
		args,
		env,
		wasmRustcRoot,
		toolchainRoot,
		targetTriple,
		patchTargetMetadata,
		sampleProgram,
		threadCounterBuffer,
		hostRootPath,
		workHostPath,
		useRealThreads
	});
	wasiInstance.inst = instance;
	await writeThreadLog('ready');
	Atomics.store(readyState, 0, THREAD_STARTUP_STATE_INSTANTIATED);
	Atomics.notify(readyState, 0);
	try {
		Atomics.store(readyState, 0, THREAD_STARTUP_STATE_ENTERING);
		Atomics.notify(readyState, 0);
		instance.exports.wasi_thread_start(threadId, startArg);
		await writeThreadLog('done');
		if (THREAD_DEBUG) {
			console.error(`[wasm-rust-thread] done ${threadId}`);
		}
		parentPort?.postMessage({ ok: true, threadId });
	} catch (error) {
			await writeThreadLog('fail', {
				name: error?.name || 'Error',
				message: error?.message || String(error),
				stack: String(error?.stack || '')
					.split('\n')
					.slice(0, 12)
					.join('\n')
			});
		if (THREAD_DEBUG) {
			console.error(`[wasm-rust-thread] fail ${threadId} ${error?.message || String(error)}`);
		}
		parentPort?.postMessage({
			ok: false,
			threadId,
			error: {
				name: error?.name || 'Error',
				message: error?.message || String(error),
				stack: String(error?.stack || '')
					.split('\n')
					.slice(0, 8)
					.join('\n')
			}
		});
		throw error;
	}
}

async function instantiateRustc({
	rustcWasmPath,
	wasiInstance,
	wasmRustcRoot,
	toolchainRoot,
	targetTriple,
	patchTargetMetadata,
	sampleProgram,
	args,
	env,
	hostRootPath,
	workHostPath,
	useRealThreads
}) {
	const rustcModule = await WebAssembly.compile(await fs.readFile(rustcWasmPath));
	const memory = new WebAssembly.Memory({
		initial: MEMORY_INITIAL_PAGES,
		maximum: MEMORY_MAXIMUM_PAGES,
		shared: true
	});
	wasiInstance.wasiImport.random_get = createSharedSafeRandomGet(memory);
	const threadCounterBuffer = new SharedArrayBuffer(THREAD_COUNTER_BYTES);
	let instance;
	let nextThreadId = 1;
	const threadSpawner = useRealThreads
		? createRealThreadSpawner({
				rustcModule,
				rustcWasmPath,
				memory,
				args,
				env,
				wasmRustcRoot,
				toolchainRoot,
				targetTriple,
				patchTargetMetadata,
				sampleProgram,
				threadCounterBuffer
				,
				hostRootPath,
				workHostPath
			})
		: (startArg) => {
				const threadId = nextThreadId++;
				instance.exports.wasi_thread_start(threadId, startArg);
				return threadId;
			};
	instance = await WebAssembly.instantiate(rustcModule, {
		env: {
			memory,
			[RUSTC_STRING_GROW_BY_IMPORT]: () => {}
		},
		wasi: {
			'thread-spawn': threadSpawner
		},
		wasi_snapshot_preview1: wasiInstance.wasiImport
	});
	return instance;
}

async function runProbe({
	wasmRustcRoot,
	toolchainRoot,
	targetTriple,
	patchTargetMetadata,
	probeMode,
	extraArgs,
	commandArgs,
	teeStdio,
	useRealThreads
}) {
	const rustcWasmPath = path.join(wasmRustcRoot, 'bin', 'rustc.wasm');
	await ensureExists(rustcWasmPath);
	await ensureExists(path.join(toolchainRoot, 'lib', 'rustlib', targetTriple));
	let hostRootPath = null;
	let workHostPath = null;
	let result = null;
	try {
		const { sysrootDir, patchedMetadata } = USE_NODE_FS
			? { sysrootDir: null, patchedMetadata: null }
			: await buildSysrootDirectory(
					wasmRustcRoot,
					toolchainRoot,
					targetTriple,
					patchTargetMetadata
				);
		const workDir = USE_NODE_FS
			? null
			: new Directory(
					new Map([
						['main.rs', new File(new TextEncoder().encode(SAMPLE_PROGRAM))]
					])
				);
		const stdin = new OpenFile(new File(new Uint8Array(), { readonly: true }));
		const stdout = new CaptureFd(teeStdio ? process.stdout : null);
		const stderr = new CaptureFd(teeStdio ? process.stderr : null);
		const fds = USE_NODE_FS
			? await (async () => {
					hostRootPath = HOST_ROOT_PATH
						? path.resolve(HOST_ROOT_PATH)
						: await fs.mkdtemp(path.join(os.tmpdir(), 'wasm-rust-host-'));
					await fs.rm(hostRootPath, { recursive: true, force: true });
					await fs.mkdir(hostRootPath, { recursive: true });
					workHostPath = path.join(hostRootPath, 'work');
					await fs.mkdir(workHostPath);
					await fs.writeFile(path.join(workHostPath, 'main.rs'), SAMPLE_PROGRAM);
					await fs.symlink(toolchainRoot, path.join(hostRootPath, 'sysroot'));
					return [
						stdin,
						stdout,
						stderr,
						new NodePreopenDirectory('/tmp', os.tmpdir(), false),
						new NodePreopenDirectory('/sysroot', toolchainRoot, true),
						new NodePreopenDirectory('/', hostRootPath, false)
					];
				})()
			: (() => {
					const rootDir = new Directory(
						new Map([
							['sysroot', sysrootDir],
							['work', workDir]
						])
					);
					return [
						stdin,
						stdout,
						stderr,
						new PreopenDirectory('/tmp', []),
						new PreopenDirectory('/sysroot', Array.from(sysrootDir.contents.entries())),
						new PreopenDirectory('/', Array.from(rootDir.contents.entries()))
					];
				})();
		const args = commandArgs
			? ['rustc', ...commandArgs]
			: [
					'rustc',
					...(codegenBackend ? [`-Zcodegen-backend=${codegenBackend}`] : []),
					'/work/main.rs',
					'--sysroot',
					'/sysroot',
					'--target',
					targetTriple,
					'-Cpanic=abort',
					'-Ccodegen-units=1',
					...extraArgs
				];
		if (!commandArgs) {
			if (probeMode === 'link_attempt') {
				args.push('-Csave-temps');
			} else {
				args.push('--emit=obj', '-o', '/work/main.o');
			}
		}
		const wasiInstance = new WASI(args, [], fds, { debug: false });
		const instance = await instantiateRustc({
			rustcWasmPath,
			wasiInstance,
			wasmRustcRoot,
			toolchainRoot,
			targetTriple,
			patchTargetMetadata,
			sampleProgram: SAMPLE_PROGRAM,
			args,
			env: [],
			hostRootPath,
			workHostPath,
			useRealThreads
		});

		let exitCode = null;
		let thrown = null;
		try {
			exitCode = wasiInstance.start(instance);
		} catch (error) {
			thrown = {
				name: error?.name || 'Error',
				message: error?.message || String(error),
				stack: String(error?.stack || '')
					.split('\n')
					.slice(0, 8)
					.join('\n')
			};
		}

		const stderrText = stderr.getText();
		const workEntries =
			USE_NODE_FS && workHostPath
				? await fs.readdir(workHostPath)
				: Array.from(workDir.contents.keys());
		let classification = 'unknown';
		if (stderrText.includes('Support for this target has not been implemented yet')) {
			classification = 'target_not_supported';
		} else if (
			stderrText.includes('unsupported builtin codegen backend') ||
			stderrText.includes('failed to find a `codegen-backends` folder')
		) {
			classification = 'codegen_backend_missing';
		} else if (stderrText.includes("error[E0463]: can't find crate for `std`")) {
			classification = 'sysroot_missing';
		} else if (stderrText.includes('error[E0514]')) {
			classification = 'sysroot_version_mismatch';
		} else if (stderrText.includes('error[E0786]')) {
			classification = 'metadata_layout_mismatch';
		} else if (
			probeMode === 'link_attempt' &&
			!workEntries.includes('main.wasm') &&
			workEntries.some((entry) => entry.endsWith('.o'))
		) {
			classification = 'link_failed_with_objects';
		} else if (exitCode === 0 && commandArgs) {
			classification = 'success';
		} else if (exitCode === 0 && workEntries.includes('main.o')) {
			classification = 'success';
		} else if (exitCode === 0 && workEntries.includes('main.wasm')) {
			classification = 'success';
		}

		result = {
			classification,
			patchTargetMetadata,
			wasmRustcRoot,
			toolchainRoot,
			targetTriple,
			memoryInitialPages: MEMORY_INITIAL_PAGES,
			memoryMaximumPages: MEMORY_MAXIMUM_PAGES,
			probeMode,
			codegenBackend,
			rustcVersionExpectation: EXPECTED_WASM_RUSTC_VERSION,
			toolchainVersionExpectation: EXPECTED_TOOLCHAIN_VERSION,
			patchedArchives: patchedMetadata?.patchedArchives || [],
			exitCode,
			thrown,
			stdout: stdout.getText(),
			stderr: stderrText,
			workContents: workEntries,
			hostRootPath: USE_NODE_FS ? hostRootPath : null,
			workHostPath: USE_NODE_FS ? workHostPath : null
		};
		return result;
	} finally {
		if (USE_NODE_FS && hostRootPath && !KEEP_HOST_ROOT) {
			await fs.rm(hostRootPath, { recursive: true, force: true });
		}
	}
}

const patchTargetMetadata = process.argv.includes('--patch-target-metadata');
const wasmRustcRoot = process.env.WASM_RUST_RUSTC_ROOT || DEFAULT_WASM_RUSTC_ROOT;
const toolchainRoot = process.env.WASM_RUST_TOOLCHAIN_ROOT || DEFAULT_TOOLCHAIN_ROOT;
const targetTriple = process.env.WASM_RUST_TARGET_TRIPLE || DEFAULT_TARGET_TRIPLE;
const codegenBackend = process.env.WASM_RUST_CODEGEN_BACKEND || null;
const probeMode = process.env.WASM_RUST_PROBE_MODE || 'object';
const extraArgs = process.env.WASM_RUST_EXTRA_ARGS_JSON
	? JSON.parse(process.env.WASM_RUST_EXTRA_ARGS_JSON)
	: [];
const commandArgs = process.env.WASM_RUST_COMMAND_ARGS_JSON
	? JSON.parse(process.env.WASM_RUST_COMMAND_ARGS_JSON)
	: null;
const teeStdio = process.env.WASM_RUST_TEE_STDIO === '1';
const useRealThreads = process.env.WASM_RUST_REAL_THREADS === '1';

if (isMainThread) {
	runProbe({
		wasmRustcRoot,
		toolchainRoot,
		targetTriple,
		patchTargetMetadata,
		probeMode,
		extraArgs,
		commandArgs,
		teeStdio,
		useRealThreads
	})
		.then((result) => {
			console.log(JSON.stringify(result, null, 2));
		})
		.catch((error) => {
			console.error(
				JSON.stringify(
					{
						classification: 'probe_failure',
						message: error instanceof Error ? error.message : String(error)
					},
					null,
					2
				)
			);
			process.exitCode = 1;
		});
} else if (workerData?.kind === 'wasi-thread') {
	await runThreadWorkerEntry();
}
