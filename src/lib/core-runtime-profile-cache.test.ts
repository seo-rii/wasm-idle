import { createRuntimeAssetsKey } from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';

const manifestSha256 = 'a'.repeat(64);

describe('runtime profile cache identity', () => {
	it('separates otherwise identical assets by profile and protocol identity', () => {
		const base = {
			rust: { compilerUrl: '/wasm-rust/index.js' }
		};
		const first = createRuntimeAssetsKey({
			...base,
			runtimeProfiles: {
				rust: {
					profileId: 'rust-browser-1.99-llvm-22',
					manifestSchemaVersion: 2,
					manifestSha256,
					protocolVersion: 3
				}
			}
		});
		const second = createRuntimeAssetsKey({
			...base,
			runtimeProfiles: {
				rust: {
					profileId: 'rust-browser-1.99-llvm-18',
					manifestSchemaVersion: 2,
					manifestSha256,
					protocolVersion: 3
				}
			}
		});

		expect(first).not.toBe(second);
	});

	it('produces a deterministic key independent of profile declaration order', () => {
		const clang = {
			profileId: 'clang-wasi-22.1.8-wasi-sdk-33',
			manifestSchemaVersion: 2,
			manifestSha256,
			protocolVersion: 3
		};
		const rust = {
			profileId: 'rust-browser-1.99-llvm-22',
			manifestSchemaVersion: 2,
			manifestSha256: 'b'.repeat(64),
			protocolVersion: 3
		};

		expect(createRuntimeAssetsKey({ runtimeProfiles: { clang, rust } })).toBe(
			createRuntimeAssetsKey({ runtimeProfiles: { rust, clang } })
		);
	});

	it('rejects incomplete or malformed profile identities', () => {
		expect(() =>
			createRuntimeAssetsKey({
				runtimeProfiles: {
					clang: {
						profileId: 'clang-wasi-22.1.8-wasi-sdk-33',
						manifestSchemaVersion: 2,
						manifestSha256: 'not-a-digest',
						protocolVersion: 3
					}
				}
			})
		).toThrow('invalid manifest SHA-256');
	});
});
