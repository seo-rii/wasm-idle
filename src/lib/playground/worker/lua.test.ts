// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/playground/fennelBootstrap', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/playground/fennelBootstrap')>()),
	loadFennelCompilerSource: vi.fn(async () => '-- fennel compiler')
}));

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
				options.onReady?.();
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

		const request = {
			code: 'print("ok")',
			buffer: new SharedArrayBuffer(1024),
			args: ['5'],
			stdin: '4\n',
			activePath: 'main.lua',
			workspaceFiles: [{ path: 'lib.lua', content: 'return 1' }],
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
					label: 'Lua program started'
				}
			}
		]);
		expect(readyIndex).toBeGreaterThanOrEqual(0);
		expect(readyIndex).toBeLessThan(
			messages.findIndex((message: any) => message.output === 'factorial_plus_bonus=27\n')
		);
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

	it('reports a nonzero Lua exit without repeating already-streamed stderr', async () => {
		const moduleUrl = await createMockLuaRuntimeModule(`
			export async function createLuaCompiler() {
				return {
					async compile(options) {
						return {
							success: true,
							artifact: { fileName: options.fileName, source: options.code }
						};
					}
				};
			}

			export async function executeBrowserLuaArtifact(_artifact, options = {}) {
				options.stderr?.('main.lua:1: boom\\n');
				return { exitCode: 1, stdout: '', stderr: 'main.lua:1: boom\\n' };
			}

			export default createLuaCompiler;
		`);

		await import('./lua');
		await (globalThis as any).self.onmessage({ data: { load: true, moduleUrl } });
		await (globalThis as any).self.onmessage({
			data: {
				code: 'error("boom")',
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				stdin: ''
			}
		});

		const messages = (globalThis as any).postMessage.mock.calls.map(
			([message]: [any]) => message
		);
		expect(messages.filter((message: any) => 'output' in message)).toEqual([
			{ output: 'main.lua:1: boom\n' }
		]);
		expect(messages.at(-1)).toEqual({ error: 'Lua program exited with code 1' });
	});

	it('keeps unstreamed Fennel stderr in the nonzero exit error', async () => {
		const moduleUrl = await createMockLuaRuntimeModule(`
			export async function createLuaCompiler() {
				return { async compile() { throw new Error('Fennel must not use the Lua compiler'); } };
			}

			export async function executeBrowserLuaArtifact(_artifact, options = {}) {
				if (!options.stderr) return { exitCode: 0, stdout: '', stderr: '' };
				const stderr = 'main.fnl:2: boom\\nstack traceback:\\n\\t[C]: in ?\\n';
				options.stderr(stderr);
				return { exitCode: 1, stdout: '', stderr };
			}

			export default createLuaCompiler;
		`);

		await import('./lua');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl,
				fennelCompiler: { url: 'https://runtime.example/fennel.lua' }
			}
		});
		await (globalThis as any).self.onmessage({
			data: {
				code: '(error "boom")',
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				stdin: '',
				activePath: 'main.fnl'
			}
		});

		const messages = (globalThis as any).postMessage.mock.calls.map(
			([message]: [any]) => message
		);
		expect(messages.filter((message: any) => 'output' in message)).toEqual([]);
		expect(messages.at(-1)).toEqual({
			error: 'Fennel program exited with code 1\nmain.fnl:2: boom'
		});
	});
});
