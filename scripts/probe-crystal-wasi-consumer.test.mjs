import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	CRYSTAL_FIXTURE_SHA256,
	CRYSTAL_SOURCE_COMMIT,
	loadCrystalObject,
	prepareCrystalTargetLinker,
	validateCrystalObjectReceipt
} from './probe-crystal-wasi-consumer.mjs';

test('linking executes the verified target even if the caller symlink is repointed', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'crystal-linker-symlink-test-'));
	try {
		const version =
			'LLD 21.0.0 (https://github.com/swiftlang/llvm-project.git 82cdc19fa54d566969527b56f587ea8ea30bef51)';
		const executable = path.join(directory, 'verified-linker');
		const replacement = path.join(directory, 'replacement-linker');
		const command = path.join(directory, 'wasm-ld');
		await writeFile(
			executable,
			`#!${process.execPath}\nconsole.log(process.argv.includes('--version') ? ${JSON.stringify(version)} : 'verified');\n`,
			{ mode: 0o700 }
		);
		await writeFile(replacement, `#!${process.execPath}\nconsole.log('replacement');\n`, {
			mode: 0o700
		});
		await symlink(executable, command);
		const linker = await prepareCrystalTargetLinker(command);
		await unlink(command);
		await symlink(replacement, command);
		assert.equal(linker.run(['--sentinel'], directory), 'verified');
		await linker.verify();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

function baseline() {
	return {
		format: 'wasm-llvm-crystal-portability-v1',
		target: 'wasm32-unknown-wasi',
		sourceCommit: CRYSTAL_SOURCE_COMMIT,
		fixtureSha256: CRYSTAL_FIXTURE_SHA256,
		bootstrap: {
			archiveSha256: 'cc407bd071915cc7b5d9348281e669a911d20a1f4b9fac52a62088660eb22208'
		},
		gates: {
			nativeWasiObject: true,
			nativeDiagnostics: true,
			compilerHostObject: false,
			browserCompiler: false,
			browserStdinStdout: false,
			ready: false
		},
		steps: {
			baseline: {
				exitCode: 0,
				wasmObject: true,
				object: { path: '/producer/output/baseline.wasm', bytes: 9, sha256: '0'.repeat(64) }
			},
			negative: { exitCode: 1 },
			compilerHost: { exitCode: 1 }
		}
	};
}

test('native Crystal objects cannot claim browser compiler or consumer readiness', () => {
	validateCrystalObjectReceipt(baseline());
	for (const key of ['compilerHostObject', 'browserCompiler', 'browserStdinStdout', 'ready']) {
		const receipt = baseline();
		receipt.gates[key] = true;
		assert.throws(() => validateCrystalObjectReceipt(receipt), /cannot claim browser/);
	}
});

test('rejects different sources, fixtures, missing compiler results and malformed object metadata', () => {
	for (const change of [
		(receipt) => {
			receipt.sourceCommit = '0'.repeat(40);
		},
		(receipt) => {
			receipt.fixtureSha256 = '0'.repeat(64);
		},
		(receipt) => {
			receipt.steps.baseline.exitCode = 1;
		},
		(receipt) => {
			receipt.steps.baseline.object.path = '/unrelated.wasm';
		},
		(receipt) => {
			receipt.steps.baseline.object.bytes = 9 * 1024 * 1024;
		},
		(receipt) => {
			receipt.steps.baseline.object.sha256 = 'invalid';
		},
		(receipt) => {
			delete receipt.steps.negative;
		}
	]) {
		const receipt = baseline();
		change(receipt);
		assert.throws(() => validateCrystalObjectReceipt(receipt));
	}
});

test('loads the adjacent object and rejects tampering before any linker or browser starts', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'crystal-object-tamper-test-'));
	try {
		const receipt = path.join(directory, 'receipt.json');
		await writeFile(receipt, JSON.stringify(baseline()));
		await writeFile(path.join(directory, 'baseline.wasm'), Buffer.alloc(9));
		await assert.rejects(loadCrystalObject(receipt), /checksum mismatch/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
