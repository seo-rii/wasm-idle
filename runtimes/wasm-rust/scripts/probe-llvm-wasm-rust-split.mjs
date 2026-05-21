import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const rustToolchainRoot =
	process.env.WASM_RUST_NATIVE_TOOLCHAIN_ROOT ||
	path.join(os.homedir(), '.rustup', 'toolchains', 'nightly-2024-04-12-x86_64-unknown-linux-gnu');
const rustcPath = path.join(rustToolchainRoot, 'bin', 'rustc');
const rustLldPath = path.join(
	rustToolchainRoot,
	'lib',
	'rustlib',
	'x86_64-unknown-linux-gnu',
	'bin',
	'rust-lld'
);
const rustTargetTriple = process.env.WASM_RUST_NATIVE_TARGET_TRIPLE || 'wasm32-wasip1';
const sampleProgram = process.env.WASM_RUST_SAMPLE_PROGRAM || 'fn main() { println!("hi"); }';
const llvmWasmRoot =
	process.env.WASM_RUST_LLVM_WASM_ROOT || path.join(os.homedir(), '.cache', 'llvm-wasm-20260319');

async function main() {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wasm-rust-llvm-wasm-'));
	try {
		const sourcePath = path.join(tempRoot, 'main.rs');
		const llvmIrPath = path.join(tempRoot, 'main.ll');
		const linkArgsPath = path.join(tempRoot, 'rust-lld-link-args.txt');
		const wrapperPath = path.join(tempRoot, 'rust-lld-wrapper.sh');
		const runnerPath = path.join(tempRoot, 'run-wasi.mjs');
		await fs.writeFile(sourcePath, sampleProgram);
		await fs.writeFile(
			wrapperPath,
			[
				'#!/usr/bin/env bash',
				`printf '%s\\n' "$@" > ${JSON.stringify(linkArgsPath)}`,
				`exec ${JSON.stringify(rustLldPath)} "$@"`
			].join('\n'),
			{ mode: 0o755 }
		);

		execFileSync(
			rustcPath,
			[
				'--target',
				rustTargetTriple,
				'-Clinker=' + wrapperPath,
				'-Cpanic=abort',
				'-Ccodegen-units=1',
				'-Csave-temps',
				sourcePath,
				'-o',
				path.join(tempRoot, 'native-main.wasm')
			],
			{ stdio: 'inherit' }
		);
		execFileSync(
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
			{ stdio: 'inherit' }
		);

		const entries = await fs.readdir(tempRoot);
		const mainTempObjectName = entries.find((entry) => entry.endsWith('-cgu.0.rcgu.o'));
		const allocatorObjectName = entries.find(
			(entry) => entry.endsWith('.rcgu.o') && !entry.includes('-cgu.0.')
		);
		if (!mainTempObjectName || !allocatorObjectName) {
			throw new Error(
				`Failed to locate rustc temp objects in ${tempRoot}: ${entries.join(', ')}`
			);
		}
		const mainTempObjectPath = path.join(tempRoot, mainTempObjectName);
		const allocatorObjectPath = path.join(tempRoot, allocatorObjectName);
		const nativeLinkArgs = (await fs.readFile(linkArgsPath, 'utf8'))
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);

		const { default: Llc } = await import(`file://${llvmWasmRoot}/llc.js`);
		const { default: Lld } = await import(`file://${llvmWasmRoot}/lld.js`);

		const llc = await Llc();
		llc.FS.writeFile('main.ll', await fs.readFile(llvmIrPath));
		await llc.callMain(['-filetype=obj', 'main.ll']);
		const browserMainObject = llc.FS.readFile('main.o');

		const lldData = readFileSync(path.join(llvmWasmRoot, 'lld.data'));
		const lld = await Lld({
			getPreloadedPackage() {
				return lldData.buffer.slice(
					lldData.byteOffset,
					lldData.byteOffset + lldData.byteLength
				);
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

		const rustLibDir = path.join(rustToolchainRoot, 'lib', 'rustlib', rustTargetTriple, 'lib');
		const fileMap = new Map([
			[mainTempObjectPath, '/work/main.o'],
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
		if (translatedLinkArgs[0] && !translatedLinkArgs[0].startsWith('-')) {
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
			throw new Error(`Missing -o in translated link args: ${JSON.stringify(translatedLinkArgs)}`);
		}
		translatedLinkArgs[outputIndex + 1] = '/work/main.wasm';

		await lld.callMain([...translatedLinkArgs]);
		const linkedWasm = lld.FS.readFile('/work/main.wasm');
		const wasmPath = path.join(tempRoot, 'main.browser.wasm');
		await fs.writeFile(wasmPath, linkedWasm);

		await fs.writeFile(
			runnerPath,
			[
				"import fs from 'node:fs/promises';",
				"import { WASI } from 'node:wasi';",
				'const wasmPath = process.argv[2];',
				'const bytes = await fs.readFile(wasmPath);',
				"const wasi = new WASI({ version: 'preview1', args: [wasmPath], env: {}, preopens: {} });",
				'const module = await WebAssembly.compile(bytes);',
				'const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });',
				'wasi.start(instance);'
			].join('\n')
		);
		const runtime = await execFileAsync('node', [runnerPath, wasmPath]);

		console.log(
			JSON.stringify(
				{
					success: true,
					tempRoot,
					llvmWasmRoot,
					wasmBytes: linkedWasm.length,
					stdout: runtime.stdout,
					stderr: runtime.stderr,
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
					message: error?.message || String(error),
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
