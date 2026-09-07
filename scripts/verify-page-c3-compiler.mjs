import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBundledProfile, verifyPinnedRuntimeAssets } from './verify-pinned-runtime-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function verifyPageC3Compiler({ rootDir = path.join(root, 'static') } = {}) {
	const { bundledC3Profile: profile, bundledC3WorkerReceipt } = await loadBundledProfile(
		new URL('../src/lib/playground/wasmC3Version.ts', import.meta.url)
	);
	try {
		return await verifyPinnedRuntimeAssets({
			rootDir,
			directory: 'wasm-c3',
			assets: {
				'c3c.mjs': profile.compilerJavaScriptReceipt,
				'c3c.wasm': profile.compilerWasmReceipt,
				'producer-receipt.json': profile.producerReceipt,
				'runner-worker.js': bundledC3WorkerReceipt
			}
		});
	} catch (cause) {
		throw new Error(
			'C3 page assets must match the committed consumer profile. Run pnpm sync:wasm-c3 --producer /path/to/wasm-llvm with the reviewed producer artifacts before page:build. ' +
				cause.message,
			{ cause }
		);
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.length > 3)
		throw new Error('Usage: verify-page-c3-compiler.mjs [static|build|directory]');
	console.log(
		await verifyPageC3Compiler({ rootDir: path.resolve(root, process.argv[2] || 'static') })
	);
}
