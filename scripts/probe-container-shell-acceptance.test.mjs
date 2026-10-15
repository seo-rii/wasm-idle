import assert from 'node:assert/strict';
import test from 'node:test';
import { manifest, runProbe } from './probe-container-shell-acceptance.mjs';
import { selectClangProfile } from '../examples/container/clang-profile.mjs';
import {
	BIN, CLANG_PROFILE, CLANG_TRIPLE_WARNING, CLANG_PREPROCESS_WARNINGS, DISPATCHES, FAILURE_DISPATCHES, INTERRUPTS, INTERRUPT_DISPATCHES, LLVM_EXECUTABLE, PIPELINE_DISPATCHES, SCRIPT, SOURCE,
	SYNTAX_COMMANDS, SYNTAX_CONTENTS, SYNTAX_DIRECTORY, SYNTAX_ENVIRONMENT,
	judgeShellAcceptance, judgeLiveShellAcceptance,
	readPinnedProbeInputs
} from './probe-container-shell-acceptance-lib.mjs';

const bytes = (value) => [...new TextEncoder().encode(value)];
const assets = ['sdk', 'bash', 'busybox', 'clang', 'lld', 'sysroot'].map((name) => `/assets/${name}`);
function result(run) {
	let seq = 0;
	const timeline = [{ seq: seq++, type: 'shellStart' }];
	const fetch = (name) => run === 'cold' && timeline.push({ seq: seq++, type: 'fetch', url: `http://127.0.0.1:1/assets/${name}` });
	['sdk', 'bash'].forEach(fetch);
	for (const dispatch of DISPATCHES) {
		timeline.push({ seq: seq++, type: 'dispatch', path: dispatch.path });
		if (dispatch.path.endsWith('/mkdir')) fetch('busybox');
		if (dispatch.path.endsWith('/clang')) ['clang', 'lld', 'sysroot'].forEach(fetch);
		timeline.push({ seq: seq++, type: 'dispatchEnd', path: dispatch.path, status: 0 });
	}
	return {
		type: 'result', backendCompleted: true,
		result: { code: 0, stdout: bytes('hello\n'), stderr: bytes(CLANG_TRIPLE_WARNING) },
		files: { '/workspace/demo/main.c': [...SOURCE], '/workspace/demo/result.txt': bytes('hello\n') },
		artifact: { bytes: 1234, magic: [0, 97, 115, 109, 1, 0, 0, 0], mode: 0o755 },
		invocations: DISPATCHES.map(({ path, cwd }) => ({ path, cwd, argv: [path], descriptors: [0, 1, 2] })),
		records: DISPATCHES.map(({ path }, pid) => ({ path, status: 0, pid: pid + 1, result: { code: 0, reason: 'exited' } })),
		timeline, lookups: { cat: 'busybox', cp: 'busybox', grep: 'busybox', mkdir: 'busybox', mv: 'busybox', rm: 'busybox', clang: 'llvm' },
		clangCommand: { name: 'clang', package: 'llvm', adapter: 'llvm-clang-tool-host-v1', path: 'bin/llvm', argv0: LLVM_EXECUTABLE, prefixArgs: ['clang', ...CLANG_PROFILE] },
		assetsBeforeShell: { cachedEntries: 0 }, shellAssetsBefore: { cachedEntries: 0 }, sysroot: { entries: 2285, files: 2168 }, containerProcesses: [],
		virtualCommands: Object.fromEntries(['cat', 'cp', 'grep', 'mkdir', 'mv', 'rm', 'clang'].map(name => [name, { command: true, mode: 0o555, size: 0 }])),
		workerGroup: { disposed: true, active: 0, created: 5, terminated: 5 },
		publicApi: { session: 'createWasixShellSession', runtime: ['registerHostCommand', 'registerHostCommandDirectory'], directory: ['fromHostFileSystem'] },
		events: [], consoleErrors: [], blockedRequests: [], remainingWorkerTargets: 0
	};
}
function interrupted() {
	let seq = 0;
	const timeline = [], counts = new Map();
	for (const [path, status] of INTERRUPT_DISPATCHES) {
		const occurrence = (counts.get(path) ?? 0) + 1;
		counts.set(path, occurrence);
		timeline.push({ seq: seq++, type: 'dispatch', path });
		if (INTERRUPTS.some((plan) => plan.path === path && plan.occurrence === occurrence))
			timeline.push({ seq: seq++, type: 'interrupt', path, interrupted: 1 });
		timeline.push({ seq: seq++, type: 'dispatchEnd', path, status });
	}
	return {
		type: 'result', backendCompleted: true,
		result: { code: 0, stdout: bytes('spin=130\nclang=130\ndiscarded\nhello\n'), stderr: bytes(CLANG_TRIPLE_WARNING.repeat(2)) },
		records: INTERRUPT_DISPATCHES.map(([path, status]) => ({ path, status })), timeline,
		files: { '/workspace/demo/interrupted.wasm': { error: 'ENOENT' } },
		artifact: { bytes: 1234, magic: [0, 97, 115, 109, 1, 0, 0, 0] }, containerProcesses: [],
		events: [], consoleErrors: [], blockedRequests: [], remainingWorkerTargets: 0
	};
}
function failing() {
	return {
		type: 'result', backendCompleted: true,
		result: {
			code: 0, stdout: bytes('mkdir=126\nretry=126\nbad=1\nno-artifact\nmissing=127\nhello\n'),
			stderr: bytes('mkdir: Pinned asset digest mismatch\nmkdir: Pinned asset digest mismatch\n' + CLANG_TRIPLE_WARNING +
				"bad.c:1:16: error: expected '}'\n1 error generated.\nbash: line 7: nosuch-command: command not found\n" + CLANG_TRIPLE_WARNING)
		},
		records: FAILURE_DISPATCHES.map(([path, status, reason]) => reason === 'INTEGRITY' ? { path, status, startError: reason } : { path, status, result: { reason } }),
		files: { '/workspace/bad.wasm': { error: 'ENOENT' } },
		artifact: { bytes: 1234, magic: [0, 97, 115, 109, 1, 0, 0, 0] }, containerProcesses: [],
		events: [], consoleErrors: [], blockedRequests: [], remainingWorkerTargets: 0
	};
}
function piped() {
	return {
		type: 'result', backendCompleted: true,
		result: { code: 0, stdout: bytes('file=file\nsub=sub\nkept\n'), stderr: bytes('top\ngroup\n') },
		records: PIPELINE_DISPATCHES.map(([path, status]) => ({ path, status })),
		files: { '/workspace/group-file': bytes('file\n'), '/workspace/sub-file': bytes('sub\n'), '/workspace/err-file': bytes('aside\n') },
		containerProcesses: [], events: [], consoleErrors: [], blockedRequests: [], remainingWorkerTargets: 0
	};
}
function redirected() {
	return {
		type: 'result', backendCompleted: true,
		result: { code: 0, stdout: bytes('hello\nbad=1\ndata=126\nhello\nvirtual=1\n'), stderr: [] },
		files: {
			'/workspace/command-path': bytes(`${BIN}/clang\n`), '/workspace/compile.out': [], '/workspace/compile.err': bytes(CLANG_TRIPLE_WARNING),
			'/workspace/version.txt': bytes('clang version 22\n'), '/workspace/failed.out': [], '/workspace/failed.err': bytes('bad.c:1:16: error: expected closing brace\n'),
			'/workspace/bad.wasm': { error: 'ENOENT' }, '/workspace/denied.out': [], '/workspace/virtual-body': [], '/workspace/virtual-error': bytes('Operation not supported\n')
		},
		artifact: { mode: 0o755 }, dataArtifactMode: 0o644, records: [{ path: `${BIN}/wasm-run`, status: 0 }],
		containerProcesses: [], workerGroup: { disposed: true, active: 0 }, consoleErrors: [], blockedRequests: [], remainingWorkerTargets: 0
	};
}
function syntax() {
	return {
		type: 'result', backendCompleted: true,
		result: { code: 0, reason: 'exited', stdout: bytes('retained\nsyntax-ok\n'), stderr: [] },
		files: Object.fromEntries(Object.entries(SYNTAX_CONTENTS).map(([name, value]) => [`${SYNTAX_DIRECTORY}/${name}`, bytes(value)])),
		invocations: SYNTAX_COMMANDS.map(([name, args], index) => ({ path: `${BIN}/${name}`, argv: [name, ...args],
			cwd: index === 0 ? '/workspace' : SYNTAX_DIRECTORY, fixtureEnvironment: index === 0 ? {} : { ...SYNTAX_ENVIRONMENT } })),
		records: SYNTAX_COMMANDS.map(([name, , status], index) => ({ path: `${BIN}/${name}`, status, pid: index + 1, result: { code: status, reason: 'exited' } })),
		publicApi: { session: 'createWasixShellSession', runtime: ['registerHostCommand'], directory: ['fromHostFileSystem'] },
		sysroot: null, timeline: [], containerProcesses: [], workerGroup: { disposed: true, active: 0, created: 13, terminated: 13 },
		consoleErrors: [], blockedRequests: [], remainingWorkerTargets: 0
	};
}
function receipt() {
	const counts = (value) => Object.fromEntries(assets.map((path) => [path, value]));
	return {
		initialWorkerTargets: 0, workersAfterContextClose: 0,
		runs: [
			{ run: 'cold', result: result('cold'), downloads: { start: counts(0), end: counts(1) } },
			{ run: 'warm', result: result('warm'), downloads: { start: counts(1), end: counts(1) } },
			{ run: 'interrupt', result: interrupted(), downloads: { start: counts(1), end: counts(1) } },
			{ run: 'failure', result: failing(), downloads: {
				start: { ...counts(1), '/assets/busybox-corrupt': 0 }, end: { ...counts(1), '/assets/clang': 2, '/assets/lld': 2, '/assets/sysroot': 2, '/assets/busybox-corrupt': 2 }
			} },
			{ run: 'pipeline', result: piped(), downloads: { start: counts(1), end: counts(1) } },
			{ run: 'redirection', result: redirected(), downloads: { start: counts(1), end: counts(1) } },
			{ run: 'startup-failure', result: { type: 'result', backendCompleted: true, result: { code: null, reason: 'runtime-error', stdout: [], stderr: [] },
				records: [], workerGroup: { disposed: true, active: 0, created: 1, terminated: 1 }, remainingWorkerTargets: 0, consoleErrors: [], blockedRequests: [] } },
			{ run: 'syntax', result: syntax(), downloads: { start: counts(1), end: counts(1) } }
		]
	};
}
function liveReceipt() {
	const value = receipt(); value.scenario = 'live-only'; value.clangFilesystem = 'live';
	value.runs = value.runs.filter(run => ['cold', 'warm'].includes(run.run));
	for (const run of value.runs) run.result.clangCommand.adapter = 'llvm-clang-tool-host-live-v1';
	const calls = [
		['mkdir', ['-p', '/workspace/live']], ['clang', ['-E', '-P', '-x', 'c', '-']], ['cat', []], ['cat', ['preprocessed.txt']], ['clang', ['--version']]
	];
	value.runs.push({ run: 'live-io', downloads: structuredClone(value.runs[1].downloads), result: {
		type: 'result', backendCompleted: true, result: { code: 0, reason: 'exited', stdout: bytes('after_editor\n'), stderr: bytes(CLANG_PREPROCESS_WARNINGS) },
		files: { '/workspace/live/live.h': bytes('after_editor\n'), '/workspace/live/preprocessed.txt': bytes('after_editor\n'),
			'/workspace/live/version.txt': bytes('clang version 22\n'), '/workspace/live/version.err': [] },
		liveIo: { compilerPid: 2, compilerRunningBeforeEdit: true, compilerRunningAfterUtility: true,
			headerBefore: bytes('before_editor\n'), headerAfter: bytes('after_editor\n'),
			utility: { code: 0, reason: 'exited', stdout: bytes('after_editor\n'), stderr: [] } },
		invocations: calls.map(([name, args], index) => ({ path: `${BIN}/${name}`, cwd: index === 0 ? '/workspace' : '/workspace/live', argv: [name, ...args], descriptors: [index === 4 ? null : 0, 1, 2] })),
		records: calls.map(([name], index) => ({ path: `${BIN}/${name}`, pid: index + 1, status: 0, result: { code: 0, reason: 'exited' } })),
		clangCommand: value.runs[0].result.clangCommand, assetsBeforeShell: { cachedEntries: 0 }, sysroot: { entries: 2285, files: 2168 },
		containerProcesses: [], workerGroup: { disposed: true, active: 0, created: 7, terminated: 7 }, remainingWorkerTargets: 0,
		events: [], consoleErrors: [], blockedRequests: []
	} });
	return value;
}
const failed = (value) => judgeShellAcceptance(value).checks.filter((check) => !check.passed).map((check) => check.id);

test('distribution identity covers URL policy and declares the LLVM multicall layout', () => {
	const inputs = {
		receipt: { packageId: 'fixture', sourceCommit: 'fixture' }, bash: Buffer.from('bash'), busybox: Buffer.from('busybox'),
		entries: new Map([['wasmer_js_bg.wasm', Buffer.from('sdk')]]), busyboxReceiptSha256: 'b'.repeat(64),
		clang: { producer: { source: { repository: 'https://example.invalid/producer', revision: 'fixture' } }, producerSha256: 'c'.repeat(64), assets: {} }
	};
	const first = JSON.parse(manifest('https://one.invalid', inputs)), second = JSON.parse(manifest('https://two.invalid', inputs));
	assert.notEqual(first.distributionId, second.distributionId);
	assert.notEqual(first.distributionId, JSON.parse(manifest('https://one.invalid', inputs, 'busybox-corrupt')).distributionId);
	assert.deepEqual(first.packages.find(pkg => pkg.id === 'llvm').files, [
		{ path: 'bin/llvm', asset: 'clang', executable: true }, { path: 'bin/wasm-ld', asset: 'lld', executable: true },
		{ path: 'sysroot.tar', asset: 'sysroot', executable: false }
	]);
	assert.deepEqual(first.commands.find(command => command.name === 'clang'), {
		name: 'clang', package: 'llvm', adapter: 'llvm-clang-tool-host-v1', path: 'bin/llvm', argv0: LLVM_EXECUTABLE,
		prefixArgs: ['clang', ...CLANG_PROFILE]
	});
	assert.equal(manifest('https://one.invalid', inputs, 'busybox', 'snapshot'), manifest('https://one.invalid', inputs),
		'Explicit snapshot retains the original immutable manifest bytes and identity');
	const live = JSON.parse(manifest('https://one.invalid', inputs, 'busybox', 'live'));
	assert.notEqual(live.distributionId, first.distributionId);
	assert.equal(live.commands.find(command => command.name === 'clang').adapter, 'llvm-clang-tool-host-live-v1');
});

test('trusted Clang profile selects only a fixed adapter, worker and descriptor mode', async () => {
	assert.equal(selectClangProfile().filesystem, 'snapshot');
	assert.deepEqual(selectClangProfile('snapshot'), { filesystem: 'snapshot', adapterId: 'llvm-clang-tool-host-v1', workerPath: 'packages/container/src/adapters/clang/worker.ts', stdio: 'forwarded' });
	assert.deepEqual(selectClangProfile('live'), { filesystem: 'live', adapterId: 'llvm-clang-tool-host-live-v1', workerPath: 'packages/container/src/adapters/clang-live/worker.ts', stdio: 'delegated' });
	for (const invalid of [null, '', 'auto', true, {}, 'https://example.invalid/host.mjs']) {
		assert.throws(() => selectClangProfile(invalid), /clangFilesystem must be snapshot or live/);
		assert.throws(() => manifest('https://one.invalid', {}, 'busybox', invalid), /clangFilesystem must be snapshot or live/);
	}
	await assert.rejects(readPinnedProbeInputs({ clangFilesystem: 'auto' }), /clangFilesystem must be snapshot or live/);
	await assert.rejects(runProbe({ clangFilesystem: 'live' }), /separate --run-live gate/);
	await assert.rejects(runProbe({}, { liveOnly: true }), /explicit clangFilesystem=live/);
});

test('live gate qualifies actual shared-header/stdin/utility observations without snapshot rollback claims', () => {
	const value = judgeLiveShellAcceptance(liveReceipt());
	assert.deepEqual(value.checks.filter(check => !check.passed), []);
	assert.equal(value.liveShellAcceptancePassed, true);
	assert.equal(value.liveCompilerFilesystemQualified, true);
	assert.equal(value.shellAcceptancePassed, false);
	assert.equal(value.shellSyntaxPassed, false);
});

test('live gate rejects missing concurrency, stale pipe output and an unqualified profile', () => {
	const value = liveReceipt(), live = value.runs[2].result;
	live.liveIo.compilerRunningBeforeEdit = false; live.liveIo.compilerRunningAfterUtility = false;
	live.files['/workspace/live/preprocessed.txt'] = bytes('before_editor\n'); live.invocations[4].descriptors[0] = 0;
	value.clangFilesystem = 'snapshot';
	assert.deepEqual(judgeLiveShellAcceptance(value).checks.filter(check => !check.passed).map(check => check.id),
		['live:explicit-profile', 'live-io:actual-script-and-pipe-bytes', 'live-io:header-edit-during-compiler', 'live-io:concurrent-real-utility', 'live-io:closed-input-command']);
});

test('live preprocessing retains exact phase-specific diagnostics without filtering', () => {
	for (const stderr of [CLANG_TRIPLE_WARNING, CLANG_PREPROCESS_WARNINGS + CLANG_TRIPLE_WARNING, CLANG_PREPROCESS_WARNINGS.replace("'linker' input", "'other' input")]) {
		const value = liveReceipt(); value.runs[2].result.result.stderr = bytes(stderr);
		assert.deepEqual(judgeLiveShellAcceptance(value).checks.filter(check => !check.passed).map(check => check.id), ['live-io:actual-script-and-pipe-bytes']);
	}
});

test('the plan script is unchanged and an actual passing receipt passes without readiness claims', () => {
	assert.equal(SCRIPT, "set -eu\nmkdir -p /workspace/demo\ncd /workspace/demo\nprintf '#include <stdio.h>\\nint main(void){puts(\"hello\");return 0;}\\n' > main.c\nclang main.c -o hello.wasm\n./hello.wasm | grep hello > result.txt\ncat result.txt\n");
	const judged = judgeShellAcceptance(receipt());
	assert.deepEqual(failed(receipt()), []);
	assert.equal(judged.shellAcceptancePassed, true);
	assert.equal(judged.shellBackendReady, false);
	assert.equal(judged.commonContainerFdVfsQualified, false);
});

test('printing hello alone is insufficient', () => {
	const value = receipt();
	delete value.runs[0].result.files['/workspace/demo/result.txt'];
	value.runs[0].result.records.pop();
	value.runs[0].result.invocations[2].cwd = '/workspace';
	value.runs[0].result.artifact = { error: 'ENOENT' };
	assert.deepEqual(failed(value), ['cold:workspace-files', 'cold:artifact', 'cold:shared-cwd', 'cold:supervisor-exits', 'cold:executable-artifact']);
});

test('an eager or repeated asset body request fails', () => {
	const value = receipt();
	// Clang fetched at shell start, before its command.
	const timeline = value.runs[0].result.timeline;
	timeline.find((entry) => entry.type === 'fetch' && entry.url.endsWith('/clang')).seq = -1;
	value.runs[1].downloads.end['/assets/sysroot'] = 2;
	assert.deepEqual(failed(value), ['cold:clang-lazy', 'warm:verified-cache-reuse']);
});

test('public session qualification requires virtual metadata, executable artifacts and complete worker retirement', () => {
	const value = receipt();
	value.runs[0].result.virtualCommands.clang.command = undefined;
	value.runs[1].result.workerGroup.active = 1;
	value.runs[5].result.dataArtifactMode = 0o755;
	value.runs[5].result.files['/workspace/failed.err'] = bytes('filesystem busy');
	assert.deepEqual(failed(value), ['cold:virtual-command-metadata', 'warm:sdk-group-retired', 'redirection:compiler-redirections', 'redirection:artifact-mode-enforced']);
});

test('the compiler must retain its actual multicall identity and subcommand', () => {
	const value = receipt();
	value.runs[0].result.clangCommand.argv0 = `${BIN}/clang`;
	value.runs[1].result.clangCommand.prefixArgs.shift();
	assert.deepEqual(failed(value), ['cold:clang-multicall-profile', 'warm:clang-multicall-profile']);
});

test('SDK setup failure must not masquerade as guest exit 1 or leave owned workers', () => {
	const value = receipt(), result = value.runs[6].result;
	result.result = { code: 1, reason: 'exited', stdout: [], stderr: [] };
	assert.deepEqual(failed(value), ['startup-failure:runtime-error']);
	result.workerGroup.active = 1;
	assert.deepEqual(failed(value), ['startup-failure:runtime-error', 'startup-failure:owned-cleanup']);
});

test('a diagnostic profile cannot qualify after omitting a required real mount', () => {
	const value = receipt(); value.diagnosticOptions = { sdkDiagnostics: true, omittedTmpMount: true };
	assert.deepEqual(failed(value), ['required-mount-profile']);
	assert.equal(judgeShellAcceptance(value).shellAcceptancePassed, false);
});

test('syntax-only qualification never implies the compiler or complete shell gate passed', () => {
	const value = receipt(); value.scenario = 'syntax-only'; value.runs = value.runs.filter(run => run.run === 'syntax');
	const result = judgeShellAcceptance(value);
	assert.equal(result.shellSyntaxPassed, true);
	assert.equal(result.shellAcceptancePassed, false);
	assert.equal(result.total, 12);
	assert(result.checks.every(check => check.passed));
});

test('syntax acceptance requires exact quoted arguments, exported child environment and actual cwd', () => {
	const value = receipt(), syntax = value.runs.at(-1).result;
	syntax.invocations[3].argv.splice(1, 1);
	syntax.invocations[2].fixtureEnvironment = {};
	syntax.invocations[8].cwd = '/workspace';
	assert.deepEqual(failed(value), ['syntax:quoted-argv', 'syntax:export-and-cwd']);
});

test('syntax acceptance distinguishes conditional exit, substitution and redirection bytes', () => {
	const value = receipt(), syntax = value.runs.at(-1).result;
	syntax.records[5].status = 0;
	syntax.files[`${SYNTAX_DIRECTORY}/substitution.out`] = bytes('<space value\n한글 값\n>\n');
	syntax.files[`${SYNTAX_DIRECTORY}/append.out`] = bytes('discard\nspace value\n한글 값\ntail\n');
	syntax.files[`${SYNTAX_DIRECTORY}/split.out`] = bytes(SYNTAX_CONTENTS['merged.out']);
	assert.deepEqual(failed(value), ['syntax:conditional-statuses', 'syntax:command-substitution', 'syntax:stdin-truncate-append', 'syntax:redirection-order']);
});

test('syntax-only execution requires zero compiler body downloads and full worker cleanup', () => {
	const value = receipt(); value.scenario = 'syntax-only';
	value.runs.at(-1).downloads.end['/assets/clang']++;
	value.runs.at(-1).result.workerGroup.active = 1;
	assert.deepEqual(failed(value), ['syntax:compiler-not-loaded', 'syntax:owned-cleanup']);
	value.diagnosticOptions = { omittedTmpMount: true };
	assert.equal(judgeShellAcceptance(value).shellSyntaxPassed, false);
});

test('a natively executed artifact, wrong order, nonzero exit or leaked process fails', () => {
	const value = receipt(), run = value.runs[0].result;
	run.records = run.records.filter((record) => !record.path.endsWith('hello.wasm'));
	run.invocations = run.invocations.filter((invocation) => !invocation.path.endsWith('hello.wasm'));
	value.runs[1].result.result.code = 1;
	value.runs[1].result.containerProcesses = [{ pid: 3 }];
	assert.deepEqual(failed(value), ['cold:dispatch-order', 'cold:shared-cwd', 'cold:supervisor-exits', 'cold:artifact-in-supervisor',
		'warm:script', 'warm:processes-retired']);
});

test('the pipeline children may dispatch in either order', () => {
	const value = receipt(), run = value.runs[1].result;
	[run.invocations[2], run.invocations[3]] = [run.invocations[3], run.invocations[2]];
	assert.deepEqual(failed(value), []);
	[run.invocations[1], run.invocations[2]] = [run.invocations[2], run.invocations[1]];
	assert.deepEqual(failed(value), ['warm:dispatch-order']);
	assert.equal(BIN, '/usr/local/bin');
});

test('stderr may hold only the pinned Clang triple warning, once', () => {
	const value = receipt();
	value.runs[0].result.result.stderr = bytes(CLANG_TRIPLE_WARNING + CLANG_TRIPLE_WARNING);
	value.runs[1].result.result.stderr = bytes('main.c:1:1: warning: something else\n');
	assert.deepEqual(failed(value), ['cold:script', 'warm:script']);
	value.runs[1].result.result.stderr = [];
	assert.deepEqual(failed(value), ['cold:script', 'warm:script'], 'the warning proves Clang ran on the forwarded route');
});

test('an interrupt must stop the running command, keep Bash going and discard the compile', () => {
	const value = receipt(), run = value.runs[2].result;
	run.result.stdout = bytes('spin=0\nclang=130\nkept\nhello\n');
	run.files['/workspace/demo/interrupted.wasm'] = [0, 97, 115, 109];
	// An interrupt after the command had already finished proves nothing.
	const late = run.timeline.findIndex((entry) => entry.type === 'interrupt');
	run.timeline[late].seq = 1000;
	run.records[2].status = 0;
	assert.deepEqual(failed(value), ['interrupt:script', 'interrupt:supervisor-statuses', 'interrupt:interrupted-while-running',
		'interrupt:interrupted-compile-discarded']);
	const fresh = receipt();
	fresh.runs[2].result.result.stderr = bytes(CLANG_TRIPLE_WARNING.repeat(3));
	assert.deepEqual(failed(fresh), [], 'the interrupted compile may or may not have printed its warning');
	fresh.runs[2].result.timeline.find((entry) => entry.type === 'interrupt').interrupted = 2;
	assert.deepEqual(failed(fresh), ['interrupt:interrupted-while-running']);
});

test('a failure must stay contained: integrity, compile error and a missing command', () => {
	const value = receipt(), run = value.runs[3].result;
	// A cached corrupt body would be fetched once; a fallback to the real body would hide the failure.
	value.runs[3].downloads.end['/assets/busybox-corrupt'] = 1;
	value.runs[3].downloads.end['/assets/busybox'] = 2;
	run.files['/workspace/bad.wasm'] = [0, 97, 115, 109];
	run.records[0].startError = 'STARTUP_FAILED';
	run.result.stderr = bytes('bad.c: error\n');
	assert.deepEqual(failed(value), ['failure:diagnostics', 'failure:supervisor-statuses', 'failure:no-artifact-from-error', 'failure:integrity-not-cached']);
	const fresh = receipt();
	fresh.runs[3].result.result.stdout = bytes('mkdir=0\nretry=0\nbad=1\nno-artifact\nmissing=127\nhello\n');
	assert.deepEqual(failed(fresh), ['failure:script']);
});

test('redirections inside a piped group must not fail with Invalid argument', () => {
	const value = receipt(), run = value.runs[4].result;
	// The pre-0014 behavior: each redirection failed and the file was never written.
	run.result.stderr = bytes('top\nbash: line 1: 2: Invalid argument\nbash: line 1: 6: Invalid argument\n');
	run.result.stdout = bytes('file=\nsub=sub\nkept\n');
	delete run.files['/workspace/group-file'];
	assert.deepEqual(failed(value), ['pipeline:script', 'pipeline:workspace-files']);
});

test('browser errors and Workers that outlive their owner fail', () => {
	const value = receipt();
	value.runs[0].result.consoleErrors = ['boom'];
	value.runs[1].result.remainingWorkerTargets = 1;
	value.workersAfterContextClose = 2;
	assert.deepEqual(failed(value), ['cold:browser-errors', 'warm:owned-workers-retired', 'context-cleanup']);
});

test('pinned inputs reject a wrong package receipt digest before reading files', async () => {
	await assert.rejects(readPinnedProbeInputs({ packageReceipt: '/nonexistent', packageReceiptSha256: '1'.repeat(64) }));
});

const archived = async (name) => JSON.parse(await (await import('node:fs/promises')).readFile(
	new URL(`../packages/container/test/shell-acceptance/evidence/${name}.json`, import.meta.url)));

test('the archived attempts keep their recorded failures', async () => {
	assert.match((await archived('distribution-id')).runs[0].result.error, /distributionId must be a bounded string/);
	const text = (receipt, run) => Buffer.from(receipt.runs[run].result.result.stderr).toString();
	assert.equal(text(await archived('mkdir-root-einval'), 0), "mkdir: can't create directory '/': Invalid argument\n");
	assert.equal(text(await archived('mkdir-workspace-erofs'), 0), "mkdir: can't create directory '/workspace/': Read-only file system\n");
	// The first warm pass: the cold run timed out during its Clang command.
	const first = await archived('cold-timeout-warm-pass');
	assert.deepEqual(first.runs.map((run) => run.result.type), ['timeout', 'result']);
	assert.deepEqual(first.qualification.checks.filter((check) => check.id.startsWith('warm:') && !check.passed).map((check) => check.id),
		['warm:owned-workers-retired'], 'only the cold owner Worker outliving its run failed the warm checks');
});

test('the streamed runs: one full pass, and two cold runs that stop after Clang completes', async () => {
	const pass = await archived('streamed-run-1');
	assert.equal(pass.applicationCommit, '04aac7e061607f9b8621c62a98e22ec3fd7a676c');
	assert.deepEqual([pass.qualification.passed, pass.qualification.total, pass.shellAcceptancePassed], [30, 30, true]);
	for (const name of ['streamed-run-2', 'streamed-run-3']) {
		const receipt = await archived(name);
		assert.equal(receipt.applicationCommit, pass.applicationCommit);
		const [cold, warm] = receipt.runs.map((run) => run.result);
		assert.equal(cold.type, 'timeout');
		assert.equal(warm.type, 'result');
		assert.equal(Buffer.from(warm.result.stdout).toString(), 'hello\n');
		// Clang completed with status 0; the owner then stopped posting anything.
		const marks = cold.events.filter((event) => ['dispatch', 'dispatchEnd', 'heartbeat'].includes(event.type));
		const end = marks.findIndex((event) => event.type === 'dispatchEnd' && event.path === '/usr/local/bin/clang');
		assert.equal(marks[end].status, 0);
		assert.deepEqual(marks.slice(end + 1).map((event) => event.type), ['heartbeat']);
		assert.equal(cold.ownedCleanup.mode, 'forced-host-worker-termination');
	}
});

test('with host-command work off the scheduler thread, five consecutive runs pass cold and warm', async () => {
	for (const index of [1, 2, 3, 4, 5]) {
		const receipt = await archived(`service-run-${index}`);
		assert.equal(receipt.applicationCommit, '1df732f1fb0cdc1d7f902454fea2e9e0635006ec');
		assert.equal(receipt.packageReceipt.sha256, 'ac5b9ce4cf673f3917775aa87fa95715794f61c0d6ff27b3fd05996d5d0dfc85');
		assert.deepEqual([receipt.qualification.passed, receipt.qualification.total, receipt.shellAcceptancePassed], [30, 30, true]);
		assert.equal((await archived(`service-run-${index}-process`)).exitCode, 0);
	}
});

test('the archived interrupt run stops a running artifact and compile while Bash continues', async () => {
	const receipt = await archived('interrupt-run-1');
	assert.equal(receipt.applicationCommit, '6251c8b7882dc5a5719e82742c7ef141748be63b');
	const interrupt = receipt.runs.find((run) => run.run === 'interrupt').result;
	assert.equal(Buffer.from(interrupt.result.stdout).toString(), 'spin=130\nclang=130\ndiscarded\nhello\n');
	assert.deepEqual(interrupt.records.map((record) => [record.status, record.result?.reason]),
		[[0, 'exited'], [0, 'exited'], [130, 'terminated'], [130, 'terminated'], [0, 'exited'], [0, 'exited']]);
	assert(receipt.qualification.checks.filter((check) => check.id.startsWith('interrupt:')).every((check) => check.passed));
	// The cold run passed; the warm run stopped right after Clang completed, as in the earlier hangs.
	assert(receipt.qualification.checks.filter((check) => check.id.startsWith('cold:')).every((check) => check.passed));
	assert.equal(receipt.runs[1].result.type, 'timeout');
});

test('with the service SDK the interrupt run passes, and a late interrupt races a finishing compile', async () => {
	const runs = await Promise.all([2, 3, 4].map((index) => archived(`interrupt-run-${index}`)));
	for (const receipt of runs) {
		assert.equal(receipt.applicationCommit, '465225776014a2724ff0b29b4821d44d4284616e');
		assert(receipt.qualification.checks.filter((check) => !check.id.startsWith('interrupt:')).every((check) => check.passed));
	}
	assert.deepEqual([runs[0].qualification.passed, runs[0].qualification.total], [38, 38]);
	for (const receipt of runs.slice(1)) {
		assert.deepEqual(receipt.qualification.checks.filter((check) => !check.passed).map((check) => check.id), [
			'interrupt:script', 'interrupt:supervisor-statuses', 'interrupt:interrupted-while-running', 'interrupt:interrupted-compile-discarded'
		]);
		// One second after the snapshot adapter reported running, the compile was already completing.
		const timeline = receipt.runs[2].result.timeline;
		const late = timeline.filter((entry) => entry.type === 'interrupt')[1];
		const end = timeline.find((entry) => entry.type === 'dispatchEnd' && entry.seq > late.seq);
		assert.equal(end.status, 0);
		assert(end.atMs - late.atMs <= 5);
	}
});

test('with a 50 ms compile interrupt, three consecutive runs pass cold, warm and interrupt', async () => {
	for (const index of [5, 6, 7]) {
		const receipt = await archived(`interrupt-run-${index}`);
		assert.equal(receipt.applicationCommit, '5c55b7b775cfe256928550c2875a158e0c229510');
		assert.deepEqual([receipt.qualification.passed, receipt.qualification.total, receipt.shellAcceptancePassed], [38, 38, true]);
		assert.equal((await archived(`interrupt-run-${index}-process`)).exitCode, 0);
	}
});

test('the failure runs: integrity, compile error and missing command stay contained', async () => {
	const runs = await Promise.all([1, 2, 3].map((index) => archived(`failure-run-${index}`)));
	for (const receipt of runs) {
		assert.equal(receipt.applicationCommit, 'd7ae6f8cca75e430a29b3179def468455861624f');
		assert(receipt.qualification.checks.filter((check) => check.id.startsWith('failure:') && check.id !== 'failure:owned-workers-retired').every((check) => check.passed));
		const failure = receipt.runs.find((run) => run.run === 'failure').result;
		assert.equal(Buffer.from(failure.result.stdout).toString(), 'mkdir=126\nretry=126\nbad=1\nno-artifact\nmissing=127\nhello\n');
	}
	assert.deepEqual(runs.map((receipt) => receipt.qualification.passed), [47, 47, 46]);
	// The third run missed only the owner Worker's five-second retirement window.
	assert.deepEqual(runs[2].qualification.checks.filter((check) => !check.passed).map((check) => check.id), ['failure:owned-workers-retired']);
	assert.equal(runs[2].workersAfterContextClose, 0);
});
