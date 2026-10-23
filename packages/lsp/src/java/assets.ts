import { JAVA_LANGUAGE_SERVER_ASSETS as generatedAssets } from './assets.generated.js';

export interface JavaLanguageServerAsset {
	readonly path: 'javacs-runtime.mjs' | 'javacs.wasm' | 'jdk-platform.zip';
	readonly bytes: number;
	readonly sha256: string;
}

/** Exact receipts for the reproducible javacs + TeaVM producer. */
export const JAVA_LANGUAGE_SERVER_ASSETS: readonly JavaLanguageServerAsset[] = Object.freeze(
	generatedAssets.map((asset) => Object.freeze({ ...asset }))
);

export function snapshotJavaLanguageServerAssets(
	assets: readonly JavaLanguageServerAsset[] = JAVA_LANGUAGE_SERVER_ASSETS
): readonly JavaLanguageServerAsset[] {
	const paths = new Set(['javacs-runtime.mjs', 'javacs.wasm', 'jdk-platform.zip']);
	const snapshot = assets.map((asset) => {
		if (!paths.delete(asset.path)) throw new Error(`Unexpected Java LSP asset: ${asset.path}`);
		if (
			!Number.isSafeInteger(asset.bytes) ||
			asset.bytes <= 0 ||
			!/^[a-f0-9]{64}$/u.test(asset.sha256)
		) {
			throw new Error(`Invalid Java LSP asset receipt: ${asset.path}`);
		}
		return Object.freeze({ path: asset.path, bytes: asset.bytes, sha256: asset.sha256 });
	});
	if (paths.size) throw new Error(`Missing Java LSP assets: ${[...paths].join(', ')}`);
	return Object.freeze(snapshot);
}
