import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

export const FULL_SYSROOT_SHA256 =
	'91899da37610664152a2a1cbae3632f35ff8803e32f006225c1c4fb50f341402';
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identity = (bytes) => ({ bytes: bytes.length, sha256: digest(bytes) });
const maxAssetBytes = 128 * 1024 * 1024;

export function validateProducerReceipts(producer, smoke, producerSha256) {
	assert.equal(producer.schemaVersion, 1);
	assert.equal(producer.complete, true, 'A completed producer receipt is required');
	assert.equal(producer.readOnlyInputsUnchanged, true, 'Producer inputs must remain unchanged');
	assert.equal(producer.profile?.profileId, 'wasm-llvm/clang-browser/tool-host-exec-v1');
	assert.equal(producer.profile?.abi?.module, 'wasm_idle_tool_host');
	assert.equal(producer.profile?.abi?.name, 'exec_v1');
	assert.equal(producer.profile?.initialCwd?.module, 'wasm_idle_process_v1');
	assert.equal(producer.profile?.initialCwd?.name, 'initial_cwd');
	assert.equal(producer.source?.revision, 'ca7933e47d3a3451d81e72ac174dcb5aa28b59d1');
	for (const name of ['clang', 'lld']) {
		const output = producer.outputs?.[`${name}.wasm`];
		assert.ok(output && /^[a-f0-9]{64}$/u.test(output.sha256));
		assert.ok(
			Number.isSafeInteger(output.bytes) && output.bytes > 8 && output.bytes <= maxAssetBytes
		);
		assert.deepEqual(
			smoke.inputs?.[name],
			output,
			'Producer smoke must execute these exact modules'
		);
	}
	assert.equal(smoke.schemaVersion, 1);
	assert.equal(
		smoke.passed,
		true,
		'Actual producer CLI smoke must pass before browser qualification'
	);
	assert.equal(
		smoke.producerReceiptSha256,
		producerSha256,
		'Smoke must refer to this producer receipt'
	);
	assert.equal(smoke.executedArtifactResult, 42);
	assert.ok(smoke.dispatches?.length > 0 && smoke.dispatches.every((entry) => entry.code === 0));
}

async function pinnedJson(env, prefix) {
	const path = env[prefix],
		expected = env[`${prefix}_SHA256`];
	assert.ok(
		path && /^[a-f0-9]{64}$/u.test(expected ?? ''),
		`Set ${prefix} and ${prefix}_SHA256 to an independently reviewed receipt pin`
	);
	assert.ok((await stat(path)).size <= 4 * 1024 * 1024, 'Receipt exceeds fixture limit');
	const bytes = await readFile(path);
	assert.equal(digest(bytes), expected, `${prefix} digest mismatch`);
	return { value: JSON.parse(bytes.toString('utf8')), sha256: expected };
}

export async function loadClangBrowserInputs(env) {
	const producer = await pinnedJson(env, 'CONTAINER_PRODUCER_RECEIPT');
	const smoke = await pinnedJson(env, 'CONTAINER_PRODUCER_SMOKE');
	validateProducerReceipts(producer.value, smoke.value, producer.sha256);
	const assets = {};
	for (const [name, variable] of [
		['clang', 'CONTAINER_CLANG_WASM'],
		['lld', 'CONTAINER_LLD_WASM'],
		['sysroot', 'CONTAINER_SYSROOT']
	]) {
		const path = env[variable];
		assert.ok(path, `Set ${variable}; missing real assets cannot qualify the browser fixture`);
		assert.ok((await stat(path)).size <= maxAssetBytes, `${variable} exceeds fixture limit`);
		const delivery = await readFile(path);
		const gzip = name !== 'sysroot' && path.endsWith('.gz');
		const bytes = gzip ? gunzipSync(delivery, { maxOutputLength: maxAssetBytes }) : delivery;
		const logical = identity(bytes);
		if (name === 'sysroot')
			assert.equal(
				logical.sha256,
				FULL_SYSROOT_SHA256,
				'Full selected-target sysroot pin mismatch'
			);
		else {
			assert.deepEqual(
				logical,
				producer.value.outputs[`${name}.wasm`],
				`${name} receipt mismatch`
			);
			assert.deepEqual([...bytes.subarray(0, 8)], [0, 97, 115, 109, 1, 0, 0, 0]);
		}
		const mediaType = name === 'sysroot' ? 'application/x-tar' : 'application/wasm';
		assets[name] = {
			delivery,
			metadata: {
				id: name,
				encoding: gzip ? 'gzip' : 'identity',
				delivery: {
					...identity(delivery),
					mediaType: gzip ? 'application/gzip' : mediaType
				},
				logical: { ...logical, mediaType }
			}
		};
	}
	return {
		assets,
		producer: producer.value,
		producerSha256: producer.sha256,
		producerSmokeSha256: smoke.sha256
	};
}
