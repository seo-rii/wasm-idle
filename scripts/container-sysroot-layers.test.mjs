import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { extractTarPackage, validateDistribution } from '@wasm-idle/container';
import { preparePageContainer } from './prepare-page-container.mjs';
import { prepareContainerSysrootLayers } from './lib/container-sysroot-layers.mjs';
import { composeSysrootLayers } from '../examples/container/sysroot-layers.mjs';
import { createBashProfile, BASH_SYSROOT, C_SYSROOT } from '../examples/container/bash-profile.mjs';

const identity = (bytes) => ({
	bytes: bytes.length,
	sha256: createHash('sha256').update(bytes).digest('hex')
});
const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const files = [
	['include', null, 0o751],
	['include/c++', null, 0o750],
	['include/c++/v1', null, 0o755],
	['include/stdio.h', '#define STDIO 1\n', 0o644],
	['include/c++-compat.h', '#define COMPAT 1\n', 0o640],
	['include/c++/v1/vector', 'a vector header with C++ only templates\n'.repeat(100), 0o600],
	[`include/c++/v1/${'long'.repeat(23)}.h`, 'long header\n', 0o604],
	['lib', null, 0o755],
	['lib/wasm32-wasi', null, 0o750],
	['lib/wasm32-wasi/libc.a', 'C library contents\n', 0o600],
	['lib/wasm32-wasi/libc++.a', 'C++ archive contents\n'.repeat(200), 0o640],
	['lib/wasm32-wasi/libc++abi.a', 'C++ ABI archive\n'.repeat(100), 0o600],
	['lib/wasm32-wasi/libc++unknown.a', 'unreviewed archive stays in the base\n', 0o644],
	['lib/clang/22/include/stddef.h', '#define SIZE 1\n', 0o644]
];

function tar(entries) {
	const records = entries.map(([path, contents, mode]) => {
		const header = Buffer.alloc(512),
			data = Buffer.from(contents ?? '');
		const put = (offset, length, value) => {
			assert(Buffer.byteLength(value) <= length);
			header.write(value, offset, length);
		};
		if (Buffer.byteLength(path) > 100) {
			const slash = path.lastIndexOf('/');
			put(0, 100, path.slice(slash + 1));
			put(345, 155, path.slice(0, slash));
		} else put(0, 100, path);
		for (const [offset, length, value] of [
			[100, 8, mode],
			[108, 8, 77],
			[116, 8, 88],
			[124, 12, data.length],
			[136, 12, 123456]
		])
			put(offset, length, value.toString(8).padStart(length - 1, '0') + '\0');
		header.fill(32, 148, 156);
		header[156] = contents === null ? 53 : 48;
		put(257, 6, 'ustar\0');
		put(263, 2, '00');
		put(
			148,
			8,
			[...header]
				.reduce((a, b) => a + b, 0)
				.toString(8)
				.padStart(6, '0') + '\0 '
		);
		return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
	});
	return Buffer.concat([...records, Buffer.alloc(10240)]);
}

function recordMap(archive) {
	const records = new Map(),
		bytes = Buffer.from(archive);
	const text = (view) => view.toString().split('\0')[0];
	for (let offset = 0; offset + 512 <= bytes.length;) {
		const header = bytes.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const name = text(header.subarray(0, 100)),
			prefix = text(header.subarray(345, 500));
		const size = Number.parseInt(text(header.subarray(124, 136)), 8);
		const end = offset + 512 + Math.ceil(size / 512) * 512;
		records.set(prefix ? `${prefix}/${name}` : name, bytes.subarray(offset, end));
		offset = end;
	}
	return records;
}

function fixture() {
	const archive = tar(files),
		receipt = identity(archive);
	const tool = (id) => ({
		id,
		url: `https://assets.test/${id}`,
		encoding: 'identity',
		delivery: { ...identity(wasm), mediaType: 'application/octet-stream' },
		logical: { ...identity(wasm), mediaType: 'application/octet-stream' }
	});
	const sysroot = {
		id: 'sysroot',
		url: 'https://assets.test/sysroot',
		encoding: 'identity',
		delivery: { ...receipt, mediaType: 'application/octet-stream' },
		logical: { ...receipt, mediaType: 'application/octet-stream' }
	};
	const distribution = {
		schemaVersion: 1,
		distributionId: 'fixture',
		packages: [
			{
				id: 'llvm',
				identity: `sha256:${receipt.sha256}`,
				mount: '/opt/toolchains/llvm',
				dependencies: [],
				capabilities: ['llvm-tool-host-exec-v1'],
				producer: {
					repository: 'https://github.com/llvm/llvm-project',
					revision: 'b'.repeat(40),
					receiptSha256: 'c'.repeat(64)
				},
				assets: [tool('clang'), tool('lld'), sysroot],
				files: [
					{ path: 'bin/llvm', asset: 'clang', executable: true },
					{ path: 'bin/wasm-ld', asset: 'lld', executable: true },
					{ path: 'sysroot.tar', asset: 'sysroot', executable: false }
				]
			}
		],
		commands: [
			{
				name: 'clang',
				package: 'llvm',
				adapter: 'llvm-clang-tool-host-live-v1',
				path: 'bin/llvm',
				argv0: '/opt/toolchains/llvm/bin/llvm',
				prefixArgs: ['clang']
			}
		]
	};
	return { archive, receipt, distribution };
}

test('derived C and C++ layers preserve every USTAR record and reconstruct the complete selected-target tree', () => {
	const f = fixture(),
		original = structuredClone(f.distribution);
	const layers = prepareContainerSysrootLayers(f.archive, f.distribution, f.receipt);
	const base = gunzipSync(layers.deliveries.get('sysroot-c')),
		cxx = gunzipSync(layers.deliveries.get('sysroot-cxx'));
	const originalRecords = recordMap(f.archive),
		baseRecords = recordMap(base),
		cxxRecords = recordMap(cxx);
	assert(baseRecords.has('include/stdio.h'));
	assert(!baseRecords.has('include/c++/v1/vector'));
	assert(baseRecords.has('include/c++-compat.h'));
	assert(baseRecords.has('lib/wasm32-wasi/libc++unknown.a'));
	assert(cxxRecords.has('include/c++/v1/vector'));
	assert(cxxRecords.has('lib/wasm32-wasi/libc++.a'));
	assert.equal(baseRecords.size + cxxRecords.size, originalRecords.size);
	for (const [path, record] of originalRecords)
		assert.deepEqual(baseRecords.get(path) ?? cxxRecords.get(path), record, path);
	const composed = composeSysrootLayers(base, cxx);
	const tree = (bytes) =>
		extractTarPackage(bytes)
			.map((entry) => ({ ...entry, data: entry.data && [...entry.data] }))
			.sort((a, b) => a.path.localeCompare(b.path));
	assert.deepEqual(tree(composed), tree(f.archive));
	assert.deepEqual(identity(composed), layers.config.full);
	assert.deepEqual(f.distribution, original);
	const repeated = prepareContainerSysrootLayers(f.archive, f.distribution, f.receipt);
	assert.deepEqual(repeated.receipt, layers.receipt);
	assert.deepEqual(repeated.deliveries, layers.deliveries);
	assert(layers.receipt.c.delivery.bytes < gzipSync(f.archive, { level: 9 }).length);
	assert(
		!layers.distribution.packages
			.find((pkg) => pkg.id === 'llvm')
			.assets.some((asset) => asset.id === 'sysroot')
	);
});

test('derivation rejects changed pins and invalid USTAR before producing any layer', () => {
	const f = fixture(),
		invalid = Buffer.from(f.archive);
	invalid[0] ^= 1;
	assert.throws(
		() => prepareContainerSysrootLayers(invalid, f.distribution, f.receipt),
		/Pinned full sysroot/
	);
	assert.throws(
		() => prepareContainerSysrootLayers(invalid, f.distribution, identity(invalid)),
		/checksum/
	);
	const base = Buffer.alloc(1024);
	base[1000] = 1;
	assert.throws(() => composeSysrootLayers(base, Buffer.alloc(1024)), /terminator/);
	const otherLayout = tar(
		files.map(([path, contents, mode]) => [
			path.replace('lib/clang/22/', 'lib/clang/23/'),
			contents,
			mode
		])
	);
	assert.throws(
		() => prepareContainerSysrootLayers(otherLayout, f.distribution, identity(otherLayout)),
		/Clang 22 resource/
	);
});

async function profileFixture({
	legacy = false,
	corruptDelta = false,
	wrongComposition = false
} = {}) {
	const f = fixture(),
		layers = prepareContainerSysrootLayers(f.archive, f.distribution, f.receipt);
	const distribution = legacy ? f.distribution : layers.distribution;
	const bodies = new Map([
		['clang', wasm],
		['lld', wasm],
		['sysroot', f.archive],
		...layers.deliveries
	]);
	for (const pkg of distribution.packages)
		for (const asset of pkg.assets) asset.url = `https://assets.test/${asset.id}`;
	const manifest = Buffer.from(JSON.stringify(distribution)),
		requested = [];
	let delivered = 0;
	const config = {
		manifest: manifest.toString(),
		manifestSha256: identity(manifest).sha256,
		assetURLs: distribution.packages.flatMap((pkg) => pkg.assets.map((asset) => asset.url)),
		sdkUrl: 'https://app.test/sdk.mjs',
		sdkWorkerUrl: 'https://app.test/worker.mjs',
		liveWorkerUrl: 'https://app.test/live.mjs',
		clangWorkerUrl: 'https://app.test/clang.mjs',
		clangSha256: identity(wasm).sha256,
		linkerSha256: identity(wasm).sha256,
		memory: { initial: 1, maximum: 2 },
		cacheNamespace: 'sysroot-layer-unit-fixture',
		clangFilesystem: 'live',
		...(legacy ? {} : { sysrootProfile: 'c-base-v1', sysrootLayers: layers.config })
	};
	if (wrongComposition)
		config.sysrootLayers.full = { ...config.sysrootLayers.full, sha256: '0'.repeat(64) };
	const profile = await createBashProfile({
		config,
		sdk: {},
		workerGroup: { async dispose() {} },
		fetch: async (url) => {
			const id = url.split('/').at(-1),
				body = bodies.get(id);
			requested.push(id);
			delivered += body.length;
			const result = new Response(
				corruptDelta && id === 'sysroot-cxx' ? new Uint8Array(body.length) : body,
				{ headers: { 'content-type': 'application/octet-stream' } }
			);
			Object.defineProperty(result, 'url', { value: url });
			return result;
		}
	});
	return {
		...f,
		layers,
		profile,
		requested,
		get delivered() {
			return delivered;
		}
	};
}

test('explicit C profile consumer downloads only base, then adds the delta once for C++ and shell compatibility', async () => {
	const f = await profileFixture(),
		signal = new AbortController().signal;
	try {
		assert.deepEqual(f.requested, []);
		assert.equal(f.profile.sysrootProfile, 'c-base-v1');
		assert.deepEqual(await f.profile.prepareClang('c', signal), [
			`--sysroot=${C_SYSROOT}`,
			`-resource-dir=${C_SYSROOT}/lib/clang/22`
		]);
		assert.deepEqual(f.requested, ['clang', 'lld', 'sysroot-c']);
		assert.equal(f.delivered, wasm.length * 2 + f.layers.receipt.c.delivery.bytes);
		assert.equal(
			f.profile.container.fs.readFile(`${C_SYSROOT}/include/stdio.h`).length,
			files.find(([path]) => path === 'include/stdio.h')[1].length
		);
		assert.throws(() => f.profile.container.fs.stat(`${C_SYSROOT}/include/c++/v1/vector`), {
			code: 'ENOENT'
		});
		assert.throws(() => f.profile.container.fs.stat(BASH_SYSROOT), { code: 'ENOENT' });
		await f.profile.prepareCommand({ path: '/usr/local/bin/clang' }, signal);
		assert.deepEqual(f.requested, ['clang', 'lld', 'sysroot-c', 'sysroot-cxx']);
		assert.equal(
			f.delivered,
			wasm.length * 2 +
				f.layers.receipt.c.delivery.bytes +
				f.layers.receipt.cxx.delivery.bytes
		);
		assert.equal(f.profile.inspectSysroot().sha256, f.layers.receipt.full.sha256);
		for (const [path, contents] of files)
			if (contents !== null)
				assert.deepEqual(
					f.profile.container.fs.readFile(`${BASH_SYSROOT}/${path}`),
					new TextEncoder().encode(contents)
				);
		assert.deepEqual(
			await f.profile.prepareClang('c', signal),
			[],
			'an already available full tree can serve C without another mount'
		);
		assert.equal(f.requested.length, 4);
	} finally {
		await f.profile.dispose();
	}
});

test('legacy generated configuration retains the original full sysroot for a C request', async () => {
	const f = await profileFixture({ legacy: true });
	try {
		assert.equal(f.profile.sysrootProfile, 'full');
		assert.deepEqual(await f.profile.prepareClang('c', new AbortController().signal), []);
		assert.deepEqual(f.requested, ['clang', 'lld', 'sysroot']);
		assert.equal(f.profile.inspectSysroot().sha256, f.receipt.sha256);
		assert(f.profile.container.fs.readFile(`${BASH_SYSROOT}/include/c++/v1/vector`).length > 0);
		assert.throws(() => f.profile.container.fs.stat(C_SYSROOT), { code: 'ENOENT' });
	} finally {
		await f.profile.dispose();
	}
});

test('corrupt delta and incorrect composition pin publish no full sysroot', async () => {
	for (const options of [{ corruptDelta: true }, { wrongComposition: true }]) {
		const f = await profileFixture(options);
		try {
			await assert.rejects(f.profile.prepareClang('full', new AbortController().signal));
			assert.equal(f.profile.inspectSysroot(), null);
			assert.throws(() => f.profile.container.fs.stat(BASH_SYSROOT), { code: 'ENOENT' });
			assert.equal(f.profile.manager.inspect().preparingBytes, 0);
			assert.deepEqual(f.profile.manager.inspect().pendingPackages, []);
		} finally {
			await f.profile.dispose();
		}
	}
});

test(
	'normal website preparation keeps full delivery by default and emits layers only for explicit C opt-in',
	{ timeout: 15000 },
	async (t) => {
		const root = await mkdtemp(join(tmpdir(), 'container-layer-preparation-'));
		t.after(() => rm(root, { recursive: true, force: true }));
		const f = fixture(),
			packageId = `sha256-${'a'.repeat(64)}`,
			sdkRoot = join(root, packageId);
		await mkdir(sdkRoot);
		const entries = {};
		for (const [name, bytes] of [
			['index.mjs', Buffer.from('export async function init() {}\n')],
			['worker.mjs', Buffer.from('export {};\n')],
			['wasmer_js_bg.wasm', wasm]
		]) {
			await writeFile(join(sdkRoot, name), bytes);
			entries[name] = identity(bytes);
		}
		const write = async (name, bytes) => {
			const path = join(root, name);
			await writeFile(path, bytes);
			return path;
		};
		const packageReceipt = Buffer.from(
			JSON.stringify({ complete: true, packageId, entries, sourceCommit: 'b'.repeat(40) })
		);
		const processReceipt = Buffer.from(
			JSON.stringify({ outputs: { 'sysroot.tar': f.receipt } })
		);
		const producer = Buffer.from(
			JSON.stringify({
				source: f.distribution.packages[0].producer,
				outputs: { 'clang.wasm': identity(wasm), 'lld.wasm': identity(wasm) }
			})
		);
		const busyboxReceipt = Buffer.from('{"fixture":true}');
		const configuration = {
			baseURL: 'https://example.test/container-app/',
			sourceRevision: 'b'.repeat(40),
			containerSource: 'workspace',
			packageReceipt: await write('sdk-receipt.json', packageReceipt),
			packageReceiptSha256: identity(packageReceipt).sha256,
			bashWebc: await write('bash.webc', Buffer.from([1, 2, 3])),
			busyboxWasm: await write('busybox.wasm', wasm),
			busyboxReceipt: await write('busybox-receipt.json', busyboxReceipt),
			busyboxReceiptSha256: identity(busyboxReceipt).sha256,
			clangWasm: await write('clang.wasm', wasm),
			lldWasm: await write('lld.wasm', wasm),
			clangProducerReceipt: await write('producer.json', producer),
			clangProducerReceiptSha256: identity(producer).sha256,
			processSysroot: await write('sysroot.tar', f.archive),
			processSysrootReceipt: await write('sysroot-receipt.json', processReceipt),
			processSysrootReceiptSha256: identity(processReceipt).sha256
		};
		await assert.rejects(
			preparePageContainer(
				{
					...configuration,
					sysrootProfile: 'c-base-v1',
					processSysrootReceiptSha256: '0'.repeat(64)
				},
				{ output: join(root, 'rejected'), releasePath: join(root, 'rejected.ts') }
			),
			/Explicit process sysroot receipt pin/
		);
		for (const sysrootProfile of [undefined, 'c-base-v1']) {
			const output = join(root, `output-${sysrootProfile ?? 'full'}`),
				releasePath = join(root, `release-${sysrootProfile ?? 'full'}.ts`);
			await preparePageContainer(
				{ ...configuration, sysrootProfile },
				{ output, releasePath }
			);
			const releaseSource = await readFile(releasePath, 'utf8'),
				start = releaseSource.indexOf('const release = ') + 'const release = '.length;
			const release = JSON.parse(
				releaseSource.slice(start, releaseSource.indexOf(';\n', start))
			);
			assert.equal(release.config.sysrootProfile, sysrootProfile ?? 'full');
			const manifest = await readFile(join(output, 'distribution.json'));
			await validateDistribution({
				bytes: manifest,
				expectedSha256: release.config.manifestSha256,
				adapterIds: ['wasi-preview1-live', 'llvm-clang-tool-host-live-v1'],
				allowedAssetURLs: release.config.assetURLs
			});
			const provenance = JSON.parse(await readFile(join(output, 'provenance.json')));
			if (sysrootProfile === 'c-base-v1') {
				assert.equal(release.config.sysrootLayers.schemaVersion, 1);
				assert(
					!release.distribution.packages
						.find((pkg) => pkg.id === 'llvm')
						.assets.some((asset) => asset.id === 'sysroot')
				);
				for (const id of ['llvm-sysroot-c', 'llvm-sysroot-cxx']) {
					const asset = release.distribution.packages.find((pkg) => pkg.id === id)
						.assets[0];
					const body = await readFile(
						join(
							output,
							new URL(asset.url).pathname.slice(
								new URL(configuration.baseURL).pathname.length
							)
						)
					);
					assert.deepEqual(identity(body), {
						bytes: asset.delivery.bytes,
						sha256: asset.delivery.sha256
					});
					assert.deepEqual(identity(gunzipSync(body)), {
						bytes: asset.logical.bytes,
						sha256: asset.logical.sha256
					});
				}
				assert.deepEqual(provenance.sysrootLayers.source, f.receipt);
				assert.deepEqual(provenance.sysrootLayers.full, release.config.sysrootLayers.full);
			} else {
				assert.equal(release.config.sysrootLayers, undefined);
				assert.equal(provenance.sysrootLayers, undefined);
				assert.equal(release.distribution.packages.length, 3);
				const asset = release.distribution.packages
					.find((pkg) => pkg.id === 'llvm')
					.assets.find((asset) => asset.id === 'sysroot');
				assert.equal(asset.encoding, 'identity');
				assert.deepEqual(
					identity(
						await readFile(
							join(
								output,
								new URL(asset.url).pathname.slice(
									new URL(configuration.baseURL).pathname.length
								)
							)
						)
					),
					f.receipt
				);
			}
			assert.equal(
				JSON.parse(await readFile(join(output, 'page-config.json'))).sysrootProfile,
				sysrootProfile ?? 'full'
			);
		}
	}
);
