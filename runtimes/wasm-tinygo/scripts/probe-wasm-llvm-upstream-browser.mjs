#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

import { chromium } from 'playwright-core';

const FLAGS = new Map([
	['--dist', 'distPath'],
	['--compiler', 'compilerPath'],
	['--root-archive', 'rootArchivePath'],
	['--producer-receipt', 'producerReceiptPath'],
	['--package-graph', 'packageGraphPath'],
	['--package-graph-receipt', 'packageGraphReceiptPath'],
	['--lld', 'lldPath'],
	['--workspace-dir', 'workspaceDirPath'],
	['--stdin', 'stdinPath'],
	['--expected-stdout', 'expectedStdoutPath'],
	['--output', 'outputPath']
]);

function parseArgs(argv) {
	const options = {};
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		const property = FLAGS.get(flag);
		if (!property) throw new Error(`unknown option: ${flag}`);
		const value = argv[index + 1];
		if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
		if (options[property]) throw new Error(`duplicate option: ${flag}`);
		options[property] = path.resolve(value);
		index += 1;
	}
	for (const [flag, property] of FLAGS) {
		if (!options[property]) throw new Error(`${flag} is required`);
	}
	return options;
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function evidence(assetPath, bytes) {
	return { path: assetPath, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

function contentType(filePath) {
	if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
	if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
	if (filePath.endsWith('.wasm')) return 'application/wasm';
	return 'application/octet-stream';
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const workspaceFiles = {};
	const visitWorkspace = async (directory, prefix = '') => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
			const absolute = path.join(directory, entry.name);
			if (entry.isDirectory()) await visitWorkspace(absolute, relative);
			else if (entry.isFile())
				workspaceFiles[relative] = (await readFile(absolute)).toString('base64');
			else throw new Error(`unsupported workspace entry: ${relative}`);
		}
	};
	await visitWorkspace(options.workspaceDirPath);
	const [
		compiler,
		packageGraph,
		rootArchive,
		producerReceipt,
		packageGraphReceipt,
		lld,
		stdin,
		expectedStdout
	] = await Promise.all([
		readFile(options.compilerPath),
		readFile(options.packageGraphPath),
		readFile(options.rootArchivePath),
		readFile(options.producerReceiptPath),
		readFile(options.packageGraphReceiptPath),
		readFile(options.lldPath),
		readFile(options.stdinPath),
		readFile(options.expectedStdoutPath)
	]);
	const assetManifest = {
		schemaVersion: 2,
		format: 'wasm-idle-tinygo-upstream-assets-v2',
		producerReceipt: evidence('producer-receipt.json', producerReceipt),
		packageGraphReceipt: evidence('package-graph-provider-receipt.json', packageGraphReceipt),
		assets: {
			compiler: evidence('tinygo-compiler.wasm', compiler),
			packageGraph: evidence('tinygo-package-graph.wasm', packageGraph),
			rootArchive: evidence('tinygoroot.tar.gz', rootArchive),
			lld: evidence('lld.wasm', lld)
		}
	};
	const fixedAssets = new Map([
		['/tinygo-compiler.wasm', compiler],
		['/tinygo-package-graph.wasm', packageGraph],
		['/tinygoroot.tar.gz', rootArchive],
		['/producer-receipt.json', producerReceipt],
		['/package-graph-provider-receipt.json', packageGraphReceipt],
		['/lld.wasm', lld],
		['/workspace.json', Buffer.from(JSON.stringify(workspaceFiles))],
		['/stdin.txt', stdin],
		['/expected-stdout.txt', expectedStdout],
		['/asset-manifest.json', Buffer.from(JSON.stringify(assetManifest))]
	]);
	const harness = `<!doctype html>
<meta charset="utf-8">
<title>upstream TinyGo browser acceptance</title>
<script type="module">
import * as tinygo from '/upstream.js';

const loadBytes = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(\`fetch \${url} failed with \${response.status}\`);
  return new Uint8Array(await response.arrayBuffer());
};
window.__tinygoProbe = { status: 'running', phase: 'load' };
try {
  const [manifest, compiler, packageGraph, rootArchive, producerReceipt, packageGraphReceipt, lld, workspaceValue, stdin, expectedStdout] = await Promise.all([
	    fetch('/asset-manifest.json').then((response) => response.json()),
	    loadBytes('/tinygo-compiler.wasm'),
	    loadBytes('/tinygo-package-graph.wasm'),
	    loadBytes('/tinygoroot.tar.gz'),
	    loadBytes('/producer-receipt.json'),
	    loadBytes('/package-graph-provider-receipt.json'),
	    loadBytes('/lld.wasm'),
	    fetch('/workspace.json').then((response) => response.json()),
    loadBytes('/stdin.txt'),
    loadBytes('/expected-stdout.txt')
  ]);
  window.__tinygoProbe.phase = 'prepare';
	  const workspaceFiles = Object.fromEntries(Object.entries(workspaceValue).map(([name, encoded]) => {
	    const binary = atob(encoded);
	    return [name, Uint8Array.from(binary, (character) => character.charCodeAt(0))];
	  }));
	  const result = await tinygo.compileTinyGoInDisposableWorker(
	    { manifest, producerReceipt, packageGraphReceipt, compiler, packageGraph, rootArchive, lld },
	    { workspaceFiles },
	    {
	      maxWasmMemoryBytes: 768 * 1024 * 1024,
	      phaseTimeoutMs: { prepare: 120000, graph: 60000, validate: 30000, compile: 240000, link: 120000, optimize: 120000 },
        onPhase: (phase) => { window.__tinygoProbe.phase = phase; }
	    }
	  );
  window.__tinygoProbe.phase = 'execute';
  const execution = await tinygo.executeUpstreamTinyGoWasm({ wasm: result.wasm, stdin });
  const expected = new Uint8Array(expectedStdout);
  if (execution.exitCode !== 0) throw new Error(\`program exit code \${execution.exitCode}\`);
  if (execution.stdout.length !== expected.length || execution.stdout.some((value, index) => value !== expected[index])) {
    throw new Error(\`stdout mismatch: \${JSON.stringify(new TextDecoder().decode(execution.stdout))}\`);
  }
	  window.__tinygoProbe = {
	    status: 'passed',
	    phase: 'done',
	    compileProtocolVersion: result.linkPlan.schemaVersion,
	    packageCount: tinygo.parseConcatenatedTinyGoPackageJSON(result.packageJSON).length,
	    object: { bytes: result.object.byteLength, sha256: await tinygo.sha256TinyGoBytes(result.object) },
	    objects: await Promise.all(result.objects.map(async (object, index) => ({
	      path: result.linkPlan.schemaVersion === 1 ? result.linkPlan.object : result.linkPlan.objects[index].path,
	      bytes: object.byteLength,
	      sha256: await tinygo.sha256TinyGoBytes(object)
	    }))),
    unoptimizedWasm: { bytes: result.unoptimizedWasm.byteLength, sha256: await tinygo.sha256TinyGoBytes(result.unoptimizedWasm) },
    wasm: { bytes: result.wasm.byteLength, sha256: await tinygo.sha256TinyGoBytes(result.wasm) },
    execution: {
      exitCode: execution.exitCode,
      stdout: new TextDecoder().decode(execution.stdout),
      stdoutSha256: await tinygo.sha256TinyGoBytes(execution.stdout),
      stderrBytes: execution.stderr.byteLength
    }
  };
} catch (error) {
  window.__tinygoProbe = {
    status: 'failed',
    phase: window.__tinygoProbe.phase,
    error: error instanceof Error ? (error.stack || error.message) : String(error)
  };
}
</script>`;

	const server = createServer(async (request, response) => {
		try {
			const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
			if (pathname === '/') {
				response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
				response.end(harness);
				return;
			}
			const fixed = fixedAssets.get(pathname);
			if (fixed) {
				response.writeHead(200, {
					'content-type': contentType(pathname),
					'content-length': fixed.byteLength
				});
				response.end(fixed);
				return;
			}
			if (pathname.includes('..')) throw new Error('unsafe static path');
			const relative = pathname.replace(/^\/+/, '');
			const staticPath = path.resolve(options.distPath, relative);
			if (
				staticPath !== options.distPath &&
				!staticPath.startsWith(`${options.distPath}${path.sep}`)
			) {
				throw new Error('static path escaped dist');
			}
			const bytes = await readFile(staticPath);
			response.writeHead(200, {
				'content-type': contentType(staticPath),
				'content-length': bytes.byteLength
			});
			response.end(bytes);
		} catch {
			response.writeHead(404);
			response.end('not found');
		}
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string')
		throw new Error('browser probe server has no TCP address');
	const url = `http://127.0.0.1:${address.port}/`;
	let browser;
	try {
		browser = await chromium.launch({
			headless: true,
			...(process.env.WASM_TINYGO_CHROMIUM_PATH
				? { executablePath: process.env.WASM_TINYGO_CHROMIUM_PATH }
				: {})
		});
		const context = await browser.newContext();
		await context.addCookies([
			{
				name: 'dev_bypass_waf',
				value: 'seorii_bypass_token_is_this',
				url
			}
		]);
		const page = await context.newPage();
		page.on('console', (message) => {
			if (message.type() === 'error')
				process.stderr.write(`[browser console] ${message.text()}\n`);
		});
		await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
		let lastPhase = '';
		const deadline = Date.now() + 600_000;
		while (Date.now() < deadline) {
			const state = await page.evaluate(() => window.__tinygoProbe);
			if (state?.phase && state.phase !== lastPhase) {
				lastPhase = state.phase;
				process.stderr.write(`upstream browser phase=${lastPhase}\n`);
			}
			if (state?.status === 'passed') {
				const receipt = {
					schemaVersion: 2,
					format: 'wasm-idle-tinygo-upstream-browser-acceptance-v2',
					status: 'passed',
					producerReceiptSha256: sha256(producerReceipt),
					packageGraphReceiptSha256: sha256(packageGraphReceipt),
					assets: assetManifest.assets,
					binaryenVersion: '129.0.0',
					browser: await page.evaluate(() => navigator.userAgent),
					...state
				};
				await writeFile(options.outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
					flag: 'wx'
				});
				process.stdout.write(`passed: ${options.outputPath}\n`);
				return;
			}
			if (state?.status === 'failed')
				throw new Error(`browser probe failed at ${state.phase}: ${state.error}`);
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
		throw new Error(`browser probe timed out in phase ${lastPhase}`);
	} finally {
		await browser?.close();
		await new Promise((resolve) => server.close(resolve));
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
	process.exitCode = 1;
});
