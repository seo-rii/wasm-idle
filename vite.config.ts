import { sveltekit } from '@sveltejs/kit/vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const wasmIdleCoreEntry = join(
	dirname(fileURLToPath(import.meta.url)),
	'packages/core/src/index.ts'
);

export default defineConfig({
	plugins: [sveltekit()],
	assetsInclude: [/\.dat$/, /\.wasm$/, /\.so$/, /\.la$/],
	resolve: {
		alias: {
			'@wasm-idle/core': wasmIdleCoreEntry
		}
	},
	optimizeDeps: {
		exclude: ['@seorii/monaco', '@seorii/monaco/workers', 'monaco-editor']
	},
	worker: { format: 'es' },
	server: {
		allowedHosts: true,
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
			'Cross-Origin-Resource-Policy': 'same-origin'
		}
	},
	preview: {
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
			'Cross-Origin-Resource-Policy': 'same-origin'
		}
	}
});
