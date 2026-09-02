const textEncoder = new TextEncoder();

function assetUrl(baseUrl, path) {
	return new URL(path, baseUrl).href;
}

function postOutput(text) {
	if (text) self.postMessage({ output: text });
}

function createStdinReader(stdin, channel) {
	if (channel === undefined) {
		const bytes = textEncoder.encode(typeof stdin === 'string' ? stdin : '');
		let offset = 0;
		return {
			read(maxLength) {
				const count = Math.min(maxLength, bytes.length - offset);
				if (count <= 0) return new Uint8Array();
				const chunk = bytes.slice(offset, offset + count);
				offset += count;
				return chunk;
			}
		};
	}
	if (
		channel?.protocol !== 'wasm-idle-static-stdin-ring' ||
		channel?.protocolVersion !== 1 ||
		channel?.controlBytes !== 16 ||
		!Number.isSafeInteger(channel?.capacity) ||
		channel.capacity <= 0 ||
		typeof SharedArrayBuffer !== 'function' ||
		!(channel.buffer instanceof SharedArrayBuffer) ||
		channel.buffer.byteLength !== channel.controlBytes + channel.capacity ||
		typeof Atomics.wait !== 'function'
	) {
		throw new Error('Invalid GoAWK streaming stdin channel.');
	}

	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return {
		read(maxLength) {
			if (!Number.isSafeInteger(maxLength) || maxLength <= 0) return new Uint8Array();
			while (true) {
				if (Atomics.load(control, 3) === 1) {
					throw new Error('GoAWK streaming stdin was cancelled.');
				}
				const write = Atomics.load(control, 0);
				const read = Atomics.load(control, 1);
				const available = write - read;
				if (available < 0 || available > bytes.byteLength) {
					throw new Error('GoAWK streaming stdin counters are invalid.');
				}
				if (available > 0) {
					const count = Math.min(maxLength, available);
					const chunk = new Uint8Array(count);
					const start = read % bytes.byteLength;
					const first = Math.min(count, bytes.byteLength - start);
					chunk.set(bytes.subarray(start, start + first));
					if (first < count) chunk.set(bytes.subarray(0, count - first), first);
					Atomics.store(control, 1, read + count);
					self.postMessage({ type: 'stdin-request' });
					return chunk;
				}
				if (Atomics.load(control, 2) === 1) return new Uint8Array();
				self.postMessage({ type: 'stdin-request' });
				Atomics.wait(control, 0, write);
			}
		}
	};
}

function createOutputSink(onText) {
	const decoder = new TextDecoder();
	let finished = false;
	return {
		write(chunk) {
			if (!(chunk instanceof Uint8Array)) {
				throw new Error('GoAWK output sink requires a Uint8Array.');
			}
			const text = decoder.decode(chunk, { stream: true });
			if (text) onText(text);
		},
		finish() {
			if (finished) return;
			finished = true;
			const text = decoder.decode();
			if (text) onText(text);
		}
	};
}

function waitForRunFunction() {
	return new Promise((resolve, reject) => {
		let attempts = 0;
		const tick = () => {
			if (typeof globalThis.wasmIdleRunAwk === 'function') {
				resolve(globalThis.wasmIdleRunAwk);
				return;
			}
			attempts += 1;
			if (attempts > 100) {
				reject(new Error('GoAWK wasm runtime did not initialize.'));
				return;
			}
			setTimeout(tick, 0);
		};
		tick();
	});
}

async function loadRuntime(baseUrl) {
	importScripts(assetUrl(baseUrl, 'wasm_exec.js'));
	const go = new globalThis.Go();
	const response = await fetch(assetUrl(baseUrl, 'goawk.wasm'));
	if (!response.ok) {
		throw new Error(`failed to load GoAWK wasm: ${response.status}`);
	}
	const { instance } = await WebAssembly.instantiate(
		await response.arrayBuffer(),
		go.importObject
	);
	void go.run(instance).catch((error) => {
		console.error('[wasm-idle:awk-worker] Go runtime stopped', error);
	});
	return waitForRunFunction();
}

self.onmessage = async (event) => {
	const { baseUrl, code, args = [], stdin, stdinChannel, log } = event.data || {};
	let stdoutSink;
	let stderrSink;
	try {
		if (log) {
			console.log(`[wasm-idle:awk-worker] run start baseUrl=${baseUrl}`);
		}
		const runAwk = await loadRuntime(baseUrl);
		let result;
		if (stdinChannel === undefined) {
			result = runAwk(String(code || ''), typeof stdin === 'string' ? stdin : '', args);
			postOutput(String(result.stdout || ''));
			postOutput(String(result.stderr || ''));
		} else {
			stdoutSink = createOutputSink(postOutput);
			stderrSink = createOutputSink(postOutput);
			result = runAwk(String(code || ''), createStdinReader(stdin, stdinChannel), args, {
				stdout: (chunk) => stdoutSink.write(chunk),
				stderr: (chunk) => stderrSink.write(chunk)
			});
			stdoutSink.finish();
			stderrSink.finish();
		}
		if (result.error) {
			throw new Error(String(result.error));
		}
		if (Number(result.status || 0) !== 0) {
			throw new Error(`AWK exited with status ${result.status}.`);
		}
		if (log) {
			console.log('[wasm-idle:awk-worker] run settled');
		}
		self.postMessage({ results: true });
	} catch (error) {
		if (log) {
			console.error('[wasm-idle:awk-worker] failed', error);
		}
		self.postMessage({ error: error?.message || String(error) });
	} finally {
		stdoutSink?.finish();
		stderrSink?.finish();
	}
};
