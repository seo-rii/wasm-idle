import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
const ts = createRequire(import.meta.url)('typescript');
function transpile(source) {
	const result = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
		reportDiagnostics: true
	});
	assert.equal(result.diagnostics.length, 0);
	return result.outputText;
}
function load(relative, dependencies = {}) {
	const exports = {};
	vm.runInNewContext(transpile(readFileSync(new URL(relative, import.meta.url), 'utf8')), {
		exports,
		TextEncoder,
		Uint8Array,
		Int8Array,
		require(id) {
			if (id in dependencies) return dependencies[id];
			throw new Error(id);
		}
	});
	return exports;
}
const snapshot = load('../src/lib/playground/javaStdin.ts');
const helpers = load('../src/lib/playground/javaRuntimeStdin.ts', { './javaStdin': snapshot });
const { prepareJavaRuntimeStdinInjection: prepare, createJavaStdinBridge: bridge } = helpers;
const source =
	'public class Main { public static void main(String[] args) throws Exception { System.out.println(System.in.read()); } }';
const decode = (chunks) =>
	new TextDecoder().decode(Uint8Array.from(chunks.flatMap((c) => Array.from(c, (n) => n & 255))));
function drain(input) {
	const chunks = [];
	for (let chunk; (chunk = input.readChunk()) !== null;) chunks.push(chunk);
	return chunks;
}

test('runtime helper has a constant cache key and no embedded input or input mode', () => {
	const result = prepare(source);
	assert.equal(result.stdinCacheKey, 'host-chunks-v2-jso');
	assert.ok(!result.helperSource.includes('INITIAL_DATA'));
	assert.ok(!result.helperSource.includes('HAS_EXPLICIT_INPUT'));
	assert.match(result.helperSource, /System.arraycopy\(chunk, position, bytes, offset, count\)/);
	assert.equal(prepare(source).helperSource, result.helperSource);
});
test('packaged source retains the generated helper identity', () => {
	const result = prepare('package demo.nested;\n' + source);
	assert.equal(result.helperSourcePath, 'demo/nested/WasmIdleStdin.java');
	assert.ok(result.helperSource.startsWith('package demo.nested;\n'));
	assert.match(result.transformedCode, /WasmIdleStdin.open\(\)/);
});
test('programs without stdin remain unchanged and standalone snapshot callers stay compatible', () => {
	const result = prepare('public class Main {}');
	assert.equal(result.usesStdin, false);
	assert.equal(result.helperSource, null);
	const legacy = snapshot.prepareJavaStdinInjection(source, 'AB', true);
	assert.match(legacy.helperSource, /INITIAL_DATA = new byte\[\] \{ 65, 66 \}/);
});
test('explicit UTF-8 input is delivered once in bounded byte chunks followed by stable EOF', () => {
	let calls = 0;
	const text = '한글🙂\0abc\r\n'.repeat(1000);
	const input = bridge(text, true, () => { calls++; return null; }, 7);
	const chunks = drain(input);
	assert.equal(decode(chunks), text);
	assert.ok(chunks.every((c) => c.length <= 7));
	assert.equal(input.readByte(), -1);
	assert.equal(input.readChunk(), null);
	assert.equal(calls, 0);
});
test('explicit empty input never requests interactive input', () => {
	const input = bridge('', true, () => { throw new Error('must not wait'); });
	assert.equal(input.readChunk(), null);
	assert.equal(input.readByte(), -1);
});
test('interactive prefix is not duplicated and empty chunks are not mistaken for EOF', () => {
	const queue = ['', 'second\n', null];
	let calls = 0;
	const input = bridge('first\n', false, () => { calls++; return queue.shift(); }, 3);
	assert.equal(decode(drain(input)), 'first\nsecond\n');
	assert.equal(input.readByte(), -1);
	assert.equal(calls, 3);
});
test('byte and chunk reads share one cursor and preserve unsigned byte values', () => {
	const input = bridge('éX', true, () => null, 1);
	assert.equal(input.readByte(), 195);
	assert.deepEqual(Array.from(input.readChunk()), [-87]);
	assert.equal(input.readByte(), 88);
	assert.equal(input.readChunk(), null);
});
test('dispose ends both read APIs and chunk limits are validated', () => {
	const input = bridge('data', false, () => { throw new Error('must not wait'); });
	input.dispose(); input.dispose();
	assert.equal(input.readByte(), -1);
	assert.equal(input.readChunk(), null);
	for (const size of [0, -1, NaN, 1.5]) assert.throws(() => bridge('', true, () => null, size));
});
test('generated helper uses classlib JSO overlays and retains a byte-reader fallback', () => {
	const helper = prepare(source).helperSource;
	assert.doesNotMatch(helper, /@JSBody\(/);
	assert.match(helper, /Window.current\(\)/);
	assert.match(helper, /Int8Array array = result.cast\(\)/);
	assert.match(helper, /next\[i\] = array.get\(i\)/);
	assert.match(helper, /input.get\("readByte"\)/);
	// The Java method itself is compiled and executed in javaRuntimeStdin.integration.test.ts.
});

const workerCode = transpile(
	readFileSync(new URL('../src/lib/playground/worker/java.ts', import.meta.url), 'utf8') +
		'\nexport function __inject(c: any, r: any) { compiler = c; runtimeLoad = r; }'
);
function worker() {
	const counts = { compile: 0, generate: 0, run: 0 };
	const inputs = [], addedSources = [], messages = [], queue = [];
	const failures = { compile: false, run: false };
	let handler;
	const originalWindow = {}, originalBridge = {};
	const context = {
		exports: {}, TextDecoder, TextEncoder, Blob, URL, Uint8Array, Int8Array, Int32Array, Error,
		window: originalWindow, wasmIdleJavaStdin: originalBridge,
		self: {
			addEventListener(_, listener) { handler = listener; },
			postMessage(message) { messages.push(message); }
		},
		require(id) {
			if (id === '$lib/playground/javaRuntimeStdin') return helpers;
			if (id === '$lib/playground/javaSource') return { resolveJavaSourceIdentity: () => ({ mainClass: 'Main', sourcePath: 'Main.java' }) };
			if (id === '$lib/playground/stdinBuffer') return { waitForBufferedStdin: (_, notify) => { notify(); return queue.shift() ?? null; } };
			if (id.endsWith('/assets')) return { handleWorkerAssetMessage: () => false };
			if (id === './javaStreaming') return {};
			throw new Error(id);
		}
	};
	vm.runInNewContext(workerCode, context);
	context.exports.__inject({
		onDiagnostic: () => () => {}, clearSourceFiles() {}, clearInputClassFiles() {}, clearOutputFiles() {},
		addSourceFile(name, content) { addedSources.push({ name, content }); },
		compile() { counts.compile++; return !failures.compile; },
		detectMainClasses: () => ['Main'],
		generateWebAssembly() { counts.generate++; return true; },
		getWebAssemblyOutputFile: () => new Uint8Array([1])
	}, async () => ({ exports: { main() {
		counts.run++;
		inputs.push(decode(drain(context.wasmIdleJavaStdin)));
		if (failures.run) throw new Error('user failed');
	} } }));
	return { counts, inputs, messages, addedSources, queue, failures,
		send: (data = {}) => handler({ data: { code: source, hasExplicitStdin: true, buffer: new ArrayBuffer(64), ...data } }),
		assertRestored() { assert.equal(context.window, originalWindow); assert.equal(context.wasmIdleJavaStdin, originalBridge); }
	};
}
test('prepare and different input-only runs compile once, with fresh input each time', async () => {
	const w = worker();
	await w.send({ prepare: true, stdin: 'first' });
	await w.send({ stdin: 'second' });
	await w.send({ stdin: '한글'.repeat(10000) });
	await w.send({ stdin: '' });
	assert.deepEqual(w.counts, { compile: 1, generate: 1, run: 3 });
	assert.deepEqual(w.inputs, ['second', '한글'.repeat(10000), '']);
	assert.ok(w.addedSources.every((file) => !file.content.includes('second') && !file.content.includes('한글')));
	w.assertRestored();
});
test('switching explicit and interactive input reuses the compiled program', async () => {
	const w = worker();
	await w.send({ stdin: 'fixed' });
	w.queue.push('interactive', null);
	await w.send({ stdin: 'prefix', hasExplicitStdin: false });
	assert.equal(w.counts.compile, 1);
	assert.deepEqual(w.inputs, ['fixed', 'prefixinteractive']);
	w.assertRestored();
});
test('source edits and failed rebuilds still invalidate the artifact', async () => {
	const w = worker();
	await w.send();
	w.failures.compile = true;
	await w.send({ code: source + '\n// edit' });
	assert.match(w.messages.at(-1).error, /compilation failed/);
	w.failures.compile = false;
	await w.send();
	assert.equal(w.counts.compile, 3);
});
test('runtime errors restore host bindings and do not leak prior input to the next run', async () => {
	const w = worker();
	w.failures.run = true;
	await w.send({ stdin: 'bad' });
	assert.equal(w.messages.at(-1).error, 'user failed');
	w.assertRestored();
	w.failures.run = false;
	await w.send({ stdin: 'good' });
	assert.deepEqual(w.inputs, ['bad', 'good']);
	assert.equal(w.counts.compile, 1);
});
