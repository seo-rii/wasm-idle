import assert from 'node:assert/strict';
import { chmod, cp, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	createJdtlsAssetServer,
	createLaunchConfiguration,
	verifyJdtlsArchiveContents
} from './probe-java-jdtls-browser.mjs';

test('diagnostic launch profiles preserve upstream core and reject a changed bundle set', () => {
	const bundles = [
		'org.eclipse.jdt.ls.core',
		'org.eclipse.jdt.core',
		'org.eclipse.core.resources',
		'org.eclipse.buildship.core',
		'org.eclipse.buildship.compat',
		'org.gradle.toolingapi'
	];
	const configuration = `eclipse.application=original\nosgi.bundles=${bundles.map((name) => `reference\\:file\\:${name}_1.jar@4`).join(',')}\nosgi.framework=original\n`;
	const defaults = createLaunchConfiguration(configuration, 'upstream-defaults');
	assert.equal(defaults.configuration, configuration);
	assert.equal(
		defaults.receipt.originalConfigurationSha256,
		defaults.receipt.launchConfigurationSha256
	);
	const reduced = createLaunchConfiguration(configuration, 'without-gradle');
	for (const core of bundles.slice(0, 3))
		assert.ok(reduced.configuration.includes(`${core}_1.jar`));
	for (const omitted of bundles.slice(3))
		assert.ok(!reduced.configuration.includes(`${omitted}_1.jar`));
	assert.match(reduced.configuration, /eclipse.application=original/);
	assert.match(reduced.configuration, /osgi.framework=original/);
	assert.throws(
		() => createLaunchConfiguration('eclipse.application=original\n', 'without-gradle'),
		/does not match/
	);
	assert.throws(
		() =>
			createLaunchConfiguration(
				configuration.replace('org.gradle.toolingapi', 'unexpected.gradle'),
				'without-gradle'
			),
		/does not match/
	);
});

test('PAX asset cache verification compares upstream bytes independently of local permissions', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'java-jdtls-cache-'));
	try {
		const original = path.join(directory, 'original');
		await mkdir(path.join(original, 'plugins'), { recursive: true });
		await writeFile(path.join(original, 'plugins/sample.jar'), 'original');
		const archive = path.join(directory, 'original.tar.gz');
		const packed = spawnSync('tar', [
			'--create',
			'--gzip',
			'--format=pax',
			'--file',
			archive,
			'-C',
			original,
			'.'
		]);
		assert.equal(packed.status, 0);
		const cache = path.join(directory, 'cache');
		await cp(original, cache, { recursive: true });
		await chmod(path.join(cache, 'plugins'), 0o700);
		await chmod(path.join(cache, 'plugins/sample.jar'), 0o600);
		verifyJdtlsArchiveContents(archive, cache);
		await writeFile(path.join(cache, 'plugins/sample.jar'), 'modified');
		assert.throws(() => verifyJdtlsArchiveContents(archive, cache), /Cached bytes differ/);
		await rm(path.join(cache, 'plugins/sample.jar'));
		await symlink(
			path.join(original, 'plugins/sample.jar'),
			path.join(cache, 'plugins/sample.jar')
		);
		assert.throws(() => verifyJdtlsArchiveContents(archive, cache), /Unsafe cache path/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('CheerpJ HTTP filesystem preserves directories, listings and bounded ranges', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'java-jdtls-http-'));
	const serverRoot = path.join(directory, 'server');
	await mkdir(path.join(serverRoot, 'plugins'), { recursive: true });
	await writeFile(path.join(serverRoot, 'plugins', 'sample.jar'), '0123456789');
	await writeFile(path.join(serverRoot, 'plugins', 'empty.jar'), '');
	await writeFile(path.join(directory, 'browser-streams.jar'), 'bridge');
	const server = createJdtlsAssetServer({ directory, server: serverRoot });
	try {
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		const base = `http://127.0.0.1:${server.address().port}`;
		const directoryResponse = await fetch(`${base}/server/plugins`, { redirect: 'manual' });
		assert.equal(directoryResponse.status, 301);
		assert.equal(directoryResponse.headers.get('location'), '/server/plugins/');
		const followed = await fetch(`${base}/server/plugins`);
		assert.equal(followed.url, `${base}/server/plugins/`);
		assert.equal(followed.status, 200);
		assert.equal(followed.headers.get('cross-origin-embedder-policy'), 'require-corp');
		assert.equal(
			await (await fetch(`${base}/server/plugins/index.list`)).text(),
			'empty.jar\nsample.jar\n'
		);
		for (const [range, expected, contentRange] of [
			['bytes=0-32767', '0123456789', 'bytes 0-9/10'],
			['bytes=4-6', '456', 'bytes 4-6/10'],
			['bytes=7-', '789', 'bytes 7-9/10'],
			['bytes=-2', '89', 'bytes 8-9/10']
		]) {
			const response = await fetch(`${base}/server/plugins/sample.jar`, {
				headers: { Range: range }
			});
			assert.equal(response.status, 206, range);
			assert.equal(response.headers.get('content-range'), contentRange);
			assert.equal(await response.text(), expected);
		}
		const head = await fetch(`${base}/server/plugins/sample.jar`, {
			method: 'HEAD',
			headers: { Range: 'bytes=0-32767' }
		});
		assert.equal(head.status, 206);
		assert.equal(head.headers.get('content-length'), '10');
		assert.equal(await head.text(), '');
		for (const url of ['sample.jar', 'empty.jar']) {
			const response = await fetch(`${base}/server/plugins/${url}`, {
				headers: { Range: 'bytes=10-20' }
			});
			assert.equal(response.status, 416);
		}
		assert.equal((await fetch(`${base}/server/%2e%2e%2f%2e%2e%2foutside`)).status, 404);
		assert.equal(await (await fetch(`${base}/browser-streams.jar`)).text(), 'bridge');
	} finally {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
		await rm(directory, { recursive: true, force: true });
	}
});
