import { DEFAULT_BROWSER_BASE_PATH } from './browser-preview-server.mjs';
import { createReleasePreviewSecurityHeaders } from './content-security-policy.mjs';

// SvelteKit's preview plugin serves .svelte-kit/output. Release checks must serve
// the final adapter-static artifact, including its compressed worker manifest.
export default {
	base: DEFAULT_BROWSER_BASE_PATH,
	publicDir: false,
	build: { outDir: 'build' },
	plugins: [
		{
			name: 'wasm-idle-release-preview-java-host-policy',
			configurePreviewServer(server) {
				server.middlewares.use((request, response, next) => {
					for (const [name, value] of Object.entries(
						createReleasePreviewSecurityHeaders(undefined, request.url)
					))
						response.setHeader(name, value);
					next();
				});
			}
		}
	],
	preview: { headers: createReleasePreviewSecurityHeaders(false) }
};
