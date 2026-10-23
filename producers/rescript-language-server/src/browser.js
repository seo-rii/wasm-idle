import server from '#rescript-upstream-server';
import fs from './platform/fs.js';
import process from './platform/process.js';
import { execFileSync } from './platform/child-process.js';
import path from 'path-browserify';

function write(name, bytes) {
	fs.mkdirSync(path.dirname(name), { recursive: true });
	fs.writeFileSync(name, bytes);
}

export function start({ files, stdlib, send }) {
	for (const dir of ['/workspace/lib/bs', '/rescript', '/tmp', '/workspace/.lsp-tmp'])
		fs.mkdirSync(dir, { recursive: true });
	write('/rescript/server/package.json', '{"version":"1.74.0"}');
	const runtime = '/workspace/node_modules/@rescript/runtime';
	for (const file of stdlib) write(runtime + '/' + file.path, file.bytes);
	for (const file of files) write('/workspace/' + file.path, file.content);
	const sourceFiles = files.filter((f) => /\.resi?$/.test(f.path));
	if (sourceFiles.length > 64) throw Error('ReScript browser project exceeds 64 source files');
	const sourceDirs = [...new Set(sourceFiles.map((f) => path.dirname(f.path)))];
	const includeDirs = sourceDirs.map((dir) => path.join('/workspace/lib/bs', dir));
	if (!fs.existsSync('/workspace/rescript.json'))
		write(
			'/workspace/rescript.json',
			JSON.stringify({
				name: 'browser-project',
				sources: sourceDirs.map((dir) => ({ dir, subdirs: false })),
				uncurried: true,
				namespace: false
			})
		);
	const config = JSON.parse(fs.readFileSync('/workspace/rescript.json', 'utf8'));
	if (
		config.namespace ||
		config['bs-dependencies']?.length ||
		config['bs-dev-dependencies']?.length ||
		config.ppx ||
		config['ppx-flags']?.length
	)
		throw Error(
			'ReScript browser profile supports plain projects without namespaces, npm compiler dependencies, or PPX'
		);
	const flags = [
		'-bs-g',
		'-bs-package-name',
		config.name || 'browser-project',
		...(config.uncurried === false ? [] : ['-uncurried'])
	];
	if (config['bsc-flags']?.length)
		throw Error('Custom bsc-flags require a separate ReScript compiler profile');
	// Build metadata describes the actual original bsc invocation used by this host.
	write(
		'/workspace/lib/bs/build.ninja',
		'rule astj\n  command = /rescript/bsc.exe -bs-ast $i\nrule mij\n  command = /rescript/bsc.exe $i -I ' +
			runtime +
			'/lib/ocaml ' +
			includeDirs.map((dir) => '-I ' + dir).join(' ') +
			' ' +
			flags.join(' ') +
			'\n'
	);
	const modules = new Map();
	for (const file of sourceFiles) {
		const base = path.basename(file.path).replace(/\.resi?$/, '');
		const name = base[0].toUpperCase() + base.slice(1);
		const group = modules.get(name) || {};
		group[file.path.endsWith('.resi') ? 'interface' : 'implementation'] = file;
		modules.set(name, group);
	}
	const visited = new Set(),
		visiting = new Set();
	const compile = (file) => {
		if (visited.has(file.path)) return;
		if (visiting.has(file.path)) throw Error('Cyclic source module dependency');
		visiting.add(file.path);
		const ownBase = path.basename(file.path).replace(/\.resi?$/, '');
		const own = modules.get(ownBase[0].toUpperCase() + ownBase.slice(1));
		if (file.path.endsWith('.res') && own?.interface) compile(own.interface);
		const source = '/workspace/' + file.path,
			base = '/workspace/lib/bs/' + file.path.replace(/\.resi?$/, '');
		fs.mkdirSync(path.dirname(base), { recursive: true });
		const ast = base + (file.path.endsWith('.resi') ? '.iast' : '.ast');
		try {
			execFileSync('/rescript/bsc.exe', ['-bs-ast', '-o', ast, source]);
			const bytes = fs.readFileSync(ast),
				size = bytes.readUInt32BE(0);
			for (const name of bytes
				.subarray(4, 4 + size)
				.toString()
				.split('\n')
				.filter(Boolean)) {
				const dep = modules.get(name);
				if (dep) {
					if (dep.interface && dep.interface !== file) compile(dep.interface);
					if (
						dep.implementation &&
						dep.implementation !== file &&
						dep.implementation !== own?.implementation
					)
						compile(dep.implementation);
				}
			}
			execFileSync(
				'/rescript/bsc.exe',
				[
					'-I',
					runtime + '/lib/ocaml',
					...includeDirs.flatMap((d) => ['-I', d]),
					...flags,
					'-o',
					base + (file.path.endsWith('.resi') ? '.cmi' : '.cmj'),
					source
				],
				{ cwd: '/workspace', env: { RESCRIPT_RUNTIME: runtime } }
			);
		} catch (error) {
			if (!('status' in error)) throw error;
		}
		visiting.delete(file.path);
		visited.add(file.path);
	};
	for (const file of sourceFiles) compile(file);
	process.send = (message) => send(JSON.parse(JSON.stringify(message)));
	server(false);
	const canonical = new Map(
		files.map((file) => {
			const uri =
				'file:///workspace/' + file.path.split('/').map(encodeURIComponent).join('/');
			return [uri.toLowerCase(), uri];
		})
	);
	const normalizeUris = (value) =>
		typeof value === 'string'
			? canonical.get(value.toLowerCase()) || value
			: Array.isArray(value)
				? value.map(normalizeUris)
				: value && typeof value === 'object'
					? Object.fromEntries(
							Object.entries(value).map(([key, item]) => [key, normalizeUris(item)])
						)
					: value;
	const platformConfig = {
		askToStartBuild: false,
		platformPath: '/rescript',
		runtimePath: runtime,
		logLevel: 'error',
		cache: { projectConfig: { enable: false } },
		incrementalTypechecking: { enable: true, acrossFiles: true }
	};
	let incoming = Promise.resolve();
	const opened = new Set(),
		pending = [];
	const dispatch = async (message) => {
		for (const handler of process.listeners('message')) await handler(message);
	};
	return {
		receive(message) {
			message = normalizeUris(message);
			if (message.method === 'initialize') {
				const cfg = platformConfig;
				message = {
					...message,
					params: {
						...message.params,
						initializationOptions: {
							...message.params.initializationOptions,
							extensionConfiguration: cfg
						}
					}
				};
			}
			if (message.id === 'rescript_configuration_request' && 'result' in message)
				message = { ...message, result: [platformConfig] };
			incoming = incoming.then(async () => {
				if (message.method === '$/cancelRequest') {
					const index = pending.findIndex((request) => request.id === message.params?.id);
					if (index >= 0) {
						const request = pending.splice(index, 1)[0];
						send({
							jsonrpc: '2.0',
							id: request.id,
							error: { code: -32800, message: 'Request cancelled' }
						});
						return;
					}
				}
				const uri = message.params?.textDocument?.uri;
				if (
					message.id != null &&
					message.method?.startsWith('textDocument/') &&
					uri &&
					!opened.has(uri)
				) {
					if (pending.length >= 128)
						throw Error('ReScript pre-open request queue exceeds 128 messages');
					pending.push(message);
					return;
				}
				await dispatch(message);
				if (message.method === 'textDocument/didOpen') {
					opened.add(uri);
					for (let i = 0; i < pending.length;) {
						if (pending[i].params.textDocument.uri === uri)
							await dispatch(pending.splice(i, 1)[0]);
						else i++;
					}
				} else if (message.method === 'textDocument/didClose') opened.delete(uri);
			});
			return incoming;
		}
	};
}
