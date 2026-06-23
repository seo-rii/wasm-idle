export function createFortranAnalyzer() {
	const workerUrl = new URL('./analyzer-worker.js', import.meta.url);
	workerUrl.search = new URL(import.meta.url).search;
	const worker = new Worker(workerUrl);
	let nextId = 0;
	const pending = new Map();

	worker.addEventListener('message', (event) => {
		const { id, diagnostics, error } = event.data || {};
		const request = pending.get(id);
		if (!request) return;
		pending.delete(id);
		if (error) {
			request.reject(new Error(error));
		} else {
			request.resolve(diagnostics || []);
		}
	});

	worker.addEventListener('error', (event) => {
		const error = new Error(event.message || 'Fortran analyzer worker failed');
		for (const request of pending.values()) request.reject(error);
		pending.clear();
	});

	const requestAnalyze = (code, fileName) =>
		new Promise((resolve, reject) => {
			const id = ++nextId;
			pending.set(id, { resolve, reject });
			worker.postMessage({ id, type: 'analyze', code, fileName });
		});

	return {
		analyze(code, fileName) {
			return requestAnalyze(code, fileName);
		},
		dispose() {
			for (const request of pending.values()) {
				request.reject(new Error('Fortran analyzer disposed'));
			}
			pending.clear();
			worker.terminate();
		}
	};
}

export default createFortranAnalyzer;
