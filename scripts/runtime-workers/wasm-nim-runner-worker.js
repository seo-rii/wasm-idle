const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function assetUrl(baseUrl, path) {
	return new URL(path, baseUrl).href;
}

async function fetchRuntimeBytes(baseUrl, path, options) {
	const runtimeUrl = assetUrl(baseUrl, path);
	const response = await fetch(runtimeUrl, options).catch(() => null);
	if (response?.ok) return response.arrayBuffer();

	const compressedResponse = await fetch(assetUrl(baseUrl, `${path}.gz`), options).catch(
		() => null
	);
	if (!compressedResponse?.ok || !compressedResponse.body) {
		throw new Error(`Nim runtime asset was not found: ${runtimeUrl}`);
	}
	const contentEncoding = (compressedResponse.headers.get('content-encoding') || '')
		.toLowerCase()
		.split(',')
		.map((value) => value.trim());
	if (contentEncoding.includes('gzip')) return compressedResponse.arrayBuffer();
	if (typeof DecompressionStream !== 'function') {
		throw new Error('Nim runtime asset is gzip-compressed, but DecompressionStream is unavailable.');
	}
	const decompressed = compressedResponse.body.pipeThrough(new DecompressionStream('gzip'));
	return new Response(decompressed).arrayBuffer();
}

async function fetchRuntimeText(baseUrl, path) {
	return textDecoder.decode(await fetchRuntimeBytes(baseUrl, path));
}

function postProgress(percent) {
	self.postMessage({ progress: { percent } });
}

function splitLines(text) {
	return String(text || '')
		.replace(/\x1b\[[0-9;]*m/g, '')
		.split('\n')
		.map((line) => line.trimEnd())
		.filter(Boolean);
}

function installNimCompiler(baseUrl, stdout, stderr) {
	return new Promise(async (resolve, reject) => {
		const wasmBinary = await fetchRuntimeBytes(baseUrl, 'nim/nim.wasm').catch(reject);
		if (!wasmBinary) return;
		const module = {
			noInitialRun: true,
			wasmBinary,
			locateFile(path) {
				const value = String(path);
				if (value.endsWith('.wasm')) return assetUrl(baseUrl, 'nim/nim.wasm');
				return assetUrl(baseUrl, `nim/${value}`);
			},
			print: (text) => stdout.push(String(text)),
			printErr: (text) => stderr.push(String(text)),
			onRuntimeInitialized: () => resolve()
		};
		self.Nim = module;
		self.Module = module;
		try {
			const bundleSource = await fetchRuntimeText(baseUrl, 'nim/nim-bundle.js');
			(0, eval)(`${bundleSource}\n//# sourceURL=${assetUrl(baseUrl, 'nim/nim-bundle.js')}`);
		} catch (error) {
			reject(error);
		}
	});
}

async function loadNimCompiler(baseUrl, stdout, stderr) {
	await installNimCompiler(baseUrl, stdout, stderr);
	const started = Date.now();
	while (typeof self.FS === 'undefined' || typeof self.callMain !== 'function') {
		if (Date.now() - started > 30000) throw new Error('Nim compiler did not initialize.');
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return { FS: self.FS, callMain: self.callMain };
}

function withCapturedConsole(stdout, stderr, callback) {
	const originalLog = console.log;
	const originalError = console.error;
	const originalPrint = self.print;
	const originalPrintErr = self.printErr;
	console.log = (...args) => stdout.push(args.map(String).join(' '));
	console.error = (...args) => stderr.push(args.map(String).join(' '));
	self.print = (text) => stdout.push(String(text));
	self.printErr = (text) => stderr.push(String(text));
	try {
		return callback();
	} finally {
		console.log = originalLog;
		console.error = originalError;
		self.print = originalPrint;
		self.printErr = originalPrintErr;
	}
}

function compileNimToC({ FS, callMain }, code, stdout, stderr) {
	self.__NIM_USER_CODE__ = code;
	self.__NIM_USER_CODE_PENDING__ = code;
	self.__NIM_USER_PATH__ = '/tmp/user.nim';
	self.__NIM_USER_CODE_WRITTEN__ = false;

	let returnCode = 0;
	try {
		returnCode = withCapturedConsole(stdout, stderr, () =>
			callMain([
				'c',
				'--hints:off',
				'-d:release',
				'-d:useMalloc',
				'--path:/lib/pure',
				'--path:/lib/pure/collections',
				'--path:/lib/core',
				'-o:/tmp/user',
				'/tmp/user.nim'
			])
		);
	} catch (error) {
		stderr.push(`[nim] callMain failed: ${error?.message || error}`);
		returnCode = -1;
	}

	const cacheDir = '/home/web_user/.cache/nim/user_r';
	let entries;
	try {
		entries = FS.readdir(cacheDir);
	} catch (error) {
		throw new Error(
			`Nim did not emit C files.${returnCode ? ` Exit code: ${returnCode}.` : ''}\n${stderr.join(
				'\n'
			)}`
		);
	}

	const cFiles = entries.filter((file) => file.endsWith('.nim.c') || file.endsWith('.nim.cpp')).sort();
	if (cFiles.length === 0) {
		throw new Error(
			`Nim did not emit C files.${returnCode ? ` Exit code: ${returnCode}.` : ''}\n${stderr.join(
				'\n'
			)}`
		);
	}

	return { cacheDir, cFiles };
}

function prepareTranslationUnit(source, nimbaseContent) {
	const cleaned = source
		.split('\n')
		.filter((line) => !/^#include\s+["<](?:\/lib\/)?nimbase\.h[">]\s*$/.test(line))
		.filter((line) => !/^#include\s+<errno\.h>\s*$/.test(line))
		.filter((line) => !/^#define NIM_INTBITS/.test(line))
		.filter((line) => !/^#define NIM_EmulateOverflowChecks/.test(line))
		.filter(
			(line) =>
				!/^#undef (LANGUAGE_C|MIPSEB|MIPSEL|PPC|R3000|R4000|i386|linux|mips|near|far|powerpc|unix)\s*$/.test(
					line
				)
		)
		.join('\n')
		.replace(
			/int main\(int (\w+), char\*\* (\w+), char\*\* (\w+)\) \{/,
			'int main(int $1, char** $2) {\n\tchar** $3 = (char**)0;'
		);
	const header = `/* Combined Nim/WASI header. */
#define NIM_INTBITS 32
#define NIM_EmulateOverflowChecks
#include <signal.h>
#include <string.h>
typedef void (*__sighandler_t)(int);
#ifndef SIG_IGN
#define SIG_IGN ((__sighandler_t)1)
#endif
#ifndef SIG_DFL
#define SIG_DFL ((__sighandler_t)0)
#endif
#ifndef SIG_ERR
#define SIG_ERR ((__sighandler_t)-1)
#endif
static __sighandler_t signal(int sig, __sighandler_t handler) { (void)sig; (void)handler; return SIG_DFL; }
__attribute__((weak)) int raise(int sig) { (void)sig; return 0; }
typedef long int __jmp_buf[8];
typedef struct { __jmp_buf __jmpbuf; int __mask_was_saved; } __jmp_buf_tag;
typedef __jmp_buf_tag jmp_buf[1];
extern int setjmp(jmp_buf __env) __attribute__((__nothrow__));
_Noreturn void longjmp(jmp_buf __env, int __val) __attribute__((__nothrow__));
${nimbaseContent}
#include <errno.h>
#undef errno
static int wasm_idle_errno;
#define errno wasm_idle_errno
`;
	return `${header}\n${cleaned}\n`;
}

async function buildWasm({ baseUrl, code, stdout, stderr }) {
	postProgress(5);
	const nim = await loadNimCompiler(baseUrl, stdout, stderr);
	postProgress(20);
	const { cacheDir, cFiles } = compileNimToC(nim, code, stdout, stderr);
	const nimbaseContent = await fetchRuntimeText(baseUrl, 'nim/nimbase.h');
	const files = cFiles.map((file, index) => ({
		input: `w${index}.c`,
		code: prepareTranslationUnit(
			nim.FS.readFile(`${cacheDir}/${file}`, { encoding: 'utf8' }),
			nimbaseContent
		)
	}));
	postProgress(35);
	const clangModule = await import(assetUrl(baseUrl, 'clang/clang.js'));
	const clangLogs = [];
	const originalLog = console.log;
	try {
		console.log = (...args) => clangLogs.push(args.map(String).join(' '));
		await clangModule.init({ path: assetUrl(baseUrl, 'clang').replace(/\/$/, '') });
		postProgress(50);
		const result = await clangModule.compileEachLink(files, 'app.wasm');
		if (result && result.ok === false && result.error) {
			throw new Error(result.error);
		}
	} catch (error) {
		const logText = clangLogs.flatMap(splitLines).slice(-40).join('\n');
		throw new Error(`Nim clang/lld build failed: ${error?.message || error}${logText ? `\n${logText}` : ''}`);
	} finally {
		console.log = originalLog;
	}
	postProgress(75);
	const output = await clangModule.getFile('app.wasm');
	if (!output?.ok || !output.bytes) {
		throw new Error(output?.error || 'Nim build did not produce app.wasm.');
	}
	return output.bytes;
}

class ProcExit extends Error {
	constructor(code) {
		super(`exit ${code}`);
		this.code = code;
	}
}

function createWasiRunner({ stdin = '', args = [], activePath = 'main.nim' }) {
	let memory = null;
	const stdinBytes = textEncoder.encode(stdin);
	let stdinOffset = 0;
	const stdout = [];
	const stderr = [];
	const u8 = () => new Uint8Array(memory.buffer);
	const dv = () => new DataView(memory.buffer);
	const errnoSuccess = 0;
	const errnoBadf = 8;

	function writeIovs(fd, iovsPtr, iovsLen, writtenPtr) {
		const view = dv();
		let total = 0;
		for (let index = 0; index < iovsLen; index += 1) {
			const ptr = view.getUint32(iovsPtr + index * 8, true);
			const length = view.getUint32(iovsPtr + index * 8 + 4, true);
			if (length > 0) {
				const chunk = u8().slice(ptr, ptr + length);
				(fd === 2 ? stderr : stdout).push(chunk);
				total += length;
			}
		}
		view.setUint32(writtenPtr, total, true);
		return errnoSuccess;
	}

	function readIovs(fd, iovsPtr, iovsLen, readPtr) {
		if (fd !== 0) return errnoBadf;
		const view = dv();
		let total = 0;
		for (let index = 0; index < iovsLen; index += 1) {
			const ptr = view.getUint32(iovsPtr + index * 8, true);
			const length = view.getUint32(iovsPtr + index * 8 + 4, true);
			const available = Math.min(length, stdinBytes.length - stdinOffset);
			if (available <= 0) break;
			u8().set(stdinBytes.subarray(stdinOffset, stdinOffset + available), ptr);
			stdinOffset += available;
			total += available;
			if (available !== length) break;
		}
		view.setUint32(readPtr, total, true);
		return errnoSuccess;
	}

	function writeStringTable(values, countPtr, sizePtr) {
		const encodedValues = values.map((value) => textEncoder.encode(`${value}\0`));
		const totalSize = encodedValues.reduce((total, value) => total + value.length, 0);
		const view = dv();
		view.setUint32(countPtr, encodedValues.length, true);
		view.setUint32(sizePtr, totalSize, true);
		return encodedValues;
	}

	function writeStringPointers(values, argvPtr, bufferPtr) {
		const encodedValues = values.map((value) => textEncoder.encode(`${value}\0`));
		const view = dv();
		let cursor = bufferPtr;
		for (let index = 0; index < encodedValues.length; index += 1) {
			view.setUint32(argvPtr + index * 4, cursor, true);
			u8().set(encodedValues[index], cursor);
			cursor += encodedValues[index].length;
		}
		return errnoSuccess;
	}

	const argv = [activePath, ...args];
	const env = [];
	const importsImpl = {
		proc_exit(code) {
			throw new ProcExit(code);
		},
		fd_write(fd, iovsPtr, iovsLen, writtenPtr) {
			return writeIovs(fd, iovsPtr, iovsLen, writtenPtr);
		},
		fd_read(fd, iovsPtr, iovsLen, readPtr) {
			return readIovs(fd, iovsPtr, iovsLen, readPtr);
		},
		fd_close() {
			return errnoSuccess;
		},
		fd_seek(_fd, _low, _high, _whence, newOffsetPtr) {
			if (typeof newOffsetPtr === 'number') {
				dv().setUint32(newOffsetPtr, 0, true);
				dv().setUint32(newOffsetPtr + 4, 0, true);
			}
			return errnoSuccess;
		},
		fd_fdstat_get(_fd, bufferPtr) {
			const view = dv();
			view.setUint8(bufferPtr, 2);
			view.setUint16(bufferPtr + 2, 0, true);
			view.setBigUint64(bufferPtr + 8, 0xffffffffffffffffn, true);
			view.setBigUint64(bufferPtr + 16, 0xffffffffffffffffn, true);
			return errnoSuccess;
		},
		fd_prestat_get() {
			return errnoBadf;
		},
		fd_prestat_dir_name() {
			return errnoBadf;
		},
		args_sizes_get(countPtr, sizePtr) {
			writeStringTable(argv, countPtr, sizePtr);
			return errnoSuccess;
		},
		args_get(argvPtr, bufferPtr) {
			return writeStringPointers(argv, argvPtr, bufferPtr);
		},
		environ_sizes_get(countPtr, sizePtr) {
			writeStringTable(env, countPtr, sizePtr);
			return errnoSuccess;
		},
		environ_get(argvPtr, bufferPtr) {
			return writeStringPointers(env, argvPtr, bufferPtr);
		},
		clock_time_get(_id, _precision, timePtr) {
			dv().setBigUint64(timePtr, BigInt(Date.now()) * 1000000n, true);
			return errnoSuccess;
		},
		clock_res_get(_id, resolutionPtr) {
			dv().setBigUint64(resolutionPtr, 1000000n, true);
			return errnoSuccess;
		},
		random_get(bufferPtr, length) {
			const target = u8().subarray(bufferPtr, bufferPtr + length);
			if (globalThis.crypto?.getRandomValues) {
				for (let offset = 0; offset < length; offset += 65536) {
					crypto.getRandomValues(target.subarray(offset, Math.min(offset + 65536, length)));
				}
			} else {
				for (let index = 0; index < length; index += 1) target[index] = Math.random() * 256;
			}
			return errnoSuccess;
		},
		poll_oneoff(_input, _output, _count, eventsPtr) {
			dv().setUint32(eventsPtr, 0, true);
			return errnoSuccess;
		},
		sched_yield() {
			return errnoSuccess;
		}
	};

	function importsFor(module) {
		const imports = {};
		for (const { module: moduleName, name, kind } of WebAssembly.Module.imports(module)) {
			imports[moduleName] = imports[moduleName] || {};
			if (kind === 'function') imports[moduleName][name] = importsImpl[name] || (() => errnoSuccess);
		}
		return imports;
	}

	function join(chunks) {
		const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
		const all = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			all.set(chunk, offset);
			offset += chunk.length;
		}
		return textDecoder.decode(all);
	}

	async function run(bytes) {
		const module = await WebAssembly.compile(bytes);
		const instance = await WebAssembly.instantiate(module, importsFor(module));
		memory = instance.exports.memory;
		let code = 0;
		try {
			instance.exports._start();
		} catch (error) {
			if (error instanceof ProcExit) {
				code = error.code;
			} else {
				throw error;
			}
		}
		return { code, stdout: join(stdout), stderr: join(stderr) };
	}

	return { run };
}

self.onmessage = async (event) => {
	const { baseUrl, code, stdin, args, activePath, log } = event.data || {};
	const compilerStdout = [];
	const compilerStderr = [];
	try {
		if (log) console.log(`[wasm-idle:nim-worker] run start baseUrl=${baseUrl}`);
		const wasmBytes = await buildWasm({
			baseUrl,
			code: code || '',
			stdout: compilerStdout,
			stderr: compilerStderr
		});
		postProgress(85);
		const result = await createWasiRunner({
			stdin: stdin || '',
			args: Array.isArray(args) ? args : [],
			activePath: activePath || 'main.nim'
		}).run(wasmBytes);
		if (result.stdout) self.postMessage({ output: result.stdout });
		if (result.stderr) self.postMessage({ output: result.stderr });
		if (result.code !== 0) {
			throw new Error(`Nim program exited with status ${result.code}.`);
		}
		postProgress(100);
		if (log) console.log('[wasm-idle:nim-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		const compilerOutput = [...compilerStderr.flatMap(splitLines), ...compilerStdout.flatMap(splitLines)]
			.slice(-60)
			.join('\n');
		const message = `${error?.message || error}${compilerOutput ? `\n${compilerOutput}` : ''}`;
		if (log) console.error('[wasm-idle:nim-worker] failed', error);
		self.postMessage({ error: message });
	}
};
