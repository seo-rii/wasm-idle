// Run from the repository root: node scripts/probe-ruby-prepared-worker.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build as buildWithVite } from 'vite';
import { chromium } from 'playwright-core';

// Use the repository's declared Vite dependency rather than an undeclared bundler.
async function build(options) {
	let entry = options.entryPoints?.[0];
	if (options.stdin) {
		entry = path.join(path.dirname(options.outfile), 'probe-entry.ts');
		await writeFile(entry, options.stdin.contents);
	}
	await buildWithVite({
		root,
		configFile: false,
		publicDir: false,
		logLevel: 'error',
		resolve: { alias: options.alias },
		build: {
			target: options.target,
			outDir: path.dirname(options.outfile),
			emptyOutDir: false,
			minify: false,
			copyPublicDir: false,
			lib: { entry, formats: ['es'], fileName: () => path.basename(options.outfile) },
			rollupOptions: { output: { inlineDynamicImports: true } }
		}
	});
}

const root = fileURLToPath(new URL('../', import.meta.url));
const tmp = await mkdtemp(path.join(os.tmpdir(), 'ruby-prepared-'));
const alias = {
	$lib: path.join(root, 'src/lib'),
	'@wasm-idle/core': path.join(root, 'packages/core/src/index.ts')
};
let server, browser;
try {
	await build({
		entryPoints: [path.join(root, 'src/lib/playground/worker/ruby.ts')],
		target: 'es2022',
		alias,
		outfile: path.join(tmp, 'worker.mjs')
	});
	await build({
		stdin: {
			contents: "export { preflightRubySplitRuntimeAssets } from '@wasm-idle/core';"
		},
		target: 'es2022',
		alias,
		outfile: path.join(tmp, 'preflight.mjs')
	});
	const worker =
		`
let nativeInstances=0;
const nativeInstantiate=WebAssembly.instantiate;
WebAssembly.instantiate=function(...args){nativeInstances++;return nativeInstantiate.apply(this,args)};
const originalPost=self.postMessage.bind(self);
self.postMessage=(message,...rest)=>originalPost({...message,probeNativeInstances:nativeInstances},...rest);
` + (await readFile(path.join(tmp, 'worker.mjs'), 'utf8'));
	const assets = path.join(root, 'static/wasm-ruby/split');
	server = createServer(async (req, res) => {
		res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
		res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
		try {
			const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
			if (name === '/') {
				res.setHeader('Content-Type', 'text/html');
				res.end('<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,">');
				return;
			}
			if (name === '/worker.mjs') {
				res.setHeader('Content-Type', 'text/javascript');
				res.end(worker);
				return;
			}
			if (name === '/preflight.mjs') {
				res.setHeader('Content-Type', 'text/javascript');
				res.end(await readFile(path.join(tmp, 'preflight.mjs')));
				return;
			}
			const allowed = new Set([
				'runtime-split.v1.json',
				'runtime.mjs.bin',
				'ruby-core.wasm.gz.bin',
				'stdlib.pack.gz.bin'
			]);
			const file = name.slice('/assets/split/'.length);
			if (!name.startsWith('/assets/split/') || !allowed.has(file)) {
				res.writeHead(404);
				res.end();
				return;
			}
			res.setHeader('Content-Type', 'application/octet-stream');
			res.end(await readFile(path.join(assets, file)));
		} catch (error) {
			res.writeHead(500);
			res.end(String(error));
		}
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	browser = await chromium.launch({
		channel: process.env.BROWSER_CHANNEL || 'chrome',
		headless: true
	});
	const page = await browser.newPage();
	page.on('pageerror', (error) => console.error(error));
	await page.goto(`http://127.0.0.1:${server.address().port}/`);
	const result = await page.evaluate(async () => {
		const { preflightRubySplitRuntimeAssets } = await import('/preflight.mjs');
		const payload = await preflightRubySplitRuntimeAssets({
			baseUrl: new URL('/assets/', location.href).href
		});
		const context = {
			args: ['-r', 'must-not-load.rb'],
			activePath: 'main.rb',
			workspaceFiles: [
				{ path: 'data.txt', content: 'workspace' },
				{
					path: 'must-not-load.rb',
					content: 'raise "user code ran in bootstrap"'
				}
			]
		};
		const worker = new Worker('/worker.mjs', { type: 'module' });
		const check = (condition, message) => {
			if (!condition) throw Error(message);
		};
		function call(data, completion) {
			return new Promise((resolve, reject) => {
				const messages = [];
				const timer = setTimeout(
					() => reject(Error('Ruby worker request timed out')),
					45000
				);
				const fail = (error) => {
					clearTimeout(timer);
					worker.onmessage = worker.onerror = null;
					reject(error);
				};
				worker.onerror = (error) => fail(Error(error.message));
				worker.onmessage = ({ data: response }) => {
					messages.push(response);
					if (response.error) fail(Error(response.error));
					else if (response[completion] === true) {
						clearTimeout(timer);
						worker.onmessage = worker.onerror = null;
						resolve({ messages, instances: response.probeNativeInstances });
					}
				};
				worker.postMessage(data);
			});
		}
		const quiet = (result) =>
			!result.messages.some((message) => message.output || message.buffer);
		const output = (result) =>
			result.messages
				.filter((message) => message.output)
				.map((message) => message.output)
				.join('');
		try {
			const loaded = await call(
				{
					load: true,
					runtimePreflight: payload,
					maxAssetBytes: 40 * 1024 * 1024,
					startupContext: context
				},
				'load'
			);
			check(
				quiet(loaded) && loaded.instances > 0,
				'VM must initialize silently before load acknowledgment'
			);
			const options = {
				...context,
				buffer: new SharedArrayBuffer(4096),
				log: false,
				stdin: 'input-one\n'
			};
			for (let i = 0; i < 2; i++) {
				const prepared = await call(
					{
						...options,
						prepare: true,
						code: 'raise "prepare evaluated user code"'
					},
					'results'
				);
				check(
					quiet(prepared) && prepared.instances === loaded.instances,
					'Repeated prepare rebuilt or ran the VM'
				);
			}
			const first = await call(
				{
					...options,
					code: `require 'json'; require 'set'; require 'zlib'; STDOUT.sync=true
raise 'args' unless ARGV == ['-r','must-not-load.rb']
raise 'stdlib' unless Set[1,1].size == 1 && Zlib.inflate(Zlib.deflate('x')) == 'x'
File.write('/private.txt', 'must-not-leak'); $private_global=42
puts JSON.generate([STDIN.gets.strip,File.read('/data.txt'),ARGV])`
				},
				'results'
			);
			check(
				first.instances === loaded.instances,
				'First run did not claim the already initialized VM'
			);
			check(
				output(first) === '["input-one","workspace",["-r","must-not-load.rb"]]\n',
				'Unexpected first output: ' + output(first)
			);
			const second = await call(
				{
					...options,
					stdin: 'input-two\n',
					code: `STDOUT.sync=true; require 'json'
raise 'leak' if File.exist?('/private.txt') || defined?($private_global)
puts JSON.generate([STDIN.gets.strip,File.read('/data.txt')])`
				},
				'results'
			);
			check(second.instances > first.instances, 'Second run reused a dirty VM');
			check(
				output(second) === '["input-two","workspace"]\n',
				'Unexpected second output: ' + output(second)
			);
			const changed = {
				...options,
				args: ['new-arg'],
				workspaceFiles: [{ path: 'data.txt', content: 'changed' }]
			};
			const prepared = await call(
				{ ...changed, prepare: true, code: 'raise "must not run"' },
				'results'
			);
			const third = await call(
				{
					...changed,
					stdin: '',
					code: `STDOUT.sync=true; require 'json'; puts JSON.generate([ARGV,File.read('/data.txt'),STDIN.read])`
				},
				'results'
			);
			check(
				prepared.instances === third.instances && quiet(prepared),
				'Updated context was not reused'
			);
			check(
				output(third) === '[["new-arg"],"changed",""]\n',
				'Updated context/input incorrect'
			);
			return {
				crossOriginIsolated,
				instances: [
					loaded.instances,
					first.instances,
					second.instances,
					prepared.instances,
					third.instances
				],
				outputs: [output(first), output(second), output(third)]
			};
		} finally {
			worker.terminate();
		}
	});
	assert.equal(result.crossOriginIsolated, true);
	console.log(JSON.stringify(result, null, 2));
} finally {
	await browser?.close();
	if (server?.listening) await new Promise((resolve) => server.close(resolve));
	await rm(tmp, { recursive: true, force: true });
}
