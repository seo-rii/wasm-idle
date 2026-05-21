import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('ci script contract', () => {
	it('keeps the fast ci lane independent from runtime builds', async () => {
		const packageJson = JSON.parse(
			await readFile(path.join(projectRoot, 'package.json'), 'utf8')
		) as {
			scripts?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		const workflow = await readFile(path.join(projectRoot, '.github/workflows/ci.yml'), 'utf8');
		const fastScript = packageJson.scripts?.['test:ci:fast'];
		const playwrightVersion =
			packageJson.devDependencies?.['playwright-core']?.replace(/^[^\d]*/, '') || '';

		expect(packageJson.scripts?.['test:ci']).toBe('pnpm run test:ci:fast');
		expect(packageJson.scripts?.['test:ci:browser']).toBe(
			'pnpm run test:browser && pnpm run test:browser:vitest && pnpm run test:browser:playwright'
		);
		expect(packageJson.scripts?.['validate:standalone-browser']).toBe(
			'node ./scripts/validate-standalone-browser.mjs'
		);
		expect(packageJson.scripts?.['build:all-compressed']).toBe(
			'WASM_RUST_PRECOMPRESS_SCOPES=all pnpm run build'
		);
		expect(packageJson.scripts?.['build:js']).toBe('tsc -p tsconfig.json');
		expect(packageJson.scripts?.['build:uncompressed']).toBe(
			'WASM_RUST_PRECOMPRESS_SCOPES=none pnpm run build'
		);
		expect(packageJson.scripts?.['prepare:runtime:all-compressed']).toBe(
			'WASM_RUST_PRECOMPRESS_SCOPES=all node scripts/prepare-runtime.mjs'
		);
		expect(packageJson.scripts?.['prepare:runtime:uncompressed']).toBe(
			'WASM_RUST_PRECOMPRESS_SCOPES=none node scripts/prepare-runtime.mjs'
		);
		expect(fastScript).toContain('WASM_RUST_SKIP_DIST_TESTS=1');
		expect(fastScript).not.toContain('pnpm build');
		expect(fastScript).toContain('test/browser-execution.test.ts');
		expect(fastScript).toContain('test/build-output.test.ts');
		expect(fastScript).toContain('test/runtime-compression-config.test.ts');
		expect(fastScript).toContain('test/rustc-runtime.test.ts');
		expect(workflow).toContain('gh release download --pattern \'wasm-rust-*.tgz\'');
		expect(workflow).toContain("WASM_RUST_ALLOW_PREBUILT_RUNTIME_FALLBACK: '1'");
		expect(packageJson.scripts?.['test:ci:browser:clean-room']).toBe(
			'pnpm run build:js && pnpm run probe:browser-harness && pnpm run test:browser:vitest && pnpm run test:browser:playwright'
		);
		expect(workflow).toContain('uses: pnpm/action-setup@v5');
		expect(workflow).toContain('uses: actions/checkout@v6');
		expect(workflow).toContain('uses: actions/setup-node@v6');
		expect(workflow).toContain(
			`pnpm dlx playwright@${playwrightVersion} install --with-deps chromium`
		);
		expect(workflow).toContain('pnpm run validate:standalone-browser');
		expect(workflow).toContain('pnpm run test:ci:browser:clean-room');
	});

	it('keeps repo-owned prepare and probe scripts free of user-specific absolute paths', async () => {
		const scriptPaths = [
			'scripts/prepare-wasip2-runtime.sh',
			'scripts/prepare-wasip3-runtime.sh',
			'scripts/probe-browser-clang-rust-split.mjs',
			'scripts/probe-browser-rustc-llvm-wasm-split.mjs',
			'scripts/probe-llvm-wasm-rust-split.mjs',
			'scripts/probe-native-rust-link.mjs',
			'scripts/probe-rustc-wasm.mjs'
		];
		for (const relativeScriptPath of scriptPaths) {
			const contents = await readFile(path.join(projectRoot, relativeScriptPath), 'utf8');
			expect(contents).not.toContain('/home/seorii');
		}
	});

	it('documents the current consumer timeout/stdin contract in repo-owned docs', async () => {
		const consumerDoc = await readFile(
			path.join(projectRoot, 'docs/consumer-integration.md'),
			'utf8'
		);
		const browserCompilerDoc = await readFile(
			path.join(projectRoot, 'docs/browser-compiler.md'),
			'utf8'
		);
		const readme = await readFile(path.join(projectRoot, 'README.md'), 'utf8');

		expect(consumerDoc).toContain('extendedTimeout: true');
		expect(consumerDoc).toContain('legacy `prepare: true` alias');
		expect(consumerDoc).toContain('`stdin()` should return `null` to signal EOF');
		expect(browserCompilerDoc).toMatch(
			/falls back to older `v2` and legacy `v1` manifests only when the newer\s+manifest file is missing/
		);
		expect(readme).toContain('default packaging target list still attempts `wasm32-wasip3`');
	});
});
