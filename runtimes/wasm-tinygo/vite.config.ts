import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

import { createTinyGoHostCompilePlugin } from './scripts/tinygo-host-compile-vite-plugin.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
	const upstreamOnly = mode === 'upstream';
	return {
		publicDir: upstreamOnly ? false : 'public',
		plugins: upstreamOnly ? [] : [createTinyGoHostCompilePlugin()],
		worker: {
			format: 'es',
			rollupOptions: {
				output: {
					entryFileNames: 'assets/upstream-compile-worker-[hash].js',
					chunkFileNames: 'assets/upstream-compile-worker-[hash].js'
				}
			}
		},
		build: {
			rollupOptions: {
				preserveEntrySignatures: 'strict',
				input: upstreamOnly
					? { upstream: path.resolve(__dirname, 'src/upstream-entry.ts') }
					: {
							app: path.resolve(__dirname, 'index.html'),
							runtime: path.resolve(__dirname, 'src/runtime-entry.ts'),
							upstream: path.resolve(__dirname, 'src/upstream-entry.ts')
						},
				output: {
					entryFileNames: (chunkInfo) =>
						chunkInfo.name === 'runtime' || chunkInfo.name === 'upstream'
							? `${chunkInfo.name}.js`
							: 'assets/[name]-[hash].js',
					chunkFileNames: 'assets/[name]-[hash].js',
					assetFileNames: 'assets/[name]-[hash][extname]'
				}
			}
		}
	};
});
