import {
	RUBY_PREFLIGHT_PROTOCOL,
	RUBY_PREFLIGHT_PROTOCOL_VERSION,
	RUBY_RUNTIME_PROFILE
} from '@wasm-idle/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ preflightRubyRuntimeAssets: vi.fn() }));

vi.mock('@wasm-idle/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@wasm-idle/core')>()),
	preflightRubyRuntimeAssets: mocks.preflightRubyRuntimeAssets
}));

vi.mock('$env/dynamic/public', () => ({ env: {} }));

import { resolveRubyRuntimeAssetConfig } from './assets';
import {
	createRubyRuntimeOwnedPreflightDelivery,
	preflightVerifiedRubyRuntimeAssets
} from './rubyAssets';

function createPayload() {
	return Object.freeze({
		protocol: RUBY_PREFLIGHT_PROTOCOL,
		protocolVersion: RUBY_PREFLIGHT_PROTOCOL_VERSION,
		profileId: RUBY_RUNTIME_PROFILE.profileId,
		artifactRevision: RUBY_RUNTIME_PROFILE.artifactRevision,
		rubyVersion: RUBY_RUNTIME_PROFILE.rubyVersion,
		rubyRevision: RUBY_RUNTIME_PROFILE.rubyRevision,
		rubyWasmVersion: RUBY_RUNTIME_PROFILE.rubyWasmVersion,
		rubyWasmRevision: RUBY_RUNTIME_PROFILE.rubyWasmRevision,
		wasiSdkVersion: RUBY_RUNTIME_PROFILE.wasiSdkVersion,
		manifestFingerprint: RUBY_RUNTIME_PROFILE.manifestFingerprint,
		manifestBytes: Uint8Array.from([1]),
		moduleJavaScriptBytes: Uint8Array.from([2]),
		wasmBytes: Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0])
	});
}

afterEach(() => {
	vi.restoreAllMocks();
	mocks.preflightRubyRuntimeAssets.mockReset();
});

describe('Ruby page-host preflight adapter', () => {
	it('forwards the exact canonical config, profile, signal, and limits to Core', async () => {
		const config = resolveRubyRuntimeAssetConfig(
			{ rootUrl: '/app' },
			'https://app.example/app/'
		);
		const payload = createPayload();
		const controller = new AbortController();
		const progress = vi.fn();
		mocks.preflightRubyRuntimeAssets.mockResolvedValue(payload);

		await expect(
			preflightVerifiedRubyRuntimeAssets(config, {
				limits: { maxAssetBytes: 1024 },
				signal: controller.signal,
				reportProgress: progress
			})
		).resolves.toBe(payload);
		expect(mocks.preflightRubyRuntimeAssets).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: config.baseUrl,
				manifestUrl: config.manifestUrl,
				moduleUrl: config.moduleUrl,
				wasmUrl: config.wasmUrl,
				profile: config.preflightProfile,
				signal: controller.signal,
				reportProgress: progress
			})
		);
	});

	it('automatically adopts all three unique whole buffers and consumes exactly once', () => {
		const payload = createPayload();
		const delivery = createRubyRuntimeOwnedPreflightDelivery(payload);

		expect(delivery.payload).toBe(payload);
		expect(delivery.state).toBe('available');
		expect(delivery.consume()).toEqual([
			payload.manifestBytes.buffer,
			payload.moduleJavaScriptBytes.buffer,
			payload.wasmBytes.buffer
		]);
		expect(delivery.state).toBe('consumed');
		expect(() => delivery.consume()).toThrow('no longer available');
		delivery.retire();
		expect(delivery.state).toBe('consumed');
	});

	it('retires an available delivery and rejects partial, shared, or unfrozen ownership', () => {
		const delivery = createRubyRuntimeOwnedPreflightDelivery(createPayload());
		delivery.retire();
		expect(delivery.state).toBe('retired');
		expect(() => delivery.consume()).toThrow('no longer available');

		const payload = createPayload();
		expect(() => createRubyRuntimeOwnedPreflightDelivery({ ...payload })).toThrow(
			'frozen plain payload'
		);
		const backing = new Uint8Array([1, 2]);
		expect(() =>
			createRubyRuntimeOwnedPreflightDelivery(
				Object.freeze({
					...payload,
					manifestBytes: backing.subarray(0, 1)
				})
			)
		).toThrow('exclusively own');
		expect(() =>
			createRubyRuntimeOwnedPreflightDelivery(
				Object.freeze({
					...payload,
					moduleJavaScriptBytes: payload.manifestBytes
				})
			)
		).toThrow('unique ownership');
	});
});
