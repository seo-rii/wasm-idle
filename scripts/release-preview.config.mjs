import { DEFAULT_BROWSER_BASE_PATH } from './browser-preview-server.mjs';
import { createReleasePreviewSecurityHeaders } from './content-security-policy.mjs';

// SvelteKit's preview plugin serves .svelte-kit/output. Release checks must serve
// the final adapter-static artifact, including its compressed worker manifest.
export default {
	base: DEFAULT_BROWSER_BASE_PATH,
	publicDir: false,
	build: { outDir: 'build' },
	preview: { headers: createReleasePreviewSecurityHeaders() }
};
