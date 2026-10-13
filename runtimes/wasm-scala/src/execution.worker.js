// One execution per worker: the caller terminates this worker on exit, Stop, or timeout.
let started = false;
self.onmessage = async ({ data }) => {
	if (started) return;
	started = true;
	const { id, code, stdin, args } = data;
	let url;
	let outputBytes = 0;
	let outputLimitError;
	let terminalSent = false;
	const reportError = (error) => {
		if (terminalSent) return;
		terminalSent = true;
		self.postMessage({ id, type: 'error', message: String(error) });
	};
	try {
		if (
			typeof code !== 'string' ||
			typeof stdin !== 'string' ||
			!Array.isArray(args) ||
			args.some((arg) => typeof arg !== 'string')
		)
			throw new Error('Invalid Scala execution request.');
		if (
			new TextEncoder().encode(code).length > 32 * 1024 * 1024 ||
			new TextEncoder().encode(stdin).length > 1024 * 1024
		)
			throw new Error('Scala execution request exceeds limits.');
		globalThis.wasmIdleScalaWrite = (stream, text) => {
			if (outputLimitError) throw outputLimitError;
			if (!['stdout', 'stderr'].includes(stream) || typeof text !== 'string')
				throw new Error('Invalid Scala console write.');
			outputBytes += new TextEncoder().encode(text).length;
			if (outputBytes > 1024 * 1024) {
				outputLimitError = new Error('Scala output exceeds 1 MiB.');
				// Report before throwing: guest code can catch this exception or loop forever.
				// The host can now terminate this execution even if the guest never returns.
				reportError(outputLimitError);
				throw outputLimitError;
			}
			self.postMessage({ id, type: stream, data: text });
		};
		const decoders = {
			stdout: new TextDecoder('utf-8', { ignoreBOM: true }),
			stderr: new TextDecoder('utf-8', { ignoreBOM: true })
		};
		globalThis.wasmIdleScalaWriteBytes = (stream, values) => {
			if (outputLimitError) throw outputLimitError;
			const decoder = decoders[stream];
			if (!decoder) throw new Error('Invalid Scala stream.');
			globalThis.wasmIdleScalaWrite(
				stream,
				decoder.decode(Uint8Array.from(values), { stream: true })
			);
		};
		url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
		const module = await import(url);
		if (typeof module.runWasmIdleScala !== 'function')
			throw new Error('Missing Scala entry export.');
		await module.runWasmIdleScala(stdin, args);
		if (outputLimitError) return;
		for (const [stream, decoder] of Object.entries(decoders)) {
			const tail = decoder.decode();
			if (tail) globalThis.wasmIdleScalaWrite(stream, tail);
		}
		terminalSent = true;
		self.postMessage({ id, type: 'exit', exitCode: 0 });
	} catch (error) {
		reportError(outputLimitError ?? error);
	} finally {
		if (url) URL.revokeObjectURL(url);
	}
};
