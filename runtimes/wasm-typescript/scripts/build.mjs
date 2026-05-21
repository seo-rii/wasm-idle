import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..');

const emptyNodeBuiltinPlugin = {
	name: 'empty-node-builtins',
	setup(esbuild) {
		esbuild.onResolve({ filter: /^(fs|node:fs|path|node:path|os|node:os|crypto|node:crypto)$/ }, (args) => ({
			path: args.path,
			namespace: 'empty-node-builtin'
		}));
		esbuild.onLoad({ filter: /.*/, namespace: 'empty-node-builtin' }, () => ({
			loader: 'js',
			contents: `
				const empty = {};
				export default empty;
				export const readFileSync = () => undefined;
				export const writeFileSync = () => undefined;
				export const existsSync = () => false;
				export const realpathSync = (value) => value;
				export const statSync = () => ({ isFile: () => false, isDirectory: () => false });
				export const platform = () => 'browser';
				export const tmpdir = () => '/tmp';
				export const randomBytes = (size) => new Uint8Array(size);
			`
		}));
	}
};

const swcBrowserShimPlugin = {
	name: 'swc-browser-shims',
	setup(esbuild) {
		esbuild.onResolve({ filter: /^(util|node:util)$/ }, (args) => ({
			path: args.path,
			namespace: 'swc-browser-shim'
		}));
		esbuild.onResolve({ filter: /^node:buffer$/ }, (args) => ({
			path: args.path,
			namespace: 'swc-browser-shim'
		}));
		esbuild.onLoad({ filter: /^(util|node:util)$/, namespace: 'swc-browser-shim' }, () => ({
			loader: 'js',
			contents: `
				export const TextDecoder = globalThis.TextDecoder;
				export const TextEncoder = globalThis.TextEncoder;
			`
		}));
		esbuild.onLoad({ filter: /^node:buffer$/, namespace: 'swc-browser-shim' }, () => ({
			loader: 'js',
			contents: `
				function decodeBase64(value) {
					const binary = globalThis.atob(value);
					const bytes = new Uint8Array(binary.length);
					for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
					return bytes;
				}
				export const Buffer = {
					from(value, encoding) {
						if (encoding === 'base64') return decodeBase64(value);
						if (value instanceof Uint8Array) return value;
						return new TextEncoder().encode(String(value));
					}
				};
			`
		}));
	}
};

await mkdir(path.join(REPO_ROOT, 'dist'), { recursive: true });

await build({
	entryPoints: [path.join(REPO_ROOT, 'src', 'index.ts')],
	outfile: path.join(REPO_ROOT, 'dist', 'index.js'),
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	sourcemap: false,
	minify: true,
	plugins: [emptyNodeBuiltinPlugin, swcBrowserShimPlugin],
	banner: {
		js: '/* wasm-typescript browser bundle */'
	}
});
