import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	cp,
	mkdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const RUNTIME_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const ARTIFACTS_ROOT = path.join(RUNTIME_ROOT, 'artifacts');
const CACHE_ROOT = path.join(ARTIFACTS_ROOT, 'cache');
const BUILD_ROOT = path.join(ARTIFACTS_ROOT, 'build');
const DIST_ROOT = path.join(RUNTIME_ROOT, 'dist');

const SOURCE_REVISION = 'fc8096485478055f4fcf31402004fdd8ff6b72b7';
const SOURCE_DATE_EPOCH = '1771323411';
const EXPECTED = {
	wasmSha256: '62a39c0b18b34ad15eb54388dfc4c323430cd002cc45a54f121690c9b459d3d0',
	wasmBytes: 1_807_388,
	webcSha256: '73e34672254faf20f54fa0e7f8ffa8a6117017e8779aaa75c80682c00e6d8468',
	webcBytes: 1_808_682,
	licenseSha256: '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903'
};
const INPUTS = {
	source: {
		filename: `bash-${SOURCE_REVISION}.tar.gz`,
		url: `https://github.com/wasix-org/bash/archive/${SOURCE_REVISION}.tar.gz`,
		sha256: '8dc67f0d1dd04fed7f0e2a976b24ca4e915c2ea8216e1742705546780f03db41'
	},
	sysroot: {
		filename: 'wasix-sysroot-v2024-07-08.1.tar.gz',
		url: 'https://github.com/wasix-org/wasix-libc/releases/download/v2024-07-08.1/sysroot.tar.gz',
		sha256: 'ab48114f09d6092eeab6752e50feaa34da8fe33112e02aadc81ea7e664ec7bd9'
	},
	toolchain: {
		filename: 'wasi-sdk-20.0-linux.tar.gz',
		url: 'https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-20/wasi-sdk-20.0-linux.tar.gz',
		sha256: '7030139d495a19fbeccb9449150c2b1531e15d8fb74419872a719a7580aad0f9'
	},
	binaryen: {
		filename: 'binaryen-version_108-x86_64-linux.tar.gz',
		url: 'https://github.com/WebAssembly/binaryen/releases/download/version_108/binaryen-version_108-x86_64-linux.tar.gz',
		sha256: '7bb8a2d97214f40bf34abc31d49b34aa5deab10b25d6d13c5f72cb395cf142fb'
	},
	wasmer: {
		filename: 'wasmer-7.2.0-linux-amd64.tar.gz',
		url: 'https://github.com/wasmerio/wasmer/releases/download/v7.2.0/wasmer-linux-amd64.tar.gz',
		sha256: 'fce71a4b0d504b9925e2461d1368b24cce60001111edb3fa871df8187a8a40f2'
	}
};

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function sha256File(filePath) {
	return sha256(await readFile(filePath));
}

async function assertFile(filePath, expectedSha256, expectedBytes, label) {
	const fileStats = await stat(filePath).catch(() => null);
	if (!fileStats?.isFile()) throw new Error(`${label} was not found at ${filePath}`);
	if (expectedBytes !== undefined && fileStats.size !== expectedBytes) {
		throw new Error(`${label} size mismatch: expected ${expectedBytes}, received ${fileStats.size}`);
	}
	const actualSha256 = await sha256File(filePath);
	if (actualSha256 !== expectedSha256) {
		throw new Error(
			`${label} SHA-256 mismatch: expected ${expectedSha256}, received ${actualSha256}`
		);
	}
}

async function run(command, args, options = {}) {
	await new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: 'inherit', ...options });
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`command failed (${code}): ${command} ${args.join(' ')}`));
		});
	});
}

export async function verifyBashRuntime(outputRoot = DIST_ROOT) {
	await assertFile(
		path.join(outputRoot, 'bash.webc'),
		EXPECTED.webcSha256,
		EXPECTED.webcBytes,
		'bash.webc'
	);
	await assertFile(
		path.join(outputRoot, 'LICENSE.txt'),
		EXPECTED.licenseSha256,
		undefined,
		'GNU Bash license'
	);
	const metadata = JSON.parse(
		await readFile(path.join(outputRoot, 'runtime-build.json'), 'utf8')
	);
	if (
		metadata.sourceRevision !== SOURCE_REVISION ||
		metadata.wasmSha256 !== EXPECTED.wasmSha256 ||
		metadata.webcSha256 !== EXPECTED.webcSha256
	) {
		throw new Error(`${outputRoot}/runtime-build.json does not describe the pinned Bash build`);
	}
	return metadata;
}

export async function prepareBashRuntime() {
	if (process.platform !== 'linux' || process.arch !== 'x64') {
		throw new Error(
			`wasm-bash builds are pinned for linux-x64, received ${process.platform}-${process.arch}`
		);
	}

	const downloadsRoot = path.join(CACHE_ROOT, 'downloads');
	await mkdir(downloadsRoot, { recursive: true });
	const archives = {};
	for (const [name, input] of Object.entries(INPUTS)) {
		const archivePath = path.join(downloadsRoot, input.filename);
		let valid = false;
		try {
			valid = (await sha256File(archivePath)) === input.sha256;
		} catch {
			valid = false;
		}
		if (!valid) {
			await rm(archivePath, { force: true });
			const response = await fetch(input.url);
			if (!response.ok) {
				throw new Error(`failed to download ${input.url}: HTTP ${response.status}`);
			}
			await writeFile(archivePath, new Uint8Array(await response.arrayBuffer()));
		}
		await assertFile(archivePath, input.sha256, undefined, `${name} archive`);
		archives[name] = archivePath;
	}

	await rm(BUILD_ROOT, { recursive: true, force: true });
	await mkdir(BUILD_ROOT, { recursive: true });
	const sourceRoot = path.join(BUILD_ROOT, 'bash');
	const sysrootRoot = path.join(BUILD_ROOT, 'wasix-libc', 'sysroot32');
	const toolchainRoot = path.join(BUILD_ROOT, 'wasi-sdk');
	const binaryenRoot = path.join(BUILD_ROOT, 'binaryen');
	const wasmerRoot = path.join(BUILD_ROOT, 'wasmer');
	const resourceRoot = path.join(BUILD_ROOT, 'clang-resource');
	for (const directory of [
		sourceRoot,
		sysrootRoot,
		toolchainRoot,
		binaryenRoot,
		wasmerRoot,
		resourceRoot
	]) {
		await mkdir(directory, { recursive: true });
	}

	await run('tar', ['-xzf', archives.source, '-C', sourceRoot, '--strip-components=1']);
	await run('tar', ['-xzf', archives.sysroot, '-C', sysrootRoot, '--strip-components=1']);
	await run('tar', ['-xzf', archives.toolchain, '-C', toolchainRoot, '--strip-components=1']);
	await run('tar', ['-xzf', archives.binaryen, '-C', binaryenRoot, '--strip-components=1']);
	await run('tar', ['-xzf', archives.wasmer, '-C', wasmerRoot]);

	await cp(path.join(toolchainRoot, 'lib', 'clang', '16'), resourceRoot, {
		recursive: true
	});
	const builtinsDir = path.join(resourceRoot, 'lib', 'wasm32-wasmer-wasi');
	await mkdir(builtinsDir, { recursive: true });
	await cp(
		path.join(sysrootRoot, 'lib', 'wasm32-wasi', 'libclang_rt.builtins-wasm32.a'),
		path.join(builtinsDir, 'libclang_rt.builtins.a')
	);

	const clang = path.join(toolchainRoot, 'bin', 'clang-16');
	const wasmOpt = path.join(binaryenRoot, 'bin', 'wasm-opt');
	const wasmer = path.join(wasmerRoot, 'bin', 'wasmer');
	const env = {
		...process.env,
		LC_ALL: 'C',
		PATH: `${toolchainRoot}/bin:${binaryenRoot}/bin:${process.env.PATH || ''}`,
		SOURCE_DATE_EPOCH,
		TZ: 'UTC',
		ZERO_AR_DATE: '1'
	};
	await run(
		'make',
		[
			`-j${Math.max(1, Math.min(4, Number(process.env.WASM_BASH_BUILD_JOBS || '2')))}`,
			`CC=${clang} -resource-dir ${resourceRoot}`,
			`LLD_PATH=${toolchainRoot}/bin`,
			'shell'
		],
		{ cwd: sourceRoot, env }
	);

	const packageRoot = path.join(BUILD_ROOT, 'package');
	await mkdir(packageRoot, { recursive: true });
	const wasmPath = path.join(packageRoot, 'bash.wasm');
	await run(wasmOpt, ['--strip-debug', path.join(sourceRoot, 'shell.wasm'), '-o', wasmPath], {
		env
	});
	await assertFile(wasmPath, EXPECTED.wasmSha256, EXPECTED.wasmBytes, 'bash.wasm');
	const wasmerManifest = `[package]
name = "wasmer/bash"
version = "1.0.25"
description = "Bash is a modern POSIX-compliant implementation of /bin/sh."
license = "GNU"
wasmer-extra-flags = "--enable-threads --enable-bulk-memory"
entrypoint = "bash"

[[module]]
name = "bash"
source = "bash.wasm"
abi = "wasi"

[[command]]
name = "bash"
module = "bash"
runner = "wasi@unstable_"

[[command]]
name = "sh"
module = "bash"
runner = "wasi@unstable_"
`;
	await writeFile(path.join(packageRoot, 'wasmer.toml'), wasmerManifest, 'utf8');
	const webcPath = path.join(packageRoot, 'bash.webc');
	await run(wasmer, ['package', 'build', '--out', webcPath], { cwd: packageRoot, env });
	await assertFile(webcPath, EXPECTED.webcSha256, EXPECTED.webcBytes, 'bash.webc');

	const licensePath = path.join(sourceRoot, 'COPYING');
	await assertFile(licensePath, EXPECTED.licenseSha256, undefined, 'GNU Bash license');
	const nextDist = `${DIST_ROOT}.next-${process.pid}`;
	await rm(nextDist, { recursive: true, force: true });
	await mkdir(nextDist, { recursive: true });
	await cp(webcPath, path.join(nextDist, 'bash.webc'));
	await cp(licensePath, path.join(nextDist, 'LICENSE.txt'));
	const runtimeBuild = {
		schemaVersion: 1,
		package: 'wasmer/bash',
		packageVersion: '1.0.25',
		sourceRepository: 'https://github.com/wasix-org/bash',
		sourceRevision: SOURCE_REVISION,
		sourceArchiveUrl: INPUTS.source.url,
		sourceArchiveSha256: INPUTS.source.sha256,
		sysrootRelease: 'v2024-07-08.1',
		sysrootArchiveUrl: INPUTS.sysroot.url,
		sysrootArchiveSha256: INPUTS.sysroot.sha256,
		toolchain: 'WASI SDK 20.0 (LLVM 16.0.0)',
		toolchainArchiveUrl: INPUTS.toolchain.url,
		toolchainArchiveSha256: INPUTS.toolchain.sha256,
		binaryenVersion: '108',
		binaryenArchiveUrl: INPUTS.binaryen.url,
		binaryenArchiveSha256: INPUTS.binaryen.sha256,
		wasmerVersion: '7.2.0',
		wasmerArchiveUrl: INPUTS.wasmer.url,
		wasmerArchiveSha256: INPUTS.wasmer.sha256,
		buildTarget: 'shell',
		postprocessArgs: ['--strip-debug'],
		wasmFeatures: ['threads', 'mutable-globals', 'bulk-memory', 'sign-ext'],
		wasmSha256: EXPECTED.wasmSha256,
		wasmBytes: EXPECTED.wasmBytes,
		webcSha256: EXPECTED.webcSha256,
		webcBytes: EXPECTED.webcBytes,
		abi: 'wasix_32v1',
		license: 'GPL-3.0-or-later',
		licenseSha256: EXPECTED.licenseSha256,
		limitations: ['Only Bash builtins are bundled; external coreutils commands are unavailable.']
	};
	await writeFile(
		path.join(nextDist, 'runtime-build.json'),
		`${JSON.stringify(runtimeBuild, null, 2)}\n`,
		'utf8'
	);
	await verifyBashRuntime(nextDist);

	const previousDist = `${DIST_ROOT}.previous-${process.pid}`;
	await rm(previousDist, { recursive: true, force: true });
	let hadPrevious = false;
	try {
		const currentStats = await stat(DIST_ROOT).catch(() => null);
		if (currentStats) {
			await rename(DIST_ROOT, previousDist);
			hadPrevious = true;
		}
		await rename(nextDist, DIST_ROOT);
		await rm(previousDist, { recursive: true, force: true });
	} catch (error) {
		if (hadPrevious) await rename(previousDist, DIST_ROOT).catch(() => {});
		throw error;
	} finally {
		await rm(nextDist, { recursive: true, force: true });
	}
	return { distRoot: DIST_ROOT, metadata: runtimeBuild };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	if (process.argv.includes('--check')) {
		await verifyBashRuntime();
		console.log(`Verified wasm-bash runtime in ${DIST_ROOT}`);
	} else {
		await prepareBashRuntime();
		console.log(`Prepared wasm-bash runtime in ${DIST_ROOT}`);
	}
}
