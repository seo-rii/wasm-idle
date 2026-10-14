import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	buildBashShim,
	compilerWrapper,
	parseOptions,
	verifyArchive,
	verifyLocalSources
} from './build.mjs';
import { inspectBashShim, readProducerLock, sha256 } from './verify.mjs';

const fixture = async (callback) => {
	const directory = await mkdtemp(path.join(tmpdir(), 'bash-shim-producer-'));
	try {
		return await callback(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
};

test('plan verifies pinned source dependencies, preserves all original archive pins, and runs no tools', async () => {
	const lock = await readProducerLock();
	const baseline = JSON.parse(
		await readFile(new URL('../../../../scripts/wasm-bash-assets.lock.json', import.meta.url))
	).bash.runtimeBuild;
	for (const [name, prefix] of [
		['source', 'source'],
		['sysroot', 'sysroot'],
		['toolchain', 'toolchain'],
		['binaryen', 'binaryen'],
		['wasmer', 'wasmer']
	]) {
		assert.equal(lock.inputs[name].url, baseline[`${prefix}ArchiveUrl`]);
		assert.equal(lock.inputs[name].sha256, baseline[`${prefix}ArchiveSha256`]);
	}
	const before = await readFile(new URL('../../scripts/prepare-runtime.mjs', import.meta.url));
	const plan = await buildBashShim(parseOptions(['--plan', '--webc', '--jobs', '1']));
	assert.equal(plan.status, 'plan-only-no-download-no-build');
	assert.equal(plan.inputs.length, 5);
	assert.equal(plan.jobs, 1);
	assert.deepEqual(
		await readFile(new URL('../../scripts/prepare-runtime.mjs', import.meta.url)),
		before
	);
});

test('CLI invoked through a symlinked checkout path still runs instead of exiting silently', async () =>
	fixture(async (directory) => {
		const alias = path.join(directory, 'producer-alias');
		await symlink(path.dirname(fileURLToPath(import.meta.url)), alias);
		const stdout = execFileSync(
			process.execPath,
			[path.join(alias, 'build.mjs'), '--plan', '--jobs', '1'],
			{ encoding: 'utf8' }
		);
		assert.equal(JSON.parse(stdout).status, 'plan-only-no-download-no-build');
	}));

test('unknown, repeated, unsafe-path, overlapping and invalid resource options fail closed', () => {
	for (const args of [
		['--unknown'],
		['--jobs', '8'],
		['--jobs', '1.5'],
		['--plan', '--plan'],
		['--plan', '--download'],
		['--fetch-only', '--cache', '/tmp/cache'],
		['--cache', '/tmp/cache', '--output', '/tmp/cache/output'],
		['--cache', '/tmp/cache', '--output', '/tmp/output$', '--download'],
		['--cache', '/tmp/cache', '--output', 'relative'],
		['--cache', '/tmp/cache', '--output', '/tmp/output with space']
	])
		assert.throws(() => parseOptions(args), args.join(' '));
	assert.equal(
		parseOptions(['--cache', '/tmp/private-cache', '--download', '--fetch-only']).fetchOnly,
		true
	);
});

test('import allowlist is exactly the inventory of the pinned G0 Bash receipt', async () => {
	const { baselineImportProfile: profile } = await readProducerLock();
	const evidence = await readFile(
		new URL(`../../../../${profile.evidencePath}`, import.meta.url)
	);
	assert.equal(sha256(evidence), profile.evidenceSha256, 'pinned G0 receipt identity');
	const inventory = JSON.parse(evidence).runtimeInventory;
	assert.equal(inventory.bashWasmSha256, profile.wasmSha256);
	assert.deepEqual(profile.imports, inventory.bashImports);
});

test('changed shim/runtime dependencies are rejected before preparing output', async () => {
	const lock = await readProducerLock();
	lock.sdkPrerequisite.localFiles['execve.c'] = '0'.repeat(64);
	await assert.rejects(verifyLocalSources(lock), /source dependency identity: execve.c/);
});

test('existing output is preserved and rejected before cache creation or downloads', async () =>
	fixture(async (directory) => {
		const output = path.join(directory, 'output'),
			cache = path.join(directory, 'cache');
		await mkdir(output);
		await writeFile(path.join(output, 'user-data'), 'keep');
		await assert.rejects(
			buildBashShim(parseOptions(['--cache', cache, '--output', output, '--download'])),
			/output must be fresh/
		);
		assert.equal(await readFile(path.join(output, 'user-data'), 'utf8'), 'keep');
		assert.equal(await lstat(cache).catch(() => null), null);
	}));

test('mismatching cached archive is preserved and cannot begin extraction/build', async () =>
	fixture(async (directory) => {
		const lock = await readProducerLock();
		const cache = path.join(directory, 'cache'),
			output = path.join(directory, 'output');
		await mkdir(cache, { mode: 0o700 });
		const archive = path.join(cache, lock.inputs.source.filename);
		await writeFile(archive, 'untrusted archive');
		await assert.rejects(
			buildBashShim(parseOptions(['--cache', cache, '--output', output, '--download'])),
			/archive SHA-256 mismatch/
		);
		assert.equal(await readFile(archive, 'utf8'), 'untrusted archive');
		assert.equal(await lstat(output).catch(() => null), null);
	}));

test('archive verification rejects symlinks without altering the referenced bytes', async () =>
	fixture(async (directory) => {
		const file = path.join(directory, 'archive');
		await writeFile(file, 'immutable');
		assert.deepEqual(await verifyArchive(file, sha256('immutable')), {
			bytes: 9,
			sha256: sha256('immutable')
		});
		const { symlink } = await import('node:fs/promises');
		await symlink(file, path.join(directory, 'link'));
		await assert.rejects(
			verifyArchive(path.join(directory, 'link'), sha256('immutable')),
			/regular file/
		);
		assert.equal(await readFile(file, 'utf8'), 'immutable');
	}));

test('compiler wrapper injects only link object and preserves original arguments byte-for-byte', async () =>
	fixture(async (directory) => {
		// This is an argv protocol unit test, not compiler/Bash runtime evidence.
		const compiler = path.join(directory, 'clang'),
			wrapper = path.join(directory, 'wrapper');
		const resource = path.join(directory, 'resource'),
			object = path.join(directory, 'execve.o');
		const result = path.join(directory, 'argv.json');
		await writeFile(
			compiler,
			`#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.PRODUCER_ARGV_FILE, JSON.stringify(process.argv.slice(2)));\n`
		);
		await chmod(compiler, 0o700);
		await writeFile(wrapper, compilerWrapper(compiler, resource, object), { mode: 0o700 });
		for (const [args, inject] of [
			[['-c', 'space arg.c', '-o', 'object.o'], false],
			[['--version'], false],
			[['-v'], false],
			[['-E', 'main.c'], false],
			[['-MM', 'main.c'], false],
			[['--', '-c'], true],
			[['main.o', '-o', 'space app', '', '한글', 'line\nbreak', "literal'$()"], true]
		]) {
			execFileSync(wrapper, args, { env: { ...process.env, PRODUCER_ARGV_FILE: result } });
			assert.deepEqual(JSON.parse(await readFile(result)), [
				'-resource-dir',
				resource,
				...(inject ? [object] : []),
				...args
			]);
		}
	}));

const leb = (number) => {
	const out = [];
	do {
		const byte = number & 127;
		number = Math.floor(number / 128);
		out.push(byte | (number ? 128 : 0));
	} while (number);
	return out;
};
const text = (value) => {
	const bytes = Array.from(Buffer.from(value));
	return [...leb(bytes.length), ...bytes];
};
const section = (id, payload) => [id, ...leb(payload.length), ...payload];

// Tiny actual Wasm modules test the verifier. They cannot qualify a real Bash build.
function testModule({
	exec = true,
	wrongType = false,
	unknown = false,
	asyncify = true,
	shared = true
} = {}) {
	const types = [
		[0x60, 7, ...Array(7).fill(0x7f), 1, 0x7f],
		[0x60, 0, 0],
		[0x60, 1, 0x7f, 0],
		[0x60, 0, 1, 0x7f]
	];
	const imports = [];
	if (exec)
		imports.push([...text('wasm_idle_shell_v1'), ...text('exec_v1'), 0, wrongType ? 1 : 0]);
	if (unknown) imports.push([...text('untrusted'), ...text('dispatch'), 0, 1]);
	imports.push([...text('env'), ...text('memory'), 2, shared ? 3 : 1, 1, 2]);
	const count = (exec ? 1 : 0) + (unknown ? 1 : 0);
	const functions = asyncify ? [1, 2, 1, 2, 1, 3] : [1];
	const exports = (
		asyncify
			? [
					'_start',
					'asyncify_start_unwind',
					'asyncify_stop_unwind',
					'asyncify_start_rewind',
					'asyncify_stop_rewind',
					'asyncify_get_state'
				]
			: ['_start']
	).map((name, index) => [...text(name), 0, ...leb(count + index)]);
	const code = functions.map((type) => {
		const body = [0, ...(type === 3 ? [0x41, 0] : []), 0x0b];
		return [...leb(body.length), ...body];
	});
	return Uint8Array.from([
		0,
		97,
		115,
		109,
		1,
		0,
		0,
		0,
		...section(1, [types.length, ...types.flat()]),
		...section(2, [imports.length, ...imports.flat()]),
		...section(3, [functions.length, ...functions]),
		...section(7, [exports.length, ...exports.flat()]),
		...section(10, [code.length, ...code.flat()])
	]);
}

test('private framed ABI requires actual seven-i32 import, Asyncify exports and shared memory', async () => {
	const lock = await readProducerLock();
	const result = inspectBashShim(testModule(), lock);
	assert.equal(result.execSignature.params.length, 7);
	assert.equal(result.memories[0].flags, 3);
	assert.equal(result.qualification, 'producer-import-profile-only; no guest execution');
	assert.throws(
		() => inspectBashShim(testModule({ exec: false }), lock),
		/import exactly one framed/
	);
	assert.throws(() => inspectBashShim(testModule({ wrongType: true }), lock), /seven i32/);
	assert.throws(() => inspectBashShim(testModule({ unknown: true }), lock), /unapproved import/);
	assert.throws(() => inspectBashShim(testModule({ asyncify: false }), lock), /missing asyncify/);
	assert.throws(() => inspectBashShim(testModule({ shared: false }), lock), /shared memory/);
});
