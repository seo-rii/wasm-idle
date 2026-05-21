import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const projectRoot = path.resolve(scriptsDir, '..');
const goVersion = 'go1.26.1';
const hostArchives = {
	'linux-x64': {
		filename: 'go1.26.1.linux-amd64.tar.gz',
		sha256: '031f088e5d955bab8657ede27ad4e3bc5b7c1ba281f05f245bcc304f327c987a'
	},
	'linux-arm64': {
		filename: 'go1.26.1.linux-arm64.tar.gz',
		sha256: 'a290581cfe4fe28ddd737dde3095f3dbeb7f2e4065cab4eae44dfc53b760c2f7'
	},
	'darwin-x64': {
		filename: 'go1.26.1.darwin-amd64.tar.gz',
		sha256: '65773dab2f8cc4cd23d93ba6d0a805de150ca0b78378879292be0b903b8cdd08'
	},
	'darwin-arm64': {
		filename: 'go1.26.1.darwin-arm64.tar.gz',
		sha256: '353df43a7811ce284c8938b5f3c7df40b7bfb6f56cb165b150bc40b5e2dd541f'
	}
};
const defaultRequestedTargets = ['wasip1/wasm', 'wasip2/wasm', 'wasip3/wasm', 'js/wasm'];

function hostKey() {
	return `${process.platform}-${process.arch}`;
}

function resolveHostArchive() {
	const archive = hostArchives[hostKey()];
	if (!archive) {
		throw new Error(
			`unsupported host ${hostKey()}. Add an official Go ${goVersion} archive mapping before running prepare-runtime.`
		);
	}
	return archive;
}

async function pathExists(targetPath) {
	try {
		await stat(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function sha256File(filePath) {
	const hash = createHash('sha256');
	hash.update(await readFile(filePath));
	return hash.digest('hex');
}

async function downloadFile(url, destinationPath) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`failed to download ${url}: status ${response.status}`);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	await writeFile(destinationPath, bytes);
}

async function ensureDownloadedArchive(cacheDir) {
	const archive = resolveHostArchive();
	const downloadDir = path.join(cacheDir, 'downloads');
	await mkdir(downloadDir, { recursive: true });
	const archivePath = path.join(downloadDir, archive.filename);
	if (await pathExists(archivePath)) {
		const currentSha = await sha256File(archivePath);
		if (currentSha === archive.sha256) {
			return {
				...archive,
				url: `https://go.dev/dl/${archive.filename}`,
				path: archivePath
			};
		}
		await rm(archivePath, { force: true });
	}
	await downloadFile(`https://go.dev/dl/${archive.filename}`, archivePath);
	const downloadedSha = await sha256File(archivePath);
	if (downloadedSha !== archive.sha256) {
		throw new Error(
			`sha256 mismatch for ${archive.filename}: expected ${archive.sha256}, got ${downloadedSha}`
		);
	}
	return {
		...archive,
		url: `https://go.dev/dl/${archive.filename}`,
		path: archivePath
	};
}

function runCommand(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		let settled = false;
		const child = spawn(command, args, {
			stdio: 'inherit',
			...options
		});
		child.on('close', (code) => {
			if (settled) return;
			settled = true;
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`command failed (${code}): ${command} ${args.join(' ')}`));
		});
		child.on('error', (error) => {
			if (settled) return;
			settled = true;
			reject(error);
		});
	});
}

function runCommandCapture(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		let settled = false;
		const stdout = [];
		const stderr = [];
		const child = spawn(command, args, {
			stdio: ['ignore', 'pipe', 'pipe'],
			...options
		});
		child.stdout?.on('data', (chunk) => {
			stdout.push(Buffer.from(chunk));
		});
		child.stderr?.on('data', (chunk) => {
			stderr.push(Buffer.from(chunk));
		});
		child.on('close', (code) => {
			if (settled) return;
			settled = true;
			if (code === 0) {
				resolve(Buffer.concat(stdout).toString('utf8'));
				return;
			}
			reject(
				new Error(
					`command failed (${code}): ${command} ${args.join(' ')}\n${Buffer.concat(stderr).toString('utf8')}`
				)
			);
		});
		child.on('error', (error) => {
			if (settled) return;
			settled = true;
			reject(error);
		});
	});
}

function parseJsonObjectStream(text) {
	const objects = [];
	let start = -1;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		if (start === -1) {
			if (character === '{') {
				start = index;
				depth = 1;
			}
			continue;
		}
		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (character === '\\') {
				escaped = true;
				continue;
			}
			if (character === '"') {
				inString = false;
			}
			continue;
		}
		if (character === '"') {
			inString = true;
			continue;
		}
		if (character === '{') {
			depth += 1;
			continue;
		}
		if (character === '}') {
			depth -= 1;
			if (depth === 0) {
				objects.push(JSON.parse(text.slice(start, index + 1)));
				start = -1;
			}
		}
	}
	return objects;
}

async function ensureExtractedToolchain(cacheDir, archiveInfo) {
	const extractionRoot = path.join(cacheDir, 'toolchains', goVersion, hostKey());
	const goroot = path.join(extractionRoot, 'go');
	const goBinary = path.join(goroot, 'bin', 'go');
	if (await pathExists(goBinary)) {
		return {
			extractionRoot,
			goroot,
			goBinary
		};
	}
	await rm(extractionRoot, { recursive: true, force: true });
	await mkdir(extractionRoot, { recursive: true });
	await runCommand('tar', ['-xzf', archiveInfo.path, '-C', extractionRoot]);
	return {
		extractionRoot,
		goroot,
		goBinary
	};
}

async function listFilesRecursive(rootDir) {
	const entries = [];
	async function walk(currentDir) {
		for (const dirent of await (await import('node:fs/promises')).readdir(currentDir, {
			withFileTypes: true
		})) {
			const absolutePath = path.join(currentDir, dirent.name);
			if (dirent.isDirectory()) {
				await walk(absolutePath);
				continue;
			}
			entries.push(absolutePath);
		}
	}
	await walk(rootDir);
	entries.sort((left, right) => left.localeCompare(right));
	return entries;
}

async function packRuntimeDirectory(sourceDir, runtimePrefix) {
	const absoluteFiles = await listFilesRecursive(sourceDir);
	const entries = [];
	const chunks = [];
	let offset = 0;
	for (const absolutePath of absoluteFiles) {
		const bytes = await readFile(absolutePath);
		const relativePath = path.relative(sourceDir, absolutePath).replace(/\\/g, '/');
		entries.push({
			runtimePath: `${runtimePrefix}/${relativePath}`,
			offset,
			length: bytes.byteLength
		});
		offset += bytes.byteLength;
		chunks.push(bytes);
	}
	return {
		pack: Buffer.concat(chunks),
		index: {
			format: 'wasm-go-runtime-pack-index-v1',
			fileCount: entries.length,
			totalBytes: offset,
			entries
		}
	};
}

async function buildStdlibIndex(goBinary, pkgDir, env) {
	const archiveFiles = await listFilesRecursive(pkgDir);
	const archiveImportPaths = new Set(
		archiveFiles
			.filter((absolutePath) => absolutePath.endsWith('.a'))
			.map((absolutePath) =>
				path
					.relative(pkgDir, absolutePath)
					.replace(/\\/g, '/')
					.slice(0, -'.a'.length)
			)
	);
	const stdout = await runCommandCapture(
		goBinary,
		['list', '-deps', '-json', 'std'],
		{ env }
	);
	const packages = parseJsonObjectStream(stdout)
		.filter((entry) => archiveImportPaths.has(entry.ImportPath))
		.map((entry) => ({
			importPath: entry.ImportPath,
			runtimePath: `/sysroot/${entry.ImportPath}.a`,
			imports: (entry.Imports || [])
				.filter((importPath) => archiveImportPaths.has(importPath))
				.sort((left, right) => left.localeCompare(right))
		}))
		.sort((left, right) => left.importPath.localeCompare(right.importPath));
	return {
		format: 'wasm-go-stdlib-index-v1',
		packageCount: packages.length,
		packages
	};
}

async function copyMaybeWasmExec(goroot, runtimeDir) {
	const candidates = [
		path.join(goroot, 'lib', 'wasm', 'wasm_exec.js'),
		path.join(goroot, 'misc', 'wasm', 'wasm_exec.js')
	];
	for (const candidate of candidates) {
		if (await pathExists(candidate)) {
			const outputPath = path.join(runtimeDir, 'runtime', 'wasm_exec.js');
			await mkdir(path.dirname(outputPath), { recursive: true });
			await writeFile(outputPath, await readFile(candidate));
			return path.relative(runtimeDir, outputPath).replace(/\\/g, '/');
		}
	}
	return null;
}

async function main() {
	const cacheDir = path.join(projectRoot, 'artifacts', 'cache');
	const distRuntimeDir = path.join(projectRoot, 'dist', 'runtime');
	const buildTempDir = path.join(projectRoot, 'artifacts', 'build', goVersion);
	await mkdir(cacheDir, { recursive: true });
	await mkdir(buildTempDir, { recursive: true });
	const archiveInfo = await ensureDownloadedArchive(cacheDir);
	const toolchain = await ensureExtractedToolchain(cacheDir, archiveInfo);
	const gocacheDir = path.join(buildTempDir, 'gocache');
	const env = {
		...process.env,
		CGO_ENABLED: '0',
		GOARCH: 'wasm',
		GOENV: 'off',
		GOOS: 'wasip1',
		GOROOT: toolchain.goroot,
		GOTOOLCHAIN: 'local',
		GOWORK: 'off',
		GOCACHE: gocacheDir
	};
	const requestedTargets = (process.env.WASM_GO_RUNTIME_TARGETS || defaultRequestedTargets.join(','))
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
	const supportedTargets = new Set(
		(await runCommandCapture(toolchain.goBinary, ['tool', 'dist', 'list'], { env }))
			.split(/\r?\n/)
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0)
	);
	const targetPlans = requestedTargets.map((target) => {
		if (target === 'wasip1/wasm') {
			return {
				target,
				goos: 'wasip1',
				sysrootKey: 'wasip1',
				artifactFormat: 'wasi-core-wasm',
				execution: {
					kind: 'wasi-preview1'
				}
			};
		}
		if (target === 'wasip2/wasm') {
			return {
				target,
				goos: supportedTargets.has(target) ? 'wasip2' : 'wasip1',
				sysrootKey: supportedTargets.has(target) ? 'wasip2' : 'wasip1',
				artifactFormat: 'wasi-core-wasm',
				execution: {
					kind: 'wasi-preview1'
				}
			};
		}
		if (target === 'wasip3/wasm') {
			return {
				target,
				goos: supportedTargets.has(target) ? 'wasip3' : 'wasip1',
				sysrootKey: supportedTargets.has(target) ? 'wasip3' : 'wasip1',
				artifactFormat: 'wasi-core-wasm',
				execution: {
					kind: 'wasi-preview1'
				}
			};
		}
		if (target === 'js/wasm') {
			return {
				target,
				goos: 'js',
				sysrootKey: 'js',
				artifactFormat: 'js-wasm',
				execution: {
					kind: 'js-wasm-exec'
				}
			};
		}
		throw new Error(`unsupported runtime target request ${target}`);
	});
	await rm(path.join(buildTempDir, 'out'), { recursive: true, force: true });
	await mkdir(path.join(buildTempDir, 'out', 'tools'), { recursive: true });
	const compileWasmPath = path.join(buildTempDir, 'out', 'tools', 'compile.wasm');
	const linkWasmPath = path.join(buildTempDir, 'out', 'tools', 'link.wasm');
	await runCommand(
		toolchain.goBinary,
		['build', '-trimpath', '-buildvcs=false', '-ldflags=-buildid=', '-o', compileWasmPath, 'cmd/compile'],
		{ env }
	);
	await runCommand(
		toolchain.goBinary,
		['build', '-trimpath', '-buildvcs=false', '-ldflags=-buildid=', '-o', linkWasmPath, 'cmd/link'],
		{ env }
	);
	const runtimeBundles = new Map();
	for (const plan of targetPlans) {
		if (runtimeBundles.has(plan.sysrootKey)) {
			continue;
		}
		const pkgDir = path.join(buildTempDir, 'pkg', `${plan.sysrootKey}_wasm`);
		await mkdir(pkgDir, { recursive: true });
		const targetEnv = {
			...env,
			GOOS: plan.goos
		};
		await runCommand(
			toolchain.goBinary,
			['install', '-trimpath', '-buildvcs=false', '-pkgdir', pkgDir, '-a', 'std'],
			{
				env: {
					...targetEnv,
					GODEBUG: 'installgoroot=all'
				}
			}
		);
		runtimeBundles.set(plan.sysrootKey, {
			goos: plan.goos,
			pack: await packRuntimeDirectory(pkgDir, '/sysroot'),
			stdlibIndex: await buildStdlibIndex(toolchain.goBinary, pkgDir, targetEnv)
		});
	}
	await rm(distRuntimeDir, { recursive: true, force: true });
	await mkdir(path.join(distRuntimeDir, 'tools'), { recursive: true });
	await mkdir(path.join(distRuntimeDir, 'sysroot'), { recursive: true });
	await writeFile(
		path.join(distRuntimeDir, 'tools', 'compile.wasm.gz'),
		gzipSync(await readFile(compileWasmPath))
	);
	await writeFile(
		path.join(distRuntimeDir, 'tools', 'link.wasm.gz'),
		gzipSync(await readFile(linkWasmPath))
	);
	for (const [sysrootKey, bundle] of runtimeBundles) {
		await writeFile(
			path.join(distRuntimeDir, 'sysroot', `${sysrootKey}.pack.gz`),
			gzipSync(bundle.pack.pack)
		);
		await writeFile(
			path.join(distRuntimeDir, 'sysroot', `${sysrootKey}.index.json.gz`),
			gzipSync(Buffer.from(JSON.stringify(bundle.pack.index, null, 2)))
		);
		await writeFile(
			path.join(distRuntimeDir, 'sysroot', `${sysrootKey}.stdlib-index.json.gz`),
			gzipSync(Buffer.from(JSON.stringify(bundle.stdlibIndex, null, 2)))
		);
	}
	const wasmExecRelativePath = await copyMaybeWasmExec(toolchain.goroot, distRuntimeDir);
	if (targetPlans.some((plan) => plan.target === 'js/wasm') && !wasmExecRelativePath) {
		throw new Error('failed to locate wasm_exec.js in the extracted Go toolchain');
	}
	const runtimeTargets = Object.fromEntries(
		targetPlans.map((plan) => {
			const bundle = runtimeBundles.get(plan.sysrootKey);
			return [
				plan.target,
				{
					goos: plan.goos,
					goarch: 'wasm',
					artifactFormat: plan.artifactFormat,
					sysrootPack: {
						asset: `sysroot/${plan.sysrootKey}.pack.gz`,
						index: `sysroot/${plan.sysrootKey}.index.json.gz`,
						fileCount: bundle.pack.index.fileCount,
						totalBytes: bundle.pack.index.totalBytes
					},
					stdlibIndex: {
						asset: `sysroot/${plan.sysrootKey}.stdlib-index.json.gz`,
						packageCount: bundle.stdlibIndex.packageCount
					},
					execution:
						plan.execution.kind === 'js-wasm-exec'
							? {
									kind: 'js-wasm-exec',
									wasmExecJs: wasmExecRelativePath
								}
							: {
									kind: 'wasi-preview1'
								},
					planner: {
						workspaceRoot: '/workspace',
						importcfgPath: '/workspace/importcfg',
						embedcfgPath: '/workspace/embedcfg',
						compileOutputPath: '/workspace/pkg/main.a',
						linkOutputPath: '/workspace/bin/main.wasm',
						defaultLang: 'go1.26',
						defaultTrimpath: '/workspace'
					}
				}
			];
		})
	);
	const runtimeManifest = {
		manifestVersion: 1,
		version: `${goVersion}-runtime-v1`,
		goVersion,
		defaultTarget: 'wasip1/wasm',
		compiler: {
			compile: {
				asset: 'tools/compile.wasm.gz',
				argv0: 'compile',
				memory: {
					initialPages: 4096,
					maximumPages: 32768
				}
			},
			link: {
				asset: 'tools/link.wasm.gz',
				argv0: 'link',
				memory: {
					initialPages: 2048,
					maximumPages: 16384
				}
			},
			compileTimeoutMs: 120000,
			linkTimeoutMs: 120000,
			host: {
				rootDirectory: '/',
				pwd: '/',
				tmpDirectory: '/tmp',
				env: ['HOME=/', 'PWD=/', 'TMPDIR=/tmp']
			}
		},
		targets: runtimeTargets
	};
	const buildMetadata = {
		goVersion,
		host: hostKey(),
		archive: {
			url: archiveInfo.url,
			filename: archiveInfo.filename,
			sha256: archiveInfo.sha256
		},
		toolchain: {
			goroot: toolchain.goroot
		},
		outputs: {
			compileWasmGzip: 'tools/compile.wasm.gz',
			linkWasmGzip: 'tools/link.wasm.gz',
			sysroots: Object.fromEntries(
				Array.from(runtimeBundles, ([sysrootKey]) => [
					sysrootKey,
					{
						packGzip: `sysroot/${sysrootKey}.pack.gz`,
						indexGzip: `sysroot/${sysrootKey}.index.json.gz`,
						stdlibIndexGzip: `sysroot/${sysrootKey}.stdlib-index.json.gz`
					}
				])
			),
			...(wasmExecRelativePath ? { wasmExecJs: wasmExecRelativePath } : {})
		},
		sysroot: Object.fromEntries(
			Array.from(runtimeBundles, ([sysrootKey, bundle]) => [
				sysrootKey,
				{
					fileCount: bundle.pack.index.fileCount,
					totalBytes: bundle.pack.index.totalBytes
				}
			])
		),
		stdlibIndex: Object.fromEntries(
			Array.from(runtimeBundles, ([sysrootKey, bundle]) => [
				sysrootKey,
				{
					packageCount: bundle.stdlibIndex.packageCount
				}
			])
		),
		targets: Object.fromEntries(
			targetPlans.map((plan) => [
				plan.target,
				{
					goos: plan.goos,
					sysrootKey: plan.sysrootKey,
					aliasedTo: plan.goos === 'wasip1' && plan.target !== 'wasip1/wasm' ? 'wasip1/wasm' : null
				}
			])
		),
		supportedTargets: targetPlans.map((plan) => plan.target)
	};
	await writeFile(
		path.join(distRuntimeDir, 'runtime-manifest.v1.json'),
		JSON.stringify(runtimeManifest, null, 2)
	);
	await writeFile(
		path.join(distRuntimeDir, 'runtime-build.json'),
		JSON.stringify(buildMetadata, null, 2)
	);
	console.log(`prepared wasm-go runtime under ${distRuntimeDir}`);
	if (process.argv.includes('--probe')) {
		await runCommand(process.execPath, [path.join(scriptsDir, 'probe-runtime.mjs')], {
			cwd: projectRoot
		});
	}
}

await main();
