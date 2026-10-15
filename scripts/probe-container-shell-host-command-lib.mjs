// Pins, cases and acceptance for actual Bash -> SDK host-command registry -> container Supervisor.
import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { BASH_WASM_SHA256, BASH_WEBC, digest, identity } from './probe-patched-container-shell-lib.mjs';

export { BASH_WASM_SHA256, digest, identity };
// SDK with bridge patches 0001-0009 (#205 and its exit-status follow-up); see the bridge README there.
export const PACKAGE_RECEIPT = {
	bytes: 2605,
	sha256: '21c82836f8cbce9a2d07133c35dca7c177944ebb9abf3ef2b25b74374803fbae'
};
export const BINARY_RECEIPT_SHA256 =
	'50a2f1c18574ea655543c7808b40541736083226b5d8abf40477a1bc5e7da720';
export const SDK_WASM = {
	bytes: 9140285,
	sha256: 'b4a6675fa70a7e7e5a0dbb858d2c8b23678e893a2d41163620140e6f1929bb08'
};
export const MEMORY = { initial: 35, maximum: 16384, shared: true };
export const CASE_TIMEOUT_MS = 30000;
const binary = [0, 255, 226, 130, 172, 10, 13, 97, 98];
const text = (value) => [...new TextEncoder().encode(value)];

export const fixtures = [
	{
		id: 'HOST-METADATA', dispatches: 1,
		script: 'cd sub && /opt/host/bin/probe roundtrip "space arg" "한글" ""; printf "status=%d\\n" "$?"',
		readFiles: ['/sub/out.bin'], readContainerFiles: ['/workspace/sub/out.bin']
	},
	// This Bash build reports no PIPESTATUS and cannot redirect inside a forked pipeline
	// subshell (BASH-* diagnostics). Bash observes the last pipeline member's status; every
	// member's status is checked against the Supervisor's own process records.
	{
		id: 'HOST-PIPE-REDIRECT', dispatches: 3, stdin: binary, expectedRecords: [0, 0, 0],
		script: '/opt/host/bin/tool | /opt/host/bin/tool > binary; printf "last=%d\\n" "$?"; /opt/host/bin/tool < binary',
		readFiles: ['/binary'], expectedStdout: [...text('last=0\n'), ...binary], expectedStderr: []
	},
	{
		id: 'HOST-EXACT-CONSUMPTION', dispatches: 2,
		script: 'printf xyz | { /opt/host/bin/tool one; /opt/host/bin/tool; }; printf "\\n"',
		expectedStdout: text('xyz\n')
	},
	{
		id: 'HOST-STATUS', dispatches: 2,
		script: '/opt/host/bin/probe exit; printf "exit=%d\\n" "$?"; /opt/host/bin/tool crash; printf "crash=%d\\n" "$?"',
		expectedStdout: text('exit=23\ncrash=134\n')
	},
	// Twenty consecutive dispatches: one nine-patch run reported 0 instead of 23 to Bash once.
	{
		id: 'HOST-STATUS-REPEAT', dispatches: 20, expectedRecords: Array(20).fill(23),
		script: 'for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do /opt/host/bin/probe exit; printf "%d " "$?"; done; printf "\\n"',
		expectedStdout: text(`${Array(20).fill(23).join(' ')} \n`)
	},
	{
		// Records are in completion order: the reader exits first, then the writer sees EPIPE.
		id: 'HOST-EPIPE', dispatches: 2, expectedRecords: [0, 64],
		script: '/opt/host/bin/tool yes | /opt/host/bin/tool one; printf "\\nreader=%d\\n" "$?"',
		expectedStdout: text('y\nreader=0\n'), expectedStderr: []
	},
	{
		id: 'HOST-PATH-LOOKUP', dispatches: 1, stdin: text('abc'),
		script: 'tool; printf "\\n"', expectedStdout: text('abc\n')
	},
	{
		id: 'HOST-FAILURE', dispatches: 1,
		script: '/opt/host/bin/broken; printf "broken=%d\\n" "$?"; /opt/host/bin/unregistered; printf "native=%d\\n" "$?"; printf "after\\n"'
	},
	{
		id: 'HOST-TAIL-EXEC', dispatches: 1, expectedCode: 23,
		script: 'exec /opt/host/bin/probe exit', expectedStdout: []
	},
	// Recorded only: the first dispatch run printed empty PIPESTATUS for host commands.
	// This builtin-only pipeline shows whether that is a property of this Bash build.
	{
		id: 'BASH-PIPESTATUS', dispatches: 0, diagnostic: true,
		script: 'true | false; printf "pipestatus=[%s]\\n" "${PIPESTATUS[*]}"'
	},
	// Recorded only: redirections inside a forked pipeline subshell failed with EINVAL.
	{
		id: 'BASH-SUBSHELL-DUP', dispatches: 0, diagnostic: true,
		script: 'printf "top\\n" >&2; { printf "group\\n" >&2; } | true; { printf file > group-file; } | true; printf "after\\n"'
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

export function judgeHostCommandProbe(results) {
	const byId = new Map(results.map((result) => [result.id, result]));
	const checks = [];
	const check = (id, passed, observed) => checks.push({ id, passed: Boolean(passed), observed });
	const completed = (result) => result?.type === 'result' && result.backendCompleted === true;
	for (const fixture of fixtures) {
		const result = byId.get(fixture.id);
		const output = result?.result;
		const invocations = result?.invocations ?? [];
		if (fixture.expectedStdout) {
			check(fixture.id, completed(result) && output.code === (fixture.expectedCode ?? 0) &&
				same(output.stdout, fixture.expectedStdout) &&
				(!fixture.expectedStderr || same(output.stderr, fixture.expectedStderr)), {
				code: output?.code, stdout: decode(output?.stdout), stderr: decode(output?.stderr), type: result?.type
			});
		}
		check(`${fixture.id}:dispatches`, invocations.length === fixture.dispatches &&
			invocations.every((invocation) => invocation.owner === 'sdk-scheduler-thread' &&
				invocation.frozen === true), invocations.length);
		if (fixture.expectedRecords) {
			check(`${fixture.id}:process-records`, JSON.stringify((result?.records ?? []).map((record) => record.status)) ===
				JSON.stringify(fixture.expectedRecords) && (result?.records ?? []).every((record) => record.result?.reason === 'exited'),
			result?.records?.map((record) => [record.status, record.result?.reason]));
		}
		check(`${fixture.id}:container-processes-retired`, completed(result) &&
			Array.isArray(result.containerProcesses) && result.containerProcesses.length === 0,
		result?.containerProcesses?.length);
	}
	{
		const result = byId.get('HOST-METADATA'), output = result?.result;
		const [invocation] = result?.invocations ?? [];
		const stdout = Buffer.from(output?.stdout ?? []);
		const env = decode(output?.stderr).split('\0');
		check('HOST-METADATA', completed(result) && output.code === 0 &&
			same([...stdout], text('probe\0roundtrip\0space arg\0한글\0\0status=0\n')), decode(output?.stdout));
		check('HOST-METADATA:prepared-child', invocation?.path === '/opt/host/bin/probe' &&
			JSON.stringify(invocation.argv) === JSON.stringify(['/opt/host/bin/probe', 'roundtrip', 'space arg', '한글', '']) &&
			invocation.cwd === '/workspace/sub' &&
			JSON.stringify(invocation.descriptors) === JSON.stringify([0, 1, 2]) &&
			invocation.env.includes('G0=space 한글') &&
			invocation.env.includes('PATH=/opt/host/bin:/usr/bin:/bin'), invocation);
		check('HOST-METADATA:environment-bytes', env.includes('G0=space 한글') &&
			env.includes('PATH=/opt/host/bin:/usr/bin:/bin'), env.length);
		// The guest's own file goes to the container VFS, not the shell Directory.
		check('HOST-METADATA:distinct-filesystems', same(result?.containerFiles?.['/workspace/sub/out.bin'], text('saved')) &&
			Boolean(result?.files?.['/sub/out.bin']?.error), {
			container: result?.containerFiles, shell: result?.files
		});
	}
	{
		const result = byId.get('HOST-PIPE-REDIRECT');
		check('HOST-PIPE-REDIRECT:shell-file', same(result?.files?.['/binary'], binary), result?.files);
	}
	{
		const result = byId.get('HOST-STATUS');
		check('HOST-STATUS:records', JSON.stringify((result?.records ?? []).map((record) =>
			[record.status, record.result?.reason])) === JSON.stringify([[23, 'exited'], [134, 'runtime-error']]),
		result?.records);
	}
	{
		const result = byId.get('HOST-PATH-LOOKUP');
		const [invocation] = result?.invocations ?? [];
		check('HOST-PATH-LOOKUP:argv0', invocation?.path === '/opt/host/bin/tool' &&
			invocation.argv[0] === 'tool', invocation?.argv);
	}
	{
		const result = byId.get('HOST-FAILURE'), output = result?.result;
		const match = /^broken=126\nnative=(\d+)\nafter\n$/.exec(decode(output?.stdout));
		check('HOST-FAILURE', completed(result) && output.code === 0 && match && Number(match[1]) !== 0, {
			stdout: decode(output?.stdout), stderr: decode(output?.stderr)
		});
		check('HOST-FAILURE:no-native-fallback', (result?.invocations ?? []).every((invocation) =>
			invocation.path === '/opt/host/bin/broken') && (result?.records ?? []).length === 0,
		result?.invocations?.map((invocation) => invocation.path));
	}
	check('actual-sdk-initialization', results.length === fixtures.length && results.every((result) =>
		result.events?.some((event) => event.type === 'sdkInitialized')), results.length);
	check('public-host-command-api', results.length > 0 && results.every((result) =>
		['registerHostCommand', 'unregisterHostCommand'].every((name) => result.publicApi?.runtime?.includes(name)) &&
		['read', 'write', 'close', 'fd'].every((name) => result.publicApi?.hostCommandDescriptor?.includes(name))),
	results[0]?.publicApi);
	check('browser-errors', results.every((result) =>
		!result.events?.some((event) => event.type === 'threadError') &&
		!result.blockedRequests?.length &&
		(result.id === 'HOST-FAILURE' || !result.consoleErrors?.length)), results.map((result) =>
		[result.id, result.consoleErrors?.length ?? null]));
	check('owned-host-context-cleanup', results.every((result) => result.initialWorkerTargets === 0 &&
		result.remainingWorkerTargets === 0 && result.workersAfterContextClose === 0),
	results.map((result) => [result.id, result.remainingWorkerTargets, result.workersAfterContextClose]));
	const pipestatus = byId.get('BASH-PIPESTATUS');
	return {
		observations: {
			bashPipestatus: completed(pipestatus) ? decode(pipestatus.result.stdout) : null,
			bashSubshellDup: completed(byId.get('BASH-SUBSHELL-DUP')) ? {
				stdout: decode(byId.get('BASH-SUBSHELL-DUP').result.stdout),
				stderr: decode(byId.get('BASH-SUBSHELL-DUP').result.stderr)
			} : null
		},
		checks,
		passed: checks.filter((entry) => entry.passed).length,
		total: checks.length,
		hostCommandDispatchPassed: checks.every((entry) => entry.passed),
		commonContainerFdVfsQualified: false,
		shellBackendReady: false
	};
}
