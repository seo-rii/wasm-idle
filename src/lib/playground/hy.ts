import Python from '$lib/playground/python';
import { resolveHyBaseUrl, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { WASM_HY_VERSION, WASM_HY_WHEELS } from '$lib/playground/wasmHyVersion';

export type HyWorkerExtension = {
	language: 'hy';
	version: string;
	wheels: { url: string; fileName: string; bytes: number; sha256: string }[];
};

/**
 * Hy runs on the shared Pyodide worker: the pinned Hy and funcparserlib wheels are fetched from
 * local static assets, verified against code-pinned receipts, and unpacked into site-packages.
 */
class Hy extends Python {
	protected override readonly workerLanguage = 'hy' as const;

	protected override workerLoadExtension(
		runtimeAssets: string | PlaygroundRuntimeAssets,
		currentUrl: string
	): HyWorkerExtension {
		const baseUrl = resolveHyBaseUrl(runtimeAssets, currentUrl);
		return {
			language: 'hy',
			version: WASM_HY_VERSION,
			wheels: WASM_HY_WHEELS.map((wheel) => ({
				url: `${baseUrl}${wheel.fileName}`,
				fileName: wheel.fileName,
				bytes: wheel.bytes,
				sha256: wheel.sha256
			}))
		};
	}
}

export default Hy;
