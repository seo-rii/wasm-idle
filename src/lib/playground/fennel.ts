import { resolveFennelCompilerUrl } from '$lib/playground/assets';
import Lua from '$lib/playground/lua';
import { WASM_FENNEL_COMPILER_RECEIPT } from '$lib/playground/wasmFennelVersion';
import { RuntimeConfigurationError } from '@wasm-idle/core';

/**
 * Fennel runs the pinned official `fennel.lua` compiler on the shared wasm-lua (wasmoon)
 * worker. The worker fetches and verifies the compiler against its receipt before use.
 */
class Fennel extends Lua {
	constructor() {
		super({
			label: 'Fennel',
			runtimeId: 'FENNEL',
			defaultActivePath: 'main.fnl',
			resolveWorkerLoadExtras(runtimeAssets, currentUrl) {
				const compilerUrl = resolveFennelCompilerUrl(runtimeAssets, currentUrl);
				if (!compilerUrl) {
					throw new RuntimeConfigurationError(
						'Fennel compiler is not configured. Set PUBLIC_WASM_FENNEL_COMPILER_URL or runtimeAssets.fennel.compilerUrl.',
						{ runtimeId: 'FENNEL' }
					);
				}
				return {
					fennelCompiler: {
						url: compilerUrl,
						receipt: { ...WASM_FENNEL_COMPILER_RECEIPT }
					}
				};
			}
		});
	}
}

export default Fennel;
