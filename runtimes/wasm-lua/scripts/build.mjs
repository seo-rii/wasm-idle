import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const require = createRequire(import.meta.url);

const emptyNodeBuiltinPlugin = {
	name: 'empty-node-builtins',
	setup(esbuild) {
		esbuild.onResolve(
			{
				filter: /^(fs|node:fs|path|node:path|child_process|node:child_process|crypto|node:crypto|url|node:url|module|node:module)$/
			},
			(args) => ({
				path: args.path,
				namespace: 'empty-node-builtin'
			})
		);
		esbuild.onLoad({ filter: /.*/, namespace: 'empty-node-builtin' }, () => ({
			loader: 'js',
			contents: `
				const empty = {};
				export default empty;
				export const readFileSync = () => undefined;
				export const existsSync = () => false;
				export const statSync = () => ({ isFile: () => false, isDirectory: () => false });
				export const pathToFileURL = (value) => String(value);
			`
		}));
	}
};

await mkdir(path.join(REPO_ROOT, 'dist'), { recursive: true });
await copyFile(
	require.resolve('wasmoon/dist/glue.wasm'),
	path.join(REPO_ROOT, 'dist', 'glue.wasm')
);

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
		js: '/* wasm-lua browser bundle */'
	}
});
