let lfortranReady = null;
let emitAsrFromSource = null;
const assetSearch = new URL(self.location.href).search;

const assetUrl = (path) => {
	const url = new URL(path, self.location.href);
	url.search = assetSearch;
	return url.href;
};

const stripAnsi = (text) => text.replace(/(\x9b|\x1b\[)[0-?]*[ -/]*[@-~]/gu, '');

const cleanDiagnosticMessage = (line) =>
	line
		.replace(/^\s*(syntax|semantic|compiler|runtime)\s+error\s*:\s*/iu, '$1 error: ')
		.trim();

const parseDiagnostics = (text) => {
	const clean = stripAnsi(String(text || '')).trim();
	if (!/(^|\n)\s*(syntax|semantic|compiler|runtime)\s+error\s*:/iu.test(clean)) return [];

	const location = clean.match(/-->\s+[^:\n]+:(\d+):(\d+)/u);
	const message =
		clean
			.split('\n')
			.map((line) => line.trim())
			.find((line) => /^(syntax|semantic|compiler|runtime)\s+error\s*:/iu.test(line)) ||
		'Fortran compiler error';
	const lineNumber = Math.max(1, Number(location?.[1] || 1));
	const columnNumber = Math.max(1, Number(location?.[2] || 1));

	return [
		{
			lineNumber,
			columnNumber,
			severity: 'error',
			message: cleanDiagnosticMessage(message)
		}
	];
};

const loadLFortran = () => {
	if (lfortranReady) return lfortranReady;
	lfortranReady = new Promise((resolve, reject) => {
		self.Module = {
			noInitialRun: true,
			locateFile(path) {
				return assetUrl(path);
			},
			print() {},
			printErr() {},
			onAbort(error) {
				reject(new Error(String(error || 'LFortran aborted')));
			},
			onRuntimeInitialized() {
				try {
					emitAsrFromSource = self.Module.cwrap('emit_asr_from_source', 'string', ['string']);
					resolve();
				} catch (error) {
					reject(error);
				}
			}
		};
		try {
			importScripts(assetUrl('lfortran.js'));
		} catch (error) {
			reject(error);
		}
	});
	return lfortranReady;
};

const analyze = async (code) => {
	await loadLFortran();
	if (!emitAsrFromSource) {
		throw new Error('LFortran analyzer did not expose emit_asr_from_source');
	}
	const result = emitAsrFromSource(code);
	return parseDiagnostics(result);
};

self.addEventListener('message', async (event) => {
	const { id, type, code } = event.data || {};
	if (type !== 'analyze') return;
	try {
		self.postMessage({ id, diagnostics: await analyze(String(code || '')) });
	} catch (error) {
		self.postMessage({
			id,
			error: error instanceof Error ? error.message : String(error)
		});
	}
});
