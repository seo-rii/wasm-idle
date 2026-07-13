import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(runtimeRoot, '../../static/wasm-bash');
const checkOnly = process.argv.includes('--check');

const release = {
	package: 'sharrattj/bash',
	version: '1.0.17',
	archiveUrl:
		'https://cdn.wasmer.io/packages/sharrattj/bash/bash-1.0.17-330845c0-bb63-4b39-bda6-f458beab4198.tar.gz',
	archiveSha256: '850c5d4257336a3ec8d7ab1b1b7e01e1e76f3fb0566196b0091989860cf20d74',
	wasmSha256: '305e2a460068b45cca21583a6619c008dedea0b71c052e29446eb88b9c4438a9',
	webcSha256: '7609fd1e023758d73096b042d9be3adb9e23c9aa357b272b84b9b4fd69b65311',
	wasmerVersion: '7.2.0',
	wasmerArchiveUrl:
		'https://github.com/wasmerio/wasmer/releases/download/v7.2.0/wasmer-linux-amd64.tar.gz',
	wasmerArchiveSha256: 'fce71a4b0d504b9925e2461d1368b24cce60001111edb3fa871df8187a8a40f2',
	licenseUrl:
		'https://raw.githubusercontent.com/wasix-org/bash/45d5deb5068db53d00d440fc27b1374e89b221d5/COPYING',
	licenseSha256: '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903'
};

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function assertHash(label, bytes, expected) {
	const actual = sha256(bytes);
	if (actual !== expected) {
		throw new Error(`${label} SHA-256 mismatch: expected ${expected}, received ${actual}`);
	}
}

async function download(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`failed to download ${url}: HTTP ${response.status}`);
	return Buffer.from(await response.arrayBuffer());
}

async function checkBundle() {
	const webc = await readFile(resolve(outputRoot, 'bash.webc'));
	const license = await readFile(resolve(outputRoot, 'LICENSE.txt'));
	const metadata = JSON.parse(await readFile(resolve(outputRoot, 'runtime-build.json'), 'utf8'));
	assertHash('bash.webc', webc, release.webcSha256);
	assertHash('GNU Bash license', license, release.licenseSha256);
	if (
		metadata.package !== release.package ||
		metadata.version !== release.version ||
		metadata.wasmSha256 !== release.wasmSha256 ||
		metadata.webcSha256 !== release.webcSha256
	) {
		throw new Error('static/wasm-bash/runtime-build.json does not match the pinned release');
	}
}

if (checkOnly) {
	await checkBundle();
	console.log(`verified ${release.package}@${release.version}`);
	process.exit(0);
}

const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'wasm-idle-bash-'));
try {
	const archive = await download(release.archiveUrl);
	assertHash('Bash WAPM archive', archive, release.archiveSha256);
	const archivePath = resolve(temporaryRoot, 'bash.tar.gz');
	await writeFile(archivePath, archive);
	const packageRoot = resolve(temporaryRoot, 'package');
	await mkdir(packageRoot, { recursive: true });
	const { stdout: wasm } = await execFileAsync('tar', ['-xOzf', archivePath, 'bash.wasm'], {
		encoding: 'buffer',
		maxBuffer: 4 * 1024 * 1024
	});
	assertHash('bash.wasm', wasm, release.wasmSha256);
	await writeFile(resolve(packageRoot, 'bash.wasm'), wasm);
	await writeFile(
		resolve(packageRoot, 'wapm.toml'),
		`[package]
name = "${release.package}"
version = "${release.version}"
description = "GNU Bash compiled for WASIX."
license = "GNU"
wasmer-extra-flags = "--enable-threads --enable-bulk-memory"

[[module]]
name = "bash"
source = "bash.wasm"
abi = "wasi"

[[command]]
name = "bash"
module = "bash"
runner = "wasi@unstable_"
`
	);

	const wasmerArchive = await download(release.wasmerArchiveUrl);
	assertHash('Wasmer CLI archive', wasmerArchive, release.wasmerArchiveSha256);
	const wasmerArchivePath = resolve(temporaryRoot, 'wasmer.tar.gz');
	const wasmerRoot = resolve(temporaryRoot, 'wasmer');
	await writeFile(wasmerArchivePath, wasmerArchive);
	await mkdir(wasmerRoot, { recursive: true });
	await execFileAsync('tar', ['-xzf', wasmerArchivePath, '-C', wasmerRoot]);
	const webcPath = resolve(temporaryRoot, 'bash.webc');
	await execFileAsync(
		resolve(wasmerRoot, 'bin/wasmer'),
		['package', 'build', resolve(packageRoot, 'wapm.toml'), '-o', webcPath],
		{ maxBuffer: 8 * 1024 * 1024 }
	);
	const webc = await readFile(webcPath);
	assertHash('bash.webc', webc, release.webcSha256);

	const license = await download(release.licenseUrl);
	assertHash('GNU Bash license', license, release.licenseSha256);

	await rm(outputRoot, { recursive: true, force: true });
	await mkdir(outputRoot, { recursive: true });
	await writeFile(resolve(outputRoot, 'bash.webc'), webc);
	await writeFile(resolve(outputRoot, 'LICENSE.txt'), license);
	await writeFile(
		resolve(outputRoot, 'runtime-build.json'),
		`${JSON.stringify(
			{
				schemaVersion: 1,
				package: release.package,
				version: release.version,
				archiveUrl: release.archiveUrl,
				archiveSha256: release.archiveSha256,
				wasmSha256: release.wasmSha256,
				wasmBytes: wasm.byteLength,
				webcSha256: release.webcSha256,
				webcBytes: webc.byteLength,
				wasmerVersion: release.wasmerVersion,
				wasmerArchiveUrl: release.wasmerArchiveUrl,
				wasmerArchiveSha256: release.wasmerArchiveSha256,
				abi: 'wasix_32v1',
				license: 'GPL-3.0-or-later',
				licenseUrl: release.licenseUrl,
				licenseSha256: release.licenseSha256,
				sourceRepository: 'https://github.com/wasix-org/bash',
				sourceRevisionCandidate: '45d5deb5068db53d00d440fc27b1374e89b221d5',
				correspondingSourceStatus:
					'The legacy WAPM package does not declare the exact source revision; the listed revision is the latest publisher commit before the package date.',
				limitations: ['The sharrattj/coreutils dependency is not bundled.']
			},
			null,
			2
		)}\n`
	);
	await checkBundle();
	console.log(`synced ${release.package}@${release.version} to ${outputRoot}`);
} finally {
	await rm(temporaryRoot, { recursive: true, force: true });
}
