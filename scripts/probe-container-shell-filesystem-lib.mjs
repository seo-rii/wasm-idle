// Pins, cases and acceptance for actual Bash on the common container filesystem.
import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { BASH_WASM_SHA256, BASH_WEBC, digest, identity } from './probe-patched-container-shell-lib.mjs';

export { BASH_WASM_SHA256, digest, identity };
// SDK with bridge patches 0001-0012 (host commands, proc_join and host filesystem mounts).
export const PACKAGE_RECEIPT = {
	bytes: 2605,
	sha256: 'b8b00edb4ca7d7f0d32256b3b4b7d1255c321ba97e90173f08e431a7e2fd4728'
};
export const BINARY_RECEIPT_SHA256 =
	'a468137a373b6235a704936aada1d504e68cba9bee41ab69d5be478ae4eb999b';
export const SDK_WASM = {
	bytes: 9187678,
	sha256: 'd2506ce01566d950eb3bb9caee5ab2500f66580627cc646b309c052051fab0f8'
};
export const MEMORY = { initial: 35, maximum: 16384, shared: true };
export const CASE_TIMEOUT_MS = 30000;
const text = (value) => [...new TextEncoder().encode(value)];

export const fixtures = [
	{
		id: 'FS-SHELL-TO-GUEST', dispatches: 1, cwd: '/workspace/d/e',
		script: 'mkdir -p d/e && cd d/e && printf "from-shell\\n" > note && /opt/host/bin/tool read note',
		expectedStdout: text('from-shell\n'), containerFiles: { '/workspace/d/e/note': text('from-shell\n') }
	},
	{
		id: 'FS-GUEST-TO-SHELL', dispatches: 1,
		script: '/opt/host/bin/probe roundtrip a > out 2> err; IFS= read -r saved < out.bin; printf "%s\\n" "$saved"',
		expectedStdout: text('saved\n'),
		containerFiles: { '/workspace/out': text('probe\0roundtrip\0a\0'), '/workspace/out.bin': text('saved') }
	},
	{
		id: 'FS-EXTERNAL-ENTRIES', dispatches: 3,
		script: 'printf x > stale; /opt/host/bin/edit unlink stale; if [ -e stale ]; then echo present; else echo gone; fi; ' +
			'printf y > a; /opt/host/bin/edit rename a b; [ -e a ] || echo a-gone; [ -e b ] && echo b-present; ' +
			'printf z > t; /opt/host/bin/edit replace-dir t; [ -d t ] && echo t-dir',
		expectedStdout: text('gone\na-gone\nb-present\nt-dir\n'),
		containerFiles: { '/workspace/b': text('y') }
	},
	{
		id: 'FS-LIVE-APPEND', dispatches: 4,
		script: 'printf 1 > g; /opt/host/bin/edit write g 12345; printf X >> g; /opt/host/bin/edit cat g; printf "\\n"; ' +
			'[ -e late ] || echo absent; /opt/host/bin/edit write late new; [ -e late ] && echo present; ' +
			'printf more >> late; /opt/host/bin/edit cat late; printf "\\n"',
		expectedStdout: text('12345X\nabsent\npresent\nnewmore\n')
	},
	{
		id: 'FS-PIPELINE-RESULT', dispatches: 2, cwd: '/workspace/demo',
		script: 'set -eu; mkdir -p /workspace/demo; cd /workspace/demo; printf "hello\\n" > main.c; ' +
			'/opt/host/bin/tool read main.c | /opt/host/bin/tool > result.txt; IFS= read -r r < result.txt; printf "%s\\n" "$r"',
		expectedStdout: text('hello\n'),
		containerFiles: { '/workspace/demo/main.c': text('hello\n'), '/workspace/demo/result.txt': text('hello\n') }
	}
].map((fixture) => ({ ...fixture, readContainerFiles: Object.keys(fixture.containerFiles ?? {}) }));

async function pinned(file, expected) {
	assert(path.isAbsolute(file), 'absolute input paths required');
	const stat = await lstat(file);
	assert(stat.isFile() && !stat.isSymbolicLink(), `regular pinned input required: ${file}`);
	assert.equal(stat.size, expected.bytes, `input byte count: ${file}`);
	const bytes = await readFile(file);
	assert.deepEqual(identity(bytes), expected, `input identity: ${file}`);
	return bytes;
}

export async function readPinnedProbeInputs(configuration) {
	assert.equal(configuration.packageReceiptSha256, PACKAGE_RECEIPT.sha256);
	const receipt = JSON.parse(await pinned(configuration.packageReceipt, PACKAGE_RECEIPT));
	assert.equal(receipt.complete, true, 'actual completed SDK package required');
	assert.equal(receipt.guestQualified, false, 'packaging is not guest acceptance');
	assert.equal(receipt.binaryReceiptIdentity.sha256, BINARY_RECEIPT_SHA256);
	assert.deepEqual(receipt.entries['wasmer_js_bg.wasm'], SDK_WASM);
	assert.deepEqual(receipt.memoryProfile, {
		shared: true, minimumPages: MEMORY.initial, maximumPages: MEMORY.maximum
	});
	assert.equal(receipt.packageId, 'sha256-' + digest(Buffer.from(JSON.stringify(receipt.entries))));
	const packageRoot = path.join(path.dirname(configuration.packageReceipt), receipt.packageId);
	const entries = new Map();
	for (const [name, expected] of Object.entries(receipt.entries)) {
		assert(/^[A-Za-z0-9_.-]+$/.test(name), 'single package entry name required');
		entries.set(name, await pinned(path.join(packageRoot, name), expected));
	}
	for (const name of ['index.mjs', 'worker.mjs', 'wasmer_js_bg.wasm'])
		assert(entries.has(name), `missing actual package entry: ${name}`);
	const bash = await pinned(configuration.bashWebc, BASH_WEBC);
	return { receipt, packageRoot, entries, bash };
}

const decode = (bytes) => Buffer.from(bytes ?? []).toString('utf8');
const same = (actual, expected) => Array.isArray(actual) &&
	actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);

export function judgeShellFilesystemProbe(results) {
	const byId = new Map(results.map((result) => [result.id, result]));
	const checks = [];
	const check = (id, passed, observed) => checks.push({ id, passed: Boolean(passed), observed });
	const completed = (result) => result?.type === 'result' && result.backendCompleted === true;
	for (const fixture of fixtures) {
		const result = byId.get(fixture.id), output = result?.result;
		const invocations = result?.invocations ?? [];
		check(fixture.id, completed(result) && output.code === 0 && same(output.stdout, fixture.expectedStdout), {
			code: output?.code, stdout: decode(output?.stdout), stderr: decode(output?.stderr), type: result?.type
		});
		check(`${fixture.id}:dispatches`, invocations.length === fixture.dispatches &&
			invocations.every((invocation) => invocation.owner === 'sdk-scheduler-thread'), invocations.length);
		if (fixture.cwd) {
			check(`${fixture.id}:shared-cwd`, invocations.length > 0 && invocations.every((invocation) =>
				invocation.cwd === fixture.cwd), invocations.map((invocation) => invocation.cwd));
		}
		for (const [file, expected] of Object.entries(fixture.containerFiles ?? {}))
			check(`${fixture.id}:container-file:${file}`, same(result?.containerFiles?.[file], expected),
				result?.containerFiles?.[file]);
		check(`${fixture.id}:container-processes-retired`, completed(result) &&
			Array.isArray(result.containerProcesses) && result.containerProcesses.length === 0,
		result?.containerProcesses?.length);
	}
	check('actual-sdk-initialization', results.length === fixtures.length && results.every((result) =>
		result.events?.some((event) => event.type === 'sdkInitialized')), results.length);
	check('public-host-filesystem-api', results.length > 0 && results.every((result) =>
		result.publicApi?.directory?.includes('fromHostFileSystem') &&
		result.publicApi?.runtime?.includes('registerHostCommand')), results[0]?.publicApi);
	check('browser-errors', results.every((result) =>
		!result.events?.some((event) => event.type === 'threadError') &&
		!result.blockedRequests?.length && !result.consoleErrors?.length),
	results.map((result) => [result.id, result.consoleErrors?.length ?? null]));
	check('owned-host-context-cleanup', results.every((result) => result.initialWorkerTargets === 0 &&
		result.remainingWorkerTargets === 0 && result.workersAfterContextClose === 0),
	results.map((result) => [result.id, result.remainingWorkerTargets, result.workersAfterContextClose]));
	return {
		checks,
		passed: checks.filter((entry) => entry.passed).length,
		total: checks.length,
		commonShellFilesystemPassed: checks.every((entry) => entry.passed),
		commonContainerFdVfsQualified: false,
		shellBackendReady: false
	};
}
