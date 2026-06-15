import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(scriptDir, '..');

const emptyNodeBuiltinPlugin = {
	name: 'empty-node-builtins',
	setup(esbuild) {
		esbuild.onResolve(
			{
				filter: /^(fs|node:fs|fs\/promises|node:fs\/promises|path|node:path|os|node:os|crypto|node:crypto|url|node:url|module|node:module)$/
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
				export const readFile = async () => new Uint8Array();
				export const readFileSync = () => new Uint8Array();
				export const writeFileSync = () => undefined;
				export const existsSync = () => false;
				export const statSync = () => ({ isFile: () => false, isDirectory: () => false });
				export const fileURLToPath = (value) => String(value);
				export const pathToFileURL = (value) => String(value);
				export const createRequire = () => (() => undefined);
			`
		}));
	}
};

await mkdir(path.join(runtimeRoot, 'dist'), { recursive: true });

await build({
	entryPoints: [path.join(runtimeRoot, 'src', 'index.ts')],
	outfile: path.join(runtimeRoot, 'dist', 'index.js'),
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	sourcemap: false,
	minify: true,
	plugins: [emptyNodeBuiltinPlugin],
	banner: {
		js: '/* wasm-d browser bundle */'
	}
});
