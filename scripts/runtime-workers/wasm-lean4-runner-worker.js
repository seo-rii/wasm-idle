// Synced with the reviewed wasm-llvm lean-browser receipts; this source is never fetched at run time.
const LEAN4_LOCK = __WASM_IDLE_LEAN4_ASSET_LOCK__;
const PAGE_BYTES = 65536;
const INITIAL_MEMORY_BYTES = 256 * 1024 * 1024;
const MAX_PAGES = 65536;
const LIBRARY_ROOT = '/lean/lib/lean';
const WORKSPACE = '/workspace';

function createSharedStdinReader(channel, flush = () => {}) {
	if (
		!channel ||
		channel.protocol !== 'wasm-idle-static-stdin-ring' ||
		channel.protocolVersion !== 1 ||
		channel.controlBytes !== 16 ||
		!Number.isSafeInteger(channel.capacity) ||
		channel.capacity < 1 ||
		typeof SharedArrayBuffer !== 'function' ||
		!(channel.buffer instanceof SharedArrayBuffer) ||
		channel.buffer.byteLength !== 16 + channel.capacity ||
		typeof Atomics.wait !== 'function'
	) {
		throw new Error('Lean stdin requires the shared streaming stdin channel.');
	}
	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, 16, channel.capacity);
	const readByte = (blocking = true) => {
		flush();
		while (true) {
			if (Atomics.load(control, 3) === 1)
				throw new Error('Lean streaming stdin was cancelled.');
			const write = Atomics.load(control, 0),
				read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > channel.capacity)
				throw new Error('Lean stdin ring is corrupt.');
			if (available > 0) {
				const value = bytes[read % channel.capacity];
				Atomics.store(control, 1, read + 1);
				return value;
			}
			if (Atomics.load(control, 2) === 1) return null;
			if (!blocking) return undefined;
			self.postMessage({ type: 'stdin-request' });
			// EOF/cancel may notify between the flag check and wait; recheck after a bounded wait.
			Atomics.wait(control, 0, write, 100);
		}
	};
	// Return the bytes that are already available as a short read, so `getLine` completes as soon
	// as a line arrives instead of waiting for the whole libc buffer to fill.
	readByte.read = (stream, buffer, offset, length) => {
		let count = 0;
		while (count < length) {
			const value = readByte(count === 0);
			if (value === null || value === undefined) break;
			buffer[offset + count++] = value;
			if (value === 10) break;
		}
		if (count) stream.node.atime = Date.now();
		return count;
	};
	return readByte;
}

function createBoundedMemory(maxBytes) {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < INITIAL_MEMORY_BYTES) {
		const error = new Error(
			`Lean requires at least ${INITIAL_MEMORY_BYTES} bytes of Wasm memory.`
		);
		Object.assign(error, {
			code: 'resource-limit',
			resource: 'wasm-memory',
			actual: INITIAL_MEMORY_BYTES,
			limit: maxBytes,
			phase: 'execute'
		});
		throw error;
	}
	// The pthread build requires shared memory; the maximum enforces the configured limit.
	return new WebAssembly.Memory({
		initial: INITIAL_MEMORY_BYTES / PAGE_BYTES,
		maximum: Math.min(MAX_PAGES, Math.floor(maxBytes / PAGE_BYTES)),
		shared: true
	});
}

const hex = (buffer) =>
	Array.from(new Uint8Array(buffer), (value) => value.toString(16).padStart(2, '0')).join('');

async function inflate(bytes, expected, name) {
	const output = new Uint8Array(expected.bytes);
	let offset = 0;
	const reader = new Blob([bytes])
		.stream()
		.pipeThrough(new DecompressionStream('gzip'))
		.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (offset + value.byteLength > output.byteLength) {
			await reader.cancel();
			throw new Error(`Lean ${name} inflates beyond its receipt.`);
		}
		output.set(value, offset);
		offset += value.byteLength;
	}
	if (offset !== output.byteLength) throw new Error(`Lean ${name} inflates to the wrong size.`);
	return output;
}

/** Re-verify delivered bytes against the bundled lock and return the logical (decoded) files. */
async function verifyPayload(payload) {
	if (!payload || payload.fingerprint !== LEAN4_LOCK.assets['producer-receipt.json'].sha256) {
		throw new Error('Lean verified preflight payload is missing or stale.');
	}
	const logical = {};
	for (const [name, receipt] of Object.entries(LEAN4_LOCK.assets)) {
		const delivered = payload[name];
		if (!(delivered instanceof Uint8Array) || delivered.byteLength !== receipt.bytes)
			throw new Error(`Lean ${name} verified bytes are missing or have the wrong size.`);
		if (hex(await crypto.subtle.digest('SHA-256', delivered)) !== receipt.sha256)
			throw new Error(`Lean ${name} SHA-256 mismatch.`);
		let bytes = delivered;
		if (receipt.encoding === 'gzip') {
			bytes = await inflate(delivered, receipt.uncompressed, name);
			if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== receipt.uncompressed.sha256)
				throw new Error(`Lean ${name} decoded SHA-256 mismatch.`);
		}
		logical[receipt.logicalName || name] = bytes;
	}
	return logical;
}

function unpackLibrary(payload) {
	const index = JSON.parse(new TextDecoder().decode(payload['lean-init.index.json']));
	const chunks = index.chunks.map((chunk) => {
		const bytes = payload[chunk.path.replace(/\.gz$/, '')];
		if (!(bytes instanceof Uint8Array) || bytes.byteLength !== chunk.uncompressedBytes)
			throw new Error(`Lean library chunk ${chunk.path} is missing.`);
		return { ...chunk, bytes };
	});
	const files = [];
	for (const file of index.files) {
		if (!/^Init(\/[A-Za-z0-9_]+)*\.(olean(\.server|\.private)?|ir(\.sig)?)$/.test(file.path))
			throw new Error(`Lean library entry ${file.path} is invalid.`);
		const parts = [];
		for (const chunk of chunks) {
			const start = Math.max(file.offset, chunk.offset);
			const end = Math.min(file.offset + file.bytes, chunk.offset + chunk.uncompressedBytes);
			if (start < end)
				parts.push(chunk.bytes.subarray(start - chunk.offset, end - chunk.offset));
		}
		let bytes = parts[0] || new Uint8Array();
		if (parts.length > 1) {
			bytes = new Uint8Array(file.bytes);
			let offset = 0;
			for (const part of parts) {
				bytes.set(part, offset);
				offset += part.byteLength;
			}
		}
		if (bytes.byteLength !== file.bytes)
			throw new Error(`Lean library entry ${file.path} is truncated.`);
		files.push({ path: file.path, bytes });
	}
	return files;
}

function createOutput(stream, transform = (text) => text) {
	const decoder = new TextDecoder();
	const pending = [];
	let line = '';
	const emit = (text) => {
		if (!text) return;
		line += text;
		const end = line.lastIndexOf('\n');
		if (end < 0 && line.length < 4096) return;
		const ready = end < 0 ? line : line.slice(0, end + 1);
		line = end < 0 ? '' : line.slice(end + 1);
		self.postMessage({ output: transform(ready), stream });
	};
	const flush = (final = false) => {
		emit(decoder.decode(Uint8Array.from(pending), { stream: !final }));
		pending.length = 0;
		if (line) {
			self.postMessage({ output: transform(line), stream });
			line = '';
		}
	};
	return {
		byte(value) {
			pending.push(value);
			if (value === 10 || pending.length >= 4096) {
				emit(decoder.decode(Uint8Array.from(pending), { stream: true }));
				pending.length = 0;
			}
		},
		line(value) {
			emit(`${decoder.decode(Uint8Array.from(pending), { stream: true })}${value}\n`);
			pending.length = 0;
		},
		flush
	};
}

// Lean prints elaboration messages as `<file>:<line>:<column>: <severity>[(<code>)]: <message>`.
const DIAGNOSTIC = /^\/workspace\/(.+?):(\d+):(\d+): (error|warning|info)(?:\([^)]*\))?: ?(.*)$/;

function createDiagnostics() {
	let current;
	let count = 0;
	const finish = () => {
		if (!current) return;
		if (count++ < 1000) self.postMessage({ diagnostic: current });
		current = undefined;
	};
	const transformLine = (value) => {
		const match = value.match(DIAGNOSTIC);
		if (match) {
			finish();
			current = {
				fileName: match[1],
				lineNumber: Number(match[2]),
				columnNumber: Number(match[3]) + 1,
				severity: match[4] === 'info' ? 'other' : match[4],
				message: match[5]
			};
			return value.slice(WORKSPACE.length + 1);
		}
		// Messages continue on following lines until a blank line or the next message.
		if (current && value) current.message = `${current.message}\n${value}`;
		else if (!value) finish();
		return value;
	};
	return {
		/** Strip the virtual workspace prefix and collect structured diagnostics from whole lines. */
		transform(text) {
			const lines = text.split('\n');
			const tail = lines.pop();
			return [...lines.map(transformLine), tail].join('\n');
		},
		finish
	};
}

function workspacePath(value) {
	if (
		typeof value !== 'string' ||
		!value ||
		value.startsWith('/') ||
		value.includes('\\') ||
		value.split('/').some((part) => part === '..' || part === '.' || !part) ||
		value.includes('\0')
	) {
		throw new Error('Lean workspace path is invalid.');
	}
	return `${WORKSPACE}/${value}`;
}

let used = false;
self.onmessage = async ({ data }) => {
	if (!data?.run) return;
	let moduleUrl;
	try {
		if (used) throw new Error('Lean requires a fresh Worker for each invocation.');
		used = true;
		const args = data.args || [];
		if (
			!Array.isArray(args) ||
			args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))
		)
			throw new Error('Lean program arguments must be strings.');
		self.postMessage({ progress: { percent: 0.18, stage: 'Verifying the Lean 4 toolchain' } });
		const payload = await verifyPayload(data.runtimePreflight);
		self.postMessage({ progress: { percent: 0.24, stage: 'Preparing the Lean 4 library' } });
		const library = unpackLibrary(payload);
		const wasmMemory = createBoundedMemory(data.limits?.maxWasmMemoryBytes);
		const diagnostics = createDiagnostics();
		const stdout = createOutput('stdout', diagnostics.transform);
		const stderr = createOutput('stderr', diagnostics.transform);
		const stdin = createSharedStdinReader(data.stdinChannel, () => {
			stdout.flush();
			stderr.flush();
		});
		moduleUrl = URL.createObjectURL(
			new Blob([payload['lean.mjs']], { type: 'text/javascript' })
		);
		const { default: createLean } = await import(moduleUrl);
		let exitCode;
		const lean = await createLean({
			noInitialRun: true,
			wasmBinary: payload['lean.wasm'],
			wasmMemory,
			// Emscripten pthread Workers load the same verified module from this Blob URL.
			mainScriptUrlOrBlob: moduleUrl,
			// Emscripten resolves the Wasm name eagerly; the verified wasmBinary is used instead.
			locateFile: (name) => {
				if (name === 'lean.wasm') return name;
				throw new Error(`Unverified Lean asset request: ${name}`);
			},
			stdin,
			stdout: stdout.byte,
			stderr: stderr.byte,
			print: stdout.line,
			printErr: stderr.line,
			onExit: (status) => {
				exitCode = status;
			}
		});
		lean.FS.getStream(0).stream_ops.read = stdin.read;
		// `IO.appPath` reports /lean/bin/lean; Lean resolves its library relative to that directory.
		lean.FS.mkdirTree('/lean/bin');
		for (const file of library) {
			const target = `${LIBRARY_ROOT}/${file.path}`;
			lean.FS.mkdirTree(target.slice(0, target.lastIndexOf('/')));
			lean.FS.writeFile(target, file.bytes, { canOwn: true });
		}
		lean.FS.mkdirTree(WORKSPACE);
		for (const file of data.workspaceFiles || []) {
			const filePath = workspacePath(file.path);
			lean.FS.mkdirTree(filePath.slice(0, filePath.lastIndexOf('/')));
			lean.FS.writeFile(filePath, file.content);
		}
		const active = workspacePath(data.activePath || 'Main.lean');
		lean.FS.mkdirTree(active.slice(0, active.lastIndexOf('/')));
		lean.FS.writeFile(active, data.code);
		lean.FS.chdir(WORKSPACE);
		self.postMessage({
			progress: { percent: 0.3, stage: 'Elaborating and running with Lean 4' }
		});
		try {
			// `lean --run` elaborates the file with the upstream frontend and interprets `main`.
			exitCode = lean.callMain(['-j1', '--run', active, ...args]);
		} catch (error) {
			if (error?.name === 'ExitStatus' && Number.isInteger(error.status))
				exitCode = error.status;
			else throw error;
		} finally {
			stdout.flush(true);
			stderr.flush(true);
			diagnostics.finish();
		}
		self.postMessage({
			evidence: {
				protocol: 'wasm-idle-lean4-evidence-v1',
				leanVersion: LEAN4_LOCK.version,
				leanCommit: LEAN4_LOCK.source,
				wasmSha256: LEAN4_LOCK.assets['lean.wasm.gz.bin'].uncompressed.sha256,
				libraryFiles: library.length,
				finalMemoryBytes: wasmMemory.buffer.byteLength,
				exitCode
			}
		});
		self.postMessage({ results: exitCode === 0 });
	} catch (error) {
		self.postMessage({
			error: error instanceof Error ? error.message : String(error),
			failure: {
				name: error?.name || 'Error',
				message: error?.message || String(error),
				runtimeId: 'LEAN4',
				code: error?.code || 'runtime',
				phase: error?.phase || 'execute',
				resource: error?.resource,
				actual: error?.actual,
				limit: error?.limit
			}
		});
	} finally {
		// Pthread Workers were started from this URL and are torn down with the runtime.
		if (moduleUrl) URL.revokeObjectURL(moduleUrl);
	}
};
