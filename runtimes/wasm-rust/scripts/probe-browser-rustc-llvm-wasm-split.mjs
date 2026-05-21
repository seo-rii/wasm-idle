import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultWasmRustcRoot =
	process.env.WASM_RUST_RUSTC_ROOT ||
	path.join(os.homedir(), '.cache', 'wasm-rust-real-rustc-20260317', 'rust', 'dist-emit-ir');
const defaultToolchainRoot = process.env.WASM_RUST_TOOLCHAIN_ROOT || defaultWasmRustcRoot;
const matchingNativeToolchainRoot =
	process.env.WASM_RUST_MATCHING_NATIVE_TOOLCHAIN_ROOT ||
	path.join(
		os.homedir(),
		'.cache',
		'wasm-rust-real-rustc-20260317',
		'rust',
		'build',
		'x86_64-unknown-linux-gnu',
		'stage2'
	);
const llvmWasmRoot =
	process.env.WASM_RUST_LLVM_WASM_ROOT || path.join(os.homedir(), '.cache', 'llvm-wasm-20260319');
const targetTriple = process.env.WASM_RUST_TARGET_TRIPLE || 'wasm32-wasip1';
const sampleProgram = process.env.WASM_RUST_SAMPLE_PROGRAM || 'fn main() { println!("hi"); }';
const browserProbeTimeoutMs = Number(process.env.WASM_RUST_BROWSER_PROBE_TIMEOUT_MS || '180000');
const browserProbeAttempts = Number(process.env.WASM_RUST_BROWSER_PROBE_ATTEMPTS || '3');
const memoryInitialPages = process.env.WASM_RUST_MEMORY_INITIAL_PAGES || '8192';
const memoryMaximumPages = process.env.WASM_RUST_MEMORY_MAXIMUM_PAGES || '16384';
const rustcPath = path.join(matchingNativeToolchainRoot, 'bin', 'rustc');

function makeError(message, extra = {}) {
	return Object.assign(new Error(message), extra);
}

async function runBrowserRustcProbe(tempRoot) {
	const commandArgs = [
		'-Zthreads=1',
		'-Zcodegen-backend=llvm',
		'/work/main.rs',
		'--sysroot',
		'/sysroot',
		'--target',
		targetTriple,
		'-Cpanic=abort',
		'-Ccodegen-units=1',
		'-Cno-prepopulate-passes',
		'-Csave-temps',
		'--emit=obj',
		'-o',
		'/work/main.o'
	];
	const attempts = [];

	for (let attempt = 1; attempt <= browserProbeAttempts; attempt += 1) {
		const hostRootPath = path.join(tempRoot, `browser-host-attempt-${attempt}`);
		let browserProbe = null;
		let timedOut = false;
		let processStatus = 'completed';

		try {
			const { stdout, stderr } = await execFileAsync('node', ['./scripts/probe-rustc-wasm.mjs'], {
				cwd: projectRoot,
				timeout: browserProbeTimeoutMs,
				env: {
					...process.env,
					WASM_RUST_NODE_FS: '1',
					WASM_RUST_REAL_THREADS: '1',
					WASM_RUST_KEEP_HOST_ROOT: '1',
					WASM_RUST_HOST_ROOT_PATH: hostRootPath,
					WASM_RUST_MEMORY_INITIAL_PAGES: memoryInitialPages,
					WASM_RUST_MEMORY_MAXIMUM_PAGES: memoryMaximumPages,
					WASM_RUST_RUSTC_ROOT: defaultWasmRustcRoot,
					WASM_RUST_TOOLCHAIN_ROOT: defaultToolchainRoot,
					WASM_RUST_COMMAND_ARGS_JSON: JSON.stringify(commandArgs)
				},
				maxBuffer: 64 * 1024 * 1024
			});
			browserProbe = {
				stdout,
				stderr,
				json: stdout.trim() ? JSON.parse(stdout) : null
			};
		} catch (error) {
			const stdout = error.stdout || '';
			const stderr = error.stderr || '';
			const parseCandidate = stdout.trim() || stderr.trim();
			let parsedJson = null;
			if (parseCandidate) {
				try {
					parsedJson = JSON.parse(parseCandidate);
				} catch {}
			}
			if (error.killed || error.signal === 'SIGTERM') {
				timedOut = true;
				processStatus = 'timed_out';
			} else {
				processStatus = 'error_exit';
			}
			browserProbe = {
				stdout,
				stderr,
				json: parsedJson
			};
		}

		const workHostPath = path.join(hostRootPath, 'work');
		let workContents = [];
		try {
			workContents = await fs.readdir(workHostPath);
		} catch {
			attempts.push({
				attempt,
				hostRootPath,
				processStatus,
				timedOut,
				workContents: [],
				stderr:
					browserProbe?.json?.stderr ||
					browserProbe?.stderr ||
					''
			});
			continue;
		}

		const bitcodeName = workContents.find((entry) => entry.endsWith('.no-opt.bc'));
		if (bitcodeName) {
			return {
				hostRootPath,
				workHostPath,
				workContents,
				bitcodePath: path.join(workHostPath, bitcodeName),
				threadLogs: workContents
					.filter((entry) => entry.startsWith('.thread-') && entry.endsWith('.log'))
					.map((entry) => path.join(workHostPath, entry)),
				timedOut,
				attempt,
				attempts,
				browserProbe
			};
		}

		attempts.push({
			attempt,
			hostRootPath,
			processStatus,
			timedOut,
			workContents,
			stderr:
				browserProbe?.json?.stderr ||
				browserProbe?.stderr ||
				''
		});
	}

	const lastAttempt = attempts[attempts.length - 1] || null;
	if (!lastAttempt?.workContents?.length) {
		throw makeError('browser rustc probe did not materialize a host work directory', {
			hostRootPath: lastAttempt?.hostRootPath || null,
			attempts
		});
	}

	throw makeError('browser rustc probe did not leave a .no-opt.bc artifact', {
		hostRootPath: lastAttempt.hostRootPath,
		workContents: lastAttempt.workContents,
		timedOut: lastAttempt.timedOut,
		stderr: lastAttempt.stderr,
		attempts
	});
}

async function buildNativeLinkInputs(tempRoot) {
	const sourcePath = path.join(tempRoot, 'main.rs');
	const wrapperPath = path.join(tempRoot, 'rust-lld-wrapper.sh');
	const linkArgsPath = path.join(tempRoot, 'rust-lld-link-args.txt');
	const nativeWasmPath = path.join(tempRoot, 'native-main.wasm');

	await fs.writeFile(sourcePath, sampleProgram);
	await fs.writeFile(
		wrapperPath,
		[
			'#!/usr/bin/env bash',
			`printf '%s\\n' \"$@\" > ${JSON.stringify(linkArgsPath)}`,
			'exit 1'
		].join('\n'),
		{ mode: 0o755 }
	);

	try {
		execFileSync(
			rustcPath,
			[
				'--sysroot',
				matchingNativeToolchainRoot,
				'--target',
				targetTriple,
				'-Clinker=' + wrapperPath,
				'-Cpanic=abort',
				'-Ccodegen-units=1',
				'-Csave-temps',
				sourcePath,
				'-o',
				nativeWasmPath
			]
		);
	} catch (error) {
		try {
			await fs.access(linkArgsPath);
		} catch {
			throw error;
		}
	}

	const tempEntries = await fs.readdir(tempRoot);
	const allocatorObjectName = tempEntries.find(
		(entry) => entry.endsWith('.rcgu.o') && !entry.includes('-cgu.0.')
	);
	if (!allocatorObjectName) {
		throw makeError(`failed to locate allocator shim object in ${tempRoot}`, {
			tempEntries
		});
	}

	return {
		allocatorObjectPath: path.join(tempRoot, allocatorObjectName),
		nativeLinkArgs: (await fs.readFile(linkArgsPath, 'utf8'))
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
	};
}

async function linkWithLlvmWasm({
	tempRoot,
	browserMainObject,
	allocatorObjectPath,
	nativeLinkArgs
}) {
	const { default: Lld } = await import(`file://${llvmWasmRoot}/lld.js`);
	const lldData = readFileSync(path.join(llvmWasmRoot, 'lld.data'));
	const lld = await Lld({
		getPreloadedPackage() {
			return lldData.buffer.slice(lldData.byteOffset, lldData.byteOffset + lldData.byteLength);
		}
	});

	const mkdirp = (targetPath) => {
		const segments = targetPath.replace(/^\/+/, '').split('/').filter(Boolean);
		let current = '';
		for (const segment of segments) {
			current += '/' + segment;
			try {
				lld.FS.mkdir(current);
			} catch {}
		}
	};
	const addFile = async (targetPath, sourcePath, contents = null) => {
		mkdirp(path.posix.dirname(targetPath));
		lld.FS.writeFile(targetPath, contents ?? (await fs.readFile(sourcePath)));
	};

	await addFile('/work/main.o', null, browserMainObject);
	await addFile('/work/alloc.o', allocatorObjectPath);

	const rustLibDir = path.join(matchingNativeToolchainRoot, 'lib', 'rustlib', targetTriple, 'lib');
	const mainObjectArg = nativeLinkArgs.find((arg) => arg.endsWith('-cgu.0.rcgu.o'));
	const fileMap = new Map([
		[mainObjectArg, '/work/main.o'],
		[allocatorObjectPath, '/work/alloc.o'],
		[rustLibDir, '/rustlib'],
		[path.join(rustLibDir, 'self-contained'), '/rustlib/self-contained']
	]);

	for (const arg of nativeLinkArgs) {
		if (!path.isAbsolute(arg) || (!arg.endsWith('.rlib') && !arg.endsWith('.o'))) {
			continue;
		}
		const mappedPath = arg.startsWith(rustLibDir)
			? '/rustlib/' + path.relative(rustLibDir, arg).replaceAll(path.sep, '/')
			: fileMap.get(arg);
		if (!mappedPath) {
			continue;
		}
		fileMap.set(arg, mappedPath);
		if (mappedPath !== '/work/main.o' && mappedPath !== '/work/alloc.o') {
			await addFile(mappedPath, arg);
		}
	}

	const translatedLinkArgs = nativeLinkArgs.map((arg) => {
		if (fileMap.has(arg)) {
			return fileMap.get(arg);
		}
		if (arg.startsWith('-L') && fileMap.has(arg.slice(2))) {
			return '-L' + fileMap.get(arg.slice(2));
		}
		return arg;
	});
	while (translatedLinkArgs[0] && !translatedLinkArgs[0].startsWith('-')) {
		translatedLinkArgs.shift();
	}
	const libcIndex = translatedLinkArgs.findIndex((arg) => arg === 'c');
	if (libcIndex >= 0 && translatedLinkArgs[libcIndex - 1] === '-l') {
		translatedLinkArgs.splice(
			libcIndex - 1,
			0,
			'-L',
			'/lib/wasm32-wasi',
			'/lib/clang/16.0.4/lib/wasi/libclang_rt.builtins-wasm32.a'
		);
	}
	const outputIndex = translatedLinkArgs.findIndex((arg) => arg === '-o');
	if (outputIndex === -1 || outputIndex + 1 >= translatedLinkArgs.length) {
		throw makeError('translated link args are missing -o', { translatedLinkArgs });
	}
	translatedLinkArgs[outputIndex + 1] = '/work/main.wasm';

	const stableLinkArgs = [...translatedLinkArgs];
	await lld.callMain(stableLinkArgs);
	const linkedWasm = lld.FS.readFile('/work/main.wasm');
	const wasmPath = path.join(tempRoot, 'main.browser.wasm');
	await fs.writeFile(wasmPath, linkedWasm);

	return {
		linkedWasm,
		wasmPath,
		translatedLinkArgs: stableLinkArgs
	};
}

async function main() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wasm-rust-browser-rustc-split-'));
	try {
		const browserCompile = await runBrowserRustcProbe(tempRoot);
		const { allocatorObjectPath, nativeLinkArgs } = await buildNativeLinkInputs(tempRoot);

		const { default: Llc } = await import(`file://${llvmWasmRoot}/llc.js`);
		const llc = await Llc();
		llc.FS.writeFile('main.bc', await fs.readFile(browserCompile.bitcodePath));
		await llc.callMain(['-filetype=obj', 'main.bc']);
		const browserMainObject = llc.FS.readFile('main.o');
		const browserMainObjectPath = path.join(tempRoot, 'browser-main.o');
		await fs.writeFile(browserMainObjectPath, browserMainObject);

		const { linkedWasm, wasmPath, translatedLinkArgs } = await linkWithLlvmWasm({
			tempRoot,
			browserMainObject,
			allocatorObjectPath,
			nativeLinkArgs
		});
		const module = await WebAssembly.compile(linkedWasm);
		const imports = WebAssembly.Module.imports(module);
		const { stdout, stderr } = await execFileAsync(
			'node',
			[
				'--input-type=module',
				'-e',
				[
					"import fs from 'node:fs/promises';",
					"import { WASI } from 'node:wasi';",
					'const wasmPath = process.argv[1];',
					'const bytes = await fs.readFile(wasmPath);',
					"const wasi = new WASI({ version: 'preview1', args: [wasmPath], env: {}, preopens: {} });",
					'const module = await WebAssembly.compile(bytes);',
					'const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });',
					'wasi.start(instance);'
				].join('\n'),
				wasmPath
			],
			{ maxBuffer: 16 * 1024 * 1024 }
		);

		console.log(
			JSON.stringify(
				{
					success: true,
					tempRoot,
					llvmWasmRoot,
					wasmRustcRoot: defaultWasmRustcRoot,
					toolchainRoot: defaultToolchainRoot,
					matchingNativeToolchainRoot,
					browserProbeTimedOut: browserCompile.timedOut,
					browserProbeExit: browserCompile.browserProbe?.json?.exitCode ?? null,
					browserProbeClassification:
						browserCompile.browserProbe?.json?.classification ?? 'timeout_with_artifacts',
					browserWorkContents: browserCompile.workContents,
					bitcodePath: browserCompile.bitcodePath,
					threadLogs: browserCompile.threadLogs,
					wasmBytes: linkedWasm.length,
					stdout,
					stderr,
					imports,
					linkArgs: translatedLinkArgs
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
					tempRoot,
					message: error?.message || String(error),
					hostRootPath: error?.hostRootPath || null,
					workContents: error?.workContents || null,
					stderr: error?.stderr || null,
					stack: String(error?.stack || '')
						.split('\n')
						.slice(0, 12)
						.join('\n')
				},
				null,
				2
			)
		);
		process.exitCode = 1;
	}
}

await main();
