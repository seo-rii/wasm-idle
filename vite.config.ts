import { sveltekit } from '@sveltejs/kit/vite';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const require = createRequire(import.meta.url);
const phpWasmWebRoot = dirname(require.resolve('@php-wasm/web/package.json'));
const phpWasmIcuData = join(phpWasmWebRoot, 'shared/icu.dat');
const wasmIdleCoreEntry = join(
	dirname(fileURLToPath(import.meta.url)),
	'packages/core/src/index.ts'
);

function phpWasmIcuDataResolver(): Plugin {
	return {
		name: 'wasm-idle-php-wasm-icu-data',
		enforce: 'pre',
		resolveId(source, importer) {
			if (
				source === '../intl/shared/icu.dat' &&
				importer?.includes('@php-wasm/web/index.js')
			) {
				return phpWasmIcuData;
			}
			return null;
		}
	};
}

export default defineConfig({
	plugins: [phpWasmIcuDataResolver(), sveltekit()],
	assetsInclude: [/\.dat$/, /\.wasm$/, /\.so$/, /\.la$/],
	resolve: {
		alias: {
			'@wasm-idle/core': wasmIdleCoreEntry
		}
	},
	optimizeDeps: {
		exclude: ['@php-wasm/web', '@seorii/monaco', '@seorii/monaco/workers', 'monaco-editor']
	},
	worker: { format: 'es', plugins: () => [phpWasmIcuDataResolver()] },
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
