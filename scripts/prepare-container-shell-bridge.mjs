// Offline source preparation only. No producer binary or supported backend is published.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { verifyShellWorkerImports } from './verify-container-shell-worker-imports.mjs';

const bridge = fileURLToPath(new URL('../runtimes/wasm-bash/bridge/', import.meta.url));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const option = (name) => {
	const index = process.argv.indexOf(name);
	assert(
		index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--'),
		`Required ${name}`
	);
	return resolve(process.argv[index + 1]);
};
const inputs = [
	{
		name: 'wasmer-sdk',
		path: option('--sdk-archive'),
		sha256: 'ca5df306ffcb260fb3086e89d450aafac106e200ccf7b49bb03c348bc2208712',
		bytes: 2888858
	},
	{
		name: 'wasmer-wasix',
		path: option('--wasix-archive'),
		sha256: 'a9a804fcfbdbbfe5b2d6fb30e741e22a21e88e964dedfea9e609f13a52823bfe',
		bytes: 2831166
	},
	{
		name: 'virtual-fs',
		path: option('--virtual-fs-archive'),
		sha256: '8defc513ce70576bdbb4305ee67c0cba647af18c0995de8f1fa1271b724c9859',
		bytes: 94253
	}
];
const verifyOnly = process.argv.includes('--verify-only');
for (const input of inputs) {
	assert.equal((await stat(input.path)).size, input.bytes, `${input.name} archive size`);
	assert.equal(sha256(await readFile(input.path)), input.sha256, `${input.name} archive SHA-256`);
}
const patches = [
	'0001-preserve-exec-unwind.patch',
	'0002-replace-explicit-environment.patch',
	'0003-add-lossless-exec-frame.patch',
	'0004-expose-host-command-hook.patch',
	'0005-owned-command-snapshot.patch',
	'0006-register-worker-shell-import.patch',
	'0007-delegate-host-command-descriptors.patch',
	'0009-preserve-join-exit-status.patch',
	'0010-keep-running-child-on-wnohang.patch',
	'0012-revalidate-live-mounts.patch',
	'0014-preserve-live-append.patch',
	'0015-dup2-onto-a-pipe.patch',
	'0018-use-bounded-pipes.patch',
	'0022-preserve-filesystem-wasi-errno.patch'
];
const virtualFsPatches = ['0017-bound-native-pipes.patch', '0021-retain-filesystem-io-errors.patch'];
// SDK patches apply to the extracted SDK before its Cargo path override.
const sdkPatches = [
	'0008-dispatch-trusted-host-commands.patch',
	'0011-mount-host-filesystems.patch',
	'0013-serve-host-commands-off-the-scheduler.patch',
	'0016-streaming-instance-exit.patch',
	'0019-bound-raw-sdk-streams.patch',
	'0020-honor-explicit-tmp-mount.patch'
];
// Standalone new sources: [bridge file, crate, installed path].
const installedSources = [
	['exec_frame.rs', 'wasmer-wasix', 'src/syscalls/wasix/exec_frame.rs'],
	['proc_exec_v1.rs', 'wasmer-wasix', 'src/syscalls/wasix/proc_exec_v1.rs'],
	['host_command_io.rs', 'wasmer-wasix', 'src/state/host_command_io.rs'],
	['sdk_host_command.rs', 'wasmer-sdk', 'src/host_command.rs'],
	['sdk_host_command_pending.rs', 'wasmer-sdk', 'src/host_command_pending.rs'],
	['sdk_host_filesystem.rs', 'wasmer-sdk', 'src/host_filesystem.rs'],
	['sdk_host_filesystem_lifetime.rs', 'wasmer-sdk', 'src/host_filesystem_lifetime.rs'],
	['sdk_exit_status.rs', 'wasmer-sdk', 'src/host_exit_status.rs'],
	['bounded_pipe.rs', 'virtual-fs', 'src/bounded_pipe.rs']
];
const compileProbe = 'host_command_compile_probe.rs';
const sdkExample = 'container_command_snapshot_compile';
const verifySource = async (source, archive, prefix, patchNames) => {
	const seen = new Set();
	for (const patch of patchNames) {
		const text = await readFile(join(bridge, 'patches', patch), 'utf8');
		for (const match of text.matchAll(/^--- (a\/.+|\/dev\/null)\n\+\+\+ b\/(.+)$/gm)) {
			const file = match[2];
			assert(/^[a-zA-Z0-9_./-]+$/.test(file) && !file.split('/').includes('..'));
			if (match[1] === '/dev/null') {
				assert.equal(
					await stat(join(source, file)).catch(() => null),
					null,
					`${file}: new source must not exist in the pristine checkout`
				);
				continue;
			}
			assert.equal(match[1], `a/${file}`, `${file}: patch source/destination identity`);
			if (seen.has(file)) continue;
			seen.add(file);
			const expected = execFileSync('tar', ['-xOzf', archive, `${prefix}/${file}`]);
			assert.equal(
				sha256(await readFile(join(source, file))),
				sha256(expected),
				`${file}: pristine source identity`
			);
		}
	}
};
const wasixPrefix = 'wasmer-wasix-0.601.0';
const sdkPrefix = 'wasmer-sdk-93b8b738ebd3ee57e118da0f0eb795b97d5b999e';
if (verifyOnly) {
	const source = option('--wasix-source');
	const sdkSource = option('--sdk-source');
	const virtualFsSource = option('--virtual-fs-source');
	await verifySource(source, inputs[1].path, wasixPrefix, patches);
	await verifySource(sdkSource, inputs[0].path, sdkPrefix, sdkPatches);
	await verifySource(virtualFsSource, inputs[2].path, 'virtual-fs-0.601.0', virtualFsPatches);
	const receipts = {};
	// Check dependent patches in order on private copies, preserving the caller's sources.
	// --forward rejects reversed/already-applied patches instead of silently undoing them.
	for (const [names, cwd] of [
		[patches, source],
		[sdkPatches, sdkSource],
		[virtualFsPatches, virtualFsSource]
	]) {
		const temporary = await mkdtemp(join(tmpdir(), 'container-bridge-verify-'));
		try {
			const copy = join(temporary, 'source');
			await cp(cwd, copy, { recursive: true });
			for (const name of names) {
				const path = join(bridge, 'patches', name);
				execFileSync('patch', ['--batch', '--forward', '--fuzz=0', '--no-backup-if-mismatch', '-p1', '-i', path], {
					cwd: copy, stdio: 'pipe'
				});
				receipts[name] = sha256(await readFile(path));
			}
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	}
	for (const [name] of installedSources) {
		receipts[name] = sha256(await readFile(join(bridge, name)));
	}
	receipts['execve.c'] = sha256(await readFile(join(bridge, 'execve.c')));
	receipts[compileProbe] = sha256(await readFile(join(bridge, compileProbe)));
	// Dry-run must preserve the supplied pristine checkouts.
	await verifySource(source, inputs[1].path, wasixPrefix, patches);
	await verifySource(sdkSource, inputs[0].path, sdkPrefix, sdkPatches);
	await verifySource(virtualFsSource, inputs[2].path, 'virtual-fs-0.601.0', virtualFsPatches);
	console.log(
		JSON.stringify(
			{
				schemaVersion: 1,
				status: 'patches-apply-cleanly-not-built',
				sdkSourceRevision: '93b8b738ebd3ee57e118da0f0eb795b97d5b999e',
				inputs: inputs.map(({ name, sha256, bytes }) => ({ name, sha256, bytes })),
				patches: receipts,
				compilerProbe: {
					status: 'not-run',
					sdkExample,
					sourceSha256: receipts[compileProbe]
				},
				limitations: [
					'No Wasmer typecheck, SDK rebuild or patched Bash/browser qualification',
					'No common Container fd/VFS ownership or public package API'
				]
			},
			null,
			2
		)
	);
} else {
	const output = option('--output');
	// Must be a fresh directory. Never patch the caller's source checkout or existing output.
	await mkdir(output);
	for (const input of inputs) {
		const destination = join(output, input.name);
		await mkdir(destination);
		// The entire immutable source archive was verified above, before extracting any entry.
		execFileSync(
			'tar',
			['-xzf', input.path, '-C', destination, '--strip-components=1', '--no-same-owner'],
			{ stdio: 'pipe' }
		);
	}
	const receipts = {};
	for (const [names, crate] of [
		[patches, 'wasmer-wasix'],
		[sdkPatches, 'wasmer-sdk'],
		[virtualFsPatches, 'virtual-fs']
	]) {
		for (const name of names) {
			const path = join(bridge, 'patches', name);
			// Sequential patches may apply at an offset; never leave *.orig backups.
			execFileSync(
				'patch',
				['--batch', '--forward', '--fuzz=0', '--no-backup-if-mismatch', '-p1', '-i', path],
				{
					cwd: join(output, crate),
					stdio: 'pipe'
				}
			);
			receipts[name] = sha256(await readFile(path));
		}
	}
	for (const [name, crate, destination] of installedSources) {
		const target = join(output, crate, destination);
		assert.equal(await stat(target).catch(() => null), null, `${destination} must be new`);
		await cp(join(bridge, name), target);
		receipts[name] = sha256(await readFile(join(bridge, name)));
	}
	const workerImports = await verifyShellWorkerImports(join(output, 'wasmer-wasix'));
	await cp(join(bridge, compileProbe), join(output, 'wasmer-sdk/examples', `${sdkExample}.rs`));
	receipts[compileProbe] = sha256(await readFile(join(bridge, compileProbe)));
	const cargo = join(output, 'wasmer-sdk/Cargo.toml');
	const manifest = await readFile(cargo, 'utf8');
	assert.equal(manifest.split('[patch.crates-io]').length, 2);
	await writeFile(
		cargo,
		manifest.replace(
			'[patch.crates-io]',
			'[patch.crates-io]\nwasmer-wasix = { path = "../wasmer-wasix" }\nvirtual-fs = { path = "../virtual-fs" }'
		)
	);
	// Only this crate's source identity changes. Keep every other locked version/checksum.
	const lockPath = join(output, 'wasmer-sdk/Cargo.lock');
	const lock = await readFile(lockPath, 'utf8');
	const original =
		'name = "wasmer-wasix"\nversion = "0.601.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "a9a804fcfbdbbfe5b2d6fb30e741e22a21e88e964dedfea9e609f13a52823bfe"';
	assert.equal(lock.split(original).length, 2);
	const virtualFsOriginal =
		'name = "virtual-fs"\nversion = "0.601.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "8defc513ce70576bdbb4305ee67c0cba647af18c0995de8f1fa1271b724c9859"';
	assert.equal(lock.split(virtualFsOriginal).length, 2);
	await writeFile(lockPath, lock
		.replace(original, 'name = "wasmer-wasix"\nversion = "0.601.0"')
		.replace(virtualFsOriginal, 'name = "virtual-fs"\nversion = "0.601.0"'));

	const receipt = {
		schemaVersion: 1,
		status: 'source-prepared-not-built',
		sdkSourceRevision: '93b8b738ebd3ee57e118da0f0eb795b97d5b999e',
		inputs: inputs.map(({ name, sha256, bytes }) => ({ name, sha256, bytes })),
		patches: receipts,
		workerImports,
		compilerProbe: {
			status: 'not-run',
			sdkExample,
			sourceSha256: receipts[compileProbe]
		},
		limitations: [
			'No SDK rebuild or patched Bash/browser qualification',
			'Host commands receive descriptors 0-2 only; no common Container fd/VFS ownership'
		]
	};
	await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
	console.log(JSON.stringify({ output, status: receipt.status, patches: Object.keys(receipts) }));
}
