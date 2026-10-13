// Internal feasibility API; public Sandbox/language registration waits for release gates.
export class ScalaCandidate {
	constructor({ workerFactory, timeoutMs = 120000 } = {}) {
		this.workerFactory =
			workerFactory ??
			((kind) =>
				new Worker(new URL(`./${kind}.worker.js`, import.meta.url), { type: 'module' }));
		this.timeoutMs = timeoutMs;
		this.compiler = null;
		this.active = null;
		this.busy = false;
		this.disposed = false;
		this.nextId = 0;
		this.generation = 0;
	}

	async compile(files, { signal } = {}) {
		const generation = this.begin(signal);
		try {
			const compiled = await this.compileRequest(files, signal);
			this.checkOperation(generation, signal);
			return compiled;
		} finally {
			this.busy = false;
		}
	}

	begin(signal) {
		if (this.disposed) throw new Error('Scala candidate is disposed.');
		if (this.busy) throw new Error('Scala candidate is busy.');
		if (signal?.aborted) throw new Error('Scala request aborted.');
		this.busy = true;
		return ++this.generation;
	}

	checkOperation(generation, signal) {
		if (this.disposed || generation !== this.generation || signal?.aborted)
			throw new Error('Scala request aborted.');
	}

	async compileRequest(files, signal) {
		this.compiler ??= this.workerFactory('compiler');
		return this.request(this.compiler, { files }, signal, this.timeoutMs);
	}

	async run(
		{ files, stdin = '', args = [] },
		{ signal, onOutput = () => {}, timeoutMs = 10000 } = {}
	) {
		const generation = this.begin(signal);
		let execution;
		try {
			const compiled = await this.compileRequest(files, signal);
			this.checkOperation(generation, signal);
			execution = this.workerFactory('execution');
			const result = await this.request(
				execution,
				{ code: compiled.code, stdin, args },
				signal,
				timeoutMs,
				onOutput
			);
			this.checkOperation(generation, signal);
			return { exitCode: result.exitCode, diagnostics: compiled.diagnostics };
		} finally {
			execution?.terminate();
			this.busy = false;
		}
	}

	request(worker, payload, signal, timeoutMs, onOutput = () => {}) {
		if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
			return Promise.reject(new Error('Invalid Scala timeout.'));
		return new Promise((resolve, reject) => {
			const id = ++this.nextId;
			let settled = false;
			const finish = (error, value) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				signal?.removeEventListener('abort', abort);
				worker.onmessage = null;
				worker.onerror = null;
				this.active = null;
				if (error) {
					worker.terminate();
					if (worker === this.compiler) this.compiler = null;
					reject(error);
				} else resolve(value);
			};
			const abort = () => finish(new Error('Scala request aborted.'));
			const timer = setTimeout(
				() => finish(new Error('Scala request timed out.')),
				timeoutMs
			);
			this.active = { cancel: abort };
			worker.onmessage = ({ data }) => {
				if (data.id !== id || settled) return;
				if (data.type === 'stdout' || data.type === 'stderr') {
					try {
						onOutput(data.type, data.data);
					} catch (error) {
						finish(error);
					}
				} else if (data.type === 'compiled' || data.type === 'exit') finish(null, data);
				else if (data.type === 'error') {
					const error = new Error(data.message);
					error.diagnostics = data.diagnostics ?? [];
					finish(error);
				}
			};
			worker.onerror = (event) => finish(new Error(event.message || 'Scala worker failed.'));
			if (signal?.aborted) abort();
			else {
				signal?.addEventListener('abort', abort, { once: true });
				try {
					worker.postMessage({ id, ...payload });
				} catch (error) {
					finish(error);
				}
			}
		});
	}

	stop() {
		this.generation++;
		this.active?.cancel();
	}

	dispose() {
		this.disposed = true;
		this.stop();
		this.compiler?.terminate();
		this.compiler = null;
	}
}
