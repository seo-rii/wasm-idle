// Synced with the reviewed wasm-llvm ECL receipts; this source is never fetched at run time.
const COMMONLISP_LOCK = __WASM_IDLE_COMMONLISP_ASSET_LOCK__;
const PAGE_BYTES = 65536;
const INITIAL_MEMORY_BYTES = 64 * 1024 * 1024;
const MAXIMUM_MEMORY_PAGES = 32768;

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
		throw new Error('Common Lisp interactive stdin requires the shared streaming channel.');
	}
	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, 16, channel.capacity);
	const readByte = (blocking = true) => {
		flush();
		while (true) {
			if (Atomics.load(control, 3) === 1)
				throw new Error('Common Lisp streaming stdin was cancelled.');
			const write = Atomics.load(control, 0),
				read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > channel.capacity)
				throw new Error('Common Lisp stdin ring is corrupt.');
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

function createBoundedMemory(maxBytes) {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < INITIAL_MEMORY_BYTES) {
		const error = new Error(
			`Common Lisp requires at least ${INITIAL_MEMORY_BYTES} bytes of Wasm memory.`
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
	return new WebAssembly.Memory({
		initial: INITIAL_MEMORY_BYTES / PAGE_BYTES,
		maximum: Math.min(MAXIMUM_MEMORY_PAGES, Math.floor(maxBytes / PAGE_BYTES))
	});
}

async function verifyPayload(payload) {
	if (
		!payload ||
		payload.fingerprint !== COMMONLISP_LOCK.assets['producer-receipt.json'].sha256
	) {
		throw new Error('Common Lisp verified preflight payload is missing or stale.');
	}
	// The host decompressed ecl.wasm.gz; the worker re-verifies the logical bytes it executes.
	const receipts = {
		'producer-receipt.json': COMMONLISP_LOCK.assets['producer-receipt.json'],
		'ecl.mjs': COMMONLISP_LOCK.assets['ecl.mjs'],
		'ecl.wasm': COMMONLISP_LOCK.runtime['ecl.wasm']
	};
	for (const [name, receipt] of Object.entries(receipts)) {
		const bytes = payload[name];
		if (
			!(bytes instanceof Uint8Array) ||
			bytes.byteLength !== receipt.bytes ||
			bytes.byteOffset !== 0 ||
			bytes.buffer.byteLength !== bytes.byteLength
		) {
			throw new Error(
				`Common Lisp ${name} verified bytes are missing or have the wrong size.`
			);
		}
		const hash = Array.from(
			new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
			(value) => value.toString(16).padStart(2, '0')
		).join('');
		if (hash !== receipt.sha256) throw new Error(`Common Lisp ${name} SHA-256 mismatch.`);
	}
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
		throw new Error('Common Lisp workspace path is invalid.');
	}
	return `/workspace/${value}`;
}

// LOAD the program with the upstream reader/evaluator. Unhandled conditions are printed and
// end the process, so ECL never enters its interactive debugger and never consumes stdin.
// Script-style defaults: nested LOADs of workspace files stay quiet unless the program opts in.
function loadForm(file) {
	return (
		'(progn (setq *load-verbose* nil *compile-verbose* nil)' +
		' (handler-bind ((serious-condition (lambda (c)' +
		' (ignore-errors (finish-output *standard-output*))' +
		' (format *error-output* "~&;;; Unhandled ~a: ~a~%" (type-of c) c)' +
		' (finish-output *error-output*) (ext:quit 1))))' +
		` (load ${JSON.stringify(file)} :verbose nil :print nil)` +
		' (finish-output *standard-output*) (ext:quit 0)))'
	);
}

function conditionSummary(stderr) {
	const lines = stderr.split('\n');
	const index = lines.findIndex((line) => line.startsWith(';;; Unhandled '));
	if (index === -1) return '';
	return lines
		.slice(index)
		.join('\n')
		.replace(/^;;; Unhandled /u, '')
		.trim();
}

let used = false;
self.onmessage = async ({ data }) => {
	if (!data?.run) return;
	let moduleUrl;
	let phase = 'startup';
	try {
		if (used) throw new Error('Common Lisp requires a fresh Worker for each invocation.');
		used = true;
		if (data.args?.length)
			throw new Error('The Common Lisp runtime does not support program arguments.');
		await verifyPayload(data.runtimePreflight);
		const payload = data.runtimePreflight;
		const wasmMemory = createBoundedMemory(data.limits?.maxWasmMemoryBytes);
		const mainModule = await WebAssembly.compile(payload['ecl.wasm']);
		const memoryImports = WebAssembly.Module.imports(mainModule).filter(
			(entry) => entry.kind === 'memory'
		);
		if (
			memoryImports.length !== 1 ||
			memoryImports[0].module !== 'env' ||
			memoryImports[0].name !== 'memory'
		) {
			throw new Error('ECL module must import the bounded env.memory.');
		}
		let stderrText = '';
		const stdout = createOutput('stdout');
		const stderr = createOutput('stderr', (text) => {
			stderrText += text.slice(0, Math.max(0, 65536 - stderrText.length));
		});
		const flushOutput = () => {
			stdout.flush();
			stderr.flush();
		};
		const stdin = data.stdinChannel
			? createSharedStdinReader(data.stdinChannel, flushOutput)
			: createBufferedStdinReader(data.stdin);
		moduleUrl = URL.createObjectURL(
			new Blob([payload['ecl.mjs']], { type: 'text/javascript' })
		);
		const { default: createEcl } = await import(moduleUrl);
		const ecl = await createEcl({
			noInitialRun: true,
			wasmBinary: payload['ecl.wasm'],
			wasmMemory,
			instantiateWasm(imports, receive) {
				if (imports.env.memory !== wasmMemory)
					throw new Error('ECL ignored the bounded memory.');
				const instance = new WebAssembly.Instance(mainModule, imports);
				receive(instance, mainModule);
				return instance.exports;
			},
			locateFile: (name) => {
				if (name === 'ecl.wasm') return name;
				throw new Error(`Unverified Common Lisp asset request: ${name}`);
			},
			stdin,
			stdout: stdout.byte,
			stderr: stderr.byte,
			print: stdout.line,
			printErr: stderr.line
		});
		ecl.FS.getStream(0).stream_ops.read = stdin.read;
		ecl.FS.mkdirTree('/workspace');
		for (const file of data.workspaceFiles || []) {
			const filePath = workspacePath(file.path);
			ecl.FS.mkdirTree(filePath.slice(0, filePath.lastIndexOf('/')));
			ecl.FS.writeFile(filePath, file.content);
		}
		const activePath = data.activePath || 'main.lisp';
		const active = workspacePath(activePath);
		ecl.FS.mkdirTree(active.slice(0, active.lastIndexOf('/')));
		ecl.FS.writeFile(active, data.code);
		ecl.FS.chdir('/workspace');
		phase = 'execute';
		self.postMessage({ type: 'execution-ready' });
		let exitCode;
		try {
			exitCode = ecl.callMain(['--norc', '--eval', loadForm(activePath)]);
		} catch (error) {
			if (error?.name === 'ExitStatus' && Number.isInteger(error.status))
				exitCode = error.status;
			else if (error instanceof RangeError && /call stack/u.test(error.message)) {
				throw Object.assign(
					new Error(
						'Common Lisp stack overflow: the program recursed deeper than the browser call stack allows.'
					),
					{ code: 'runtime' }
				);
			} else throw error;
		} finally {
			flushOutput();
			stdout.flush(true);
			stderr.flush(true);
		}
		self.postMessage({
			evidence: {
				protocol: 'wasm-idle-commonlisp-evidence-v1',
				implementation: 'ECL',
				version: COMMONLISP_LOCK.version,
				producerRevision: COMMONLISP_LOCK.producerRevision,
				wasmSha256: COMMONLISP_LOCK.runtime['ecl.wasm'].sha256,
				initialMemoryBytes: INITIAL_MEMORY_BYTES,
				maximumMemoryBytes:
					Math.min(
						MAXIMUM_MEMORY_PAGES,
						Math.floor(data.limits.maxWasmMemoryBytes / PAGE_BYTES)
					) * PAGE_BYTES,
				finalMemoryBytes: wasmMemory.buffer.byteLength,
				exitCode
			}
		});
		if (exitCode !== 0) {
			const condition = conditionSummary(stderrText);
			throw Object.assign(
				new Error(
					condition
						? `Unhandled Common Lisp condition: ${condition}`
						: `Common Lisp exited with status ${exitCode}.`
				),
				{ code: 'runtime' }
			);
		}
		self.postMessage({ results: true });
	} catch (error) {
		const memoryFailure =
			error?.code === 'resource-limit' ||
			/Maximum memory size exceeded|Aborted\(OOM\)|Cannot enlarge memory/u.test(
				String(error?.message || error)
			);
		self.postMessage({
			error: error instanceof Error ? error.message : String(error),
			failure: {
				name: error?.name || 'Error',
				message: error?.message || String(error),
				runtimeId: 'COMMONLISP',
				code: memoryFailure ? 'resource-limit' : error?.code || 'runtime',
				phase: error?.phase || phase,
				...(memoryFailure
					? {
							resource: 'wasm-memory',
							actual: error?.actual,
							limit: error?.limit ?? data?.limits?.maxWasmMemoryBytes
						}
					: {})
			}
		});
	} finally {
		if (moduleUrl) URL.revokeObjectURL(moduleUrl);
	}
};
