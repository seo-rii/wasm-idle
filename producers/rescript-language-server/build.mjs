import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const require = createRequire(import.meta.url);
const receipt = (bytes) => ({
	bytes: bytes.length,
	sha256: createHash('sha256').update(bytes).digest('hex')
});

function command(program, args, cwd, env = process.env) {
	console.log(program, args.join(' '));
	const result = spawnSync(program, args, { cwd, env, stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) throw Error(`${program} exited ${result.status}`);
}

async function notices(inputs, sourceDirs, opamRoot, switchName) {
	const roots = new Set();
	for (const originalInput of Object.keys(inputs)) {
		const input = originalInput.replace(/^\(disabled\):/, '');
		const index = input.lastIndexOf('node_modules/');
		if (index < 0) continue;
		const segments = input.slice(index + 13).split('/'),
			count = segments[0].startsWith('@') ? 2 : 1;
		roots.add(
			path.resolve(
				ROOT,
				input.slice(0, index) + 'node_modules/' + segments.slice(0, count).join('/')
			)
		);
	}
	const sections = [];
	for (const directory of [...roots].sort()) {
		const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
		let text = `## ${pkg.name}@${pkg.version}\nLicense: ${pkg.license || 'See upstream notices'}\n`;
		for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
			a.name.localeCompare(b.name)
		))
			if (entry.isFile() && /^(license|licence|copying|notice)(?:[.\-]|$)/i.test(entry.name))
				text += '\n' + (await readFile(path.join(directory, entry.name), 'utf8')) + '\n';
		sections.push(text);
	}
	for (const [name, directory] of Object.entries(sourceDirs)) {
		let text = `## Original ReScript ${name} source\n`;
		for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
			a.name.localeCompare(b.name)
		))
			if (entry.isFile() && /^(license|licence|copying|notice)(?:[.\-]|$)/i.test(entry.name))
				text += '\n' + (await readFile(path.join(directory, entry.name), 'utf8')) + '\n';
		sections.push(text);
	}
	sections.push(
		'## js_of_ocaml 6.4.1 runtime\n' +
			(
				await readFile(
					path.join(opamRoot, switchName, 'lib/js_of_ocaml-compiler/runtime.js'),
					'utf8'
				)
			)
				.split('\n')
				.slice(0, 22)
				.join('\n')
	);
	sections.push(
		'## Jane Street Base runtime\n' +
			(await readFile(path.join(opamRoot, switchName, 'lib/base/runtime.js'), 'utf8'))
	);
	const runtimeRoot = path.dirname(require.resolve('@rescript/runtime/package.json'));
	sections.push(
		'## @rescript/runtime 12.3.1\n' +
			(await readFile(path.join(sourceDirs.compiler, 'LICENSE.MIT'), 'utf8'))
	);
	return sections.join('\n\n');
}

export async function buildReScriptLanguageServer({
	sourceDirs,
	cacheDir,
	targetDir,
	opamRoot,
	switchName = 'rescript-lsp',
	lock,
	setupToolchain = true
}) {
	const env = { ...process.env, OPAMROOT: opamRoot, OPAMSWITCH: switchName, OPAMJOBS: '2' };
	const probe = spawnSync('opam', ['exec', '--', 'ocamlc', '-version'], {
		env,
		encoding: 'utf8'
	});
	if (probe.status !== 0 && setupToolchain) {
		command('opam', ['init', '--bare', '--disable-sandboxing', '--no-setup', '-y'], ROOT, env);
		command(
			'opam',
			[
				'switch',
				'create',
				switchName,
				'ocaml-base-compiler.' + lock.toolchain.ocaml,
				'-j2',
				'-y'
			],
			ROOT,
			env
		);
		command(
			'opam',
			['pin', 'add', 'flow_parser', sourceDirs.flow, '--no-action', '-y'],
			ROOT,
			env
		);
		const packages = lock.toolchain.packages
			.filter(
				(p) =>
					p.version !== 'base' &&
					!['ocaml', 'ocaml-config', 'ocaml-base-compiler'].includes(p.name)
			)
			.map((p) => p.name + '.' + p.version);
		command('opam', ['install', '-j2', '-y', ...packages], ROOT, env);
	}
	const installed = spawnSync(
		'opam',
		['list', '--installed', '--short', '--columns=name,version'],
		{ env, encoding: 'utf8' }
	);
	if (installed.status !== 0)
		throw Error('The isolated ReScript OPAM toolchain is not available');
	const versions = new Map(
		installed.stdout
			.trim()
			.split('\n')
			.map((line) => line.trim().split(/\s+/))
	);
	for (const pkg of lock.toolchain.packages)
		if (versions.get(pkg.name) !== pkg.version)
			throw Error(`ReScript producer requires ${pkg.name}.${pkg.version}`);
	const dunePath = path.join(sourceDirs.compiler, 'compiler/bsc/dune');
	const original = await readFile(dunePath, 'utf8'),
		anchor = '(name rescript_compiler_main)';
	if (original.split(anchor).length !== 2)
		throw Error('Original ReScript executable build anchor changed');
	await writeFile(dunePath, original.replace(anchor, anchor + '\n (modes byte exe)'));
	const buildDir = path.join(cacheDir, 'ocaml-build');
	command(
		'opam',
		[
			'exec',
			'--',
			'dune',
			'build',
			'--build-dir',
			buildDir,
			'--profile',
			'release',
			'-j2',
			'compiler/bsc/rescript_compiler_main.bc',
			'analysis/bin/main.bc'
		],
		sourceDirs.compiler,
		env
	);
	const generated = path.join(cacheDir, 'generated');
	await mkdir(generated, { recursive: true });
	const bytecode = {
		compiler: 'compiler/bsc/rescript_compiler_main.bc',
		analysis: 'analysis/bin/main.bc'
	};
	const generatedPaths = {};
	for (const [name, file] of Object.entries(bytecode)) {
		const output = path.join(generated, name + '.js');
		const inputs = [
			await readFile(path.join(ROOT, 'platform-runtime.js')),
			await readFile(path.join(opamRoot, switchName, 'lib/base/runtime.js')),
			await readFile(path.join(buildDir, 'default', file))
		];
		const key = createHash('sha256')
			.update(lock.toolchain.jsOfOcaml)
			.update(Buffer.concat(inputs))
			.digest('hex');
		let cached = false;
		try {
			const manifest = JSON.parse(await readFile(output + '.receipt', 'utf8'));
			const bytes = await readFile(output);
			cached = manifest.key === key && manifest.sha256 === receipt(bytes).sha256;
		} catch {}
		if (!cached) {
			command(
				'opam',
				[
					'exec',
					'--',
					'js_of_ocaml',
					'compile',
					'--target-env=nodejs',
					'--pretty',
					'--disable',
					'genprim',
					path.join(ROOT, 'platform-runtime.js'),
					path.join(opamRoot, switchName, 'lib/base/runtime.js'),
					path.join(buildDir, 'default', file),
					'-o',
					output
				],
				sourceDirs.compiler,
				env
			);
			await writeFile(
				output + '.receipt',
				JSON.stringify({ key, ...receipt(await readFile(output)) }) + '\n'
			);
		}
		const body = await readFile(output, 'utf8');
		generatedPaths[name] = path.join(generated, name + '.mjs');
		await writeFile(
			generatedPaths[name],
			'const nativeGlobal = globalThis;\nexport function run(process, require) {\nconst globalThis = Object.create(nativeGlobal, {process: {value: process, writable: true, configurable: true}});\n' +
				body +
				'\n}\n'
		);
	}
	const platform = (name) => path.join(ROOT, 'src/platform', name + '.js');
	const aliases = {
		fs: platform('fs'),
		'fs/promises': platform('fs-promises'),
		path: require.resolve('path-browserify'),
		process: platform('process'),
		os: platform('os'),
		url: platform('url'),
		child_process: platform('child-process'),
		perf_hooks: platform('perf-hooks'),
		console: platform('console'),
		util: require.resolve('util/'),
		buffer: require.resolve('buffer/'),
		events: require.resolve('events/'),
		stream: require.resolve('stream-browserify'),
		assert: require.resolve('assert/')
	};
	const vls = require.resolve('vscode-languageserver'),
		rpc = require.resolve('vscode-jsonrpc');
	const built = await build({
		absWorkingDir: ROOT,
		entryPoints: ['src/browser.js'],
		write: false,
		bundle: true,
		metafile: true,
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
		minify: true,
		nodePaths: [path.join(ROOT, 'node_modules')],
		tsconfigRaw: { compilerOptions: { target: 'ES2022' } },
		define: { __dirname: '"/rescript/server/out"', global: 'globalThis' },
		inject: [platform('globals')],
		plugins: [
			{
				name: 'original-rescript-browser-platform',
				setup(b) {
					b.onResolve({ filter: /^#rescript-/ }, ({ path: requested }) => ({
						path:
							requested === '#rescript-upstream-server'
								? path.join(sourceDirs.server, 'server/src/server.ts')
								: generatedPaths[requested.slice('#rescript-'.length)]
					}));
					b.onResolve({ filter: /^vscode-languageserver(?:\/node)?$/ }, () => ({
						path: path.resolve(path.dirname(vls), '../browser/main.js')
					}));
					b.onResolve({ filter: /^vscode-jsonrpc\/node$/ }, () => ({
						path: path.resolve(path.dirname(rpc), '../browser/main.js')
					}));
					b.onResolve(
						{
							filter: /^(?:node:)?(?:fs(?:\/promises)?|path|process|os|url|child_process|perf_hooks|console|util|buffer|events|stream|assert)$/
						},
						({ path: requested }) => ({
							path: aliases[requested.replace(/^node:/, '')]
						})
					);
				}
			}
		]
	});
	const runtimeRoot = path.dirname(require.resolve('@rescript/runtime/package.json'));
	const files = [];
	for (const directory of ['lib/ocaml']) {
		for (const entry of (
			await readdir(path.join(runtimeRoot, directory), { withFileTypes: true })
		).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
			if (!entry.isFile()) throw Error('Unexpected nested ReScript stdlib directory');
			const bytes = await readFile(path.join(runtimeRoot, directory, entry.name));
			files.push({ path: directory + '/' + entry.name, bytes });
		}
	}
	files.push({
		path: 'package.json',
		bytes: await readFile(path.join(runtimeRoot, 'package.json'))
	});
	const header = Buffer.from(
		JSON.stringify({
			format: 'wasm-idle-rescript-stdlib-v1',
			files: files.map((f) => ({ path: f.path, size: f.bytes.length }))
		})
	);
	const length = Buffer.alloc(4);
	length.writeUInt32LE(header.length);
	const pack = Buffer.concat([length, header, ...files.map((f) => f.bytes)]);
	const runtime = built.outputFiles[0].contents;
	const outputs = {
		'runtime.mjs.gz.bin': gzipSync(runtime, { level: 9 }),
		'stdlib.pack.gz.bin': gzipSync(pack, { level: 9 }),
		'THIRD_PARTY_NOTICES.txt': Buffer.from(
			await notices(built.metafile.inputs, sourceDirs, opamRoot, switchName)
		)
	};
	await mkdir(targetDir, { recursive: true });
	const assets = {};
	for (const [name, bytes] of Object.entries(outputs)) {
		await writeFile(path.join(targetDir, name), bytes);
		assets[name] = receipt(bytes);
	}
	return {
		assets,
		decoded: { runtime: receipt(runtime), stdlib: receipt(pack) },
		sourceFiles: files.length
	};
}
