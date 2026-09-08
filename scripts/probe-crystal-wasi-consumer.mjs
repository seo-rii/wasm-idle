import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const CRYSTAL_SOURCE_COMMIT = '57cf7da5094db6c5d3c058c6d054a757b5ced19e';
export const CRYSTAL_FIXTURE_SHA256 =
	'ad5a88f85deaf387fc81f4d7edfcf7e14e37519cadfbe55a2f56599d2d0a46fb';
const CRYSTAL_PRODUCER_COMMIT = '9b74e5c9ff67c505cadd272571abfeb127b5468e';
const CRYSTAL_PRODUCER_SCRIPT_SHA256 =
	'27426c76e70a82c7b3dded4a48222d61df4cc681227a588b50b57d9c78fe4164';
const CRYSTAL_NEGATIVE_FIXTURE_SHA256 =
	'679e6da1ff8da7264a78c02f564ac314f927dbfd1d4c8e53a1bb502654abac3d';
const CRYSTAL_COMPILER_SOURCE_SHA256 =
	'5e619d7d62d3e9c181ee39babf6d131429675d3005e0b5a020dcacb2edbe911b';
export const CRYSTAL_TARGET_LIBC = Object.freeze({
	bytes: 1040606,
	sha256: '42d929e52aaeac6c4ed56946cd3e92e40574322bc43af529c19cfbf67893b352',
	sdk: 'swift-6.3.3-RELEASE_wasm/wasm32-unknown-wasip1/WASI.sdk'
});
const LINKER_VERSION =
	'LLD 21.0.0 (https://github.com/swiftlang/llvm-project.git 82cdc19fa54d566969527b56f587ea8ea30bef51)';
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export const CRYSTAL_TARGET_CASES = Object.freeze([
	Object.freeze({ name: 'stdin-sum', stdin: '10 20 30\n', expectedOutput: '60\n' }),
	Object.freeze({ name: 'eof-without-newline', stdin: '-5 6 7 8', expectedOutput: '16\n' }),
	Object.freeze({
		name: 'utf8-across-buffer-boundary',
		stdin: '1 2\nabc한xyz\n',
		expectedOutput: 'abc한xyz\n3\n'
	}),
	Object.freeze({ name: 'empty-eof', stdin: '', expectedOutput: '0\n' })
]);

export function validateCrystalObjectReceipt(receipt) {
	assert.equal(
		receipt.format,
		'wasm-llvm-crystal-portability-v2',
		'wrong Crystal receipt format'
	);
	assert.deepEqual(
		receipt.producer,
		{
			gitCommit: CRYSTAL_PRODUCER_COMMIT,
			scriptSha256: CRYSTAL_PRODUCER_SCRIPT_SHA256
		},
		'unexpected Crystal producer identity'
	);
	assert.equal(receipt.target, 'wasm32-unknown-wasi', 'wrong Crystal target');
	assert.equal(receipt.sourceCommit, CRYSTAL_SOURCE_COMMIT, 'unexpected Crystal source revision');
	assert.equal(receipt.fixtureSha256, CRYSTAL_FIXTURE_SHA256, 'unexpected Crystal fixture');
	assert.deepEqual(
		receipt.fixtureSha256s,
		{
			baseline: CRYSTAL_FIXTURE_SHA256,
			negative: CRYSTAL_NEGATIVE_FIXTURE_SHA256
		},
		'unexpected Crystal fixture set'
	);
	assert.equal(
		receipt.bootstrap?.archiveSha256,
		'cc407bd071915cc7b5d9348281e669a911d20a1f4b9fac52a62088660eb22208',
		'unexpected Crystal bootstrap'
	);
	assert.deepEqual(
		receipt.gates,
		{
			nativeWasiObject: true,
			nativeDiagnostics: true,
			compilerHostObject: false,
			browserCompiler: false,
			browserStdinStdout: false,
			ready: false
		},
		'a native Crystal object receipt cannot claim browser compiler readiness'
	);
	const baseline = receipt.steps?.baseline;
	assert.deepEqual(
		baseline?.source,
		{
			path: 'producer/crystal-browser/fixtures/stdin-sum.cr',
			sha256: CRYSTAL_FIXTURE_SHA256
		},
		'unexpected Crystal baseline source'
	);
	assert.equal(baseline?.exitCode, 0, 'Crystal object compilation failed');
	assert.equal(baseline?.wasmObject, true, 'missing Crystal object evidence');
	assert.equal(receipt.steps?.negative?.exitCode, 1, 'missing upstream invalid-source rejection');
	assert.deepEqual(
		receipt.steps?.negative?.source,
		{
			path: 'producer/crystal-browser/fixtures/invalid.cr',
			sha256: CRYSTAL_NEGATIVE_FIXTURE_SHA256
		},
		'unexpected Crystal negative source'
	);
	assert.equal(receipt.steps?.compilerHost?.exitCode, 1, 'unexpected compiler-host probe result');
	assert.deepEqual(
		receipt.steps?.compilerHost?.source,
		{
			path: 'out/crystal-browser-work/source/src/compiler/crystal.cr',
			sha256: CRYSTAL_COMPILER_SOURCE_SHA256
		},
		'unexpected Crystal compiler-host source'
	);
	const object = baseline.object;
	assert.ok(
		object && typeof object.path === 'string' && path.basename(object.path) === 'baseline.wasm',
		'unexpected Crystal object name'
	);
	assert.ok(
		Number.isSafeInteger(object.bytes) &&
			object.bytes > 8 &&
			object.bytes <= MAX_ARTIFACT_BYTES,
		'invalid Crystal object size'
	);
	assert.match(object.sha256, /^[0-9a-f]{64}$/, 'invalid Crystal object checksum');
	return receipt;
}

async function readBounded(file, limit) {
	const info = await stat(file);
	assert.ok(info.isFile() && info.size > 0 && info.size <= limit, `invalid file size: ${file}`);
	const bytes = await readFile(file);
	assert.equal(bytes.byteLength, info.size, `file changed while reading: ${file}`);
	return bytes;
}

export async function loadCrystalObject(receiptPath) {
	const absoluteReceipt = path.resolve(receiptPath);
	const receiptBytes = await readBounded(absoluteReceipt, 1024 * 1024);
	const receipt = validateCrystalObjectReceipt(JSON.parse(receiptBytes.toString('utf8')));
	// Paths and printed commands in a compiler receipt are evidence, never instructions.
	const objectBytes = await readBounded(
		path.join(path.dirname(absoluteReceipt), 'baseline.wasm'),
		MAX_ARTIFACT_BYTES
	);
	assert.equal(
		objectBytes.byteLength,
		receipt.steps.baseline.object.bytes,
		'Crystal object size mismatch'
	);
	assert.equal(
		sha256(objectBytes),
		receipt.steps.baseline.object.sha256,
		'Crystal object checksum mismatch'
	);
	const module = await WebAssembly.compile(objectBytes);
	const linking = WebAssembly.Module.customSections(module, 'linking');
	assert.equal(linking.length, 1, 'Crystal baseline must be a relocatable object');
	assert.equal(new Uint8Array(linking[0])[0], 2, 'unsupported Crystal object linking version');
	return { receipt, receiptSha256: sha256(receiptBytes), objectBytes };
}

function runLinker(executable, args, cwd, libraryPath) {
	const result = spawnSync(executable, args, {
		cwd,
		argv0: 'wasm-ld',
		encoding: 'utf8',
		timeout: 60000,
		maxBuffer: 128 * 1024,
		env: {
			...process.env,
			LD_LIBRARY_PATH: [libraryPath, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
		}
	});
	if (result.error) throw result.error;
	assert.equal(
		result.status,
		0,
		`Crystal target linker failed: ${(result.stderr || '').slice(0, 4000)}`
	);
	return result.stdout.trim();
}

export async function prepareCrystalTargetLinker(linkerPath) {
	const executable = await realpath(path.resolve(linkerPath));
	const bytes = await readFile(executable);
	const privateDirectory = await mkdtemp(path.join(tmpdir(), 'crystal-target-linker-'));
	const privateExecutable = path.join(privateDirectory, 'wasm-ld');
	try {
		await writeFile(privateExecutable, bytes, { flag: 'wx', mode: 0o500 });
		const libraryPath = path.resolve(path.dirname(executable), '../lib');
		const identity = Object.freeze({
			version: LINKER_VERSION,
			argv0: 'wasm-ld',
			bytes: bytes.byteLength,
			sha256: sha256(bytes)
		});
		const run = (args, cwd) => runLinker(privateExecutable, args, cwd, libraryPath);
		assert.equal(
			sha256(await readFile(privateExecutable)),
			identity.sha256,
			'private target linker copy mismatch'
		);
		assert.equal(run(['--version']), LINKER_VERSION, 'unrecognized target linker version');
		return Object.freeze({
			identity,
			run,
			async verify() {
				assert.equal(
					sha256(await readFile(privateExecutable)),
					identity.sha256,
					'private target linker changed during use'
				);
			},
			async close() {
				await rm(privateDirectory, { recursive: true, force: true });
			}
		});
	} catch (error) {
		await rm(privateDirectory, { recursive: true, force: true });
		throw error;
	}
}

export async function probeCrystalWasiConsumer({
	receiptPath,
	libcPath,
	linkerPath,
	outputDirectory,
	executablePath
}) {
	const probeSha256 = sha256(await readFile(new URL(import.meta.url)));
	const target = await loadCrystalObject(receiptPath);
	const libcBytes = await readBounded(path.resolve(libcPath), MAX_ARTIFACT_BYTES);
	assert.equal(libcBytes.byteLength, CRYSTAL_TARGET_LIBC.bytes, 'unrecognized WASI libc size');
	assert.equal(sha256(libcBytes), CRYSTAL_TARGET_LIBC.sha256, 'unrecognized WASI libc checksum');
	const linker = await prepareCrystalTargetLinker(linkerPath);
	try {
		const workRoot = outputDirectory
			? path.resolve(outputDirectory)
			: await mkdtemp(path.join(tmpdir(), 'wasm-idle-crystal-consumer-'));
		await mkdir(workRoot, { recursive: true });
		const linkRoot = await mkdtemp(path.join(workRoot, 'link-'));
		await writeFile(path.join(linkRoot, 'program.o'), target.objectBytes);
		await writeFile(path.join(linkRoot, 'libc.a'), libcBytes);
		const linkArgs = [
			'program.o',
			'-L.',
			'-lc',
			'--stack-first',
			'-z',
			'stack-size=1048576',
			'-o',
			'stdin-sum.wasm'
		];
		linker.run(linkArgs, linkRoot);
		await linker.verify();
		const wasmBytes = await readBounded(
			path.join(linkRoot, 'stdin-sum.wasm'),
			MAX_ARTIFACT_BYTES
		);
		const module = await WebAssembly.compile(wasmBytes);
		assert.equal(
			WebAssembly.Module.customSections(module, 'linking').length,
			0,
			'Crystal target is still relocatable'
		);
		const imports = WebAssembly.Module.imports(module);
		assert.ok(
			imports.length &&
				imports.every(
					(entry) =>
						entry.kind === 'function' && entry.module === 'wasi_snapshot_preview1'
				),
			'Crystal target has unsupported host imports'
		);
		for (const name of ['fd_read', 'fd_write', 'proc_exit'])
			assert.ok(
				imports.some((entry) => entry.name === name),
				`Crystal target lacks ${name}`
			);
		const exports = WebAssembly.Module.exports(module);
		assert.ok(exports.some((entry) => entry.name === '_start' && entry.kind === 'function'));
		assert.ok(exports.some((entry) => entry.name === 'memory' && entry.kind === 'memory'));
		const { runWasmConsumerProbe } = await import('./lib/wasm-consumer-probe.mjs');
		const result = await runWasmConsumerProbe({
			wasmBytes,
			cases: CRYSTAL_TARGET_CASES,
			workRoot,
			executablePath
		});
		assert.equal(
			sha256(await readFile(new URL(import.meta.url))),
			probeSha256,
			'Crystal consumer probe changed during acceptance'
		);
		const evidence = {
			format: 'wasm-idle-crystal-wasi-consumer-v1',
			status: 'passed',
			compilerHost: 'native',
			linkerHost: 'native',
			sourceCommit: CRYSTAL_SOURCE_COMMIT,
			producerReceiptSha256: target.receiptSha256,
			object: { bytes: target.objectBytes.byteLength, sha256: sha256(target.objectBytes) },
			libc: CRYSTAL_TARGET_LIBC,
			linker: linker.identity,
			linkArgs,
			artifact: { bytes: wasmBytes.byteLength, sha256: sha256(wasmBytes) },
			consumerProbeSha256: probeSha256,
			...result,
			gates: {
				browserTargetExecution: true,
				browserHostedCompiler: false,
				consumerLanguageRegistration: false
			},
			completedAt: new Date().toISOString()
		};
		const evidencePath = path.join(workRoot, 'crystal-consumer-receipt.json');
		await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n', {
			flag: 'wx',
			mode: 0o600
		});
		return { evidence, evidencePath };
	} finally {
		await linker.close();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const { values } = parseArgs({
		options: {
			receipt: { type: 'string' },
			libc: { type: 'string' },
			'wasm-ld': { type: 'string' },
			out: { type: 'string' },
			chromium: { type: 'string' }
		}
	});
	if (!values.receipt || !values.libc || !values['wasm-ld'])
		throw new Error(
			'Usage: node scripts/probe-crystal-wasi-consumer.mjs --receipt <receipt.json> --libc <libc.a> --wasm-ld <executable> [--out <new-directory>] [--chromium <executable>]'
		);
	const { evidencePath, evidence } = await probeCrystalWasiConsumer({
		receiptPath: values.receipt,
		libcPath: values.libc,
		linkerPath: values['wasm-ld'],
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
