import { sveltekit } from '@sveltejs/kit/vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

import { createReleasePreviewSecurityHeaders } from './scripts/content-security-policy.mjs';

const wasmIdleCoreEntry = join(
	dirname(fileURLToPath(import.meta.url)),
	'packages/core/src/index.ts'
);

export const releasePreviewSecurityHeaders = createReleasePreviewSecurityHeaders();

export default defineConfig({
	plugins: [
		{
			name: 'wasm-idle-release-preview-security-headers',
			configurePreviewServer(server) {
				server.middlewares.use((_request, response, next) => {
					for (const [name, value] of Object.entries(releasePreviewSecurityHeaders)) {
						response.setHeader(name, value);
					}
					next();
				});
			}
		},
		sveltekit()
	],
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
		headers: releasePreviewSecurityHeaders
	}
});
