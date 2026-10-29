import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const repositoryRoot = path.resolve(root, '../..');
const canonicalWorkerRoot = path.join(repositoryRoot, 'src/lib/playground/worker/scala');
const evidencePath = path.join(root, 'evidence/browser.json');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const evidence = {
	startedAt: new Date().toISOString(),
	status: 'running',
	contract: 'Scala 3 / Scala.js candidate; buffered stdin; object Main',
	compileTimeoutMs: 120_000,
	executionTimeoutMs: 10_000,
	assets: [],
	adapterSources: [],
	canonicalAdapterSources: [],
	cases: []
};

async function inventory(directory, prefix = 'assets') {
	for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
		a.name.localeCompare(b.name)
	)) {
		const filename = path.join(directory, entry.name);
		const relative = `${prefix}/${entry.name}`;
		if (entry.isDirectory()) await inventory(filename, relative);
		else if (entry.isFile()) {
			const bytes = await readFile(filename);
			evidence.assets.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
		}
	}
}

const mime = {
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.json': 'application/json',
	'.wasm': 'application/wasm'
};
const server = createServer(async (request, response) => {
	response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
	response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
	try {
		const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
		if (pathname === '/') {
			response.setHeader('Content-Type', 'text/html');
			response.end('<!doctype html><title>Internal Scala browser qualification</title>');
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
		const bytes = await readFile(filename);
		response.setHeader(
			'Content-Type',
			mime[path.extname(filename)] ?? 'application/octet-stream'
		);
		response.end(bytes);
	} catch {
		response.writeHead(404).end('Not found');
	}
});

let browser;
let page;
async function compile(source) {
	const files = typeof source === 'string' ? [{ path: 'Main.scala', content: source }] : source;
	return page.evaluate(
		async ({ files, timeout }) => {
			const id = ++globalThis.scalaSequence;
			return new Promise((resolve, reject) => {
				const started = performance.now();
				const worker = globalThis.scalaCompiler;
				const timer = setTimeout(() => finish(new Error('Compiler timed out')), timeout);
				function finish(error, message) {
					clearTimeout(timer);
					worker.removeEventListener('message', onMessage);
					worker.removeEventListener('error', onError);
					if (error) reject(error);
					else resolve({ ...message, elapsedMs: performance.now() - started });
				}
				function onMessage({ data }) {
					if (data.id === id && ['compiled', 'error'].includes(data.type))
						finish(null, data);
				}
				function onError(event) {
					finish(new Error(event.message));
				}
				worker.addEventListener('message', onMessage);
				worker.addEventListener('error', onError);
				worker.postMessage({ id, files });
			});
		},
		{ files, timeout: evidence.compileTimeoutMs }
	);
}

async function execute(code, stdin = '', args = [], timeout = evidence.executionTimeoutMs) {
	return page.evaluate(
		async ({ code, stdin, args, timeout }) => {
			const id = ++globalThis.scalaSequence;
			const worker = new Worker('/src/execution.worker.js', { type: 'module' });
			const started = performance.now();
			let stdout = '';
			let stderr = '';
			return new Promise((resolve) => {
				const timer = setTimeout(() => finish({ type: 'timeout' }), timeout);
				function finish(message) {
					clearTimeout(timer);
					worker.terminate();
					resolve({ ...message, stdout, stderr, elapsedMs: performance.now() - started });
				}
				worker.onmessage = ({ data }) => {
					if (data.id !== id) return;
					if (data.type === 'stdout') stdout += data.data;
					else if (data.type === 'stderr') stderr += data.data;
					else if (['exit', 'error'].includes(data.type)) finish(data);
				};
				worker.onerror = (event) => finish({ type: 'error', message: event.message });
				worker.postMessage({ id, code, stdin, args });
			});
		},
		{ code, stdin, args, timeout }
	);
}

async function qualify(name, source, check) {
	const record = { name, sourceSha256: sha256(source), status: 'running' };
	evidence.cases.push(record);
	try {
		const result = await compile(source);
		record.compileMs = result.elapsedMs;
		record.compilerTimings = result.timings;
		record.diagnostics = result.diagnostics ?? [];
		await check(result, record);
		record.status = 'passed';
		console.log(`PASS ${name} (${Math.round(record.compileMs)}ms compile/link)`);
	} catch (error) {
		record.status = 'failed';
		record.error = String(error.stack ?? error);
		throw error;
	}
}

function compiled(result) {
	assert.equal(result.type, 'compiled', result.message ?? JSON.stringify(result.diagnostics));
	assert.equal(typeof result.code, 'string');
	assert.ok(result.code.length > 0);
}

async function outputCase(name, source, expected, stdin = '', args = []) {
	await qualify(name, source, async (result, record) => {
		compiled(result);
		const run = await execute(result.code, stdin, args);
		record.execution = run;
		assert.equal(run.type, 'exit', run.message);
		assert.equal(run.exitCode, 0);
		assert.equal(run.stdout, expected.stdout);
		assert.equal(run.stderr, expected.stderr ?? '');
	});
}

try {
	for (const filename of (await readdir(path.join(root, 'src')))
		.filter((name) => name.endsWith('.js'))
		.sort()) {
		const bytes = await readFile(path.join(root, 'src', filename));
		evidence.adapterSources.push({
			path: `src/${filename}`,
			bytes: bytes.length,
			sha256: sha256(bytes)
		});
	}
	for (const filename of (await readdir(canonicalWorkerRoot))
		.filter((name) => name.endsWith('.js'))
		.sort()) {
		const bytes = await readFile(path.join(canonicalWorkerRoot, filename));
		evidence.canonicalAdapterSources.push({
			path: `src/lib/playground/worker/scala/${filename}`,
			bytes: bytes.length,
			sha256: sha256(bytes)
		});
	}
	const harnessBytes = await readFile(fileURLToPath(import.meta.url));
	evidence.harnessSha256 = sha256(harnessBytes);
	await inventory(path.join(root, 'assets'));
	assert.ok(
		evidence.assets.length,
		'Prepared Scala assets are required; this harness never substitutes a mock compiler'
	);
	const lock = JSON.parse(await readFile(path.join(root, 'assets.lock.json'), 'utf8'));
	assert.ok(
		lock.repository && /^[a-f0-9]{40}$/.test(lock.revision),
		'An immutable upstream pin is required'
	);
	evidence.pin = { repository: lock.repository, revision: lock.revision };
	assert.equal(
		evidence.assets.length,
		lock.files.length,
		'Prepared assets must exactly match the lock'
	);
	for (const expected of lock.files) {
		const actual = evidence.assets.find((asset) => asset.path === `assets/${expected.path}`);
		assert.ok(actual, `Missing pinned asset ${expected.path}`);
		assert.equal(actual.bytes, expected.bytes, `Asset size differs: ${expected.path}`);
		assert.equal(actual.sha256, expected.sha256, `Asset integrity differs: ${expected.path}`);
	}
	evidence.assetIntegrity = 'verified';
	evidence.totalAssetBytes = evidence.assets.reduce((sum, asset) => sum + asset.bytes, 0);
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	const executablePath = await resolveChromiumExecutable(
		process.env.WASM_IDLE_CHROMIUM_EXECUTABLE
	);
	browser = await chromium.launch({ headless: true, executablePath });
	evidence.browserVersion = browser.version();
	page = await browser.newPage();
	// All compiler and library assets must come from the locally prepared producer output.
	await page.route('**/*', async (route) => {
		const url = route.request().url();
		if (url.startsWith(`${origin}/`) || url.startsWith('blob:') || url.startsWith('data:'))
			await route.continue();
		else await route.abort();
	});
	await page.goto(origin);
	evidence.features = await page.evaluate(() => ({
		JSTag: typeof WebAssembly.JSTag !== 'undefined',
		Suspending: typeof WebAssembly.Suspending === 'function',
		promising: typeof WebAssembly.promising === 'function'
	}));
	assert.ok(
		Object.values(evidence.features).every(Boolean),
		'Compiler requires WebAssembly JSTag, Suspending, and promising'
	);
	await page.evaluate(() => {
		globalThis.scalaSequence = 0;
		globalThis.scalaCompiler = new Worker('/src/compiler.worker.js', { type: 'module' });
	});

	await outputCase(
		'hello and runtime arguments',
		`object Main:
  def main(args: Array[String]): Unit =
    println("Hello, Scala!")
    println(args.mkString("|"))
`,
		{ stdout: 'Hello, Scala!\nfirst|둘\n' },
		'',
		['first', '둘']
	);
	await outputCase(
		'collections, case classes, matching, given/using',
		`case class Item(value: Int)
trait Render:
  def render(value: Int): String
given Render with
  def render(value: Int): String = s"value=$value"
def show(value: Int)(using renderer: Render): String = renderer.render(value)
object Main:
  def main(args: Array[String]): Unit =
    val total = List(Item(1), Item(2), Item(3)).map {
      case Item(value) => value * 2
    }.sum
    println(show(total))
`,
		{ stdout: 'value=12\n' }
	);
	await outputCase(
		'exact stdout and stderr whitespace',
		`object Main:
  def main(args: Array[String]): Unit =
    Console.print(" \\t\\n\\nlast")
    Console.err.print("\\n \\t\\nerror")
`,
		{ stdout: ' \t\n\nlast', stderr: '\n \t\nerror' }
	);
	await outputCase(
		'initial Unicode BOM is preserved independently on stdout and stderr',
		`object Main:
  def main(args: Array[String]): Unit =
    Console.print("\\uFEFF한글😀")
    Console.err.print("\\uFEFFé")
`,
		{ stdout: '\uFEFF한글😀', stderr: '\uFEFFé' }
	);
	const inputSource = `object Main:
  def main(args: Array[String]): Unit =
    var line = scala.io.StdIn.readLine()
    while line != null do
      println("[" + line + "]")
      line = scala.io.StdIn.readLine()
    println("EOF")
`;
	await outputCase('empty stdin reaches EOF', inputSource, { stdout: 'EOF\n' });
	await outputCase(
		'non-newline terminated stdin',
		inputSource,
		{ stdout: '[tail]\nEOF\n' },
		'tail'
	);
	await outputCase(
		'Unicode and empty input lines',
		inputSource,
		{ stdout: '[한글😀]\n[]\n[é]\nEOF\n' },
		'한글😀\n\né\n'
	);
	await qualify(
		'fresh mutable state on successive executions',
		`object Main:
  private var starts = 0
  def main(args: Array[String]): Unit =
    starts += 1
    println(s"starts=$starts")
    println("Hello, " + scala.io.StdIn.readLine())
`,
		async (result, record) => {
			compiled(result);
			record.executions = [];
			for (const name of ['Ada', 'Grace']) {
				const run = await execute(result.code, name);
				record.executions.push(run);
				assert.equal(run.type, 'exit', run.message);
				assert.equal(run.exitCode, 0);
				assert.equal(run.stdout, `starts=1\nHello, ${name}\n`);
				assert.equal(run.stderr, '');
			}
		}
	);
	await qualify(
		'invalid type rejects without returning an old artifact',
		`object Main:
  def main(args: Array[String]): Unit =
    val value: Int = "invalid"
    println(value)
`,
		async (result) => {
			assert.equal(result.type, 'error');
			assert.ok(!result.code, 'Failed compile must not return the preceding artifact');
			assert.ok(result.diagnostics?.length, 'Real compiler diagnostics are required');
		}
	);
	await outputCase(
		'compiler recovery after type error',
		`object Main:
  def main(args: Array[String]): Unit = println("recovered")
`,
		{ stdout: 'recovered\n' }
	);
	await qualify(
		'terminate infinite execution worker',
		`object Main:
  def main(args: Array[String]): Unit =
    println("started")
    while true do ()
`,
		async (result, record) => {
			compiled(result);
			const run = await execute(result.code);
			record.execution = run;
			assert.equal(run.type, 'timeout');
			assert.equal(run.stdout, 'started\n', 'Ensure the program started before timeout');
		}
	);
	await outputCase(
		'recovery after stopped execution',
		`object Main:
  def main(args: Array[String]): Unit = println("after stop")
`,
		{ stdout: 'after stop\n' }
	);

	const workspaceFiles = [
		{
			path: 'Main.scala',
			content:
				'object Main:\n  def main(args: Array[String]): Unit = println(example.Helper.message)\n'
		},
		{
			path: 'example/Helper.scala',
			content: 'package example\nobject Helper:\n  val message = "multiple files"\n'
		}
	];
	const workspaceRecord = {
		name: 'multiple workspace source files',
		files: workspaceFiles.map(({ path, content }) => ({ path, sourceSha256: sha256(content) })),
		status: 'running'
	};
	evidence.cases.push(workspaceRecord);
	try {
		const result = await compile(workspaceFiles);
		workspaceRecord.compileMs = result.elapsedMs;
		workspaceRecord.compilerTimings = result.timings;
		compiled(result);
		const run = await execute(result.code);
		workspaceRecord.execution = run;
		assert.equal(run.type, 'exit', run.message);
		assert.equal(run.exitCode, 0);
		assert.equal(run.stdout, 'multiple files\n');
		assert.equal(run.stderr, '');
		workspaceRecord.status = 'passed';
	} catch (error) {
		workspaceRecord.status = 'failed';
		workspaceRecord.error = String(error.stack ?? error);
		throw error;
	}

	// Use the product candidate API for cancellation; the preceding tests exercise
	// the lower-level wire protocol. Release the first compiler before loading another.
	await page.evaluate(() => globalThis.scalaCompiler.terminate());
	const candidateSources = {
		hello: 'object Main:\n  def main(args: Array[String]): Unit = println("candidate hello")\n',
		loop: 'object Main:\n  def main(args: Array[String]): Unit =\n    println("started")\n    while true do ()\n',
		recovery:
			'object Main:\n  def main(args: Array[String]): Unit = println("candidate recovered")\n'
	};
	const candidateRecord = {
		name: 'candidate API Stop and AbortController retain compiler and recover',
		sources: Object.fromEntries(
			Object.entries(candidateSources).map(([name, source]) => [name, sha256(source)])
		),
		status: 'running'
	};
	evidence.cases.push(candidateRecord);
	try {
		const observed = await page.evaluate(
			async ({ sources }) => {
				const { ScalaCandidate } = await import('/src/candidate.js');
				const counts = {
					compilerCreated: 0,
					compilerTerminated: 0,
					executionCreated: 0,
					executionTerminated: 0
				};
				const transcript = [];
				const candidate = new ScalaCandidate({
					workerFactory(kind) {
						counts[`${kind}Created`]++;
						const worker = new Worker(`/src/${kind}.worker.js`, { type: 'module' });
						const terminate = worker.terminate.bind(worker);
						let terminated = false;
						worker.terminate = () => {
							if (!terminated) counts[`${kind}Terminated`]++;
							terminated = true;
							terminate();
						};
						return worker;
					}
				});
				async function run(name, source, mode) {
					const started = performance.now();
					const controller = new AbortController();
					let stdout = '';
					let stderr = '';
					let cancelled = false;
					try {
						const result = await candidate.run(
							{ files: [{ path: 'Main.scala', content: source }] },
							{
								signal: controller.signal,
								onOutput(stream, text) {
									if (stream === 'stdout') stdout += text;
									else stderr += text;
									if (mode && stdout.includes('started\n') && !cancelled) {
										cancelled = true;
										if (mode === 'stop') candidate.stop();
										else controller.abort();
									}
								}
							}
						);
						transcript.push({
							name,
							result,
							stdout,
							stderr,
							elapsedMs: performance.now() - started
						});
					} catch (error) {
						transcript.push({
							name,
							error: error.message,
							cancelled,
							stdout,
							stderr,
							elapsedMs: performance.now() - started
						});
						if (!cancelled || !/abort/i.test(error.message)) throw error;
					}
				}
				try {
					await run('hello', sources.hello);
					await run('stop active program', sources.loop, 'stop');
					await run('recover after Stop', sources.recovery);
					await run('abort active program', sources.loop, 'abort');
					await run('recover after AbortController', sources.recovery);
					return { transcript, countsBeforeDispose: { ...counts }, counts };
				} finally {
					candidate.dispose();
				}
			},
			{ sources: candidateSources }
		);
		Object.assign(candidateRecord, observed);
		assert.equal(observed.transcript.length, 5);
		for (const [index, run] of observed.transcript.entries()) {
			assert.equal(run.stderr, '');
			if (index === 1 || index === 3) {
				assert.equal(run.cancelled, true);
				assert.match(run.error, /abort/i);
				assert.equal(run.stdout, 'started\n');
			} else {
				assert.equal(run.result.exitCode, 0);
				assert.equal(
					run.stdout,
					index === 0 ? 'candidate hello\n' : 'candidate recovered\n'
				);
			}
		}
		assert.deepEqual(observed.countsBeforeDispose, {
			compilerCreated: 1,
			compilerTerminated: 0,
			executionCreated: 5,
			executionTerminated: 5
		});
		assert.equal(observed.counts.compilerTerminated, 1);
		candidateRecord.status = 'passed';
	} catch (error) {
		candidateRecord.status = 'failed';
		candidateRecord.error = String(error.stack ?? error);
		throw error;
	}
	evidence.status = 'passed';
} catch (error) {
	evidence.status = 'failed';
	evidence.error = String(error.stack ?? error);
	console.error(evidence.error);
	process.exitCode = 1;
} finally {
	await browser?.close();
	if (server.listening) await new Promise((resolve) => server.close(resolve));
	evidence.finishedAt = new Date().toISOString();
	await mkdir(path.dirname(evidencePath), { recursive: true });
	await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
	console.log(`Evidence: ${evidencePath}`);
}
