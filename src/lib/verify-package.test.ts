import { describe, expect, it } from 'vitest';
import { assertInstallBudget, scenarios } from '../../scripts/verify-package.mjs';

const MiB = 1024 * 1024;

describe('package install budgets', () => {
	it('defines explicit size, file, and package limits for every install scenario', () => {
		expect(
			Object.fromEntries(scenarios.map((scenario) => [scenario.name, scenario.budget]))
		).toEqual({
			'wasm-idle root install': {
				maxBytes: 5.25 * MiB,
				maxFiles: 700,
				maxPackages: 6
			},
			'@wasm-idle/terminal install': {
				maxBytes: 16 * MiB,
				maxFiles: 1_350,
				maxPackages: 32
			},
			'@wasm-idle/debug install': {
				maxBytes: 6.75 * MiB,
				maxFiles: 1_200,
				maxPackages: 25
			},
			'@wasm-idle/lsp install': {
				maxBytes: 4.75 * MiB,
				maxFiles: 1_050,
				maxPackages: 7
			},
			'all public packages/adapters aggregate': {
				maxBytes: 38 * MiB,
				maxFiles: 3_250,
				maxPackages: 70
			}
		});
	});

	it('allows measurements exactly at every configured limit', () => {
		for (const scenario of scenarios) {
			expect(() =>
				assertInstallBudget(scenario, {
					bytes: scenario.budget.maxBytes,
					files: scenario.budget.maxFiles,
					packages: scenario.budget.maxPackages
				})
			).not.toThrow();
		}
	});

	it('reports all exceeded limits and the largest package contributors', () => {
		const scenario = {
			name: 'fixture install',
			budget: { maxBytes: 2 * MiB, maxFiles: 100, maxPackages: 5 }
		};
		const contributors = [
			{ name: 'large-package@1.0.0', bytes: 1.5 * MiB, files: 80 },
			{ name: 'small-package@1.0.0', bytes: 0.75 * MiB, files: 25 }
		];

		expect(() =>
			assertInstallBudget(
				scenario,
				{ bytes: 2.25 * MiB, files: 105, packages: 6 },
				contributors
			)
		).toThrowError(
			expect.objectContaining({
				message: expect.stringMatching(
					/fixture install[\s\S]*size 2\.25 MiB exceeds 2\.00 MiB by 0\.25 MiB[\s\S]*file count 105 exceeds 100 by 5[\s\S]*package count 6 exceeds 5 by 1[\s\S]*large-package@1\.0\.0: 1\.50 MiB, 80 files/u
				)
			})
		);
	});

	it('keeps heavy optional tooling out of focused installs', () => {
		const byName = new Map(scenarios.map((scenario) => [scenario.name, scenario]));
		expect(byName.get('@wasm-idle/lsp install')?.packageNames).toContain('@wasm-idle/core');
		expect(byName.get('wasm-idle root install')?.imports).toContain(
			"await import('@wasm-idle/llvm-core/debug');"
		);

		expect(byName.get('wasm-idle root install')?.absentPackageNames).toEqual(
			expect.arrayContaining([
				'@wasm-idle/debug',
				'@wasm-idle/lsp',
				'@xterm/xterm',
				'monaco-editor'
			])
		);
		expect(byName.get('@wasm-idle/terminal install')?.absentPackageNames).toContain(
			'monaco-editor'
		);
		expect(byName.get('@wasm-idle/debug install')?.absentPackageNames).toEqual(
			expect.arrayContaining(['@lezer/rust', '@xterm/xterm', 'monaco-editor'])
		);
		expect(byName.get('@wasm-idle/lsp install')?.absentPackageNames).toEqual(
			expect.arrayContaining(['@xterm/xterm', 'monaco-editor', 'svelte'])
		);
	});
});
