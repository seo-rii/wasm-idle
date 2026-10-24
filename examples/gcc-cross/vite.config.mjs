import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({
	root,
	cacheDir: path.join(root, '.cache/gcc-example-vite'),
	optimizeDeps: { noDiscovery: true },
	resolve: {
		alias: [
			{
				find: /^@wasm-idle\/core$/,
				replacement: path.join(root, 'packages/core/src/index.ts')
			}
		]
	},
	server: { host: '127.0.0.1', fs: { allow: [root] } },
	build: {
		outDir: path.join(root, '.cache/gcc-example-build'),
		rollupOptions: { input: path.join(root, 'examples/gcc-cross/index.html') }
	}
});
