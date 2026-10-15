// Offline source preparation only. No producer binary or supported backend is published.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
	'0005-owned-command-snapshot.patch'
];
const compileProbe = 'host_command_compile_probe.rs';
const sdkExample = 'container_command_snapshot_compile';
const verifySource = async (source, archive) => {
	const seen = new Set();
	for (const patch of patches) {
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
			const expected = execFileSync('tar', [
				'-xOzf',
				archive,
				`wasmer-wasix-0.601.0/${file}`
			]);
			assert.equal(
				sha256(await readFile(join(source, file))),
				sha256(expected),
				`${file}: pristine source identity`
			);
		}
	}
};
if (verifyOnly) {
	const source = option('--wasix-source');
	await verifySource(source, inputs[1].path);
	const receipts = {};
	for (const name of patches) {
		const path = join(bridge, 'patches', name);
		execFileSync('patch', ['--dry-run', '--batch', '--fuzz=0', '-p1', '-i', path], {
			cwd: source,
			stdio: 'pipe'
		});
		receipts[name] = sha256(await readFile(path));
	}
	for (const name of ['exec_frame.rs', 'proc_exec_v1.rs', 'execve.c']) {
		receipts[name] = sha256(await readFile(join(bridge, name)));
	}
	receipts[compileProbe] = sha256(await readFile(join(bridge, compileProbe)));
	// Dry-run must preserve the supplied pristine checkout.
	await verifySource(source, inputs[1].path);
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
					'No JS Supervisor fd/VFS implementation or public package API'
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
	for (const name of patches) {
		const path = join(bridge, 'patches', name);
		execFileSync('patch', ['--batch', '--fuzz=0', '-p1', '-i', path], {
			cwd: join(output, 'wasmer-wasix'),
			stdio: 'pipe'
		});
		receipts[name] = sha256(await readFile(path));
	}
	for (const name of ['exec_frame.rs', 'proc_exec_v1.rs']) {
		await cp(join(bridge, name), join(output, 'wasmer-wasix/src/syscalls/wasix', name));
		receipts[name] = sha256(await readFile(join(bridge, name)));
	}
	await cp(
		join(bridge, compileProbe),
		join(output, 'wasmer-sdk/examples', `${sdkExample}.rs`)
	);
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
		compilerProbe: {
			status: 'not-run',
			sdkExample,
			sourceSha256: receipts[compileProbe]
		},
		limitations: [
			'No SDK rebuild or patched Bash/browser qualification',
			'No JS Supervisor fd/VFS implementation or public package API'
		]
	};
	await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
	console.log(JSON.stringify({ output, status: receipt.status, patches: Object.keys(receipts) }));
}
