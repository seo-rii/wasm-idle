import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const projectRoot = path.resolve(scriptsDir, '..');

function parseArgs(argv) {
	const options = {
		toolchainDir:
			process.env.WASM_OF_JS_OF_OCAML_TOOLCHAIN_DIR ||
			path.join(projectRoot, '.cache', 'toolchain-root'),
		outDir: path.join(projectRoot, 'dist', 'runtime')
	};
	for (let index = 2; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--toolchain-dir') {
			options.toolchainDir = path.resolve(projectRoot, argv[index + 1] || '');
			index += 1;
			continue;
		}
		if (argument === '--out-dir') {
			options.outDir = path.resolve(projectRoot, argv[index + 1] || '');
			index += 1;
			continue;
		}
		if (argument === '--help') {
			process.stdout.write(`Usage: node scripts/prepare-runtime.mjs [options]

Options:
  --toolchain-dir <path>  Frozen toolchain directory
  --out-dir <path>        Runtime output directory
`);
			process.exit(0);
		}
		throw new Error(`unsupported argument: ${argument}`);
	}
	return options;
}

const options = parseArgs(process.argv);
const manifestPath = path.join(options.toolchainDir, 'toolchain-manifest.v1.json');
const manifestText = await readFile(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText);
const fingerprint = createHash('sha256').update(manifestText).digest('hex');

await rm(options.outDir, { recursive: true, force: true });
await mkdir(options.outDir, { recursive: true });
await cp(options.toolchainDir, path.join(options.outDir, 'toolchain'), {
	recursive: true,
	force: true
});

await writeFile(
	path.join(options.outDir, 'browser-toolchain-manifest.v1.json'),
	JSON.stringify(
		{
			version: 1,
			generatedAt: new Date().toISOString(),
			fingerprint,
			toolchainDir: 'toolchain',
			toolchainManifest: 'toolchain/toolchain-manifest.v1.json',
			runtimeVariants: manifest.runtimeVariants || []
		},
		null,
		2
	) + '\n',
	'utf8'
);

process.stdout.write(`${path.join(options.outDir, 'browser-toolchain-manifest.v1.json')}\n`);
