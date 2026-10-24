import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCoreSourceAliases } from './core-source-aliases.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A local probe server can serve test modules outside SvelteKit's application roots.
export default defineConfig({
	root: repo,
	cacheDir: 'node_modules/.vite-performance',
	base: '/wasm-idle/',
	define: {
		__WASM_IDLE_BUILD__: JSON.stringify({
			commit: 'performance-probe',
			builtAt: '',
			runtimeAssets: {}
		})
	},
	resolve: {
		alias: [
			{ find: '$lib', replacement: path.join(repo, 'src/lib') },
			...createCoreSourceAliases(repo)
		]
	},
	optimizeDeps: {
		noDiscovery: true,
		include: ['@wasm-idle/lsp > vscode-jsonrpc/browser'],
		exclude: ['@wasm-idle/lsp', '@wasm-idle/llvm-core', '@seorii/monaco', 'monaco-editor']
	},
	worker: { format: 'es' },
	server: {
		host: '127.0.0.1',
		port: 5192,
		strictPort: true,
		hmr: false,
		fs: { allow: [repo] },
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
			'Cross-Origin-Resource-Policy': 'same-origin'
		}
	}
});
