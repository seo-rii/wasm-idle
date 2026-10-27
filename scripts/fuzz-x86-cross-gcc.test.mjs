// Harness validation tests only. None of these synthetic byte buffers qualify GCC.
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertOutput, parseOptions, validateCorpus } from './fuzz-x86-cross-gcc.mjs';

const digest = 'a'.repeat(64);
const manifest = {
	compiler: { family: 'gcc', version: '16.2.0' },
	host: 'wasm32-emscripten',
	target: 'x86_64-linux-gnu',
	assets: { sysroot: { sha256: 'b'.repeat(64) } }
};
function fixture() {
	return {
		schemaVersion: 1,
		kind: 'gcc-generated-fuzz-corpus',
		seed: 42,
		compilerIdentity: {
			...manifest,
			manifestSha256: digest,
			sysrootSha256: manifest.assets.sysroot.sha256
		},
		cases: [
			{
				id: 'case-000000',
				index: 0,
				request: {
					code: 'int main(void) { return 0; }',
					language: 'c',
					cpu: 'x86-64',
					emit: 'executable',
					optimization: '2',
					standard: 'gnu17'
				},
				stdin: '',
				expectedStdout: ''
			}
		]
	};
}
function artifact(bytes, format = 'elf-executable') {
	return {
		compiler: 'gcc',
		compilerHost: manifest.host,
		target: manifest.target,
		cpu: 'x86-64',
		format,
		bytes
	};
}

test('fuzz replay refuses unpinned input and unbounded campaigns', () => {
	assert.throws(() => parseOptions(['m', 'c', 'out']), /Required --manifest-sha256/);
	for (const [key, value] of [
		['max-cases', '257'],
		['max-seconds', '3601'],
		['case-seconds', '0']
	])
		assert.throws(() =>
			parseOptions(['m', 'c', 'out', '--manifest-sha256', digest, `--${key}`, value])
		);
	assert.equal(parseOptions(['m', 'c', 'out', '--manifest-sha256', digest]).maxCases, 32);
});

test('replay corpus must belong to the exact compiler, sysroot, and assets', () => {
	assert.equal(validateCorpus(fixture(), manifest, digest).length, 1);
	for (const key of ['manifestSha256', 'sysrootSha256', 'host', 'target']) {
		const corpus = fixture();
		corpus.compilerIdentity[key] = 'wrong';
		assert.throws(() => validateCorpus(corpus, manifest, digest), /mismatch/);
	}
	const corpus = fixture();
	corpus.compilerIdentity.assets = { ...corpus.compilerIdentity.assets, injected: {} };
	assert.throws(() => validateCorpus(corpus, manifest, digest), /assets mismatch/);
});

test('replay prevents output path escape, evidence overwrite, and AVX execution', () => {
	const corpus = fixture();
	corpus.cases[0].id = '../outside';
	assert.throws(() => validateCorpus(corpus, manifest, digest), /Unsafe case id/);
	corpus.cases[0].id = 'case-000000';
	corpus.cases.push(structuredClone(corpus.cases[0]));
	assert.throws(() => validateCorpus(corpus, manifest, digest), /Duplicate case/);
	corpus.cases.pop();
	corpus.cases[0].request.cpu = 'avx2-fma';
	assert.throws(() => validateCorpus(corpus, manifest, digest), /baseline CPU/);
	corpus.cases[0].request.cpu = 'x86-64';
	corpus.cases[0].check = 'avx2-fma';
	assert.throws(() => validateCorpus(corpus, manifest, digest), /never executed/);
});

test('native execution gate rejects Wasm, wrong ELF targets, and dynamic executables', () => {
	const item = fixture().cases[0];
	assert.throws(
		() => assertOutput(item, artifact(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))),
		/ELF64/
	);
	const bytes = Buffer.alloc(120);
	bytes.set([127, 69, 76, 70, 2, 1, 1]);
	bytes.writeUInt16LE(2, 16);
	bytes.writeUInt16LE(62, 18);
	bytes.writeBigUInt64LE(4096n, 24);
	bytes.writeBigUInt64LE(64n, 32);
	bytes.writeUInt16LE(64, 52);
	bytes.writeUInt16LE(56, 54);
	bytes.writeUInt16LE(1, 56);
	bytes.writeUInt32LE(1, 64);
	assert.doesNotThrow(() => assertOutput(item, artifact(bytes)));
	bytes.writeUInt16LE(183, 18);
	assert.throws(() => assertOutput(item, artifact(bytes)), /x86-64/);
	bytes.writeUInt16LE(62, 18);
	bytes.writeUInt32LE(3, 64);
	assert.throws(() => assertOutput(item, artifact(bytes)), /PT_INTERP/);
});

test('function checks detect target pragma leakage despite AVX elsewhere', () => {
	const item = fixture().cases[0];
	item.request.emit = 'assembly';
	item.check = 'avx2-fma';
	item.assemblyChecks = [
		{ function: 'baseline', require: ['\\bpaddd\\b'], forbid: ['%ymm[0-9]+'] }
	];
	const assembly =
		'.text\navx:\n vpaddd %ymm0, %ymm1, %ymm2\n vfmadd132ps %ymm0, %ymm1, %ymm2\n .size avx, .-avx\nbaseline:\n paddd %xmm0, %xmm1\n .size baseline, .-baseline\n.ident "GCC: synthetic assertion test only"\n';
	assert.doesNotThrow(() => assertOutput(item, artifact(Buffer.from(assembly), 'assembly')));
	assert.throws(
		() =>
			assertOutput(
				item,
				artifact(
					Buffer.from(
						assembly.replace(
							'paddd %xmm0, %xmm1',
							'paddd %xmm0, %xmm1\n vmovdqu %ymm0, (%rax)'
						)
					),
					'assembly'
				)
			),
		/forbidden/
	);
});
