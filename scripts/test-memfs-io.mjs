import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../packages/llvm-core/runtime/core/src/memfs.ts', import.meta.url), 'utf8');
const { outputText, diagnostics } = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	reportDiagnostics: true
});
assert.equal(diagnostics.length, 0);
const exports = {};
let decodeCalls = 0;
vm.runInNewContext(outputText, {
	exports, Uint8Array, ArrayBuffer, TextEncoder,
	TextDecoder: class extends TextDecoder {
		decode(...args) { decodeCalls++; return super.decode(...args); }
	},
	require(id) {
		if (id === './error.js') return { assert, AbortError: Error };
		if (id === './apply.js') return { bindNew: () => ({}) };
		if (id === './memory.js') return { default: class {} };
		if (id === './wasm.js') return { compile: () => new Promise(() => {}) };
		throw new Error(`Unexpected import: ${id}`);
	}
});
const MemFS = exports.default;

function fixture(input = '', trace) {
	const bytes = new Uint8Array(32768);
	const view = new DataView(bytes.buffer);
	let inputCalls = 0;
	const chunks = [];
	const fs = new MemFS({
		moduleUrl: 'unused.wasm', stdinStr: input, trace,
		stdin: () => { inputCalls++; return chunks.shift() ?? ''; }, stdout: () => {}
	});
	fs.hostMem = {
		check() {}, read32: (at) => view.getUint32(at, true),
		write32: (at, n) => view.setUint32(at, n, true),
		write: (at, value) => bytes.set(value, at),
		readStrR: (at, n) => new TextDecoder().decode(bytes.subarray(at, at + n))
	};
	function read(...lengths) {
		let destination = 1024;
		const positions = lengths.map((n, i) => {
			view.setUint32(i * 8, destination, true);
			view.setUint32(i * 8 + 4, n, true);
			const start = destination;
			destination += n;
			return start;
		});
		assert.equal(fs.host_read(0, 0, lengths.length, 512), 0);
		const count = view.getUint32(512, true);
		return bytes.slice(positions[0] ?? 1024, (positions[0] ?? 1024) + count);
	}
	return { fs, read, chunks, inputCalls: () => inputCalls };
}

test('partial reads retain one input allocation and release it at exhaustion', () => {
	const f = fixture('x'.repeat(1024 * 1024));
	assert.equal(f.read(4096).length, 4096);
	const allocation = f.fs.stdinBytes;
	for (let i = 1; i < 255; i++) {
		assert.equal(f.read(4096).length, 4096);
		assert.equal(f.fs.stdinBytes, allocation);
	}
	assert.equal(f.read(4096).length, 4096);
	assert.equal(f.fs.stdinBytes.length, 0);
	assert.equal(f.fs.stdinOffset, 0);
	assert.equal(f.read(8).length, 0);
});

test('UTF-8 remains byte-exact across reads and multiple iovecs', () => {
	const text = '한글🙂abc\n';
	const f = fixture(text);
	const result = [...f.read(1, 2, 1), ...f.read(2), ...f.read(20)];
	assert.deepEqual(result, [...new TextEncoder().encode(text)]);
});

test('zero-length iovecs do not request or discard input', () => {
	const f = fixture();
	f.chunks.push('abc');
	assert.equal(f.read(0).length, 0);
	assert.equal(f.inputCalls(), 0);
	assert.equal(new TextDecoder().decode(f.read(0, 2, 0, 1)), 'abc');
	assert.equal(f.inputCalls(), 1);
});

test('setStdinStr discards a partially consumed input and resets the cursor', () => {
	const f = fixture('old-input');
	f.read(2);
	f.fs.setStdinStr('new');
	assert.equal(new TextDecoder().decode(f.read(16)), 'new');
});

test('interactive chunks follow preset input and EOF is reported as zero bytes', () => {
	const f = fixture('abc');
	f.chunks.push('de');
	assert.equal(new TextDecoder().decode(f.read(8)), 'abc');
	assert.equal(new TextDecoder().decode(f.read(8)), 'de');
	assert.equal(f.read(8).length, 0);
});

test('disabled trace avoids decoding input and reading memfs log strings', () => {
	const f = fixture('abc');
	decodeCalls = 0;
	f.read(2);
	f.fs.memfs_log(0, 10); // mem is intentionally unavailable in this host-side test.
	assert.equal(decodeCalls, 0);
});

test('a trace supplied after construction is honored', () => {
	const f = fixture('abc');
	const messages = [];
	f.fs.trace = (message) => messages.push(message);
	f.read(2);
	assert.match(messages[0], /host_read\(fd=0, bytes=2, data="ab"\)/);
});
