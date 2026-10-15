// Real SDK/Bash execution only; no public Container fd/VFS adapter is installed.
const children = new Set();
const NativeWorker = globalThis.Worker;
globalThis.Worker = class extends NativeWorker {
	constructor(...args) {
		super(...args);
		children.add(this);
		this.addEventListener('error', (event) => postMessage({
			type: 'threadError', error: event.message
		}));
	}
	terminate() {
		children.delete(this);
		super.terminate();
	}
};
let running = false;
let backendCompleted = false;
const sha256 = async (bytes) => Array.from(
	new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
	(byte) => byte.toString(16).padStart(2, '0')
).join('');

globalThis.onmessage = async ({ data }) => {
	if (data.type === 'cleanup') {
		const requestedWorkerTerminations = children.size;
		for (const child of [...children]) child.terminate();
		postMessage({
			type: 'ownerCleanup',
			backendCompleted,
			requestedWorkerTerminations,
			remainingTrackedChildren: children.size
		});
		return;
	}
	if (data.type !== 'run' || running) return;
	running = true;
	try {
		if (!crossOriginIsolated) throw new Error('Cross-origin isolation is required');
		if (!(data.sdkModule instanceof WebAssembly.Module))
			throw new TypeError('Caller-provided verified SDK Module required');
		if (!(data.sdkMemory instanceof WebAssembly.Memory) ||
			!(data.sdkMemory.buffer instanceof SharedArrayBuffer))
			throw new TypeError('Caller-provided shared Memory required');
		const sdk = await import(data.sdkUrl);
		await sdk.init({
			module: data.sdkModule,
			memory: data.sdkMemory,
			sdkUrl: data.sdkUrl,
			workerUrl: data.sdkWorkerUrl
		});
		postMessage({ type: 'sdkInitialized', trackedChildren: children.size });
		const runtime = new sdk.Runtime({ registry: null });
		const pkg = await sdk.Wasmer.fromFile(new Uint8Array(data.bashWebc), runtime);
		const directory = new sdk.Directory({
			'probe.wasm': new Uint8Array(data.probeWasm),
			'cwd.wasm': new Uint8Array(data.cwdWasm),
			'env-count.wasm': new Uint8Array(data.envCountWasm)
		});
		await directory.createDir('/sub');
		await directory.writeFile('/sub/marker', 'real-cwd\n');
		const command = pkg.entrypoint;
		const bashBytes = command.binary();
		const bashWasmSha256 = await sha256(bashBytes);
		if (bashWasmSha256 !== data.bashWasmSha256)
			throw new Error('Actual Bash executable identity mismatch');
		const bashModule = await WebAssembly.compile(bashBytes);
		const instance = await command.run({
			args: ['--noprofile', '--norc', '-c', data.fixture.script],
			cwd: '/workspace',
			env: { G0: 'space 한글', PATH: '/workspace:/usr/bin:/bin' },
			mount: { '/workspace': directory },
			stdin: new Uint8Array(data.fixture.stdin ?? [])
		});
		postMessage({ type: 'started', trackedChildren: children.size });
		const result = await instance.wait();
		backendCompleted = true;
		const files = {};
		for (const file of data.fixture.readFiles ?? []) {
			try { files[file] = Array.from(await directory.readFile(file)); }
			catch (error) { files[file] = { error: String(error) }; }
		}
		// Do not terminate Workers before the host observes actual backend completion.
		postMessage({
			type: 'result', backendCompleted,
			result: {
				code: result.code,
				stdout: Array.from(result.stdoutBytes),
				stderr: Array.from(result.stderrBytes)
			},
			files, bashWasmSha256,
			bashImports: WebAssembly.Module.imports(bashModule),
			trackedWorkersAtBackendCompletion: children.size,
			publicApi: {
				runtime: Object.getOwnPropertyNames(sdk.Runtime.prototype),
				directory: Object.getOwnPropertyNames(sdk.Directory.prototype)
			}
		});
	} catch (error) {
		postMessage({
			type: 'failure', backendCompleted,
			error: String(error), stack: error?.stack,
			trackedChildren: children.size
		});
	}
};
