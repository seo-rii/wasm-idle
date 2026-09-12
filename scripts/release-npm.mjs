#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gunzip as gunzipCallback } from 'node:zlib';

const gunzip = promisify(gunzipCallback);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';
const RELEASE_PACKAGE_LOCATIONS = [
	['wasm-idle', '.'],
	['@wasm-idle/core', 'packages/core'],
	['@wasm-idle/debug', 'packages/debug'],
	['@wasm-idle/llvm-core', 'packages/llvm-core'],
	['@wasm-idle/lsp', 'packages/lsp'],
	['@wasm-idle/node', 'packages/node'],
	['@wasm-idle/react', 'packages/react'],
	['@wasm-idle/svelte', 'packages/svelte'],
	['@wasm-idle/terminal', 'packages/terminal'],
	['@wasm-idle/vue', 'packages/vue']
];
const DEPENDENCY_SECTIONS = [
	'dependencies',
	'optionalDependencies',
	'peerDependencies',
	'devDependencies'
];
const PUBLISH_DEPENDENCY_SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies'];
const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

function usage() {
	return `Usage:
  pnpm release:npm -- --version <version> [--publish] [--tag <tag>] [--access public|restricted]
	    [--registry <url>] [--resume]

The default run updates versions, verifies npm authentication and registry availability,
builds every package, and validates packed tarballs without publishing them.

Options:
	--publish           Publish verified tarballs in dependency order.
  --resume            Accept an existing version only when its registry integrity and
                      SHA-1 match the freshly verified tarball; publish only missing ones.
  --tag <tag>         npm dist-tag (default: latest).
  --access <access>   npm access level (default: public).
  --registry <url>    npm registry (default: ${DEFAULT_REGISTRY}).
  --help              Show this help.
`;
}

/** @param {string} value */
export function assertTargetVersion(value) {
	if (!SEMVER_PATTERN.test(value)) {
		throw new Error(
			`Target version must be an explicit valid semver, received: ${value || '(missing)'}`
		);
	}
	return value;
}

/** @param {string} value */
function normalizeRegistry(value) {
	let registry;
	try {
		registry = new URL(value);
	} catch {
		throw new Error(`Registry must be an absolute HTTP(S) URL, received: ${value}`);
	}
	if (
		!['http:', 'https:'].includes(registry.protocol) ||
		registry.username ||
		registry.password
	) {
		throw new Error(`Registry must be an HTTP(S) URL without embedded credentials: ${value}`);
	}
	registry.search = '';
	registry.hash = '';
	if (!registry.pathname.endsWith('/')) registry.pathname += '/';
	return registry.href;
}

/** @param {string[]} argv */
export function parseReleaseArgs(argv) {
	const options = {
		publish: false,
		resume: false,
		tag: 'latest',
		access: 'public',
		registry: DEFAULT_REGISTRY,
		help: false,
		version: ''
	};

	/** @param {number} index @param {string} flag */
	const readOption = (index, flag) => {
		const value = argv[index + 1];
		if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
		return value;
	};

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--') continue;
		if (argument === '--help' || argument === '-h') options.help = true;
		else if (argument === '--publish') options.publish = true;
		else if (argument === '--resume') options.resume = true;
		else if (argument === '--version') {
			if (options.version) throw new Error('Target version was specified more than once.');
			options.version = readOption(index++, '--version');
		} else if (argument === '--tag') options.tag = readOption(index++, '--tag');
		else if (argument === '--access') options.access = readOption(index++, '--access');
		else if (argument === '--registry') {
			options.registry = readOption(index++, '--registry');
		} else if (argument.startsWith('--')) {
			throw new Error(`Unknown option: ${argument}`);
		} else if (options.version) {
			throw new Error(`Unexpected positional argument: ${argument}`);
		} else {
			options.version = argument;
		}
	}

	if (options.help) return options;
	assertTargetVersion(options.version);
	if (!['public', 'restricted'].includes(options.access)) {
		throw new Error('--access must be either public or restricted.');
	}
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(options.tag) || SEMVER_PATTERN.test(options.tag)) {
		throw new Error(`Invalid npm dist-tag: ${options.tag}`);
	}
	if (options.version.split('+', 1)[0].includes('-') && options.tag === 'latest') {
		throw new Error('Prerelease versions require an explicit non-latest --tag, such as next.');
	}
	options.registry = normalizeRegistry(options.registry);
	return options;
}

/** @param {string} packageName */
function isWasmIdlePackage(packageName) {
	return packageName === 'wasm-idle' || packageName.startsWith('@wasm-idle/');
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {string} targetVersion
 * @param {Set<string>} releaseNames
 */
export function synchronizeManifest(manifest, targetVersion, releaseNames) {
	const updated = structuredClone(manifest);
	updated.version = targetVersion;
	for (const section of DEPENDENCY_SECTIONS) {
		const dependencies = updated[section];
		if (!dependencies || typeof dependencies !== 'object') continue;
		for (const [dependencyName, currentRange] of Object.entries(dependencies)) {
			if (!releaseNames.has(dependencyName)) continue;
			if (section !== 'peerDependencies' && currentRange === 'workspace:*') continue;
			dependencies[dependencyName] = targetVersion;
		}
	}
	return updated;
}

/**
 * @param {Array<{name: string, manifest: Record<string, any>}>} packages
 * @param {string} targetVersion
 */
export function validateSourceRelease(packages, targetVersion) {
	const releaseNames = new Set(packages.map((pkg) => pkg.name));
	if (releaseNames.size !== packages.length)
		throw new Error('Release package names must be unique.');

	for (const pkg of packages) {
		if (pkg.manifest.name !== pkg.name)
			throw new Error(`Manifest name mismatch for ${pkg.name}.`);
		if (pkg.manifest.version !== targetVersion) {
			throw new Error(
				`${pkg.name} has version ${pkg.manifest.version}; expected ${targetVersion}.`
			);
		}
		for (const section of DEPENDENCY_SECTIONS) {
			for (const [dependencyName, range] of Object.entries(pkg.manifest[section] ?? {})) {
				if (!isWasmIdlePackage(dependencyName)) continue;
				if (!releaseNames.has(dependencyName)) {
					throw new Error(
						`${pkg.name} ${section} references unpublished ${dependencyName}.`
					);
				}
				const allowed = section !== 'peerDependencies' && range === 'workspace:*';
				if (!allowed && range !== targetVersion) {
					throw new Error(
						`${pkg.name} ${section}.${dependencyName} must be ${targetVersion} or workspace:*, received ${range}.`
					);
				}
			}
		}
	}
}

/**
 * @param {Array<{name: string, manifest: Record<string, any>}>} packages
 */
export function topologicallySortRelease(packages) {
	const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
	const dependents = new Map(packages.map((pkg) => [pkg.name, new Set()]));
	const dependencyCount = new Map(packages.map((pkg) => [pkg.name, 0]));

	for (const pkg of packages) {
		const internalDependencies = new Set();
		for (const section of PUBLISH_DEPENDENCY_SECTIONS) {
			for (const dependencyName of Object.keys(pkg.manifest[section] ?? {})) {
				if (byName.has(dependencyName)) internalDependencies.add(dependencyName);
			}
		}
		dependencyCount.set(pkg.name, internalDependencies.size);
		for (const dependencyName of internalDependencies)
			dependents.get(dependencyName).add(pkg.name);
	}

	const priority = (name) => {
		if (name === '@wasm-idle/core') return -20;
		if (name === '@wasm-idle/llvm-core') return -10;
		if (name === 'wasm-idle') return 100;
		return 0;
	};
	const compareNames = (left, right) =>
		priority(left) - priority(right) || left.localeCompare(right);
	const ready = packages
		.map((pkg) => pkg.name)
		.filter((name) => dependencyCount.get(name) === 0)
		.sort(compareNames);
	const ordered = [];

	while (ready.length > 0) {
		const name = ready.shift();
		ordered.push(byName.get(name));
		for (const dependentName of dependents.get(name)) {
			const nextCount = dependencyCount.get(dependentName) - 1;
			dependencyCount.set(dependentName, nextCount);
			if (nextCount === 0) {
				ready.push(dependentName);
				ready.sort(compareNames);
			}
		}
	}

	if (ordered.length !== packages.length)
		throw new Error('Internal release dependency cycle detected.');
	return ordered;
}

/**
 * @param {Record<string, any>} manifest
 * @param {{name: string, version: string, releaseNames: Set<string>}} expected
 */
export function validatePackedManifest(manifest, expected) {
	if (manifest.name !== expected.name) {
		throw new Error(`Packed package name is ${manifest.name}; expected ${expected.name}.`);
	}
	if (manifest.version !== expected.version) {
		throw new Error(
			`${expected.name} packed version is ${manifest.version}; expected ${expected.version}.`
		);
	}
	if (manifest.private === true) throw new Error(`${expected.name} packed as a private package.`);

	for (const section of DEPENDENCY_SECTIONS) {
		for (const [dependencyName, range] of Object.entries(manifest[section] ?? {})) {
			if (!isWasmIdlePackage(dependencyName)) continue;
			if (!expected.releaseNames.has(dependencyName)) {
				throw new Error(
					`${expected.name} packed ${section} references ${dependencyName}, which is not in this release.`
				);
			}
			if (range !== expected.version) {
				throw new Error(
					`${expected.name} packed ${section}.${dependencyName} is ${range}; expected exact ${expected.version}.`
				);
			}
		}
	}
}

/**
 * @param {Array<{name: string, exists: boolean, integrity?: string, shasum?: string}>} states
 * @param {boolean} resume
 */
export function assertRegistryAvailability(states, resume) {
	const existing = states.filter((state) => state.exists);
	if (existing.length === 0 || resume) return;
	throw new Error(
		[
			`The target version already exists for: ${existing.map((state) => state.name).join(', ')}`,
			'Choose a new version. If these packages came from an interrupted run of this release, rerun with --publish --resume; existing tarballs will only be skipped when their integrity and SHA-1 match.'
		].join('\n')
	);
}

/**
 * @param {Array<{name: string, exists: boolean, integrity?: string, shasum?: string}>} states
 * @param {Map<string, {integrity: string, shasum: string}>} artifacts
 */
export function validateResumeArtifacts(states, artifacts) {
	for (const state of states) {
		if (!state.exists) continue;
		const artifact = artifacts.get(state.name);
		if (!artifact) throw new Error(`Missing local artifact for existing ${state.name}.`);
		if (
			!state.integrity ||
			state.integrity !== artifact.integrity ||
			!state.shasum ||
			state.shasum.toLowerCase() !== artifact.shasum.toLowerCase()
		) {
			throw new Error(
				`${state.name} already exists, but its registry integrity does not match the verified tarball. Refusing to resume. Use a new version.`
			);
		}
	}
}

/** @param {string} command @param {string[]} args @param {string} cwd @param {NodeJS.ProcessEnv} [env] */
function run(command, args, cwd, env = process.env) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
		child.on('error', reject);
		child.on('close', (code, signal) => {
			if (code === 0) resolve();
			else
				reject(
					new Error(
						`${command} ${args.join(' ')} failed${signal ? ` with ${signal}` : ` with code ${code}`}.`
					)
				);
		});
	});
}

/** @param {string} command @param {string[]} args @param {string} cwd */
function runCapture(command, args, cwd) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => (stdout += chunk));
		child.stderr.on('data', (chunk) => (stderr += chunk));
		child.on('error', reject);
		child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
	});
}

async function readJson(file) {
	return JSON.parse(await readFile(file, 'utf8'));
}

async function discoverReleasePackages() {
	const packages = [];
	for (const [expectedName, relativeDir] of RELEASE_PACKAGE_LOCATIONS) {
		const dir = path.join(REPO_ROOT, relativeDir);
		const manifestPath = path.join(dir, 'package.json');
		const manifest = await readJson(manifestPath);
		if (manifest.name !== expectedName) {
			throw new Error(
				`${relativeDir}/package.json is ${manifest.name}; expected ${expectedName}.`
			);
		}
		if (manifest.private === true)
			throw new Error(`${expectedName} is private and cannot be released.`);
		packages.push({ name: expectedName, dir, relativeDir, manifestPath, manifest });
	}
	return packages;
}

function isBookkeepingPath(relativePath) {
	return (
		relativePath === 'RISK_REGISTER.md' ||
		relativePath.endsWith('/RISK_REGISTER.md') ||
		relativePath === '.codex' ||
		relativePath.startsWith('.codex/')
	);
}

async function assertReleaseWorktree(packages, targetVersion) {
	const status = await runCapture(
		'git',
		['status', '--porcelain=v1', '--untracked-files=all'],
		REPO_ROOT
	);
	if (status.code !== 0)
		throw new Error(`Could not inspect the git worktree.\n${status.stderr.trim()}`);
	const dirtyPaths = status.stdout
		.split('\n')
		.filter(Boolean)
		.map((line) => line.slice(3));
	const manifestByPath = new Map(
		packages.map((pkg) => [path.relative(REPO_ROOT, pkg.manifestPath), pkg])
	);
	const unexpectedPaths = dirtyPaths.filter(
		(relativePath) =>
			!isBookkeepingPath(relativePath) &&
			relativePath !== 'pnpm-lock.yaml' &&
			!manifestByPath.has(relativePath)
	);
	if (unexpectedPaths.length > 0) {
		throw new Error(
			`Release requires a clean source worktree. Commit or stash these paths first:\n${unexpectedPaths.map((value) => `  - ${value}`).join('\n')}`
		);
	}

	const releaseNames = new Set(packages.map((pkg) => pkg.name));
	const dirtyManifests = dirtyPaths.filter((relativePath) => manifestByPath.has(relativePath));
	for (const relativePath of dirtyManifests) {
		const committed = await runCapture('git', ['show', `HEAD:${relativePath}`], REPO_ROOT);
		if (committed.code !== 0) {
			throw new Error(`Could not validate release-only changes in ${relativePath}.`);
		}
		const expected = synchronizeManifest(
			JSON.parse(committed.stdout),
			targetVersion,
			releaseNames
		);
		const current = manifestByPath.get(relativePath).manifest;
		if (JSON.stringify(current) !== JSON.stringify(expected)) {
			throw new Error(
				`${relativePath} contains changes beyond the ${targetVersion} release version synchronization. Commit or stash them first.`
			);
		}
	}
	if (dirtyPaths.includes('pnpm-lock.yaml') && dirtyManifests.length === 0) {
		throw new Error(
			'pnpm-lock.yaml is dirty without matching release manifest changes. Commit or stash it first.'
		);
	}
}

async function verifyNpmAuthentication(registry) {
	const result = await runCapture('npm', ['whoami', '--registry', registry], REPO_ROOT);
	if (result.code !== 0 || !result.stdout.trim()) {
		throw new Error(
			`npm authentication failed for ${registry}. Run npm login for this registry and retry.\n${result.stderr.trim()}`
		);
	}
	console.log(`npm authentication verified for ${registry}`);
}

async function readRegistryState(packageName, version, registry) {
	const spec = `${packageName}@${version}`;
	const result = await runCapture(
		'npm',
		['view', spec, 'dist', '--json', '--registry', registry],
		REPO_ROOT
	);
	if (result.code === 0) {
		let dist;
		try {
			dist = JSON.parse(result.stdout);
		} catch {
			throw new Error(`npm returned invalid metadata for ${spec}.`);
		}
		if (
			!dist ||
			typeof dist !== 'object' ||
			typeof dist.integrity !== 'string' ||
			typeof dist.shasum !== 'string'
		) {
			throw new Error(`npm returned incomplete dist metadata for existing ${spec}.`);
		}
		return {
			name: packageName,
			exists: true,
			integrity: dist.integrity,
			shasum: dist.shasum
		};
	}
	if (/E404|404 Not Found|is not in this registry/iu.test(result.stderr)) {
		return { name: packageName, exists: false };
	}
	throw new Error(`Could not check ${spec} in ${registry}.\n${result.stderr.trim()}`);
}

async function inspectTarball(tarballPath) {
	const compressed = await readFile(tarballPath);
	const shasum = createHash('sha1').update(compressed).digest('hex');
	const integrity = `sha512-${createHash('sha512').update(compressed).digest('base64')}`;
	const archive = await gunzip(compressed);
	let offset = 0;
	while (offset + 512 <= archive.length) {
		const header = archive.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const field = (start, length) =>
			header
				.subarray(start, start + length)
				.toString('utf8')
				.replace(/\0.*$/u, '');
		const name = field(0, 100);
		const prefix = field(345, 155);
		const entryName = prefix ? `${prefix}/${name}` : name;
		const sizeText = field(124, 12).trim();
		const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
		if (!Number.isSafeInteger(size) || size < 0)
			throw new Error(`Invalid tar entry size in ${tarballPath}.`);
		const contentOffset = offset + 512;
		const nextOffset = contentOffset + Math.ceil(size / 512) * 512;
		if (nextOffset > archive.length) throw new Error(`Truncated tarball: ${tarballPath}`);
		if (entryName === 'package/package.json') {
			return {
				manifest: JSON.parse(
					archive.subarray(contentOffset, contentOffset + size).toString('utf8')
				),
				integrity,
				shasum
			};
		}
		offset = nextOffset;
	}
	throw new Error(`Tarball does not contain package/package.json: ${tarballPath}`);
}

async function packAndValidate(packages, version, tarballDir) {
	const releaseNames = new Set(packages.map((pkg) => pkg.name));
	const artifacts = new Map();
	for (const pkg of packages) {
		const fileName = `${pkg.name.replace(/^@/u, '').replaceAll('/', '-')}-${version}.tgz`;
		const tarballPath = path.join(tarballDir, fileName);
		await run('pnpm', ['--dir', pkg.dir, 'pack', '--out', tarballPath], REPO_ROOT, {
			...process.env,
			npm_config_ignore_scripts: 'true'
		});
		await stat(tarballPath);
		const inspected = await inspectTarball(tarballPath);
		validatePackedManifest(inspected.manifest, {
			name: pkg.name,
			version,
			releaseNames
		});
		artifacts.set(pkg.name, { ...inspected, path: tarballPath });
	}
	return artifacts;
}

async function publishArtifacts(orderedPackages, artifacts, registryStates, options) {
	const existing = new Set(
		registryStates.filter((state) => state.exists).map((state) => state.name)
	);
	const published = [];
	for (const pkg of orderedPackages) {
		if (existing.has(pkg.name)) {
			console.log(
				`- ${pkg.name}@${options.version}: already published with matching integrity`
			);
			continue;
		}
		const artifact = artifacts.get(pkg.name);
		console.log(`\nPublishing ${pkg.name}@${options.version}`);
		try {
			await run(
				'npm',
				[
					'publish',
					artifact.path,
					'--ignore-scripts',
					'--access',
					options.access,
					'--tag',
					options.tag,
					'--registry',
					options.registry
				],
				REPO_ROOT
			);
			published.push(pkg.name);
		} catch (error) {
			const completed = published.length ? published.join(', ') : '(none)';
			throw new Error(
				`${error instanceof Error ? error.message : error}\nPublished before failure: ${completed}. Fix the cause, keep the same source/version, and rerun with --publish --resume. Resume only skips matching tarballs.`
			);
		}
	}
}

async function release(options) {
	const discovered = await discoverReleasePackages();
	const releaseNames = new Set(discovered.map((pkg) => pkg.name));
	const packages = discovered.map((pkg) => ({
		...pkg,
		manifest: synchronizeManifest(pkg.manifest, options.version, releaseNames)
	}));
	validateSourceRelease(packages, options.version);
	await assertReleaseWorktree(discovered, options.version);

	await verifyNpmAuthentication(options.registry);
	const registryStates = [];
	for (const pkg of packages) {
		registryStates.push(await readRegistryState(pkg.name, options.version, options.registry));
	}
	assertRegistryAvailability(registryStates, options.resume);
	console.log(
		`Registry preflight complete: ${registryStates.filter((state) => !state.exists).length} versions available, ${registryStates.filter((state) => state.exists).length} resumable.`
	);

	let manifestsChanged = false;
	for (const pkg of packages) {
		if (
			JSON.stringify(pkg.manifest) ===
			JSON.stringify(discovered.find((item) => item.name === pkg.name).manifest)
		)
			continue;
		await writeFile(pkg.manifestPath, `${JSON.stringify(pkg.manifest, null, '\t')}\n`);
		manifestsChanged = true;
	}
	if (manifestsChanged) {
		console.log(`Synchronized public package versions to ${options.version}.`);
		await run('pnpm', ['install', '--lockfile-only', '--ignore-scripts'], REPO_ROOT);
	} else {
		console.log(`Public package versions are already synchronized at ${options.version}.`);
	}

	const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-npm-release-'));
	try {
		console.log('\nBuilding and running package install/import verification...');
		await run('pnpm', ['run', 'verify:package'], REPO_ROOT);
		const artifacts = await packAndValidate(packages, options.version, tempRoot);
		console.log(
			`Validated ${artifacts.size} release tarballs and their internal dependency metadata.`
		);
		if (options.resume) validateResumeArtifacts(registryStates, artifacts);

		const ordered = topologicallySortRelease(packages);
		console.log(`Publish order: ${ordered.map((pkg) => pkg.name).join(' -> ')}`);
		if (!options.publish) {
			console.log(
				'\nDry run complete. Nothing was published. Re-run with --publish to publish these versions.'
			);
			return;
		}
		await publishArtifacts(ordered, artifacts, registryStates, options);
		console.log(`\nPublished ${packages.length} package versions with tag ${options.tag}.`);
	} finally {
		await rm(tempRoot, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const options = parseReleaseArgs(process.argv.slice(2));
		if (options.help) console.log(usage());
		else await release(options);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
