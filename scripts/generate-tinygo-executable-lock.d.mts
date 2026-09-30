import type { TinyGoExecutableGraphLockModule } from './sync-wasm-tinygo.mjs';

export function generateTinyGoExecutableLock(sourceDir: string, outputPath: string): Promise<{
	format: 'wasm-idle-tinygo-executable-graph-lock-v1';
	entryPath: 'upstream.js';
	modules: TinyGoExecutableGraphLockModule[];
}>;
