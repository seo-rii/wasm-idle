import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRustWorkerService } from '../src/index.js';

const compilerUrl = 'blob:https://app.example/verified-rust-entry';
const compilerMocks = vi.hoisted(() => {
	const requests: any[] = [];
	return {
		requests,
		configure: vi.fn(),
		create: vi.fn(async () => ({
			async compile(request: any) {
				requests.push(request);
				(globalThis as any).__lastRustLspCompile = request;
				request.onProgress?.({
					stage: 'rustc-main',
					completed: 1,
					total: 2,
					delivery: {
						deliveredBytes: 17,
						expectedBytes: 42,
						maxBytes: 192 * 1024 * 1024,
						sequence: 2
					}
				});
				return {
					success: false,
					diagnostics: [
						{
							lineNumber: 2,
							columnNumber: 5,
							severity: 'error',
							message: 'cannot find value'
						}
					]
				};
			}
		}))
	};
});

vi.mock('blob:https://app.example/verified-rust-entry', () => ({
	configureVerifiedRuntimeExecutableModuleUrls: compilerMocks.configure,
	createRustCompiler: compilerMocks.create,
	default: compilerMocks.create
}));

const runtimeProfile = {
	profileId: `wasm-rust-${'b'.repeat(64)}`,
	protocolVersion: 1 as const,
	manifestPath: 'runtime/runtime-manifest.v3.json' as const,
	manifestFingerprint: 'b'.repeat(64),
	manifestReceipt: { bytes: 42, sha256: 'c'.repeat(64) },
	moduleUrl: `https://app.example/wasm-rust/index.js?v=${'b'.repeat(64)}&rustManifestBytes=42&rustManifestSha256=${'c'.repeat(64)}`
};
const workerNetworkUrl = `https://app.example/wasm-rust/compiler-worker.js${new URL(runtimeProfile.moduleUrl).search}`;
const workerBlobUrl = 'blob:https://app.example/verified-rust-worker';
const verifiedModuleUrls = Object.freeze({
	[runtimeProfile.moduleUrl]: compilerUrl,
	[workerNetworkUrl]: workerBlobUrl
});
const expectedNetworkModuleUrls = Object.freeze(Object.keys(verifiedModuleUrls));

describe('createRustWorkerService', () => {
	beforeEach(() => {
		(globalThis as any).__lastRustLspCompile = undefined;
		compilerMocks.requests.length = 0;
		compilerMocks.configure.mockClear();
		compilerMocks.create.mockClear();
	});

	it('uses the real wasm-rust compiler API for diagnostics', async () => {
		const service = createRustWorkerService(async () => ({
			configureVerifiedRuntimeExecutableModuleUrls: compilerMocks.configure,
			createRustCompiler: compilerMocks.create
		}));
		const reportProgress = vi.fn();
		const context = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress
		};

		await service.initialize?.(
			{
				compilerUrl,
				expectedNetworkModuleUrls,
				verifiedModuleUrls,
				graphFingerprint: 'a'.repeat(64),
				runtimeProfile,
				targetTriple: 'wasm32-wasip2'
			},
			context
		);
		const diagnostics = await service.diagnostics?.(
			{
				uri: 'file:///workspace/main.rs',
				languageId: 'rust',
				version: 1,
				text: 'fn main() {\n    missing;\n}\n'
			},
			context
		);

		expect((globalThis as any).__lastRustLspCompile).toMatchObject({
			code: 'fn main() {\n    missing;\n}\n',
			edition: '2024',
			crateType: 'bin',
			targetTriple: 'wasm32-wasip2',
			extendedTimeout: true,
			log: false,
			assetDeliveryBudget: {
				schemaVersion: 1,
				maxBytes: 192 * 1024 * 1024,
				state: expect.any(SharedArrayBuffer)
			}
		});
		expect(diagnostics).toEqual([
			{
				range: {
					start: { line: 1, character: 4 },
					end: { line: 1, character: 5 }
				},
				severity: 1,
				source: 'rustc',
				message: 'cannot find value'
			}
		]);
		expect(reportProgress).toHaveBeenCalledWith('load-rust-compiler');
		expect(reportProgress).toHaveBeenCalledWith('rustc-main', 17, 42);
		expect(compilerMocks.configure).toHaveBeenCalledWith(verifiedModuleUrls, 'a'.repeat(64));
		expect(compilerMocks.create).toHaveBeenCalledWith({ dependencies: { runtimeProfile } });
	});

	it('creates a fresh capped asset delivery budget for every diagnostics compile', async () => {
		const service = createRustWorkerService(async () => ({
			configureVerifiedRuntimeExecutableModuleUrls: compilerMocks.configure,
			createRustCompiler: compilerMocks.create
		}));
		const context = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		await service.initialize?.(
			{
				compilerUrl,
				expectedNetworkModuleUrls,
				verifiedModuleUrls,
				graphFingerprint: 'a'.repeat(64),
				runtimeProfile,
				maxAssetBytes: 1024
			},
			context
		);

		for (const [version, text] of [
			[1, 'fn main() {}'],
			[2, 'fn main() { let _x = 1; }']
		] as const) {
			await service.diagnostics?.(
				{ uri: 'file:///workspace/main.rs', languageId: 'rust', version, text },
				context
			);
		}

		expect(compilerMocks.requests).toHaveLength(2);
		const [firstBudget, secondBudget] = compilerMocks.requests.map(
			(request) => request.assetDeliveryBudget
		);
		expect(firstBudget).toMatchObject({ schemaVersion: 1, maxBytes: 2048 });
		expect(secondBudget).toMatchObject({ schemaVersion: 1, maxBytes: 2048 });
		expect(firstBudget).not.toBe(secondBudget);
		expect(firstBudget.state).not.toBe(secondBudget.state);
	});

	it('caps an overflow-prone per-asset policy before deriving the aggregate budget', async () => {
		const service = createRustWorkerService(async () => ({
			configureVerifiedRuntimeExecutableModuleUrls: compilerMocks.configure,
			createRustCompiler: compilerMocks.create
		}));
		const context = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		await service.initialize?.(
			{
				compilerUrl,
				expectedNetworkModuleUrls,
				verifiedModuleUrls,
				graphFingerprint: 'a'.repeat(64),
				runtimeProfile,
				maxAssetBytes: Number.MAX_SAFE_INTEGER
			},
			context
		);

		await service.diagnostics?.(
			{
				uri: 'file:///workspace/main.rs',
				languageId: 'rust',
				version: 1,
				text: 'fn main() {}'
			},
			context
		);

		expect(compilerMocks.requests).toHaveLength(1);
		expect(compilerMocks.requests[0]?.assetDeliveryBudget).toMatchObject({
			schemaVersion: 1,
			maxBytes: 192 * 1024 * 1024
		});
	});

	it('uses the delivery limit while expected delivery bytes are not declared', async () => {
		const compile = vi.fn(async (request: any) => {
			request.onProgress?.({
				stage: 'fetch-rustc',
				delivery: {
					deliveredBytes: 5,
					expectedBytes: 0,
					maxBytes: 8192,
					sequence: 1
				}
			});
			return { success: true, diagnostics: [] };
		});
		const service = createRustWorkerService(async () => ({
			configureVerifiedRuntimeExecutableModuleUrls: vi.fn(),
			createRustCompiler: vi.fn(async () => ({ compile }))
		}));
		const reportProgress = vi.fn();
		const context = { documents: new Map(), publishDiagnostics: vi.fn(), reportProgress };
		await service.initialize?.(
			{
				compilerUrl,
				expectedNetworkModuleUrls,
				verifiedModuleUrls,
				graphFingerprint: 'a'.repeat(64),
				runtimeProfile,
				maxAssetBytes: 4096
			},
			context
		);

		await service.diagnostics?.(
			{
				uri: 'file:///workspace/main.rs',
				languageId: 'rust',
				version: 1,
				text: 'fn main() {}'
			},
			context
		);

		expect(reportProgress).toHaveBeenCalledWith('fetch-rustc', 5, 8192);
	});

	it('rejects an invalid asset policy before importing the compiler', async () => {
		const importModule = vi.fn(async () => {
			throw new Error('must not import');
		});
		const service = createRustWorkerService(importModule);

		await expect(
			service.initialize?.(
				{
					compilerUrl,
					expectedNetworkModuleUrls,
					verifiedModuleUrls,
					graphFingerprint: 'a'.repeat(64),
					runtimeProfile,
					maxAssetBytes: 0
				},
				{ documents: new Map(), publishDiagnostics: vi.fn(), reportProgress: vi.fn() }
			)
		).rejects.toThrow('positive safe integer');
		expect(importModule).not.toHaveBeenCalled();
	});

	it.each([
		'https://app.example/wasm-rust/index.js',
		`${compilerUrl}?v=1`,
		`${compilerUrl}#entry`,
		'data:text/javascript,export default 1'
	])('rejects an unverified compiler URL: %s', async (unverifiedCompilerUrl) => {
		const service = createRustWorkerService();
		await expect(
			service.initialize?.(
				{
					compilerUrl: unverifiedCompilerUrl,
					expectedNetworkModuleUrls,
					verifiedModuleUrls,
					graphFingerprint: 'a'.repeat(64),
					runtimeProfile
				},
				{ documents: new Map(), publishDiagnostics: vi.fn(), reportProgress: vi.fn() }
			)
		).rejects.toThrow('canonical Blob URL');
	});

	it('rejects a runtime profile that does not identify the verified compiler entry', async () => {
		const service = createRustWorkerService(async () => {
			throw new Error('must not import');
		});
		await expect(
			service.initialize?.(
				{
					compilerUrl,
					expectedNetworkModuleUrls,
					verifiedModuleUrls,
					graphFingerprint: 'a'.repeat(64),
					runtimeProfile: {
						...runtimeProfile,
						moduleUrl: 'https://app.example/wasm-rust/other.js'
					}
				},
				{ documents: new Map(), publishDiagnostics: vi.fn(), reportProgress: vi.fn() }
			)
		).rejects.toThrow('verified compiler entry');
	});

	it('rejects extra runtime profile fields before importing the compiler', async () => {
		const service = createRustWorkerService(async () => {
			throw new Error('must not import');
		});
		await expect(
			service.initialize?.(
				{
					compilerUrl,
					expectedNetworkModuleUrls,
					verifiedModuleUrls,
					graphFingerprint: 'a'.repeat(64),
					runtimeProfile: { ...runtimeProfile, extra: true }
				},
				{ documents: new Map(), publishDiagnostics: vi.fn(), reportProgress: vi.fn() }
			)
		).rejects.toThrow('runtime profile is invalid');
	});

	it.each([
		{
			profile: { ...runtimeProfile, profileId: 'wasm-rust-invalid' },
			message: 'profile identity'
		},
		{
			profile: {
				...runtimeProfile,
				manifestReceipt: { ...runtimeProfile.manifestReceipt, bytes: 16 * 1024 * 1024 + 1 }
			},
			message: 'profile receipt'
		},
		{
			profile: {
				...runtimeProfile,
				moduleUrl: `https://app.example/wasm-rust/index.js?rustManifestBytes=42&v=${'b'.repeat(64)}&rustManifestSha256=${'c'.repeat(64)}`
			},
			message: 'receipt query'
		}
	])('rejects a non-canonical pinned runtime profile', async ({ profile, message }) => {
		const service = createRustWorkerService(async () => {
			throw new Error('must not import');
		});
		await expect(
			service.initialize?.(
				{
					compilerUrl,
					expectedNetworkModuleUrls: [profile.moduleUrl],
					verifiedModuleUrls: { [profile.moduleUrl]: compilerUrl },
					graphFingerprint: 'a'.repeat(64),
					runtimeProfile: profile
				},
				{ documents: new Map(), publishDiagnostics: vi.fn(), reportProgress: vi.fn() }
			)
		).rejects.toThrow(message);
	});

	it.each([
		{
			case: 'a missing mapping',
			expected: expectedNetworkModuleUrls,
			mapped: { [runtimeProfile.moduleUrl]: compilerUrl }
		},
		{
			case: 'an extra mapping',
			expected: [runtimeProfile.moduleUrl],
			mapped: verifiedModuleUrls
		},
		{
			case: 'a wrong-path mapping',
			expected: expectedNetworkModuleUrls,
			mapped: {
				[runtimeProfile.moduleUrl]: compilerUrl,
				[`https://app.example/wasm-rust/other-worker.js${new URL(runtimeProfile.moduleUrl).search}`]:
					workerBlobUrl
			}
		}
	])('rejects $case before importing the compiler', async ({ expected, mapped }) => {
		const importModule = vi.fn(async () => {
			throw new Error('must not import');
		});
		const service = createRustWorkerService(importModule);

		await expect(
			service.initialize?.(
				{
					compilerUrl,
					expectedNetworkModuleUrls: expected,
					verifiedModuleUrls: mapped,
					graphFingerprint: 'a'.repeat(64),
					runtimeProfile
				},
				{ documents: new Map(), publishDiagnostics: vi.fn(), reportProgress: vi.fn() }
			)
		).rejects.toThrow('must exactly match the expected executable graph URL set');
		expect(importModule).not.toHaveBeenCalled();
	});

	it('rejects a non-canonical expected network module URL before importing', async () => {
		const importModule = vi.fn(async () => {
			throw new Error('must not import');
		});
		const service = createRustWorkerService(importModule);

		await expect(
			service.initialize?.(
				{
					compilerUrl,
					expectedNetworkModuleUrls: [`${runtimeProfile.moduleUrl}#unexpected`],
					verifiedModuleUrls: { [runtimeProfile.moduleUrl]: compilerUrl },
					graphFingerprint: 'a'.repeat(64),
					runtimeProfile
				},
				{ documents: new Map(), publishDiagnostics: vi.fn(), reportProgress: vi.fn() }
			)
		).rejects.toThrow('network module URL is invalid');
		expect(importModule).not.toHaveBeenCalled();
	});

	it('rejects non-canonical network queries and duplicate Blob mappings', async () => {
		const context = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		const nonCanonical = createRustWorkerService(async () => {
			throw new Error('must not import');
		});
		const nonCanonicalNetworkUrl = 'https://app.example/wasm-rust/worker.js?v=wrong';
		await expect(
			nonCanonical.initialize?.(
				{
					compilerUrl,
					expectedNetworkModuleUrls: [runtimeProfile.moduleUrl, nonCanonicalNetworkUrl],
					verifiedModuleUrls: {
						[runtimeProfile.moduleUrl]: compilerUrl,
						[nonCanonicalNetworkUrl]: workerBlobUrl
					},
					graphFingerprint: 'a'.repeat(64),
					runtimeProfile
				},
				context
			)
		).rejects.toThrow('network module URL has a non-canonical receipt query');

		const duplicate = createRustWorkerService(async () => {
			throw new Error('must not import');
		});
		const duplicateNetworkUrl = `https://app.example/wasm-rust/worker.js${new URL(runtimeProfile.moduleUrl).search}`;
		await expect(
			duplicate.initialize?.(
				{
					compilerUrl,
					expectedNetworkModuleUrls: [runtimeProfile.moduleUrl, duplicateNetworkUrl],
					verifiedModuleUrls: {
						[runtimeProfile.moduleUrl]: compilerUrl,
						[duplicateNetworkUrl]: compilerUrl
					},
					graphFingerprint: 'a'.repeat(64),
					runtimeProfile
				},
				context
			)
		).rejects.toThrow('one-to-one');
	});
});
