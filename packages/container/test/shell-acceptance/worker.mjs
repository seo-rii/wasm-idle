// Trusted owner for the shell acceptance script: actual SDK/Bash, BusyBox, Clang and the
// artifact Clang builds, all on one container filesystem and Supervisor. Bundled with the
// container source by scripts/probe-container-shell-acceptance.mjs.
import {
	createContainer, createContainerPackageManager, createHostCommandHandler, createShellFilesystem,
	validateDistribution
} from '../../src/index.ts';
import { createClangAdapter } from '../../src/adapters/clang/index.ts';
import { createLiveWasiAdapter } from '../../src/adapters/wasi-live/index.ts';
import untar from '../../../llvm-core/runtime/core/src/tar.ts';

const children = new Set();
const NativeWorker = globalThis.Worker;
globalThis.Worker = class extends NativeWorker {
	constructor(...args) {
		super(...args);
		children.add(this);
		this.addEventListener('error', (event) => postMessage({ type: 'threadError', error: event.message }));
	}
	terminate() {
		children.delete(this);
		super.terminate();
	}
};
const encoder = new TextEncoder();
const sha256 = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
	(byte) => byte.toString(16).padStart(2, '0')).join('');
// Satisfies Bash's PATH search only; a NUL first byte is neither Wasm nor a script.
const placeholder = encoder.encode('\0host-command path placeholder\n');
const BIN = '/usr/local/bin', SYSROOT = '/usr/share/wasm-sysroot', TOOLCHAIN = '/opt/toolchains/llvm';
// Applets the shell reaches as commands; echo, printf, pwd, true and false stay Bash builtins.
const BUSYBOX = ['cat', 'cp', 'grep', 'mkdir', 'mv', 'rm'];
let running = false, backendCompleted = false, sequence = 0;
const timeline = [];
// Each mark is also posted at once, so a run that never completes still shows how far it got.
const mark = (entry) => {
	const value = { seq: sequence++, atMs: Math.round(performance.now()), ...entry };
	timeline.push(value);
	postMessage({ type: 'mark', ...value });
};
// A blocked owner event loop shows up as missing heartbeats.
let heartbeat;

globalThis.onmessage = async ({ data }) => {
	if (data.type === 'cleanup') {
		clearInterval(heartbeat);
		const requestedWorkerTerminations = children.size;
		for (const child of [...children]) child.terminate();
		postMessage({ type: 'ownerCleanup', backendCompleted, requestedWorkerTerminations, remainingTrackedChildren: children.size });
		return;
	}
	if (data.type !== 'run' || running) return;
	running = true;
	heartbeat = setInterval(() => postMessage({ type: 'heartbeat', atMs: Math.round(performance.now()) }), 5000);
	let container, manager;
	try {
		if (!crossOriginIsolated) throw new Error('Cross-origin isolation is required');
		if (!(data.sdkModule instanceof WebAssembly.Module)) throw new TypeError('Caller-provided verified SDK Module required');
		if (!(data.sdkMemory instanceof WebAssembly.Memory) || !(data.sdkMemory.buffer instanceof SharedArrayBuffer))
			throw new TypeError('Caller-provided shared Memory required');
		const sdk = await import(data.sdkUrl);
		await sdk.init({ module: data.sdkModule, memory: data.sdkMemory, sdkUrl: data.sdkUrl, workerUrl: data.sdkWorkerUrl });
		postMessage({ type: 'sdkInitialized', trackedChildren: children.size });

		const distribution = await validateDistribution({
			bytes: encoder.encode(data.manifest), expectedSha256: data.manifestSha256,
			adapterIds: ['wasi-preview1-live', 'llvm-clang-tool-host-v1'], allowedAssetURLs: data.assetURLs
		});
		// The loader's own fetch with every check intact; only the request order is recorded.
		const fetch = (input, init) => {
			mark({ type: 'fetch', url: String(input instanceof Request ? input.url : input) });
			return globalThis.fetch(input, init);
		};
		manager = createContainerPackageManager({
			distribution, fetch, capabilities: ['wasi-preview1', 'llvm-tool-host-exec-v1'],
			maxCachedBytes: 192 * 1024 * 1024,
			persistentCache: { enabled: true, namespace: data.cacheNamespace, version: data.manifestSha256, storageReserveBytes: 0 }
		});
		const lookups = Object.fromEntries([...BUSYBOX, 'clang'].map((name) => [name, manager.resolveCommand(name)?.package ?? null]));
		const assetsBeforeShell = manager.inspect().assets;
		container = createContainer({
			packages: manager,
			adapters: [
				createLiveWasiAdapter({ maxBlockedIoMs: 120000, workerFactory: () => new Worker(data.liveWorkerUrl, { type: 'module' }) }),
				createClangAdapter({
					clangSha256: data.clangSha256, linkerSha256: data.linkerSha256, linkerPath: `${TOOLCHAIN}/bin/wasm-ld`,
					workerFactory: () => new Worker(data.clangWorkerUrl, { type: 'module' })
				})
			],
			artifactAdapter: 'wasi-preview1-live', maxMemoryBytes: 2 ** 32, maxBytes: 256 * 1024 * 1024, maxProcesses: 8
		});
		const records = [], invocations = [];
		const handler = createHostCommandHandler(container, {
			routes: {
				...Object.fromEntries(BUSYBOX.map((name) => [`${BIN}/${name}`, { command: name }])),
				// The distribution command's prefixArgs carry the target, sysroot and linker profile.
				[`${BIN}/clang`]: { command: 'clang', stdio: 'forwarded' }
			},
			moduleDirectories: ['/workspace'], timeoutMs: data.commandTimeoutMs,
			onRecord: (record) => records.push(JSON.parse(JSON.stringify({ ...record, result: record.result && {
				code: record.result.code, reason: record.result.reason } })))
		});
		// Fixture step: the pinned sysroot is one verified tar file of the llvm package. It is
		// prepared on the first clang dispatch only, from the same verified bytes.
		let sysroot;
		const prepareSysroot = async () => {
			const prepared = await manager.prepare('llvm');
			const archive = prepared.packages.find((pkg) => pkg.id === 'llvm').files.find((file) => file.path === 'sysroot.tar').bytes;
			const files = [];
			untar(archive, {
				addDirectory(path) { files.push({ path: path.replace(/\/$/u, ''), type: 'directory', mode: 0o555 }); },
				addFile(path, bytes) { files.push({ path, type: 'file', mode: 0o444, data: bytes }); }
			});
			container.fs.mountReadonly(SYSROOT, files);
			return { sha256: await sha256(archive), entries: files.length, files: files.filter((file) => file.type === 'file').length };
		};
		// The owner's interrupt key: stop the foreground command once it is actually running.
		const occurrences = new Map();
		const interruptWhenRunning = async (plan) => {
			const deadline = performance.now() + 120000;
			while (!(await container.inspect()).processes.some((process) => process.state === 'running')) {
				if (performance.now() > deadline) return mark({ type: 'interruptSkipped', path: plan.path });
				await new Promise((done) => setTimeout(done, 20));
			}
			await new Promise((done) => setTimeout(done, plan.delayMs));
			mark({ type: 'interrupt', path: plan.path, interrupted: handler.interrupt() });
		};
		const dispatch = async (invocation) => {
			const occurrence = (occurrences.get(invocation.path) ?? 0) + 1;
			occurrences.set(invocation.path, occurrence);
			const plan = (data.interrupts ?? []).find((entry) => entry.path === invocation.path && entry.occurrence === occurrence);
			if (plan) void interruptWhenRunning(plan);
			invocations.push({ path: invocation.path, argv: [...invocation.argv], cwd: invocation.cwd,
				descriptors: [invocation.stdin, invocation.stdout, invocation.stderr].map((d) => d?.fd ?? null) });
			mark({ type: 'dispatch', path: invocation.path });
			let status;
			try {
				if (invocation.path === `${BIN}/clang`) sysroot ??= prepareSysroot();
				if (invocation.path === `${BIN}/clang`) await sysroot;
				status = await handler(invocation);
			} catch (error) {
				mark({ type: 'dispatchError', path: invocation.path, error: String(error) });
				status = 126;
			}
			mark({ type: 'dispatchEnd', path: invocation.path, status });
			return status;
		};
		const runtime = new sdk.Runtime({ registry: null });
		for (const name of [...BUSYBOX, 'clang']) runtime.registerHostCommand(`${BIN}/${name}`, dispatch);
		runtime.registerHostCommandDirectory('/workspace', dispatch);

		const pkg = await sdk.Wasmer.fromFile(new Uint8Array(data.bashWebc), runtime);
		const command = pkg.entrypoint;
		const bashWasmSha256 = await sha256(command.binary());
		if (bashWasmSha256 !== data.bashWasmSha256) throw new Error('Actual Bash executable identity mismatch');
		const bin = new sdk.Directory(Object.fromEntries([...BUSYBOX, 'clang'].map((name) => [name, placeholder])));
		const workspace = sdk.Directory.fromHostFileSystem(createShellFilesystem(container.fs));
		mark({ type: 'shellStart' });
		const instance = await command.run({
			args: ['--noprofile', '--norc', '-c', data.script], cwd: '/workspace',
			env: { PATH: `${BIN}:/usr/bin:/bin`, HOME: '/workspace', LANG: 'C' },
			mount: { '/workspace': workspace, [BIN]: bin }, stdin: new Uint8Array()
		});
		postMessage({ type: 'started', trackedChildren: children.size });
		const result = await instance.wait();
		backendCompleted = true;
		mark({ type: 'shellEnd', code: result.code });
		const files = {};
		for (const path of data.readFiles) {
			try { files[path] = Array.from(container.fs.readFile(path)); }
			catch (error) { files[path] = { error: String(error.code ?? error) }; }
		}
		const artifact = (() => {
			try { const bytes = container.fs.readFile(data.artifactPath ?? '/workspace/demo/hello.wasm'); return { bytes: bytes.length, magic: Array.from(bytes.subarray(0, 8)) }; }
			catch (error) { return { error: String(error.code ?? error) }; }
		})();
		const containerProcesses = (await container.inspect()).processes;
		const assetsAfterShell = manager.inspect().assets;
		await container.dispose();
		await manager.dispose();
		postMessage({
			type: 'result', backendCompleted,
			result: { code: result.code, stdout: Array.from(result.stdoutBytes), stderr: Array.from(result.stderrBytes) },
			files, artifact, invocations, records, timeline, lookups, assetsBeforeShell, assetsAfterShell,
			sysroot: sysroot ? await sysroot : null, containerProcesses, bashWasmSha256,
			cacheNames: await caches.keys(), trackedWorkersAtBackendCompletion: children.size,
			publicApi: { runtime: Object.getOwnPropertyNames(sdk.Runtime.prototype), directory: Object.getOwnPropertyNames(sdk.Directory) }
		});
	} catch (error) {
		await container?.dispose().catch(() => {});
		await manager?.dispose().catch(() => {});
		postMessage({ type: 'failure', backendCompleted, error: String(error), stack: error?.stack, timeline, trackedChildren: children.size });
	}
};
