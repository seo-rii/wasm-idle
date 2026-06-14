import { beforeEach, describe, expect, it, vi } from 'vitest';

const { phpInstances, loadWebRuntimeMock, runResponses, MockPhp } = vi.hoisted(() => {
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
		loadWebRuntimeMock: vi.fn(async (version: string) => ({ version })),
		runResponses,
		MockPhp
	};
});

vi.mock('@php-wasm/web', () => ({
	loadWebRuntime: loadWebRuntimeMock
}));

vi.mock('@php-wasm/universal', () => ({
	PHP: MockPhp
}));

describe('PHP worker', () => {
	beforeEach(() => {
		vi.resetModules();
		phpInstances.length = 0;
		loadWebRuntimeMock.mockClear();
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
		await import('./php');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				version: '8.4'
			}
		});
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

		expect(loadWebRuntimeMock).toHaveBeenCalledWith('8.4');
		expect(phpInstances).toHaveLength(1);
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
			output: 'factorial_plus_bonus=27\n'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('reports nonzero PHP exits as worker errors', async () => {
		runResponses.push({
			text: '',
			errors: 'fatal demo error',
			exitCode: 1
		});
		await import('./php');
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
