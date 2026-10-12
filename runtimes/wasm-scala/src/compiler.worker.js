import { createMemoryFileSystem } from './memory-fs.js';
import { runnerSource } from './runner.js';

const assets = new URL('../assets/', import.meta.url);
let runtimePromise;
let busy = false;

async function initialize() {
	const wasm = globalThis.WebAssembly;
	const missing = ['JSTag', 'Suspending', 'promising'].filter((name) =>
		name === 'JSTag' ? typeof wasm?.JSTag === 'undefined' : typeof wasm?.[name] !== 'function'
	);
	if (missing.length)
		throw new Error(`Scala compiler requires WebAssembly ${missing.join(', ')}.`);
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
	const compiler = await import(new URL(manifest.compilerModule, base).href);
	const { default: JSZip } = await import(new URL('vendor/jszip-wrapper.js', assets).href);
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

self.onmessage = async ({ data }) => {
	const { id, files } = data;
	if (busy) {
		self.postMessage({ id, type: 'error', message: 'Scala compiler is busy', diagnostics: [] });
		return;
	}
	busy = true;
	const diagnostics = [];
	const originals = new Map();
	try {
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
		runtimePromise ??= initialize().catch((error) => {
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
			console[method] = (...args) => diagnostics.push(args.map(String).join(' '));
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
		if (exitCode !== 0) throw new Error(`Scala compiler exited with code ${exitCode}.`);
		const generated = fs
			.listFiles('/workspace/out')
			.filter((path) => path.endsWith('.sjsir'))
			.sort()
			.map((path) => ({ path, bytes: fs.readBinary(path) }));
		if (!generated.length) throw new Error('Scala compiler emitted no IR.');
		const linkStart = performance.now();
		const linked = await compiler.linkScalaJSModuleAsync(ir.concat(generated));
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
		self.postMessage({ id, type: 'error', message: String(error), diagnostics });
	} finally {
		for (const [method, original] of originals) console[method] = original;
		busy = false;
	}
};
