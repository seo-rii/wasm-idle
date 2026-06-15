import { runWasiModule } from './wasi-guest.js';
import type {
	BrowserDArtifact,
	BrowserDExecutionOptions,
	BrowserDExecutionResult
} from './types.js';

export async function executeBrowserDArtifact(
	artifact: BrowserDArtifact,
	options: BrowserDExecutionOptions = {}
): Promise<BrowserDExecutionResult> {
	if (artifact.target !== 'wasm32-wasi' || artifact.format !== 'wasi-core-wasm') {
		throw new Error('wasm-d currently executes only wasm32-wasi preview1 core wasm artifacts.');
	}
	return await runWasiModule(artifact.bytes, {
		...options,
		programName: options.programName || artifact.fileName
	});
}
