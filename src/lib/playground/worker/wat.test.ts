import { beforeEach, describe, expect, it, vi } from 'vitest';

async function createMockWatRuntimeModule(source: string) {
	return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

describe('WAT worker', () => {
	beforeEach(() => {
		vi.resetModules();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).document = undefined;
		(globalThis as any).postMessage = vi.fn();
		(globalThis as any).__lastCompileOptions = undefined;
		(globalThis as any).__lastExecution = undefined;
	});

	it('loads a wasm-wat-style compiler module and runs the returned artifact', async () => {
		const moduleUrl = await createMockWatRuntimeModule(`
			export async function createWatCompiler() {
				return {
					async compile(options) {
						globalThis.__lastCompileOptions = options;
						return {
							stdout: 'compile log\\n',
							success: true,
							diagnostics: [
								{
									fileName: options.fileName,
									lineNumber: 1,
									columnNumber: 2,
									severity: 'warning',
									message: 'demo warning'
								}
							],
							artifact: {
								wasm: new Uint8Array([0, 97, 115, 109]),
								fileName: options.fileName,
								source: options.code
							}
						};
					}
				};
			}

			export async function executeBrowserWatArtifact(artifact, options = {}) {
				globalThis.__lastExecution = { artifact, options };
				options.stdout?.('answer=45\\n');
				return {
					exitCode: 0,
					stdout: 'answer=45\\n',
					stderr: ''
				};
			}

			export default createWatCompiler;
		`);

		await import('./wat');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: '(module)',
				prepare: false,
				activePath: 'main.wat',
				workspaceFiles: [{ path: 'lib.wat', content: '(module)' }],
				log: true
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			diagnostic: {
				fileName: 'main.wat',
				lineNumber: 1,
				columnNumber: 2,
				severity: 'warning',
				message: 'demo warning'
			}
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'compile log\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'answer=45\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
		expect((globalThis as any).__lastCompileOptions).toEqual({
			code: '(module)',
			fileName: 'main.wat',
			log: true
		});
		expect((globalThis as any).__lastExecution.options.activePath).toBe('main.wat');
	});

	it('reports compiler failures as worker errors after forwarding diagnostics', async () => {
		const moduleUrl = await createMockWatRuntimeModule(`
			export async function createWatCompiler() {
				return {
					async compile() {
						return {
							success: false,
							stderr: 'error: bad wat',
							diagnostics: [
								{
									fileName: 'bad.wat',
									lineNumber: 1,
									severity: 'error',
									message: 'bad wat'
								}
							]
						};
					}
				};
			}

			export async function executeBrowserWatArtifact() {
				throw new Error('should not execute');
			}

			export default createWatCompiler;
		`);

		await import('./wat');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl
			}
		});
		await Promise.resolve();
		await (globalThis as any).self.onmessage({
			data: {
				code: '(bad)',
				prepare: false,
				activePath: 'bad.wat'
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			diagnostic: {
				fileName: 'bad.wat',
				lineNumber: 1,
				columnNumber: undefined,
				endColumnNumber: undefined,
				severity: 'error',
				message: 'bad wat'
			}
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ error: 'error: bad wat' });
	});
});
