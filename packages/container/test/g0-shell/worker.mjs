// Experimental runtime group. Nothing in this file is a public container adapter.
const children = new Set();
const NativeWorker = globalThis.Worker;
globalThis.Worker = class extends NativeWorker {
	constructor(...args) {
		super(...args);
		children.add(this);
		this.addEventListener('message', (event) => {
			if (event.data?.type === 'g0Syscall') {
				event.stopImmediatePropagation();
				postMessage(event.data);
			}
		});
	}
	terminate() {
		children.delete(this);
		super.terminate();
	}
};
const abort = new AbortController();
const bytes = async (url) =>
	new Uint8Array(
		await (
			await fetch(url, { signal: abort.signal, credentials: 'omit', redirect: 'error' })
		).arrayBuffer()
	);
let activeInput;
globalThis.onmessage = async ({ data }) => {
	if (data.type === 'cancel') {
		abort.abort();
		for (const child of [...children]) child.terminate();
		postMessage({ type: 'cancelled', remainingTrackedWorkers: children.size });
		return;
	}
	if (data.type !== 'run') return;
	try {
		if (data.traceSyscalls) {
			const { installSyscallTrace } = await import('/syscall-trace.mjs');
			installSyscallTrace((entry) => postMessage(entry));
		}
		const sdkBytes = await bytes('/sdk/index.mjs');
		const sdkUrl = URL.createObjectURL(new Blob([sdkBytes], { type: 'text/javascript' }));
		const sdk = await import(sdkUrl);
		const workerUrl = URL.createObjectURL(
			new Blob(
				[
					`
${
	data.traceSyscalls
		? `import { installSyscallTrace } from '${location.origin}/syscall-trace.mjs';
installSyscallTrace((entry) => postMessage(entry));
const NativeWorker = globalThis.Worker;
globalThis.Worker = class extends NativeWorker {
  constructor(...args) {
    super(...args);
    this.addEventListener('message', (event) => {
      if (event.data?.type === 'g0Syscall') {
        event.stopImmediatePropagation();
        postMessage(event.data);
      }
    });
  }
};`
		: ''
}
let thread; const queue = [];
onmessage = async ({data}) => {
  if (data?.type === 'init') {
    const sdk = await import(${JSON.stringify(sdkUrl)});
    await sdk.init({ module: data.module, memory: data.memory, sdkUrl: location.origin + '/sdk/index.mjs' });
    thread = new sdk.ThreadPoolWorker(data.id);
    for (const message of queue.splice(0)) await thread.handle(message);
  } else if (thread) await thread.handle(data); else queue.push(data);
};`
				],
				{ type: 'text/javascript' }
			)
		);
		await sdk.init({
			module: await bytes('/sdk/wasmer.wasm'),
			sdkUrl: location.origin + '/sdk/index.mjs',
			workerUrl
		});
		const runtime = new sdk.Runtime({ registry: null });
		if (data.slowDownload) postMessage({ type: 'downloadPending' });
		const pkg = await sdk.Wasmer.fromFile(
			await bytes(data.slowDownload ? '/slow-bash.webc' : '/bash.webc'),
			runtime
		);
		const probe = await bytes('/probe.wasm');
		const directory = new sdk.Directory({
			'probe.wasm': probe,
			'cwd.wasm': await bytes('/cwd.wasm')
		});
		if (data.clang) {
			await directory.writeFile('/clang', await bytes('/clang.wasm'));
			await directory.writeFile('/main.c', 'int f(void) { return 1; }\n');
		}
		await directory.writeFile(
			'/bridge.wasm',
			sdk.wat2wasm(
				'(module (import "container" "dispatch" (func $dispatch)) (memory (export "memory") 1) (func (export "_start") call $dispatch))'
			)
		);
		await directory.createDir('/sub');
		await directory.writeFile('/sub/marker', 'real-cwd\n');
		const command = pkg.entrypoint;
		const bashBytes = command.binary();
		const bashModule = await WebAssembly.compile(bashBytes);
		const instance = await command.run({
			args: ['--noprofile', '--norc', '-c', data.script],
			cwd: '/workspace',
			env: { G0: 'space 한글', PATH: '/workspace:/usr/bin:/bin' },
			mount: { '/workspace': directory },
			...(data.interactive ? {} : { stdin: new Uint8Array(data.stdin ?? []) })
		});
		if (data.interactive) activeInput = instance.stdin?.getWriter();
		postMessage({ type: 'started', trackedWorkers: children.size });
		const drain = async (stream, name) => {
			const reader = stream.getReader();
			const chunks = [];
			for (;;) {
				const { done, value } = await reader.read();
				if (done) return chunks.flat();
				chunks.push(Array.from(value));
				postMessage({ type: 'output', stream: name, bytes: Array.from(value) });
			}
		};
		const stdout = data.cancel ? drain(instance.stdout, 'stdout') : undefined;
		const stderr = data.cancel ? drain(instance.stderr, 'stderr') : undefined;
		const result = await instance.wait();
		const files = {};
		for (const path of data.readFiles ?? []) {
			try {
				files[path] = Array.from(await directory.readFile(path));
			} catch (error) {
				files[path] = { error: String(error) };
			}
		}
		let artifactReturnValue;
		if (data.id === 'G0-CLANG-LINK' && Array.isArray(files['/hello.wasm'])) {
			const artifact = await WebAssembly.instantiate(new Uint8Array(files['/hello.wasm']));
			artifactReturnValue = artifact.instance.exports.f();
		}
		const trackedWorkersBeforeCleanup = children.size;
		for (const child of [...children]) child.terminate();
		postMessage({
			type: 'result',
			result: {
				code: result.code,
				stdout: stdout ? await stdout : Array.from(result.stdoutBytes),
				stderr: stderr ? await stderr : Array.from(result.stderrBytes)
			},
			files,
			bashImports: WebAssembly.Module.imports(bashModule),
			bashWasmSha256: Array.from(
				new Uint8Array(await crypto.subtle.digest('SHA-256', bashBytes)),
				(byte) => byte.toString(16).padStart(2, '0')
			).join(''),
			publicApi: {
				runtime: Object.getOwnPropertyNames(sdk.Runtime.prototype),
				instance: Object.getOwnPropertyNames(sdk.Instance.prototype),
				directory: Object.getOwnPropertyNames(sdk.Directory.prototype)
			},
			trackedWorkersBeforeCleanup,
			trackedWorkers: children.size,
			...(artifactReturnValue === undefined ? {} : { artifactReturnValue })
		});
	} catch (error) {
		postMessage({ type: 'failure', error: String(error), stack: error?.stack });
	}
};
