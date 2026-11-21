import { sveltekit } from '@sveltejs/kit/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

import { createReleasePreviewSecurityHeaders } from './scripts/content-security-policy.mjs';
import { createBuildIdentity } from './scripts/build-identity.mjs';
import { createCoreSourceAliases } from './scripts/core-source-aliases.mjs';
import { verifyMoonbitServicePolicy } from './scripts/verify-moonbit-service-policy.mjs';
import sveltekitConfig from './sveltekit.config.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));

export const releasePreviewSecurityHeaders = createReleasePreviewSecurityHeaders();

export default defineConfig({
	define: { __WASM_IDLE_BUILD__: JSON.stringify(createBuildIdentity()) },
	plugins: [
		{
			name: 'wasm-idle-moonbit-service-policy',
			apply: 'build',
			async buildStart() {
				await verifyMoonbitServicePolicy({
					rootDir: fileURLToPath(new URL('./static', import.meta.url))
				});
			}
		},
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
		sveltekit(sveltekitConfig)
	],
	assetsInclude: [/\.dat$/, /\.wasm$/, /\.so$/, /\.la$/],
	resolve: {
		alias: createCoreSourceAliases(root)
	},
	optimizeDeps: {
		// Discover worker-only imports before the first editor session opens.
		entries: ['packages/lsp/dist/{document,graphql,typescript}/worker.js'],
		exclude: ['@seorii/monaco', '@seorii/monaco/workers', 'monaco-editor']
	},
	worker: { format: 'es' },
	server: {
		// Worker entry points are requested directly and fall outside SvelteKit's source directories.
		fs: { allow: [fileURLToPath(new URL('./packages/lsp/dist/', import.meta.url))] },
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
