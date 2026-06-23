function assetUrl(baseUrl, path) {
	return new URL(path, baseUrl).href;
}

function postOutput(lines) {
	const output = lines.filter(Boolean).join('\n');
	if (output) self.postMessage({ output: output.endsWith('\n') ? output : `${output}\n` });
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
		throw new Error('Julia runtime asset is gzip-compressed, but DecompressionStream is unavailable.');
	}
	const decompressed = compressedResponse.body.pipeThrough(new DecompressionStream('gzip'));
	return new Response(decompressed).arrayBuffer();
}

function createCharOutput(lines) {
	const decoder = new TextDecoder();
	let bytes = [];
	return (value) => {
		if (value === null || value === 10) {
			const text = decoder.decode(new Uint8Array(bytes));
			bytes = [];
			if (text) lines.push(text);
			return;
		}
		if (value !== 0) bytes.push(value);
	};
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

function buildRunnerSource(code, stdin, activePath) {
	return `import Base: readline, readlines, read, eachline
const __wasm_idle_stdin = IOBuffer(${juliaString(stdin)})
readline() = Base.readline(__wasm_idle_stdin)
readline(::typeof(stdin)) = Base.readline(__wasm_idle_stdin)
readlines() = Base.readlines(__wasm_idle_stdin)
readlines(::typeof(stdin)) = Base.readlines(__wasm_idle_stdin)
read() = read(stdin, String)
read(::typeof(stdin)) = take!(__wasm_idle_stdin)
read(::typeof(stdin), ::Type{String}) = String(take!(__wasm_idle_stdin))
eachline() = eachline(stdin)
function eachline(::typeof(stdin))
    data = String(take!(__wasm_idle_stdin))
    isempty(data) ? String[] : split(chomp(data), '\\n')
end
try
    Base.include_string(Main, ${juliaString(code)}, ${juliaString(activePath || 'main.jl')})
catch error
    showerror(stderr, error)
    println(stderr)
    rethrow(error)
end`;
}

async function loadJuliaRuntime(baseUrl, stdout, stderr) {
	const wasmBinary = await fetchRuntimeBytes(baseUrl, 'julia.wasm');
	const sysimageData = await fetchRuntimeBytes(baseUrl, 'julia.data');
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
		print: (text) => stdout.push(String(text)),
		printErr: (text) => stderr.push(String(text)),
		stdin: () => null,
		stdout: createCharOutput(stdout),
		stderr: createCharOutput(stderr)
	};
	self.Module = module;
	return await new Promise((resolve, reject) => {
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
}

self.onmessage = async (event) => {
	const { baseUrl, code, stdin, activePath, log } = event.data || {};
	const stdout = [];
	const stderr = [];
	try {
		if (log) console.log(`[wasm-idle:julia-worker] run start baseUrl=${baseUrl}`);
		const module = await loadJuliaRuntime(baseUrl, stdout, stderr);
		const runnerSource = buildRunnerSource(code || '', stdin || '', activePath);
		const sourcePtr = cString(module, runnerSource);
		try {
			module._jl_eval_string(sourcePtr);
		} finally {
			module._free(sourcePtr);
		}
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
		postOutput(stdout);
		if (log) console.log('[wasm-idle:julia-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		const message = stderr.length > 0 ? stderr.join('\n') : error?.message || String(error);
		if (log) console.error('[wasm-idle:julia-worker] failed', error);
		self.postMessage({ error: message });
	}
};
