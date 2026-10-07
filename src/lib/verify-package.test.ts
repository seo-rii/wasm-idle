import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	assertFrameworkIndependentModule,
	assertFrameworkIndependentPackage,
	assertInstallBudget,
	scenarios
} from '../../scripts/verify-package.mjs';

const MiB = 1024 * 1024;

describe('published SDK framework independence', () => {
	it.each([
		['module.js', "import { error } from '@sveltejs/kit';"],
		['module.js', "import '@sveltejs/kit/hooks';"],
		['module.js', "export * from '$app/env/public';"],
		['module.js', "export { env } from '$env/dynamic/public';"],
		['module.d.ts', "import type { RequestEvent } from '@sveltejs/kit';"],
		['module.d.ts', "export type { PageProps } from '$app/types';"],
		['module.d.ts', "type Env = typeof import('$env/static/public');"],
		['module.d.mts', "type Event = import('@sveltejs/kit').RequestEvent;"],
		['module.js', "await import(/* lazy environment */ '$app/env/public');"],
		['module.mjs', 'await import(`$app/env/public`);'],
		['module.mjs', "await import(`@sveltejs/${'kit'}/hooks`);"],
		['module.js', "await import('@sveltejs/kit' + '/hooks');"],
		['module.js', "await import('$app/' + moduleName);"],
		['module.js', 'await import(`$env/${moduleName}`);'],
		['module.cjs', "const kit = require('@sveltejs/kit');"],
		['module.cjs', "module.require('$app/env/public');"],
		['module.d.cts', "import Kit = require('@sveltejs/kit');"],
		['module.d.ts', '/// <reference types="@sveltejs/kit" />'],
		['module.js', '/** @type {import("@sveltejs/kit").RequestEvent} */ const event = {};'],
		['module.js', '/** @import { RequestEvent } from "@sveltejs/kit" */']
	])('rejects framework module dependencies in %s: %s', (fileName, source) => {
		expect(() => assertFrameworkIndependentModule(source, fileName)).toThrow(
			`${fileName} contains SvelteKit module dependencies:`
		);
	});

	it('allows Svelte and framework names in comments or ordinary strings', () => {
		expect(() =>
			assertFrameworkIndependentModule(
				[
					"import { writable } from 'svelte/store';",
					"export type { RuntimeSession } from '@wasm-idle/core';",
					"// import { error } from '@sveltejs/kit';",
					"/* export * from '$env/dynamic/public'; */",
					"/** Example: import('$app/env/public') */",
					'const example = "import(\'$app/env/public\')";',
					"const name = '@sveltejs/kit';",
					"export const hint = '$env/static/public';"
				].join('\n'),
				'module.ts'
			)
		).not.toThrow();
	});

	it.each(['dependencies', 'optionalDependencies', 'peerDependencies'])(
		'rejects a SvelteKit %s dependency before inspecting the package files',
		async (field) => {
			await expect(
				assertFrameworkIndependentPackage(
					'/unused-package-path',
					{ name: '@wasm-idle/fixture', [field]: { '@sveltejs/kit': '^3.0.1' } },
					[]
				)
			).rejects.toThrow(`@wasm-idle/fixture declares a SvelteKit dependency in ${field}:`);
		}
	);

	it('rejects a SvelteKit runtime dependency disguised by an npm alias', async () => {
		await expect(
			assertFrameworkIndependentPackage(
				'/unused-package-path',
				{ name: 'wasm-idle', dependencies: { framework: 'npm:@sveltejs/kit@^3.0.1' } },
				[]
			)
		).rejects.toThrow('wasm-idle declares a SvelteKit dependency in dependencies: framework');
	});

	it('allows a build-only SvelteKit dev dependency and ignores files excluded from npm pack', async () => {
		const packagePath = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-framework-boundary-'));
		try {
			await writeFile(
				path.join(packagePath, 'index.js'),
				"export * from '@wasm-idle/core';\n"
			);
			await writeFile(path.join(packagePath, 'example.ts'), "import '$app/env/public';\n");
			await writeFile(
				path.join(packagePath, 'README.md'),
				"Example: import('$app/env/public')\n"
			);
			const manifest = {
				name: 'wasm-idle',
				devDependencies: { '@sveltejs/kit': '^3.0.1' }
			};
			await expect(
				assertFrameworkIndependentPackage(packagePath, manifest, ['index.js', 'README.md'])
			).resolves.toBeUndefined();
			await expect(
				assertFrameworkIndependentPackage(packagePath, manifest, ['example.ts'])
			).rejects.toThrow('wasm-idle/example.ts contains SvelteKit module dependencies:');
		} finally {
			await rm(packagePath, { recursive: true, force: true });
		}
	});
});

describe('package install budgets', () => {
	it('defines explicit size, file, and package limits for every install scenario', () => {
		expect(
			Object.fromEntries(scenarios.map((scenario) => [scenario.name, scenario.budget]))
		).toEqual({
			'wasm-idle root install': {
				maxBytes: 5.75 * MiB,
				maxFiles: 700,
				maxPackages: 6
			},
			'@wasm-idle/terminal install': {
				maxBytes: 16 * MiB,
				maxFiles: 1_370,
				maxPackages: 32
			},
			'@wasm-idle/debug install': {
				maxBytes: 7 * MiB,
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
