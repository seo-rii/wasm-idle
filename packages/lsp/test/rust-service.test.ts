import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRustWorkerService } from '../src/index.js';

const compilerModuleUrl = () =>
	`data:text/javascript;base64,${Buffer.from(
		`
		export async function createRustCompiler() {
			return {
				async compile(request) {
					globalThis.__lastRustLspCompile = request;
					request.onProgress?.({ stage: 'rustc-main', completed: 1, total: 2 });
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
			};
		}
		export default createRustCompiler;
	`,
		'utf8'
	).toString('base64')}`;

describe('createRustWorkerService', () => {
	beforeEach(() => {
		(globalThis as any).__lastRustLspCompile = undefined;
	});

	it('uses the real wasm-rust compiler API for diagnostics', async () => {
		const service = createRustWorkerService();
		const reportProgress = vi.fn();
		const context = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress
		};

		await service.initialize?.(
			{
				compilerUrl: compilerModuleUrl(),
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
			log: false
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
		expect(reportProgress).toHaveBeenCalledWith('rustc-main', 1, 2);
	});
});
