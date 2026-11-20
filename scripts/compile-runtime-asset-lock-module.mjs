import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const source = fileURLToPath(
	new URL('../packages/core/src/runtime-asset-lock.generated.ts', import.meta.url)
);
const output = fileURLToPath(
	new URL('../packages/core/dist/runtime-asset-lock.generated.js', import.meta.url)
);

/** Compile the release receipt table from its canonical TypeScript source. */
export function compileRuntimeAssetLockModule(outfile = output) {
	return build({
		entryPoints: [source],
		outfile,
		format: 'esm',
		target: 'es2022',
		// Keep the pure initializer annotation so consumers can omit the table from their initial chunk.
		minifySyntax: true,
		sourcemap: true,
		sourcesContent: false,
		legalComments: 'inline'
	});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await compileRuntimeAssetLockModule();
}
