// @ts-nocheck -- upstream Scala.js compiler and virtual FS APIs are untyped; host boundary is typed.
import { createMemoryFileSystem } from './memory-fs.js';
import { runnerSource } from './runner.js';
import { loadScalaCompilerAssets } from './asset-bootstrap.js';

const assets = new URL('../../../../../runtimes/wasm-scala/assets/', import.meta.url);
let runtimePromise;
let busy = false;

async function initialize(payload) {
	const wasm = globalThis.WebAssembly;
	const missing = ['JSTag', 'Suspending', 'promising'].filter((name) =>
		name === 'JSTag' ? typeof wasm?.JSTag === 'undefined' : typeof wasm?.[name] !== 'function'
	);
	if (missing.length)
		throw new Error(`Scala compiler requires WebAssembly ${missing.join(', ')}.`);
	if (payload) return initializeVerifiedRuntime(payload);
	const fs = createMemoryFileSystem();
	globalThis.__scala3CompilerSJSHostFS = fs.hostFS;
	const manifestResponse = await fetch(new URL('manifest.json', assets));
	if (!manifestResponse.ok) throw new Error(`Scala manifest HTTP ${manifestResponse.status}`);
	const manifest = await manifestResponse.json();
	// Upstream manifest URLs are relative to its browser-ide root, not the manifest.
	const base = new URL('../', assets);
	await Promise.all(
		manifest.classpath.map(async (entry) => {
			const response = await fetch(new URL(entry.url, base));
			if (!response.ok) throw new Error(`Scala classpath HTTP ${response.status}`);
			fs.writeBinary(entry.path, new Uint8Array(await response.arrayBuffer()));
		})
	);
	const compiler = await import(/* @vite-ignore */ new URL(manifest.compilerModule, base).href);
	const { default: JSZip } = await import(
		/* @vite-ignore */ new URL('vendor/jszip-wrapper.js', assets).href
	);
	const response = await fetch(new URL(manifest.runtimeIR, base));
	if (!response.ok) throw new Error(`Scala runtime IR HTTP ${response.status}`);
	const zip = await JSZip.loadAsync(await response.arrayBuffer());
	const ir = await Promise.all(
		Object.values(zip.files)
			.filter((entry) => !entry.dir && entry.name.endsWith('.sjsir'))
			.sort((a, b) => a.name.localeCompare(b.name))
			.map(async (entry) => ({
				path: `/runtime/${entry.name}`,
				bytes: await entry.async('uint8array')
			}))
	);
	return { fs, compiler, manifest, ir };
}

async function initializeVerifiedRuntime(payload) {
	const fs = createMemoryFileSystem();
	globalThis.__scala3CompilerSJSHostFS = fs.hostFS;
	const { compiler, JSZip } = await loadScalaCompilerAssets(payload);
	const manifest = JSON.parse(new TextDecoder().decode(payload['manifest.json']));
	for (const entry of manifest.classpath) {
		const name = entry.url.replace(/^\.\/assets\//u, '');
		if (!payload[name]) throw new Error('Scala classpath manifest is inconsistent.');
		fs.writeBinary(entry.path, payload[name]);
	}
	const zip = await JSZip.loadAsync(payload['runtime/runtime-sjsir.zip']);
	const ir = await Promise.all(
		Object.values(zip.files)
			.filter((entry) => !entry.dir && entry.name.endsWith('.sjsir'))
			.sort((a, b) => a.name.localeCompare(b.name))
			.map(async (entry) => ({
				path: `/runtime/${entry.name}`,
				bytes: await entry.async('uint8array')
			}))
	);
	return { fs, compiler, manifest, ir };
}

self.onmessage = async ({ data }) => {
	const { id, files, runtimeAssets, type, limits = {} } = data;
	if (busy) {
		self.postMessage({ id, type: 'error', message: 'Scala compiler is busy', diagnostics: [] });
		return;
	}
	busy = true;
	const diagnostics = [];
	const originals = new Map();
	let diagnosticBytes = 0;
	let diagnosticCount = 0;
	let diagnosticLimitError;
	const maxDiagnostics = Math.min(1000, limits.maxDiagnostics ?? 100);
	const maxDiagnosticBytes = Math.min(1024 * 1024, limits.maxDiagnosticBytes ?? 1024 * 1024);
	try {
		if (
			!Number.isSafeInteger(maxDiagnostics) ||
			maxDiagnostics < 0 ||
			!Number.isSafeInteger(maxDiagnosticBytes) ||
			maxDiagnosticBytes <= 0
		)
			throw new Error('Invalid Scala diagnostic limits.');
		if (type === 'initialize') {
			if (!runtimeAssets)
				throw new Error('Scala initialization requires verified asset bytes.');
			runtimePromise ??= initialize(runtimeAssets).catch((error) => {
				runtimePromise = undefined;
				throw error;
			});
			await runtimePromise;
			self.postMessage({ id, type: 'ready' });
			return;
		}
		if (!Array.isArray(files) || files.length === 0 || files.length > 64)
			throw new Error('Provide 1–64 Scala source files.');
		const seen = new Set();
		let bytes = 0;
		for (const file of files) {
			if (
				typeof file.path !== 'string' ||
				!/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.scala$/.test(file.path) ||
				file.path === 'WasmIdleScalaRunner.scala' ||
				seen.has(file.path) ||
				typeof file.content !== 'string'
			)
				throw new Error('Invalid or duplicate Scala source path.');
			seen.add(file.path);
			bytes += new TextEncoder().encode(file.content).length;
		}
		if (bytes > 1024 * 1024) throw new Error('Scala source exceeds 1 MiB.');
		const initializeStart = performance.now();
		runtimePromise ??= initialize(runtimeAssets).catch((error) => {
			runtimePromise = undefined;
			throw error;
		});
		const { fs, compiler, manifest, ir } = await runtimePromise;
		const initializeMs = performance.now() - initializeStart;
		fs.removeTree('/workspace');
		fs.mkdir('/workspace/out');
		for (const file of files) fs.writeText(`/workspace/${file.path}`, file.content);
		fs.writeText('/workspace/WasmIdleScalaRunner.scala', runnerSource);
		for (const method of ['log', 'warn', 'error']) {
			originals.set(method, console[method]);
			console[method] = (...args) => {
				if (diagnosticLimitError) throw diagnosticLimitError;
				const text = args.map(String).join(' ');
				diagnosticBytes += new TextEncoder().encode(text).byteLength;
				const plain = text.replace(/\u001b\[[0-9;]*m/gu, '');
				diagnosticCount += plain.split('\n').filter((line) => /^-- /u.test(line)).length;
				if (diagnosticCount > maxDiagnostics || diagnosticBytes > maxDiagnosticBytes) {
					diagnosticLimitError = new Error(
						'Scala compiler diagnostics exceed configured limits.'
					);
					diagnosticLimitError.limit =
						diagnosticCount > maxDiagnostics ? maxDiagnostics : maxDiagnosticBytes;
					diagnosticLimitError.actual =
						diagnosticCount > maxDiagnostics ? diagnosticCount : diagnosticBytes;
					throw diagnosticLimitError;
				}
				diagnostics.push(text);
			};
		}
		const compileStart = performance.now();
		const exitCode = await compiler.runScala3CompilerSJSAsync([
			'-classpath',
			manifest.classpath.map((entry) => entry.path).join(':'),
			'-d',
			'/workspace/out',
			...files.map((file) => `/workspace/${file.path}`),
			'/workspace/WasmIdleScalaRunner.scala'
		]);
		const compileMs = performance.now() - compileStart;
		if (diagnosticLimitError) throw diagnosticLimitError;
		if (exitCode !== 0) throw new Error(`Scala compiler exited with code ${exitCode}.`);
		const generated = fs
			.listFiles('/workspace/out')
			.filter((path) => path.endsWith('.sjsir'))
			.sort()
			.map((path) => ({ path, bytes: fs.readBinary(path) }));
		if (!generated.length) throw new Error('Scala compiler emitted no IR.');
		const linkStart = performance.now();
		const linked = await compiler.linkScalaJSModuleAsync(ir.concat(generated));
		if (diagnosticLimitError) throw diagnosticLimitError;
		if (typeof linked.code !== 'string' || !linked.code.length)
			throw new Error('Scala linker emitted no code.');
		self.postMessage({
			id,
			type: 'compiled',
			code: linked.code,
			diagnostics,
			timings: { initializeMs, compileMs, linkMs: performance.now() - linkStart }
		});
	} catch (error) {
		self.postMessage({
			id,
			type: 'error',
			message: String(error),
			diagnostics,
			...(diagnosticLimitError
				? {
						failureKind: 'diagnostic-limit',
						limit: diagnosticLimitError.limit,
						actual: diagnosticLimitError.actual
					}
				: {})
		});
	} finally {
		for (const [method, original] of originals) console[method] = original;
		busy = false;
	}
};
