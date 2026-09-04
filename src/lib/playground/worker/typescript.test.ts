import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

import { flushQueuedStdin } from '$lib/playground/stdinBuffer';

interface MockRuntimeModule {
	bytes: Uint8Array;
	importUrl: string;
}

const runtimeModules = new Map<string, MockRuntimeModule[]>();
const createdModuleBlobs: Blob[] = [];
let pendingModuleImportUrl = '';
let runtimeSequence = 0;

function registerMockTypeScriptRuntimeModule(source: string, moduleUrl?: string) {
	const bytes = new TextEncoder().encode(source);
	const url = moduleUrl ?? `https://runtime.example/typescript-${++runtimeSequence}.js`;
	const modules = runtimeModules.get(url) ?? [];
	modules.push({
		bytes,
		importUrl: `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`
	});
	runtimeModules.set(url, modules);
	return {
		moduleUrl: url,
		moduleReceipt: {
			bytes: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex')
		}
	};
}

describe('TypeScript worker', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		runtimeModules.clear();
		createdModuleBlobs.length = 0;
		pendingModuleImportUrl = '';
		(globalThis as any).self = globalThis as any;
		(globalThis as any).document = undefined;
		(globalThis as any).postMessage = vi.fn();
		(globalThis as any).__lastCompileOptions = undefined;
		(globalThis as any).__lastExecution = undefined;
		(globalThis as any).__lastStdin = undefined;
		(globalThis as any).__factoryCalls = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = input instanceof Request ? input.url : String(input);
				const modules = runtimeModules.get(url);
				const runtimeModule = modules?.shift();
				if (!runtimeModule)
					throw new Error(`Unexpected TypeScript runtime request: ${url}`);
				pendingModuleImportUrl = runtimeModule.importUrl;
				const response = new Response(Uint8Array.from(runtimeModule.bytes).buffer, {
					status: 200,
					headers: { 'content-length': String(runtimeModule.bytes.byteLength) }
				});
				Object.defineProperty(response, 'url', { value: url });
				return response;
			})
		);
		vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			if (!(blob instanceof Blob)) throw new TypeError('Expected a TypeScript module Blob');
			createdModuleBlobs.push(blob);
			return pendingModuleImportUrl;
		});
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
	});

	it('loads a wasm-typescript-style module and executes the compiled artifact', async () => {
		const source = `
			export async function createTypeScriptCompiler() {
				globalThis.__factoryCalls += 1;
				return {
					async compile(options) {
						globalThis.__lastCompileOptions = options;
						return {
							stdout: 'build log\\n',
							success: true,
							diagnostics: [
								{
									fileName: 'main.ts',
									lineNumber: 1,
									columnNumber: 1,
									severity: 'warning',
									message: 'demo warning'
								}
							],
							artifact: {
								javascript: 'console.log("hi")',
								language: options.language,
								fileName: options.fileName
							}
						};
					}
				};
			}

			export async function executeBrowserTypeScriptArtifact(artifact, options = {}) {
				globalThis.__lastExecution = { artifact, options };
				options.onReady?.();
				options.stdout?.('hi\\n');
				return {
					exitCode: 0,
					stdout: 'hi\\n',
					stderr: ''
				};
			}

			export default createTypeScriptCompiler;
		`;
		const { moduleUrl, moduleReceipt } = registerMockTypeScriptRuntimeModule(source);

		await import('./typescript');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl,
				moduleReceipt,
				maxAssetBytes: moduleReceipt.bytes
			}
		});
		await Promise.resolve();

		const request = {
			code: 'const value: number = 1;',
			buffer: new SharedArrayBuffer(1024),
			args: ['one'],
			language: 'typescript',
			activePath: 'main.ts',
			log: true
		};
		await (globalThis as any).self.onmessage({
			data: { ...request, prepare: true }
		});
		expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({
			progress: expect.objectContaining({ kind: 'ready' })
		});
		await (globalThis as any).self.onmessage({
			data: {
				...request,
				prepare: false
			}
		});
		await Promise.resolve();

		const messages = (globalThis as any).postMessage.mock.calls.map(
			([message]: [any]) => message
		);
		const readyIndex = messages.findIndex((message: any) => message.progress?.kind === 'ready');
		expect(messages.filter((message: any) => message.progress?.kind === 'ready')).toEqual([
			{
				progress: {
					kind: 'ready',
					state: 'running',
					reason: 'started',
					label: 'TypeScript program started'
				}
			}
		]);
		expect(readyIndex).toBeGreaterThanOrEqual(0);
		expect(readyIndex).toBeLessThan(
			messages.findIndex((message: any) => message.output === 'hi\n')
		);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			diagnostic: {
				fileName: 'main.ts',
				lineNumber: 1,
				columnNumber: 1,
				severity: 'warning',
				message: 'demo warning'
			}
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'build log\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'hi\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
		expect((globalThis as any).__lastCompileOptions.language).toBe('typescript');
		expect((globalThis as any).__lastCompileOptions.fileName).toBe('main.ts');
		expect((globalThis as any).__lastExecution.options.args).toEqual(['one']);
		expect((globalThis as any).__lastExecution.options.env).toEqual({ USER: 'jungol' });
		expect((globalThis as any).__factoryCalls).toBe(1);
		expect(createdModuleBlobs).toHaveLength(1);
		expect(await createdModuleBlobs[0].text()).toBe(source);
		expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
	});

	it('reads injected stdin without waiting for terminal input', async () => {
		const { moduleUrl, moduleReceipt } = registerMockTypeScriptRuntimeModule(`
			export async function createTypeScriptCompiler() {
				return {
					async compile(options) {
						return {
							success: true,
							artifact: {
								javascript: options.code,
								language: options.language,
								fileName: options.fileName
							}
						};
					}
				};
			}

			export async function executeBrowserTypeScriptArtifact(_artifact, options = {}) {
				options.onReady?.();
				const first = options.stdin?.();
				const second = options.stdin?.();
				globalThis.__lastStdin = [first, second];
				options.stdout?.(String(first ?? ''));
				return {
					exitCode: 0,
					stdout: String(first ?? ''),
					stderr: ''
				};
			}

			export default createTypeScriptCompiler;
		`);

		await import('./typescript');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl,
				moduleReceipt,
				maxAssetBytes: moduleReceipt.bytes
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'console.log(1)',
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				stdin: 'injected\n',
				language: 'javascript',
				activePath: 'main.js'
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({ buffer: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			progress: {
				kind: 'ready',
				state: 'running',
				reason: 'started',
				label: 'JavaScript program started'
			}
		});
		expect((globalThis as any).__lastStdin).toEqual(['injected\n', null]);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'injected\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('reads terminal stdin from the shared buffer when no stdin is injected', async () => {
		const { moduleUrl, moduleReceipt } = registerMockTypeScriptRuntimeModule(`
			export async function createTypeScriptCompiler() {
				return {
					async compile(options) {
						return {
							success: true,
							artifact: {
								javascript: options.code,
								language: options.language,
								fileName: options.fileName
							}
						};
					}
				};
			}

			export async function executeBrowserTypeScriptArtifact(_artifact, options = {}) {
				const chunk = options.stdin?.() || '';
				globalThis.__lastStdin = chunk;
				options.stdout?.(chunk);
				return {
					exitCode: 0,
					stdout: chunk,
					stderr: ''
				};
			}

			export default createTypeScriptCompiler;
		`);
		const buffer = new SharedArrayBuffer(1024);
		const queuedInput = ['5\n'];

		(globalThis as any).postMessage = vi.fn((message: any) => {
			if (message?.buffer) {
				flushQueuedStdin(queuedInput, buffer);
			}
		});

		await import('./typescript');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl,
				moduleReceipt,
				maxAssetBytes: moduleReceipt.bytes
			}
		});
		await Promise.resolve();
		await (globalThis as any).self.onmessage({
			data: {
				code: 'console.log(1)',
				prepare: false,
				buffer,
				language: 'javascript',
				activePath: 'main.js'
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ buffer: true });
		expect((globalThis as any).__lastStdin).toBe('5\n');
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: '5\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('fails closed before fetching when the integrity receipt is missing', async () => {
		await import('./typescript');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl: 'https://runtime.example/typescript.js',
				maxAssetBytes: 1024
			}
		});

		expect(globalThis.fetch).not.toHaveBeenCalled();
		expect(URL.createObjectURL).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'TypeScript runtime integrity receipt is required'
		});
	});

	it('validates every receipt and byte limit before returning a cached runtime', async () => {
		const registered = registerMockTypeScriptRuntimeModule(`
			export async function createTypeScriptCompiler() {
				globalThis.__factoryCalls += 1;
				return {};
			}
			export async function executeBrowserTypeScriptArtifact() { return {}; }
		`);
		await import('./typescript');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl: registered.moduleUrl,
				moduleReceipt: registered.moduleReceipt,
				maxAssetBytes: registered.moduleReceipt.bytes
			}
		});

		for (const data of [
			{
				load: true,
				moduleUrl: registered.moduleUrl,
				maxAssetBytes: registered.moduleReceipt.bytes
			},
			{
				load: true,
				moduleUrl: registered.moduleUrl,
				moduleReceipt: registered.moduleReceipt,
				maxAssetBytes: registered.moduleReceipt.bytes - 1
			},
			{
				load: true,
				moduleUrl: registered.moduleUrl,
				moduleReceipt: registered.moduleReceipt,
				maxAssetBytes: 1.5
			}
		]) {
			await (globalThis as any).self.onmessage({ data });
		}

		expect(globalThis.fetch).toHaveBeenCalledOnce();
		expect(URL.createObjectURL).toHaveBeenCalledOnce();
		expect((globalThis as any).__factoryCalls).toBe(1);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'TypeScript runtime integrity receipt is required'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: `TypeScript runtime module exceeds the ${registered.moduleReceipt.bytes - 1} byte limit`
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'TypeScript runtime maxAssetBytes must be a positive safe integer'
		});
	});

	it.each([
		['size', { bytes: 1, sha256: '0'.repeat(64) }],
		['digest', { bytes: 0, sha256: '0'.repeat(64) }]
	])(
		'does not import or initialize a module with an integrity %s mismatch',
		async (_kind, patch) => {
			const registered = registerMockTypeScriptRuntimeModule(`
			globalThis.__factoryCalls += 1;
			export async function createTypeScriptCompiler() { return {}; }
			export async function executeBrowserTypeScriptArtifact() {
				return { exitCode: 0, stdout: '', stderr: '' };
			}
		`);
			const moduleReceipt = {
				...registered.moduleReceipt,
				...patch,
				bytes:
					patch.bytes === 0
						? registered.moduleReceipt.bytes
						: registered.moduleReceipt.bytes + 1
			};

			await import('./typescript');
			await (globalThis as any).self.onmessage({
				data: {
					load: true,
					moduleUrl: registered.moduleUrl,
					moduleReceipt,
					maxAssetBytes: moduleReceipt.bytes
				}
			});

			expect(URL.createObjectURL).not.toHaveBeenCalled();
			expect((globalThis as any).__factoryCalls).toBe(0);
			expect((globalThis as any).postMessage).toHaveBeenCalledWith({
				error: expect.stringMatching(/(size|SHA-256) mismatch/u)
			});
		}
	);

	it('revokes the verified module Blob URL when module evaluation fails', async () => {
		const { moduleUrl, moduleReceipt } = registerMockTypeScriptRuntimeModule(
			'throw new Error("module evaluation failed");'
		);

		await import('./typescript');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl,
				moduleReceipt,
				maxAssetBytes: moduleReceipt.bytes
			}
		});

		expect(URL.createObjectURL).toHaveBeenCalledOnce();
		expect(URL.revokeObjectURL).toHaveBeenCalledWith(pendingModuleImportUrl);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'module evaluation failed'
		});
	});

	it('does not let Blob URL cleanup failure replace a successful load', async () => {
		const { moduleUrl, moduleReceipt } = registerMockTypeScriptRuntimeModule(`
			export async function createTypeScriptCompiler() { return {}; }
			export async function executeBrowserTypeScriptArtifact() { return {}; }
		`);
		vi.mocked(URL.revokeObjectURL).mockImplementation(() => {
			throw new Error('cleanup failed');
		});

		await import('./typescript');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl,
				moduleReceipt,
				maxAssetBytes: moduleReceipt.bytes
			}
		});

		expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({
			error: 'cleanup failed'
		});
	});

	it('re-fetches and re-verifies the same URL when its receipt changes', async () => {
		const moduleUrl = 'https://runtime.example/typescript-changing.js';
		const first = registerMockTypeScriptRuntimeModule(
			`export async function createTypeScriptCompiler() {
				globalThis.__factoryCalls += 1;
				return {};
			}
			export async function executeBrowserTypeScriptArtifact() { return {}; }`,
			moduleUrl
		);
		const second = registerMockTypeScriptRuntimeModule(
			`export async function createTypeScriptCompiler() {
				globalThis.__factoryCalls += 10;
				return {};
			}
			export async function executeBrowserTypeScriptArtifact() { return {}; }`,
			moduleUrl
		);

		await import('./typescript');
		for (const moduleReceipt of [first.moduleReceipt, second.moduleReceipt]) {
			await (globalThis as any).self.onmessage({
				data: {
					load: true,
					moduleUrl,
					moduleReceipt,
					maxAssetBytes: moduleReceipt.bytes
				}
			});
		}

		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
		expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
		expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
		expect((globalThis as any).__factoryCalls).toBe(11);
	});
});
