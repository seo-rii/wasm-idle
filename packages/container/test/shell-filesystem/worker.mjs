// Trusted owner: actual SDK/Bash, the container Supervisor and one common filesystem.
// Bash's /workspace is the container VFS through Directory.fromHostFileSystem; its exec of a
// registered path reaches createHostCommandHandler through the SDK registry.
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
// The native file at each path only satisfies Bash's own command search. It
// starts with NUL, so neither WASIX nor Bash can run it as Wasm or a script.
const placeholder = new TextEncoder().encode('\0host-command path placeholder\n');
const textual = (bytes) => new TextDecoder('utf-8', { fatal: false }).decode(bytes);

globalThis.onmessage = async ({ data }) => {
	if (data.type === 'cleanup') {
		const requestedWorkerTerminations = children.size;
		for (const child of [...children]) child.terminate();
		postMessage({
			type: 'ownerCleanup', backendCompleted, requestedWorkerTerminations,
			remainingTrackedChildren: children.size
		});
		return;
	}
	if (data.type !== 'run' || running) return;
	running = true;
	let container;
	try {
		if (!crossOriginIsolated) throw new Error('Cross-origin isolation is required');
		if (!(data.sdkModule instanceof WebAssembly.Module))
			throw new TypeError('Caller-provided verified SDK Module required');
		if (!(data.sdkMemory instanceof WebAssembly.Memory) ||
			!(data.sdkMemory.buffer instanceof SharedArrayBuffer))
			throw new TypeError('Caller-provided shared Memory required');
		const sdk = await import(data.sdkUrl);
		await sdk.init({
			module: data.sdkModule, memory: data.sdkMemory,
			sdkUrl: data.sdkUrl, workerUrl: data.sdkWorkerUrl
		});
		postMessage({ type: 'sdkInitialized', trackedChildren: children.size });
		// Direct modules: the package root also exports the verified asset loader,
		// whose @wasm-idle/core dependency is not part of this probe.
		const { createContainer } = await import(data.containerUrl);
		const { createHostCommandHandler } = await import(data.hostCommandUrl);
		const { createShellFilesystem } = await import(data.shellFilesystemUrl);
		const { createLiveWasiAdapter } = await import(data.liveAdapterUrl);
		container = createContainer({
			adapters: [createLiveWasiAdapter({ maxBlockedIoMs: 30000 })],
			maxProcesses: 16,
			commands: {
				tool: { adapter: 'wasi-preview1-live', bytes: new Uint8Array(data.liveWasm) },
				probe: { adapter: 'wasi-preview1-live', bytes: new Uint8Array(data.commandWasm) }
			}
		});
		const invocations = [], records = [];
		const bridge = createHostCommandHandler(container, {
			routes: { '/opt/host/bin/tool': { command: 'tool' }, '/opt/host/bin/probe': { command: 'probe' } },
			onRecord: (record) => records.push(JSON.parse(JSON.stringify(record)))
		});
		const observe = (invocation) => {
			invocations.push({
				path: invocation.path, argv: [...invocation.argv], cwd: invocation.cwd,
				env: invocation.env.map(textual),
				frozen: Object.isFrozen(invocation),
				descriptors: [invocation.stdin, invocation.stdout, invocation.stderr]
					.map((descriptor) => descriptor?.fd ?? null),
				owner: 'sdk-scheduler-thread'
			});
		};
		const runtime = new sdk.Runtime({ registry: null });
		for (const path of ['/opt/host/bin/tool', '/opt/host/bin/probe'])
			runtime.registerHostCommand(path, (invocation) => { observe(invocation); return bridge(invocation); });
		// Trusted editor-style changes made directly to the container VFS while Bash runs.
		const encoder = new TextEncoder();
		const writeAll = async (descriptor, bytes) => {
			for (let offset = 0; offset < bytes.length;) offset += await descriptor.write(bytes.subarray(offset));
		};
		runtime.registerHostCommand('/opt/host/bin/edit', async (invocation) => {
			observe(invocation);
			const [, operation, first, second] = invocation.argv;
			const path = (name) => name.startsWith('/') ? name : `${invocation.cwd}/${name}`;
			try {
				if (operation === 'unlink') container.fs.unlink(path(first));
				else if (operation === 'rename') container.fs.rename(path(first), path(second));
				else if (operation === 'replace-dir') { container.fs.unlink(path(first)); container.fs.mkdir(path(first)); }
				else if (operation === 'write') container.fs.writeFile(path(first), encoder.encode(second));
				else if (operation === 'cat') await writeAll(invocation.stdout, container.fs.readFile(path(first)));
				else throw new Error(`unknown edit operation ${operation}`);
				return 0;
			} catch (error) {
				await writeAll(invocation.stderr, encoder.encode(`edit: ${error.code ?? error.message}\n`));
				return 1;
			}
		});
		const pkg = await sdk.Wasmer.fromFile(new Uint8Array(data.bashWebc), runtime);
		const workspace = sdk.Directory.fromHostFileSystem(createShellFilesystem(container.fs));
		const hostBin = new sdk.Directory({ tool: placeholder, probe: placeholder, edit: placeholder });
		const command = pkg.entrypoint;
		const bashBytes = command.binary();
		const bashWasmSha256 = await sha256(bashBytes);
		if (bashWasmSha256 !== data.bashWasmSha256)
			throw new Error('Actual Bash executable identity mismatch');
		const instance = await command.run({
			args: ['--noprofile', '--norc', '-c', data.fixture.script],
			cwd: '/workspace',
			env: { G0: 'space 한글', PATH: '/opt/host/bin:/usr/bin:/bin' },
			mount: { '/workspace': workspace, '/opt/host/bin': hostBin },
			stdin: new Uint8Array(data.fixture.stdin ?? [])
		});
		postMessage({ type: 'started', trackedChildren: children.size });
		const result = await instance.wait();
		backendCompleted = true;
		const containerFiles = {};
		for (const file of data.fixture.readContainerFiles ?? []) {
			try { containerFiles[file] = Array.from(container.fs.readFile(file)); }
			catch (error) { containerFiles[file] = { error: String(error.code ?? error) }; }
		}
		const containerProcesses = (await container.inspect()).processes;
		await container.dispose();
		postMessage({
			type: 'result', backendCompleted,
			result: {
				code: result.code,
				stdout: Array.from(result.stdoutBytes),
				stderr: Array.from(result.stderrBytes)
			},
			containerFiles, invocations, records, containerProcesses, bashWasmSha256,
			trackedWorkersAtBackendCompletion: children.size,
			publicApi: {
				runtime: Object.getOwnPropertyNames(sdk.Runtime.prototype),
				directory: Object.getOwnPropertyNames(sdk.Directory),
				hostCommandDescriptor: Object.getOwnPropertyNames(sdk.HostCommandDescriptor?.prototype ?? {})
			}
		});
	} catch (error) {
		await container?.dispose().catch(() => {});
		postMessage({
			type: 'failure', backendCompleted,
			error: String(error), stack: error?.stack,
			trackedChildren: children.size
		});
	}
};
