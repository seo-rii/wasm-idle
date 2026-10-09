import Python from '$lib/playground/python';
import { resolveAheuiBaseUrl, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { WASM_AHEUI_VERSION, WASM_AHEUI_WHEELS } from '$lib/playground/wasmAheuiVersion';

export type AheuiWorkerExtension = {
	language: 'aheui';
	version: string;
	wheels: { url: string; fileName: string; bytes: number; sha256: string }[];
};

/** Executes the original rpaheui interpreter on the shared Pyodide worker. */
class Aheui extends Python {
	protected override readonly workerLanguage = 'aheui' as const;

	protected override workerLoadExtension(
		runtimeAssets: string | PlaygroundRuntimeAssets,
		currentUrl: string
	): AheuiWorkerExtension {
		const baseUrl = resolveAheuiBaseUrl(runtimeAssets, currentUrl);
		return {
			language: 'aheui',
			version: WASM_AHEUI_VERSION,
			wheels: WASM_AHEUI_WHEELS.map((wheel) => ({
				url: `${baseUrl}${wheel.fileName}`,
				fileName: wheel.fileName,
				bytes: wheel.bytes,
				sha256: wheel.sha256
			}))
		};
	}
}

export default Aheui;
