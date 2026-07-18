import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(projectRoot, 'dist');

await mkdir(distRoot, { recursive: true });

await build({
	entryPoints: [path.join(projectRoot, 'src', 'debug-instrumenter.ts')],
	outfile: path.join(distRoot, 'debug-instrumenter.js'),
	bundle: true,
	packages: 'bundle',
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	charset: 'ascii',
	legalComments: 'none',
	minify: true,
	sourcemap: false
});
