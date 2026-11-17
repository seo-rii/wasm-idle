// The compiler, chunk parser and language objects are the unchanged Amber distribution.
const smalltalkProfile = __WASM_IDLE_SMALLTALK_PROFILE__;
let smalltalkConsumed = false;

function smalltalkInput(source, channel) {
	if (!channel) {
		const bytes = new TextEncoder().encode(typeof source === 'string' ? source : '');
		let offset = 0;
		return () => (offset < bytes.length ? bytes[offset++] : null);
	}
	if (
		channel.protocol !== 'wasm-idle-static-stdin-ring' ||
		channel.protocolVersion !== 2 ||
		channel.controlBytes !== 16 ||
		!Number.isSafeInteger(channel.capacity) ||
		channel.capacity < 1 ||
		channel.capacity > 2 ** 31 ||
		typeof SharedArrayBuffer !== 'function' ||
		!(channel.buffer instanceof SharedArrayBuffer) ||
		channel.buffer.byteLength !== 16 + channel.capacity
	)
		throw new Error('Invalid Smalltalk stdin ring');
	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, 16, channel.capacity);
	const range = Math.floor(2 ** 32 / channel.capacity) * channel.capacity;
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1) throw new Error('Smalltalk stdin cancelled');
			const write = Atomics.load(control, 0) >>> 0,
				read = Atomics.load(control, 1) >>> 0;
			const available = (write - read + range) % range;
			if (write >= range || read >= range || available > channel.capacity)
				throw new Error('Corrupt Smalltalk stdin ring');
			if (available) {
				const value = bytes[read % channel.capacity];
				Atomics.store(control, 1, (read + 1) % range);
				return value;
			}
			if (Atomics.load(control, 2) === 1) return null;
			self.postMessage({ type: 'stdin-request' });
			Atomics.wait(control, 0, write, 100);
		}
	};
}

function smalltalkPath(value) {
	if (
		typeof value !== 'string' ||
		!value ||
		/[\\\0]/u.test(value) ||
		value.startsWith('/') ||
		value.split('/').some((part) => !part || part === '.' || part === '..')
	)
		throw new Error('Invalid Smalltalk workspace path');
	return value;
}

self.onmessage = async ({ data }) => {
	if (data?.run !== true || smalltalkConsumed) return;
	smalltalkConsumed = true;
	let phase = 'compile';
	let hostFailure;
	const originalConsole = { ...console };
	try {
		const { runtimePreflight: assets, limits } = data;
		if (
			assets?.protocol !== 'wasm-idle-smalltalk-preflight' ||
			assets.profileId !== smalltalkProfile.profileId ||
			typeof data.code !== 'string' ||
			!Array.isArray(data.args) ||
			data.args.some((arg) => typeof arg !== 'string') ||
			!Array.isArray(data.workspaceFiles) ||
			!limits
		)
			throw new Error('Invalid Smalltalk execution payload');
		for (const key of ['maxOutputBytes', 'maxWorkspaceBytes'])
			if (!Number.isSafeInteger(limits[key]) || limits[key] < 1)
				throw new Error('Invalid Smalltalk execution limit');
		const decoder = new TextDecoder('utf-8', { fatal: true });
		for (const [name, receipt] of Object.entries(smalltalkProfile.assets)) {
			const bytes = assets[name];
			if (
				!(bytes instanceof Uint8Array) ||
				bytes.length !== (receipt.uncompressedBytes || receipt.bytes)
			)
				throw new Error('Smalltalk asset length mismatch: ' + name);
			const hash = Array.from(
				new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
				(value) => value.toString(16).padStart(2, '0')
			).join('');
			if (hash !== (receipt.uncompressedSha256 || receipt.sha256))
				throw new Error('Smalltalk asset hash mismatch: ' + name);
		}
		let outputBytes = 0;
		const output = (text, stream = 'stdout') => {
			text = String(text);
			outputBytes += new TextEncoder().encode(text).length;
			if (outputBytes > limits.maxOutputBytes) {
				hostFailure = Object.assign(new Error('Smalltalk output limit exceeded'), {
					code: 'output-limit',
					actual: outputBytes,
					limit: limits.maxOutputBytes
				});
				throw hostFailure;
			}
			if (text) self.postMessage({ output: text, stream });
		};
		console.log = (...values) => output(values.map(String).join(' ') + '\n');
		console.warn = console.error = (...values) =>
			output(values.map(String).join(' ') + '\n', 'stderr');
		const modules = JSON.parse(decoder.decode(assets['amber-modules.json.gz.bin']));
		// The official loader resolves all anonymous AMD definitions and dependencies.
		// Only its transport is replaced: it reads receipt-verified original source strings.
		(0, eval)(decoder.decode(assets['require.js']));
		const loader = globalThis.requirejs;
		loader.load = (context, name) => {
			if (!Object.hasOwn(modules, name) || typeof modules[name] !== 'string')
				throw new Error('Amber module is outside the pinned runtime: ' + name);
			new Function('define', modules[name])(globalThis.define);
			context.completeLoad(name);
		};
		const amber = await new Promise((resolve, reject) =>
			loader(
				['amber/lang'],
				function (runtime) {
					runtime.initialize().then(function () {
						resolve(runtime);
					}, reject);
				},
				reject
			)
		);
		const globals = amber.globals;
		const proxy = (value) => globals.JSObjectProxy._on_(value);
		const readByte = smalltalkInput(data.stdin, data.stdinChannel);
		globals.Stdin = proxy({
			nextLine() {
				const bytes = [];
				let byte;
				while ((byte = readByte()) !== null && byte !== 10) bytes.push(byte);
				if (!bytes.length && byte === null) return null;
				if (bytes.at(-1) === 13 && byte === 10) bytes.pop();
				return new TextDecoder().decode(Uint8Array.from(bytes));
			},
			nextByte: readByte,
			upToEnd() {
				const bytes = [];
				let byte;
				while ((byte = readByte()) !== null) bytes.push(byte);
				return new TextDecoder().decode(Uint8Array.from(bytes));
			}
		});
		for (const [name, stream] of [
			['Stdout', 'stdout'],
			['Stderr', 'stderr']
		]) {
			const sink = {
				nextPutAll(value) {
					output(value, stream);
					return sink;
				},
				cr() {
					output('\n', stream);
					return sink;
				},
				flush() {
					return sink;
				}
			};
			globals[name] = proxy(sink);
		}
		globals.Arguments = data.args;
		const activePath = smalltalkPath(data.activePath || 'main.st');
		const workspace = new Map();
		for (const file of data.workspaceFiles) {
			const name = smalltalkPath(file.path);
			if (typeof file.content !== 'string') throw new Error('Smalltalk files must be text');
			workspace.set(name, file.content);
		}
		workspace.set(activePath, data.code);
		let workspaceBytes = 0;
		for (const text of workspace.values())
			workspaceBytes += new TextEncoder().encode(text).length;
		if (workspaceBytes > limits.maxWorkspaceBytes)
			throw Object.assign(new Error('Smalltalk workspace limit exceeded'), {
				code: 'resource-limit',
				resource: 'workspace-bytes',
				actual: workspaceBytes,
				limit: limits.maxWorkspaceBytes
			});
		const fileText = (path) => {
			path = smalltalkPath(path);
			if (!workspace.has(path))
				throw new Error('Smalltalk workspace file not found: ' + path);
			return workspace.get(path);
		};
		const fileIn = (text) => globals.Importer._new()._import_(text._stream());
		globals.Files = proxy({
			readText: fileText,
			fileIn(path) {
				return fileIn(fileText(path));
			}
		});
		phase = 'execute';
		self.postMessage({ type: 'execution-ready' });
		// Whole files, chunks, methods and class definitions go through the original Importer.
		fileIn(data.code);
		if (hostFailure) throw hostFailure;
		self.postMessage({ results: true });
	} catch (caught) {
		const error = hostFailure || caught;
		let message;
		try {
			message =
				typeof error?._messageText === 'function' ? error._messageText() : error?.message;
		} catch {
			/* Keep the original JavaScript fallback for malformed user exceptions. */
		}
		message = String(message || error);
		self.postMessage({
			error: message,
			failure: {
				name: 'SmalltalkRuntimeError',
				message,
				phase,
				runtimeId: 'SMALLTALK',
				code: error?.code || (phase === 'compile' ? 'compile' : 'runtime'),
				...(error?.code === 'output-limit'
					? { actual: error.actual, limit: error.limit }
					: {}),
				...(error?.resource
					? { resource: error.resource, limit: error.limit, actual: error.actual }
					: {})
			}
		});
	} finally {
		Object.assign(console, originalConsole);
	}
};
self.postMessage({ __wasmIdleStaticWorkerReady: true });
