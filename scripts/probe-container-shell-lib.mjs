const encode = (text) => Array.from(new TextEncoder().encode(text));
const equal = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
const completed = (value, code = 0) => value?.type === 'result' && value.result?.code === code;
const stdout = (value, text) => completed(value) && equal(value.result.stdout, encode(text));
const magic = (value) => Array.isArray(value) && equal(value.slice(0, 4), [0, 97, 115, 109]);

// Compare actual browser observations against contracts, including known failing gates.
// A successfully collected report is deliberately separate from backend qualification.
export function judgeShellProbe(results) {
	const find = (id) => results.find((value) => value.id === id);
	const checks = [];
	const check = (id, fixture, passed, expectation) =>
		checks.push({
			id,
			fixture,
			status: !find(fixture) ? 'not-run' : passed ? 'passed' : 'failed',
			expectation
		});
	const report = find('G0-SHELL');
	check(
		'argv-env',
		'G0-SHELL',
		stdout(
			report,
			'arg=./probe.wasm\0arg=report\0arg=space arg\0arg=한글\0arg=\0G0=space 한글\0'
		),
		'Preserve spaces, UTF-8 and the empty argument, plus the exported environment.'
	);
	check(
		'stderr-bytes',
		'G0-SHELL',
		completed(report) &&
			equal(report.result.stderr, [...encode('stderr'), 0, 255, 226, 130, 172]),
		'Keep stderr distinct and preserve NUL, invalid UTF-8 and multi-byte UTF-8.'
	);
	check(
		'nonzero-exit',
		'G0-EXIT',
		stdout(find('G0-EXIT'), 'exit=23\n'),
		'Preserve the real guest exit code 23.'
	);
	check(
		'cwd',
		'G0-CWD',
		stdout(find('G0-CWD'), '/workspace/sub\nexit=0\n'),
		'Read the child cwd with wasix_32v1.getcwd after the real shell changes directory.'
	);
	check(
		'tail-exec',
		'G0-TAIL-EXEC',
		completed(find('G0-TAIL-EXEC')),
		'A script ending with an external command completes without a host timeout.'
	);
	const binary = [0, 255, 226, 130, 172, 10, 13, 97, 98];
	const fd = find('G0-FD');
	check(
		'pipe-bytes',
		'G0-FD',
		completed(fd) && equal(fd.result.stdout, binary) && equal(fd.result.stderr, []),
		'Two real external commands preserve the pipe bytes and observe EOF.'
	);
	check(
		'redirect-mount',
		'G0-FD',
		completed(fd) && equal(fd.files?.['/binary'], binary),
		'The pipeline redirect creates the same file visible through the host Directory.'
	);
	const fs = find('G0-FS');
	check(
		'shared-files',
		'G0-FS',
		stdout(fs, 'real-cwd\nfile-exit=0\nfrom-shell\n') &&
			equal(fs.files?.['/sub/source'], encode('from-shell\n')) &&
			equal(fs.files?.['/sub/changed'], encode('from-shell\n')),
		'Shell writes, child reads/writes, and host/parent shell observe the same bytes.'
	);
	for (const mode of ['CPU', 'READ', 'DOWNLOAD']) {
		const id = `G0-CANCEL-${mode}`;
		const value = find(id);
		const readyBytes = value?.trace
			?.filter(({ stream }) => stream === 'stdout')
			.flatMap(({ bytes }) => bytes);
		check(
			`cancel-${mode.toLowerCase()}`,
			id,
			value?.type === 'cancelled' &&
				value.remainingTrackedWorkers === 0 &&
				value.remainingWorkerTargets === 0 &&
				stdout(value.recovery, 'recovered') &&
				(mode === 'DOWNLOAD'
					? value.activeDownloads === 0 && value.abortedDownloads > 0
					: equal(readyBytes, encode('ready\n'))),
			'Cancel an observed running guest or pending fetch, retire its Worker group, then start another real Bash group in the same page.'
		);
	}
	const version = find('G0-CLANG-VERSION');
	check(
		'clang-version',
		'G0-CLANG-VERSION',
		completed(version) &&
			new TextDecoder()
				.decode(new Uint8Array(version.result.stdout))
				.includes('clang version'),
		'The pinned real Clang binary reports its version under the Bash backend.'
	);
	for (const [id, file] of [
		['G0-CLANG-RELATIVE', '/main.o'],
		['G0-CLANG-COMPILE', '/main.o'],
		['G0-CLANG-LINK', '/hello.wasm']
	]) {
		const value = find(id);
		check(
			id.toLowerCase(),
			id,
			completed(value) && magic(value.files?.[file]),
			`The unmodified Clang argv succeeds and creates ${file} with Wasm magic.`
		);
	}
	const link = find('G0-CLANG-LINK');
	check(
		'clang-artifact-run',
		'G0-CLANG-LINK',
		completed(link) && link.artifactReturnValue === 1,
		'Instantiate the linked freestanding artifact and execute its actual exported function.'
	);
	checks.push({
		id: 'resource-groups',
		status:
			results.length > 0 &&
			results.every(
				(value) => value.remainingWorkerTargets === 0 && value.blockedRequests.length === 0
			)
				? 'passed'
				: 'failed',
		expectation:
			'All observed Worker groups retire within five seconds and no external network request is attempted.'
	});
	return { shellBackendReady: checks.every(({ status }) => status === 'passed'), checks };
}
