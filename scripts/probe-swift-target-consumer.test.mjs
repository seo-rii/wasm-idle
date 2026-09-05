import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { probeFileIdentity, validateWasmConsumerResult } from './lib/wasm-consumer-probe.mjs';
import { validateSwiftRuntimeManifest } from './llvm-contracts/swift/runtime-manifest.mjs';
import {
	SWIFT_TARGET_CASES,
	parseSwiftTargetArgs,
	readSwiftTargetInput,
	swiftConsumerGates,
	validateSwiftTargetReceipt
} from './probe-swift-target-consumer.mjs';

const fixtureSha256 = (
	await probeFileIdentity(
		new URL('./llvm-contracts/swift/fixtures/browser-stdin.swift', import.meta.url)
	)
).sha256;
const producerReceipt = () => ({
	format: 'wasm-llvm-swift-browser-target-v1',
	status: 'passed',
	compilerHost: 'native',
	sdk: 'swift-6.3.3-RELEASE_wasm',
	compilerVersion: 'Swift version 6.3.3 (swift-6.3.3-RELEASE)',
	fixtureSha256,
	artifact: { bytes: 9, sha256: 'a'.repeat(64) },
	gates: {
		browserTargetStdinStdout: true,
		browserHostedCompiler: false,
		browserHostedSwiftPM: false,
		ready: false
	},
	results: SWIFT_TARGET_CASES.map((fixture) => ({
		stdout: fixture.expectedOutput,
		stderr: '',
		exitCode: 0
	}))
});
const consumerResults = () =>
	['explicit', 'buffered'].flatMap((mode) =>
		SWIFT_TARGET_CASES.map((fixture) => ({
			name: fixture.name,
			mode,
			output: fixture.expectedOutput,
			error: null,
			success: true,
			prepared: true,
			ready: true,
			inputRequests: mode === 'buffered' ? 2 : 0,
			eofWrites: mode === 'buffered' ? 1 : 0
		}))
	);

test('native target evidence stays ineligible for the production Swift runtime manifest', () => {
	const receipt = producerReceipt();
	validateSwiftTargetReceipt(receipt, fixtureSha256);
	assert.ok(validateSwiftRuntimeManifest(receipt).length > 0);
	assert.deepEqual(swiftConsumerGates(consumerResults()), {
		productionWasmWorker: true,
		browserHostedCompiler: false,
		browserHostedSwiftPM: false,
		swiftRegistrationReady: false
	});
});

test('producer evidence rejects stale fixtures, incomplete execution, and compiler readiness claims', () => {
	const receipt = producerReceipt();
	assert.throws(
		() => validateSwiftTargetReceipt(receipt, '0'.repeat(64)),
		/different Swift fixture/
	);
	receipt.gates.ready = true;
	assert.throws(
		() => validateSwiftTargetReceipt(receipt, fixtureSha256),
		/cannot enable browser Swift/
	);
	receipt.gates.ready = false;
	receipt.results.pop();
	assert.throws(() => validateSwiftTargetReceipt(receipt, fixtureSha256));
	const wrongOutput = producerReceipt();
	wrongOutput.results[0].stdout = '';
	assert.throws(
		() => validateSwiftTargetReceipt(wrongOutput, fixtureSha256),
		/producer output mismatch/
	);
});

test('changed target bytes fail before bundling or launching a browser', async (t) => {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'swift-consumer-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const receiptFile = path.join(directory, 'receipt.json');
	const wasm = path.join(directory, 'program.wasm');
	await writeFile(receiptFile, JSON.stringify(producerReceipt()));
	await writeFile(wasm, 'changed bytes');
	await assert.rejects(readSwiftTargetInput(receiptFile, wasm), /Swift target artifact changed/);
});

test('consumer success requires every case through explicit and actual shared-buffer EOF input', () => {
	const results = consumerResults();
	assert.equal(swiftConsumerGates(results.slice(0, 3)).productionWasmWorker, false);
	results[3].eofWrites = 0;
	assert.equal(swiftConsumerGates(results).productionWasmWorker, false);
	results[3].eofWrites = 1;
	results[4] = results[3];
	assert.equal(swiftConsumerGates(results).productionWasmWorker, false);
});

test('shared probe distinguishes expected guest errors from successful execution', () => {
	const fixture = {
		name: 'invalid-input',
		expectedOutput: 'invalid integer\n',
		expectedError: 'WASM module exited with code 2'
	};
	const result = {
		output: fixture.expectedOutput,
		error: fixture.expectedError,
		prepared: true,
		ready: true,
		success: false
	};
	validateWasmConsumerResult(fixture, result);
	assert.throws(() => validateWasmConsumerResult(fixture, { ...result, success: true }));
	assert.throws(() =>
		validateWasmConsumerResult(fixture, { ...result, error: 'unexpected trap' })
	);
	assert.throws(() => validateWasmConsumerResult(fixture, { ...result, prepared: false }));
});

test('probe requires an explicit target and receipt and rejects duplicate or unknown options', () => {
	assert.throws(() => parseSwiftTargetArgs([]), /required/);
	assert.throws(() => parseSwiftTargetArgs(['--wasm', 'a', '--wasm', 'b']), /duplicate/);
	assert.throws(() => parseSwiftTargetArgs(['--producer-receipt', '--wasm']), /invalid option/);
	assert.throws(() => parseSwiftTargetArgs(['--enable-swift', 'yes']), /invalid option/);
});
