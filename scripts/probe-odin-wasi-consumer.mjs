import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const ODIN_SOURCE_COMMIT = 'a2fb372b76e81ef31fbbc8a2cf2b4fdf5ac6c924';
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const FIXTURE_HASHES = Object.freeze({
	'fixtures/cases.json': '29b01bf69859ba245c83401192a6874cb2476fbbb8b0bb824fe8b6472fbc8b1b',
	'fixtures/stdin-sum/main.odin':
		'89aef81e9fdd213521b72918c18bcbe9feec9a5bf41154a0a565c9c2e3594412',
	'fixtures/stdin-sum/stats.odin':
		'e9e62b0d51a39c91fd9ba7e2db4572ceefc077cb44ba81e0a83aeac2af7ef4a2'
});

export const ODIN_TARGET_CASES = Object.freeze([
	Object.freeze({
		name: 'stdin',
		stdin: '5\n7\n30\n',
		stdout: 'count=3 sum=42\n',
		stderr: '',
		exitCode: 0
	}),
	Object.freeze({
		name: 'eof-without-newline',
		stdin: '-9\n4\n2',
		stdout: 'count=3 sum=-3\n',
		stderr: '',
		exitCode: 0
	}),
	Object.freeze({
		name: 'empty-eof',
		stdin: '',
		stdout: 'count=0 sum=0\n',
		stderr: '',
		exitCode: 0
	}),
	Object.freeze({
		name: 'invalid-input',
		stdin: 'abc\n',
		stdout: '',
		stderr: 'invalid integer\n',
		exitCode: 2
	})
]);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function validateOdinTargetReceipt(receipt) {
	assert.equal(receipt.schemaVersion, 1, 'unsupported Odin receipt schema');
	assert.equal(receipt.producerId, 'wasm-llvm/odin-browser', 'wrong Odin producer');
	assert.equal(receipt.kind, 'native-wasi-baseline', 'expected a native Odin target baseline');
	assert.equal(receipt.status, 'passed', 'Odin native baseline did not pass');
	assert.equal(
		receipt.browserCompilerReady,
		false,
		'a native Odin receipt cannot enable browser compilation'
	);
	assert.equal(receipt.source?.repository, 'https://github.com/odin-lang/Odin.git');
	assert.equal(receipt.source?.commit, ODIN_SOURCE_COMMIT, 'unexpected Odin source revision');
	assert.deepEqual(
		receipt.cases,
		ODIN_TARGET_CASES,
		'Odin input/output evidence differs from the pinned fixtures'
	);
	assert.ok(Array.isArray(receipt.producerFiles), 'missing Odin fixture identities');
	for (const [name, hash] of Object.entries(FIXTURE_HASHES)) {
		const entries = receipt.producerFiles.filter((entry) => entry.path === name);
		assert.equal(entries.length, 1, `missing or duplicate fixture ${name}`);
		assert.equal(entries[0].sha256, hash, `unexpected fixture ${name}`);
	}
	assert.ok(Array.isArray(receipt.outputs));
	assert.equal(receipt.outputs.length, 2, 'expected the Odin object and linked target');
	for (const name of ['stdin-sum.o', 'stdin-sum.wasm']) {
		const entries = receipt.outputs.filter((entry) => entry.path === name);
		assert.equal(entries.length, 1, `missing or duplicate Odin output ${name}`);
		const entry = entries[0];
		assert.ok(
			Number.isSafeInteger(entry.bytes) &&
				entry.bytes > 8 &&
				entry.bytes <= MAX_ARTIFACT_BYTES,
			'invalid Odin output size'
		);
		assert.match(entry.sha256, /^[0-9a-f]{64}$/, 'invalid Odin output hash');
	}
	return receipt;
}

async function readBounded(file, limit) {
	const info = await stat(file);
	assert.ok(info.isFile() && info.size > 0 && info.size <= limit, `invalid file size: ${file}`);
	const bytes = await readFile(file);
	assert.equal(bytes.byteLength, info.size, `file changed while reading: ${file}`);
	return bytes;
}

export async function loadOdinTarget(receiptPath) {
	const absoluteReceipt = path.resolve(receiptPath);
	const receiptBytes = await readBounded(absoluteReceipt, 1024 * 1024);
	const receipt = validateOdinTargetReceipt(JSON.parse(receiptBytes.toString('utf8')));
	let wasmBytes;
	for (const entry of receipt.outputs) {
		const bytes = await readBounded(
			path.join(path.dirname(absoluteReceipt), entry.path),
			MAX_ARTIFACT_BYTES
		);
		assert.equal(bytes.byteLength, entry.bytes, `Odin ${entry.path} size mismatch`);
		assert.equal(sha256(bytes), entry.sha256, `Odin ${entry.path} checksum mismatch`);
		if (entry.path === 'stdin-sum.wasm') wasmBytes = bytes;
	}
	const module = await WebAssembly.compile(wasmBytes);
	assert.equal(
		WebAssembly.Module.customSections(module, 'linking').length,
		0,
		'expected a linked Odin target, not an object'
	);
	const imports = WebAssembly.Module.imports(module);
	assert.ok(
		imports.length > 0 &&
			imports.every(
				(entry) => entry.kind === 'function' && entry.module === 'wasi_snapshot_preview1'
			),
		'Odin target has unsupported host imports'
	);
	for (const name of ['fd_read', 'fd_write', 'proc_exit'])
		assert.ok(
			imports.some((entry) => entry.name === name),
			`Odin target lacks ${name}`
		);
	const exports = WebAssembly.Module.exports(module);
	assert.ok(exports.some((entry) => entry.name === '_start' && entry.kind === 'function'));
	assert.ok(exports.some((entry) => entry.name === 'memory' && entry.kind === 'memory'));
	return { receipt, receiptSha256: sha256(receiptBytes), wasmBytes };
}

export async function probeOdinWasiConsumer({ receiptPath, outputDirectory, executablePath }) {
	const probeSha256 = sha256(await readFile(new URL(import.meta.url)));
	const target = await loadOdinTarget(receiptPath);
	const workRoot = outputDirectory
		? path.resolve(outputDirectory)
		: await mkdtemp(path.join(tmpdir(), 'wasm-idle-odin-consumer-'));
	await mkdir(workRoot, { recursive: true });
	const { runWasmConsumerProbe } = await import('./lib/wasm-consumer-probe.mjs');
	const result = await runWasmConsumerProbe({
		wasmBytes: target.wasmBytes,
		workRoot,
		executablePath,
		cases: ODIN_TARGET_CASES.map((entry) => ({
			name: entry.name,
			stdin: entry.stdin,
			expectedOutput: entry.stdout + entry.stderr,
			...(entry.exitCode
				? { expectedError: `WASM module exited with code ${entry.exitCode}` }
				: {})
		}))
	});
	assert.equal(
		sha256(await readFile(new URL(import.meta.url))),
		probeSha256,
		'Odin consumer probe changed during acceptance'
	);
	const evidence = {
		format: 'wasm-idle-odin-wasi-consumer-v1',
		status: 'passed',
		compilerHost: 'native',
		sourceCommit: ODIN_SOURCE_COMMIT,
		producerReceiptSha256: target.receiptSha256,
		artifact: { bytes: target.wasmBytes.byteLength, sha256: sha256(target.wasmBytes) },
		consumerProbeSha256: probeSha256,
		...result,
		gates: {
			browserTargetExecution: true,
			browserHostedCompiler: false,
			consumerLanguageRegistration: false
		},
		completedAt: new Date().toISOString()
	};
	const evidencePath = path.join(workRoot, 'odin-consumer-receipt.json');
	await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n', {
		flag: 'wx',
		mode: 0o600
	});
	return { evidence, evidencePath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const { values } = parseArgs({
		options: {
			receipt: { type: 'string' },
			out: { type: 'string' },
			chromium: { type: 'string' }
		}
	});
	if (!values.receipt)
		throw new Error(
			'Usage: node scripts/probe-odin-wasi-consumer.mjs --receipt <native-baseline-receipt.json> [--out <new-directory>] [--chromium <executable>]'
		);
	const { evidencePath, evidence } = await probeOdinWasiConsumer({
		receiptPath: values.receipt,
		outputDirectory: values.out,
		executablePath: values.chromium
	});
	console.log(
		JSON.stringify({
			receipt: evidencePath,
			status: evidence.status,
			cases: evidence.results.length
		})
	);
}
