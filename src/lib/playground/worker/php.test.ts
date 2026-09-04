import { beforeEach, describe, expect, it, vi } from 'vitest';

const { phpInstances, createPhp84Mock, runResponses, MockPhp } = vi.hoisted(() => {
	const runResponses: Array<{ text: string; errors: string; exitCode: number }> = [];
	const phpInstances: any[] = [];

	class MockPhp {
		mkdir = vi.fn();
		writeFile = vi.fn();
		run = vi.fn(async () => runResponses.shift() ?? { text: '', errors: '', exitCode: 0 });
		runtime: unknown;

		constructor(runtime: unknown) {
			this.runtime = runtime;
			phpInstances.push(this);
		}
	}

	return {
		phpInstances,
		createPhp84Mock: vi.fn(async () => new MockPhp('php-8.4')),
		runResponses,
		MockPhp
	};
});

vi.mock('$lib/playground/runtimeModule', () => ({
	importRuntimeModule: vi.fn(async () => ({ createPhp84: createPhp84Mock }))
}));

async function loadWorker() {
	await import('./php');
	await (globalThis as any).self.onmessage({
		data: {
			load: true,
			moduleUrl: '/wasm-php/runtime.mjs'
		}
	});
}

describe('PHP worker', () => {
	beforeEach(() => {
		vi.resetModules();
		phpInstances.length = 0;
		createPhp84Mock.mockClear();
		runResponses.length = 0;
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = vi.fn();
	});

	it('loads PHP, injects argv, writes workspace files, and passes stdin to php.run', async () => {
		runResponses.push({
			text: 'factorial_plus_bonus=27\n',
			errors: '',
			exitCode: 0
		});
		await loadWorker();
		await (globalThis as any).self.onmessage({
			data: {
				code: "<?php echo file_get_contents('php://input');",
				prepare: false,
				buffer: new SharedArrayBuffer(4096),
				args: ['7'],
				stdin: '4\n',
				activePath: 'main.php',
				workspaceFiles: [
					{ path: 'lib/util.php', content: '<?php function bonus() { return 3; }' }
				]
			}
		});

		expect(createPhp84Mock).toHaveBeenCalledOnce();
		expect(phpInstances).toHaveLength(1);
		expect(phpInstances[0].runtime).toBe('php-8.4');
		expect(phpInstances[0].mkdir).toHaveBeenCalledWith('/workspace');
		expect(phpInstances[0].writeFile).toHaveBeenCalledWith(
			'/workspace/lib/util.php',
			'<?php function bonus() { return 3; }'
		);
		expect(phpInstances[0].writeFile).toHaveBeenCalledWith(
			'/workspace/main.php',
			expect.stringContaining("$argv = array('main.php', '7');")
		);
		expect(phpInstances[0].run).toHaveBeenCalledWith(
			expect.objectContaining({
				scriptPath: '/workspace/main.php',
				body: '4\n',
				env: {
					USER: 'jungol'
				},
				$_SERVER: {
					SCRIPT_FILENAME: '/workspace/main.php',
					SCRIPT_NAME: '/main.php'
				}
			})
		);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			progress: { percent: 5 }
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			progress: { percent: 95 }
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			progress: { percent: 100 }
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				progress: expect.objectContaining({
					kind: 'ready',
					state: 'running',
					reason: 'started'
				})
			})
		);
		const readyCall = (globalThis as any).postMessage.mock.calls.findIndex(
			([message]: [any]) => message?.progress?.kind === 'ready'
		);
		const outputCall = (globalThis as any).postMessage.mock.calls.findIndex(
			([message]: [any]) => message?.output
		);
		expect(readyCall).toBeGreaterThanOrEqual(0);
		expect(readyCall).toBeLessThan(outputCall);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			output: 'factorial_plus_bonus=27\n'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it.each([
		{
			label: 'strict_types declaration',
			code: '<?php\ndeclare(strict_types=1);\necho $argc;',
			header: 'declare(strict_types=1);',
			body: 'echo $argc;'
		},
		{
			label: 'unbracketed namespace declaration',
			code: '<?php\ndeclare(strict_types=1);\nnamespace Demo\\Cli;\necho $argc;',
			header: 'namespace Demo\\Cli;',
			body: 'echo $argc;'
		},
		{
			label: 'bracketed namespace declaration',
			code: '<?php\ndeclare(strict_types=1);\nnamespace Demo\\Cli { echo $argc; }',
			header: 'namespace Demo\\Cli {',
			body: 'echo $argc;'
		}
	])('injects argv after the required $label header', async ({ code, header, body }) => {
		await loadWorker();
		await (globalThis as any).self.onmessage({
			data: {
				code,
				prepare: false,
				buffer: new SharedArrayBuffer(4096),
				args: ['value'],
				activePath: 'main.php',
				workspaceFiles: []
			}
		});

		const source = phpInstances[0].writeFile.mock.calls.find(
			([path]: [string]) => path === '/workspace/main.php'
		)?.[1] as string;
		expect(source.indexOf('declare(strict_types=1);')).toBeLessThan(
			source.indexOf("$argv = array('main.php', 'value');")
		);
		expect(source.indexOf(header)).toBeLessThan(
			source.indexOf("$argv = array('main.php', 'value');")
		);
		expect(source.indexOf("$argv = array('main.php', 'value');")).toBeLessThan(
			source.indexOf(body)
		);
	});

	it('reports nonzero PHP exits as worker errors', async () => {
		runResponses.push({
			text: '',
			errors: 'fatal demo error',
			exitCode: 1
		});
		await loadWorker();
		await (globalThis as any).self.onmessage({
			data: {
				code: '<?php exit(1);',
				prepare: false,
				buffer: new SharedArrayBuffer(4096),
				activePath: 'main.php',
				workspaceFiles: []
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: expect.stringContaining('PHP program exited with code 1')
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: expect.stringContaining('fatal demo error')
		});
	});
});
