import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	resolve: {
		alias: {
			vscode: '@hancomac/monaco-languageclient/vscode-compatibility'
		}
	},
	worker: { format: 'es' },
	server: {
		allowedHosts: true
	}
});
