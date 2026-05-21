import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const projectRoot = path.resolve(scriptsDir, '..');

function parseArgs(argv) {
	const options = {
		input: '',
		output: '',
		sourcePrefix: '',
		toolchainRoot: '/toolchain'
	};
	for (let index = 2; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--input') {
			options.input = path.resolve(projectRoot, argv[index + 1] || '');
			index += 1;
			continue;
		}
		if (argument === '--output') {
			options.output = path.resolve(projectRoot, argv[index + 1] || '');
			index += 1;
			continue;
		}
		if (argument === '--source-prefix') {
			options.sourcePrefix = argv[index + 1] || '';
			index += 1;
			continue;
		}
		if (argument === '--toolchain-root') {
			options.toolchainRoot = argv[index + 1] || '/toolchain';
			index += 1;
			continue;
		}
		if (argument === '--help') {
			process.stdout.write(`Usage: node scripts/patch-findlib-conf.mjs --input <path> --output <path> [options]

Options:
  --source-prefix <path>  Absolute source prefix to rewrite
  --toolchain-root <path> Browser-visible toolchain root. Default: /toolchain
`);
			process.exit(0);
		}
		throw new Error(`unsupported argument: ${argument}`);
	}
	if (!options.input || !options.output) {
		throw new Error('both --input and --output are required');
	}
	return options;
}

const options = parseArgs(process.argv);
const input = await readFile(options.input, 'utf8');
const normalizedSourcePrefix = options.sourcePrefix.replace(/\/+$/, '');
const rewritten = input
	.split('\n')
	.map((line) => {
		const match = line.match(/^([a-z_]+)\s*=\s*"([^"]*)"$/i);
		if (!match) {
			return line;
		}
		const [, key, value] = match;
		if (key !== 'path' && key !== 'destdir' && key !== 'stdlib' && key !== 'ldconf') {
			return line;
		}
		const separator = value.includes(':') && !value.includes(' ') ? ':' : ' ';
		const rewrittenValue = value
			.split(separator)
			.filter(Boolean)
			.map((segment) => {
				if (normalizedSourcePrefix && segment.startsWith(normalizedSourcePrefix)) {
					return `${options.toolchainRoot}${segment.slice(normalizedSourcePrefix.length)}`;
				}
				if (segment.startsWith('/')) {
					return segment;
				}
				return `${options.toolchainRoot}/${segment.replace(/^\/+/, '')}`;
			})
			.join(separator);
		return `${key}="${rewrittenValue}"`;
	})
	.join('\n');

await mkdir(path.dirname(options.output), { recursive: true });
await writeFile(options.output, rewritten.endsWith('\n') ? rewritten : `${rewritten}\n`, 'utf8');
process.stdout.write(`${options.output}\n`);

