// Official upstream PARI/GP bytecode, run in a fresh Worker per request.
const PARIGP_LOCK = __WASM_IDLE_PARIGP_ASSET_LOCK__;
const INITIAL_MEMORY_BYTES = 393 * 65536;
function createSharedStdinReader(channel, flush = () => {}) {
	if (
		!channel ||
		channel.protocol !== 'wasm-idle-static-stdin-ring' ||
		channel.protocolVersion !== 2 ||
		channel.controlBytes !== 16 ||
		!Number.isSafeInteger(channel.capacity) ||
		channel.capacity < 1 ||
		channel.capacity > 2 ** 31 ||
		typeof SharedArrayBuffer !== 'function' ||
		!(channel.buffer instanceof SharedArrayBuffer) ||
		channel.buffer.byteLength !== 16 + channel.capacity ||
		typeof Atomics.wait !== 'function'
	) {
		throw new Error('PARI/GP interactive stdin requires the shared streaming channel.');
	}
	const control = new Int32Array(channel.buffer, 0, 4);
	// Keep rollover aligned with byte offsets, including non-power-of-two capacities.
	const counterRange = Math.floor(2 ** 32 / channel.capacity) * channel.capacity;
	const bytes = new Uint8Array(channel.buffer, 16, channel.capacity);
	const readByte = (blocking = true) => {
		flush();
		while (true) {
			if (Atomics.load(control, 3) === 1)
				throw new Error('PARI/GP streaming stdin was cancelled.');
			const write = Atomics.load(control, 0) >>> 0,
				read = Atomics.load(control, 1) >>> 0;
			const available = (write - read + counterRange) % counterRange;
			if (write >= counterRange || read >= counterRange || available > channel.capacity)
				throw new Error('PARI/GP stdin ring is corrupt.');
			if (available > 0) {
				const value = bytes[read % channel.capacity];
				Atomics.store(control, 1, (read + 1) % counterRange);
				return value;
			}
			if (Atomics.load(control, 2) === 1) return null;
			if (!blocking) return undefined;
			self.postMessage({ type: 'stdin-request' });
			// EOF/cancel may notify between the flag check and wait; recheck after a bounded wait.
			Atomics.wait(control, 0, write, 100);
		}
	};
	return withPartialReads(readByte);
}

function createBufferedStdinReader(source) {
	const input = new TextEncoder().encode(typeof source === 'string' ? source : '');
	let offset = 0;
	return withPartialReads(() => (offset < input.length ? input[offset++] : null));
}

// Emscripten's default device read fills the whole libc request byte by byte. Return the
// bytes that are already available as a short read so a prompt written after READ-LINE
// appears before the next line or EOF arrives.
function withPartialReads(readByte) {
	readByte.read = (stream, buffer, offset, length) => {
		let count = 0;
		while (count < length) {
			const value = readByte(count === 0);
			if (value === null || value === undefined) break;
			buffer[offset + count++] = value;
		}
		if (count) stream.node.atime = Date.now();
		return count;
	};
	return readByte;
}

function createOutput(stream, capture = () => {}) {
	const decoder = new TextDecoder();
	const pending = [];
	const emit = (text) => {
		if (!text) return;
		capture(text);
		self.postMessage({ output: text, stream });
	};
	const flush = (final = false) => {
		emit(decoder.decode(Uint8Array.from(pending), { stream: !final }));
		pending.length = 0;
	};
	return {
		byte(value) {
			pending.push(value & 255);
			if (value === 10 || pending.length >= 4096) flush();
		},
		line(value) {
			flush();
			emit(`${value}\n`);
		},
		flush
	};
}

function workspacePath(value) {
	if (
		typeof value !== 'string' ||
		!value ||
		value.startsWith('/') ||
		value.includes('\\') ||
		value.includes('"') ||
		value.split('/').some((part) => part === '..' || part === '.' || !part) ||
		value.includes('\0')
	) {
		throw new Error('PARI/GP workspace path is invalid.');
	}
	return `/workspace/${value}`;
}

async function verifyPayload(payload) {
	for (const [name, receipt] of Object.entries({
		'gp.mjs': PARIGP_LOCK.delivery['gp.mjs'],
		'gp.wasm': PARIGP_LOCK.assets['gp.wasm']
	})) {
		const bytes = payload?.[name];
		if (!(bytes instanceof Uint8Array) || bytes.byteLength !== receipt.bytes)
			throw new Error(`PARI/GP ${name} size mismatch`);
		const sha256 = Array.from(
			new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
			(x) => x.toString(16).padStart(2, '0')
		).join('');
		if (sha256 !== receipt.sha256) throw new Error(`PARI/GP ${name} SHA-256 mismatch`);
	}
}

// The official module owns its memory. Lower only the memory maximum before instantiation;
// code/data sections remain byte-identical. Verify the exact upstream memory declaration.
function boundMemory(bytes, maxBytes) {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < INITIAL_MEMORY_BYTES) {
		throw Object.assign(new Error('PARI/GP requires at least 25 MiB of Wasm memory.'), {
			code: 'resource-limit',
			resource: 'wasm-memory',
			actual: INITIAL_MEMORY_BYTES,
			limit: maxBytes
		});
	}
	const result = bytes.slice();
	let position = 8;
	const leb = () => {
		let value = 0,
			shift = 0;
		for (let count = 0; count < 5; count++) {
			if (position >= result.length) throw new Error('Truncated PARI/GP Wasm');
			const byte = result[position++];
			value += (byte & 127) * 2 ** shift;
			if (!(byte & 128)) return value;
			shift += 7;
		}
		throw new Error('Invalid PARI/GP Wasm integer');
	};
	while (position < result.length) {
		const id = result[position++];
		const size = leb();
		if (id === 5) {
			const expected = [1, 1, 137, 3, 128, 128, 2];
			if (
				size !== expected.length ||
				expected.some((byte, i) => result[position + i] !== byte)
			)
				throw new Error('PARI/GP memory declaration changed');
			let maximum = Math.min(32768, Math.floor(maxBytes / 65536));
			result[position + 4] = (maximum & 127) | 128;
			maximum >>>= 7;
			result[position + 5] = (maximum & 127) | 128;
			result[position + 6] = maximum >>> 7;
			return result;
		}
		position += size;
	}
	throw new Error('PARI/GP module has no memory');
}

let used = false;
self.onmessage = async ({ data }) => {
	if (!data?.run) return;
	let url;
	let phase = 'startup';
	try {
		if (used) throw new Error('PARI/GP requires a fresh Worker');
		used = true;
		if (data.args?.length) throw new Error('PARI/GP program arguments are unsupported');
		await verifyPayload(data.runtimePreflight);
		const payload = data.runtimePreflight;
		const maximum = data.limits?.maxWasmMemoryBytes;
		const compiled = await WebAssembly.compile(boundMemory(payload['gp.wasm'], maximum));
		const stdout = createOutput('stdout');
		let errorText = '';
		const stderr = createOutput('stderr', (text) => {
			errorText += text.slice(0, Math.max(0, 65536 - errorText.length));
		});
		const flush = () => {
			stdout.flush();
			stderr.flush();
		};
		const stdin = data.stdinChannel
			? createSharedStdinReader(data.stdinChannel, flush)
			: createBufferedStdinReader(data.stdin);
		url = URL.createObjectURL(new Blob([payload['gp.mjs']], { type: 'text/javascript' }));
		const { default: createPari } = await import(url);
		const gp = await createPari({
			noInitialRun: true,
			stdin,
			stdout: stdout.byte,
			stderr: stderr.byte,
			print: stdout.line,
			printErr: stderr.line,
			locateFile(name) {
				throw new Error(`Unverified PARI/GP asset request: ${name}`);
			},
			instantiateWasm(imports, receive) {
				const instance = new WebAssembly.Instance(compiled, imports);
				receive(instance);
				return instance.exports;
			}
		});
		gp.FS.getStream(0).stream_ops.read = stdin.read;
		gp.FS.mkdirTree('/workspace');
		for (const file of data.workspaceFiles || []) {
			const filePath = workspacePath(file.path);
			gp.FS.mkdirTree(filePath.slice(0, filePath.lastIndexOf('/')));
			gp.FS.writeFile(filePath, file.content);
		}
		const active = workspacePath(data.activePath || 'main.gp');
		gp.FS.mkdirTree(active.slice(0, active.lastIndexOf('/')));
		gp.FS.writeFile(active, data.code);
		gp.FS.chdir('/workspace');
		// Match the official browser initial PARI stack; growth stays below the Wasm ceiling.
		gp.ccall(
			'gp_embedded_init',
			null,
			['number', 'number'],
			[4000000, Math.max(4000000, Math.min(64 * 1024 * 1024, Math.floor(maximum / 4)))]
		);
		phase = 'execute';
		self.postMessage({ type: 'execution-ready' });
		let status;
		try {
			// The official embedding API includes GP's real multiline input reader.
			// A read(active) wrapper makes input() consume subsequent source lines.
			status = gp.ccall('gp_embedded', 'number', ['string'], [data.code]);
		} catch (error) {
			if (error?.name === 'ExitStatus' && error.status === 0) status = 0;
			else throw error;
		} finally {
			flush();
			stdout.flush(true);
			stderr.flush(true);
		}
		if (status !== 0)
			throw Object.assign(new Error(errorText.trim() || 'PARI/GP evaluation failed'), {
				code: 'runtime'
			});
		self.postMessage({ results: true });
	} catch (error) {
		self.postMessage({
			error: error?.message || String(error),
			failure: {
				name: error?.name || 'Error',
				message: error?.message || String(error),
				runtimeId: 'PARIGP',
				code: error?.code || 'runtime',
				phase,
				...(error?.code === 'resource-limit'
					? { resource: error.resource, actual: error.actual, limit: error.limit }
					: {})
			}
		});
	} finally {
		if (url) URL.revokeObjectURL(url);
	}
};
