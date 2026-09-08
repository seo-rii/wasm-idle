// The local sync step includes c3-memory.mjs and binds this worker to one producer receipt.
const c3Profile = __WASM_IDLE_C3_PROFILE__;
let c3Consumed = false;

function c3Stdin(source, channel) {
	const input = new TextEncoder().encode(source || '');
	let offset = 0;
	if (!channel) return () => (offset < input.length ? input[offset++] : -1);
	if (
		channel.protocol !== 'wasm-idle-static-stdin-ring' ||
		channel.protocolVersion !== 1 ||
		channel.controlBytes !== 16 ||
		!Number.isSafeInteger(channel.capacity) ||
		channel.capacity <= 0 ||
		typeof SharedArrayBuffer !== 'function' ||
		!(channel.buffer instanceof SharedArrayBuffer) ||
		channel.buffer.byteLength !== 16 + channel.capacity
	)
		throw new Error('Invalid C3 stdin ring');
	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, 16, channel.capacity);
	return () => {
		while (true) {
			if (Atomics.load(control, 3)) throw new Error('C3 stdin cancelled');
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const count = write - read;
			if (count < 0 || count > bytes.length) throw new Error('Invalid C3 stdin counters');
			if (count) {
				const value = bytes[read % bytes.length];
				Atomics.store(control, 1, read + 1);
				// Wake the producer once per batch, rather than posting one message per byte.
				if (count === 1 || (read + 1) % 4096 === 0)
					self.postMessage({ type: 'stdin-request' });
				return value;
			}
			if (Atomics.load(control, 2)) return -1;
			self.postMessage({ type: 'stdin-request' });
			// EOF changes a different slot; recheck after a bounded wait if its notification raced this call.
			Atomics.wait(control, 0, write, 100);
		}
	};
}

self.onmessage = async ({ data }) => {
	if (data?.run !== true || c3Consumed) return;
	c3Consumed = true;
	const urls = [];
	let phase = 'compile';
	let compilerLog = '';
	let compilerLogBytes = 0;
	const encoder = new TextEncoder();
	try {
		const { limits, runtimePreflight: assets, activePath, workspaceFiles, code } = data;
		if (
			!limits ||
			typeof code !== 'string' ||
			typeof activePath !== 'string' ||
			!assets ||
			assets.protocol !== 'wasm-idle-c3-preflight' ||
			assets.profileId !== c3Profile.profileId
		)
			throw new Error('Invalid C3 execution payload');
		for (const [key, receipt] of [
			['compilerJavaScriptBytes', c3Profile.compilerJavaScriptReceipt],
			['compilerWasmBytes', c3Profile.compilerWasmReceipt],
			['producerReceiptBytes', c3Profile.producerReceipt]
		]) {
			const bytes = assets[key];
			if (
				!(bytes instanceof Uint8Array) ||
				bytes.length !== receipt.bytes ||
				bytes.length > data.maxAssetBytes ||
				(await c3Digest(bytes)) !== receipt.sha256
			) {
				throw new Error('C3 verified asset changed: ' + key);
			}
		}
		if ((data.args?.length || 0) !== 0)
			throw new Error('C3 byte-ABI programs do not accept program arguments');
		for (const key of [
			'maxWasmMemoryBytes',
			'maxOutputBytes',
			'maxDiagnostics',
			'maxWorkspaceBytes'
		]) {
			if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0)
				throw new Error('Invalid C3 execution limit');
		}
		const totalCap = Math.min(limits.maxWasmMemoryBytes, 2 * 1024 ** 3);
		const guestCap = Math.min(64 * 1024 ** 2, Math.floor(totalCap / 8 / 65536) * 65536);
		const compilerCap = totalCap - guestCap;
		const boundedCompiler = await limitC3WasmMemory(assets.compilerWasmBytes, compilerCap);
		self.postMessage({
			evidence: {
				kind: 'c3-memory-limits',
				limitBytes: limits.maxWasmMemoryBytes,
				compiler: boundedCompiler.evidence,
				guest: null
			}
		});
		const loaderUrl = URL.createObjectURL(
			new Blob([assets.compilerJavaScriptBytes], { type: 'text/javascript' })
		);
		urls.push(loaderUrl);
		const { default: createCompiler } = await import(loaderUrl);
		let diagnosticCount = 0;
		const diagnostic = (line) => {
			const match = /^\((.*):(\d+):(\d+)\) (Error|Warning): (.*)$/u.exec(line);
			if (!match) return;
			if (++diagnosticCount > limits.maxDiagnostics)
				throw Object.assign(new Error('C3 diagnostic limit exceeded'), {
					code: 'diagnostic-limit',
					actual: diagnosticCount,
					limit: limits.maxDiagnostics
				});
			self.postMessage({
				diagnostic: {
					fileName: match[1].replace(/^\/work\//u, ''),
					lineNumber: Number(match[2]),
					columnNumber: Number(match[3]),
					severity: match[4] === 'Error' ? 'error' : 'warning',
					message: match[5]
				}
			});
		};
		const log = (line) => {
			line = String(line);
			diagnostic(line);
			compilerLogBytes += encoder.encode(line).length + 1;
			if (compilerLogBytes > limits.maxOutputBytes) {
				throw Object.assign(new Error('C3 compiler output limit exceeded'), {
					code: 'output-limit',
					actual: compilerLogBytes,
					limit: limits.maxOutputBytes
				});
			}
			compilerLog += line + '\n';
		};
		const compiler = await createCompiler({
			noInitialRun: true,
			wasmBinary: boundedCompiler.bytes,
			locateFile: () => loaderUrl,
			print: log,
			printErr: log
		});
		compiler.FS.mkdir('/work');
		compiler.FS.chdir('/work');
		const files = new Map((workspaceFiles || []).map((file) => [file.path, file.content]));
		files.set(activePath, code);
		let sourceBytes = 0;
		for (const [name, source] of files) {
			if (
				typeof name !== 'string' ||
				name.startsWith('/') ||
				name.includes('\\') ||
				name.split('/').some((part) => !part || part === '.' || part === '..') ||
				typeof source !== 'string'
			) {
				throw new Error('Invalid C3 workspace path');
			}
			sourceBytes += encoder.encode(source).length;
			if (sourceBytes > limits.maxWorkspaceBytes)
				throw new Error('C3 workspace limit exceeded');
			compiler.FS.mkdirTree('/work/' + name.split('/').slice(0, -1).join('/'));
			compiler.FS.writeFile('/work/' + name, source);
		}
		const sources = [...files.keys()]
			.filter((name) => name.endsWith('.c3'))
			.map((name) => '/work/' + name);
		if (!activePath.endsWith('.c3') || !sources.length)
			throw new Error('C3 source files must use the .c3 extension');
		let exitCode;
		const args = [
			'compile',
			'--target',
			'wasm32',
			'--stdlib',
			'/lib/std',
			'--threads',
			'1',
			'--max-mem',
			'64',
			'--reloc=none',
			'--link-libc=no',
			'--no-entry',
			'-g0',
			'--ansi=no',
			'--linker=builtin',
			'-o',
			'/work/program.wasm',
			...sources
		];
		try {
			exitCode = compiler.callMain(args) ?? 0;
		} catch (error) {
			if (!Number.isInteger(error?.status)) throw error;
			exitCode = error.status;
		}
		if (exitCode !== 0) throw new Error('C3 compilation failed (exit ' + exitCode + ')');
		const program = compiler.FS.readFile('/work/program.wasm');
		const boundedGuest = await limitC3WasmMemory(program, guestCap);
		const module = await WebAssembly.compile(boundedGuest.bytes);
		for (const imported of WebAssembly.Module.imports(module)) {
			if (
				imported.kind !== 'function' ||
				imported.module !== 'env' ||
				!['readByte', 'writeByte'].includes(imported.name)
			) {
				throw new Error(
					'Unsupported C3 guest import: ' + imported.module + '.' + imported.name
				);
			}
		}
		self.postMessage({
			evidence: {
				kind: 'c3-memory-limits',
				limitBytes: limits.maxWasmMemoryBytes,
				compiler: boundedCompiler.evidence,
				guest: boundedGuest.evidence
			}
		});
		let outputBytes = 0;
		const decoder = new TextDecoder();
		let buffered = [];
		const flush = (final = false) => {
			const text = decoder.decode(Uint8Array.from(buffered), { stream: !final });
			buffered = [];
			if (text) self.postMessage({ output: text, stream: 'stdout' });
		};
		const readByte = c3Stdin(data.stdin, data.stdinChannel);
		if (
			!WebAssembly.Module.exports(module).some(
				(item) => item.name === 'main' && item.kind === 'function'
			)
		)
			throw new Error('Export fn void main() @wasm("main") for the C3 byte ABI');
		phase = 'execute';
		self.postMessage({ type: 'execution-ready' });
		const instance = await WebAssembly.instantiate(module, {
			env: {
				readByte: () => {
					flush();
					return readByte();
				},
				writeByte: (value) => {
					if (++outputBytes > limits.maxOutputBytes) {
						const error = new Error('C3 output limit exceeded');
						Object.assign(error, {
							code: 'output-limit',
							actual: outputBytes,
							limit: limits.maxOutputBytes
						});
						throw error;
					}
					buffered.push(value & 255);
					if (value === 10 || buffered.length === 1024) flush();
				}
			}
		});
		if (typeof instance.exports.main !== 'function')
			throw new Error('Export fn void main() @wasm("main") for the C3 byte ABI');
		try {
			instance.exports._initialize?.();
			const status = instance.exports.main();
			if (status !== undefined && status !== 0) throw new Error('C3 main returned ' + status);
		} finally {
			flush(true);
		}
		self.postMessage({ results: true });
	} catch (error) {
		const memoryFailure =
			/^(?:growMemory:.*Maximum memory size exceeded|Failed to malloc \d+ bytes\.|Failed to grow the heap|⚠️Fatal Error! The compiler ran out of memory)/mu.test(
				compilerLog
			) || /^Aborted\(OOM\)/u.test(String(error.message || error));
		const code =
			error.code ||
			(memoryFailure ? 'resource-limit' : phase === 'compile' ? 'compile' : 'runtime');
		self.postMessage({
			error: String(error.message || error) + (compilerLog ? '\n' + compilerLog : ''),
			failure: {
				name: error.name || 'Error',
				message: String(error.message || error) + (compilerLog ? '\n' + compilerLog : ''),
				code,
				phase,
				runtimeId: 'C3',
				...(code === 'resource-limit'
					? {
							resource: 'wasm-memory',
							...(error.actual === undefined ? {} : { actual: error.actual }),
							limit: error.limit ?? data.limits.maxWasmMemoryBytes
						}
					: {}),
				...(['output-limit', 'diagnostic-limit'].includes(code)
					? { actual: error.actual, limit: error.limit }
					: {})
			}
		});
	} finally {
		for (const url of urls) URL.revokeObjectURL(url);
		self.close();
	}
};
