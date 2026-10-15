// Read-only evidence verification; no compilation, downloads or guest execution.
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyArchive, verifyLocalSources, verifyStartupCwdSources } from './build.mjs';
import { inspectBashShim, LOCK_SHA256, readProducerLock, sha256 } from './verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECEIPTS = {
	build: {
		file: 'evidence.startup-cwd-build.json',
		bytes: 26366,
		sha256: '777a96e9abe679788a6ba25774cb277c0535f05aed7e238e6dee225fa7ba0baa'
	},
	process: {
		file: 'evidence.startup-cwd-process.json',
		bytes: 909,
		sha256: '8265d8bfb9a8b838535778d2bde2376f85e58a1b15ad3193744643776bc10f8e'
	},
	recheck: {
		file: 'evidence.startup-cwd-recheck.json',
		bytes: 15127,
		sha256: '69245734c818f58ea2077559c80368bd9ab8b239a5e23123c68fec540e45ec16'
	}
};

export async function verifyStartupCwdEvidence({ artifactRoot, inputCache } = {}) {
	assert.equal(Boolean(artifactRoot), Boolean(inputCache), 'supply both external paths together');
	const receipts = {};
	for (const [name, { file, ...identity }] of Object.entries(RECEIPTS)) {
		assert.deepEqual(await verifyArchive(path.join(HERE, file), identity.sha256), identity);
		receipts[name] = JSON.parse(await readFile(path.join(HERE, file)));
	}
	const { build, process: supervised, recheck } = receipts;
	const lock = await readProducerLock();
	assert.equal(build.status, 'built-imports-verified-not-runtime-qualified');
	assert.equal(build.producerVerified, true);
	assert.equal(build.runtimeQualified, false);
	assert.equal(build.lockSha256, LOCK_SHA256);
	assert.equal(build.sourceRevision, lock.sourceRevision);
	const startupCwd = await verifyStartupCwdSources();
	assert.deepEqual(build.localFiles, {
		...(await verifyLocalSources(lock)),
		[startupCwd.source.path]: {
			bytes: startupCwd.source.bytes,
			sha256: startupCwd.source.sha256
		}
	});
	assert.deepEqual(build.recipe.startupCwd, startupCwd);
	// README may describe later results; every executable producer dependency stays pinned.
	for (const [name, identity] of Object.entries(build.producerFiles)) {
		if (name === 'README.md') continue;
		const bytes = await readFile(path.join(HERE, name));
		assert.deepEqual({ bytes: bytes.length, sha256: sha256(bytes) }, identity, name);
	}
	assert.equal(build.commands.length, 14);
	assert(build.commands.every(({ exitCode, signal }) => exitCode === 0 && signal === null));
	assert.equal(supervised.exitCode, 0);
	assert.equal(supervised.termination, 'exited');
	assert.equal(supervised.cleanup.allReaped, true);
	for (const name of ['remaining', 'signaled', 'errors'])
		assert.deepEqual(supervised.cleanup[name], []);
	assert.equal(recheck.testedApplicationCommit, '7d15375967ed557e724488e82bab75cb5c4b41cb');
	assert.equal(recheck.process.finalStatus, 0);
	assert.equal(recheck.process.wallSeconds, supervised.wallSeconds);
	assert.equal(recheck.sourceCommitGuard.pinsVerifiedBeforeAndAfterBuild, true);
	assert.equal(recheck.runtimeQualified, false);
	assert.equal(recheck.sourceMaterials.completeReleaseSourcePack, false);
	if (artifactRoot) {
		assert(
			path.isAbsolute(artifactRoot) && path.isAbsolute(inputCache),
			'absolute paths required'
		);
		for (const input of Object.values(build.inputs))
			assert.deepEqual(
				await verifyArchive(path.join(inputCache, input.filename), input.sha256),
				{
					bytes: input.bytes,
					sha256: input.sha256
				}
			);
		for (const [name, relative] of Object.entries(recheck.artifactPaths)) {
			const { bytes, sha256 } = build.artifacts[name];
			assert.deepEqual(await verifyArchive(path.join(artifactRoot, relative), sha256), {
				bytes,
				sha256
			});
		}
		for (const [relative, identity] of Object.entries(build.recipe.startupCwd.sysrootFiles))
			assert.deepEqual(
				await verifyArchive(
					path.join(artifactRoot, 'work/wasix-libc/sysroot32', relative),
					identity.sha256
				),
				identity
			);
		assert.deepEqual(
			inspectBashShim(
				await readFile(path.join(artifactRoot, recheck.artifactPaths.wasm)),
				lock
			),
			build.artifacts.wasm
		);
	}
	return {
		schemaVersion: 1,
		status: artifactRoot
			? 'external-artifacts-inputs-and-crt-verified'
			: 'archived-receipts-verified',
		testedApplicationCommit: recheck.testedApplicationCommit,
		receipts: RECEIPTS,
		process: { exitCode: 0, wallSeconds: supervised.wallSeconds, cleanupAllReaped: true },
		artifacts: build.artifacts,
		runtimeQualified: false,
		qualification:
			'Actual Bash build and import inspection only; no guest execution or speed comparison'
	};
}

const invoked = process.argv[1] && (await realpath(process.argv[1]).catch(() => null));
if (invoked === (await realpath(fileURLToPath(import.meta.url)))) {
	try {
		const args = process.argv.slice(2);
		assert(
			args.length === 0 ||
				(args.length === 4 && args[0] === '--artifact-root' && args[2] === '--input-cache'),
			'usage: verify-startup-cwd-evidence.mjs [--artifact-root /absolute/output --input-cache /absolute/cache]'
		);
		console.log(
			JSON.stringify(
				await verifyStartupCwdEvidence({ artifactRoot: args[1], inputCache: args[3] }),
				null,
				2
			)
		);
	} catch (error) {
		console.error(String(error));
		process.exitCode = 1;
	}
}
