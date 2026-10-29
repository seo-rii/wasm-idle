import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = path.resolve(root, '../..');
const canonicalWorkerRoot = path.join(repositoryRoot, 'src/lib/playground/worker/scala');
const assets = [];
async function inventory(directory, prefix = '') {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const filename = path.join(directory, entry.name);
		const relative = `${prefix}${entry.name}`;
		if (entry.isDirectory()) await inventory(filename, `${relative}/`);
		else if (entry.isFile()) {
			const bytes = await readFile(filename);
			assets.push({
				path: relative,
				bytes: bytes.length,
				sha256: createHash('sha256').update(bytes).digest('hex')
			});
		}
	}
}
// Check the complete immutable producer inventory before loading its compiler.
await inventory(path.join(root, 'assets'));
const lock = JSON.parse(await readFile(path.join(root, 'assets.lock.json'), 'utf8'));
assert.ok(lock.repository && /^[a-f0-9]{40}$/.test(lock.revision));
assert.equal(assets.length, lock.files.length);
for (const expected of lock.files) {
	assert.deepEqual(
		assets.find(({ path }) => path === expected.path),
		expected
	);
}

const server = createServer(async (request, response) => {
	response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
	response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
	try {
		const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
		if (pathname === '/') {
			response.setHeader('Content-Type', 'text/html');
			response.end('<!doctype html><title>Scala output limit regression</title>');
			return;
		}
		const canonicalPrefix = '/src/lib/playground/worker/scala/';
		const assetsPrefix = '/runtimes/wasm-scala/assets/';
		const servingRoot = pathname.startsWith(canonicalPrefix) ? canonicalWorkerRoot : root;
		const relativePath = pathname.startsWith(canonicalPrefix)
			? pathname.slice(canonicalPrefix.length)
			: pathname.startsWith(assetsPrefix)
				? `assets/${pathname.slice(assetsPrefix.length)}`
				: `.${pathname}`;
		const filename = path.resolve(servingRoot, relativePath);
		if (!filename.startsWith(`${path.resolve(servingRoot)}${path.sep}`))
			throw new Error('Outside Scala test roots');
		const mime = {
			'.js': 'text/javascript',
			'.json': 'application/json',
			'.wasm': 'application/wasm'
		};
		response.setHeader(
			'Content-Type',
			mime[path.extname(filename)] ?? 'application/octet-stream'
		);
		response.end(await readFile(filename));
	} catch {
		response.writeHead(404).end('Not found');
	}
});
let browser;
try {
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	const executablePath = await resolveChromiumExecutable(
		process.env.WASM_IDLE_CHROMIUM_EXECUTABLE
	);
	browser = await chromium.launch({ headless: true, executablePath });
	const page = await browser.newPage();
	await page.route('**/*', (route) => {
		const url = route.request().url();
		return url.startsWith(`${origin}/`) || url.startsWith('blob:') || url.startsWith('data:')
			? route.continue()
			: route.abort();
	});
	await page.goto(origin);
	await page.evaluate(async () => {
		if (!WebAssembly.JSTag || !WebAssembly.Suspending || !WebAssembly.promising)
			throw new Error('Compiler requires JSTag, Suspending, and promising');
		const { ScalaCandidate } = await import('/src/candidate.js');
		globalThis.candidate = new ScalaCandidate();
	});
	const source = `object Main:
  def main(args: Array[String]): Unit =
    if args(0) == "recovery" then
      println("recovered")
    else
      val count = args(1).toInt
      try Console.print("x" * count)
      catch
        case _: Throwable =>
          if args(0) == "loop" then
            while true do ()
          else
            try Console.print("after violation")
            catch case _: Throwable => ()
`;
	const compiled = await page.evaluate(async (source) => {
		return globalThis.candidate.compile([{ path: 'Main.scala', content: source }]);
	}, source);
	assert.equal(typeof compiled.code, 'string');
	async function execute(args, observeCompletion = false) {
		return page.evaluate(
			({ code, args, observeCompletion }) =>
				new Promise((resolve, reject) => {
					const worker = new Worker('/src/execution.worker.js', { type: 'module' });
					let stdout = '';
					let stderr = '';
					const terminal = [];
					let completionTimer;
					const timer = setTimeout(
						() => finish(new Error('Execution timed out')),
						10_000
					);
					function finish(error) {
						clearTimeout(timer);
						clearTimeout(completionTimer);
						worker.terminate();
						if (error) reject(error);
						else resolve({ stdout, stderr, terminal });
					}
					worker.onerror = (event) => finish(new Error(event.message));
					worker.onmessage = ({ data }) => {
						if (data.id !== 1 || data.type === 'execution-ready') return;
						if (data.type === 'stdout') stdout += data.data;
						else if (data.type === 'stderr') stderr += data.data;
						else {
							terminal.push(data);
							// Catch-and-return stays alive briefly to reveal duplicate exit/error messages.
							// Catch-and-loop must report immediately so the host can terminate it.
							if (observeCompletion)
								completionTimer ??= setTimeout(() => finish(), 200);
							else finish();
						}
					};
					worker.postMessage({ id: 1, code, stdin: '', args });
				}),
			{ code: compiled.code, args, observeCompletion }
		);
	}
	const budget = 1024 * 1024;
	const exact = await execute(['return', String(budget)], true);
	assert.equal(exact.stdout, 'x'.repeat(budget));
	assert.equal(exact.stderr, '');
	assert.deepEqual(exact.terminal, [{ id: 1, type: 'exit', exitCode: 0 }]);
	console.log('PASS exact output budget succeeds');
	for (const mode of ['return', 'loop']) {
		const result = await execute([mode, String(budget + 1)], mode === 'return');
		// PrintStream emits chunks: accepted bytes remain visible, while the overflowing
		// byte and the attempted "after violation" write must never reach the host.
		assert.equal(result.stdout.length, budget);
		assert.ok(/^x+$/.test(result.stdout), 'Subsequent writes must be suppressed');
		assert.equal(result.stderr, '');
		assert.equal(result.terminal.length, 1, 'Exactly one terminal failure is allowed');
		assert.equal(result.terminal[0].type, 'error');
		assert.match(result.terminal[0].message, /output exceeds 1 MiB/);
		console.log(`PASS one-byte overflow caught by Throwable then ${mode}`);
		const recovery = await execute(['recovery']);
		assert.equal(recovery.stdout, 'recovered\n');
		assert.equal(recovery.stderr, '');
		assert.deepEqual(recovery.terminal, [{ id: 1, type: 'exit', exitCode: 0 }]);
		console.log(`PASS fresh execution recovers after ${mode}`);
	}
} finally {
	await browser?.close();
	if (server.listening) await new Promise((resolve) => server.close(resolve));
}
