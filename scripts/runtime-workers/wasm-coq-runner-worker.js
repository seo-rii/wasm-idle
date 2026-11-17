import { unzipSync } from 'fflate';
import {
	coqWorkspacePath,
	coqPpText,
	readCoqCommandInput,
	guardCoqFilesystem
} from './coq-host.mjs';

const profile = __WASM_IDLE_COQ_PROFILE__;
const publish = self.postMessage.bind(self);
let used = false;
self.onmessage = async ({ data }) => {
	if (!data?.run) return;
	let phase = 'startup',
		kernelUrl;
	try {
		if (used) throw new Error('Coq requires a fresh Worker per run');
		used = true;
		if (data.args?.length)
			throw new Error('Coq browser sessions do not accept program arguments');
		const payload = data.runtimePreflight;
		if (payload?.profileId !== profile.profileId)
			throw new Error('Coq runtime profile mismatch');
		for (const [name, expected] of Object.entries(profile.assets)) {
			const bytes = payload[name];
			if (!(bytes instanceof Uint8Array) || bytes.length !== expected.bytes)
				throw new Error(`Coq asset size mismatch: ${name}`);
			const digest = Array.from(
				new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
				(b) => b.toString(16).padStart(2, '0')
			).join('');
			if (digest !== expected.sha256) throw new Error(`Coq asset digest mismatch: ${name}`);
		}
		const limits = data.limits;
		let outputBytes = 0,
			diagnosticCount = 0,
			violation,
			kernelError;
		const locations = new Map();
		const reportedErrors = new Set();
		const text = (value, stream = 'stdout') => {
			if (violation) throw violation;
			outputBytes += new TextEncoder().encode(value).length;
			if (outputBytes > limits.maxOutputBytes)
				throw (violation = Object.assign(new Error('Coq output limit exceeded'), {
					code: 'output-limit',
					actual: outputBytes,
					limit: limits.maxOutputBytes
				}));
			if (value) publish({ output: value, stream });
		};
		const report = (level, pp, location) => {
			if (violation || level === 'Debug') return;
			const message = coqPpText(pp);
			if (level === 'Error') reportedErrors.add(message);
			text(message + '\n', level === 'Error' || level === 'Warning' ? 'stderr' : 'stdout');
			if (level === 'Error' || level === 'Warning') {
				if (++diagnosticCount > limits.maxDiagnostics)
					throw (violation = Object.assign(new Error('Coq diagnostic limit exceeded'), {
						code: 'output-limit',
						actual: diagnosticCount,
						limit: limits.maxDiagnostics
					}));
				const source = location?.fname?.[0] === 'InFile' ? location.fname[1] : undefined;
				const path = typeof source === 'string' ? source : source?.file;
				const fileName =
					path &&
					(locations.get(path) ||
						locations.get('/lib/work/' + path.replace(/^\.\//u, '')) ||
						path);
				publish({
					diagnostic: {
						severity: level === 'Error' ? 'error' : 'warning',
						message,
						...(fileName ? { fileName } : {}),
						...(location?.line_nb ? { lineNumber: location.line_nb } : {})
					}
				});
			}
		};
		let expectedFile;
		let loaded = false;
		self.postMessage = (message) => {
			if (!Array.isArray(message)) return publish(message);
			if (violation) return;
			if (message[0] === 'Log') report(message[1][0], message[2]);
			if (message[0] === 'Feedback') {
				const feedback = message[1],
					contents = feedback.contents;
				if (contents[0] === 'Message') report(contents[1][0], contents[3], contents[2]);
			}
			if (message[0] === 'Loaded' && message[1] === expectedFile) loaded = true;
			if (message[0] === 'CoqExn') {
				const failure = message[1];
				const nativeMessage = coqPpText(failure.pp) || failure.msg;
				kernelError = new Error(nativeMessage);
				// Parse errors may arrive only as CoqExn. Preserve their original text and
				// locations, without duplicating errors already emitted as Feedback.Message.
				if (!reportedErrors.has(nativeMessage))
					report('Error', failure.pp || ['Pp_string', failure.msg], failure.loc);
			}
			if (message[0] === 'JsonExn') kernelError = new Error(message[1]);
		};
		kernelUrl = URL.createObjectURL(
			new Blob([payload['jscoq_worker.bc.js']], { type: 'text/javascript' })
		);
		const onRun = self.onmessage;
		importScripts(kernelUrl);
		const kernel = self.onmessage;
		self.onmessage = onRun;
		// All kernel and plugin bytes have already been verified. Missing libraries must
		// produce original errors, never silently fetch unpinned code from the network.
		self.XMLHttpRequest = class {
			open() {
				throw new Error('Coq profile has no unverified remote libraries');
			}
		};
		let fs;
		const send = (command) => {
			kernelError = undefined;
			reportedErrors.clear();
			kernel({ data: command });
			if (violation) throw violation;
			fs?.check();
			if (kernelError) throw kernelError;
		};
		const loadPaths = new Map();
		for (const [name, archive] of Object.entries(profile.archives)) {
			const files = unzipSync(payload[name]);
			if (
				Object.keys(files).length !== archive.entries ||
				Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0) !==
					archive.uncompressedBytes
			)
				throw new Error('Coq standard-library archive layout changed');
			for (const [path, bytes] of Object.entries(files)) {
				if (path === 'coq-pkg.json') continue;
				if (
					path.startsWith('/') ||
					path.split('/').some((part) => !part || part === '..' || part === '.')
				)
					throw new Error('Invalid Coq library path');
				send(['Put', '/lib/' + path, bytes]);
				const logical = path.split('/').slice(0, -1);
				loadPaths.set(logical.join('/'), [logical, ['/lib']]);
			}
		}
		fs = guardCoqFilesystem(self.jsoo_runtime, limits.maxWorkspaceBytes);
		const workspace = new Map(
			(data.workspaceFiles || []).map((file) => [file.path, file.content])
		);
		const activePath = data.activePath || 'main.v';
		workspace.set(activePath, data.code);
		let sourceBytes = 0;
		for (const [path, content] of workspace) {
			if (/\.cma(?:\.js)?$/u.test(path))
				throw new Error('Workspace Coq plugins are outside this profile');
			const bytes = new TextEncoder().encode(content),
				target = coqWorkspacePath(path);
			if (locations.has(target)) throw new Error('Coq workspace file aliases overlap');
			sourceBytes += bytes.length;
			fs.check(sourceBytes);
			locations.set(target, path);
			send(['Put', target, bytes]);
		}
		fs.check();
		send([
			'Init',
			{ implicit_libs: true, lib_path: [...loadPaths.values(), [[], ['/lib/work']]] }
		]);
		send(['NewDoc', { top_name: 'WasmIdle', lib_init: ['Coq.Init.Prelude'] }]);
		self.jsoo_runtime.caml_sys_chdir(self.jsoo_runtime.caml_string_of_jsstring('/lib/work'));
		const loadFile = (filename) => {
			expectedFile = filename;
			loaded = false;
			// Upstream Vernac.load_vernac parses and checks the complete file. Unlike a
			// wrapper vernacular Load statement, this API retains original file locations.
			send(['Load', filename]);
			fs.check();
			if (!loaded) throw new Error('Coq did not finish loading the source file');
		};
		phase = 'execute';
		publish({ type: 'execution-ready' });
		loadFile(coqWorkspacePath(activePath));
		const input = data.stdinChannel
			? readCoqCommandInput(data.stdinChannel, limits.maxWorkspaceBytes - fs.usage(), () =>
					publish({ type: 'stdin-request' })
				)
			: new TextEncoder().encode(data.stdin || '');
		fs.check(fs.usage() + input.length);
		if (input.length) {
			// This is one complete, unchanged command stream. Native Coq handles periods,
			// comments, strings, proof blocks and syntax errors inside the entire file.
			const stdinPath = '/lib/wasm-idle-stdin.v';
			locations.set(stdinPath, '<stdin>');
			send(['Put', stdinPath, input]);
			loadFile(stdinPath);
		}
		publish({ results: true });
	} catch (error) {
		const message = String(error?.message || error);
		publish({
			error: message,
			failure: {
				name: error?.name || 'Error',
				message,
				runtimeId: 'COQ',
				code: error?.code || 'runtime',
				phase,
				...(error?.code === 'resource-limit' || error?.code === 'output-limit'
					? { actual: error.actual, limit: error.limit }
					: {})
			}
		});
	} finally {
		if (kernelUrl) URL.revokeObjectURL(kernelUrl);
	}
};
