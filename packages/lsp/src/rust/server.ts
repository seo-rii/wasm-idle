import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';
import type { RustLanguageServerTargetTriple } from './service.js';

export interface RustLanguageServerConfig {
	compilerUrl?: string;
	expectedNetworkModuleUrls?: readonly string[];
	verifiedModuleUrls?: Readonly<Record<string, string>>;
	graphFingerprint?: string;
	runtimeProfile?: import('../types.js').RustLanguageServerRuntimeProfile;
	targetTriple?: RustLanguageServerTargetTriple;
	edition?: string;
}

export interface RustLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

function resolveConfig(
	options: EditorLanguageServerOptions | RustLanguageServerOptions | undefined
) {
	return typeof options === 'object' ? options.rust || {} : {};
}

export async function getRustLanguageServer(
	options?: EditorLanguageServerOptions | RustLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as RustLanguageServerOptions) : undefined;
	const config = resolveConfig(options);
	if (
		!config.compilerUrl ||
		!config.expectedNetworkModuleUrls ||
		!config.verifiedModuleUrls ||
		!config.graphFingerprint ||
		!config.runtimeProfile
	) {
		throw new Error('Rust language server requires a verified executable graph configuration');
	}
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			compilerUrl: config.compilerUrl,
			expectedNetworkModuleUrls: config.expectedNetworkModuleUrls,
			verifiedModuleUrls: config.verifiedModuleUrls,
			graphFingerprint: config.graphFingerprint,
			runtimeProfile: config.runtimeProfile,
			targetTriple: config.targetTriple,
			edition: config.edition
		},
		onStatus: hostOptions?.onStatus,
		lifecycle: hostOptions
	});
}
