import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { prepareTeaVmCandidate } from './prepare-wasm-teavm-candidate.mjs';

const execFile = promisify(execFileCallback);
const revision = '6c48f4ed707bf0b15f9b6098de30db8aae6fa40f';

function receipt(bytes) {
	return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function fixture(t, { version = '0.16.0', javacRevision = revision } = {}) {
	const root = await mkdtemp(path.join(os.tmpdir(), 'teavm-candidate-test-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const source = path.join(root, 'upstream');
	await mkdir(path.join(source, 'gradle/wrapper'), { recursive: true });
	await mkdir(path.join(source, 'compiler'));
	await mkdir(path.join(root, 'patches'));
	await writeFile(path.join(source, 'gradle/libs.versions.toml'), `teavm = "${version}"\n`);
	await writeFile(path.join(source, 'gradle.properties'), `jdk.revision=${javacRevision}\n`);
	await writeFile(
		path.join(source, 'gradle/wrapper/gradle-wrapper.properties'),
		'distributionUrl=https\\://services.gradle.org/distributions/gradle-9.1.0-bin.zip\n'
	);
	await writeFile(path.join(source, 'compiler/marker.txt'), 'upstream\n');
	const sourceArchivePath = path.join(root, 'source.tar.gz');
	await execFile('tar', ['-czf', sourceArchivePath, '-C', root, 'upstream']);
	const patchPath = path.join(root, 'patches/compat.patch');
	await writeFile(
		patchPath,
		'diff --git a/compiler/marker.txt b/compiler/marker.txt\n' +
			'--- a/compiler/marker.txt\n+++ b/compiler/marker.txt\n' +
			'@@ -1 +1 @@\n-upstream\n+compatible\n'
	);
	const lock = {
		format: 'wasm-idle-teavm-candidate-inputs-v1',
		profileId: 'test-candidate',
		teavmVersion: '0.16.0',
		source: {
			revision: '208d4c97a602ba0df055f16e6882059fb69d0122',
			archive: receipt(await readFile(sourceArchivePath))
		},
		openjdk: { revision },
		gradle: {
			distributionUrl: 'https://services.gradle.org/distributions/gradle-9.1.0-bin.zip',
			distributionSha256: 'a17ddd85a26b6a7f5ddb71ff8b05fc5104c0202c6e64782429790c933686c806'
		},
		sourcePatches: [{ path: 'patches/compat.patch', ...receipt(await readFile(patchPath)) }]
	};
	const lockFilePath = path.join(root, 'candidate-inputs.lock.json');
	await writeFile(lockFilePath, JSON.stringify(lock));
	return {
		root,
		patchPath,
		sourceArchivePath,
		lockFilePath,
		workDir: path.join(root, 'candidate')
	};
}

test('preparation applies checked patches in an isolated source tree and records an unpublished candidate', async (t) => {
	const inputs = await fixture(t);
	// Preparation must also work below an existing repository, without touching its index.
	await execFile('git', ['init', '-q', inputs.root]);
	const prepared = await prepareTeaVmCandidate(inputs);
	assert.equal(
		await readFile(path.join(prepared.sourceDir, 'compiler/marker.txt'), 'utf8'),
		'compatible\n'
	);
	assert.equal(
		await readFile(path.join(inputs.root, 'upstream/compiler/marker.txt'), 'utf8'),
		'upstream\n'
	);
	assert.match(
		await readFile(
			path.join(prepared.sourceDir, 'gradle/wrapper/gradle-wrapper.properties'),
			'utf8'
		),
		/distributionSha256Sum=a17ddd85a26b6a7f5ddb71ff8b05fc5104c0202c6e64782429790c933686c806/u
	);
	assert.deepEqual(
		JSON.parse(await readFile(path.join(inputs.workDir, 'candidate-status.json'), 'utf8')),
		{
			profileId: 'test-candidate',
			state: 'prepared',
			published: false
		}
	);
	await assert.rejects(access(path.join(inputs.root, '.git/index')));
});

test('an existing work directory is preserved', async (t) => {
	const inputs = await fixture(t);
	await mkdir(inputs.workDir);
	await writeFile(path.join(inputs.workDir, 'keep.txt'), 'existing work');
	await assert.rejects(prepareTeaVmCandidate(inputs), { code: 'EEXIST' });
	assert.equal(await readFile(path.join(inputs.workDir, 'keep.txt'), 'utf8'), 'existing work');
});

test('archive and patch digest drift fail before creating a work directory', async (t) => {
	for (const field of ['sourceArchivePath', 'patchPath']) {
		const inputs = await fixture(t);
		await writeFile(inputs[field], 'modified input');
		await assert.rejects(prepareTeaVmCandidate(inputs), /input differs from its lock/u);
		await assert.rejects(access(inputs.workDir));
	}
});

test('the source compiler and real javac revision must match the candidate lock', async (t) => {
	for (const options of [{ version: '0.13.1' }, { javacRevision: '0'.repeat(40) }]) {
		const inputs = await fixture(t, options);
		await assert.rejects(
			prepareTeaVmCandidate(inputs),
			/pinned compiler version|javac source revision/u
		);
		await assert.rejects(access(path.join(inputs.workDir, 'candidate-status.json')));
	}
});

test('a correctly hashed patch that cannot apply never records a prepared candidate', async (t) => {
	const inputs = await fixture(t);
	const patch = (await readFile(inputs.patchPath, 'utf8')).replace(
		'-upstream',
		'-missing context'
	);
	await writeFile(inputs.patchPath, patch);
	const lock = JSON.parse(await readFile(inputs.lockFilePath, 'utf8'));
	Object.assign(lock.sourcePatches[0], receipt(Buffer.from(patch)));
	await writeFile(inputs.lockFilePath, JSON.stringify(lock));
	await assert.rejects(prepareTeaVmCandidate(inputs), /patch failed|patch does not apply/u);
	await assert.rejects(access(path.join(inputs.workDir, 'candidate-status.json')));
	assert.equal(
		await readFile(path.join(inputs.workDir, 'source/compiler/marker.txt'), 'utf8'),
		'upstream\n'
	);
});
