import { describe, expect, it } from 'vitest';
import { executeBrowserDotnetArtifact } from '../src/browser-execution.js';

describe('executeBrowserDotnetArtifact', () => {
	it('runs a compiled assembly through the browser runtime bridge', async () => {
		const calls: unknown[] = [];
		const outputs: string[] = [];
		const result = await executeBrowserDotnetArtifact(
			{
				format: 'dotnet-browser-assembly',
				assemblyId: 'asm-csharp',
				language: 'csharp',
				target: 'browser-wasm'
			},
			{
				args: ['4'],
				env: { USER: 'jungol' },
				stdin: '5\n',
				stdout: (chunk) => outputs.push(chunk),
				runtime: {
					async compile() {
						return { success: true, assemblyId: 'unused' };
					},
					async run(request) {
						calls.push(request);
						return {
							exitCode: 0,
							stdout: 'factorial_plus_bonus=27\n',
							stderr: ''
						};
					}
				}
			}
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe('factorial_plus_bonus=27\n');
		expect(outputs).toEqual(['factorial_plus_bonus=27\n']);
		expect(calls).toEqual([
			{
				assemblyId: 'asm-csharp',
				args: ['4'],
				env: { USER: 'jungol' },
				stdin: '5\n'
			}
		]);
	});
});
