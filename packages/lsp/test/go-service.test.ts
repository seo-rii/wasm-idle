import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createGoWorkerService } from '../src/index.js';

const compilerModuleUrl = () =>
	`data:text/javascript;base64,${Buffer.from(
		`
		export async function createGoCompiler(options) {
			globalThis.__lastGoLspFactoryOptions = options;
			return {
				async compile(request) {
					globalThis.__lastGoLspCompile = request;
					request.onProgress?.({ stage: 'compile', completed: 1, total: 2 });
					return {
						success: false,
						diagnostics: [
							{
								lineNumber: 3,
								columnNumber: 2,
								endColumnNumber: 9,
								severity: 'error',
								message: 'undefined: missing'
							}
						]
					};
				}
			};
		}
		export default createGoCompiler;
	`,
		'utf8'
	).toString('base64')}`;

describe('createGoWorkerService', () => {
	beforeEach(() => {
		(globalThis as any).__lastGoLspCompile = undefined;
	});

	it('uses the real wasm-go compiler API for diagnostics', async () => {
		const service = createGoWorkerService();
		const reportProgress = vi.fn();
		const context = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress
		};

		await service.initialize?.(
			{
				compilerUrl: compilerModuleUrl(),
				target: 'wasip2/wasm'
			},
			context
		);
		const diagnostics = await service.diagnostics?.(
			{
				uri: 'file:///workspace/main.go',
				languageId: 'go',
				version: 1,
				text: 'package main\n\nfunc main() { missing }\n'
			},
			context
		);

		// Without a configured manifest wasm-go resolves the one next to its module.
		expect((globalThis as any).__lastGoLspFactoryOptions).toBeUndefined();
		expect((globalThis as any).__lastGoLspCompile).toMatchObject({
			code: 'package main\n\nfunc main() { missing }\n',
			target: 'wasip2/wasm',
			prepare: true,
			log: false
		});
		expect(diagnostics).toEqual([
			{
				range: {
					start: { line: 2, character: 1 },
					end: { line: 2, character: 8 }
				},
				severity: 1,
				source: 'go',
				message: 'undefined: missing'
			}
		]);
		expect(reportProgress).toHaveBeenCalledWith('load-go-compiler');
		expect(reportProgress).toHaveBeenCalledWith('compile', 1, 2);
	});

	it('loads the runtime manifest that the playground runtime uses', async () => {
		const service = createGoWorkerService();
		const context = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		await service.initialize?.(
			{
				compilerUrl: compilerModuleUrl(),
				runtimeManifestUrl:
					'https://app.example/wasm-go/runtime/runtime-manifest.v1.json?v=7'
			},
			context
		);
		expect((globalThis as any).__lastGoLspFactoryOptions).toEqual({
			runtimeManifestUrl: 'https://app.example/wasm-go/runtime/runtime-manifest.v1.json?v=7'
		});
	});
});
