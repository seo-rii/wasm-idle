import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBundledProfile, verifyPinnedRuntimeAssets } from './verify-pinned-runtime-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function verifyPageLfortranCompiler({ rootDir = path.join(root, 'static') } = {}) {
	const { WASM_LFORTRAN_PROFILE: profile } = await loadBundledProfile(
		new URL('../src/lib/playground/wasmLfortranVersion.ts', import.meta.url)
	);
	const assets = Object.fromEntries(
		Object.entries(profile.assets).map(([name, receipt]) => [
			name === 'lfortran.data' ? 'lfortran.data.bin' : name,
			receipt
		])
	);
	assets['runner-worker.js'] = profile.workerReceipt;
	try {
		return await verifyPinnedRuntimeAssets({ rootDir, directory: 'wasm-lfortran', assets });
	} catch (cause) {
		throw new Error(
			'LFortran page assets must match the committed consumer profile. Run pnpm sync:wasm-lfortran /path/to/wasm-llvm/out/lfortran-browser/artifacts with the reviewed producer artifacts before page:build. ' +
				cause.message,
			{ cause }
		);
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.length > 3)
		throw new Error('Usage: verify-page-lfortran-compiler.mjs [static|build|directory]');
	console.log(
		await verifyPageLfortranCompiler({
			rootDir: path.resolve(root, process.argv[2] || 'static')
		})
	);
}
