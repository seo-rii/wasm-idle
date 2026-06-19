import {
	resolveOcamlLanguageServerManifestUrl,
	resolveOcamlLanguageServerModuleUrl
} from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';
import type {
	OcamlLanguageServerBinaryenMode,
	OcamlLanguageServerEffectsMode,
	OcamlLanguageServerTarget
} from './service.js';

export interface OcamlLanguageServerConfig {
	moduleUrl?: string;
	manifestUrl?: string;
	target?: OcamlLanguageServerTarget;
	effectsMode?: OcamlLanguageServerEffectsMode;
	wasmBinaryenMode?: OcamlLanguageServerBinaryenMode;
	packages?: string[];
}

export interface OcamlLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

const resolveConfig = (
	options: EditorLanguageServerOptions | OcamlLanguageServerOptions | undefined
) => (typeof options === 'object' ? options.ocaml || {} : {});

export async function getOcamlLanguageServer(
	options?: EditorLanguageServerOptions | OcamlLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as OcamlLanguageServerOptions) : undefined;
	const config = resolveConfig(options);
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			moduleUrl: resolveOcamlLanguageServerModuleUrl(options, hostOptions?.currentUrl),
			manifestUrl: resolveOcamlLanguageServerManifestUrl(options, hostOptions?.currentUrl),
			target: config.target,
			effectsMode: config.effectsMode,
			wasmBinaryenMode: config.wasmBinaryenMode,
			packages: config.packages
		},
		onStatus: hostOptions?.onStatus
	});
}
