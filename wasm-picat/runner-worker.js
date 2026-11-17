// Official Picat playground runtime, byte-pinned by the sync script.
const PICAT_LOCK = {"assets":{"picat.mjs":{"bytes":92578,"sha256":"81085627b2812693126589cee68187e9b3b278c17f421f41334b6c5aed2b6d9a"},"picat.wasm":{"bytes":4375549,"sha256":"2e9d503c9e3d4aec33dfc403cb493ec6dc2c132b87ed7d87b2ea059d687b8bff"},"picat.data":{"bytes":2777903,"sha256":"f428737a742424177dad88e0bd8f6b464037a58901b70a353fc03649c0f516f5"}}};
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
		throw new Error('Picat interactive stdin requires the shared streaming channel.');
	}
	const control = new Int32Array(channel.buffer, 0, 4);
	// Keep rollover aligned with byte offsets, including non-power-of-two capacities.
	const counterRange = Math.floor(2 ** 32 / channel.capacity) * channel.capacity;
	const bytes = new Uint8Array(channel.buffer, 16, channel.capacity);
	const readByte = (blocking = true) => {
		flush();
		while (true) {
			if (Atomics.load(control, 3) === 1)
				throw new Error('Picat streaming stdin was cancelled.');
			const write = Atomics.load(control, 0) >>> 0,
				read = Atomics.load(control, 1) >>> 0;
			const available = (write - read + counterRange) % counterRange;
			if (write >= counterRange || read >= counterRange || available > channel.capacity)
				throw new Error('Picat stdin ring is corrupt.');
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

async function verifyPayload(payload) {
	if (!payload || payload.fingerprint !== PICAT_LOCK.assets['picat.wasm'].sha256)
		throw new Error('Picat runtime profile mismatch');
	for (const [name, expected] of Object.entries(PICAT_LOCK.assets)) {
		const bytes = payload[name];
		if (!(bytes instanceof Uint8Array) || bytes.byteLength !== expected.bytes)
			throw new Error(`Picat ${name} size mismatch`);
		const digest = Array.from(
			new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
			(b) => b.toString(16).padStart(2, '0')
		).join('');
		if (digest !== expected.sha256) throw new Error(`Picat ${name} SHA-256 mismatch`);
	}
}

// Change only the declared maximum of the one wasm32 memory. All instructions, data and
// imports remain the upstream program; the browser enforces this cap on memory.grow.
function boundPicatMemory(bytes, maximumBytes) {
	const input = new Uint8Array(bytes);
	let offset = 8;
	const read = () => {
		let value = 0,
			shift = 0,
			byte;
		do {
			if (offset >= input.length || shift > 28) throw new Error('Invalid Picat Wasm LEB');
			byte = input[offset++];
			value += (byte & 127) * 2 ** shift;
			shift += 7;
		} while (byte & 128);
		return value;
	};
	const encode = (value) => {
		const result = [];
		do {
			const byte = value % 128;
			value = Math.floor(value / 128);
			result.push(byte | (value ? 128 : 0));
		} while (value);
		return result;
	};
	while (offset < input.length) {
		const sectionStart = offset;
		const id = input[offset++],
			length = read(),
			end = offset + length;
		if (end > input.length) throw new Error('Invalid Picat Wasm section');
		if (id === 5) {
			if (read() !== 1 || read() !== 1) throw new Error('Unexpected Picat memory layout');
			const initial = read(),
				maximum = read();
			if (offset !== end || initial !== 1024 || maximum !== 65536)
				throw new Error('Unexpected Picat memory bounds');
			const cap = Math.min(maximum, Math.floor(maximumBytes / 65536));
			if (!Number.isSafeInteger(cap) || cap < initial)
				throw Object.assign(new Error('Picat requires at least 64 MiB of Wasm memory'), {
					code: 'resource-limit',
					resource: 'wasm-memory',
					actual: 64 * 1024 * 1024,
					limit: maximumBytes
				});
			const section = [1, 1, ...encode(initial), ...encode(cap)];
			const header = [5, ...encode(section.length), ...section];
			const result = new Uint8Array(sectionStart + header.length + input.length - end);
			result.set(input.subarray(0, sectionStart));
			result.set(header, sectionStart);
			result.set(input.subarray(end), sectionStart + header.length);
			return result;
		}
		offset = end;
	}
	throw new Error('Missing Picat memory');
}

function workspacePath(value) {
	if (
		typeof value !== 'string' ||
		!value ||
		/[\\\0]/u.test(value) ||
		value.startsWith('/') ||
		value.split('/').some((p) => !p || p === '.' || p === '..')
	)
		throw new Error('Invalid Picat workspace path');
	return '/workspace/' + value;
}

let used = false;
self.onmessage = async ({ data }) => {
	if (!data?.run) return;
	let moduleUrl;
	let phase = 'startup';
	try {
		if (used) throw new Error('Picat requires a fresh Worker per invocation');
		used = true;
		if (data.args?.length)
			throw new Error('Picat browser runtime does not accept program arguments');
		await verifyPayload(data.runtimePreflight);
		const payload = data.runtimePreflight;
		const wasmBinary = boundPicatMemory(payload['picat.wasm'], data.limits?.maxWasmMemoryBytes);
		const compiled = await WebAssembly.compile(wasmBinary);
		const stdout = createOutput('stdout'),
			stderr = createOutput('stderr');
		const flushOutput = () => {
			stdout.flush();
			stderr.flush();
		};
		const stdin = data.stdinChannel
			? createSharedStdinReader(data.stdinChannel, flushOutput)
			: createBufferedStdinReader(data.stdin);
		moduleUrl = URL.createObjectURL(
			new Blob([payload['picat.mjs']], { type: 'text/javascript' })
		);
		const { default: createModule } = await import(moduleUrl);
		const module = await createModule({
			instantiateWasm(imports, receive) {
				const instance = new WebAssembly.Instance(compiled, imports);
				receive(instance, compiled);
				return instance.exports;
			},
			getPreloadedPackage: () => payload['picat.data'].slice().buffer,
			locateFile: (name) => {
				if (name === 'picat.wasm' || name === 'picat.data') return name;
				throw new Error(`Unverified Picat asset request: ${name}`);
			},
			stdin,
			stdout: stdout.byte,
			stderr: stderr.byte,
			print: stdout.line,
			printErr: stderr.line
		});
		module.FS.getStream(0).stream_ops.read = stdin.read;
		module.FS.mkdirTree('/workspace');
		for (const file of data.workspaceFiles || []) {
			const p = workspacePath(file.path);
			module.FS.mkdirTree(p.slice(0, p.lastIndexOf('/')));
			module.FS.writeFile(p, file.content);
		}
		const active = workspacePath(data.activePath || 'main.pi');
		module.FS.mkdirTree(active.slice(0, active.lastIndexOf('/')));
		module.FS.writeFile(active, data.code);
		// This is the official browser bridge's entry filename. The user's source is unchanged.
		module.FS.writeFile('/user_code.pi', data.code);
		module.FS.chdir('/workspace');
		phase = 'execute';
		self.postMessage({ type: 'execution-ready' });
		let status;
		try {
			module.ccall('browser_boot', null, ['string'], ['/lib2']);
			status = module.ccall('browser_rerun', 'number');
		} finally {
			flushOutput();
			stdout.flush(true);
			stderr.flush(true);
		}
		if (status !== 1) throw new Error(`Picat goal failed (status ${status})`);
		self.postMessage({ results: true });
	} catch (error) {
		self.postMessage({
			error: error?.message || String(error),
			failure: {
				name: error?.name || 'Error',
				message: error?.message || String(error),
				runtimeId: 'PICAT',
				code: error?.code || 'runtime',
				phase,
				...(error?.code === 'resource-limit'
					? { resource: error.resource, actual: error.actual, limit: error.limit }
					: {})
			}
		});
	} finally {
		if (moduleUrl) URL.revokeObjectURL(moduleUrl);
	}
};
