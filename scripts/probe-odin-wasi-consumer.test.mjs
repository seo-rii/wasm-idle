import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	loadOdinTarget,
	ODIN_SOURCE_COMMIT,
	ODIN_TARGET_CASES,
	validateOdinTargetReceipt
} from './probe-odin-wasi-consumer.mjs';

function baseline() {
	return {
		schemaVersion: 1,
		producerId: 'wasm-llvm/odin-browser',
		kind: 'native-wasi-baseline',
		status: 'passed',
		browserCompilerReady: false,
		source: { repository: 'https://github.com/odin-lang/Odin.git', commit: ODIN_SOURCE_COMMIT },
		cases: structuredClone(ODIN_TARGET_CASES),
		producerFiles: [
			{
				path: 'fixtures/cases.json',
				sha256: '29b01bf69859ba245c83401192a6874cb2476fbbb8b0bb824fe8b6472fbc8b1b'
			},
			{
				path: 'fixtures/stdin-sum/main.odin',
				sha256: '89aef81e9fdd213521b72918c18bcbe9feec9a5bf41154a0a565c9c2e3594412'
			},
			{
				path: 'fixtures/stdin-sum/stats.odin',
				sha256: 'e9e62b0d51a39c91fd9ba7e2db4572ceefc077cb44ba81e0a83aeac2af7ef4a2'
			}
		],
		outputs: ['stdin-sum.o', 'stdin-sum.wasm'].map((name) => ({
			path: name,
			bytes: 9,
			sha256: '0'.repeat(64)
		}))
	};
}

test('native Odin evidence cannot claim browser compiler readiness or a different source', () => {
	validateOdinTargetReceipt(baseline());
	for (const change of [
		(receipt) => {
			receipt.browserCompilerReady = true;
		},
		(receipt) => {
			receipt.kind = 'browser-compiler';
		},
		(receipt) => {
			receipt.source.commit = '0'.repeat(40);
		},
		(receipt) => {
			receipt.producerFiles[0].sha256 = '0'.repeat(64);
		}
	]) {
		const receipt = baseline();
		change(receipt);
		assert.throws(() => validateOdinTargetReceipt(receipt));
	}
});

test('receipt validation rejects changed stdin, dropped failures, unsafe output paths and sizes', () => {
	for (const change of [
		(receipt) => {
			receipt.cases[0].stdin = '42\n';
		},
		(receipt) => {
			receipt.cases.pop();
		},
		(receipt) => {
			receipt.cases[3].exitCode = 0;
		},
		(receipt) => {
			receipt.outputs[1].path = '../stdin-sum.wasm';
		},
		(receipt) => {
			receipt.outputs[0].bytes = 9 * 1024 * 1024;
		},
		(receipt) => {
			receipt.outputs[1].sha256 = 'invalid';
		}
	]) {
		const receipt = baseline();
		change(receipt);
		assert.throws(() => validateOdinTargetReceipt(receipt));
	}
});

test('changed artifact bytes fail before browser startup', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'odin-target-tamper-test-'));
	try {
		const receipt = path.join(directory, 'receipt.json');
		await writeFile(receipt, JSON.stringify(baseline()));
		await writeFile(path.join(directory, 'stdin-sum.o'), Buffer.alloc(9));
		await assert.rejects(loadOdinTarget(receipt), /checksum mismatch/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
