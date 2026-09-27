// @vitest-environment node

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('./dotnet.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
function harness(prepare?: (request?: { language?: string }) => Promise<void>) {
	const compile = vi.fn();
	const execute = vi.fn();
	const messages: any[] = [];
	const create = vi.fn(() => ({ prepare, compile }));
	const context: any = {
		exports: {},
		postMessage: (message: unknown) => messages.push(message),
		console,
		require: () => ({ createDotnetCompiler: create, executeBrowserDotnetArtifact: execute })
	};
	vm.runInNewContext(code, context);
	const load = (language = 'csharp') =>
		context.onmessage({
			data: { load: true, moduleUrl: 'https://test.invalid/index.js', language }
		});
	return { load, messages, compile, execute, create };
}
describe('.NET worker load readiness', () => {
	it.each(['csharp', 'fsharp', 'vbnet'])(
		'waits for actual %s compiler readiness',
		async (language) => {
			let ready!: () => void;
			const prepare = vi.fn(
				() =>
					new Promise<void>((resolve) => {
						ready = resolve;
					})
			);
			const h = harness(prepare);
			const loading = h.load(language);
			await vi.waitFor(() => expect(prepare).toHaveBeenCalled());
			expect(prepare).toHaveBeenCalledWith({ language });
			expect(h.messages).toEqual([]);
			ready();
			await loading;
			expect(h.messages).toEqual([{ load: true }]);
			expect(h.compile).not.toHaveBeenCalled();
			expect(h.execute).not.toHaveBeenCalled();
		}
	);
	it('keeps legacy runtime modules without prepare compatible', async () => {
		const h = harness();
		await h.load();
		expect(h.messages).toEqual([{ load: true }]);
	});
	it('reports preparation failure without load success and retries the next load', async () => {
		const prepare = vi
			.fn()
			.mockRejectedValueOnce(new Error('prepare failed'))
			.mockResolvedValue(undefined);
		const h = harness(prepare);
		await h.load();
		expect(h.messages.some((m) => m.load)).toBe(false);
		expect(String(h.messages[0].error)).toContain('prepare failed');
		await h.load();
		expect(h.messages.at(-1)).toEqual({ load: true });
		expect(prepare).toHaveBeenCalledTimes(2);
	});
});
