// Synced with the reviewed compiler receipts; this source is never fetched at run time.
const LFORTRAN_LOCK = {"schemaVersion":1,"profileId":"lfortran-llvm-emscripten-ab867a2-v2","source":"ab867a23029b0c1b1c3131b5a0e2363709be37f0","version":"0.65.0-97-gab867a23","assets":{"producer-receipt.json":{"bytes":6932,"sha256":"11c9baef85c5221440edc4462690312cda62b48998a133b9a397ce32c6a97c45"},"lfortran.js":{"bytes":968283,"sha256":"348d5472c307da2bae15eb73e8a38da0e7c2a4cfaebacbccbee2b163806a59c3"},"lfortran.wasm":{"bytes":80662569,"sha256":"b7c8ef4e942e9965a511b8700955c47c1f48d4ef18c61953a4847a6dcd680181"},"lfortran.data":{"bytes":179758,"sha256":"6d6dbe72e4f23f9761eb8005c8a737490750f54dbb173c6455a9c9cb9489c99f"}}};
const PAGE_BYTES = 65536;
const INITIAL_MEMORY_BYTES = 128 * 1024 * 1024;

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
		throw new Error('LFortran READ requires the shared streaming stdin channel.');
	}
	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, 16, channel.capacity);
	const readByte = (blocking = true) => {
		flush();
		while (true) {
			if (Atomics.load(control, 3) === 1)
				throw new Error('LFortran streaming stdin was cancelled.');
			const write = Atomics.load(control, 0),
				read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > channel.capacity)
				throw new Error('LFortran stdin ring is corrupt.');
			if (available > 0) {
				const value = bytes[read % channel.capacity];
				Atomics.store(control, 1, read + 1);
				return value;
			}
			if (Atomics.load(control, 2) === 1) return null;
			if (!blocking) return undefined;
			self.postMessage({ type: 'stdin-request' });
			// EOF/cancel may notify between the flag check and wait. Recheck even
			// if that notification arrived before we actually entered the wait.
			Atomics.wait(control, 0, write, 100);
		}
	};
	// Emscripten's default device read fills the entire libc request byte by
	// byte. Return available bytes as a short read so a prompt after READ can
	// appear before the caller sends the next line or EOF.
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
			`LFortran requires at least ${INITIAL_MEMORY_BYTES} bytes of Wasm memory.`
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
		maximum: Math.min(32768, Math.floor(maxBytes / PAGE_BYTES))
	});
}

async function verifyPayload(payload) {
	if (!payload || payload.fingerprint !== LFORTRAN_LOCK.assets['producer-receipt.json'].sha256) {
		throw new Error('LFortran verified preflight payload is missing or stale.');
	}
	for (const [name, receipt] of Object.entries(LFORTRAN_LOCK.assets)) {
		const bytes = payload[name];
		if (
			!(bytes instanceof Uint8Array) ||
			bytes.byteLength !== receipt.bytes ||
			bytes.byteOffset !== 0 ||
			bytes.buffer.byteLength !== bytes.byteLength
		) {
			throw new Error(`LFortran ${name} verified bytes are missing or have the wrong size.`);
		}
		const hash = Array.from(
			new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
			(value) => value.toString(16).padStart(2, '0')
		).join('');
		if (hash !== receipt.sha256) throw new Error(`LFortran ${name} SHA-256 mismatch.`);
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
			pending.push(value);
			if (value === 10 || pending.length >= 4096) flush();
		},
		line(value) {
			flush();
			emit(`${value}\n`);
		},
		flush
	};
}

function reportDiagnostics(stderr) {
	let message;
	for (const line of stderr.split('\n')) {
		const header = line.match(
			/^(?:(?:semantic|syntax|code generation) )?(error|warning):\s*(.*)$/i
		);
		if (header)
			message = { severity: header[1].toLowerCase(), message: header[2], lineNumber: 1 };
		const location = line.match(/^\s*-->\s+(.+):(\d+):(\d+)\s*$/);
		if (location && message) {
			self.postMessage({
				diagnostic: {
					...message,
					fileName: location[1].replace(/^\/workspace\//, ''),
					lineNumber: Number(location[2]),
					columnNumber: Number(location[3])
				}
			});
			message = undefined;
		}
	}
	if (message) self.postMessage({ diagnostic: message });
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
		throw new Error('LFortran workspace path is invalid.');
	}
	return `/workspace/${value}`;
}

let used = false;
self.onmessage = async ({ data }) => {
	if (!data?.run) return;
	let moduleUrl;
	try {
		if (used) throw new Error('LFortran requires a fresh Worker for each invocation.');
		used = true;
		if (data.args?.length)
			throw new Error('This LFortran evaluator does not support program arguments.');
		await verifyPayload(data.runtimePreflight);
		const payload = data.runtimePreflight;
		const wasmMemory = createBoundedMemory(data.limits?.maxWasmMemoryBytes);
		const mainModule = await WebAssembly.compile(payload['lfortran.wasm']);
		const memoryImports = WebAssembly.Module.imports(mainModule).filter(
			(entry) => entry.kind === 'memory'
		);
		if (
			memoryImports.length !== 1 ||
			memoryImports[0].module !== 'env' ||
			memoryImports[0].name !== 'memory'
		) {
			throw new Error('LFortran main module must import the bounded env.memory.');
		}
		let stderrText = '';
		const stdout = createOutput('stdout');
		const stderr = createOutput('stderr', (text) => {
			stderrText += text.slice(0, Math.max(0, 65536 - stderrText.length));
		});
		const stdin = createSharedStdinReader(data.stdinChannel, () => {
			stdout.flush();
			stderr.flush();
		});
		moduleUrl = URL.createObjectURL(
			new Blob([payload['lfortran.js']], { type: 'text/javascript' })
		);
		const { default: createLFortran } = await import(moduleUrl);
		const compiler = await createLFortran({
			noInitialRun: true,
			noExitRuntime: true,
			wasmBinary: payload['lfortran.wasm'],
			wasmMemory,
			instantiateWasm(imports, receive) {
				if (imports.env.memory !== wasmMemory)
					throw new Error('LFortran ignored the bounded memory.');
				const instance = new WebAssembly.Instance(mainModule, imports);
				receive(instance, mainModule);
				return instance.exports;
			},
			// Both the main module and generated side modules import this bounded memory.
			getPreloadedPackage: () => payload['lfortran.data'].buffer,
			locateFile: (name) => {
				if (name === 'lfortran.data' || name === 'lfortran.wasm') return name;
				throw new Error(`Unverified LFortran asset request: ${name}`);
			},
			stdin,
			stdout: stdout.byte,
			stderr: stderr.byte,
			print: stdout.line,
			printErr: stderr.line
		});
		compiler.FS.getStream(0).stream_ops.read = stdin.read;
		compiler.FS.mkdirTree('/workspace');
		for (const file of data.workspaceFiles || []) {
			const filePath = workspacePath(file.path);
			compiler.FS.mkdirTree(filePath.slice(0, filePath.lastIndexOf('/')));
			compiler.FS.writeFile(filePath, file.content);
		}
		const active = workspacePath(data.activePath || 'main.f90');
		compiler.FS.mkdirTree(active.slice(0, active.lastIndexOf('/')));
		compiler.FS.writeFile(active, data.code);
		compiler.FS.chdir('/workspace');
		self.postMessage({
			progress: { percent: 0.3, stage: 'Compiling and executing with LFortran LLVM' }
		});
		// The producer evaluator compiles and invokes the generated program in one call.
		let exitCode;
		try {
			exitCode = compiler.callMain([active]);
		} catch (error) {
			if (error?.name === 'ExitStatus' && Number.isInteger(error.status))
				exitCode = error.status;
			else throw error;
		} finally {
			stdout.flush(true);
			stderr.flush(true);
		}
		reportDiagnostics(stderrText);
		const generated = [];
		const generatedFiles = [];
		function collect(directory, depth = 0) {
			if (depth > 4) return;
			for (const name of compiler.FS.readdir(directory)) {
				if (name === '.' || name === '..') continue;
				const path = `${directory}/${name}`;
				const info = compiler.FS.stat(path);
				if (compiler.FS.isDir(info.mode)) collect(path, depth + 1);
				else if (/^__lfortran_evaluate_.*\.(?:o|wasm)$/.test(name))
					generatedFiles.push({ name, path });
			}
		}
		collect('/tmp');
		for (const { name, path } of generatedFiles) {
			const bytes = compiler.FS.readFile(path);
			const sha256 = Array.from(
				new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
				(value) => value.toString(16).padStart(2, '0')
			).join('');
			const memoryImports = name.endsWith('.wasm')
				? WebAssembly.Module.imports(await WebAssembly.compile(bytes)).filter(
						(entry) => entry.kind === 'memory'
					)
				: [];
			if (
				name.endsWith('.wasm') &&
				(memoryImports.length !== 1 ||
					memoryImports[0].module !== 'env' ||
					memoryImports[0].name !== 'memory')
			) {
				throw new Error('LFortran side module did not import the shared env.memory.');
			}
			generated.push({ name, bytes: bytes.length, sha256, memoryImports });
		}
		if (
			exitCode === 0 &&
			(!generated.some((file) => file.name.endsWith('.o')) ||
				!generated.some((file) => file.name.endsWith('.wasm')))
		) {
			throw new Error(
				'LFortran returned success without an LLVM object and generated Wasm module.'
			);
		}
		self.postMessage({
			evidence: {
				protocol: 'wasm-idle-lfortran-evidence-v1',
				source: LFORTRAN_LOCK.source,
				compilerSha256: LFORTRAN_LOCK.assets['lfortran.wasm'].sha256,
				initialMemoryBytes: INITIAL_MEMORY_BYTES,
				maximumMemoryBytes:
					Math.min(32768, Math.floor(data.limits.maxWasmMemoryBytes / PAGE_BYTES)) *
					PAGE_BYTES,
				finalMemoryBytes: wasmMemory.buffer.byteLength,
				importedBoundedMemory: true,
				generated,
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
				runtimeId: 'LFORTRAN',
				code: error?.code || 'runtime',
				phase: error?.phase || 'execute',
				resource: error?.resource,
				actual: error?.actual,
				limit: error?.limit
			}
		});
	} finally {
		if (moduleUrl) URL.revokeObjectURL(moduleUrl);
	}
};
