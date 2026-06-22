const encoder = new TextEncoder();

function assetUrl(baseUrl, path) {
	return new URL(path, baseUrl).href;
}

function createStdinReader(stdin) {
	const bytes = encoder.encode(typeof stdin === 'string' ? stdin : '');
	let offset = 0;
	return () => {
		if (offset >= bytes.byteLength) return null;
		const value = bytes[offset];
		offset += 1;
		return value;
	};
}

function createOutputWriter(postOutput) {
	let buffer = '';
	return (codePoint) => {
		if (codePoint === null || codePoint === 10) {
			if (codePoint === 10) buffer += '\n';
			if (buffer) {
				postOutput(buffer);
				buffer = '';
			}
			return;
		}
		buffer += String.fromCharCode(codePoint);
	};
}

function normalizeOutput(text) {
	if (!text) return '';
	return text.endsWith('\n') ? text : `${text}\n`;
}

function createRequireModule(moduleName) {
	return new Promise((resolve, reject) => {
		const requirejs = self.requirejs || self.require;
		if (!requirejs) {
			reject(new Error('RequireJS was not loaded.'));
			return;
		}
		requirejs([moduleName], resolve, reject);
	});
}

function waitForWacl(wacl) {
	return new Promise((resolve) => {
		wacl.onReady((interp) => resolve(interp));
	});
}

self.onmessage = async (event) => {
	const { baseUrl, code, args = [], stdin, activePath = 'main.tcl', diagnose = false, log } = event.data || {};
	const postOutput = (text) => {
		if (diagnose) return;
		if (text) self.postMessage({ output: text });
	};
	try {
		if (log) {
			console.log(`[wasm-idle:tcl-worker] run start baseUrl=${baseUrl}`);
		}
		globalThis.Module = {
			arguments: [activePath, ...args],
			noExitRuntime: true,
			stdin: createStdinReader(stdin),
			stdout: createOutputWriter(postOutput),
			stderr: createOutputWriter(postOutput),
			print(text) {
				postOutput(normalizeOutput(String(text)));
			},
			printErr(text) {
				postOutput(normalizeOutput(String(text)));
			}
		};
		importScripts(assetUrl(baseUrl, 'require.js'));
		const requirejs = self.requirejs || self.require;
		requirejs.config({ baseUrl });
		const wacl = await createRequireModule('tcl/wacl');
		const interp = await waitForWacl(wacl);
		interp.stdout = (text) => postOutput(normalizeOutput(String(text)));
		interp.stderr = (text) => postOutput(normalizeOutput(String(text)));
		try {
			const result = interp.Eval(code);
			if (result) postOutput(normalizeOutput(String(result)));
		} catch (error) {
			const tclMessage = error?.errorInfo || error?.message || String(error);
			throw new Error(tclMessage);
		}
		if (log) {
			console.log('[wasm-idle:tcl-worker] run settled');
		}
		self.postMessage({ results: true });
	} catch (error) {
		if (log) {
			console.error('[wasm-idle:tcl-worker] failed', error);
		}
		self.postMessage({ error: error?.message || String(error) });
	}
};
