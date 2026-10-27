import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
	assertRegistryAvailability,
	assertTargetVersion,
	discoverReleasePackages,
	parseReleaseArgs,
	synchronizeManifest,
	topologicallySortRelease,
	validatePackedManifest,
	validateResumeArtifacts,
	validateSourceRelease
} from './release-npm.mjs';
import { createRuntimeAssetLock, renderRuntimeAssetLock } from './generate-runtime-asset-lock.mjs';

describe('release package discovery', () => {
	it('includes every public package and validates their synchronized workspace references', async () => {
		const expectedNames = new Set(['wasm-idle']);
		const packagesURL = new URL('../packages/', import.meta.url);
		for (const entry of await readdir(packagesURL, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const manifest = JSON.parse(
				await readFile(new URL(`${entry.name}/package.json`, packagesURL), 'utf8')
			);
			if (manifest.private !== true) expectedNames.add(manifest.name);
		}

		const discovered = await discoverReleasePackages();
		const releaseNames = new Set(discovered.map((pkg) => pkg.name));
		assert.deepEqual(releaseNames, expectedNames);
		const packages = discovered.map((pkg) => ({
			...pkg,
			manifest: synchronizeManifest(pkg.manifest, '2.0.0', releaseNames)
		}));
		validateSourceRelease(packages, '2.0.0');
		const orderedNames = topologicallySortRelease(packages).map((pkg) => pkg.name);
		assert.ok(orderedNames.indexOf('@wasm-idle/core') < orderedNames.indexOf('@wasm-idle/gcc'));
		assert.ok(
			orderedNames.indexOf('@wasm-idle/core') < orderedNames.indexOf('@wasm-idle/container')
		);
		assert.ok(
			orderedNames.indexOf('@wasm-idle/llvm-core') <
				orderedNames.indexOf('@wasm-idle/container')
		);
		assert.ok(orderedNames.indexOf('@wasm-idle/container') < orderedNames.indexOf('wasm-idle'));
	});
});

describe('npm release arguments', () => {
	it('requires an explicit semver and defaults to a non-publishing run', () => {
		assert.deepEqual(parseReleaseArgs(['--', '--version', '1.0.0']), {
			publish: false,
			resume: false,
			tag: 'latest',
			access: 'public',
			registry: 'https://registry.npmjs.org/',
			help: false,
			version: '1.0.0',
			containerVersion: '',
			assetRoot: ''
		});
		assert.equal(assertTargetVersion('2.0.0-rc.1'), '2.0.0-rc.1');
		assert.throws(() => parseReleaseArgs([]), /explicit valid semver/u);
		assert.throws(() => parseReleaseArgs(['v1.0.0']), /explicit valid semver/u);
		assert.throws(() => parseReleaseArgs(['1.0.0', '--version', '1.0.1']), /more than once/u);
		assert.equal(parseReleaseArgs(['1.0.0', '--resume']).resume, true);
		assert.throws(() => parseReleaseArgs(['1.0.0', '--tag', '2.0.0']), /Invalid npm dist-tag/u);
		assert.throws(
			() => parseReleaseArgs(['2.0.0-rc.1']),
			/require an explicit non-latest --tag/u
		);
		assert.equal(parseReleaseArgs(['2.0.0-rc.1', '--tag', 'next']).tag, 'next');
		assert.equal(parseReleaseArgs(['2.0.0+build-test']).tag, 'latest');
	});

	it('accepts explicit publish settings', () => {
		const parsed = parseReleaseArgs([
			'--version',
			'1.2.3',
			'--publish',
			'--resume',
			'--tag',
			'next',
			'--access',
			'restricted',
			'--registry',
			'https://registry.example.test/npm'
		]);
		assert.equal(parsed.publish, true);
		assert.equal(parsed.resume, true);
		assert.equal(parsed.tag, 'next');
		assert.equal(parsed.access, 'restricted');
		assert.equal(parsed.registry, 'https://registry.example.test/npm/');
	});

	it('accepts independent container versions and explicit asset roots', () => {
		const options = parseReleaseArgs([
			'1.2.0',
			'--container-version',
			'0.2.0',
			'--asset-root',
			'asset snapshot'
		]);
		assert.equal(options.containerVersion, '0.2.0');
		assert.equal(options.assetRoot, path.resolve('asset snapshot'));
		assert.throws(
			() => parseReleaseArgs(['1.2.0', '--container-version', 'invalid']),
			/explicit valid semver/u
		);
		assert.throws(
			() => parseReleaseArgs(['1.2.0', '--container-version', '0.2.0-rc.1']),
			/non-latest --tag/u
		);
		assert.equal(
			parseReleaseArgs(['1.2.0', '--container-version', '0.2.0-rc.1', '--tag', 'next'])
				.containerVersion,
			'0.2.0-rc.1'
		);
	});
});

async function createReleaseFixture() {
	const fixture = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-release-cli-'));
	try {
		const packages = await discoverReleasePackages();
		const releaseNames = new Set(packages.map((pkg) => pkg.name));
		for (const pkg of packages) {
			const directory = path.join(fixture, pkg.relativeDir);
			await mkdir(directory, { recursive: true });
			await writeFile(
				path.join(directory, 'package.json'),
				JSON.stringify(synchronizeManifest(pkg.manifest, '1.9.0', releaseNames))
			);
		}
		await mkdir(path.join(fixture, 'scripts'));
		await copyFile(
			new URL('./release-npm.mjs', import.meta.url),
			path.join(fixture, 'scripts/release-npm.mjs')
		);
		await copyFile(
			new URL('./generate-runtime-asset-lock.mjs', import.meta.url),
			path.join(fixture, 'scripts/generate-runtime-asset-lock.mjs')
		);
		const assetRoot = path.join(fixture, 'asset snapshot');
		for (const root of [path.join(fixture, 'static'), assetRoot]) {
			await mkdir(path.join(root, 'wasm-fixture'), { recursive: true });
			await writeFile(path.join(root, 'wasm-fixture/runtime.wasm'), 'wasm fixture');
			await writeFile(
				path.join(root, 'wasm-fixture/loader.mjs'),
				'export default "fixture";'
			);
		}
		const assetLockPath = path.join(
			fixture,
			'packages/core/src/runtime-asset-lock.generated.ts'
		);
		await mkdir(path.dirname(assetLockPath), { recursive: true });
		await writeFile(
			assetLockPath,
			renderRuntimeAssetLock(
				await createRuntimeAssetLock({
					rootDir: assetRoot,
					packageFile: path.join(fixture, 'package.json')
				})
			)
		);
		await writeFile(
			path.join(fixture, '.gitignore'),
			'bin/\ncalls.jsonl\nstatic/\nasset snapshot/\n'
		);
		for (const args of [
			['init', '--quiet'],
			['add', '.'],
			[
				'-c',
				'user.name=Release Test',
				'-c',
				'user.email=release@example.invalid',
				'commit',
				'--quiet',
				'-m',
				'fixture'
			]
		])
			execFileSync('git', args, { cwd: fixture, stdio: 'pipe' });

		const bin = path.join(fixture, 'bin');
		await mkdir(bin);
		for (const command of ['npm', 'pnpm']) {
			await writeFile(
				path.join(bin, command),
				`#!${process.execPath}
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
const args = process.argv.slice(2);
const registryFile = process.env.RELEASE_TEST_REGISTRY;
const registry = registryFile && existsSync(registryFile) ? JSON.parse(readFileSync(registryFile, 'utf8')) : {};
appendFileSync(process.env.RELEASE_TEST_TRACE, JSON.stringify({ command: '${command}', args }) + '\\n');
if ('${command}' === 'pnpm') {
  if (args[0] === 'install') process.exit(0);
  if (process.env.RELEASE_TEST_PACK === '1') {
    if (args[0] === 'run') process.exit(0);
    if (args[0] !== '--dir' || !args.includes('pack')) throw new Error('Unexpected pack invocation');
    const manifest = JSON.parse(readFileSync(path.join(args[1], 'package.json'), 'utf8'));
    // pnpm 12 ignores npm_config_ignore_scripts during pack without explicit CLI config.
    if (manifest.scripts?.prepack && !args.includes('--config.ignore-scripts=true')) {
      writeFileSync(path.join(process.cwd(), 'prepack-ran'), 'verified output changed');
    }
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
      for (const [name, range] of Object.entries(manifest[section] ?? {})) {
        if (range !== 'workspace:*') continue;
        const dependencyFile = path.join(process.cwd(), 'packages', name.slice('@wasm-idle/'.length), 'package.json');
        manifest[section][name] = JSON.parse(readFileSync(dependencyFile, 'utf8')).version;
      }
    }
    const content = Buffer.from(JSON.stringify(manifest));
    const header = Buffer.alloc(512);
    header.write('package/package.json');
    header.write('0000644\\0', 100);
    header.write('0000000\\0', 108);
    header.write('0000000\\0', 116);
    header.write(content.length.toString(8).padStart(11, '0') + '\\0', 124);
    header.write('00000000000\\0', 136);
    header.fill(32, 148, 156);
    header.write('0', 156);
    header.write('ustar\\0', 257);
    header.write('00', 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\\0 ', 148);
    writeFileSync(args[args.indexOf('--out') + 1], gzipSync(Buffer.concat([
      header, content, Buffer.alloc((512 - content.length % 512) % 512), Buffer.alloc(1024)
    ])));
    process.exit(0);
  }
  console.error('release fixture reached package validation');
  process.exit(77);
}
if (args[0] === 'whoami') {
  if (process.env.RELEASE_TEST_AUTH === '1') { console.log('release-test'); process.exit(0); }
  console.error('E401 Unauthorized');
  process.exit(1);
}
if (args[0] === 'view') {
  if (registry[args[1]]) { console.log(JSON.stringify(registry[args[1]])); process.exit(0); }
  console.error('E404 Not Found');
  process.exit(1);
}
if (args[0] === 'publish' && process.env.RELEASE_TEST_AUTH === '1') {
  const bytes = readFileSync(args[1]);
  const archive = gunzipSync(bytes);
  const size = parseInt(archive.subarray(124, 136).toString('utf8'), 8);
  const manifest = JSON.parse(archive.subarray(512, 512 + size).toString('utf8'));
  if (manifest.name === process.env.RELEASE_TEST_FAIL_PACKAGE) {
    console.error('release fixture interrupted publishing');
    process.exit(1);
  }
  if (registryFile) {
    registry[manifest.name + '@' + manifest.version] = {
      integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
      shasum: createHash('sha1').update(bytes).digest('hex')
    };
    writeFileSync(registryFile, JSON.stringify(registry));
  }
  process.exit(0);
}
throw new Error('Unexpected fixture invocation');
`,
				{ mode: 0o700 }
			);
		}
		const trace = path.join(fixture, 'calls.jsonl');
		const invoke = (flags, env = {}) =>
			spawnSync(
				process.execPath,
				['scripts/release-npm.mjs', '--version', '2.0.0', ...flags],
				{
					cwd: fixture,
					encoding: 'utf8',
					// A full release starts dozens of CLI processes, including on slower CI hosts.
					timeout: 60_000,
					env: {
						...process.env,
						PATH: `${bin}${path.delimiter}${process.env.PATH}`,
						RELEASE_TEST_TRACE: trace,
						...env
					}
				}
			);
		return { fixture, trace, invoke, packages, bin, assetRoot, assetLockPath };
	} catch (error) {
		await rm(fixture, { recursive: true, force: true });
		throw error;
	}
}

describe('release CLI', () => {
	it('allows unauthenticated preparation but blocks publishing before building', async () => {
		const { fixture, trace, invoke, packages } = await createReleaseFixture();
		try {
			const dryRun = invoke([]);
			assert.equal(dryRun.status, 1);
			assert.match(dryRun.stderr, /release fixture reached package validation/u);
			const calls = (await readFile(trace, 'utf8'))
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line));
			assert.equal(calls.filter((call) => call.args[0] === 'whoami').length, 0);
			assert.equal(calls.filter((call) => call.args[0] === 'view').length, packages.length);
			assert.deepEqual(calls.at(-1), { command: 'pnpm', args: ['run', 'verify:package'] });

			await writeFile(trace, '');
			const publish = invoke(['--publish']);
			assert.equal(publish.status, 1);
			assert.match(publish.stderr, /npm authentication failed/u);
			assert.deepEqual(
				(await readFile(trace, 'utf8'))
					.trim()
					.split('\n')
					.map((line) => JSON.parse(line)),
				[{ command: 'npm', args: ['whoami', '--registry', 'https://registry.npmjs.org/'] }]
			);
		} finally {
			await rm(fixture, { recursive: true, force: true });
		}
	});

	it('bumps versions, then publishes the prepared mixed-version plan with its asset root', async () => {
		const { fixture, trace, invoke, packages, assetRoot, assetLockPath } =
			await createReleaseFixture();
		try {
			assert.match(
				await readFile(assetLockPath, 'utf8'),
				/WASM_IDLE_ASSET_VERSION: string = '1\.9\.0'/u
			);
			await rm(path.join(fixture, 'static'), { recursive: true });
			const flags = ['--container-version', '0.2.0', '--asset-root', assetRoot];
			const dryRun = invoke(flags, { RELEASE_TEST_PACK: '1' });
			assert.equal(dryRun.status, 0, dryRun.stderr);
			assert.match(dryRun.stdout, /Validated 12 release tarballs/u);
			assert.match(dryRun.stdout, /Dry run complete/u);
			await assert.rejects(
				readFile(path.join(fixture, 'prepack-ran')),
				{ code: 'ENOENT' },
				'packing must preserve verified output without invoking prepack'
			);
			const calls = (await readFile(trace, 'utf8'))
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line));
			assert.match(dryRun.stdout, /Generated runtime asset lock 2\.0\.0: 2 receipts/u);
			assert.match(
				await readFile(assetLockPath, 'utf8'),
				/WASM_IDLE_ASSET_VERSION: string = '2\.0\.0'/u
			);
			assert.ok(
				calls.some(
					(call) =>
						call.args[0] === 'view' && call.args[1] === '@wasm-idle/container@0.2.0'
				)
			);
			assert.ok(!calls.some((call) => call.args[0] === 'publish'));
			const packedNames = calls
				.filter((call) => call.command === 'pnpm' && call.args.includes('pack'))
				.map((call) => path.basename(call.args.at(-1)));
			assert.equal(packedNames.length, packages.length);
			assert.ok(packedNames.includes('wasm-idle-container-0.2.0.tgz'));
			assert.ok(packedNames.includes('wasm-idle-core-2.0.0.tgz'));
			assert.ok(packedNames.includes('wasm-idle-2.0.0.tgz'));
			const rootManifest = JSON.parse(
				await readFile(path.join(fixture, 'package.json'), 'utf8')
			);
			assert.equal(rootManifest.peerDependencies['@wasm-idle/container'], '0.2.0');

			await writeFile(trace, '');
			const publish = invoke([...flags, '--publish'], {
				RELEASE_TEST_PACK: '1',
				RELEASE_TEST_AUTH: '1'
			});
			assert.equal(publish.status, 0, publish.stderr);
			assert.match(publish.stdout, /Publishing @wasm-idle\/container@0\.2\.0/u);
			const publishCalls = (await readFile(trace, 'utf8'))
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line));
			assert.equal(publishCalls[0].args[0], 'whoami');
			const publishedNames = publishCalls
				.filter((call) => call.args[0] === 'publish')
				.map((call) => path.basename(call.args[1]));
			assert.equal(publishedNames.length, packages.length);
			assert.ok(
				publishedNames.indexOf('wasm-idle-core-2.0.0.tgz') <
					publishedNames.indexOf('wasm-idle-container-0.2.0.tgz')
			);
			assert.equal(publishedNames.at(-1), 'wasm-idle-2.0.0.tgz');
		} finally {
			await rm(fixture, { recursive: true, force: true });
		}
	});

	it('refuses empty or partial asset trees without replacing the existing lock', async () => {
		const { fixture, invoke, assetRoot, assetLockPath, bin } = await createReleaseFixture();
		try {
			const originalLock = await readFile(assetLockPath, 'utf8');
			const empty = invoke(['--asset-root', bin], { RELEASE_TEST_PACK: '1' });
			assert.equal(empty.status, 1);
			assert.match(
				empty.stderr,
				/Runtime asset root is incomplete: 2 existing receipt paths/u
			);
			assert.equal(await readFile(assetLockPath, 'utf8'), originalLock);

			await rm(path.join(assetRoot, 'wasm-fixture/runtime.wasm'));
			const partial = invoke(['--asset-root', assetRoot], { RELEASE_TEST_PACK: '1' });
			assert.equal(partial.status, 1);
			assert.match(
				partial.stderr,
				/Runtime asset root is incomplete: 1 existing receipt paths/u
			);
			assert.equal(await readFile(assetLockPath, 'utf8'), originalLock);

			await rm(path.join(fixture, 'static/wasm-fixture'), { recursive: true });
			const sparseDefault = invoke([], { RELEASE_TEST_PACK: '1' });
			assert.equal(sparseDefault.status, 1);
			assert.match(
				sparseDefault.stderr,
				/Runtime asset root is incomplete: 2 existing receipt paths/u
			);
			assert.equal(await readFile(assetLockPath, 'utf8'), originalLock);

			await writeFile(
				path.join(assetRoot, 'wasm-fixture/runtime.wasm'),
				'updated runtime bytes'
			);
			const complete = invoke(['--asset-root', assetRoot], { RELEASE_TEST_PACK: '1' });
			assert.equal(complete.status, 0, complete.stderr);
			assert.notEqual(await readFile(assetLockPath, 'utf8'), originalLock);
			assert.equal(
				await readFile(path.join(assetRoot, 'wasm-fixture/runtime.wasm'), 'utf8'),
				'updated runtime bytes'
			);
		} finally {
			await rm(fixture, { recursive: true, force: true });
		}
	});

	it('resumes a partial publish after advancing the runtime asset lock version', async () => {
		const { fixture, trace, invoke, packages, bin, assetLockPath } =
			await createReleaseFixture();
		try {
			const registryFile = path.join(bin, 'registry.json');
			const environment = {
				RELEASE_TEST_PACK: '1',
				RELEASE_TEST_AUTH: '1',
				RELEASE_TEST_REGISTRY: registryFile
			};
			const interrupted = invoke(['--publish'], {
				...environment,
				RELEASE_TEST_FAIL_PACKAGE: '@wasm-idle/container'
			});
			assert.equal(interrupted.status, 1);
			assert.match(interrupted.stderr, /release fixture interrupted publishing/u);
			const publishedBefore = Object.keys(JSON.parse(await readFile(registryFile, 'utf8')));
			assert.ok(publishedBefore.length > 0 && publishedBefore.length < packages.length);
			const preparedLock = await readFile(assetLockPath, 'utf8');
			assert.match(preparedLock, /WASM_IDLE_ASSET_VERSION: string = '2\.0\.0'/u);

			await writeFile(trace, '');
			const resumed = invoke(['--publish', '--resume'], environment);
			assert.equal(resumed.status, 0, resumed.stderr);
			assert.match(resumed.stdout, /already published with matching integrity/u);
			assert.equal(await readFile(assetLockPath, 'utf8'), preparedLock);
			assert.equal(
				Object.keys(JSON.parse(await readFile(registryFile, 'utf8'))).length,
				packages.length
			);
			const publishCalls = (await readFile(trace, 'utf8'))
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line))
				.filter((call) => call.args[0] === 'publish');
			assert.equal(publishCalls.length, packages.length - publishedBefore.length);
		} finally {
			await rm(fixture, { recursive: true, force: true });
		}
	});

	it('rejects tampered generated locks and unrelated source changes before npm calls', async () => {
		const { fixture, trace, invoke, assetLockPath, bin } = await createReleaseFixture();
		try {
			const prepared = invoke([], { RELEASE_TEST_PACK: '1' });
			assert.equal(prepared.status, 0, prepared.stderr);
			const generated = await readFile(assetLockPath, 'utf8');
			for (const tampered of [
				`${generated}\nexport const unrelated = true;\n`,
				generated.replace("'2.0.0'", "'2.1.0'"),
				generated.replace(/"sha256":"[a-f0-9]{64}"/u, `"sha256":"${'0'.repeat(64)}"`)
			]) {
				assert.notEqual(tampered, generated);
				await writeFile(assetLockPath, tampered);
				await writeFile(trace, '');
				const rejected = invoke(['--publish'], { RELEASE_TEST_AUTH: '1' });
				assert.equal(rejected.status, 1);
				assert.match(rejected.stderr, /changes beyond the generated 2\.0\.0 release lock/u);
				assert.equal(await readFile(trace, 'utf8'), '');
				assert.equal(await readFile(assetLockPath, 'utf8'), tampered);
			}
			await writeFile(assetLockPath, generated);
			await writeFile(
				path.join(fixture, 'unrelated-source.ts'),
				'export const unrelated = true;\n'
			);
			const unrelated = invoke(['--publish'], { RELEASE_TEST_AUTH: '1' });
			assert.equal(unrelated.status, 1);
			assert.match(unrelated.stderr, /clean source worktree[\s\S]*unrelated-source\.ts/u);
			assert.equal(await readFile(trace, 'utf8'), '');
			await rm(path.join(fixture, 'unrelated-source.ts'));

			const linkedLock = path.join(bin, 'generated-lock.ts');
			await writeFile(linkedLock, generated);
			await rm(assetLockPath);
			await symlink(linkedLock, assetLockPath);
			const linked = invoke(['--publish'], { RELEASE_TEST_AUTH: '1' });
			assert.equal(linked.status, 1);
			assert.match(linked.stderr, /runtime asset lock must be a regular file/u);
			assert.equal(await readFile(trace, 'utf8'), '');
		} finally {
			await rm(fixture, { recursive: true, force: true });
		}
	});

	it('requires the same asset bytes and preserves the committed receipt inventory on re-entry', async () => {
		const { fixture, trace, invoke, assetRoot, assetLockPath } = await createReleaseFixture();
		try {
			await writeFile(
				path.join(assetRoot, 'wasm-fixture/runtime.wasm'),
				'new release runtime'
			);
			const prepared = invoke(['--asset-root', assetRoot], { RELEASE_TEST_PACK: '1' });
			assert.equal(prepared.status, 0, prepared.stderr);
			const generated = await readFile(assetLockPath, 'utf8');
			await writeFile(trace, '');
			const otherAssets = invoke(['--publish'], { RELEASE_TEST_AUTH: '1' });
			assert.equal(otherAssets.status, 1);
			assert.match(otherAssets.stderr, /changes beyond the generated 2\.0\.0 release lock/u);
			assert.equal(await readFile(assetLockPath, 'utf8'), generated);
			assert.equal(await readFile(trace, 'utf8'), '');

			await rm(path.join(assetRoot, 'wasm-fixture/runtime.wasm'));
			const incomplete = renderRuntimeAssetLock(
				await createRuntimeAssetLock({
					rootDir: assetRoot,
					packageFile: path.join(fixture, 'package.json')
				})
			);
			await writeFile(assetLockPath, incomplete);
			const missing = invoke(['--publish', '--asset-root', assetRoot], {
				RELEASE_TEST_AUTH: '1'
			});
			assert.equal(missing.status, 1);
			assert.match(
				missing.stderr,
				/Runtime asset root is incomplete: 1 existing receipt paths/u
			);
			assert.equal(await readFile(assetLockPath, 'utf8'), incomplete);
			assert.equal(await readFile(trace, 'utf8'), '');
		} finally {
			await rm(fixture, { recursive: true, force: true });
		}
	});
});

describe('release manifest synchronization', () => {
	it('validates exact dependency versions across independently versioned packages', async () => {
		const discovered = await discoverReleasePackages();
		const releaseNames = new Set(discovered.map((pkg) => pkg.name));
		const targetVersions = new Map(
			discovered.map((pkg) => [
				pkg.name,
				pkg.name === '@wasm-idle/container' ? '0.2.0' : '1.2.0'
			])
		);
		const packages = discovered.map((pkg) => ({
			...pkg,
			manifest: synchronizeManifest(pkg.manifest, '1.2.0', releaseNames, targetVersions)
		}));
		validateSourceRelease(packages, '1.2.0', targetVersions);
		const container = packages.find((pkg) => pkg.name === '@wasm-idle/container');
		assert.equal(container.manifest.version, '0.2.0');
		assert.equal(container.manifest.dependencies['@wasm-idle/core'], 'workspace:*');
		for (const pkg of packages) {
			const packedManifest = structuredClone(pkg.manifest);
			for (const section of [
				'dependencies',
				'optionalDependencies',
				'peerDependencies',
				'devDependencies'
			]) {
				for (const [name, range] of Object.entries(packedManifest[section] ?? {})) {
					if (range === 'workspace:*')
						packedManifest[section][name] = targetVersions.get(name);
				}
			}
			validatePackedManifest(packedManifest, {
				name: pkg.name,
				version: pkg.manifest.version,
				releaseNames,
				targetVersions
			});
			if (pkg.name === '@wasm-idle/container') {
				packedManifest.dependencies['@wasm-idle/core'] = '0.2.0';
				assert.throws(
					() =>
						validatePackedManifest(packedManifest, {
							name: pkg.name,
							version: '0.2.0',
							releaseNames,
							targetVersions
						}),
					/expected exact 1\.2\.0/u
				);
			}
		}
		const root = packages.find((pkg) => pkg.name === 'wasm-idle');
		root.manifest.peerDependencies['@wasm-idle/container'] = '1.2.0';
		assert.throws(
			() => validateSourceRelease(packages, '1.2.0', targetVersions),
			/must be 0\.2\.0/u
		);
		root.manifest.peerDependencies['@wasm-idle/container'] = '^0.2.0';
		assert.throws(
			() => validateSourceRelease(packages, '1.2.0', targetVersions),
			/must be 0\.2\.0/u
		);
	});

	it('aligns versions and exact peers while retaining workspace:* links', () => {
		const releaseNames = new Set(['@wasm-idle/core', '@wasm-idle/lsp']);
		const original = {
			name: '@wasm-idle/lsp',
			version: '1.0.0',
			dependencies: {
				'@wasm-idle/core': 'workspace:*',
				fflate: '0.8.3'
			},
			peerDependencies: {
				'@wasm-idle/core': '^1.0.0',
				typescript: '^6.0.0'
			},
			devDependencies: {
				'@wasm-idle/core': 'workspace:*'
			}
		};
		const updated = synchronizeManifest(original, '2.0.0', releaseNames);

		assert.equal(updated.version, '2.0.0');
		assert.equal(updated.dependencies['@wasm-idle/core'], 'workspace:*');
		assert.equal(updated.peerDependencies['@wasm-idle/core'], '2.0.0');
		assert.equal(updated.devDependencies['@wasm-idle/core'], 'workspace:*');
		assert.equal(updated.dependencies.fflate, '0.8.3');
		assert.equal(updated.peerDependencies.typescript, '^6.0.0');
		assert.equal(original.version, '1.0.0');
		assert.equal(original.peerDependencies['@wasm-idle/core'], '^1.0.0');

		validateSourceRelease(
			[
				{
					name: '@wasm-idle/core',
					manifest: { name: '@wasm-idle/core', version: '2.0.0' }
				},
				{ name: '@wasm-idle/lsp', manifest: updated }
			],
			'2.0.0'
		);
	});

	it('rejects unpublished internal packages and non-exact internal peers', () => {
		assert.throws(
			() =>
				validateSourceRelease(
					[
						{
							name: '@wasm-idle/lsp',
							manifest: {
								name: '@wasm-idle/lsp',
								version: '2.0.0',
								dependencies: { '@wasm-idle/missing': 'workspace:*' }
							}
						}
					],
					'2.0.0'
				),
			/unpublished @wasm-idle\/missing/u
		);
		assert.throws(
			() =>
				validateSourceRelease(
					[
						{
							name: '@wasm-idle/core',
							manifest: { name: '@wasm-idle/core', version: '2.0.0' }
						},
						{
							name: '@wasm-idle/debug',
							manifest: {
								name: '@wasm-idle/debug',
								version: '2.0.0',
								peerDependencies: { '@wasm-idle/core': '^2.0.0' }
							}
						}
					],
					'2.0.0'
				),
			/must be 2\.0\.0/u
		);
	});
});

describe('release ordering and packed metadata', () => {
	it('orders core and llvm-core before dependents and leaves the root package last', () => {
		const packages = [
			{
				name: 'wasm-idle',
				manifest: {
					dependencies: {
						'@wasm-idle/core': 'workspace:*',
						'@wasm-idle/llvm-core': 'workspace:*'
					}
				}
			},
			{
				name: '@wasm-idle/lsp',
				manifest: {
					dependencies: {
						'@wasm-idle/core': 'workspace:*',
						'@wasm-idle/llvm-core': 'workspace:*'
					}
				}
			},
			{
				name: '@wasm-idle/debug',
				manifest: { peerDependencies: { '@wasm-idle/core': '2.0.0' } }
			},
			{ name: '@wasm-idle/llvm-core', manifest: {} },
			{ name: '@wasm-idle/core', manifest: {} }
		];

		assert.deepEqual(
			topologicallySortRelease(packages).map((pkg) => pkg.name),
			[
				'@wasm-idle/core',
				'@wasm-idle/llvm-core',
				'@wasm-idle/debug',
				'@wasm-idle/lsp',
				'wasm-idle'
			]
		);
	});

	it('requires exact internal versions in the packed package manifest', () => {
		const expected = {
			name: '@wasm-idle/lsp',
			version: '2.0.0',
			releaseNames: new Set(['@wasm-idle/core', '@wasm-idle/lsp'])
		};
		validatePackedManifest(
			{
				name: '@wasm-idle/lsp',
				version: '2.0.0',
				dependencies: { '@wasm-idle/core': '2.0.0' }
			},
			expected
		);
		assert.throws(
			() =>
				validatePackedManifest(
					{
						name: '@wasm-idle/lsp',
						version: '2.0.0',
						dependencies: { '@wasm-idle/core': 'workspace:*' }
					},
					expected
				),
			/expected exact 2\.0\.0/u
		);
	});
});

describe('partial publish recovery', () => {
	it('requires explicit resume and only accepts byte-identical existing tarballs', () => {
		const states = [
			{
				name: '@wasm-idle/core',
				exists: true,
				integrity: 'sha512-matching',
				shasum: 'abc123'
			},
			{ name: '@wasm-idle/lsp', exists: false }
		];
		assert.throws(() => assertRegistryAvailability(states, false), /already exists/u);
		assert.doesNotThrow(() => assertRegistryAvailability(states, true));
		assert.doesNotThrow(() =>
			validateResumeArtifacts(
				states,
				new Map([['@wasm-idle/core', { integrity: 'sha512-matching', shasum: 'ABC123' }]])
			)
		);
		assert.throws(
			() =>
				validateResumeArtifacts(
					states,
					new Map([
						['@wasm-idle/core', { integrity: 'sha512-different', shasum: 'abc123' }]
					])
				),
			/does not match/u
		);
	});
});
