import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	digest,
	loadClangBrowserInputs,
	validateProducerReceipts
} from '../../scripts/clang-browser-inputs.mjs';

// These are receipt validation unit tests, never evidence of compiler support.
const sha = 'a'.repeat(64),
	other = 'b'.repeat(64);
function receipts() {
	const output = { bytes: 10, sha256: sha };
	return {
		producer: {
			schemaVersion: 1,
			complete: true,
			readOnlyInputsUnchanged: true,
			profile: {
				profileId: 'wasm-llvm/clang-browser/tool-host-exec-v1',
				abi: { module: 'wasm_idle_tool_host', name: 'exec_v1' },
				initialCwd: { module: 'wasm_idle_process_v1', name: 'initial_cwd' }
			},
			source: { revision: 'ca7933e47d3a3451d81e72ac174dcb5aa28b59d1' },
			outputs: { 'clang.wasm': output, 'lld.wasm': output }
		},
		smoke: {
			schemaVersion: 1,
			passed: true,
			producerReceiptSha256: sha,
			executedArtifactResult: 42,
			inputs: { clang: output, lld: output },
			dispatches: [{ code: 0 }]
		}
	};
}
test('requires completed build and real CLI smoke linked to the exact producer receipt', () => {
	const { producer, smoke } = receipts();
	validateProducerReceipts(producer, smoke, sha);
	for (const update of [{ complete: false }, { readOnlyInputsUnchanged: false }])
		assert.throws(() => validateProducerReceipts({ ...producer, ...update }, smoke, sha));
	for (const update of [
		{ passed: false },
		{ producerReceiptSha256: other },
		{ dispatches: [] },
		{ inputs: { ...smoke.inputs, lld: { bytes: 10, sha256: other } } }
	])
		assert.throws(() => validateProducerReceipts(producer, { ...smoke, ...update }, sha));
	assert.throws(() =>
		validateProducerReceipts(
			{ ...producer, profile: { ...producer.profile, initialCwd: undefined } },
			smoke,
			sha
		)
	);
});
test('missing binaries and receipt pin mismatches cannot be reported as a skip or pass', async () => {
	await assert.rejects(loadClangBrowserInputs({}), /CONTAINER_PRODUCER_RECEIPT/u);
	const folder = await mkdtemp(join(tmpdir(), 'container-clang-browser-inputs-'));
	try {
		const { producer, smoke } = receipts();
		const bytes = Buffer.from(JSON.stringify(producer)),
			producerSha = digest(bytes);
		smoke.producerReceiptSha256 = producerSha;
		const smokeBytes = Buffer.from(JSON.stringify(smoke));
		const producerPath = join(folder, 'producer.json'),
			smokePath = join(folder, 'smoke.json');
		await writeFile(producerPath, bytes);
		await writeFile(smokePath, smokeBytes);
		const env = {
			CONTAINER_PRODUCER_RECEIPT: producerPath,
			CONTAINER_PRODUCER_RECEIPT_SHA256: producerSha,
			CONTAINER_PRODUCER_SMOKE: smokePath,
			CONTAINER_PRODUCER_SMOKE_SHA256: digest(smokeBytes)
		};
		await assert.rejects(
			loadClangBrowserInputs({ ...env, CONTAINER_PRODUCER_RECEIPT_SHA256: other }),
			/digest mismatch/u
		);
		await assert.rejects(loadClangBrowserInputs(env), /CONTAINER_CLANG_WASM/u);
	} finally {
		await rm(folder, { recursive: true, force: true });
	}
});
