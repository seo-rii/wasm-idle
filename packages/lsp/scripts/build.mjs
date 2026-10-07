import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pythonSourceDir = path.resolve(packageRoot, 'src', 'python', 'package');
const pythonOutputDir = path.resolve(packageRoot, 'dist', 'python', 'package');

await mkdir(path.dirname(pythonOutputDir), { recursive: true });
await cp(pythonSourceDir, pythonOutputDir, { recursive: true });

// JSON-RPC 9 only exports its browser transport under the browser condition.
// Bundle that entry so browser SDK imports also remain safe in Node/SSR consumers.
const jsonrpcOutputPath = path.join(packageRoot, 'dist', 'jsonrpc.js');
await build({
	entryPoints: [path.join(packageRoot, 'src', 'jsonrpc.ts')],
	outfile: jsonrpcOutputPath,
	bundle: true,
	platform: 'browser',
	format: 'esm',
	target: 'es2022',
	minifyWhitespace: true,
	sourcemap: false
});

// The TypeScript wrapper map is unused after replacing it with the browser bundle.
await rm(`${jsonrpcOutputPath}.map`, { force: true });
