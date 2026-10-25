// Browser process host for the unmodified upstream Lean Wasm. All language handlers live in Wasm.
// This file is copied verbatim into the published SDK by scripts/build.mjs.
const LIBRARY_ROOT = '/lean/lib/lean';
// The SDK supervisor owns physical pthread Workers so disposal never depends on
// this process's synchronous callMain returning to its JavaScript event loop.
const threads = new Map();
let nextThreadId = 0;
globalThis.Worker = class {
	constructor(url) {
		this.id = ++nextThreadId;
		threads.set(this.id, this);
		self.postMessage({ thread: { type: 'create', id: this.id, url: String(url) } });
	}
	postMessage(data) {
		self.postMessage({ thread: { type: 'post', id: this.id, data } });
	}
	terminate() {
		threads.delete(this.id);
		self.postMessage({ thread: { type: 'terminate', id: this.id } });
	}
};
function unpackLibrary(payload) {
	const index = JSON.parse(
		new TextDecoder().decode(new Uint8Array(payload['lean-init.index.json']))
	);
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

self.onmessage = async ({ data }) => {
	if (data.threadEvent) {
		const event = data.threadEvent;
		const thread = threads.get(event.id);
		if (event.error) thread?.onerror?.({ message: event.error });
		else thread?.onmessage?.({ data: event.data });
		return;
	}
	try {
		let exited = false;
		const onExit = (code) => {
			if (!exited) {
				exited = true;
				self.postMessage({ exit: code });
			}
		};
		const { default: createLean } = await import(/* @vite-ignore */ data.glueUrl);
		const lean = await createLean({
			noInitialRun: true,
			onExit,
			lspProcessExit: onExit,
			lspStdin: data.stdin,
			wasmMemory: new WebAssembly.Memory({
				initial: 4096,
				maximum: data.maxMemoryBytes / 65536,
				shared: true
			}),
			mainScriptUrlOrBlob: data.glueUrl,
			instantiateWasm(imports, receive) {
				WebAssembly.instantiate(data.wasmModule, imports).then((instance) =>
					receive(instance, data.wasmModule)
				);
				return {};
			},
			locateFile: (name) => {
				throw new Error('Unexpected unverified Lean file: ' + name);
			},
			print: (text) => self.postMessage({ stderr: text }),
			printErr: (text) => self.postMessage({ stderr: text })
		});
		for (const fd of [1, 2]) {
			const stream = lean.FS.getStream(fd);
			stream.stream_ops = {
				...stream.stream_ops,
				write(_stream, buffer, offset, length) {
					if (length)
						self.postMessage(
							fd === 1
								? {
										stdout: Uint8Array.from(
											buffer.subarray(offset, offset + length)
										)
									}
								: {
										stderr: new TextDecoder().decode(
											Uint8Array.from(
												buffer.subarray(offset, offset + length)
											)
										)
									}
						);
					return length;
				}
			};
		}
		lean.FS.mkdirTree('/lean/bin');
		lean.FS.mkdirTree('/workspace');
		lean.FS.mkdirTree('/etc');
		// A real UTC TZif file is required by upstream IO time handling.
		lean.FS.writeFile(
			'/etc/localtime',
			Uint8Array.from([
				84, 90, 105, 102, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
				0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0,
				85, 84, 67, 0, 84, 90, 105, 102, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
				0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 4,
				0, 0, 0, 0, 0, 0, 85, 84, 67, 0, 10, 85, 84, 67, 48, 10
			])
		);
		for (const file of unpackLibrary(data.library)) {
			const path = LIBRARY_ROOT + '/' + file.path;
			lean.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
			// Copy into this process: a document's #eval must never modify the shared source pack.
			lean.FS.writeFile(path, file.bytes);
		}
		lean.FS.chdir('/workspace');
		self.postMessage({ ready: true });
		const code = lean.callMain(data.args);
		onExit(code);
	} catch (error) {
		self.postMessage({ error: String(error), stack: error?.stack });
	}
};
