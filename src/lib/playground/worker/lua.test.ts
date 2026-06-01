import { beforeEach, describe, expect, it, vi } from 'vitest';

async function createMockLuaRuntimeModule(source: string) {
	return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

describe('Lua worker', () => {
	beforeEach(() => {
		vi.resetModules();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).document = undefined;
		(globalThis as any).postMessage = vi.fn();
		(globalThis as any).__lastCompileOptions = undefined;
		(globalThis as any).__lastExecution = undefined;
	});

	it('loads a wasm-lua-style compiler module and runs the returned artifact', async () => {
		const moduleUrl = await createMockLuaRuntimeModule(`
			export async function createLuaCompiler() {
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
								fileName: options.fileName,
								source: options.code
							}
						};
					}
				};
			}

			export async function executeBrowserLuaArtifact(artifact, options = {}) {
				globalThis.__lastExecution = { artifact, options };
				options.stdout?.('factorial_plus_bonus=27\\n');
				return {
					exitCode: 0,
					stdout: 'factorial_plus_bonus=27\\n',
					stderr: ''
				};
			}

			export default createLuaCompiler;
		`);

		await import('./lua');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'print("ok")',
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				args: ['5'],
				stdin: '4\n',
				activePath: 'main.lua',
				workspaceFiles: [{ path: 'lib.lua', content: 'return 1' }],
				log: true
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			diagnostic: {
				fileName: 'main.lua',
				lineNumber: 1,
				columnNumber: 2,
				severity: 'warning',
				message: 'demo warning'
			}
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'compile log\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			output: 'factorial_plus_bonus=27\n'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
		expect((globalThis as any).__lastCompileOptions).toEqual({
			code: 'print("ok")',
			fileName: 'main.lua',
			log: true
		});
		expect((globalThis as any).__lastExecution.options.args).toEqual(['5']);
	});

	it('reports compiler failures as worker errors after forwarding diagnostics', async () => {
		const moduleUrl = await createMockLuaRuntimeModule(`
			export async function createLuaCompiler() {
				return {
					async compile() {
						return {
							success: false,
							stderr: 'error: bad lua',
							diagnostics: [
								{
									fileName: 'bad.lua',
									lineNumber: 1,
									severity: 'error',
									message: 'bad lua'
								}
							]
						};
					}
				};
			}

			export async function executeBrowserLuaArtifact() {
				throw new Error('should not execute');
			}

			export default createLuaCompiler;
		`);

		await import('./lua');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl
			}
		});
		await Promise.resolve();
		await (globalThis as any).self.onmessage({
			data: {
				code: 'bad',
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				activePath: 'bad.lua'
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			diagnostic: {
				fileName: 'bad.lua',
				lineNumber: 1,
				columnNumber: undefined,
				endColumnNumber: undefined,
				severity: 'error',
				message: 'bad lua'
			}
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ error: 'error: bad lua' });
	});
});
