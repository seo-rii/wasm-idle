// @vitest-environment node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'vitest';

const source = readFileSync(new URL('./java.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function worker() {
	const messages: any[] = [];
	const counts = { compile: 0, generate: 0, run: 0, initialize: 0 };
	const failure = { compile: false, generate: false, output: false };
	let onDiagnostic: ((diagnostic: any) => void) | undefined;
	let handler!: (event: { data: any }) => Promise<void>;
	const compiler = {
		setSdk() {}, setTeaVMClasslib() {}, clearSourceFiles() {},
		clearInputClassFiles() {}, clearOutputFiles() {}, addSourceFile() {},
		onDiagnostic(callback: typeof onDiagnostic) {
			onDiagnostic = callback;
			return () => { onDiagnostic = undefined; };
		},
		compile() {
			counts.compile++;
			onDiagnostic?.({ fileName: 'Main.java', lineNumber: 1, severity: 'warning', message: 'warning' });
			onDiagnostic?.({ fileName: 'Unrelated.java', lineNumber: 1, severity: 'warning', message: 'hidden' });
			return !failure.compile;
		},
		detectMainClasses: () => ['Main'],
		generateWebAssembly() { counts.generate++; return !failure.generate; },
		getWebAssemblyOutputFile() {
			if (failure.output) throw new Error('output failed');
			return new Uint8Array([9]);
		}
	};
	const runtime = { load: async (bytes: Uint8Array) => {
		if (bytes[0] === 9) return { exports: { main: () => { counts.run++; } } };
		counts.initialize++;
		return { exports: { createCompiler: () => compiler } };
	} };
	vm.runInNewContext(compiled, {
		exports: {}, TextDecoder, TextEncoder, Blob, Uint8Array, Int8Array, Int32Array, Error,
		URL: { createObjectURL: () => 'blob:loader', revokeObjectURL() {} },
		self: {
			addEventListener: (_: string, listener: typeof handler) => { handler = listener; },
			postMessage: (message: any) => messages.push(message)
		},
		require: (id: string) => {
			if (id === '$lib/playground/worker/assets') return {
				configureWorkerRuntimeAssets() {}, handleWorkerAssetMessage: () => false,
				loadWorkerRuntimeAsset: async () => ({ bytes: new Uint8Array([1]) })
			};
			if (id === '$lib/playground/javaStdin') return {
				prepareJavaStdinInjection: (code: string, stdin: string, explicit: boolean) => ({
					transformedCode: code, usesStdin: false,
					stdinCacheKey: explicit ? `explicit:${stdin}` : 'interactive'
				})
			};
			if (id === '$lib/playground/javaSource') return {
				resolveJavaSourceIdentity: () => ({ mainClass: 'Main', sourcePath: 'Main.java' })
			};
			if (id === '$lib/playground/stdinBuffer') return { waitForBufferedStdin: () => null };
			if (id === 'blob:loader') return runtime;
			throw new Error(`Unexpected dependency: ${id}`);
		}
	});
	return {
		counts, failure, messages,
		load: (baseUrl = '/teavm/') => handler({ data: { load: true, assets: { baseUrl } } }),
		run: (options: Record<string, unknown> = {}) => {
			messages.length = 0;
			return handler({ data: {
				code: 'class Main {}', prepare: true, hasExplicitStdin: true,
				buffer: new ArrayBuffer(16), ...options
			} });
		}
	};
}

test('unchanged prepare requests compile only once and never execute the program', async () => {
	const w = worker();
	await w.load();
	await w.run();
	await w.run();
	assert.deepEqual(w.counts, { compile: 1, generate: 1, run: 0, initialize: 1 });
	assert.equal(w.messages.at(-1)?.results, true);
});

test('execution after preparation reuses the artifact, including when only args change', async () => {
	const w = worker();
	await w.load();
	await w.run();
	await w.run({ prepare: false, args: ['first'] });
	await w.run({ prepare: false, args: ['second'] });
	assert.equal(w.counts.compile, 1);
	assert.equal(w.counts.generate, 1);
	assert.equal(w.counts.run, 2);
});

for (const [label, options] of Object.entries({
	source: { code: 'class Main { int x; }' },
	stdin: { stdin: 'changed input' },
	stdinMode: { hasExplicitStdin: false },
	activePath: { activePath: 'other/Main.java' },
	workspace: { workspaceFiles: [{ path: 'Helper.java', content: 'class Helper {}' }] }
})) {
	test(`invalidates preparation when ${label} changes`, async () => {
		const w = worker();
		await w.load();
		await w.run();
		await w.run(options);
		await w.run(options);
		assert.equal(w.counts.compile, 2);
		assert.equal(w.counts.run, 0);
	});
}

test('changes to workspace contents invalidate a same-length file list', async () => {
	const w = worker();
	await w.load();
	await w.run({ workspaceFiles: [{ path: 'Helper.java', content: 'class Helper {}' }] });
	await w.run({ workspaceFiles: [{ path: 'Helper.java', content: 'class Helper { int x; }' }] });
	assert.equal(w.counts.compile, 2);
});

for (const stage of ['compile', 'generate', 'output'] as const) {
	test(`a failed ${stage} cannot leave the previous artifact eligible for reuse`, async () => {
		const w = worker();
		await w.load();
		await w.run();
		w.failure[stage] = true;
		await w.run({ code: 'class Main { int changed; }' });
		assert.equal(typeof w.messages.at(-1)?.error, 'string');
		assert.equal(w.messages.some((message) => message.results), false);
		w.failure[stage] = false;
		await w.run();
		assert.equal(w.counts.compile, 3);
		assert.equal(w.messages.at(-1)?.results, true);
	});
}

test('replays visible diagnostics once per cache hit, without unrelated-file diagnostics', async () => {
	const w = worker();
	await w.load();
	await w.run();
	const first = JSON.stringify(w.messages.filter((message) => message.diagnostic));
	await w.run();
	assert.equal(JSON.stringify(w.messages.filter((message) => message.diagnostic)), first);
	assert.equal(w.messages.filter((message) => message.diagnostic).length, 1);
	assert.equal(w.counts.compile, 1);
});

test('a different runtime invalidates the artifact cache', async () => {
	const w = worker();
	await w.load();
	await w.run();
	await w.load('/another-teavm/');
	await w.run();
	assert.equal(w.counts.compile, 2);
	assert.equal(w.counts.initialize, 2);
});

test('invalid workspaces are rejected even when the source would otherwise be cached', async () => {
	const w = worker();
	await w.load();
	await w.run();
	await w.run({ workspaceFiles: [{ path: 42, content: 'bad' }] });
	assert.equal(w.messages.at(-1)?.error, 'Invalid Java workspace files');
	assert.equal(w.counts.compile, 1);
});
