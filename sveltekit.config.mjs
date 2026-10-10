import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

import {
	isStrictContentSecurityPolicyEnabled,
	svelteContentSecurityPolicy
} from './scripts/content-security-policy.mjs';

/** @type {import('@sveltejs/kit/vite').Config} */
const config = {
	preprocess: vitePreprocess(),
	adapter: adapter(),
	alias: {
		$lib: 'src/lib'
	},
	...(isStrictContentSecurityPolicyEnabled() ? { csp: svelteContentSecurityPolicy } : {}),
	paths: {
		base: '/wasm-idle'
	}
};

export default config;
