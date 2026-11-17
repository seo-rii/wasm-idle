// This host runs the official DartPad Worker and DDC runtime without changing Dart source.
const distribution = {
	schemaVersion: 1,
	implementation: 'Official DartPad DDC compiler and web runtime',
	version: '3.14.0',
	revision: 'fa8c1270c374c1346931583a17c3b7f278d3822d',
	archive: {
		url: 'https://storage.googleapis.com/dart-archive/channels/stable/release/3.14.0/dartpad/dartpad.zip',
		bytes: 40359128,
		sha256: 'a47fad5844f91cfce800a20e2b3442847bf56b3332892cf8000b2abd0dd8a5f9'
	},
	license: {
		expression: 'BSD-3-Clause',
		url: 'https://raw.githubusercontent.com/dart-lang/sdk/fa8c1270c374c1346931583a17c3b7f278d3822d/LICENSE',
		bytes: 1502,
		sha256: '2cfa3ee8e7512e6d44c854b986510810fadc815f93f890373b3a81c1b6ccd256'
	},
	assets: {
		'worker.js': {
			bytes: 21747,
			sha256: '84d633a69e12f96cb61a46aac4f95e664cd9d779875665795ab701e80892dd21'
		},
		'worker.wasm': {
			bytes: 9758441,
			sha256: 'a7cab6f3036ad024adb6f5b77443735a527b2d736eb05f0877ac501577e9675e'
		},
		'sdk.tar': {
			bytes: 8898048,
			sha256: '4a4ee87add3d2436ff79d4960ac7d702d5a829c864ffae9d944ce58bee8b5038'
		},
		'dart_sdk.js': {
			bytes: 10255930,
			sha256: '1fe31df35edc19e06ff959742b356afa47dbf6f741a17040e01551914deb1afa'
		},
		'sandbox_runtime.js': {
			bytes: 255573,
			sha256: '805095f4c6ef2ffaab2b04ecaf25a3ed4f206d7bb40b6d3608aa7c4db6f8e26c'
		},
		'sandbox.js': {
			bytes: 20297,
			sha256: '4597a7d53d45235e36982fb385998d5a71d6abd09f0b24040a76919c8a624451'
		},
		'version.json': {
			bytes: 200,
			sha256: '794a62e3dc4c5da09eef15b794a2d4d1dc86fb20c3cb3505625a1e58483df06d'
		}
	}
};
const hostSource =
	"// Host bindings for the original Dart DDC compiler. No user source is translated.\nimport 'dart:async';\nimport 'dart:convert';\nimport 'dart:io';\nimport 'dart:js_interop';\nimport 'dart:typed_data';\nimport '__WASM_IDLE_USER_ENTRYPOINT__' as program;\n\n@JS('__wasmIdleDartReadByte')\nexternal int _readByte();\n@JS('__wasmIdleDartReadChunk')\nexternal JSUint8Array? _readChunk();\n@JS('__wasmIdleDartWrite')\nexternal void _write(JSUint8Array bytes, int stream);\n@JS('__wasmIdleDartArgs')\nexternal JSArray<JSString> _args();\n@JS('__wasmIdleDartStarted')\nexternal void _started();\n@JS('__wasmIdleDartFinished')\nexternal void _finished(int code);\n\nfinal class _HostExit implements Exception {\n  final int code;\n  _HostExit(this.code);\n}\n\nfinal class _HostStdin extends Stream<List<int>> implements Stdin {\n  bool _listened = false;\n\n  @override\n  int readByteSync() => _readByte();\n\n  @override\n  String? readLineSync({Encoding encoding = utf8, bool retainNewlines = false}) {\n    final bytes = <int>[];\n    while (true) {\n      final byte = readByteSync();\n      if (byte < 0) break;\n      bytes.add(byte);\n      if (byte == 10) break;\n    }\n    if (bytes.isEmpty) return null;\n    if (!retainNewlines && bytes.last == 10) {\n      bytes.removeLast();\n      if (bytes.isNotEmpty && bytes.last == 13) bytes.removeLast();\n    }\n    return (encoding is SystemEncoding ? utf8 : encoding).decode(bytes);\n  }\n\n  @override\n  StreamSubscription<List<int>> listen(void Function(List<int>)? onData,\n      {Function? onError, void Function()? onDone, bool? cancelOnError}) {\n    if (_listened) throw StateError('stdin has already been listened to');\n    _listened = true;\n    late StreamController<List<int>> controller;\n    Timer? next;\n    bool cancelled = false;\n    bool paused = false;\n    void pump() {\n      if (cancelled || paused) return;\n      try {\n        final chunk = _readChunk();\n        if (chunk == null) {\n          controller.close();\n        } else {\n          controller.add(chunk.toDart);\n          next = Timer(Duration.zero, pump);\n        }\n      } catch (error, stack) {\n        controller.addError(error, stack);\n        controller.close();\n      }\n    }\n    controller = StreamController<List<int>>(onListen: () {\n      scheduleMicrotask(pump);\n    }, onPause: () {\n      paused = true;\n      next?.cancel();\n    }, onResume: () {\n      paused = false;\n      next = Timer(Duration.zero, pump);\n    }, onCancel: () {\n      cancelled = true;\n      next?.cancel();\n    });\n    return controller.stream.listen(onData,\n        onError: onError, onDone: onDone, cancelOnError: cancelOnError);\n  }\n\n  @override\n  bool get hasTerminal => false;\n  @override\n  bool get supportsAnsiEscapes => false;\n  @override\n  dynamic noSuchMethod(Invocation invocation) =>\n      throw UnsupportedError('Dart browser stdin: ${invocation.memberName}');\n}\n\nfinal class _HostStdout implements Stdout {\n  final int stream;\n  @override\n  Encoding encoding = utf8;\n  _HostStdout(this.stream);\n\n  @override\n  void add(List<int> data) => _write(Uint8List.fromList(data).toJS, stream);\n  @override\n  void write(Object? object) => add(encoding.encode('$object'));\n  @override\n  void writeln([Object? object = '']) => write('$object\\n');\n  @override\n  void writeAll(Iterable objects, [String separator = '']) =>\n      write(objects.join(separator));\n  @override\n  void writeCharCode(int charCode) => write(String.fromCharCode(charCode));\n  @override\n  Future<void> addStream(Stream<List<int>> stream) async {\n    await for (final data in stream) {\n      add(data);\n    }\n  }\n\n  @override\n  Future<void> flush() async {}\n  @override\n  Future<void> close() async {}\n  @override\n  Future<void> get done async {}\n  @override\n  bool get hasTerminal => false;\n  @override\n  bool get supportsAnsiEscapes => false;\n  @override\n  dynamic noSuchMethod(Invocation invocation) =>\n      throw UnsupportedError('Dart browser stdout: ${invocation.memberName}');\n}\n\nFuture<void> main() async {\n  final output = _HostStdout(1);\n  final errors = _HostStdout(2);\n  _started();\n  try {\n    await runZoned(() async {\n      await IOOverrides.runZoned(() async {\n        Function entry = program.main;\n        final arguments = _args().toDart.map((value) => value.toDart).toList();\n        final result = entry is dynamic Function(List<String>)\n            ? entry(arguments)\n            : Function.apply(entry, const []);\n        if (result is Future) await result;\n      }, stdin: () => _HostStdin(), stdout: () => output, stderr: () => errors,\n          exit: (code) => throw _HostExit(code));\n    }, zoneSpecification: ZoneSpecification(\n      print: (self, parent, zone, line) => output.writeln(line),\n    ));\n    _finished(0);\n  } on _HostExit catch (exit) {\n    _finished(exit.code);\n  } catch (error, stack) {\n    errors.writeln(error);\n    errors.writeln(stack);\n    _finished(1);\n  }\n}\n";
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
