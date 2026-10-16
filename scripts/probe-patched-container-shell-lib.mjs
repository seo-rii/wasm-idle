// Acceptance contracts and read-only pins for the actual modified SDK/Bash probe.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { judgeShellProbe } from './probe-container-shell-lib.mjs';

export const PACKAGE_RECEIPT = {
	bytes: 2604,
	sha256: '9d3a6094f057d52d7221c676965a03a366de6a0d709ffeaf11147193c0273525'
};
export const BINARY_RECEIPT_SHA256 =
	'e8d02ef4041beb868393f0f5c72c6a8858cdf1b9d43f57337044b8ab88dad08a';
export const SDK_WASM = {
	bytes: 9071791,
	sha256: '326b58090df4dbe3f0f3e4105b56b9cdbd0ebf40a5cecd437f503dac19ac7551'
};
export const BASH_WEBC = {
	bytes: 1812678,
	sha256: '045fe12ba2ae1b417c9413f85ac21a7370d9a8ee13a9de9bebaf4682e81e17c4'
};
export const BASH_WASM_SHA256 = '2728fc7856c5fc4d78da1ad239421b4198fe4f0a78e8d7ae4b244898d8cf770c';
export const CLANG = {
	bytes: 69953408,
	sha256: '2a66c90ef9669c9ead423f539907481b39dd8af68cef5dd064fbdb1028ac8620'
};
export const LLD = {
	bytes: 32477920,
	sha256: 'c74416df67d77cdbfd3beb41f21bf853ee1665e16fb3508fc03f75e8d44d2461'
};
export const MEMORY = { initial: 34, maximum: 16384, shared: true };
export const CASE_TIMEOUT_MS = 30000;
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const identity = (bytes) => ({ bytes: bytes.length, sha256: digest(bytes) });

export const fixtures = [
	{
		id: 'PATCHED-BUILTINS',
		script: 'printf "builtins:%s\\n" "한글"; IFS= read -r line; printf "stdin:%s\\n" "$line"',
		stdin: Array.from(new TextEncoder().encode('real-input\n'))
	},
	{ id: 'G0-SHELL', script: './probe.wasm report "space arg" "한글" ""; :' },
	{
		id: 'G0-ARGV-FRAME',
		script: './probe.wasm report "" $\'line\\nbreak\' $\'carriage\\rreturn\' ""; :'
	},
	{ id: 'G0-ENV-UNSET', script: 'unset G0; ./probe.wasm report; :' },
	{ id: 'PATCHED-ENV-EMPTY', script: 'exec -c ./env-count.wasm' },
	{ id: 'G0-TAIL-EXEC', script: './probe.wasm report tail' },
	{ id: 'G0-EXIT', script: './probe.wasm exit; printf "exit=%d\\n" "$?"' },
	{ id: 'G0-CWD', script: 'cd sub; /workspace/cwd.wasm cwd; printf "\\nexit=%d\\n" "$?"' },
	{
		id: 'G0-FD',
		script: './probe.wasm copy | ./probe.wasm copy > binary; ./probe.wasm copy < binary',
		stdin: [0, 255, 226, 130, 172, 10, 13, 97, 98],
		readFiles: ['/binary']
	},
	{
		id: 'G0-FS',
		script: 'cd sub; IFS= read -r marker < marker; printf "%s\\n" "$marker"; printf "from-shell\\n" > source; /workspace/probe.wasm file /workspace/sub/source /workspace/sub/changed; printf "file-exit=%d\\n" "$?"; IFS= read -r changed < changed; printf "%s\\n" "$changed"',
		readFiles: ['/sub/source', '/sub/changed']
	}
];

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
	const receiptBytes = await pinned(configuration.packageReceipt, PACKAGE_RECEIPT);
	const receipt = JSON.parse(receiptBytes);
	assert.equal(receipt.complete, true, 'actual completed SDK package required');
	assert.equal(receipt.guestQualified, false, 'packaging is not guest acceptance');
	assert.equal(receipt.binaryReceiptIdentity.sha256, BINARY_RECEIPT_SHA256);
	assert.deepEqual(receipt.entries['wasmer_js_bg.wasm'], SDK_WASM);
	assert.deepEqual(receipt.memoryProfile, {
		shared: true,
		minimumPages: MEMORY.initial,
		maximumPages: MEMORY.maximum
	});
	assert.equal(
		receipt.packageId,
		'sha256-' + digest(Buffer.from(JSON.stringify(receipt.entries)))
	);
	const packageRoot = path.join(path.dirname(configuration.packageReceipt), receipt.packageId);
	const entries = new Map();
	for (const [name, expected] of Object.entries(receipt.entries)) {
		assert(/^[A-Za-z0-9_.-]+$/.test(name), 'single package entry name required');
		entries.set(name, await pinned(path.join(packageRoot, name), expected));
	}
	for (const name of ['index.mjs', 'worker.mjs', 'wasmer_js_bg.wasm'])
		assert(entries.has(name), `missing actual package entry: ${name}`);
	const bash = await pinned(configuration.bashWebc, BASH_WEBC);
	await pinned(configuration.clang, CLANG);
	const linker = path.join(path.dirname(configuration.clang), 'wasm-ld');
	const physicalLinker = path.join(path.dirname(configuration.clang), 'lld');
	assert.equal(await realpath(linker), physicalLinker, 'pinned WASI SDK linker alias');
	await pinned(physicalLinker, LLD);
	return { receipt, packageRoot, entries, bash, linker };
}

const selectedChecks = new Set([
	'argv-env',
	'argv-framing',
	'environment-replacement',
	'stderr-bytes',
	'nonzero-exit',
	'cwd',
	'tail-exec',
	'pipe-bytes',
	'redirect-mount',
	'shared-files',
	'resource-groups'
]);
const equal = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
const outputIs = (value, text) =>
	value?.type === 'result' &&
	value.result?.code === 0 &&
	equal(value.result.stdout, Array.from(new TextEncoder().encode(text)));

export function judgePatchedShellProbe(results) {
	const original = judgeShellProbe(results);
	const checks = original.checks.filter(({ id }) => selectedChecks.has(id));
	const find = (id) => results.find((value) => value.id === id);
	const check = (id, fixture, passed, expectation) =>
		checks.push({
			id,
			fixture,
			status: !find(fixture) ? 'not-run' : passed ? 'passed' : 'failed',
			expectation
		});
	check(
		'builtins-stdin',
		'PATCHED-BUILTINS',
		outputIs(find('PATCHED-BUILTINS'), 'builtins:한글\nstdin:real-input\n'),
		'Actual Bash builtins consume stdin and preserve Korean output.'
	);
	check(
		'explicit-empty-environment',
		'PATCHED-ENV-EMPTY',
		outputIs(find('PATCHED-ENV-EMPTY'), 'env-count=0\n'),
		'Actual exec -c reaches a real Wasm environ_sizes_get reporting zero variables.'
	);
	check(
		'tail-argv',
		'G0-TAIL-EXEC',
		outputIs(find('G0-TAIL-EXEC'), 'arg=./probe.wasm\0arg=report\0arg=tail\0G0=space 한글\0'),
		'The final external command actually reports its complete argv/environment.'
	);
	checks.push({
		id: 'actual-backend-completion',
		status:
			results.length === fixtures.length &&
			results.every((value) => value.type === 'result' && value.backendCompleted === true)
				? 'passed'
				: 'failed',
		expectation: 'Every real instance.wait completes before host cleanup begins.'
	});
	checks.push({
		id: 'actual-sdk-initialization',
		status:
			results.length === fixtures.length &&
			results.every((value) => value.events?.some(({ type }) => type === 'sdkInitialized'))
				? 'passed'
				: 'failed',
		expectation: 'Every case observes the actual supplied Module/Memory SDK initializer return.'
	});
	checks.push({
		id: 'browser-errors',
		status:
			results.length === fixtures.length &&
			results.every(
				(value) =>
					value.consoleErrors?.length === 0 &&
					!value.events?.some(({ type }) => type === 'threadError')
			)
				? 'passed'
				: 'failed',
		expectation: 'No page, console or tracked SDK Worker error is hidden by guest stdout.'
	});
	checks.push({
		id: 'owned-host-context-cleanup',
		status:
			results.length === fixtures.length &&
			results.every(
				(value) =>
					value.initialWorkerTargets === 0 &&
					value.hostContextClosed === true &&
					value.workersAfterContextClose === 0
			)
				? 'passed'
				: 'failed',
		expectation:
			'The owned browser contexts close and CDP observes no remaining Worker targets.'
	});
	return {
		collectionComplete: results.length === fixtures.length,
		guestAcceptancePassed: checks.every(({ status }) => status === 'passed'),
		backendCompleteCases: results.filter(({ backendCompleted }) => backendCompleted === true)
			.length,
		checks,
		filesystemScope: 'native WASIX Directory semantics',
		commonContainerFdVfsQualified: false,
		shellBackendReady: false,
		originalG0Evaluation: original
	};
}
