import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	assertRegistryAvailability,
	assertTargetVersion,
	parseReleaseArgs,
	synchronizeManifest,
	topologicallySortRelease,
	validatePackedManifest,
	validateResumeArtifacts,
	validateSourceRelease
} from './release-npm.mjs';

describe('npm release arguments', () => {
	it('requires an explicit semver and defaults to a non-publishing run', () => {
		assert.deepEqual(parseReleaseArgs(['--', '--version', '1.0.0']), {
			publish: false,
			resume: false,
			tag: 'latest',
			access: 'public',
			registry: 'https://registry.npmjs.org/',
			help: false,
			version: '1.0.0'
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
});

describe('release manifest synchronization', () => {
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
