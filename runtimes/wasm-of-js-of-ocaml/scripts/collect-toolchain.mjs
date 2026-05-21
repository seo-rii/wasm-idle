import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const projectRoot = path.resolve(scriptsDir, '..');

function parseArgs(argv) {
	const options = {
		switchPrefix: process.env.WASM_OF_JS_OF_OCAML_SWITCH_PREFIX || '',
		recipe: path.join(projectRoot, 'toolchain', 'recipes', 'frozen-toolchain.browser.json'),
		outDir: path.join(projectRoot, '.cache', 'toolchain-root')
	};
	for (let index = 2; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--switch-prefix') {
			options.switchPrefix = argv[index + 1] || '';
			index += 1;
			continue;
		}
		if (argument === '--recipe') {
			options.recipe = path.resolve(projectRoot, argv[index + 1] || '');
			index += 1;
			continue;
		}
		if (argument === '--out-dir') {
			options.outDir = path.resolve(projectRoot, argv[index + 1] || '');
			index += 1;
			continue;
		}
		if (argument === '--help') {
			process.stdout.write(`Usage: node scripts/collect-toolchain.mjs [options]

Options:
  --switch-prefix <path>  Host switch prefix to collect from
  --recipe <path>         JSON recipe describing bins/libs/runtime variants
  --out-dir <path>        Output directory for the frozen toolchain bundle
`);
			process.exit(0);
		}
		throw new Error(`unsupported argument: ${argument}`);
	}
	if (!options.switchPrefix) {
		throw new Error('missing --switch-prefix (or WASM_OF_JS_OF_OCAML_SWITCH_PREFIX)');
	}
	return options;
}

async function ensureExists(targetPath) {
	try {
		await stat(targetPath);
	} catch {
		throw new Error(`required path is missing: ${targetPath}`);
	}
}

const options = parseArgs(process.argv);
const recipe = JSON.parse(await readFile(options.recipe, 'utf8'));
const manifest = {
	version: 1,
	generatedAt: new Date().toISOString(),
	toolchainRoot: recipe.toolchainRoot || '/toolchain',
	findlibConfig: recipe.findlibConfig || 'lib/findlib.conf',
	bins: {},
	libDirs: [],
	runtimeVariants: [],
	packages: recipe.packages || [],
	notes: [
		`source-switch-prefix=${options.switchPrefix}`,
		`recipe=${path.relative(projectRoot, options.recipe)}`
	]
};

await mkdir(options.outDir, { recursive: true });

for (const entry of recipe.bins || []) {
	const sourcePath = path.isAbsolute(entry.source)
		? entry.source
		: path.join(options.switchPrefix, entry.source);
	const targetPath = path.join(options.outDir, entry.target);
	await ensureExists(sourcePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await cp(sourcePath, targetPath, { recursive: true, force: true });
	manifest.bins[entry.name] = entry.target.replace(/\\/g, '/');
}

for (const entry of recipe.libs || []) {
	const sourcePath = path.isAbsolute(entry.source)
		? entry.source
		: path.join(options.switchPrefix, entry.source);
	const targetPath = path.join(options.outDir, entry.target);
	await ensureExists(sourcePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await cp(sourcePath, targetPath, { recursive: true, force: true });
	manifest.libDirs.push(entry.target.replace(/\\/g, '/'));
}

for (const entry of recipe.runtimeVariants || []) {
	const sourcePath = path.isAbsolute(entry.source)
		? entry.source
		: path.join(options.switchPrefix, entry.source);
	const targetPath = path.join(options.outDir, entry.target);
	await ensureExists(sourcePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await cp(sourcePath, targetPath, { recursive: true, force: true });
	manifest.runtimeVariants.push({
		name: entry.name,
		effectsMode: entry.effectsMode,
		path: entry.target.replace(/\\/g, '/')
	});
}

await writeFile(
	path.join(options.outDir, 'toolchain-manifest.v1.json'),
	JSON.stringify(manifest, null, 2) + '\n',
	'utf8'
);

process.stdout.write(`${path.join(options.outDir, 'toolchain-manifest.v1.json')}\n`);

