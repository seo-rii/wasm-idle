import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, loadConfigFromFile } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));

for (const configName of ['vite.config.ts', 'scripts/performance-vite.config.mjs']) {
	test(`${configName} builds core source imports in main and Worker bundles`, async (t) => {
		await fs.mkdir(path.join(root, '.cache'), { recursive: true });
		const temporary = await fs.mkdtemp(path.join(root, '.cache/core-source-aliases-'));
		t.after(() => fs.rm(temporary, { recursive: true, force: true }));
		const loaded = await loadConfigFromFile(
			{ command: 'build', mode: 'production' },
			path.join(root, configName),
			root,
			'silent',
			undefined,
			'runner'
		);
		assert(loaded);
		const llvm = path.join(root, 'packages/llvm-core/runtime/core/src');
		await fs.writeFile(
			path.join(temporary, 'shared.mjs'),
			`import { readBuffer } from '@wasm-idle/core/runtime-asset-loader';
import { readBuffer as legacyReadBuffer } from ${JSON.stringify(path.join(llvm, 'wasm.ts'))};
import untar from '@wasm-idle/core/runtime-tar';
import legacyUntar from ${JSON.stringify(path.join(llvm, 'tar.ts'))};
import { readOct } from '@wasm-idle/core/runtime-encode';
import { readOct as legacyReadOct } from ${JSON.stringify(path.join(llvm, 'encode.ts'))};
import { createRuntimeWasmModuleService as rootService } from '@wasm-idle/core';
import { createRuntimeWasmModuleService as subpathService } from '@wasm-idle/core/runtime-wasm-module-service';
export function checkIdentity() {
  if (typeof readBuffer !== 'function' || readBuffer !== legacyReadBuffer ||
      typeof untar !== 'function' || untar !== legacyUntar ||
      readOct !== legacyReadOct || rootService !== subpathService) {
    throw new Error('Core source aliases created separate module identities');
  }
  return readOct(new TextEncoder().encode('017\\0'), 0, 4);
}
`
		);
		await fs.writeFile(
			path.join(temporary, 'main.mjs'),
			`export { checkIdentity } from './shared.mjs';
export function makeWorker() {
  return new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
}
`
		);
		await fs.writeFile(
			path.join(temporary, 'worker.mjs'),
			`import { checkIdentity } from './shared.mjs';
self.postMessage(checkIdentity());
`
		);
		const result = await build({
			configFile: false,
			root,
			base: './',
			publicDir: false,
			cacheDir: path.join(temporary, 'vite'),
			logLevel: 'silent',
			resolve: loaded.config.resolve,
			worker: { format: 'es' },
			build: {
				outDir: path.join(temporary, 'dist'),
				minify: false,
				lib: { entry: path.join(temporary, 'main.mjs'), formats: ['es'], fileName: 'main' }
			}
		});
		const output = (Array.isArray(result) ? result[0] : result).output;
		const entry = output.find((item) => item.type === 'chunk' && item.isEntry);
		assert(entry);
		const main = await import(pathToFileURL(path.join(temporary, 'dist', entry.fileName)));
		assert.equal(main.checkIdentity(), 15);

		// Evaluate the emitted Worker module's import identities without starting a
		// browser or claiming compiler qualification. Worker JavaScript is bundled by Vite.
		const originalWorker = globalThis.Worker;
		const originalSelf = globalThis.self;
		let workerUrl, workerResult;
		try {
			globalThis.Worker = class {
				constructor(url) {
					workerUrl = url;
				}
			};
			main.makeWorker();
			assert(workerUrl instanceof URL);
			assert(fileURLToPath(workerUrl).startsWith(path.join(temporary, 'dist') + path.sep));
			globalThis.self = { postMessage: (value) => (workerResult = value) };
			await import(workerUrl.href);
			assert.equal(workerResult, 15);
		} finally {
			if (originalWorker === undefined) delete globalThis.Worker;
			else globalThis.Worker = originalWorker;
			if (originalSelf === undefined) delete globalThis.self;
			else globalThis.self = originalSelf;
		}
	});
}
