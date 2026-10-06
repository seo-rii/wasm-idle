// scripts/sync-wasm-grain.mjs prepends grain-host.mjs and binds this worker to one Grain profile.
const grainProfile = __WASM_IDLE_GRAIN_PROFILE__;
const GRAIN_WASM_PAGE_BYTES = 65_536;
const GRAIN_DEFAULT_INITIAL_PAGES = 64;
let grainConsumed = false;

async function grainDigest(bytes) {
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) =>
		value.toString(16).padStart(2, '0')
	).join('');
}

async function grainVerify(bytes, receipt, label) {
	if (
		!(bytes instanceof Uint8Array) ||
		bytes.length !== receipt.bytes ||
		(await grainDigest(bytes)) !== receipt.sha256
	) {
		throw new Error(`Grain verified asset changed: ${label}`);
	}
	return bytes;
}

async function grainGunzip(bytes, receipt, label) {
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
	const decoded = new Uint8Array(await new Response(stream).arrayBuffer());
	return grainVerify(decoded, receipt, label);
}

function grainStdin(source, channel) {
	if (!channel) {
		const input = new TextEncoder().encode(source || '');
		let offset = 0;
		return (maxLength) => {
			const chunk = input.subarray(offset, offset + maxLength);
			offset += chunk.length;
			return chunk;
		};
	}
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
		throw new Error('Invalid Grain stdin ring');
	const control = new Int32Array(channel.buffer, 0, 4);
	const ring = new Uint8Array(channel.buffer, 16, channel.capacity);
	return (maxLength) => {
		while (true) {
			if (Atomics.load(control, 3)) throw new Error('Grain stdin cancelled');
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > ring.length)
				throw new Error('Invalid Grain stdin counters');
			if (available) {
				const count = Math.min(maxLength, available);
				const chunk = new Uint8Array(count);
				for (let index = 0; index < count; index++)
					chunk[index] = ring[(read + index) % ring.length];
				Atomics.store(control, 1, read + count);
				self.postMessage({ type: 'stdin-request' });
				return chunk;
			}
			if (Atomics.load(control, 2)) return new Uint8Array(0);
			self.postMessage({ type: 'stdin-request' });
			// EOF changes a different slot; recheck after a bounded wait if its notification raced.
			Atomics.wait(control, 0, write, 100);
		}
	};
}

function grainWorkspacePath(name) {
	if (
		typeof name !== 'string' ||
		name.startsWith('/') ||
		name.includes('\\') ||
		name.split('/').some((part) => !part || part === '.' || part === '..')
	) {
		throw new Error('Invalid Grain workspace path');
	}
	return `${GRAIN_WORK_ROOT}/${name}`;
}

function grainLimitError(message, code, actual, limit) {
	return Object.assign(new Error(message), { code, actual, limit });
}

self.onmessage = async ({ data }) => {
	if (data?.run !== true || grainConsumed) return;
	grainConsumed = true;
	const urls = [];
	let phase = 'compile';
	let programStderr = '';
	try {
		const { limits, runtimePreflight: assets, activePath, workspaceFiles, code } = data;
		if (
			!limits ||
			typeof code !== 'string' ||
			typeof activePath !== 'string' ||
			!assets ||
			assets.protocol !== 'wasm-idle-grain-preflight' ||
			assets.profileId !== grainProfile.profileId ||
			(data.args !== undefined &&
				(!Array.isArray(data.args) || data.args.some((value) => typeof value !== 'string')))
		)
			throw new Error('Invalid Grain execution payload');
		for (const key of ['maxWasmMemoryBytes', 'maxOutputBytes', 'maxWorkspaceBytes']) {
			if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0)
				throw new Error('Invalid Grain execution limit');
		}
		if (!activePath.endsWith('.gr'))
			throw new Error('Grain source files must use the .gr extension');
		self.postMessage({ progress: { percent: 5, stage: 'Verifying Grain compiler' } });
		const compilerBytes = await grainGunzip(
			await grainVerify(
				assets.compilerBytes,
				grainProfile.compilerStorage,
				'grainc.js.gz.bin'
			),
			grainProfile.compilerJavaScript,
			'grainc.js'
		);
		const stdlibBytes = await grainGunzip(
			await grainVerify(assets.stdlibBytes, grainProfile.stdlibStorage, 'stdlib.pack.gz.bin'),
			grainProfile.stdlibPack,
			'stdlib.pack'
		);
		const files = readGrainStdlibPack(stdlibBytes).map((file) => ({
			path: `${GRAIN_STDLIB_ROOT}/${file.path}`,
			data: file.data,
			mtimeMs: file.path.endsWith('.gro')
				? GRAIN_STDLIB_OBJECT_MTIME_MS
				: GRAIN_STDLIB_SOURCE_MTIME_MS
		}));
		const encoder = new TextEncoder();
		const sources = new Map();
		for (const file of workspaceFiles || []) {
			if (typeof file?.content !== 'string') throw new Error('Invalid Grain workspace file');
			sources.set(file.path, file.content);
		}
		sources.set(activePath, code);
		let workspaceBytes = 0;
		for (const [name, source] of sources) {
			const data = encoder.encode(source);
			workspaceBytes += data.length;
			if (workspaceBytes > limits.maxWorkspaceBytes)
				throw Object.assign(new Error('Grain workspace limit exceeded'), {
					code: 'runtime-configuration'
				});
			files.push({ path: grainWorkspacePath(name), data });
		}
		const maximumPages = Math.min(
			65_536,
			Math.floor(limits.maxWasmMemoryBytes / GRAIN_WASM_PAGE_BYTES)
		);
		if (maximumPages < 1)
			throw grainLimitError(
				'Grain programs need at least one Wasm memory page',
				'resource-limit',
				GRAIN_WASM_PAGE_BYTES,
				limits.maxWasmMemoryBytes
			);
		const source = grainWorkspacePath(activePath);
		const output = source.replace(/\.gr$/u, '.wasm');
		let compilerText = '';
		const decoder = new TextDecoder();
		const collect = (chunk) => {
			compilerText += decoder.decode(chunk, { stream: true });
			if (encoder.encode(compilerText).length > limits.maxOutputBytes)
				throw grainLimitError(
					'Grain compiler output limit exceeded',
					'output-limit',
					compilerText.length,
					limits.maxOutputBytes
				);
		};
		// These flags are not part of Grain's object digest, so the precompiled stdlib stays valid.
		const host = createGrainCompilerHost({
			files,
			argv: [
				'--stdlib',
				GRAIN_STDLIB_ROOT,
				'--no-color',
				`--initial-memory-pages=${Math.min(GRAIN_DEFAULT_INITIAL_PAGES, maximumPages)}`,
				`--maximum-memory-pages=${maximumPages}`,
				'-o',
				output,
				source
			],
			onStdout: collect,
			onStderr: collect
		});
		self.postMessage({ progress: { percent: 20, stage: 'Compiling Grain' } });
		const compilerUrl = URL.createObjectURL(
			new Blob([compilerBytes], { type: 'text/javascript' })
		);
		urls.push(compilerUrl);
		globalThis.process = host.process;
		globalThis.require = host.require;
		let failure;
		try {
			await import(compilerUrl);
		} catch (error) {
			failure = error;
		} finally {
			delete globalThis.process;
			delete globalThis.require;
		}
		compilerText += decoder.decode();
		const status = host.exitCode() ?? (failure ? null : 0);
		if (status === null) throw failure;
		for (const diagnostic of parseGrainDiagnostics(compilerText)) {
			self.postMessage({ diagnostic });
		}
		if (compilerText) self.postMessage({ output: compilerText, stream: 'stderr' });
		const program = host.readFile(output);
		if (status !== 0 || !program) {
			self.postMessage({ results: false });
			return;
		}
		self.postMessage({ progress: { percent: 80, stage: 'Starting Grain program' } });
		const module = await WebAssembly.compile(program);
		let outputBytes = 0;
		let pending = [];
		const outputDecoder = new TextDecoder();
		const flush = (final = false) => {
			const total = pending.reduce((sum, chunk) => sum + chunk.length, 0);
			const joined = new Uint8Array(total);
			let offset = 0;
			for (const chunk of pending) {
				joined.set(chunk, offset);
				offset += chunk.length;
			}
			pending = [];
			const text = outputDecoder.decode(joined, { stream: !final });
			if (text) self.postMessage({ output: text, stream: 'stdout' });
		};
		const write = (chunk) => {
			outputBytes += chunk.length;
			if (outputBytes > limits.maxOutputBytes)
				throw grainLimitError(
					'Grain output limit exceeded',
					'output-limit',
					outputBytes,
					limits.maxOutputBytes
				);
			pending.push(chunk);
			if (chunk.includes(10) || pending.length > 64) flush();
		};
		const readStdin = grainStdin(data.stdin, data.stdinChannel);
		const wasi = createGrainWasi({
			args: data.args || [],
			readStdin(maxLength) {
				flush();
				return readStdin(maxLength);
			},
			onStdout: write,
			onStderr(chunk) {
				programStderr = (programStderr + new TextDecoder().decode(chunk)).slice(-4096);
				write(chunk);
			}
		});
		const imports = wasi.imports(module);
		phase = 'execute';
		self.postMessage({ type: 'execution-ready' });
		const instance = await WebAssembly.instantiate(module, imports);
		wasi.setMemory(instance.exports.memory);
		let exitCode = 0;
		try {
			if (typeof instance.exports._start !== 'function')
				throw new Error('Grain program does not export _start');
			instance.exports._start();
		} catch (error) {
			const exitStatus = wasi.exitStatus(error);
			if (exitStatus === null) throw error;
			exitCode = exitStatus;
		} finally {
			flush(true);
		}
		self.postMessage({
			evidence: {
				protocol: 'wasm-idle-grain-evidence-v1',
				profileId: grainProfile.profileId,
				compilerSha256: grainProfile.compilerJavaScript.sha256,
				maximumMemoryBytes: maximumPages * GRAIN_WASM_PAGE_BYTES,
				finalMemoryBytes: instance.exports.memory.buffer.byteLength,
				exitCode
			}
		});
		self.postMessage({ results: exitCode === 0 });
	} catch (error) {
		const message = String(error?.message || error);
		// Grain's allocator reports OutOfMemory on stderr and then traps.
		const memoryFailure =
			error instanceof RangeError ||
			/out of memory|Maximum memory size exceeded|could not allocate memory/iu.test(
				message
			) ||
			(phase === 'execute' && /^OutOfMemory\b/mu.test(programStderr));
		const code =
			error?.code ||
			(memoryFailure ? 'resource-limit' : phase === 'compile' ? 'compile' : 'runtime');
		self.postMessage({
			error: message,
			failure: {
				name: error?.name || 'Error',
				message,
				code,
				phase,
				runtimeId: 'GRAIN',
				...(code === 'resource-limit'
					? {
							resource: 'wasm-memory',
							limit: error?.limit ?? data.limits?.maxWasmMemoryBytes
						}
					: {}),
				...(code === 'output-limit' ? { actual: error.actual, limit: error.limit } : {})
			}
		});
	} finally {
		for (const url of urls) URL.revokeObjectURL(url);
		self.close();
	}
};
