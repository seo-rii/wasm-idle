// This host runs the official DartPad Worker and DDC runtime without changing Dart source.
const distribution = __WASM_IDLE_DART_DISTRIBUTION__;
const hostSource = __WASM_IDLE_DART_HOST__;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let consumed = false;

async function boundedBytes(stream, limit, name) {
	const reader = stream.getReader();
	const chunks = [];
	let length = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > limit) throw new Error(`Dart asset exceeds receipt: ${name}`);
			chunks.push(value);
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
}

async function verifiedAssets(baseUrl, maxBytes) {
	const entries = await Promise.all(
		Object.entries(distribution.assets).map(async ([name, receipt]) => {
			if (receipt.bytes > maxBytes)
				throw new Error(`Dart asset exceeds maxAssetBytes: ${name}`);
			let response = await fetch(new URL(name, baseUrl));
			if (response.status === 404) {
				await response.body?.cancel().catch(() => {});
				response = await fetch(new URL(`${name}.gz`, baseUrl));
			}
			if (!response.ok || !response.body) throw new Error(`Dart asset unavailable: ${name}`);
			let bytes = await boundedBytes(
				response.body,
				Math.min(maxBytes, receipt.bytes + 4096),
				name
			);
			if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
				const decoded = new Blob([bytes])
					.stream()
					.pipeThrough(new DecompressionStream('gzip'));
				bytes = await boundedBytes(decoded, receipt.bytes, name);
			}
			if (bytes.length !== receipt.bytes)
				throw new Error(`Dart asset byte length mismatch: ${name}`);
			const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
				.map((x) => x.toString(16).padStart(2, '0'))
				.join('');
			if (digest !== receipt.sha256) throw new Error(`Dart asset hash mismatch: ${name}`);
			return [name, bytes];
		})
	);
	return new Map(entries);
}

function rpcClient(port) {
	let id = 0;
	const pending = new Map();
	port.onmessage = ({ data }) => {
		if (data === null) return;
		const value = JSON.parse(data.payload);
		const call = pending.get(value.id);
		if (!call) return;
		pending.delete(value.id);
		if (value.error)
			call.reject(
				new Error(
					value.error.message + (value.error.data?.log ? `\n${value.error.data.log}` : '')
				)
			);
		else call.resolve(value.result);
	};
	return (method, params = {}, transferPort) =>
		new Promise((resolve, reject) => {
			const requestId = ++id;
			pending.set(requestId, { resolve, reject });
			port.postMessage(
				{
					payload: JSON.stringify({ jsonrpc: '2.0', method, params, id: requestId }),
					...(transferPort ? { port: transferPort } : {})
				},
				transferPort ? [transferPort] : []
			);
		});
}

// Only the DOM script-loading surface used by upstream sandbox.js is supplied.
// No document or GUI API is exposed to the Dart text-execution profile.
function executionRealm() {
	self.onmessage = async ({ data }) => {
		const { urls, channel, stdin, args, baseUrl } = data;
		const nativeSetTimeout = self.setTimeout.bind(self);
		const nativeClearTimeout = self.clearTimeout.bind(self);
		const nativeSetInterval = self.setInterval.bind(self);
		const nativeClearInterval = self.clearInterval.bind(self);
		const activeTimers = new Set();
		let started = false;
		let finished;
		let reported = false;
		function checkIdle() {
			if (finished === undefined || reported || activeTimers.size) return;
			nativeSetTimeout(() => {
				if (activeTimers.size || reported) return;
				reported = true;
				self.postMessage({ done: finished });
			}, 0);
		}
		self.setTimeout = (callback, delay, ...args) => {
			const tracked = started;
			const handle = nativeSetTimeout(
				(...values) => {
					activeTimers.delete(handle);
					try {
						callback(...values);
					} finally {
						checkIdle();
					}
				},
				delay,
				...args
			);
			if (tracked) activeTimers.add(handle);
			return handle;
		};
		self.clearTimeout = (handle) => {
			activeTimers.delete(handle);
			nativeClearTimeout(handle);
			checkIdle();
		};
		self.setInterval = (callback, delay, ...args) => {
			const handle = nativeSetInterval(callback, delay, ...args);
			if (started) activeTimers.add(handle);
			return handle;
		};
		self.clearInterval = (handle) => {
			activeTimers.delete(handle);
			nativeClearInterval(handle);
			checkIdle();
		};
		const outputDecoders = [new TextDecoder(), new TextDecoder()];
		self.__wasmIdleDartWrite = (bytes, stream) =>
			self.postMessage({
				output: outputDecoders[stream === 2 ? 1 : 0].decode(bytes, { stream: true }),
				stream: stream === 2 ? 'stderr' : 'stdout'
			});
		self.__wasmIdleDartStarted = () => {
			started = true;
			self.postMessage({ started: true });
		};
		self.__wasmIdleDartFinished = (code) => {
			finished = code;
			if (code !== 0) activeTimers.clear();
			checkIdle();
		};
		self.__wasmIdleDartArgs = () => args;
		let inputOffset = 0;
		const initialInput = new TextEncoder().encode(stdin || '');
		const control = channel ? new Int32Array(channel.buffer, 0, 4) : null;
		const buffer = channel
			? new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity)
			: null;
		const range = channel ? Math.floor(2 ** 32 / channel.capacity) * channel.capacity : 0;
		if (
			channel &&
			(channel.protocolVersion !== 2 ||
				channel.controlBytes !== 16 ||
				!(channel.buffer instanceof SharedArrayBuffer) ||
				channel.capacity <= 0 ||
				channel.buffer.byteLength !== 16 + channel.capacity)
		)
			throw new Error('Invalid Dart stdin channel');
		self.__wasmIdleDartReadByte = () => {
			if (!channel)
				return inputOffset < initialInput.length ? initialInput[inputOffset++] : -1;
			while (true) {
				if (Atomics.load(control, 3) === 1) throw new Error('Dart stdin cancelled');
				const write = Atomics.load(control, 0) >>> 0;
				const read = Atomics.load(control, 1) >>> 0;
				const available = (write - read + range) % range;
				if (write >= range || read >= range || available > buffer.length)
					throw new Error('Dart stdin counters invalid');
				if (available) {
					const byte = buffer[read % buffer.length];
					Atomics.store(control, 1, (read + 1) % range);
					return byte;
				}
				if (Atomics.load(control, 2) === 1) return -1;
				self.postMessage({ inputRequested: true });
				Atomics.wait(control, 0, write, 100);
			}
		};
		self.__wasmIdleDartReadChunk = () => {
			const first = self.__wasmIdleDartReadByte();
			if (first < 0) return null;
			const bytes = [first];
			const available = channel
				? ((Atomics.load(control, 0) >>> 0) - (Atomics.load(control, 1) >>> 0) + range) %
					range
				: initialInput.length - inputOffset;
			for (let i = 0; i < Math.min(4095, available); i++)
				bytes.push(self.__wasmIdleDartReadByte());
			return new Uint8Array(bytes);
		};
		self.window = self;
		self.HTMLElement = class {};
		self.parent = { postMessage: (value, _origin, ports) => self.postMessage(value, ports) };
		self.document = {
			currentScript: { src: new URL('sandbox.js', baseUrl).href },
			getElementsByTagName: () => [],
			createElement: () => ({ remove() {} }),
			head: {
				appendChild(script) {
					try {
						importScripts(urls[script.src] || script.src);
						script.onload?.();
					} catch (error) {
						script.onerror?.(error);
					}
				}
			}
		};
		self.addEventListener('error', (event) => self.postMessage({ error: event.message }));
		self.addEventListener('unhandledrejection', (event) =>
			self.postMessage({ error: String(event.reason) })
		);
		importScripts(urls[new URL('sandbox.js', baseUrl).href]);
	};
}

self.onmessage = async ({ data }) => {
	if (!data?.run || consumed) return;
	consumed = true;
	let child;
	const blobs = [];
	const channels = [];
	const nativeFetch = self.fetch.bind(self);
	const blob = (source, type = 'text/javascript') => {
		const url = URL.createObjectURL(new Blob([source], { type }));
		blobs.push(url);
		return url;
	};
	try {
		const baseUrl = new URL(data.baseUrl).href.replace(/\/?$/, '/');
		self.postMessage({
			progress: { percent: 5, stage: 'Loading verified Dart 3.14 compiler' }
		});
		const assets = await verifiedAssets(
			baseUrl,
			Math.min(data.maxAssetBytes || 32 * 1024 * 1024, 32 * 1024 * 1024)
		);
		const runtimeUrls = {};
		for (const name of ['sandbox_runtime.js', 'dart_sdk.js', 'sandbox.js'])
			runtimeUrls[new URL(name, baseUrl).href] = blob(assets.get(name));
		self.fetch = async (url) => {
			const key = [...assets.keys()].find(
				(name) => new URL(name, baseUrl).href === String(url)
			);
			if (!key) throw new Error(`Unexpected Dart compiler fetch: ${String(url)}`);
			return new Response(assets.get(key), {
				headers: {
					'Content-Type': key.endsWith('.wasm')
						? 'application/wasm'
						: 'application/octet-stream'
				}
			});
		};
		let workerSource = decoder.decode(assets.get('worker.js'));
		for (const name of ['sdk.tar', 'worker.wasm'])
			workerSource = workerSource.replace(
				`new URL('./${name}', import.meta.url)`,
				JSON.stringify(new URL(name, baseUrl).href)
			);
		const { Worker: Compiler } = await import(blob(workerSource));
		const compiler = await Compiler.create();
		const { port1, port2 } = new MessageChannel();
		channels.push(port1, port2);
		compiler.session(port2);
		const rpc = rpcClient(port1);
		const version = await rpc('version');
		if (version.dartVersion !== '3.14.0' || version.dartRevision !== distribution.revision)
			throw new Error('Dart compiler identity mismatch');
		const workspace = await rpc('createWorkspace');
		const workspaceId = workspace.workspaceId;
		const write = (path, text) =>
			rpc('workspace/writeFileFromText', { workspaceId, path, text });
		const activePath = data.activePath || 'main.dart';
		if (
			activePath.startsWith('.wasm-idle/') ||
			data.workspaceFiles.some((file) => file.path.startsWith('.wasm-idle/'))
		)
			throw new Error('The .wasm-idle/ host directory is reserved');
		for (const file of data.workspaceFiles || []) await write(file.path, file.content);
		await write(activePath, String(data.code));
		await write(
			'.dart_tool/package_config.json',
			JSON.stringify({
				configVersion: 2,
				packages: [],
				generator: 'wasm-idle',
				generatorVersion: '1'
			})
		);
		const importPath =
			'../' +
			activePath
				.split('/')
				.map((part) => encodeURIComponent(part).replaceAll("'", '%27'))
				.join('/');
		await write(
			'.wasm-idle/entry.dart',
			hostSource.replace('__WASM_IDLE_USER_ENTRYPOINT__', importPath)
		);
		child = new Worker(blob(`(${executionRealm.toString()})();`));
		let resolveCompletion;
		let rejectCompletion;
		const completion = new Promise((resolve, reject) => {
			resolveCompletion = resolve;
			rejectCompletion = reject;
		});
		completion.catch(() => {});
		const sandboxPort = await new Promise((resolve, reject) => {
			child.onerror = (event) => {
				reject(new Error(event.message));
				rejectCompletion(new Error(event.message));
			};
			child.onmessage = ({ data: message }) => {
				if (message.action === 'connect') resolve(message.port);
				else if (message.action === 'error' || message.error) {
					const error = new Error(message.message || message.error);
					reject(error);
					rejectCompletion(error);
				} else if (message.output)
					self.postMessage({ output: message.output, stream: message.stream });
				else if (message.inputRequested) self.postMessage({ type: 'stdin-request' });
				else if (message.started)
					self.postMessage({
						progress: {
							kind: 'ready',
							state: 'running',
							reason: 'started',
							label: 'Dart program started'
						}
					});
				else if (typeof message.done === 'number') resolveCompletion(message.done);
			};
			child.postMessage({
				urls: runtimeUrls,
				channel: data.stdinChannel,
				stdin: data.stdin,
				args: data.args || [],
				baseUrl
			});
		});
		const sandbox = await rpc('workspace/connectSandbox', { workspaceId }, sandboxPort);
		self.postMessage({ progress: { percent: 50, stage: 'Compiling Dart source with DDC' } });
		await rpc('workspace/sandbox/run', {
			workspaceId,
			sandboxId: sandbox.sandboxId,
			path: '.wasm-idle/entry.dart',
			mode: 'console'
		});
		const code = await completion;
		if (code !== 0)
			self.postMessage({
				output: `Dart program exited with code ${code}\n`,
				stream: 'stderr'
			});
		self.postMessage({ results: code === 0 });
	} catch (error) {
		self.postMessage({ output: `${error.message || String(error)}\n`, stream: 'stderr' });
		self.postMessage({ results: false });
	} finally {
		self.fetch = nativeFetch;
		child?.terminate();
		for (const channel of channels) channel.close();
		for (const url of blobs) URL.revokeObjectURL(url);
	}
};
