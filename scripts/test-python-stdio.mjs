import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';
const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('../src/lib/playground/worker/pythonStdio.ts', import.meta.url), 'utf8');
const { outputText, diagnostics } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
assert.equal(diagnostics.length, 0);
const exports = {};
vm.runInNewContext(outputText, { exports, TextEncoder, TextDecoder, performance, setTimeout, clearTimeout });
const { createPythonStdio } = exports;
const encoder = new TextEncoder();
function fixture(options = {}) {
	let input, output, error;
	const messages = [];
	const runtime = { setStdin(v) { input = v; }, setStdout(v) { output = v; }, setStderr(v) { error = v; } };
	const io = createPythonStdio(runtime, { readInput: () => null, emit: (s) => messages.push(s), maxDelayMs: 10000, ...options });
	return { io, messages, read: () => input.stdin(), write: (s) => output.write(typeof s === 'string' ? encoder.encode(s) : s), stderr: (s) => error.write(encoder.encode(s)) };
}

test('many small writes are delivered as bounded batches without losing order', () => {
	const f = fixture({ maxChars: 32 });
	for (let i = 0; i < 100; i++) f.write('x\n');
	f.io.close();
	assert.equal(f.messages.join(''), 'x\n'.repeat(100));
	assert.ok(f.messages.length < 10);
	assert.ok(f.messages.every((s) => s.length <= 32));
});
test('UTF-8 and surrogate pairs survive arbitrary byte and message boundaries', () => {
	const f = fixture({ maxChars: 3 });
	const text = '한🙂글😎\n';
	for (const byte of encoder.encode(text)) f.write(new Uint8Array([byte]));
	f.io.close();
	assert.equal(f.messages.join(''), text);
	assert.ok(f.messages.every((s) => !/[\uD800-\uDBFF]$/.test(s) && !/^[\uDC00-\uDFFF]/.test(s)));
});
test('stdout and stderr keep independent decoders and ordered decoded output', () => {
	const f = fixture();
	const bytes = encoder.encode('한');
	f.write(bytes.subarray(0, 1));
	f.stderr('error');
	f.write(bytes.subarray(1));
	f.io.close();
	assert.equal(f.messages.join(''), 'error한');
});
test('input requests flush preceding prompts and initial input ends without blocking', () => {
	let calls = 0;
	const f = fixture({ initialInput: 'a\nb', readInput: () => { calls++; return null; } });
	f.write('prompt>');
	assert.equal(new TextDecoder().decode(f.read()), 'a\nb');
	assert.equal(f.messages.join(''), 'prompt>');
	assert.equal(f.read(), null);
	assert.equal(f.read(), null);
	assert.equal(calls, 0);
	f.io.close();
});
test('explicit empty input is not interactive input', () => {
	const f = fixture({ initialInput: '', readInput: () => { throw new Error('must not block'); } });
	assert.equal(f.read().length, 0);
	assert.equal(f.read(), null);
	f.io.close();
});
test('elapsed-time flush works without an event-loop turn', () => {
	let clock = 0;
	const f = fixture({ now: () => clock, maxDelayMs: 16 });
	f.write('a');
	clock = 17;
	f.write('b');
	assert.equal(f.messages.join(''), 'ab');
	f.io.close();
});
test('explicit flush and unbatched fallback publish immediately', () => {
	const f = fixture();
	f.write('first');
	f.io.flush();
	assert.equal(f.messages.join(''), 'first');
	f.io.disableBatching();
	f.write('second');
	assert.equal(f.messages.join(''), 'firstsecond');
	f.io.close();
});
test('close flushes pending bytes once and resets the runtime callbacks', () => {
	const f = fixture();
	f.write(new Uint8Array([0xe3]));
	f.io.close();
	f.io.close();
	assert.equal(f.messages.join(''), '\ufffd');
	f.write('late');
	assert.equal(f.messages.join(''), '\ufffd');
});
test('timer flush delivers output when an async program yields', async () => {
	const f = fixture({ maxDelayMs: 5 });
	f.write('async');
	await new Promise((resolve) => setTimeout(resolve, 25));
	assert.equal(f.messages.join(''), 'async');
	f.io.close();
});
