import Python from '$lib/playground/python';
import { resolveApecodeBaseUrl, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { WASM_APECODE_VERSION, WASM_APECODE_WHEELS } from '$lib/playground/wasmApecodeVersion';

export type ApecodeWorkerExtension = {
	language: 'apecode';
	version: string;
	wheels: { url: string; fileName: string; bytes: number; sha256: string }[];
};

/** Executes the original APECode interpreter on the shared Pyodide worker. */
class Apecode extends Python {
	protected override readonly workerLanguage = 'apecode' as const;

	protected override workerLoadExtension(
		runtimeAssets: string | PlaygroundRuntimeAssets,
		currentUrl: string
	): ApecodeWorkerExtension {
		const baseUrl = resolveApecodeBaseUrl(runtimeAssets, currentUrl);
		return {
			language: 'apecode',
			version: WASM_APECODE_VERSION,
			wheels: WASM_APECODE_WHEELS.map((wheel) => ({
				url: `${baseUrl}${wheel.fileName}`,
				fileName: wheel.fileName,
				bytes: wheel.bytes,
				sha256: wheel.sha256
			}))
		};
	}
}

export default Apecode;
