import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { writeRuntimePack } from './runtime-pack.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(projectRoot, 'dist');
const runtimeRoot = path.join(distRoot, 'runtime');
const vendorRoot = path.join(distRoot, 'vendor');
const browserWasiShimRoot = path.join(
	projectRoot,
	'node_modules',
	'@bjorn3',
	'browser_wasi_shim',
	'dist'
);
const preview2ShimRoot = path.join(
	projectRoot,
	'node_modules',
	'@bytecodealliance',
	'preview2-shim',
	'lib'
);
const jcoRoot = path.join(projectRoot, 'node_modules', '@bytecodealliance', 'jco');
const cacheRoot = path.join(os.homedir(), '.cache');
const defaultRustcCacheRoot = path.join(cacheRoot, 'wasm-rust-real-rustc-20260317', 'rust');
const defaultRuntimeTargetTriples = ['wasm32-wasip1', 'wasm32-wasip2', 'wasm32-wasip3'];
const defaultRustcMemoryInitialPages = 16384;
const defaultRustcMemoryMaximumPages = 65536;

const wasmRustcRoot =
	process.env.WASM_RUST_RUSTC_ROOT || path.join(defaultRustcCacheRoot, 'dist-emit-ir');
const matchingNativeToolchainRoot =
	process.env.WASM_RUST_MATCHING_NATIVE_TOOLCHAIN_ROOT ||
	path.join(defaultRustcCacheRoot, 'build', 'x86_64-unknown-linux-gnu', 'stage2');
const matchingNativeSysrootRoot =
	process.env.WASM_RUST_MATCHING_NATIVE_SYSROOT_ROOT || wasmRustcRoot;
const llvmWasmRoot = process.env.WASM_RUST_LLVM_WASM_ROOT || path.join(cacheRoot, 'llvm-wasm-20260319');
const configuredWasiSdkRoot =
	process.env.WASM_RUST_WASI_SDK_ROOT || process.env.WASI_SDK_PATH || '';
const configuredTargetTriples = parseTargetTripleList(
	process.env.WASM_RUST_RUNTIME_TARGET_TRIPLES || defaultRuntimeTargetTriples.join(','),
	'WASM_RUST_RUNTIME_TARGET_TRIPLES'
);
const configuredPrecompressionScopes = parseRuntimePrecompressionScopes(
	process.env.WASM_RUST_PRECOMPRESS_SCOPES || 'all',
	'WASM_RUST_PRECOMPRESS_SCOPES'
);
const defaultTargetTriple = parseTargetTriple(
	process.env.WASM_RUST_DEFAULT_TARGET_TRIPLE || 'wasm32-wasip1',
	'WASM_RUST_DEFAULT_TARGET_TRIPLE'
);
const allowMissingTargets = process.env.WASM_RUST_ALLOW_MISSING_TARGETS !== '0';
const allowPrebuiltRuntimeFallback =
	process.env.WASM_RUST_ALLOW_PREBUILT_RUNTIME_FALLBACK === '1';
const hostTriple = process.env.WASM_RUST_HOST_TRIPLE || 'x86_64-unknown-linux-gnu';
const sampleProgram =
	process.env.WASM_RUST_SAMPLE_PROGRAM || 'fn main() { println!("hi"); }';
const bitcodeFileName =
	process.env.WASM_RUST_BITCODE_FILE_NAME ||
	'main.main.1ca70c240d7de168-cgu.0.rcgu.no-opt.bc';
const rustcMemoryInitialPages = Number(
	process.env.WASM_RUST_RUSTC_MEMORY_INITIAL_PAGES || String(defaultRustcMemoryInitialPages)
);
const rustcMemoryMaximumPages = Number(
	process.env.WASM_RUST_RUSTC_MEMORY_MAXIMUM_PAGES || String(defaultRustcMemoryMaximumPages)
);
const runtimeVersion =
	process.env.WASM_RUST_RUNTIME_VERSION || 'rust-1.79.0-dev-browser-split-v3';
const isDirectExecution = process.argv[1]
	? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
	: false;

if (!configuredTargetTriples.includes(defaultTargetTriple)) {
	throw new Error(
		`WASM_RUST_DEFAULT_TARGET_TRIPLE=${defaultTargetTriple} must be present in WASM_RUST_RUNTIME_TARGET_TRIPLES`
	);
}

function parseTargetTriple(value, label) {
	if (
		value !== 'wasm32-wasip1' &&
		value !== 'wasm32-wasip2' &&
		value !== 'wasm32-wasip3'
	) {
		throw new Error(`invalid ${label}: ${value}`);
	}
	return value;
}

function parseTargetTripleList(value, label) {
	const entries = value
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (entries.length === 0) {
		throw new Error(`${label} must contain at least one target`);
	}
	return [...new Set(entries.map((entry) => parseTargetTriple(entry, label)))];
}

function parseRuntimePrecompressionScopes(value, label) {
	const entries = value
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (entries.length === 0) {
		throw new Error(`${label} must contain at least one compression scope`);
	}
	if (entries.includes('none')) {
		if (entries.length !== 1) {
			throw new Error(`${label}=none cannot be combined with other compression scopes`);
		}
		return new Set();
	}
	const scopes = new Set();
	for (const entry of entries) {
		if (entry === 'all') {
			scopes.add('rustc');
			scopes.add('llvm');
			scopes.add('packs');
			continue;
		}
		if (entry !== 'rustc' && entry !== 'llvm' && entry !== 'packs') {
			throw new Error(`invalid ${label}: ${entry}`);
		}
		scopes.add(entry);
	}
	return scopes;
}

function shouldPrecompressRuntimeAsset(scope) {
	return configuredPrecompressionScopes.has(scope);
}

async function maybePrecompressRuntimeAsset(assetPath, scope) {
	if (!shouldPrecompressRuntimeAsset(scope)) {
		return relativeAssetPath(runtimeRoot, assetPath);
	}
	const sourceBytes = await fs.readFile(assetPath);
	const compressedAssetPath = `${assetPath}.gz`;
	await fs.writeFile(compressedAssetPath, gzipSync(sourceBytes, { level: 9 }));
	await fs.rm(assetPath, { force: true });
	return relativeAssetPath(runtimeRoot, compressedAssetPath);
}

function relativeAssetPath(root, fullPath) {
	return path.relative(root, fullPath).replaceAll(path.sep, '/');
}

async function ensureDirectory(targetPath) {
	await fs.mkdir(targetPath, { recursive: true });
}

async function pathExists(targetPath) {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function isReusablePrebuiltRuntimeBundle(runtimeRootPath) {
	let manifest = null;
	let manifestVersion = 0;
	for (const [candidateVersion, manifestFileName] of [
		[3, 'runtime-manifest.v3.json'],
		[2, 'runtime-manifest.v2.json'],
		[1, 'runtime-manifest.json']
	]) {
		try {
			manifest = JSON.parse(await fs.readFile(path.join(runtimeRootPath, manifestFileName), 'utf8'));
			manifestVersion = candidateVersion;
			break;
		} catch {}
	}
	if (!manifest) {
		return false;
	}
	const referencedAssets = new Set();
	if (manifestVersion === 1) {
		if (typeof manifest.rustcWasm !== 'string' || manifest.rustcWasm.length === 0) {
			return false;
		}
		if (typeof manifest.llvm?.llc !== 'string' || manifest.llvm.llc.length === 0) {
			return false;
		}
		if (typeof manifest.llvm?.lld !== 'string' || manifest.llvm.lld.length === 0) {
			return false;
		}
		if (!Array.isArray(manifest.sysrootFiles) || manifest.sysrootFiles.length === 0) {
			return false;
		}
		if (!Array.isArray(manifest.link?.files) || manifest.link.files.length === 0) {
			return false;
		}
		referencedAssets.add(manifest.rustcWasm);
		referencedAssets.add(manifest.llvm.llc);
		referencedAssets.add(manifest.llvm.llcWasm || 'llvm/llc.wasm');
		referencedAssets.add(manifest.llvm.lld);
		referencedAssets.add(manifest.llvm.lldWasm || 'llvm/lld.wasm');
		referencedAssets.add(manifest.llvm.lldData || 'llvm/lld.data');
		if (typeof manifest.link.allocatorObjectAsset === 'string' && manifest.link.allocatorObjectAsset.length > 0) {
			referencedAssets.add(manifest.link.allocatorObjectAsset);
		}
		for (const assetFile of manifest.sysrootFiles) {
			if (typeof assetFile?.asset !== 'string' || assetFile.asset.length === 0) {
				return false;
			}
			referencedAssets.add(assetFile.asset);
		}
		for (const assetFile of manifest.link.files) {
			if (typeof assetFile?.asset !== 'string' || assetFile.asset.length === 0) {
				return false;
			}
			referencedAssets.add(assetFile.asset);
		}
	} else {
		const targets = Object.values(manifest.targets || {});
		if (targets.length === 0) {
			return false;
		}
		if (typeof manifest.compiler?.rustcWasm !== 'string' || manifest.compiler.rustcWasm.length === 0) {
			return false;
		}
		referencedAssets.add(manifest.compiler.rustcWasm);
		for (const targetConfig of targets) {
			if (typeof targetConfig?.compile?.llvm?.llc !== 'string' || targetConfig.compile.llvm.llc.length === 0) {
				return false;
			}
			if (typeof targetConfig.compile.llvm.lld !== 'string' || targetConfig.compile.llvm.lld.length === 0) {
				return false;
			}
			referencedAssets.add(targetConfig.compile.llvm.llc);
			referencedAssets.add(targetConfig.compile.llvm.llcWasm || 'llvm/llc.wasm');
			referencedAssets.add(targetConfig.compile.llvm.lld);
			referencedAssets.add(targetConfig.compile.llvm.lldWasm || 'llvm/lld.wasm');
			referencedAssets.add(targetConfig.compile.llvm.lldData || 'llvm/lld.data');
			if (targetConfig.sysrootPack) {
				if (
					typeof targetConfig.sysrootPack.asset !== 'string' ||
					targetConfig.sysrootPack.asset.length === 0 ||
					typeof targetConfig.sysrootPack.index !== 'string' ||
					targetConfig.sysrootPack.index.length === 0
				) {
					return false;
				}
				referencedAssets.add(targetConfig.sysrootPack.asset);
				referencedAssets.add(targetConfig.sysrootPack.index);
			} else {
				if (!Array.isArray(targetConfig.sysrootFiles) || targetConfig.sysrootFiles.length === 0) {
					return false;
				}
				for (const assetFile of targetConfig.sysrootFiles) {
					if (typeof assetFile?.asset !== 'string' || assetFile.asset.length === 0) {
						return false;
					}
					referencedAssets.add(assetFile.asset);
				}
			}
			if (targetConfig.compile.link?.pack) {
				if (
					typeof targetConfig.compile.link.pack.asset !== 'string' ||
					targetConfig.compile.link.pack.asset.length === 0 ||
					typeof targetConfig.compile.link.pack.index !== 'string' ||
					targetConfig.compile.link.pack.index.length === 0
				) {
					return false;
				}
				referencedAssets.add(targetConfig.compile.link.pack.asset);
				referencedAssets.add(targetConfig.compile.link.pack.index);
			} else {
				if (
					typeof targetConfig.compile.link?.allocatorObjectAsset === 'string' &&
					targetConfig.compile.link.allocatorObjectAsset.length > 0
				) {
					referencedAssets.add(targetConfig.compile.link.allocatorObjectAsset);
				}
				if (
					!Array.isArray(targetConfig.compile.link?.files) ||
					targetConfig.compile.link.files.length === 0
				) {
					return false;
				}
				for (const assetFile of targetConfig.compile.link.files) {
					if (typeof assetFile?.asset !== 'string' || assetFile.asset.length === 0) {
						return false;
					}
					referencedAssets.add(assetFile.asset);
				}
			}
		}
	}
	for (const relativePath of referencedAssets) {
		if (!(await pathExists(path.join(runtimeRootPath, relativePath)))) {
			return false;
		}
	}
	return true;
}

async function copyFileIfNeeded(sourcePath, targetPath) {
	await ensureDirectory(path.dirname(targetPath));
	const sourceStat = await fs.stat(sourcePath);
	try {
		const targetStat = await fs.stat(targetPath);
		if (
			targetStat.size === sourceStat.size &&
			Math.trunc(targetStat.mtimeMs) === Math.trunc(sourceStat.mtimeMs)
		) {
			return;
		}
	} catch {}
	await fs.copyFile(sourcePath, targetPath);
	await fs.utimes(targetPath, sourceStat.atime, sourceStat.mtime);
}

async function listFiles(rootPath) {
	const entries = await fs.readdir(rootPath, { withFileTypes: true });
	const results = [];
	for (const entry of entries) {
		if (entry.name.endsWith('.old')) {
			continue;
		}
		const fullPath = path.join(rootPath, entry.name);
		if (entry.isDirectory()) {
			results.push(...(await listFiles(fullPath)));
			continue;
		}
		if (entry.isFile()) {
			results.push(fullPath);
		}
	}
	return results.sort();
}

async function copyTree(sourceRoot, targetRoot) {
	const files = await listFiles(sourceRoot);
	for (const filePath of files) {
		await copyFileIfNeeded(filePath, path.join(targetRoot, path.relative(sourceRoot, filePath)));
	}
	return files;
}

function toImportPath(fromFilePath, targetPath) {
	const relativePath = path
		.relative(path.dirname(fromFilePath), targetPath)
		.replaceAll(path.sep, '/');
	return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

function replaceQuotedSpecifier(input, specifier, replacement) {
	return input
		.replaceAll(`'${specifier}'`, `'${replacement}'`)
		.replaceAll(`"${specifier}"`, `"${replacement}"`);
}

async function copyBrowserVendorAssets() {
	const browserWasiShimVendorRoot = path.join(vendorRoot, 'browser_wasi_shim');
	const preview2ShimVendorRoot = path.join(vendorRoot, 'preview2-shim');
	const jcoVendorRoot = path.join(vendorRoot, 'jco');

	await fs.rm(browserWasiShimVendorRoot, { recursive: true, force: true });
	await fs.rm(preview2ShimVendorRoot, { recursive: true, force: true });
	await fs.rm(jcoVendorRoot, { recursive: true, force: true });

	await copyTree(browserWasiShimRoot, browserWasiShimVendorRoot);
	await copyTree(preview2ShimRoot, path.join(preview2ShimVendorRoot, 'lib'));
	await copyTree(path.join(jcoRoot, 'obj'), path.join(jcoVendorRoot, 'obj'));
	await copyFileIfNeeded(
		path.join(jcoRoot, 'src', 'browser.js'),
		path.join(jcoVendorRoot, 'src', 'browser.js')
	);
	await copyFileIfNeeded(
		path.join(jcoRoot, 'lib', 'wasi_snapshot_preview1.command.wasm'),
		path.join(jcoVendorRoot, 'lib', 'wasi_snapshot_preview1.command.wasm')
	);

	const distFiles = await listFiles(distRoot);
	const replacementTargets = [
		{
			specifier: '@bjorn3/browser_wasi_shim',
			targetPath: path.join(browserWasiShimVendorRoot, 'index.js')
		},
		{
			specifier: '@bjorn3/browser_wasi_shim/dist/fd.js',
			targetPath: path.join(browserWasiShimVendorRoot, 'fd.js')
		},
		{
			specifier: '@bjorn3/browser_wasi_shim/dist/fs_mem.js',
			targetPath: path.join(browserWasiShimVendorRoot, 'fs_mem.js')
		},
		{
			specifier: '@bjorn3/browser_wasi_shim/dist/wasi.js',
			targetPath: path.join(browserWasiShimVendorRoot, 'wasi.js')
		},
		{
			specifier: '@bjorn3/browser_wasi_shim/dist/wasi_defs.js',
			targetPath: path.join(browserWasiShimVendorRoot, 'wasi_defs.js')
		},
		{
			specifier: '@bytecodealliance/preview2-shim',
			targetPath: path.join(preview2ShimVendorRoot, 'lib', 'browser', 'index.js')
		},
		{
			specifier: '@bytecodealliance/preview2-shim/cli',
			targetPath: path.join(preview2ShimVendorRoot, 'lib', 'browser', 'cli.js')
		},
		{
			specifier: '@bytecodealliance/preview2-shim/filesystem',
			targetPath: path.join(preview2ShimVendorRoot, 'lib', 'browser', 'filesystem.js')
		},
		{
			specifier: '@bytecodealliance/preview2-shim/io',
			targetPath: path.join(preview2ShimVendorRoot, 'lib', 'browser', 'io.js')
		},
		{
			specifier: '@bytecodealliance/preview2-shim/random',
			targetPath: path.join(preview2ShimVendorRoot, 'lib', 'browser', 'random.js')
		}
	];

	for (const filePath of distFiles) {
		if (!filePath.endsWith('.js')) {
			continue;
		}
		let current = await fs.readFile(filePath, 'utf8');
		let next = current;
		for (const rule of replacementTargets) {
			if (!next.includes(rule.specifier)) {
				continue;
			}
			next = replaceQuotedSpecifier(next, rule.specifier, toImportPath(filePath, rule.targetPath));
		}
		if (next !== current) {
			await fs.writeFile(filePath, next);
		}
	}
}

async function patchRustcMemoryMaximum(rustcTargetPath) {
	const rustcBytes = new Uint8Array(await fs.readFile(rustcTargetPath));
	let cursor = 8;
	const readLeb = () => {
		let result = 0;
		let shift = 0;
		const start = cursor;
		while (true) {
			const byte = rustcBytes[cursor++];
			result |= (byte & 0x7f) << shift;
			if ((byte & 0x80) === 0) {
				return {
					value: result >>> 0,
					start,
					end: cursor
				};
			}
			shift += 7;
		}
	};
	const encodeLeb = (value) => {
		const encoded = [];
		let remaining = value >>> 0;
		do {
			let byte = remaining & 0x7f;
			remaining >>>= 7;
			if (remaining !== 0) {
				byte |= 0x80;
			}
			encoded.push(byte);
		} while (remaining !== 0);
		return encoded;
	};

	while (cursor < rustcBytes.length) {
		const sectionId = rustcBytes[cursor++];
		const sectionSize = readLeb();
		const sectionStart = cursor;
		const sectionEnd = sectionStart + sectionSize.value;
		if (sectionId !== 2) {
			cursor = sectionEnd;
			continue;
		}
		const importCount = readLeb().value;
		for (let importIndex = 0; importIndex < importCount; importIndex += 1) {
			const moduleLength = readLeb().value;
			cursor += moduleLength;
			const fieldLength = readLeb().value;
			cursor += fieldLength;
			const kind = rustcBytes[cursor++];
			if (kind === 0) {
				readLeb();
				continue;
			}
			if (kind === 1) {
				const elementType = rustcBytes[cursor++];
				if (elementType !== 0x60) {
					throw new Error(`unexpected rustc.wasm table import element type ${elementType}`);
				}
				readLeb();
				readLeb();
				continue;
			}
			if (kind === 3) {
				cursor += 2;
				continue;
			}
			if (kind !== 2) {
				throw new Error(`unsupported rustc.wasm import kind ${kind}`);
			}
			const flags = readLeb().value;
			readLeb();
			if ((flags & 1) !== 1) {
				throw new Error('rustc.wasm memory import does not declare a maximum');
			}
			const maximum = readLeb();
			const encodedMaximum = encodeLeb(rustcMemoryMaximumPages);
			if (encodedMaximum.length !== maximum.end - maximum.start) {
				throw new Error(
					`rustc.wasm memory maximum LEB size mismatch for ${rustcMemoryMaximumPages}`
				);
			}
			rustcBytes.set(encodedMaximum, maximum.start);
			await fs.writeFile(rustcTargetPath, rustcBytes);
			return;
		}
	}

	throw new Error('failed to locate rustc.wasm memory import while patching maximum pages');
}

function parseWasiSdkVersion(text) {
	const match =
		text.match(/wasi-sdk[^0-9]*([0-9]+)(?:\.([0-9]+))?/i) ||
		text.match(/\b([0-9]+)\.([0-9]+)(?:\.[0-9]+)?\b/);
	if (!match) {
		return null;
	}
	return {
		major: Number(match[1]),
		minor: Number(match[2] || '0')
	};
}

async function detectWasiSdkVersion(root) {
	const candidates = [path.basename(root)];
	for (const filePath of [
		path.join(root, 'VERSION'),
		path.join(root, 'share', 'wasi-sdk', 'VERSION'),
		path.join(root, 'share', 'wasi-sdk', 'version.txt')
	]) {
		try {
			candidates.push(await fs.readFile(filePath, 'utf8'));
		} catch {}
	}
	for (const candidate of candidates) {
		const parsed = parseWasiSdkVersion(candidate);
		if (parsed) {
			return parsed;
		}
	}
	return null;
}

async function collectNestedWasiSdkRoots(baseRoot) {
	if (!(await pathExists(baseRoot))) {
		return [];
	}
	const entries = await fs.readdir(baseRoot, { withFileTypes: true });
	const candidates = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const fullPath = path.join(baseRoot, entry.name);
		if (entry.name.startsWith('wasi-sdk-')) {
			candidates.push(fullPath);
			continue;
		}
		if (!entry.name.startsWith('wasm-rust')) {
			continue;
		}
		const nestedEntries = await fs.readdir(fullPath, { withFileTypes: true }).catch(() => []);
		for (const nestedEntry of nestedEntries) {
			if (!nestedEntry.isDirectory() || !nestedEntry.name.startsWith('wasi-sdk-')) {
				continue;
			}
			candidates.push(path.join(fullPath, nestedEntry.name));
		}
	}
	return candidates;
}

async function resolveWasiSdkSupport() {
	const candidateRoots = configuredWasiSdkRoot
		? [configuredWasiSdkRoot]
		: [
				...(await collectNestedWasiSdkRoots(path.dirname(path.dirname(wasmRustcRoot)))),
				...(await collectNestedWasiSdkRoots(path.join(os.homedir(), '.cache')))
			];
	const seenRoots = new Set();
	const compatibleRoots = [];
	for (const candidateRoot of candidateRoots) {
		if (!candidateRoot || seenRoots.has(candidateRoot)) {
			continue;
		}
		seenRoots.add(candidateRoot);
		if (!(await pathExists(candidateRoot))) {
			if (configuredWasiSdkRoot) {
				throw new Error(
					`configured WASM_RUST_WASI_SDK_ROOT does not exist: ${candidateRoot}`
				);
			}
			continue;
		}
		const componentLinkerPath = path.join(candidateRoot, 'bin', 'wasm-component-ld');
		if (!(await pathExists(componentLinkerPath))) {
			if (configuredWasiSdkRoot) {
				throw new Error(`wasi-sdk at ${candidateRoot} is missing bin/wasm-component-ld`);
			}
			continue;
		}
		const version = await detectWasiSdkVersion(candidateRoot);
		if (!version) {
			if (configuredWasiSdkRoot) {
				throw new Error(`failed to determine wasi-sdk version under ${candidateRoot}`);
			}
			continue;
		}
		if (version.major < 22) {
			if (configuredWasiSdkRoot) {
				throw new Error(
					`wasi-sdk >= 22 is required for wasm32-wasip2/wasm32-wasip3 support (found ${version.major}.${version.minor} at ${candidateRoot})`
				);
			}
			continue;
		}
		compatibleRoots.push({
			root: candidateRoot,
			componentLinkerPath,
			version
		});
	}
	if (compatibleRoots.length === 0) {
		return null;
	}
	compatibleRoots.sort((left, right) => {
		if (left.version.major !== right.version.major) {
			return right.version.major - left.version.major;
		}
		if (left.version.minor !== right.version.minor) {
			return right.version.minor - left.version.minor;
		}
		return left.root.localeCompare(right.root);
	});
	return compatibleRoots[0];
}

function isComponentTarget(targetTriple) {
	return targetTriple === 'wasm32-wasip2' || targetTriple === 'wasm32-wasip3';
}

function getTargetArtifactProfile(targetTriple) {
	if (isComponentTarget(targetTriple)) {
		return {
			artifactFormat: 'component',
			compileKind: 'llvm-wasm+component-encoder',
			executionKind: 'preview2-component'
		};
	}
	return {
		artifactFormat: 'core-wasm',
		compileKind: 'llvm-wasm',
		executionKind: 'preview1'
	};
}

async function captureNativeLinkInputs(targetTriple) {
	const tempRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), `wasm-rust-link-manifest-${targetTriple.replaceAll('-', '_')}-`)
	);
	const sourcePath = path.join(tempRoot, 'main.rs');
	const wrapperPath = path.join(tempRoot, 'rust-lld-wrapper.sh');
	const linkArgsPath = path.join(tempRoot, 'rust-lld-link-args.txt');
	const outputPath = path.join(tempRoot, 'native-main.wasm');
	const rustcPath = path.join(matchingNativeToolchainRoot, 'bin', 'rustc');

	await fs.writeFile(sourcePath, sampleProgram);
	await fs.writeFile(
		wrapperPath,
		[
			'#!/usr/bin/env bash',
			`printf '%s\\n' "$@" > ${JSON.stringify(linkArgsPath)}`,
			'exit 1'
		].join('\n'),
		{ mode: 0o755 }
	);

	try {
		execFileSync(
			rustcPath,
			[
				'--sysroot',
				matchingNativeSysrootRoot,
				'--target',
				targetTriple,
				'-Clinker=' + wrapperPath,
				'-Cpanic=abort',
				'-Ccodegen-units=1',
				'-Csave-temps',
				sourcePath,
				'-o',
				outputPath
			],
			{ stdio: 'ignore' }
		);
	} catch {
		if (!(await pathExists(linkArgsPath))) {
			throw new Error(
				`failed to capture native link recipe for ${targetTriple}; rustc did not reach the linker wrapper`
			);
		}
	}

	const tempEntries = await fs.readdir(tempRoot);
	const allocatorObjectName = tempEntries.find(
		(entry) => entry.endsWith('.rcgu.o') && !entry.includes('-cgu.0.')
	);
	if (!allocatorObjectName) {
		throw new Error(`failed to locate allocator shim object for ${targetTriple} in ${tempRoot}`);
	}

	const nativeLinkArgs = (await fs.readFile(linkArgsPath, 'utf8'))
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);

	return {
		tempRoot,
		allocatorObjectPath: path.join(tempRoot, allocatorObjectName),
		nativeLinkArgs
	};
}

async function resolveWasiSdkBuiltinsPath(wasiSdkSupport) {
	if (!wasiSdkSupport) {
		return null;
	}
	const clangRoot = path.join(wasiSdkSupport.root, 'lib', 'clang');
	if (!(await pathExists(clangRoot))) {
		return null;
	}
	const entries = await fs.readdir(clangRoot, { withFileTypes: true });
	const versions = entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort()
		.reverse();
	for (const version of versions) {
		const candidate = path.join(
			clangRoot,
			version,
			'lib',
			'wasi',
			'libclang_rt.builtins-wasm32.a'
		);
		if (await pathExists(candidate)) {
			return candidate;
		}
	}
	return null;
}

async function resolveWasiSdkLibcPath(targetTriple, wasiSdkSupport) {
	if (!wasiSdkSupport) {
		return null;
	}
	const sysrootLibRoot = path.join(wasiSdkSupport.root, 'share', 'wasi-sysroot', 'lib');
	const candidateDirectories =
		targetTriple === 'wasm32-wasip3'
			? ['wasm32-wasip3', 'wasm32-wasip2', 'wasm32-wasip1', 'wasm32-wasi']
			: targetTriple === 'wasm32-wasip2'
				? ['wasm32-wasip2', 'wasm32-wasip1', 'wasm32-wasi']
			: ['wasm32-wasip1', 'wasm32-wasi'];
	for (const directoryName of candidateDirectories) {
		const candidate = path.join(sysrootLibRoot, directoryName, 'libc.a');
		if (await pathExists(candidate)) {
			return candidate;
		}
	}
	return null;
}

function isLinkAssetPath(value) {
	return (
		value.endsWith('.rlib') ||
		value.endsWith('.o') ||
		value.endsWith('.a') ||
		value.endsWith('.so') ||
		value.endsWith('.bc') ||
		value.endsWith('.wasm')
	);
}

function maybeTranslateMappedPath(arg, mappingRoots) {
	if (!path.isAbsolute(arg)) {
		return null;
	}
	for (const mapping of mappingRoots) {
		if (arg === mapping.sourceRoot || arg.startsWith(mapping.sourceRoot + path.sep)) {
			const relativePath = path.relative(mapping.sourceRoot, arg).replaceAll(path.sep, '/');
			return {
				runtimePath: relativePath ? `${mapping.runtimeRoot}/${relativePath}` : mapping.runtimeRoot,
				asset:
					relativePath && mapping.assetRoot
						? `${mapping.assetRoot}/${relativePath}`
						: mapping.assetRoot || null
			};
		}
	}
	return null;
}

function sanitizeLinkArgsForBrowser(targetTriple, args) {
	if (!isComponentTarget(targetTriple)) {
		return args;
	}
	const valueFlags = new Set(['--adapt', '--wasi-adapter']);
	const bareFlags = new Set(['--merge-imports-based-on-semver', '--validate-component']);
	const sanitized = [];
	for (let index = 0; index < args.length; index += 1) {
		const current = args[index];
		if (valueFlags.has(current)) {
			index += 1;
			continue;
		}
		if (
			current.startsWith('--adapt=') ||
			current.startsWith('--wasi-adapter=')
		) {
			continue;
		}
		if (bareFlags.has(current)) {
			continue;
		}
		sanitized.push(current);
	}
	return sanitized;
}

async function buildLinkManifest({
	nativeLinkArgs,
	allocatorObjectPath,
	tempRoot,
	targetRustLibDir,
	targetTriple,
	wasiSdkSupport
}) {
	const allocatorObjectAsset = `link/${targetTriple}/alloc.o`;
	const targetRustLibSelfContainedDir = path.join(targetRustLibDir, 'self-contained');
	const builtinsPath = await resolveWasiSdkBuiltinsPath(wasiSdkSupport);
	const libcPath = await resolveWasiSdkLibcPath(targetTriple, wasiSdkSupport);
	const mappingRoots = [
		{
			sourceRoot: allocatorObjectPath,
			runtimeRoot: '/work/alloc.o',
			assetRoot: allocatorObjectAsset
		},
		{
			sourceRoot: targetRustLibSelfContainedDir,
			runtimeRoot: '/rustlib/self-contained',
			assetRoot: `sysroot/lib/rustlib/${targetTriple}/lib/self-contained`
		},
		{
			sourceRoot: targetRustLibDir,
			runtimeRoot: '/rustlib',
			assetRoot: `sysroot/lib/rustlib/${targetTriple}/lib`
		}
	];
	if (wasiSdkSupport) {
		mappingRoots.push(
			{
				sourceRoot: path.join(wasiSdkSupport.root, 'share', 'wasi-sysroot'),
				runtimeRoot: '/wasi-sdk/share/wasi-sysroot',
				assetRoot: 'wasi-sdk/share/wasi-sysroot'
			},
			{
				sourceRoot: path.join(wasiSdkSupport.root, 'lib'),
				runtimeRoot: '/wasi-sdk/lib',
				assetRoot: 'wasi-sdk/lib'
			}
		);
	}
	mappingRoots.sort((left, right) => right.sourceRoot.length - left.sourceRoot.length);

	const expandedLinkArgs = [];
	for (let index = 0; index < nativeLinkArgs.length; index += 1) {
		const current = nativeLinkArgs[index];
		const next = nativeLinkArgs[index + 1];
		if (current === '-l' && next === 'c') {
			if (builtinsPath) {
				expandedLinkArgs.push(builtinsPath);
			}
			if (libcPath) {
				expandedLinkArgs.push(libcPath);
			} else if (isComponentTarget(targetTriple)) {
				throw new Error(`failed to resolve wasi-sdk libc.a for ${targetTriple}`);
			} else {
				expandedLinkArgs.push(current, next);
			}
			index += 1;
			continue;
		}
		if (current === '-lc') {
			if (builtinsPath) {
				expandedLinkArgs.push(builtinsPath);
			}
			if (libcPath) {
				expandedLinkArgs.push(libcPath);
			} else if (isComponentTarget(targetTriple)) {
				throw new Error(`failed to resolve wasi-sdk libc.a for ${targetTriple}`);
			} else {
				expandedLinkArgs.push(current);
			}
			continue;
		}
		expandedLinkArgs.push(current);
	}

	const translatedLinkArgs = [];
	const linkedAssets = [];
	let insertedBrowserMainObject = false;
	for (const arg of expandedLinkArgs) {
		if (
			path.isAbsolute(arg) &&
			arg.endsWith('.o') &&
			arg !== allocatorObjectPath &&
			(arg === tempRoot || arg.startsWith(tempRoot + path.sep))
		) {
			if (!insertedBrowserMainObject) {
				translatedLinkArgs.push('/work/main.o');
				insertedBrowserMainObject = true;
			}
			continue;
		}
		if (arg.startsWith('-L') && path.isAbsolute(arg.slice(2))) {
			const translated = maybeTranslateMappedPath(arg.slice(2), mappingRoots);
			translatedLinkArgs.push(translated ? `-L${translated.runtimePath}` : arg);
			continue;
		}
		const translated = maybeTranslateMappedPath(arg, mappingRoots);
		if (!translated) {
			translatedLinkArgs.push(arg);
			continue;
		}
		translatedLinkArgs.push(translated.runtimePath);
		if (translated.asset && isLinkAssetPath(arg)) {
			linkedAssets.push({
				asset: translated.asset,
				runtimePath: translated.runtimePath,
				sourcePath: arg
			});
		}
	}

	const sanitizedLinkArgs = sanitizeLinkArgsForBrowser(targetTriple, translatedLinkArgs);
	while (sanitizedLinkArgs[0] && !sanitizedLinkArgs[0].startsWith('-')) {
		sanitizedLinkArgs.shift();
	}

	const outputIndex = sanitizedLinkArgs.findIndex((arg) => arg === '-o');
	if (outputIndex === -1 || outputIndex + 1 >= sanitizedLinkArgs.length) {
		throw new Error(`translated link args for ${targetTriple} are missing -o`);
	}
	sanitizedLinkArgs[outputIndex + 1] = '/work/main.wasm';

	const dedupedPackEntries = [
		{
			runtimePath: '/work/alloc.o',
			sourcePath: allocatorObjectPath
		}
	];
	const seenRuntimePaths = new Set();
	for (const entry of linkedAssets) {
		if (!entry.runtimePath || entry.runtimePath === '/work/alloc.o') {
			continue;
		}
		if (seenRuntimePaths.has(entry.runtimePath)) {
			continue;
		}
		seenRuntimePaths.add(entry.runtimePath);
		dedupedPackEntries.push({
			runtimePath: entry.runtimePath,
			sourcePath: entry.sourcePath
		});
	}

	return {
		args: sanitizedLinkArgs,
		packEntries: dedupedPackEntries
	};
}

async function buildRuntimePackReference({
	packAsset,
	indexAsset,
	entries
}) {
	const packPath = path.join(runtimeRoot, packAsset);
	const indexPath = path.join(runtimeRoot, indexAsset);
	const index = await writeRuntimePack({
		packPath,
		indexPath,
		entries
	});
	return {
		asset: await maybePrecompressRuntimeAsset(packPath, 'packs'),
		index: await maybePrecompressRuntimeAsset(indexPath, 'packs'),
		fileCount: index.fileCount,
		totalBytes: index.totalBytes
	};
}

async function main() {
	await copyBrowserVendorAssets();
	const foundationalRuntimeInputs = [
		path.join(wasmRustcRoot, 'bin', 'rustc.wasm'),
		path.join(llvmWasmRoot, 'llc.js'),
		path.join(llvmWasmRoot, 'llc.wasm'),
		path.join(llvmWasmRoot, 'lld.js'),
		path.join(llvmWasmRoot, 'lld.wasm'),
		path.join(llvmWasmRoot, 'lld.data')
	];
	const missingFoundationalRuntimeInputs = [];
	for (const sourcePath of foundationalRuntimeInputs) {
		if (!(await pathExists(sourcePath))) {
			missingFoundationalRuntimeInputs.push(sourcePath);
		}
	}
	if (missingFoundationalRuntimeInputs.length > 0) {
		if (
			allowPrebuiltRuntimeFallback &&
			(await isReusablePrebuiltRuntimeBundle(runtimeRoot))
		) {
			console.warn(
				`[wasm-rust] reusing prebuilt dist/runtime bundle because prepare-runtime inputs are unavailable: ${missingFoundationalRuntimeInputs.join(', ')}`
			);
			return;
		}
		throw new Error(
			`missing runtime preparation inputs: ${missingFoundationalRuntimeInputs.join(', ')}`
		);
	}
	await fs.rm(runtimeRoot, { recursive: true, force: true });
	await ensureDirectory(runtimeRoot);

	const rustcTargetPath = path.join(runtimeRoot, 'rustc', 'rustc.wasm');
	await copyFileIfNeeded(path.join(wasmRustcRoot, 'bin', 'rustc.wasm'), rustcTargetPath);
	await patchRustcMemoryMaximum(rustcTargetPath);
	const rustcRuntimeAsset = await maybePrecompressRuntimeAsset(rustcTargetPath, 'rustc');

	await copyFileIfNeeded(path.join(llvmWasmRoot, 'llc.js'), path.join(runtimeRoot, 'llvm', 'llc.js'));
	const llcWasmRuntimeAsset = await (async () => {
		const llcWasmPath = path.join(runtimeRoot, 'llvm', 'llc.wasm');
		await copyFileIfNeeded(path.join(llvmWasmRoot, 'llc.wasm'), llcWasmPath);
		return await maybePrecompressRuntimeAsset(llcWasmPath, 'llvm');
	})();
	await copyFileIfNeeded(path.join(llvmWasmRoot, 'lld.js'), path.join(runtimeRoot, 'llvm', 'lld.js'));
	const lldWasmRuntimeAsset = await (async () => {
		const lldWasmPath = path.join(runtimeRoot, 'llvm', 'lld.wasm');
		await copyFileIfNeeded(path.join(llvmWasmRoot, 'lld.wasm'), lldWasmPath);
		return await maybePrecompressRuntimeAsset(lldWasmPath, 'llvm');
	})();
	const lldDataRuntimeAsset = await (async () => {
		const lldDataPath = path.join(runtimeRoot, 'llvm', 'lld.data');
		await copyFileIfNeeded(path.join(llvmWasmRoot, 'lld.data'), lldDataPath);
		return await maybePrecompressRuntimeAsset(lldDataPath, 'llvm');
	})();

	const sysrootSourceRoot = path.join(wasmRustcRoot, 'lib', 'rustlib');

	const compiler = {
		rustcWasm: rustcRuntimeAsset,
		workerBitcodeFile: bitcodeFileName,
		workerSharedOutputBytes: 32 * 1024 * 1024,
		compileTimeoutMs: 120_000,
		artifactIdleMs: 1_500,
		rustcMemory: {
			initialPages: rustcMemoryInitialPages,
			maximumPages: rustcMemoryMaximumPages
		}
	};

	const wasiSdkSupport = await resolveWasiSdkSupport().catch((error) => {
		if (
			configuredTargetTriples.some((targetTriple) => isComponentTarget(targetTriple)) &&
			!allowMissingTargets
		) {
			throw error;
		}
		console.warn(`[wasm-rust] skipping wasi-sdk component support: ${error.message}`);
		return null;
	});
	if (wasiSdkSupport && !configuredWasiSdkRoot) {
		console.log(
			`[wasm-rust] auto-detected wasi-sdk root ${wasiSdkSupport.root} (${wasiSdkSupport.version.major}.${wasiSdkSupport.version.minor})`
		);
	}

	const targets = {};
	for (const targetTriple of configuredTargetTriples) {
		const profile = getTargetArtifactProfile(targetTriple);
		const targetLibSource = path.join(sysrootSourceRoot, targetTriple, 'lib');
		if (!(await pathExists(targetLibSource))) {
			const message =
				targetTriple === 'wasm32-wasip3'
					? `missing target sysroot libraries at ${targetLibSource}; wasm32-wasip3 currently requires the documented libc [patch] when building the custom toolchain`
					: `missing target sysroot libraries at ${targetLibSource}`;
			if (allowMissingTargets && targetTriple !== defaultTargetTriple) {
				console.warn(`[wasm-rust] skipping ${targetTriple}: ${message}`);
				continue;
			}
			throw new Error(message);
		}
		if (isComponentTarget(targetTriple) && !wasiSdkSupport) {
			const message =
				`${targetTriple} packaging requires WASM_RUST_WASI_SDK_ROOT pointing to wasi-sdk >= 22 with wasm-component-ld`;
			if (allowMissingTargets && targetTriple !== defaultTargetTriple) {
				console.warn(`[wasm-rust] skipping ${targetTriple}: ${message}`);
				continue;
			}
			throw new Error(message);
		}

		const sysrootFiles = await listFiles(targetLibSource);
		const { allocatorObjectPath, nativeLinkArgs, tempRoot } = await captureNativeLinkInputs(targetTriple);
		const { args, packEntries } = await buildLinkManifest({
			nativeLinkArgs,
			allocatorObjectPath,
			tempRoot,
			targetRustLibDir: path.join(
				matchingNativeSysrootRoot,
				'lib',
				'rustlib',
				targetTriple,
				'lib'
			),
			targetTriple,
			wasiSdkSupport
		});
		const sysrootPack = await buildRuntimePackReference({
			packAsset: `packs/sysroot/${targetTriple}.pack`,
			indexAsset: `packs/sysroot/${targetTriple}.index.json`,
			entries: sysrootFiles.map((filePath) => ({
				sourcePath: filePath,
				runtimePath: `/lib/rustlib/${relativeAssetPath(sysrootSourceRoot, filePath)}`
			}))
		});
		const linkPack = await buildRuntimePackReference({
			packAsset: `packs/link/${targetTriple}.pack`,
			indexAsset: `packs/link/${targetTriple}.index.json`,
			entries: packEntries
		});
		targets[targetTriple] = {
			artifactFormat: profile.artifactFormat,
			sysrootPack,
			compile: {
				kind: profile.compileKind,
				llvm: {
					llc: 'llvm/llc.js',
					llcWasm: llcWasmRuntimeAsset,
					lld: 'llvm/lld.js',
					lldWasm: lldWasmRuntimeAsset,
					lldData: lldDataRuntimeAsset
				},
				link: {
					args,
					pack: linkPack
				}
			},
			execution: {
				kind: profile.executionKind
			}
		};
	}

	if (!targets[defaultTargetTriple]) {
		throw new Error(`default target ${defaultTargetTriple} is unavailable after runtime packaging`);
	}

	const runtimeManifestV3 = {
		manifestVersion: 3,
		version: runtimeVersion,
		hostTriple,
		defaultTargetTriple,
		compiler,
		targets
	};

	await fs.writeFile(
		path.join(runtimeRoot, 'runtime-manifest.v3.json'),
		JSON.stringify(runtimeManifestV3, null, 2) + '\n'
	);
}

if (isDirectExecution) {
	await main();
}

export {
	defaultRuntimeTargetTriples,
	defaultRustcMemoryInitialPages,
	defaultRustcMemoryMaximumPages,
	distRoot,
	isReusablePrebuiltRuntimeBundle,
	llvmWasmRoot,
	matchingNativeToolchainRoot,
	parseRuntimePrecompressionScopes,
	projectRoot,
	runtimeRoot,
	wasmRustcRoot
};
