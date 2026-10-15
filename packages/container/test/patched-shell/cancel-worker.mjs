// Experimental forced host-group cancellation, not a public Container adapter or signal API.
const children = new Set();
const NativeWorker = globalThis.Worker;
const abort = new AbortController();
let running = false;
let cleanedUp = false;
let backendCompleted = false;
let hadLockedStdinWriter = false;
let inputWriter;

globalThis.Worker = class extends NativeWorker {
	constructor(...args) {
		super(...args);
		children.add(this);
		this.addEventListener('error', (event) => {
			if (!cleanedUp) postMessage({ type: 'threadError', error: event.message });
		});
	}
	terminate() {
		children.delete(this);
		super.terminate();
	}
};

const sha256 = async (bytes) =>
	Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
		byte.toString(16).padStart(2, '0')
	).join('');

async function downloadBash(asset) {
	if (
		!asset ||
		!Number.isSafeInteger(asset.bytes) ||
		asset.bytes <= 0 ||
		asset.bytes > 8 * 1024 * 1024 ||
		!/^[a-f0-9]{64}$/.test(asset.sha256)
	)
		throw new TypeError('Pinned slow Bash asset identity required');
	const url = new URL(asset.url, location.href);
	if (url.origin !== location.origin || url.username || url.password || url.hash)
		throw new Error('Slow Bash asset must use the approved same origin');
	const response = await fetch(url.href, {
		signal: abort.signal,
		credentials: 'same-origin',
		redirect: 'error'
	});
	if (response.status !== 200 || response.url !== url.href || !response.body)
		throw new Error('Slow Bash asset response did not match its pinned URL');
	const reader = response.body.getReader();
	const chunks = [];
	let receivedBytes = 0;
	let announced = false;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			if (!(value instanceof Uint8Array) || receivedBytes + value.byteLength > asset.bytes)
				throw new Error('Slow Bash response exceeds its pinned byte length');
			if (!value.byteLength) continue;
			chunks.push(Uint8Array.from(value));
			receivedBytes += value.byteLength;
			if (!announced && !cleanedUp) {
				announced = true;
				postMessage({ type: 'downloadPending', receivedBytes, expectedBytes: asset.bytes });
			}
		}
	} finally {
		reader.releaseLock();
	}
	if (receivedBytes !== asset.bytes) throw new Error('Slow Bash asset length mismatch');
	const bytes = new Uint8Array(receivedBytes);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	if ((await sha256(bytes)) !== asset.sha256) throw new Error('Slow Bash asset digest mismatch');
	return bytes;
}

async function readReady(stream) {
	const reader = stream.getReader();
	const expected = new TextEncoder().encode('ready\n');
	const buffer = new Uint8Array(4096);
	let size = 0;
	try {
		while (size < expected.length) {
			const { value, done } = await reader.read();
			if (done) throw new Error('Guest output closed before readiness');
			if (!(value instanceof Uint8Array) || value.byteLength > buffer.length - size)
				throw new Error('Guest readiness exceeds its bounded prefix');
			buffer.set(value, size);
			size += value.byteLength;
		}
		if (size !== expected.length || expected.some((byte, index) => buffer[index] !== byte))
			throw new Error('Guest readiness bytes did not match ready\\n');
		return Array.from(buffer.subarray(0, size));
	} finally {
		// Instance.wait owns subsequent draining. Never hold two readers for its streams.
		reader.releaseLock();
	}
}

globalThis.onmessage = async ({ data }) => {
	if (data.type === 'cleanup') {
		cleanedUp = true;
		abort.abort();
		const requestedWorkerTerminations = children.size;
		for (const child of [...children]) child.terminate();
		postMessage({
			type: 'ownerCleanup',
			backendCompleted,
			requestedWorkerTerminations,
			remainingTrackedChildren: children.size,
			hadLockedStdinWriter,
			scope: 'forced-host-group'
		});
		return;
	}
	if (data.type !== 'run' || running || cleanedUp) return;
	running = true;
	try {
		if (!crossOriginIsolated) throw new Error('Cross-origin isolation is required');
		if (!(data.sdkModule instanceof WebAssembly.Module))
			throw new TypeError('Caller-provided verified SDK Module required');
		if (
			!(data.sdkMemory instanceof WebAssembly.Memory) ||
			!(data.sdkMemory.buffer instanceof SharedArrayBuffer)
		)
			throw new TypeError('Caller-provided shared Memory required');
		const sdk = await import(data.sdkUrl);
		if (cleanedUp) return;
		await sdk.init({
			module: data.sdkModule,
			memory: data.sdkMemory,
			sdkUrl: data.sdkUrl,
			workerUrl: data.sdkWorkerUrl
		});
		if (cleanedUp) return;
		postMessage({ type: 'sdkInitialized', trackedChildren: children.size });
		const runtime = new sdk.Runtime({ registry: null });
		const bashWebc = data.fixture.slowDownload
			? await downloadBash(data.slowBashAsset)
			: new Uint8Array(data.bashWebc);
		if (cleanedUp) return;
		const pkg = await sdk.Wasmer.fromFile(bashWebc, runtime);
		if (cleanedUp) return;
		const directory = new sdk.Directory({ 'probe.wasm': new Uint8Array(data.probeWasm) });
		const command = pkg.entrypoint;
		const bashWasmSha256 = await sha256(command.binary());
		if (bashWasmSha256 !== data.bashWasmSha256)
			throw new Error('Actual Bash executable identity mismatch');
		if (cleanedUp) return;
		const instance = await command.run({
			args: ['--noprofile', '--norc', '-c', data.fixture.script],
			cwd: '/workspace',
			env: { G0: 'space 한글', PATH: '/workspace:/usr/bin:/bin' },
			mount: { '/workspace': directory },
			...(data.fixture.interactive ? {} : { stdin: new Uint8Array() })
		});
		if (cleanedUp) return;
		const input = instance.stdin;
		if (data.fixture.interactive) {
			if (!input) throw new Error('Interactive stdin stream was not supplied');
			inputWriter = input.getWriter();
			hadLockedStdinWriter = Boolean(inputWriter && input.locked);
		}
		postMessage({ type: 'started', trackedChildren: children.size, bashWasmSha256 });
		if (data.fixture.cancel) {
			const bytes = await readReady(instance.stdout);
			if (cleanedUp) return;
			postMessage({ type: 'guestReady', bytes });
		}
		const completion = instance.wait().then((result) => {
			backendCompleted = true;
			return result;
		});
		if (data.fixture.cancel) {
			const outcome = await Promise.race([
				completion.then(() => 'completed'),
				new Promise((resolve) => setTimeout(() => resolve('pending'), 150))
			]);
			if (cleanedUp) return;
			if (outcome !== 'pending' || backendCompleted)
				throw new Error('Guest completed before the cancellation observation');
			postMessage({
				type: 'pendingGuest',
				backendCompleted: false,
				stdinLocked: input?.locked ?? false
			});
			await completion;
			if (!cleanedUp) throw new Error('Guest completed before forced host-group cleanup');
			return;
		}
		const result = await completion;
		if (!cleanedUp)
			postMessage({
				type: 'result',
				backendCompleted,
				result: {
					code: result.code,
					stdout: Array.from(result.stdoutBytes),
					stderr: Array.from(result.stderrBytes)
				}
			});
	} catch (error) {
		if (!cleanedUp)
			postMessage({
				type: 'failure',
				backendCompleted,
				error: String(error),
				stack: error?.stack,
				trackedChildren: children.size
			});
	}
};
