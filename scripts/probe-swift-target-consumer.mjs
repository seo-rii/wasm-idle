#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeFileIdentity, runWasmConsumerProbe } from './lib/wasm-consumer-probe.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const FIXTURE = path.join(REPO_ROOT, 'scripts/llvm-contracts/swift/fixtures/browser-stdin.swift');
export const SWIFT_TARGET_CASES = [
	{
		name: 'sum-unicode-eof',
		stdin: '3\n10 20 30\n안녕\n',
		expectedOutput: 'sum=60\ntext=안녕\neof=true\n'
	},
	{
		name: 'unterminated-final-line',
		stdin: '2\n-5 9\nlast',
		expectedOutput: 'sum=4\ntext=last\neof=true\n'
	},
	{ name: 'empty-eof', stdin: '', expectedOutput: 'sum=0\ntext=<eof>\neof=true\n' }
];

export function validateSwiftTargetReceipt(receipt, fixtureSha256) {
	assert.equal(
		receipt?.format,
		'wasm-llvm-swift-browser-target-v1',
		'not a Swift target probe receipt'
	);
	assert.equal(receipt.status, 'passed', 'producer target probe did not pass');
	assert.equal(receipt.compilerHost, 'native', 'this handoff describes a native compiler target');
	assert.equal(receipt.sdk, 'swift-6.3.3-RELEASE_wasm');
	assert.match(receipt.compilerVersion, /^Swift version 6\.3\.3 /);
	assert.equal(
		receipt.fixtureSha256,
		fixtureSha256,
		'producer compiled a different Swift fixture'
	);
	assert.deepEqual(
		receipt.gates,
		{
			browserTargetStdinStdout: true,
			browserHostedCompiler: false,
			browserHostedSwiftPM: false,
			ready: false
		},
		'native target evidence cannot enable browser Swift compiler readiness'
	);
	assert.ok(Number.isSafeInteger(receipt.artifact?.bytes) && receipt.artifact.bytes > 8);
	assert.match(receipt.artifact.sha256, /^[a-f0-9]{64}$/);
	assert.equal(receipt.results?.length, SWIFT_TARGET_CASES.length);
	for (const [index, fixture] of SWIFT_TARGET_CASES.entries()) {
		const result = receipt.results[index];
		assert.equal(
			result.stdout,
			fixture.expectedOutput,
			`producer output mismatch: ${fixture.name}`
		);
		assert.equal(result.stderr, '');
		assert.equal(result.exitCode, 0);
		assert.ok(!result.error, `producer case failed: ${fixture.name}`);
	}
}

export async function readSwiftTargetInput(producerReceipt, wasm) {
	const receiptBytes = await readFile(producerReceipt);
	const receipt = JSON.parse(receiptBytes.toString('utf8'));
	const fixture = await probeFileIdentity(FIXTURE);
	validateSwiftTargetReceipt(receipt, fixture.sha256);
	const wasmBytes = await readFile(wasm);
	const actual = {
		bytes: wasmBytes.length,
		sha256: createHash('sha256').update(wasmBytes).digest('hex')
	};
	assert.deepEqual(
		actual,
		{ bytes: receipt.artifact.bytes, sha256: receipt.artifact.sha256 },
		'Swift target artifact changed'
	);
	const module = await WebAssembly.compile(wasmBytes);
	assert.ok(
		WebAssembly.Module.imports(module).every(
			(entry) => entry.module === 'wasi_snapshot_preview1'
		),
		'unexpected Swift target imports'
	);
	assert.ok(
		WebAssembly.Module.exports(module).some(
			(entry) => entry.name === '_start' && entry.kind === 'function'
		),
		'Swift target is not a WASI command'
	);
	return {
		receipt,
		wasmBytes,
		artifact: actual,
		fixture,
		producerReceipt: {
			bytes: receiptBytes.length,
			sha256: createHash('sha256').update(receiptBytes).digest('hex')
		}
	};
}

export function swiftConsumerGates(results) {
	const passed =
		results.length === SWIFT_TARGET_CASES.length * 2 &&
		['explicit', 'buffered'].every((mode) =>
			SWIFT_TARGET_CASES.every((fixture) => {
				const matches = results.filter(
					(result) => result.mode === mode && result.name === fixture.name
				);
				return (
					matches.length === 1 &&
					matches[0].success === true &&
					matches[0].error === null &&
					matches[0].prepared === true &&
					matches[0].ready === true &&
					matches[0].output === fixture.expectedOutput &&
					(mode === 'explicit'
						? matches[0].inputRequests === 0
						: matches[0].inputRequests > 0 && matches[0].eofWrites > 0)
				);
			})
		);
	return {
		productionWasmWorker: passed,
		browserHostedCompiler: false,
		browserHostedSwiftPM: false,
		swiftRegistrationReady: false
	};
}

export async function probeSwiftTargetConsumer({
	producerReceipt,
	wasm,
	workRoot,
	executablePath
}) {
	const input = await readSwiftTargetInput(producerReceipt, wasm);
	workRoot ??= path.join(REPO_ROOT, '.cache/swift-target-consumer');
	await mkdir(workRoot, { recursive: true });
	const directory = await mkdtemp(path.join(workRoot, 'probe-'));
	const receipt = {
		format: 'wasm-idle-swift-target-consumer-v1',
		status: 'failed',
		compilerHost: 'native',
		producerReceipt: input.producerReceipt,
		artifact: input.artifact,
		fixture: input.fixture,
		probe: await probeFileIdentity(THIS_FILE),
		casesSha256: createHash('sha256').update(JSON.stringify(SWIFT_TARGET_CASES)).digest('hex'),
		gates: swiftConsumerGates([])
	};
	try {
		Object.assign(
			receipt,
			await runWasmConsumerProbe({
				wasmBytes: input.wasmBytes,
				cases: SWIFT_TARGET_CASES,
				workRoot: directory,
				executablePath
			})
		);
		receipt.gates = swiftConsumerGates(receipt.results);
		assert.equal(
			receipt.gates.productionWasmWorker,
			true,
			'Swift production runner acceptance is incomplete'
		);
		receipt.status = 'passed';
	} catch (error) {
		receipt.error = error.message;
	} finally {
		const receiptPath = path.join(directory, 'receipt.json');
		await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
			flag: 'wx',
			mode: 0o600
		});
		console.log(
			JSON.stringify({
				receipt: receiptPath,
				status: receipt.status,
				gates: receipt.gates,
				error: receipt.error
			})
		);
	}
	return receipt;
}

export function parseSwiftTargetArgs(argv) {
	const options = {};
	const keys = {
		'--producer-receipt': 'producerReceipt',
		'--wasm': 'wasm',
		'--work-root': 'workRoot',
		'--chromium': 'executablePath'
	};
	const args = argv[0] === '--' ? argv.slice(1) : argv;
	for (let index = 0; index < args.length; index += 2) {
		const key = keys[args[index]];
		assert.ok(
			key && args[index + 1] && !args[index + 1].startsWith('--'),
			`invalid option: ${args[index]}`
		);
		assert.ok(!(key in options), `duplicate option: ${args[index]}`);
		options[key] = path.resolve(args[index + 1]);
	}
	assert.ok(
		options.producerReceipt && options.wasm,
		'--producer-receipt and --wasm are required'
	);
	return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	if (process.argv.slice(2).includes('--help')) {
		console.log(
			'Usage: probe-swift-target-consumer.mjs --producer-receipt FILE --wasm FILE [--chromium FILE] [--work-root DIR]'
		);
	} else {
		try {
			const receipt = await probeSwiftTargetConsumer(
				parseSwiftTargetArgs(process.argv.slice(2))
			);
			if (receipt.status !== 'passed') process.exitCode = 1;
		} catch (error) {
			console.error(error.message);
			process.exitCode = 1;
		}
	}
}
