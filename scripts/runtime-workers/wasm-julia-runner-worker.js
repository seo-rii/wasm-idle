const textEncoder = new TextEncoder();

function assetUrl(baseUrl, path) {
	return new URL(path, baseUrl).href;
}

function postOutput(lines) {
	const output = lines.filter(Boolean).join('\n');
	if (output) self.postMessage({ output: output.endsWith('\n') ? output : `${output}\n` });
}

function postOutputChunk(output) {
	if (output) self.postMessage({ output });
}

function createStdinReader(stdin, channel) {
	if (channel === undefined) {
		const bytes = textEncoder.encode(typeof stdin === 'string' ? stdin : '');
		let offset = 0;
		return () => (offset < bytes.length ? bytes[offset++] : null);
	}
	if (
		channel?.protocol !== 'wasm-idle-static-stdin-ring' ||
		channel?.protocolVersion !== 1 ||
		channel?.controlBytes !== 16 ||
		!Number.isSafeInteger(channel?.capacity) ||
		channel.capacity <= 0 ||
		typeof SharedArrayBuffer !== 'function' ||
		!(channel.buffer instanceof SharedArrayBuffer) ||
		channel.buffer.byteLength !== channel.controlBytes + channel.capacity ||
		typeof Atomics.wait !== 'function'
	) {
		throw new Error('Invalid Julia streaming stdin channel.');
	}

	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	let yieldAfterChunk = false;
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1) {
				throw new Error('Julia streaming stdin was cancelled.');
			}
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('Julia streaming stdin counters are invalid.');
			}
			if (available > 0) {
				const value = bytes[read % bytes.byteLength];
				Atomics.store(control, 1, read + 1);
				if (available === 1) {
					yieldAfterChunk = true;
					self.postMessage({ type: 'stdin-request' });
				}
				return value;
			}
			if (Atomics.load(control, 2) === 1) return null;
			if (yieldAfterChunk) {
				yieldAfterChunk = false;
				return undefined;
			}
			self.postMessage({ type: 'stdin-request' });
			Atomics.wait(control, 0, write);
		}
	};
}

async function fetchRuntimeBytes(baseUrl, path) {
	const runtimeUrl = assetUrl(baseUrl, path);
	const response = await fetch(runtimeUrl).catch(() => null);
	if (response?.ok) return response.arrayBuffer();

	const compressedResponse = await fetch(assetUrl(baseUrl, `${path}.gz`)).catch(() => null);
	if (!compressedResponse?.ok || !compressedResponse.body) {
		throw new Error(`Julia runtime asset was not found: ${runtimeUrl}`);
	}
	const contentEncoding = (compressedResponse.headers.get('content-encoding') || '')
		.toLowerCase()
		.split(',')
		.map((value) => value.trim());
	if (contentEncoding.includes('gzip')) return compressedResponse.arrayBuffer();
	if (typeof DecompressionStream !== 'function') {
		throw new Error(
			'Julia runtime asset is gzip-compressed, but DecompressionStream is unavailable.'
		);
	}
	const decompressed = compressedResponse.body.pipeThrough(new DecompressionStream('gzip'));
	return new Response(decompressed).arrayBuffer();
}

function createCharOutput(lines, onChunk = () => {}) {
	const decoder = new TextDecoder();
	let line = '';
	const flush = () => {
		const tail = decoder.decode();
		if (tail) onChunk(tail);
		line += tail;
		if (line) lines.push(line);
		line = '';
	};
	const output = (value) => {
		if (value === null) {
			flush();
			return;
		}
		if (value === 0) return;
		const text = decoder.decode(Uint8Array.of(value), { stream: true });
		if (text) {
			line += text;
			onChunk(text);
		}
		if (value === 10) {
			const completedLine = line.endsWith('\n') ? line.slice(0, -1) : line;
			if (completedLine) lines.push(completedLine);
			line = '';
		}
	};
	output.finish = flush;
	return output;
}

function cString(module, text) {
	const bytes = new TextEncoder().encode(`${text}\0`);
	const ptr = module._malloc(bytes.length);
	module.HEAPU8.set(bytes, ptr);
	return ptr;
}

function juliaString(text) {
	return JSON.stringify(String(text || ''));
}

function buildRunnerSource(code, stdin, activePath, streaming) {
	const stdinSource = streaming ? 'open("/dev/stdin", "r")' : `IOBuffer(${juliaString(stdin)})`;
	const stdinSetup = `import Base: readline, readlines, read, eachline
const __wasm_idle_stdin = ${stdinSource}
readline() = Base.readline(__wasm_idle_stdin)
readline(::typeof(stdin)) = Base.readline(__wasm_idle_stdin)
readlines() = Base.readlines(__wasm_idle_stdin)
readlines(::typeof(stdin)) = Base.readlines(__wasm_idle_stdin)
read() = Base.read(__wasm_idle_stdin, String)
read(::typeof(stdin)) = Base.read(__wasm_idle_stdin)
read(::typeof(stdin), ::Type{String}) = Base.read(__wasm_idle_stdin, String)
eachline() = Base.eachline(__wasm_idle_stdin)
eachline(::typeof(stdin)) = Base.eachline(__wasm_idle_stdin)`;
	return `${stdinSetup}
try
    Base.include_string(Main, ${juliaString(code)}, ${juliaString(activePath || 'main.jl')})
catch error
    showerror(stderr, error)
    println(stderr)
    rethrow(error)
end`;
}

async function loadJuliaRuntime(baseUrl, stdinReader, stdout, stderr) {
	const wasmBinary = await fetchRuntimeBytes(baseUrl, 'julia.wasm');
	const sysimageData = await fetchRuntimeBytes(baseUrl, 'julia.data');
	const stdoutDevice = createCharOutput(stdout, postOutputChunk);
	const stderrDevice = createCharOutput(stderr);
	const module = {
		noInitialRun: true,
		wasmBinary,
		getPreloadedPackage: () => sysimageData,
		locateFile(path) {
			const value = String(path);
			if (value.includes('cdn.jsdelivr.net')) return assetUrl(baseUrl, 'julia.data');
			if (value.endsWith('julia-wasm/julia.wasm')) return assetUrl(baseUrl, 'julia.wasm');
			return assetUrl(baseUrl, value);
		},
		print: (text) => {
			const output = String(text);
			stdout.push(output);
			postOutput([output]);
		},
		printErr: (text) => stderr.push(String(text)),
		stdin: stdinReader,
		stdout: stdoutDevice,
		stderr: stderrDevice
	};
	self.Module = module;
	const initializedModule = await new Promise((resolve, reject) => {
		module.onRuntimeInitialized = () => {
			try {
				module._jl_initialize();
				resolve(module);
			} catch (error) {
				reject(error);
			}
		};
		try {
			importScripts(assetUrl(baseUrl, 'julia.js'));
		} catch (error) {
			reject(error);
		}
	});
	return {
		module: initializedModule,
		finishOutput() {
			stdoutDevice.finish();
			stderrDevice.finish();
		}
	};
}

self.onmessage = async (event) => {
	const { baseUrl, code, stdin, stdinChannel, activePath, log } = event.data || {};
	const stdout = [];
	const stderr = [];
	let finishOutput = () => {};
	try {
		if (log) console.log(`[wasm-idle:julia-worker] run start baseUrl=${baseUrl}`);
		const stdinReader = createStdinReader(stdin || '', stdinChannel);
		const runtime = await loadJuliaRuntime(baseUrl, stdinReader, stdout, stderr);
		const { module } = runtime;
		finishOutput = runtime.finishOutput;
		const runnerSource = buildRunnerSource(
			code || '',
			stdin || '',
			activePath,
			stdinChannel !== undefined
		);
		const sourcePtr = cString(module, runnerSource);
		try {
			module._jl_eval_string(sourcePtr);
		} finally {
			module._free(sourcePtr);
		}
		finishOutput();
		const exception =
			typeof module._jl_exception_occurred === 'function'
				? module._jl_exception_occurred()
				: 0;
		const filteredStderr = stderr.filter(
			(line) =>
				!line.includes(
					'file packager has copied file data into memory, but in memory growth we are forced to copy it again'
				)
		);
		if (filteredStderr.length > 0) {
			throw new Error(filteredStderr.join('\n'));
		}
		if (exception) {
			throw new Error('Julia execution failed.');
		}
		if (log) console.log('[wasm-idle:julia-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		const message = stderr.length > 0 ? stderr.join('\n') : error?.message || String(error);
		if (log) console.error('[wasm-idle:julia-worker] failed', error);
		self.postMessage({ error: message });
	} finally {
		finishOutput();
	}
};
