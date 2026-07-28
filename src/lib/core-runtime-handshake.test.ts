import {
	RUNTIME_PROTOCOL_NAME,
	RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
	assertRuntimeHandshake,
	runtimeHandshakeExpectationFromRegistryManifest,
	type RuntimeHandshake,
	type RuntimeRegistryManifest
} from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';

const manifestSha256 = 'a'.repeat(64);

function createManifest(): RuntimeRegistryManifest {
	return {
		schemaVersion: RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
		manifestId: 'wasm-idle/browser-runtimes',
		revision: 'rust-v1',
		runtimes: [
			{
				runtimeId: 'rust/rustc',
				identity: {
					languageId: 'RUST',
					implementationId: 'rustc',
					implementationVersion: '1.99.0',
					profile: {
						profileId: 'rust-browser-1.99-llvm-22',
						manifestSchemaVersion: 3,
						manifestSha256,
						protocolVersion: 1,
						trustProfileId: 'restricted-browser-worker-v1',
						trustProfileSchemaVersion: 1
					}
				},
				capabilities: {
					stdin: 'streaming',
					workspace: true,
					abort: true,
					artifacts: true,
					streamingOutput: true
				},
				requiredBrowserFeatures: ['wasm'],
				assets: [],
				contracts: {
					routeId: 'rust',
					runtimeAssetKey: 'rust',
					documentationId: 'RUST'
				}
			}
		]
	};
}

function createHandshake(): RuntimeHandshake {
	return {
		protocol: RUNTIME_PROTOCOL_NAME,
		protocolVersion: 1,
		manifestSchemaVersion: 3,
		manifestSha256,
		runtime: {
			languageId: 'RUST',
			implementationId: 'rustc',
			version: '1.99.0',
			profileId: 'rust-browser-1.99-llvm-22',
			trustProfileId: 'restricted-browser-worker-v1',
			trustProfileSchemaVersion: 1
		},
		capabilities: {
			stdin: 'streaming',
			workspace: true,
			abort: true,
			artifacts: true,
			streamingOutput: true
		}
	};
}

describe('runtime profile handshake', () => {
	it('derives and enforces the complete registry identity', () => {
		const expected = runtimeHandshakeExpectationFromRegistryManifest(
			createManifest(),
			'rust/rustc'
		);

		expect(expected).toEqual({
			protocolVersion: 1,
			manifestSchemaVersion: 3,
			manifestSha256,
			profileId: 'rust-browser-1.99-llvm-22',
			languageId: 'RUST',
			implementationId: 'rustc',
			runtimeVersion: '1.99.0',
			trustProfileId: 'restricted-browser-worker-v1',
			trustProfileSchemaVersion: 1,
			requiredCapabilities: {
				stdin: 'streaming',
				workspace: true,
				abort: true,
				artifacts: true,
				streamingOutput: true
			}
		});
		expect(assertRuntimeHandshake(expected, createHandshake())).toEqual(createHandshake());
		expect(Object.isFrozen(expected)).toBe(true);
		expect(Object.isFrozen(expected.requiredCapabilities)).toBe(true);
	});

	it.each([
		['manifestSha256', 'b'.repeat(64), 'Runtime manifest SHA-256 mismatch'],
		['languageId', 'C', 'Runtime language mismatch'],
		['implementationId', 'clang', 'Runtime implementation mismatch'],
		['runtimeVersion', '2.0.0', 'Runtime version mismatch'],
		['trustProfileId', 'unrestricted-browser-v1', 'Runtime trust profile mismatch'],
		['trustProfileSchemaVersion', 2, 'Runtime trust profile schema mismatch']
	] as const)('rejects a mismatched %s identity', (field, value, message) => {
		const expected = {
			...runtimeHandshakeExpectationFromRegistryManifest(createManifest(), 'rust/rustc'),
			[field]: value
		};

		expect(() => assertRuntimeHandshake(expected, createHandshake())).toThrow(message);
	});

	it('rejects malformed untrusted handshake fields even without matching expectations', () => {
		const malformedDigest = { ...createHandshake(), manifestSha256: 'not-a-digest' };
		expect(() => assertRuntimeHandshake({ protocolVersion: 1 }, malformedDigest)).toThrow(
			'Runtime manifest SHA-256 is malformed'
		);

		const handshake = createHandshake();
		const incompleteTrust = {
			...handshake,
			runtime: { ...handshake.runtime, trustProfileSchemaVersion: undefined }
		};
		expect(() => assertRuntimeHandshake({ protocolVersion: 1 }, incompleteTrust)).toThrow(
			'Runtime trust profile identity is incomplete'
		);
	});
});
