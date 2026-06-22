const SEQUENCE_INDEX = 0;
const LENGTH_INDEX = 1;
const HEADER_BYTES = Int32Array.BYTES_PER_ELEMENT * 2;
const EOF_LENGTH = -1;
const stdoutDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const stdinDecoder = new TextDecoder();

let currentRun = null;

function postProgress(percent) {
	self.postMessage({ progress: { percent: Math.max(0, Math.min(100, percent)) } });
}

function normalizePath(value) {
	const parts = [];
	for (const part of String(value || '')
		.replace(/^\/+/, '')
		.replaceAll('\\', '/')
		.split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') {
			parts.pop();
			continue;
		}
		if (part.includes('\0')) continue;
		parts.push(part);
	}
	return parts.join('/');
}

function dirname(value) {
	const index = value.lastIndexOf('/');
	return index === -1 ? '' : value.slice(0, index);
}

function basename(value) {
	return value.split('/').pop() || value;
}

function octaveString(value) {
	return `'${String(value).replaceAll("'", "''")}'`;
}

function mkdirp(FS, absolutePath) {
	if (!absolutePath || absolutePath === '/') return;
	FS.mkdirTree(absolutePath);
}

function writeFile(FS, absolutePath, content) {
	mkdirp(FS, dirname(absolutePath));
	FS.writeFile(absolutePath, typeof content === 'string' ? textEncoder.encode(content) : content);
}

function fileExists(FS, absolutePath) {
	try {
		FS.lookupPath(absolutePath);
		return true;
	} catch {
		return false;
	}
}

function assetUrl(baseUrl, assetVersion, filePath) {
	const url = new URL(filePath, baseUrl);
	if (assetVersion) url.searchParams.set('v', assetVersion);
	return url.href;
}

function createLazyFile(FS, baseUrl, assetVersion, filePath) {
	const normalized = normalizePath(filePath);
	if (!normalized) return;
	const absolutePath = `/${normalized}`;
	if (fileExists(FS, absolutePath)) return;
	const directory = dirname(absolutePath) || '/';
	mkdirp(FS, directory);
	FS.createLazyFile(
		directory,
		basename(absolutePath),
		assetUrl(baseUrl, assetVersion, normalized),
		true,
		false
	);
}

function payloadViewOf(control) {
	return new Uint8Array(
		control.buffer,
		control.byteOffset + HEADER_BYTES,
		control.byteLength - HEADER_BYTES
	);
}

function readBufferedStdin(control) {
	const length = Atomics.load(control, LENGTH_INDEX);
	if (length === EOF_LENGTH) return null;
	const payload = payloadViewOf(control);
	return stdinDecoder.decode(payload.slice(0, length));
}

function waitForBufferedStdin(control) {
	const sequence = Atomics.load(control, SEQUENCE_INDEX);
	self.postMessage({ buffer: true });
	while (true) {
		const result = Atomics.wait(control, SEQUENCE_INDEX, sequence, 100);
		if (result === 'not-equal') return readBufferedStdin(control);
	}
}

function createStdinReader(buffer, initialStdin, log) {
	const chunks = [];
	if (typeof initialStdin === 'string') chunks.push(initialStdin);
	let currentBytes = new Uint8Array();
	let offset = 0;
	let initialInputExhausted = false;
	const control = buffer ? new Int32Array(buffer) : null;
	return () => {
		if (offset >= currentBytes.length) {
			if (chunks.length) {
				currentBytes = textEncoder.encode(chunks.shift() || '');
				offset = 0;
				initialInputExhausted = true;
			} else if (typeof initialStdin === 'string' && initialInputExhausted) {
				return null;
			} else if (control) {
				const chunk = waitForBufferedStdin(control);
				if (log) {
					console.log(
						chunk == null
							? '[wasm-idle:octave-stdin] read(bytes=0, eof=true)'
							: `[wasm-idle:octave-stdin] read(bytes=${textEncoder.encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
					);
				}
				if (chunk == null) return null;
				currentBytes = textEncoder.encode(chunk);
				offset = 0;
			} else {
				return null;
			}
		}
		if (offset >= currentBytes.length) return null;
		return currentBytes[offset++];
	};
}

function buildRunnerSource(activePath, args, hasInjectedStdin) {
	const normalizedActivePath = normalizePath(activePath) || 'main.m';
	const argsSource = args.map(octaveString).join(', ');
	return [
		`__wasm_idle_argv__ = {${argsSource}};`,
		hasInjectedStdin
			? `stdin = fopen(${octaveString('/workspace/.wasm-idle-stdin')}, 'r');`
			: '',
		`source(${octaveString(`/workspace/${normalizedActivePath}`)});`
	]
		.filter(Boolean)
		.join('\n');
}

function outputLine(text) {
	if (currentRun?.diagnose) return;
	self.postMessage({ output: `${String(text)}\n` });
}

function isKnownOctaveShutdownError(value) {
	const text = String(value?.stack || value?.message || value || '');
	return (
		text.includes('fatal error: octave interpreter context missing') ||
		text.includes('memory access out of bounds') ||
		text.includes('Program terminated with exit(0)')
	);
}

function finishSuccess() {
	if (!currentRun || currentRun.sent) return;
	currentRun.sent = true;
	postProgress(100);
	self.postMessage({ results: true });
}

function finishError(error) {
	if (!currentRun || currentRun.sent) return;
	currentRun.sent = true;
	const fallbackMessage = error?.message || String(error || 'Octave execution failed');
	self.postMessage({ error: currentRun.userError || fallbackMessage });
}

async function loadManifest(manifestUrl) {
	const response = await fetch(manifestUrl, { cache: 'no-store' });
	if (!response.ok) {
		throw new Error(
			`failed to load Octave runtime manifest from ${manifestUrl}: ${response.status}`
		);
	}
	return await response.json();
}

self.onerror = function (_message, _source, _lineno, _colno, error) {
	if (!currentRun) return false;
	if (currentRun.sent && isKnownOctaveShutdownError(error)) return true;
	if (currentRun.hadExecutionError) {
		finishError(error);
		return true;
	}
	return false;
};

self.onunhandledrejection = function (event) {
	if (!currentRun) return;
	if (currentRun.sent && isKnownOctaveShutdownError(event.reason)) {
		event.preventDefault();
		return;
	}
	if (currentRun.hadExecutionError || isKnownOctaveShutdownError(event.reason)) {
		event.preventDefault();
		if (currentRun.hadExecutionError) finishError(event.reason);
		else finishSuccess();
	}
};

self.onmessage = async (event) => {
	const {
		baseUrl,
		manifestUrl,
		buffer,
		code,
		args = [],
		stdin,
		activePath = 'main.m',
		workspaceFiles = [],
		diagnose = false,
		log
	} = event.data || {};

	currentRun = {
		hadExecutionError: false,
		diagnose: !!diagnose,
		sent: false,
		userError: ''
	};

	try {
		postProgress(2);
		const manifest = await loadManifest(manifestUrl);
		const runtimeBaseUrl = new URL('./', baseUrl || manifestUrl).href;
		const entryScript = manifest.entryScript || 'bin/octave-cli-10.3.0';
		const assetVersion = manifest.fingerprint || manifest.version || '';
		const files = Array.isArray(manifest.files) ? manifest.files : [];
		const filePaths = files
			.map((file) => (typeof file === 'string' ? file : file.path))
			.filter(Boolean);
		const hasInjectedStdin = typeof stdin === 'string';
		postProgress(8);

		self.Module = {
			arguments: [
				'--no-gui',
				'--quiet',
				'--no-init-file',
				'--eval',
				buildRunnerSource(activePath, args, hasInjectedStdin)
			],
			thisProgram: '/bin/octave-cli-10.3.0',
			locateFile(fileName) {
				const match = filePaths.find((filePath) => basename(filePath) === fileName);
				return assetUrl(runtimeBaseUrl, assetVersion, match || `bin/${fileName}`);
			},
			print: outputLine,
			printErr(text) {
				const message = String(text);
				if (isKnownOctaveShutdownError(message)) return;
				if (/^error:/i.test(message) || /\b(?:parse|syntax)\s+error\b/i.test(message)) {
					currentRun.hadExecutionError = true;
					currentRun.userError = currentRun.userError
						? `${currentRun.userError}\n${message}`
						: message;
				}
				outputLine(message);
			},
			stdin: createStdinReader(buffer, stdin, log),
			preRun: [
				() => {
					const FS = self.FS;
					if (Array.isArray(self.arguments_) && Array.isArray(self.Module?.arguments)) {
						self.arguments_.splice(0, self.arguments_.length, ...self.Module.arguments);
					}
					for (const filePath of filePaths)
						createLazyFile(FS, runtimeBaseUrl, assetVersion, filePath);
					mkdirp(FS, '/workspace');
					for (const file of workspaceFiles) {
						const normalized = normalizePath(file.path);
						if (!normalized) continue;
						writeFile(FS, `/workspace/${normalized}`, file.content || '');
					}
					if (hasInjectedStdin) {
						writeFile(FS, '/workspace/.wasm-idle-stdin', stdin);
					}
					const normalizedActivePath = normalizePath(activePath) || 'main.m';
					writeFile(FS, `/workspace/${normalizedActivePath}`, code || '');
					FS.chdir('/workspace');
					postProgress(20);
				}
			],
			postRun: [finishSuccess],
			monitorRunDependencies(left) {
				postProgress(left > 0 ? 30 : 70);
			}
		};

		if (log) {
			console.log(
				`[wasm-idle:octave-worker] run start bytes=${String(code || '').length} activePath=${activePath}`
			);
		}
		importScripts(assetUrl(runtimeBaseUrl, assetVersion, entryScript));
	} catch (error) {
		if (log) {
			console.error('[wasm-idle:octave-worker] failed', error);
		}
		if (currentRun?.hadExecutionError) finishError(error);
		else if (isKnownOctaveShutdownError(error)) finishSuccess();
		else finishError(error);
	}
};
