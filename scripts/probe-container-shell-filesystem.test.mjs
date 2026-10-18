import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtures, judgeShellFilesystemProbe, readPinnedProbeInputs } from './probe-container-shell-filesystem-lib.mjs';

const bytes = (value) => [...new TextEncoder().encode(value)];
function observations() {
	return fixtures.map((fixture) => ({
		id: fixture.id, type: 'result', backendCompleted: true,
		result: { code: 0, stdout: fixture.expectedStdout, stderr: [] },
		invocations: Array.from({ length: fixture.dispatches }, (_, index) => ({
			path: index === 0 && fixture.cwd ? '/opt/host/bin/edit' : '/opt/host/bin/tool', argv: ['tool'],
			cwd: index === 0 && fixture.cwd ? '/workspace' : fixture.cwd ?? '/workspace', owner: 'sdk-scheduler-thread'
		})),
		containerFiles: structuredClone(fixture.containerFiles ?? {}), containerProcesses: [],
		events: [{ type: 'sdkInitialized' }, { type: 'started' }],
		publicApi: { runtime: ['registerHostCommand'], directory: ['fromHostFileSystem'] },
		consoleErrors: [], blockedRequests: [],
		initialWorkerTargets: 0, remainingWorkerTargets: 0, workersAfterContextClose: 0
	}));
}
const failed = (results) => judgeShellFilesystemProbe(results).checks.filter((check) => !check.passed).map((check) => check.id);

test('common filesystem evidence passes while descriptors beyond stdio stay unqualified', () => {
	const judged = judgeShellFilesystemProbe(observations());
	assert.deepEqual(failed(observations()), []);
	assert.equal(judged.commonShellFilesystemPassed, true);
	assert.equal(judged.commonContainerFdVfsQualified, false);
	assert.equal(judged.shellBackendReady, false);
});

test('stale WASIX cache observations fail', () => {
	const results = observations();
	// An unrevalidated cached inode still reports the removed file.
	results.find((result) => result.id === 'FS-EXTERNAL-ENTRIES').result.stdout = bytes('present\na-gone\nb-present\nt-dir\n');
	// Appending at the cached size overwrites bytes another process wrote.
	results.find((result) => result.id === 'FS-LIVE-APPEND').result.stdout = bytes('1X345\nabsent\npresent\nnewmore\n');
	assert.deepEqual(failed(results), ['FS-EXTERNAL-ENTRIES', 'FS-LIVE-APPEND']);
});

test('separate namespaces, a wrong cwd or a missing guest file fail', () => {
	const results = observations();
	delete results.find((result) => result.id === 'FS-GUEST-TO-SHELL').containerFiles['/workspace/out.bin'];
	results.find((result) => result.id === 'FS-SHELL-TO-GUEST').invocations[1].cwd = '/workspace';
	results.find((result) => result.id === 'FS-PIPELINE-RESULT').containerFiles['/workspace/demo/result.txt'] = bytes('');
	assert.deepEqual(failed(results), [
		'FS-SHELL-TO-GUEST:shared-cwd', 'FS-GUEST-TO-SHELL:container-file:/workspace/out.bin',
		'FS-PIPELINE-RESULT:container-file:/workspace/demo/result.txt'
	]);
});

test('timeouts, retained processes, console errors and leaked Workers fail', () => {
	const results = observations();
	Object.assign(results[0], { type: 'timeout', backendCompleted: false });
	results[1].containerProcesses = [{ pid: 1 }];
	results[2].consoleErrors = ['boom'];
	results[3].remainingWorkerTargets = 1;
	assert.deepEqual(failed(results), [
		'FS-SHELL-TO-GUEST', 'FS-SHELL-TO-GUEST:container-processes-retired',
		'FS-GUEST-TO-SHELL:container-processes-retired', 'browser-errors', 'owned-host-context-cleanup'
	]);
});

test('pinned inputs reject a wrong package receipt digest before reading files', async () => {
	await assert.rejects(readPinnedProbeInputs({ packageReceipt: '/nonexistent', packageReceiptSha256: '0'.repeat(64) }));
});

test('the archived preliminary run keeps its mkdir failures and passing filesystem cases', async () => {
	const { readFile } = await import('node:fs/promises');
	const receipt = JSON.parse(await readFile(new URL('../packages/container/test/shell-filesystem/evidence/preliminary-mkdir.json', import.meta.url)));
	assert.equal(receipt.applicationCommit, '1457a6c7333b6db2f12eb30d652e595746ea4f06');
	assert.deepEqual([receipt.qualification.passed, receipt.qualification.total], [18, 27]);
	const byId = Object.fromEntries(receipt.results.map((result) => [result.id, result]));
	const text = (id) => Buffer.from(byId[id].result.stdout).toString();
	// mkdir is not a Bash builtin, and no mkdir command was dispatched in this run.
	assert.equal(Buffer.from(byId['FS-SHELL-TO-GUEST'].result.stderr).toString(), 'bash: line 1: mkdir: command not found\n');
	assert.equal(text('FS-GUEST-TO-SHELL'), 'saved\n');
	assert.equal(text('FS-EXTERNAL-ENTRIES'), 'gone\na-gone\nb-present\nt-dir\n');
	assert.equal(text('FS-LIVE-APPEND'), '12345X\nabsent\npresent\nnewmore\n');
});

test('the archived final runs keep two full passes and one hang before any dispatch', async () => {
	const { readFile } = await import('node:fs/promises');
	const archived = async (name) => JSON.parse(await readFile(new URL(`../packages/container/test/shell-filesystem/evidence/${name}.json`, import.meta.url)));
	for (const index of [1, 2, 3]) {
		const receipt = await archived(`final-run-${index}`);
		assert.equal(receipt.applicationCommit, '20d3f85129da9afd4737d0256de4a21df0942733');
		assert.equal(receipt.packageReceipt.sha256, 'bc09b7e1649f68a2b7d08d15ab8c382ca8122d099626012198c1d645a18ac08e');
		assert.equal((await archived(`final-run-${index}-process`)).exitCode, index === 1 ? 1 : 0);
	}
	for (const index of [2, 3]) assert.equal((await archived(`final-run-${index}`)).qualification.passed, 27);
	const hung = await archived('final-run-1');
	assert.deepEqual([hung.qualification.passed, hung.qualification.total], [20, 27]);
	const result = hung.results.find((entry) => entry.id === 'FS-PIPELINE-RESULT');
	// Bash started, then nothing was dispatched and the owner Worker did not answer cleanup.
	assert.equal(result.type, 'timeout');
	assert.deepEqual(result.events.map((event) => event.type), ['sdkInitialized', 'started']);
	assert.equal(result.ownedCleanup.mode, 'forced-host-worker-termination');
	assert.equal(result.workersAfterContextClose, 0);
	assert(hung.results.filter((entry) => entry.id !== 'FS-PIPELINE-RESULT').every((entry) => entry.type === 'result'));
});
