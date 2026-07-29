import {
	RUNTIME_TRUST_PROFILE_SCHEMA_VERSION,
	authorizeRuntimeNetworkRequest,
	defineRuntimeTrustProfile,
	enforceRuntimeTrustProfile
} from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';

const profile = defineRuntimeTrustProfile({
	schemaVersion: RUNTIME_TRUST_PROFILE_SCHEMA_VERSION,
	profileId: 'runtime-network-test-v1',
	network: {
		mode: 'allowlist',
		allowedOrigins: ['https://cdn.example.com']
	},
	storage: { mode: 'none' },
	environment: { mode: 'none', allowedNames: [] },
	threads: { maxThreads: 0 },
	workers: { maxNestedWorkers: 0 },
	sharedArrayBuffer: false,
	dynamicCode: 'wasm-only',
	sameOriginAccess: false
});

const grant = enforceRuntimeTrustProfile(profile, {
	pageOrigin: 'https://app.example.com',
	networkUrls: [
		'https://cdn.example.com/runtime/compiler.wasm',
		'https://cdn.example.com/runtime/worker.js'
	],
	dynamicCode: 'wasm-only'
});

describe('runtime network request authorization', () => {
	it('authorizes only exact URLs admitted into the execution grant', () => {
		expect(
			authorizeRuntimeNetworkRequest(grant, 'https://cdn.example.com/runtime/compiler.wasm')
		).toBe('https://cdn.example.com/runtime/compiler.wasm');
		expect(() =>
			authorizeRuntimeNetworkRequest(grant, 'https://cdn.example.com/runtime/other.wasm')
		).toThrow('not included in the execution grant');
	});

	it('resolves relative requests without widening the exact grant', () => {
		expect(
			authorizeRuntimeNetworkRequest(
				grant,
				'compiler.wasm',
				'https://cdn.example.com/runtime/'
			)
		).toBe('https://cdn.example.com/runtime/compiler.wasm');
		expect(() => authorizeRuntimeNetworkRequest(grant, '/runtime/worker.js')).toThrow(
			'not allowed by runtime-network-test-v1'
		);
	});

	it('rejects redirect targets and forged grants outside the declared policy', () => {
		expect(() =>
			authorizeRuntimeNetworkRequest(
				grant,
				'https://mirror.example.com/runtime/compiler.wasm'
			)
		).toThrow('not allowed by runtime-network-test-v1');
		expect(() =>
			authorizeRuntimeNetworkRequest(
				{
					...grant,
					networkUrls: ['https://mirror.example.com/runtime/compiler.wasm']
				},
				'https://mirror.example.com/runtime/compiler.wasm'
			)
		).toThrow('not allowed by runtime-network-test-v1');
	});

	it('rejects credential-bearing and unsupported URLs before grant lookup', () => {
		expect(() =>
			authorizeRuntimeNetworkRequest(
				grant,
				'https://user:secret@cdn.example.com/runtime/compiler.wasm'
			)
		).toThrow('cannot contain credentials');
		expect(() => authorizeRuntimeNetworkRequest(grant, 'data:text/plain,hello')).toThrow(
			'unsupported scheme'
		);
	});
});
