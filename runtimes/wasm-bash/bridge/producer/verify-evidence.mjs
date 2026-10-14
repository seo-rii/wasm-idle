// Read-only build evidence checks. No compilation, guest execution or downloads.
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyArchive, verifyLocalSources } from './build.mjs';
import { inspectBashShim, LOCK_SHA256, readProducerLock, sha256 } from './verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TESTED_COMMIT = '74abe3922c5a248b57ef0cb2d38d2d9a86fa1fc5';
const ARCHIVE_BASE_COMMIT = 'f5844b5212621a949318638ec7263faba2c1f3dd';
const RECEIPTS = {
	build: {
		file: 'evidence.bash-build.json',
		bytes: 22110,
		sha256: 'fb541666900f6ce1d71def362221b8b34a42b532dbcd7c10097f863e0021870f'
	},
	process: {
		file: 'evidence.bash-build-process.json',
		bytes: 890,
		sha256: '42b4a97da13ce11e3fd46a9802d49e36669d0b4874fe5ccef06ac9de12d8f012'
	}
};
const ARTIFACT_PATHS = {
	shimObject: 'work/execve.o',
	wasm: 'candidate/bash-exec-shim.wasm',
	license: 'candidate/LICENSE.txt',
	webc: 'candidate/bash-exec-shim.webc',
	sourceMaterials: 'source-materials.tar.gz'
};

export async function verifyBashBuildEvidence({ artifactRoot, inputCache } = {}) {
	assert.equal(
		Boolean(artifactRoot),
		Boolean(inputCache),
		'supply artifact root and input cache together'
	);
	const lock = await readProducerLock();
	const localFiles = await verifyLocalSources(lock);
	const receipts = {};
	for (const [name, identity] of Object.entries(RECEIPTS)) {
		const file = path.join(HERE, identity.file);
		assert.deepEqual(await verifyArchive(file, identity.sha256), {
			bytes: identity.bytes,
			sha256: identity.sha256
		});
		receipts[name] = JSON.parse(await readFile(file));
	}
	const { build, process: supervised } = receipts;
	assert.equal(build.status, 'built-imports-verified-not-runtime-qualified');
	assert.equal(build.producerVerified, true);
	assert.equal(build.runtimeQualified, false);
	assert.equal(build.lockSha256, LOCK_SHA256);
	assert.equal(build.sourceRevision, lock.sourceRevision);
	assert.deepEqual(build.baselineRecipe, lock.baselineRecipe);
	assert.deepEqual(build.sdkPrerequisite, lock.sdkPrerequisite);
	assert.deepEqual(build.localFiles, localFiles);
	assert.equal(supervised.exitCode, 0);
	assert.equal(supervised.termination, 'exited');
	assert.equal(supervised.cleanup.allReaped, true);
	assert.deepEqual(supervised.cleanup.remaining, []);
	assert.equal(build.commands.length, 13);
	assert(build.commands.every(({ exitCode, signal }) => exitCode === 0 && signal === null));
	assert.deepEqual(Object.keys(build.inputs), Object.keys(lock.inputs));
	for (const [name, input] of Object.entries(lock.inputs)) {
		assert.deepEqual(build.inputs[name], { ...input, bytes: build.inputs[name].bytes });
		assert(Number.isSafeInteger(build.inputs[name].bytes) && build.inputs[name].bytes > 0);
	}
	// These two source identities did not change between the real build and recheck.
	for (const name of ['verify.mjs', 'inputs.lock.json']) {
		const bytes = await readFile(path.join(HERE, name));
		assert.deepEqual(build.producerFiles[name], { bytes: bytes.length, sha256: sha256(bytes) });
	}
	const result = {
		schemaVersion: 1,
		status: artifactRoot ? 'external-artifacts-and-inputs-verified' : 'archived-receipts-verified',
		testedApplicationCommit: TESTED_COMMIT,
		archiveBaseApplicationCommit: ARCHIVE_BASE_COMMIT,
		lockSha256: LOCK_SHA256,
		receipts: RECEIPTS,
		process: { exitCode: 0, wallSeconds: supervised.wallSeconds, cleanupAllReaped: true },
		inputFiles: build.inputs,
		artifacts: build.artifacts,
		runtimeQualified: false,
		qualification: 'real build and import inspection only; no guest execution'
	};
	if (artifactRoot) {
		assert(
			path.isAbsolute(artifactRoot) && path.isAbsolute(inputCache),
			'absolute read-only paths required'
		);
		for (const [name, input] of Object.entries(build.inputs))
			assert.deepEqual(await verifyArchive(path.join(inputCache, input.filename), input.sha256), {
				bytes: input.bytes,
				sha256: input.sha256
			});
		for (const [name, relative] of Object.entries(ARTIFACT_PATHS)) {
			const expected = build.artifacts[name];
			assert.deepEqual(await verifyArchive(path.join(artifactRoot, relative), expected.sha256), {
				bytes: expected.bytes,
				sha256: expected.sha256
			});
		}
		assert.deepEqual(
			inspectBashShim(await readFile(path.join(artifactRoot, ARTIFACT_PATHS.wasm)), lock),
			build.artifacts.wasm
		);
		result.artifactRoot = artifactRoot;
		result.inputCache = inputCache;
	}
	return result;
}

const invoked = process.argv[1] && (await realpath(process.argv[1]).catch(() => null));
if (invoked === (await realpath(fileURLToPath(import.meta.url)))) {
	try {
		const args = process.argv.slice(2);
		assert(
			args.length === 0 ||
				(args.length === 4 && args[0] === '--artifact-root' && args[2] === '--input-cache'),
			'usage: verify-evidence.mjs [--artifact-root /absolute/output --input-cache /absolute/cache]'
		);
		console.log(
			JSON.stringify(
				await verifyBashBuildEvidence({ artifactRoot: args[1], inputCache: args[3] }),
				null,
				2
			)
		);
	} catch (error) {
		console.error(String(error));
		process.exitCode = 1;
	}
}
