const encoder = new TextEncoder();

function assetUrl(baseUrl, path) {
	return new URL(path, baseUrl).href;
}

function createSharedStdinReader(channel) {
	if (channel === undefined) return null;
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
		throw new Error('Invalid WebPerl streaming stdin channel.');
	}

	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1) {
				throw new Error('WebPerl streaming stdin was cancelled.');
			}
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('WebPerl streaming stdin counters are invalid.');
			}
			if (available > 0) {
				const value = bytes[read % bytes.byteLength];
				Atomics.store(control, 1, read + 1);
				return value;
			}
			if (Atomics.load(control, 2) === 1) return null;
			self.postMessage({ type: 'stdin-request' });
			Atomics.wait(control, 0, write);
		}
	};
}

function createStdinReader(stdin, channel) {
	const sharedReader = createSharedStdinReader(channel);
	if (sharedReader) return sharedReader;
	const bytes = encoder.encode(typeof stdin === 'string' ? stdin : '');
	let offset = 0;
	return () => {
		if (offset >= bytes.byteLength) return null;
		const value = bytes[offset];
		offset += 1;
		return value;
	};
}

function postOutput(text) {
	if (text) self.postMessage({ output: text });
}

self.onmessage = async (event) => {
	const {
		baseUrl,
		code,
		args = [],
		stdin,
		stdinChannel,
		activePath = 'main.pl',
		log
	} = event.data || {};
	try {
		if (log) {
			console.log(`[wasm-idle:perl-worker] run start baseUrl=${baseUrl}`);
		}
		await new Promise((resolve, reject) => {
			let stdoutBuffer = '';
			let stderrBuffer = '';
			const flushStdout = () => {
				if (!stdoutBuffer) return;
				postOutput(stdoutBuffer);
				stdoutBuffer = '';
			};
			const flushStderr = () => {
				if (!stderrBuffer) return;
				postOutput(stderrBuffer);
				stderrBuffer = '';
			};
			globalThis.Module = {
				noInitialRun: true,
				noExitRuntime: false,
				locateFile(path) {
					return assetUrl(baseUrl, path);
				},
				print(text) {
					postOutput(`${text}\n`);
				},
				printErr(text) {
					postOutput(`${text}\n`);
				},
				stdin: createStdinReader(stdin, stdinChannel),
				stdout(codePoint) {
					if (codePoint === null || codePoint === 10) {
						if (codePoint === 10) stdoutBuffer += '\n';
						flushStdout();
						return;
					}
					stdoutBuffer += String.fromCharCode(codePoint);
				},
				stderr(codePoint) {
					if (codePoint === null || codePoint === 10) {
						if (codePoint === 10) stderrBuffer += '\n';
						flushStderr();
						return;
					}
					stderrBuffer += String.fromCharCode(codePoint);
				},
				onAbort(reason) {
					reject(new Error(String(reason || 'Perl runtime aborted')));
				},
				onRuntimeInitialized() {
					try {
						const fileBaseName = String(activePath).split('/').pop() || 'main.pl';
						const fileName = `/tmp/${fileBaseName}`;
						try {
							globalThis.Module.FS_createPath('/', 'tmp', true, true);
						} catch {
							// Some WebPerl builds create /tmp during startup.
						}
						globalThis.Module.FS_createDataFile(
							'/tmp',
							fileBaseName,
							encoder.encode(code),
							true,
							true
						);
						const status = globalThis.Module.callMain([fileName, ...args]);
						flushStdout();
						flushStderr();
						if (typeof status === 'number' && status !== 0) {
							reject(new Error(`Perl exited with status ${status}.`));
							return;
						}
						resolve();
					} catch (error) {
						flushStdout();
						flushStderr();
						reject(error);
					}
				}
			};
			try {
				importScripts(assetUrl(baseUrl, 'emperl.js'));
			} catch (error) {
				reject(error);
			}
		});
		if (log) {
			console.log('[wasm-idle:perl-worker] run settled');
		}
		self.postMessage({ results: true });
	} catch (error) {
		if (log) {
			console.error('[wasm-idle:perl-worker] failed', error);
		}
		self.postMessage({ error: error?.message || String(error) });
	}
};
