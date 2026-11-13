import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Retain complete upstream licenses and notices for dependencies that emit bundle code. */
async function bundledNotices(metafile) {
	const inputs = new Set(
		Object.values(metafile.outputs).flatMap((output) =>
			Object.entries(output.inputs)
				.filter(([, input]) => input.bytesInOutput > 0)
				.map(([name]) => name)
		)
	);
	const packages = new Map();
	for (const input of inputs) {
		let directory = path.dirname(path.resolve(repository, input));
		while (directory !== path.dirname(directory)) {
			const manifest = await readFile(path.join(directory, 'package.json'), 'utf8').catch(
				(error) => {
					if (error.code === 'ENOENT') return null;
					throw error;
				}
			);
			const metadata = manifest === null ? null : JSON.parse(manifest);
			if (metadata?.name && metadata?.version) {
				if (directory !== repository)
					packages.set(`${metadata.name}@${metadata.version}`, directory);
				break;
			}
			directory = path.dirname(directory);
		}
	}
	const notices = new Map();
	for (const [name, directory] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
		const files = (await readdir(directory, { withFileTypes: true }))
			.filter(
				(entry) =>
					entry.isFile() && /^(?:licen[cs]e|notice|copying)(?:[.-].*)?$/i.test(entry.name)
			)
			.map((entry) => entry.name)
			.sort();
		if (!files.length) throw new Error(`Missing bundled Java helper license: ${name}`);
		for (const file of files) {
			const text = await readFile(path.join(directory, file), 'utf8');
			const names = notices.get(text) ?? [];
			names.push(`${name}: ${file}`);
			notices.set(text, names);
		}
	}
	return [
		'Bundled Java helper dependencies',
		'The pinned upstream packages below are bundled and tree-shaken by esbuild. Their complete LICENSE/NOTICE texts follow; identical texts are listed once for all corresponding packages.',
		...Array.from(notices, ([text, names]) => `${names.join('\n')}\n\n${text}`)
	].join('\n\n');
}

/** Keep module paths stable and bundle the real upstream parsers without install dependencies. */
export async function bundleJavaDebugHelpers({
	outdir = path.join(repository, 'dist/playground')
} = {}) {
	const options = {
		absWorkingDir: repository,
		outdir,
		bundle: true,
		format: 'esm',
		platform: 'neutral',
		mainFields: ['module', 'main'],
		target: 'es2022',
		chunkNames: 'java-debug-[hash]',
		minify: true,
		legalComments: 'inline',
		metafile: true,
		banner: {
			js: '// Third-party license texts: java-debug-notices.txt beside the Java helpers.'
		}
	};
	const debuggerResult = await build({
		...options,
		entryPoints: {
			javaDebugSource: 'src/lib/playground/javaDebugSource.ts',
			'worker/javaDebugEvaluator': 'src/lib/playground/worker/javaDebugEvaluator.ts'
		},
		splitting: true,
		keepNames: true
	});
	// Keep the bytecode reader independent of the CST parser's shared name-retention helpers.
	const bytecodeResult = await build({
		...options,
		entryPoints: { javaMain: 'src/lib/playground/javaMain.ts' }
	});
	const metafile = {
		inputs: { ...debuggerResult.metafile.inputs, ...bytecodeResult.metafile.inputs },
		outputs: { ...debuggerResult.metafile.outputs, ...bytecodeResult.metafile.outputs }
	};
	const external = Object.values(metafile.outputs).flatMap((output) =>
		output.imports.filter((item) => item.external).map((item) => item.path)
	);
	if (external.length)
		throw new Error(`Java helpers contain external imports: ${external.join(', ')}`);
	await writeFile(path.join(outdir, 'java-debug-notices.txt'), await bundledNotices(metafile));
	return metafile;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	await bundleJavaDebugHelpers();
