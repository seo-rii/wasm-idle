import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createGoWorkerService } from '../src/index.js';

const compilerModuleUrl = () =>
	`data:text/javascript;base64,${Buffer.from(
		`
		export async function createGoCompiler() {
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
});
