import { beforeEach, describe, expect, it, vi } from 'vitest';

const { importRuntimeModuleMock } = vi.hoisted(() => ({
	importRuntimeModuleMock: vi.fn()
}));

vi.mock('$lib/playground/runtimeModule', () => ({
	importRuntimeModule: importRuntimeModuleMock
}));

async function loadWorker() {
	await import('./assemblyscript');
	await (globalThis as any).self.onmessage({
		data: {
			load: true,
			moduleUrl: '/wasm-assemblyscript/runtime.mjs'
		}
	});
}

describe('AssemblyScript worker', () => {
	beforeEach(() => {
		vi.resetModules();
		importRuntimeModuleMock.mockReset();
		importRuntimeModuleMock.mockImplementation(async () => ({
			instantiate: (await import('@assemblyscript/loader')).instantiate,
			loadCompiler: async () => await import('assemblyscript/asc')
		}));
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = vi.fn();
	});

	it('compiles AssemblyScript source and prints zero-argument exports', async () => {
		await loadWorker();
		await (globalThis as any).self.onmessage({
			data: {
				code: `const bonus: i32 = 3;

function factorial(n: i32): i32 {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

export function factorial_plus_bonus(): i32 {
  return factorial(4) + bonus;
}`,
				prepare: false,
				activePath: 'main.as.ts',
				workspaceFiles: []
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			output: 'factorial_plus_bonus=27\n'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	}, 15000);

	it('decodes string and boolean export results from declaration metadata', async () => {
		await loadWorker();
		await (globalThis as any).self.onmessage({
			data: {
				code: `export function greeting(): string {
  return "hello";
}

export function ok(): bool {
  return true;
}`,
				prepare: false,
				activePath: 'main.as.ts',
				workspaceFiles: []
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			output: 'greeting=hello\n'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'ok=true\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	}, 15000);

	it('provides injected stdin through env readLine, readByte, and readAll imports', async () => {
		await loadWorker();
		await (globalThis as any).self.onmessage({
			data: {
				code: `@external("env", "readLine")
declare function readLine(): string | null;
@external("env", "readByte")
declare function readByte(): i32;
@external("env", "readAll")
declare function readAll(): string;

export function main(): string {
  const line = readLine();
  const byte = readByte();
  return (line == null ? "EOF" : line) + ":" + byte.toString() + ":" + readAll();
}`,
				prepare: false,
				stdin: '5\nabc',
				activePath: 'main.as.ts',
				workspaceFiles: []
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			output: 'main=5:97:bc\n'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	}, 15000);

	it('reports compiler failures as diagnostics and worker errors', async () => {
		await loadWorker();
		await (globalThis as any).self.onmessage({
			data: {
				code: 'export function broken(): i32 { return nope; }',
				prepare: false,
				activePath: 'main.as.ts',
				workspaceFiles: []
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			diagnostic: expect.objectContaining({
				fileName: 'main.as.ts',
				lineNumber: 1,
				columnNumber: 40,
				severity: 'error'
			})
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: expect.stringContaining("Cannot find name 'nope'")
		});
	}, 15000);
});
