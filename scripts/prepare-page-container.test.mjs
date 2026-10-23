import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	mkdtemp,
	mkdir,
	readFile,
	realpath,
	rename,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transform } from 'esbuild';
import { selectPageContainerSource } from './lib/page-container-source.mjs';
import { prepareWebsiteAssetDelivery, websiteReleaseModule } from './prepare-page-container.mjs';

const packageTemplate = JSON.parse(
	await readFile(new URL('../packages/container/package.json', import.meta.url), 'utf8')
);

test('sysroot archives retain pinned bytes when using a portable delivery MIME', () => {
	const receipt = {
		bytes: 35328000,
		sha256: 'b5c51389ce2f2b404f8b354788aa4a19a65d7e4af746cf52d24e7276d2eabf7f',
		mediaType: 'application/x-tar'
	};
	const asset = {
		id: 'sysroot',
		encoding: 'identity',
		url: 'https://old.invalid/sysroot.tar',
		delivery: receipt,
		logical: receipt
	};
	const prepared = prepareWebsiteAssetDelivery(
		asset,
		'https://example.com/wasm-idle/container-app/'
	);
	assert.equal(
		prepared.url,
		`https://example.com/wasm-idle/container-app/objects/${receipt.sha256}/sysroot.tar.bin`
	);
	assert.deepEqual(prepared.delivery, { ...receipt, mediaType: 'application/octet-stream' });
	assert.deepEqual(prepared.logical, prepared.delivery);
	assert.equal(asset.delivery.mediaType, 'application/x-tar');
});

for (const capability of [true, false, undefined]) {
	test(`generated page configuration preserves the pinned Worker module-service capability: ${capability}`, async (t) => {
		const root = await mkdtemp(join(tmpdir(), 'page-container-capability-'));
		t.after(() => rm(root, { recursive: true, force: true }));
		const application = pathToFileURL(root + '/');
		const location = Object.getOwnPropertyDescriptor(globalThis, 'location');
		Object.defineProperty(globalThis, 'location', {
			configurable: true,
			value: { href: application.href, origin: application.origin }
		});
		t.after(() => {
			if (location) Object.defineProperty(globalThis, 'location', location);
			else delete globalThis.location;
		});
		const hostHash = 'a'.repeat(64);
		const sdkDirectory = join(root, 'container-app/host', hostHash, 'sdk');
		await mkdir(sdkDirectory, { recursive: true });
		await writeFile(join(sdkDirectory, 'index.mjs'), 'export const pinned = true;\n');
		const { code } = await transform(
			websiteReleaseModule({
				baseURL: 'https://old.invalid/container-app/',
				hostHash,
				distribution: { packages: [] },
				config: {
					clangFilesystem: 'live',
					...(capability === undefined ? {} : { clangModuleServices: capability })
				}
			}),
			{ loader: 'ts', format: 'esm' }
		);
		const module = await import(
			`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
		);
		const { config, sdk } = await module.createWebsiteBashConfiguration(application.href);
		assert.equal(config.clangModuleServices, capability);
		assert.equal(Object.hasOwn(config, 'clangModuleServices'), capability !== undefined);
		assert.equal(
			config.clangWorkerUrl,
			new URL(`container-app/host/${hostHash}/clang-worker.mjs`, application).href
		);
		assert.equal(sdk.pinned, true);
	});
}

test('prepared sysroot layers use portable gzip delivery with separate logical receipts', () => {
	const asset = {
		id: 'sysroot-c',
		url: 'https://old.invalid/base.tar.gz',
		encoding: 'gzip',
		delivery: { bytes: 123, sha256: 'a'.repeat(64), mediaType: 'application/octet-stream' },
		logical: { bytes: 456, sha256: 'b'.repeat(64), mediaType: 'application/x-tar' }
	};
	const prepared = prepareWebsiteAssetDelivery(asset, 'https://example.com/container-app/');
	assert.equal(
		prepared.url,
		`https://example.com/container-app/objects/${asset.delivery.sha256}/sysroot-c.tar.gz.bin`
	);
	assert.equal(prepared.encoding, 'gzip');
	assert.deepEqual(prepared.delivery, asset.delivery);
	assert.deepEqual(prepared.logical, { ...asset.logical, mediaType: 'application/octet-stream' });
});

async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), 'page-container-source-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const workspaceRoot = join(root, 'workspace');
	const workspacePackage = join(workspaceRoot, 'packages/container');
	const publishedPackage = join(root, 'published/container');
	for (const [packageRoot, version] of [
		[workspacePackage, '0.1.0-alpha.0'],
		[publishedPackage, '0.1.0']
	]) {
		await mkdir(packageRoot, { recursive: true });
		await writeFile(
			join(packageRoot, 'package.json'),
			JSON.stringify({ ...packageTemplate, version })
		);
		for (const entry of Object.values(packageTemplate.exports)) {
			const path = join(packageRoot, entry.import);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, `export const version = '${version}';\n`);
		}
		for (const name of ['wasi-live', 'clang-live'])
			await writeFile(join(packageRoot, `dist/adapters/${name}/worker.js`), 'export {};\n');
	}
	return {
		root,
		workspaceRoot,
		workspacePackage,
		workspaceEntry: join(workspacePackage, 'dist/index.js'),
		publishedPackage,
		publishedEntry: join(publishedPackage, 'dist/index.js')
	};
}

test('explicit workspace selection ignores an older installed SDK and records the actual build identity', async (t) => {
	const paths = await fixture(t);
	const selected = await selectPageContainerSource({
		workspaceRoot: paths.workspaceRoot,
		source: 'workspace',
		resolvedEntry: paths.publishedEntry,
		requiresMetadata: true
	});
	assert.equal(selected.packageRoot, paths.workspacePackage);
	assert.equal(selected.aliases['@wasm-idle/container'], paths.workspaceEntry);
	assert.equal(selected.identity.version, '0.1.0-alpha.0');
	assert.equal(selected.identity.source, 'workspace');
	assert.equal(selected.identity.profile, 'virtual-metadata-v1');
	assert.equal(selected.clangModuleServices, true);
	assert.equal(
		selected.identity.packageJsonSha256,
		createHash('sha256')
			.update(await readFile(join(paths.workspacePackage, 'package.json')))
			.digest('hex')
	);
	assert.equal(
		selected.identity.files['dist/adapters/wasi-live/worker.js'],
		createHash('sha256').update('export {};\n').digest('hex')
	);
	await writeFile(selected.entryPoints['live-worker'], 'export const changed = true;\n');
	const changed = await selectPageContainerSource({
		workspaceRoot: paths.workspaceRoot,
		source: 'workspace'
	});
	assert.notEqual(
		changed.identity.files['dist/adapters/wasi-live/worker.js'],
		selected.identity.files['dist/adapters/wasi-live/worker.js']
	);
});

test('ordinary workspace resolution accepts a local dist build on another volume', async (t) => {
	const paths = await fixture(t);
	const buildDirectory = join(paths.root, 'external-build');
	await mkdir(buildDirectory);
	await rename(join(paths.workspacePackage, 'dist'), join(buildDirectory, 'dist'));
	await symlink(join(buildDirectory, 'dist'), join(paths.workspacePackage, 'dist'), 'dir');
	const selected = await selectPageContainerSource({
		workspaceRoot: paths.workspaceRoot,
		resolvedEntry: await realpath(paths.workspaceEntry),
		requiresMetadata: true
	});
	assert.equal(selected.packageRoot, paths.workspacePackage);
	assert.equal(selected.identity.source, 'workspace');
});

test('an old installed package cannot silently replace the workspace SDK', async (t) => {
	const paths = await fixture(t);
	await assert.rejects(
		selectPageContainerSource({
			workspaceRoot: paths.workspaceRoot,
			resolvedEntry: paths.publishedEntry
		}),
		/explicitly select published for legacy assets/
	);
});

test('legacy published 0.1.0 preparation remains an explicit option', async (t) => {
	const paths = await fixture(t);
	const selected = await selectPageContainerSource({
		workspaceRoot: paths.workspaceRoot,
		source: 'published',
		resolvedEntry: paths.publishedEntry
	});
	assert.equal(selected.packageRoot, paths.publishedPackage);
	assert.equal(selected.identity.source, 'published');
	assert.equal(selected.identity.version, '0.1.0');
	assert.equal(selected.identity.profile, 'published-0.1.0');
	assert.equal(selected.clangModuleServices, false);
	await assert.rejects(
		selectPageContainerSource({
			workspaceRoot: paths.workspaceRoot,
			source: 'published',
			resolvedEntry: paths.publishedEntry,
			requiresMetadata: true
		}),
		/metadata imports require the workspace Container SDK/
	);
	await assert.rejects(
		selectPageContainerSource({
			workspaceRoot: paths.workspaceRoot,
			source: 'published',
			resolvedEntry: paths.workspaceEntry
		}),
		/installed published Container package/
	);
});

test('the published compatibility path rejects unqualified versions', async (t) => {
	const paths = await fixture(t);
	await writeFile(
		join(paths.publishedPackage, 'package.json'),
		JSON.stringify({ ...packageTemplate, version: '0.2.0' })
	);
	await assert.rejects(
		selectPageContainerSource({
			workspaceRoot: paths.workspaceRoot,
			source: 'published',
			resolvedEntry: paths.publishedEntry
		}),
		/qualified legacy published SDK/
	);
});

test('source selection cannot redirect a trusted host export or supply an arbitrary path', async (t) => {
	const paths = await fixture(t);
	const modified = structuredClone(packageTemplate);
	modified.exports['./adapters/wasi-live'].import = '../../untrusted.js';
	await writeFile(join(paths.workspacePackage, 'package.json'), JSON.stringify(modified));
	await assert.rejects(
		selectPageContainerSource({ workspaceRoot: paths.workspaceRoot, source: 'workspace' }),
		/Fixed trusted Container export required/
	);
	await assert.rejects(
		selectPageContainerSource({
			workspaceRoot: paths.workspaceRoot,
			source: paths.publishedPackage
		}),
		/containerSource must be workspace or published/
	);
});

test('workspace preparation requires the built worker closure', async (t) => {
	const paths = await fixture(t);
	await rm(join(paths.workspacePackage, 'dist/adapters/wasi-live/worker.js'));
	await assert.rejects(
		selectPageContainerSource({ workspaceRoot: paths.workspaceRoot, source: 'workspace' }),
		{ code: 'ENOENT' }
	);
});
