import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'vitest';

const code = ts.transpileModule(readFileSync(new URL('../src/compiler.ts', import.meta.url), 'utf8'), {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

function compilerModule(fetchImpl: typeof fetch = async () => { throw new Error('unexpected fetch'); }) {
	const exports: any = {};
	const payloads: any[] = [];
	const runtimeOptions: any[] = [];
	const runtime = { compile: async (payload: any) => {
		payloads.push(payload);
		return { success: true, assemblyId: 'assembly' };
	} };
	vm.runInNewContext(code, {
		exports, URL, Uint8Array, btoa, Error, fetch: fetchImpl,
		require(id: string) {
			assert.equal(id, './runtime-loader.js');
			return {
				loadDotnetCompilerRuntime: async (options: any) => { runtimeOptions.push(options); return runtime; },
				resolveDotnetRuntimeBaseUrl: (options: any) => new URL(options.runtimeBaseUrl || `https://test.invalid/${options.language}/`)
			};
		}
	});
	return { ...exports, runtime, payloads, runtimeOptions };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const request = { code: 'Console.WriteLine(42);', language: 'csharp' };

for (const first of ['runtime', 'references']) {
	test(`starts both loaders before either resolves (${first} finishes first)`, async () => {
		const m = compilerModule();
		const runtime = deferred<any>();
		const references = deferred<any[]>();
		const started: string[] = [];
		const stages: string[] = [];
		const loading = m.compileDotnet({ ...request, onProgress: (p: any) => stages.push(p.stage) }, {
			loadRuntime: () => { started.push('runtime'); return runtime.promise; },
			loadReferences: () => { started.push('references'); return references.promise; }
		});
		await tick();
		assert.deepEqual(started, ['runtime', 'references']);
		if (first === 'runtime') runtime.resolve(m.runtime);
		else references.resolve([{ name: 'System.Console.dll', bytesBase64: 'AQ==' }]);
		await tick();
		assert.equal(m.payloads.length, 0);
		assert.deepEqual(stages, ['runtime']);
		runtime.resolve(m.runtime);
		references.resolve([{ name: 'System.Console.dll', bytesBase64: 'AQ==' }]);
		assert.equal((await loading).success, true);
		assert.equal(m.payloads.length, 1);
		assert.equal(m.payloads[0].references[0].name, 'System.Console.dll');
		assert.deepEqual(stages, ['runtime', 'compile', 'done']);
	});
}

for (const first of ['runtime', 'references']) {
	test(`returns a ${first} failure without waiting for or compiling on the other branch`, async () => {
		const m = compilerModule();
		const runtime = deferred<any>();
		const references = deferred<any[]>();
		const loading = m.compileDotnet(request, {
			loadRuntime: () => runtime.promise, loadReferences: () => references.promise
		});
		await tick();
		(first === 'runtime' ? runtime : references).reject(new Error(first));
		assert.equal((await loading).stderr, first);
		runtime.resolve(m.runtime);
		references.resolve([]);
		await tick();
		assert.equal(m.payloads.length, 0);
	});
}

test('observes synchronous and asynchronous loader failures without unhandled rejections', async () => {
	const m = compilerModule();
	let referencesStarted = false;
	const result = await m.compileDotnet(request, {
		loadRuntime: () => { throw new Error('sync failure'); },
		loadReferences: async () => { referencesStarted = true; throw new Error('async failure'); }
	});
	await tick();
	assert.equal(result.success, false);
	assert.equal(referencesStarted, true);
	assert.equal(m.payloads.length, 0);
});

for (const stage of ['manifest', 'assembly']) {
	test(`failed reference ${stage} is evicted so a later compile retries`, async () => {
		let fail = true;
		const requests: string[] = [];
		const m = compilerModule(async (url) => {
			const pathname = new URL(String(url)).pathname;
			requests.push(pathname);
			if (fail && (stage === 'manifest' ? pathname.endsWith('.json') : pathname.endsWith('.dll'))) {
				return new Response('unavailable', { status: 503 });
			}
			return pathname.endsWith('.json')
				? Response.json({ assemblies: ['System.Console.dll'] })
				: new Response(new Uint8Array([1, 2, 255]));
		});
		const compiler = m.createDotnetCompiler({ runtimeBaseUrl: 'https://test.invalid/csharp/' });
		assert.equal((await compiler.compile(request)).success, false);
		assert.equal(m.payloads.length, 0);
		fail = false;
		assert.equal((await compiler.compile(request)).success, true);
		const count = requests.length;
		assert.equal((await compiler.compile(request)).success, true);
		assert.equal(requests.length, count);
		assert.equal(m.payloads[0].references[0].bytesBase64, 'AQL/');
		assert.equal(requests.filter((path) => path.endsWith('manifest.json')).length, 2);
	});
}

test('concurrent compiles deduplicate successful reference downloads', async () => {
	let count = 0;
	const gate = deferred<Response>();
	const m = compilerModule(async (url) => {
		count++;
		return String(url).endsWith('.json') ? gate.promise : new Response(new Uint8Array([1]));
	});
	const c = m.createDotnetCompiler();
	const first = c.compile(request);
	const second = c.compile(request);
	await tick();
	assert.equal(count, 1);
	gate.resolve(Response.json({ assemblies: ['System.Console.dll'] }));
	assert.equal((await first).success, true);
	assert.equal((await second).success, true);
	assert.equal(count, 2);
});

for (const options of [{ loadReferences: false }, { dotnetModule: {} }]) {
	test(`does not fetch references when ${Object.keys(options)[0]} opts out`, async () => {
		const m = compilerModule();
		assert.equal((await m.createDotnetCompiler(options).compile(request)).success, true);
		assert.equal('references' in m.payloads[0], false);
	});
}

test('validates requests before starting loaders', async () => {
	const m = compilerModule();
	let calls = 0;
	const deps = { loadRuntime: async () => { calls++; return m.runtime; } };
	for (const invalid of [{ code: '' }, { ...request, language: 'other' }, { ...request, target: 'other' }]) {
		assert.equal((await m.compileDotnet(invalid, deps)).success, false);
	}
	assert.equal(calls, 0);
});

test('preserves language, tracing, args, source precedence and diagnostic mapping', async () => {
	const m = compilerModule();
	let receivedOptions: any;
	const result = await m.compileDotnet({ ...request, source: 'actual', args: ['a'], runtimeDiagnosticTracing: true }, {
		loadRuntime: async (language: string, options: any) => {
			assert.equal(language, 'csharp'); receivedOptions = options;
			return { compile: async (payload: any) => {
				assert.equal(payload.source, 'actual');
				assert.equal(payload.args[0], 'a');
				return { success: false, stderr: 'Program.cs(2,3): error CS1234: invalid' };
			} };
		}
	});
	assert.equal(receivedOptions.diagnosticTracing, true);
	assert.equal(result.success, false);
	assert.equal(result.diagnostics[0].fileName, 'Program.cs');
	assert.equal(result.diagnostics[0].lineNumber, 2);
});
