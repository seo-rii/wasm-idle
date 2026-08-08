import { beforeEach, describe, expect, it, vi } from 'vitest';

const { phpInstances, createPhp84Mock, materializedFiles, operationLog, MockPhp } = vi.hoisted(
	() => {
		const phpInstances: any[] = [];
		const materializedFiles = new Set<string>();
		const operationLog: string[] = [];

		class MockPhp {
			mkdir = vi.fn((path: string) => operationLog.push(`mkdir:${path}`));
			rmdir = vi.fn((path: string) => {
				operationLog.push(`rmdir:${path}`);
				materializedFiles.clear();
			});
			writeFile = vi.fn((path: string) => {
				operationLog.push(`write:${path}`);
				materializedFiles.add(path);
			});
			run = vi.fn(async ({ scriptPath }: { scriptPath: string }) => {
				operationLog.push(`run:${scriptPath}`);
				return { text: '', errors: '', exitCode: 0 };
			});

			constructor() {
				phpInstances.push(this);
			}
		}

		return {
			phpInstances,
			createPhp84Mock: vi.fn(async () => new MockPhp()),
			materializedFiles,
			operationLog,
			MockPhp
		};
	}
);

vi.mock('$lib/playground/runtimeModule', () => ({
	importRuntimeModule: vi.fn(async () => ({ createPhp84: createPhp84Mock }))
}));

async function send(data: Record<string, unknown>) {
	await (globalThis as any).self.onmessage({ data });
}

describe('PHP worker workspace lifecycle', () => {
	beforeEach(async () => {
		vi.resetModules();
		phpInstances.length = 0;
		createPhp84Mock.mockClear();
		materializedFiles.clear();
		operationLog.length = 0;
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = vi.fn();
		await import('./php');
		await send({ load: true, moduleUrl: '/wasm-php/runtime.mjs' });
	});

	it('removes the previous run workspace before materializing the next request', async () => {
		await send({
			code: '<?php require __DIR__ . "/old.php";',
			prepare: false,
			buffer: new SharedArrayBuffer(4096),
			activePath: 'main.php',
			workspaceFiles: [{ path: 'old.php', content: '<?php return 1;' }]
		});
		await send({
			code: '<?php require __DIR__ . "/new.php";',
			prepare: false,
			buffer: new SharedArrayBuffer(4096),
			activePath: 'nested/main.php',
			workspaceFiles: [{ path: 'nested/new.php', content: '<?php return 2;' }]
		});

		expect(createPhp84Mock).toHaveBeenCalledOnce();
		expect(phpInstances).toHaveLength(1);
		const resetIndex = operationLog.indexOf('rmdir:/workspace');
		expect(resetIndex).toBeGreaterThan(operationLog.indexOf('run:/workspace/main.php'));
		expect(operationLog.indexOf('write:/workspace/nested/new.php')).toBeGreaterThan(resetIndex);
		expect(materializedFiles).toEqual(
			new Set(['/workspace/nested/new.php', '/workspace/nested/main.php'])
		);
	});
});
