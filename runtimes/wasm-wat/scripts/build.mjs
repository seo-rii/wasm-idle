import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..');

const emptyNodeBuiltinPlugin = {
	name: 'empty-node-builtins',
	setup(esbuild) {
		esbuild.onResolve({ filter: /^(fs|node:fs|path|node:path)$/ }, (args) => ({
			path: args.path,
			namespace: 'empty-node-builtin'
		}));
		esbuild.onLoad({ filter: /.*/, namespace: 'empty-node-builtin' }, () => ({
			loader: 'js',
			contents: `
				const empty = {};
				export default empty;
				export const readFileSync = () => undefined;
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
	plugins: [emptyNodeBuiltinPlugin],
	banner: {
		js: '/* wasm-wat browser bundle */'
	}
});
