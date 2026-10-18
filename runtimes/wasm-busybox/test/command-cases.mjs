// Data fixtures only: execute the real upstream BusyBox in every host.
// This module intentionally uses browser builtins so Node and Chromium share it.
const encode = (value) =>
	typeof value === 'string' ? new TextEncoder().encode(value) : Uint8Array.from(value);
export const toHex = (value) =>
	Array.from(encode(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
export const fromHex = (value) =>
	Uint8Array.from(value.match(/../gu) ?? [], (byte) => parseInt(byte, 16));
const file = (value) => ({ type: 'file', hex: toHex(value) });
const directory = { type: 'directory' };
const symlink = (target) => ({ type: 'symlink', target });
const binary = Uint8Array.from({ length: 8193 }, (_, index) => index % 256);
const text = 'one\ntwo\nthree\nfour';
const cases = [];
function add(stage, id, applet, args, options = {}) {
	const {
		input = '',
		before = {},
		after = before,
		code = 0,
		output = '',
		error = '',
		stderrMode = 'exact',
		stdoutPattern,
		normalizeCwd = false,
		differential = true,
		wasiOnly = false,
		outputOrder,
		steps
	} = options;
	cases.push({
		stage,
		id,
		before,
		after,
		differential,
		...(wasiOnly ? { wasiOnly: true } : {}),
		steps: steps ?? [
			{
				applet,
				args,
				stdinHex: toHex(input),
				code,
				stdoutHex: toHex(output),
				stderrHex: toHex(error),
				stderrMode,
				...(stdoutPattern ? { stdoutPattern } : {}),
				...(normalizeCwd ? { normalizeCwd } : {}),
				...(outputOrder ? { outputOrder } : {})
			}
		]
	});
}
const step = (applet, args, output = '', extra = {}) => ({
	applet,
	args,
	stdinHex: '',
	code: 0,
	stdoutHex: toHex(output),
	stderrHex: '',
	stderrMode: 'exact',
	...extra
});
const missing = { code: 1, stderrMode: 'nonempty' };
const listing = {
	'.hidden': file('hidden'),
	'a b': file('space'),
	nested: directory,
	한글: file('utf8')
};
add(1, 'ls-visible', 'ls', ['-1'], { before: listing, output: 'a b\nnested\n한글\n' });
add(1, 'ls-all', 'ls', ['-1a'], { before: listing, output: '.\n..\n.hidden\na b\nnested\n한글\n' });
add(1, 'ls-almost-all', 'ls', ['-1A'], { before: listing, output: '.hidden\na b\nnested\n한글\n' });
add(1, 'ls-directory-only', 'ls', ['-d', 'nested'], { before: listing, output: 'nested\n' });
add(1, 'ls-empty', 'ls', ['-1']);
add(1, 'ls-missing', 'ls', ['missing'], missing);
add(1, 'ls-symlink-directory', 'ls', ['-1', 'link/'], {
	before: { dir: directory, 'dir/a b': file('x'), link: symlink('dir') },
	output: 'a b\n'
});
const largeDirectory = { dir: directory };
for (let index = 0; index < 200; index++)
	largeDirectory[`dir/entry-${String(index).padStart(3, '0')}-${'x'.repeat(48)}`] = file([
		index % 256
	]);
add(1, 'ls-readdir-boundary', 'ls', ['-1', 'dir'], {
	before: largeDirectory,
	output: Object.keys(largeDirectory)
		.slice(1)
		.map((path) => path.slice(4) + '\n')
		.join('')
});
add(1, 'rmdir-empty', 'rmdir', ['empty dir'], { before: { 'empty dir': directory }, after: {} });
add(1, 'rmdir-nonempty', 'rmdir', ['dir'], {
	before: { dir: directory, 'dir/file': file('keep') },
	...missing
});
add(1, 'rmdir-missing', 'rmdir', ['missing'], missing);
add(1, 'head-lines', 'head', ['-n', '2'], { input: text, output: 'one\ntwo\n' });
add(1, 'head-empty', 'head', [], {});
add(1, 'head-file-space', 'head', ['-n', '1', '한 글.txt'], {
	before: { '한 글.txt': file('한글\nnext\n') },
	output: '한글\n'
});
add(1, 'head-bytes-binary', 'head', ['-c', '4'], { input: binary, output: binary.subarray(0, 4) });
add(1, 'head-missing', 'head', ['missing'], missing);
add(1, 'tail-lines', 'tail', ['-n', '2'], { input: text, output: 'three\nfour' });
add(1, 'tail-empty', 'tail', [], {});
add(1, 'tail-binary', 'tail', ['-c', '4'], {
	input: binary,
	output: binary.subarray(binary.length - 4)
});
add(1, 'tail-file', 'tail', ['-n', '1', 'lines'], {
	before: { lines: file('한글\nlast\n') },
	output: 'last\n'
});
add(1, 'tail-missing', 'tail', ['missing'], missing);
add(1, 'wc-lines', 'wc', ['-l'], { input: text, output: '3\n' });
add(1, 'wc-words', 'wc', ['-w'], { input: 'one  two\tthree\n', output: '3\n' });
add(1, 'wc-bytes-utf8', 'wc', ['-c'], { input: '한글\n', output: '7\n' });
add(1, 'wc-bytes-binary', 'wc', ['-c'], { input: binary, output: '8193\n' });
add(1, 'wc-empty', 'wc', ['-l'], { output: '0\n' });
add(1, 'wc-missing', 'wc', ['-c', 'missing'], missing);
add(1, 'tee-binary', 'tee', ['output file'], {
	input: binary,
	output: binary,
	after: { 'output file': file(binary) }
});
add(1, 'tee-append', 'tee', ['-a', 'output'], {
	input: '한글\n',
	output: '한글\n',
	before: { output: file('prefix\n') },
	after: { output: file('prefix\n한글\n') }
});
add(1, 'tee-empty-truncates', 'tee', ['output'], {
	before: { output: file('old') },
	after: { output: file('') }
});
add(1, 'sort-lines', 'sort', [], { input: 'z\na\n한글\na\n', output: 'a\na\nz\n한글\n' });
add(1, 'sort-numeric', 'sort', ['-n'], { input: '11\n2\n-1\n', output: '-1\n2\n11\n' });
add(1, 'sort-reverse-unique', 'sort', ['-ru'], { input: 'b\na\nb\n', output: 'b\na\n' });
add(1, 'sort-empty', 'sort', []);
add(1, 'uniq-adjacent', 'uniq', [], { input: 'a\na\nb\na\n', output: 'a\nb\na\n' });
add(1, 'uniq-duplicates', 'uniq', ['-d'], { input: '한글\n한글\nx\n', output: '한글\n' });
add(1, 'uniq-empty', 'uniq', []);
add(1, 'cut-fields', 'cut', ['-d', ':', '-f', '2'], {
	input: 'one:둘:three\nplain\n',
	output: '둘\nplain\n'
});
add(1, 'cut-bytes-high-bit', 'cut', ['-b', '2-4'], {
	input: [65, 254, 255, 66, 10],
	output: [254, 255, 66, 10]
});
add(1, 'cut-suppress', 'cut', ['-s', '-d', ':', '-f', '1'], {
	input: 'plain\na:b\n',
	output: 'a\n'
});
add(1, 'tr-uppercase', 'tr', ['a-z', 'A-Z'], { input: 'a b\n한글\n', output: 'A B\n한글\n' });
add(1, 'tr-delete-binary', 'tr', ['-d', '\\000'], {
	input: [65, 0, 255, 0, 10],
	output: [65, 255, 10]
});
add(1, 'tr-squeeze', 'tr', ['-s', ' '], { input: 'a   b  c\n', output: 'a b c\n' });
add(1, 'basename-space', 'basename', ['/workspace/a b/한 글.txt', '.txt'], { output: '한 글\n' });
add(1, 'basename-root', 'basename', ['/'], { output: '/\n' });
add(1, 'dirname-space', 'dirname', ['a b/한 글.txt'], { output: 'a b\n' });
add(1, 'dirname-simple', 'dirname', ['file'], { output: '.\n' });
add(1, 'readlink-relative', 'readlink', ['link'], {
	before: { target: file('x'), link: symlink('target') },
	output: 'target\n'
});
add(1, 'readlink-dangling', 'readlink', ['link'], {
	before: { link: symlink('missing') },
	output: 'missing\n'
});
add(1, 'readlink-not-link', 'readlink', ['file'], { before: { file: file('') }, code: 1 });
add(1, 'realpath-symlink', 'realpath', ['link'], {
	before: { target: directory, link: symlink('target') },
	output: '/workspace/a b/target\n',
	normalizeCwd: true
});
add(1, 'realpath-dotdot', 'realpath', ['./dir/../file'], {
	before: { dir: directory, file: file('') },
	output: '/workspace/a b/file\n',
	normalizeCwd: true
});
add(1, 'realpath-missing-parent', 'realpath', ['missing/child'], missing);

add(2, 'sed-substitute-utf8', 'sed', ['s/한글/hello/g'], {
	input: '한글 한글\n',
	output: 'hello hello\n'
});
add(2, 'sed-address', 'sed', ['-n', '2,3p'], { input: 'a\nb\nc\nd\n', output: 'b\nc\n' });
add(2, 'sed-script-file', 'sed', ['-f', 'script file', 'input'], {
	before: { 'script file': file('s/x/y/g\n'), input: file('x x\n') },
	output: 'y y\n'
});
add(2, 'sed-in-place-profile-rejection', 'sed', ['-i', 's/old/new/g', 'a b'], {
	before: { 'a b': file('old\n') },
	code: 1,
	stderrMode: 'nonempty',
	wasiOnly: true
});
add(2, 'sed-missing', 'sed', ['s/a/b/', 'missing'], missing);
const findTree = {
	tree: directory,
	'tree/a.txt': file('a'),
	'tree/nested': directory,
	'tree/nested/한 글.txt': file('b'),
	'tree/nested/data.bin': file(binary),
	'tree/link': symlink('a.txt')
};
add(2, 'find-name', 'find', ['tree', '-name', '*.txt'], {
	before: findTree,
	output: 'tree/a.txt\ntree/nested/한 글.txt\n',
	outputOrder: 'lines'
});
add(2, 'find-directory', 'find', ['tree', '-type', 'd'], {
	before: findTree,
	output: 'tree\ntree/nested\n',
	outputOrder: 'lines'
});
add(2, 'find-symlink', 'find', ['tree', '-type', 'l'], {
	before: findTree,
	output: 'tree/link\n',
	outputOrder: 'lines'
});
add(2, 'find-nul', 'find', ['tree', '-name', 'a.txt', '-print0'], {
	before: findTree,
	output: 'tree/a.txt\0'
});
add(2, 'find-missing', 'find', ['missing'], missing);
add(2, 'diff-equal', 'diff', ['a', 'b'], { before: { a: file(text), b: file(text) } });
add(2, 'diff-different', 'diff', ['-q', 'a', 'b'], {
	before: { a: file('a\n'), b: file('b\n') },
	code: 1,
	output: 'Files a and b differ\n'
});
add(2, 'diff-missing', 'diff', ['missing', 'b'], {
	before: { b: file('') },
	code: 2,
	stderrMode: 'nonempty'
});
add(2, 'cmp-equal-binary', 'cmp', ['a', 'b'], { before: { a: file(binary), b: file(binary) } });
add(2, 'cmp-different-quiet', 'cmp', ['-s', 'a', 'b'], {
	before: { a: file([0, 255]), b: file([0, 254]) },
	code: 1
});
add(2, 'cmp-missing', 'cmp', ['missing', 'b'], {
	before: { b: file('') },
	code: 2,
	stderrMode: 'nonempty'
});
for (const option of ['-r', '-R'])
	add(2, `cp-${option.slice(1)}-tree`, 'cp', [option, 'tree', 'copy'], {
		before: {
			tree: directory,
			'tree/nested': directory,
			'tree/nested/a b': file(binary),
			'tree/link': symlink('nested/a b')
		},
		after: {
			tree: directory,
			'tree/nested': directory,
			'tree/nested/a b': file(binary),
			'tree/link': symlink('nested/a b'),
			copy: directory,
			'copy/nested': directory,
			'copy/nested/a b': file(binary),
			'copy/link': symlink('nested/a b')
		}
	});
add(2, 'cp-r-into-existing', 'cp', ['-R', 'tree', 'dest'], {
	before: { tree: directory, 'tree/file': file('한글'), dest: directory },
	after: {
		tree: directory,
		'tree/file': file('한글'),
		dest: directory,
		'dest/tree': directory,
		'dest/tree/file': file('한글')
	}
});
add(2, 'ln-relative-symlink', 'ln', ['-s', 'target', 'link'], {
	before: { target: file('data') },
	after: { target: file('data'), link: symlink('target') }
});
add(2, 'ln-dangling-symlink', 'ln', ['-s', 'missing', '한 글'], {
	after: { '한 글': symlink('missing') }
});
add(2, 'ln-existing-error', 'ln', ['-s', 'target', 'link'], {
	before: { link: file('keep') },
	...missing
});
add(2, 'sha256sum-stdin', 'sha256sum', [], {
	input: 'abc',
	output: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  -\n'
});
add(2, 'sha256sum-empty-file', 'sha256sum', ['empty file'], {
	before: { 'empty file': file('') },
	output: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  empty file\n'
});
add(2, 'base64-binary', 'base64', [], { input: [0, 1, 2, 255], output: 'AAEC/w==\n' });
add(2, 'base64-decode', 'base64', ['-d'], { input: 'AAEC/w==\n', output: [0, 1, 2, 255] });
add(2, 'base64-empty', 'base64', []);
add(2, 'base64-truncated', 'base64', ['-d'], {
	input: 'A',
	code: 1,
	error: 'base64: truncated input\n'
});
add(2, 'od-hex', 'od', ['-An', '-tx1'], { input: [0, 1, 255, 10], output: ' 00 01 ff 0a\n' });
add(2, 'hexdump-format', 'hexdump', ['-v', '-e', '1/1 "%02x"'], {
	input: [0, 1, 255, 10],
	output: '0001ff0a'
});

const stamp = 1577934245000;
add(3, 'touch-create', 'touch', ['new file'], { after: { 'new file': file('') } });
add(3, 'touch-preserve-existing-bytes', 'touch', ['existing'], {
	before: { existing: file(binary) }
});
add(3, 'touch-no-create', 'touch', ['-c', 'missing']);
add(3, 'touch-explicit-time', 'touch', ['-t', '202001020304.05', 'meta.txt'], {
	before: { 'meta.txt': file('abc') },
	after: { 'meta.txt': { ...file('abc'), mtimeMs: stamp, atimeMs: stamp } }
});
add(3, 'touch-reference', 'touch', [], {
	before: { source: file('abc'), destination: file('unchanged') },
	after: {
		source: { ...file('abc'), mtimeMs: stamp, atimeMs: stamp },
		destination: { ...file('unchanged'), mtimeMs: stamp, atimeMs: stamp }
	},
	steps: [
		step('touch', ['-t', '202001020304.05', 'source']),
		step('touch', ['-r', 'source', 'destination'])
	]
});
add(3, 'touch-missing-parent', 'touch', ['missing/file'], missing);
add(3, 'stat-file', 'stat', ['-c', '%s|%F|%a', 'meta.txt'], {
	before: { 'meta.txt': file('abc') },
	output: '3|regular file|644\n'
});
add(3, 'stat-empty', 'stat', ['-c', '%s|%F', 'empty'], {
	before: { empty: file('') },
	output: '0|regular empty file\n'
});
add(3, 'stat-symlink', 'stat', ['-c', '%F', 'link'], {
	before: { target: file('abc'), link: symlink('target') },
	output: 'symbolic link\n'
});
add(3, 'stat-follow-symlink', 'stat', ['-L', '-c', '%s|%F', 'link'], {
	before: { target: file('abc'), link: symlink('target') },
	output: '3|regular file\n'
});
add(3, 'stat-explicit-time', 'stat', [], {
	before: { 'meta.txt': file('abc') },
	after: { 'meta.txt': { ...file('abc'), mtimeMs: stamp, atimeMs: stamp } },
	steps: [
		step('touch', ['-t', '202001020304.05', 'meta.txt']),
		step('stat', ['-c', '%X|%Y', 'meta.txt'], '1577934245|1577934245\n')
	]
});
add(3, 'ls-long-metadata', 'ls', [], {
	before: { 'meta.txt': file('abc') },
	after: { 'meta.txt': { ...file('abc'), mtimeMs: stamp, atimeMs: stamp } },
	differential: false,
	steps: [
		step('touch', ['-t', '202001020304.05', 'meta.txt']),
		step('ls', ['-ln', 'meta.txt'], '', {
			stdoutPattern:
				'^-rw-r--r--\\s+1\\s+\\d+\\s+\\d+\\s+3\\s+Jan\\s+2\\s+2020\\s+meta\\.txt\\n$'
		})
	]
});

// Static archives were produced by Python gzip/zipfile, not a utility emulator.
const archivedBytes = Uint8Array.of(104, 101, 108, 108, 111, 10, 0, 255);
const gzip = fromHex('1f8b0800000000000203cb48cdc9c9e762f80f0046df86df08000000');
const zip = fromHex(
	'504b03041400000008008318225046df86df0a000000080000000e000000696e7075742066696c652e62696ecb48cdc9c9e762f80f00504b010214031400000008008318225046df86df0a000000080000000e0000000000000000000000800100000000696e7075742066696c652e62696e504b050600000000010001003c000000360000000000'
);
add(4, 'gunzip-stdin-binary', 'gunzip', ['-c'], { input: gzip, output: archivedBytes });
add(4, 'gunzip-file', 'gunzip', ['input file.gz'], {
	before: { 'input file.gz': file(gzip) },
	after: { 'input file': file(archivedBytes) }
});
add(4, 'gzip-decode', 'gzip', ['-dc'], { input: gzip, output: archivedBytes });
add(4, 'gzip-invalid', 'gunzip', ['-c'], { input: 'invalid gzip data\n', ...missing });
add(4, 'gzip-roundtrip', 'gzip', [], {
	before: { 'input file': file(binary) },
	steps: [step('gzip', ['input file']), step('gunzip', ['input file.gz'])]
});
add(4, 'gzip-keep-roundtrip', 'gzip', [], {
	before: { source: file(archivedBytes) },
	after: { source: file(archivedBytes), 'source.gz': { type: 'file', minBytes: 18 } },
	differential: false,
	steps: [step('gzip', ['-k', 'source']), step('gunzip', ['-c', 'source.gz'], archivedBytes)]
});
add(4, 'unzip-extract-space-binary', 'unzip', ['-q', 'archive.zip'], {
	before: { 'archive.zip': file(zip) },
	after: { 'archive.zip': file(zip), 'input file.bin': file(archivedBytes) }
});
add(4, 'unzip-stdout-binary', 'unzip', ['-p', 'archive.zip', 'input file.bin'], {
	before: { 'archive.zip': file(zip) },
	output: archivedBytes
});
add(4, 'unzip-invalid', 'unzip', ['-q', 'archive.zip'], {
	before: { 'archive.zip': file('invalid zip data\n') },
	...missing
});
const tarTree = {
	source: directory,
	'source/nested': directory,
	'source/nested/a b': file(binary),
	'source/한글': file('hello\n'),
	'source/link': symlink('nested/a b')
};
const tarAfter = {
	...tarTree,
	'archive.tar': { type: 'file', minBytes: 1024 },
	extracted: directory
};
for (const [path, entry] of Object.entries(tarTree)) tarAfter[`extracted/${path}`] = entry;
add(4, 'tar-roundtrip', 'tar', [], {
	before: { ...tarTree, extracted: directory },
	after: tarAfter,
	differential: false,
	steps: [
		step('tar', ['-cf', 'archive.tar', 'source']),
		step('tar', ['-xf', 'archive.tar', '-C', 'extracted'])
	]
});
add(4, 'tar-invalid', 'tar', ['-tf', 'archive.tar'], {
	before: { 'archive.tar': file('invalid tar data\n') },
	...missing
});

export const commandStages = Object.freeze({
	1: [
		'ls',
		'rmdir',
		'head',
		'tail',
		'wc',
		'tee',
		'sort',
		'uniq',
		'cut',
		'tr',
		'basename',
		'dirname',
		'readlink',
		'realpath'
	],
	2: ['sed', 'find', 'diff', 'cmp', 'ln', 'sha256sum', 'base64', 'od', 'hexdump'],
	3: ['touch', 'stat'],
	4: ['tar', 'gzip', 'gunzip', 'unzip']
});
export function createCommandMatrix(stage = 1) {
	if (!Number.isInteger(stage) || stage < 1 || stage > 4)
		throw new Error('Command stage must be 1, 2, 3, or 4');
	return {
		schemaVersion: 1,
		profile: `busybox-command-stage-${stage}`,
		stage,
		applets: [
			...new Set([
				'cat',
				'cp',
				'echo',
				'false',
				'grep',
				'mkdir',
				'mv',
				'printf',
				'pwd',
				'rm',
				'true',
				...Object.entries(commandStages)
					.filter(([number]) => Number(number) <= stage)
					.flatMap(([, names]) => names)
			])
		].sort(),
		cases: cases.filter((test) => test.stage <= stage)
	};
}

export function compareTree(actual, expected) {
	const failures = [];
	const paths = Object.keys(expected).sort();
	if (JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(paths))
		failures.push('paths');
	for (const path of paths) {
		const wanted = expected[path],
			found = actual[path];
		if (!found) continue;
		for (const key of ['type', 'hex', 'target', 'mode', 'mtimeMs', 'atimeMs']) {
			if (wanted[key] !== undefined && wanted[key] !== found[key])
				failures.push(`${path}:${key}`);
		}
		if (
			wanted.minBytes !== undefined &&
			(typeof found.hex !== 'string' || found.hex.length / 2 < wanted.minBytes)
		)
			failures.push(`${path}:minBytes`);
	}
	return { passed: !failures.length, failures };
}

export function checkCommandResult(result, expected, cwd = '/workspace/a b') {
	let stdout = result.stdout;
	if (expected.normalizeCwd)
		stdout = new TextEncoder().encode(
			new TextDecoder().decode(stdout).split(cwd).join('/workspace/a b')
		);
	if (expected.outputOrder === 'lines' && stdout.length)
		stdout = new TextEncoder().encode(
			new TextDecoder()
				.decode(stdout)
				.split('\n')
				.filter((line) => line.length)
				.sort()
				.join('\n') + '\n'
		);
	const stdoutHex = toHex(stdout),
		stderrHex = toHex(result.stderr);
	const stdoutPassed = expected.stdoutPattern
		? new RegExp(expected.stdoutPattern, 'u').test(new TextDecoder().decode(stdout))
		: stdoutHex === expected.stdoutHex;
	const stderrPassed =
		expected.stderrMode === 'nonempty'
			? result.stderr.length > 0
			: stderrHex === expected.stderrHex;
	return {
		code: result.code,
		reason: result.reason,
		stdoutHex,
		stderrHex,
		passed:
			result.code === expected.code &&
			(!result.reason || result.reason === 'exited') &&
			stdoutPassed &&
			stderrPassed
	};
}
