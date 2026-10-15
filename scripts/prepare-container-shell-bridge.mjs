// Offline source preparation only. No producer binary or supported backend is published.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
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
	'0014-dup2-onto-a-pipe.patch'
];
// SDK patches apply to the extracted SDK before its Cargo path override.
const sdkPatches = [
	'0008-dispatch-trusted-host-commands.patch',
	'0011-mount-host-filesystems.patch',
	'0013-serve-host-commands-off-the-scheduler.patch'
];
// Standalone new sources: [bridge file, crate, installed path].
const installedSources = [
	['exec_frame.rs', 'wasmer-wasix', 'src/syscalls/wasix/exec_frame.rs'],
	['proc_exec_v1.rs', 'wasmer-wasix', 'src/syscalls/wasix/proc_exec_v1.rs'],
	['host_command_io.rs', 'wasmer-wasix', 'src/state/host_command_io.rs'],
	['sdk_host_command.rs', 'wasmer-sdk', 'src/host_command.rs'],
	['sdk_host_filesystem.rs', 'wasmer-sdk', 'src/host_filesystem.rs']
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
	await verifySource(source, inputs[1].path, wasixPrefix, patches);
	await verifySource(sdkSource, inputs[0].path, sdkPrefix, sdkPatches);
	const receipts = {};
	// Each crate's patches apply independently to its pristine checkout.
	for (const [names, cwd] of [
		[patches, source],
		[sdkPatches, sdkSource]
	]) {
		for (const name of names) {
			const path = join(bridge, 'patches', name);
			execFileSync('patch', ['--dry-run', '--batch', '--fuzz=0', '-p1', '-i', path], {
				cwd,
				stdio: 'pipe'
			});
			receipts[name] = sha256(await readFile(path));
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
		[sdkPatches, 'wasmer-sdk']
	]) {
		for (const name of names) {
			const path = join(bridge, 'patches', name);
			// Sequential patches may apply at an offset; never leave *.orig backups.
			execFileSync(
				'patch',
				['--batch', '--fuzz=0', '--no-backup-if-mismatch', '-p1', '-i', path],
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
			'[patch.crates-io]\nwasmer-wasix = { path = "../wasmer-wasix" }'
		)
	);
	// Only this crate's source identity changes. Keep every other locked version/checksum.
	const lockPath = join(output, 'wasmer-sdk/Cargo.lock');
	const lock = await readFile(lockPath, 'utf8');
	const original =
		'name = "wasmer-wasix"\nversion = "0.601.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "a9a804fcfbdbbfe5b2d6fb30e741e22a21e88e964dedfea9e609f13a52823bfe"';
	assert.equal(lock.split(original).length, 2);
	await writeFile(lockPath, lock.replace(original, 'name = "wasmer-wasix"\nversion = "0.601.0"'));
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
