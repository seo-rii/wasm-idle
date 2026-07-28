import {
	ProtocolError,
	RUNTIME_PROTOCOL_NAME,
	RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
	WorkspaceValidationError,
	assertHostToRuntimeWorkerMessage,
	assertRuntimeHandshake,
	assertRuntimeWorkerToHostMessage,
	defineRuntimeRegistryManifest,
	normalizeWorkspacePath,
	type RuntimeRegistryManifest
} from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';

function createRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state / 0x1_0000_0000;
	};
}

function randomValue(random: () => number, depth = 0): unknown {
	const scalarOnly = depth >= 3;
	const choice = Math.floor(random() * (scalarOnly ? 5 : 8));
	switch (choice) {
		case 0:
			return null;
		case 1:
			return random() < 0.5;
		case 2:
			return random() < 0.1 ? Number.NaN : Math.floor(random() * 20) - 10;
		case 3: {
			const alphabet = 'abCD09_:/.-\0\u007f';
			let value = '';
			for (let index = 0, length = Math.floor(random() * 16); index < length; index += 1) {
				value += alphabet[Math.floor(random() * alphabet.length)];
			}
			return value;
		}
		case 4:
			return undefined;
		case 5:
			return Array.from({ length: Math.floor(random() * 5) }, () =>
				randomValue(random, depth + 1)
			);
		case 6:
			return new Uint8Array([Math.floor(random() * 256)]);
		default: {
			const record: Record<string, unknown> = {};
			for (let index = 0, length = Math.floor(random() * 5); index < length; index += 1) {
				record[`k${Math.floor(random() * 8)}`] = randomValue(random, depth + 1);
			}
			return record;
		}
	}
}

describe('Core untrusted-boundary fuzz regressions', () => {
	it('never leaks non-protocol exceptions for arbitrary worker envelopes', () => {
		const random = createRandom(0xc0de_2026);
		for (let iteration = 0; iteration < 512; iteration += 1) {
			const candidate = randomValue(random);
			for (const validate of [
				assertHostToRuntimeWorkerMessage,
				assertRuntimeWorkerToHostMessage
			]) {
				try {
					validate(candidate);
				} catch (error) {
					expect(error).toBeInstanceOf(ProtocolError);
				}
			}
		}
	});

	it('never leaks non-protocol exceptions for nested handshake mutations', () => {
		const random = createRandom(0x51a7_2026);
		const validHandshake = {
			protocol: RUNTIME_PROTOCOL_NAME,
			protocolVersion: 1,
			runtime: { languageId: 'C', implementationId: 'clang', version: '22.1.8' },
			capabilities: {
				stdin: 'prebuffered',
				workspace: true,
				abort: true,
				artifacts: true,
				streamingOutput: true
			}
		};

		for (let iteration = 0; iteration < 256; iteration += 1) {
			const mutation = randomValue(random);
			for (const candidate of [
				mutation,
				{ ...validHandshake, protocolVersion: mutation },
				{ ...validHandshake, runtime: mutation },
				{ ...validHandshake, capabilities: mutation },
				{ ...validHandshake, manifestSha256: mutation }
			]) {
				try {
					assertRuntimeHandshake({ protocolVersion: 1 }, candidate);
				} catch (error) {
					expect(error).toBeInstanceOf(ProtocolError);
				}
			}
		}
	});

	it('rejects generated path escapes in both workspace and runtime manifests', () => {
		const random = createRandom(0x7a7b_2026);
		const digest = 'a'.repeat(64);
		const baseManifest = {
			schemaVersion: RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
			manifestId: 'wasm-idle/fuzz-runtime',
			revision: 'fuzz-v1',
			runtimes: [
				{
					runtimeId: 'c/fuzz',
					identity: {
						languageId: 'C',
						implementationId: 'clang',
						implementationVersion: '22.1.8',
						profile: {
							profileId: 'clang-fuzz-v1',
							manifestSchemaVersion: 1,
							manifestSha256: digest,
							protocolVersion: 1,
							trustProfileId: 'restricted-browser-worker-v1',
							trustProfileSchemaVersion: 1
						}
					},
					capabilities: {
						stdin: 'prebuffered',
						workspace: true,
						abort: true,
						artifacts: false,
						streamingOutput: true
					},
					workerLifetime: { mode: 'per-run' },
					requiredBrowserFeatures: ['wasm'],
					assetRoot: 'wasm-c',
					assets: [
						{
							key: 'compiler.wasm',
							path: 'compiler.wasm',
							compressedSha256: digest,
							uncompressedSha256: digest,
							compressedBytes: 1,
							uncompressedBytes: 1,
							mediaType: 'application/wasm',
							encoding: 'identity'
						}
					],
					contracts: {
						routeId: 'c-fuzz',
						runtimeAssetKey: 'c-fuzz',
						documentationId: 'C'
					}
				}
			]
		} satisfies RuntimeRegistryManifest;
		const runtime = baseManifest.runtimes[0];

		for (let iteration = 0; iteration < 128; iteration += 1) {
			const token = Math.floor(random() * 0xffff_ffff).toString(16);
			const attacks = [
				`../${token}`,
				`/${token}`,
				`C:\\${token}`,
				`file://${token}`,
				`${token}//file`,
				`${token}/./file`,
				`${token}/../file`,
				`${token}\0file`,
				`\\\\server\\${token}`
			];
			for (const path of attacks) {
				expect(() => normalizeWorkspacePath(path)).toThrow(WorkspaceValidationError);
				expect(() =>
					defineRuntimeRegistryManifest({
						...baseManifest,
						runtimes: [
							{
								...runtime,
								assets: [{ ...runtime.assets[0], path }]
							}
						]
					})
				).toThrow(TypeError);
			}
		}
	});
});
