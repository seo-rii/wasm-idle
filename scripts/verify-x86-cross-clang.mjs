#!/usr/bin/env node

// This is an acceptance test of a real producer bundle, not a fixture compiler.
// Compilation happens in a Chromium Worker. Only the known test programs below
// are executed by the Linux host; the browser never executes an x86 instruction.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const argv = process.argv.slice(2);
if (argv.includes('--help')) {
	console.log('Usage: node scripts/verify-x86-cross-clang.mjs /path/to/cross-toolchain.v1.json [output-directory]\n\nRequires a real wasm-llvm x86-64 bundle and installed Chromium.\nOn Linux x64, also verifies the generated programs with stdin/stdout.');
	process.exit(0);
}
if (argv.length < 1 || argv.length > 2) throw new Error('Expected a producer manifest path and optional fresh output directory; see --help');

const manifestPath = await fs.realpath(path.resolve(argv[0]));
const bundleRoot = path.dirname(manifestPath);
const manifestBytes = await fs.readFile(manifestPath);
const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
JSON.parse(manifestBytes); // Reject an invalid input before starting Chromium.
const output = path.resolve(argv[1] || `out/x86-clang-qualification-${Date.now()}`);
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error(`Output directory must be empty: ${output}`);

const cases = [
	{
		name: 'c-stdin', language: 'c', emit: 'executable', cpu: 'x86-64',
		code: '#include <stdio.h>\nint main(void) { long long a, b; if (scanf("%lld%lld", &a, &b) != 2) return 2; printf("%lld\\n", a + b); }\n',
		stdin: '123456789 987654321\n', stdout: '1111111110\n'
	},
	{
		name: 'cpp-pbds-stdin', language: 'cpp', emit: 'executable', cpu: 'x86-64',
		code: String.raw`#include <bits/stdc++.h>
#include <ext/pb_ds/assoc_container.hpp>
#include <ext/pb_ds/tree_policy.hpp>
using namespace __gnu_pbds;
int main() {
  tree<int, null_type, std::less<int>, rb_tree_tag, tree_order_statistics_node_update> values;
  int n, x; if (!(std::cin >> n)) return 2;
  while (n--) { std::cin >> x; values.insert(x); }
  if (values.size() != 4) return 3;
  try { throw std::runtime_error("expected"); }
  catch (const std::exception &e) { if (std::string(e.what()) != "expected") return 4; }
  std::cout << *values.find_by_order(2) << ' ' << values.order_of_key(7) << '\n';
}
`,
		stdin: '5\n2 9 7 2 5\n', stdout: '7 2\n'
	},
	...['assembly', 'object'].map((emit) => ({
		name: `avx2-${emit}`, language: 'c', emit, cpu: 'x86-64-v3',
		code: `#include <immintrin.h>
__attribute__((noinline)) void add8(const int *a, const int *b, int *out) {
  __m256i x = _mm256_loadu_si256((const __m256i *)a);
  __m256i y = _mm256_loadu_si256((const __m256i *)b);
  _mm256_storeu_si256((__m256i *)out, _mm256_add_epi32(x, y));
}
`
	}))
];

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'wasm-idle-cross-clang-'));
let server;
let browser;
const report = { schemaVersion: 1, manifestSha256, host: `${process.platform}-${process.arch}`, cases: [], success: false };
try {
	const [{ createServer }, { chromium }, { resolveChromiumExecutable }] = await Promise.all([
		import('vite'), import('playwright-core'), import('./rust-browser-probe-lib.mjs')
	]);
	server = await createServer({
		configFile: false,
		root: repoRoot,
		cacheDir: path.join(temporary, 'vite'),
		logLevel: 'error',
		optimizeDeps: { noDiscovery: true, include: ['@bjorn3/browser_wasi_shim'] },
		resolve: { alias: [{ find: /^@wasm-idle\/core$/, replacement: path.join(repoRoot, 'packages/core/src/index.ts') }] },
		server: { host: '127.0.0.1', port: 0, fs: { allow: [repoRoot] } },
		plugins: [{
			name: 'cross-clang-qualification',
			configureServer(vite) {
				vite.middlewares.use(async (request, response, next) => {
					const url = new URL(request.url || '/', 'http://localhost');
					if (url.pathname === '/cross-probe') {
						response.setHeader('Content-Type', 'text/html');
						response.end('<!doctype html><title>x86 cross compiler qualification</title>');
						return;
					}
					if (!url.pathname.startsWith('/cross-bundle/')) return next();
					try {
						const relative = decodeURIComponent(url.pathname.slice('/cross-bundle/'.length));
						const file = await fs.realpath(path.resolve(bundleRoot, relative));
						if (!file.startsWith(bundleRoot + path.sep) || !(await fs.stat(file)).isFile()) throw new Error('Invalid bundle asset path');
						response.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
						const stream = createReadStream(file);
						stream.on('error', () => response.destroy());
						stream.pipe(response);
					} catch {
						response.statusCode = 404;
						response.end('Bundle asset not found');
					}
				});
			}
		}]
	});
	await server.listen();
	const address = server.httpServer.address();
	assert(address && typeof address === 'object');
	const origin = `http://127.0.0.1:${address.port}`;
	browser = await chromium.launch({
		headless: true,
		executablePath: await resolveChromiumExecutable(process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || '')
	});
	const page = await browser.newPage();
	await page.goto(`${origin}/cross-probe`);
	report.browser = await browser.version();
	const { results, identity } = await page.evaluate(async ({ manifestUrl, manifestSha256, cases, origin }) => {
		const workerCode = `
import { createCrossClangCompiler } from ${JSON.stringify(`${origin}/packages/llvm-core/runtime/clang/src/cross-clang.ts`)};
self.onmessage = async ({ data }) => {
  let compiler;
  try {
    compiler = await createCrossClangCompiler({ manifestUrl: data.manifestUrl, manifestSha256: data.manifestSha256 });
    const results = [];
    for (const fixture of data.cases) {
      const start = performance.now();
      const result = compiler.compile({ code: fixture.code, language: fixture.language, cpu: fixture.cpu, emit: fixture.emit, optimization: '2' });
      results.push({ name: fixture.name, ...result,
        ...(result.artifact ? { artifact: { ...result.artifact, bytes: Array.from(result.artifact.bytes) } } : {}),
        elapsedMs: performance.now() - start });
    }
    // A failed compilation after a successful one must not expose old output.
    const invalid = compiler.compile({ code: 'int main( {', language: 'c' });
    if (invalid.exitCode === 0 || invalid.artifact) throw new Error('Failed compilation published an artifact');
    self.postMessage({ results, identity: compiler.identity });
  } catch (error) { self.postMessage({ error: String(error?.stack || error) }); }
  finally { compiler?.dispose(); }
};`;
		const url = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
		const worker = new Worker(url, { type: 'module' });
		try {
			return await new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('Cross compiler worker timed out after 10 minutes')), 600_000);
				worker.onmessage = ({ data }) => { clearTimeout(timer); data.error ? reject(new Error(data.error)) : resolve(data); };
				worker.onerror = (event) => { clearTimeout(timer); reject(new Error(event.message)); };
				worker.postMessage({ manifestUrl, manifestSha256, cases });
			});
		} finally { worker.terminate(); URL.revokeObjectURL(url); }
	}, { manifestUrl: `${origin}/cross-bundle/${encodeURIComponent(path.basename(manifestPath))}`, manifestSha256, cases, origin });
	report.identity = identity;
	assert.equal(identity.manifestSha256, manifestSha256);
	for (const [index, result] of results.entries()) {
		const fixture = cases[index];
		assert.equal(result.name, fixture.name);
		assert.equal(result.exitCode, 0, `${fixture.name}: ${result.stderr}`);
		assert(result.artifact, `${fixture.name}: no output artifact`);
		assert.equal(result.artifact.target, 'x86_64-unknown-linux-gnu');
		assert.equal(result.artifact.cpu, fixture.cpu);
		const bytes = Buffer.from(result.artifact.bytes);
		const extension = fixture.emit === 'assembly' ? '.s' : fixture.emit === 'object' ? '.o' : '.elf';
		const artifactPath = path.join(output, fixture.name + extension);
		await fs.writeFile(artifactPath, bytes, { mode: 0o700 });
		if (fixture.emit === 'assembly') {
			assert.match(bytes.toString(), /\bvpaddd\b/);
			assert.match(bytes.toString(), /\bymm\d+\b/);
		} else {
			assert.equal(bytes.subarray(0, 7).toString('hex'), '7f454c46020101');
			assert.equal(bytes.readUInt16LE(18), 62, 'ELF machine must be x86-64');
			assert.equal(bytes.readUInt16LE(16), fixture.emit === 'object' ? 1 : 2);
		}
		let nativeRun = 'not-applicable';
		let objectDisassembly = 'not-applicable';
		if (fixture.emit === 'object') {
			if (process.platform === 'linux' && process.arch === 'x64') {
				const disassembly = spawnSync('objdump', ['-d', artifactPath], { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 });
				assert.ifError(disassembly.error);
				assert.equal(disassembly.status, 0, disassembly.stderr);
				assert.match(disassembly.stdout, /\bvpaddd\b/);
				assert.match(disassembly.stdout, /\bymm\d+\b/);
				objectDisassembly = 'passed';
			} else objectDisassembly = 'requires-linux-x64-objdump';
		}
		if (fixture.emit === 'executable') {
			if (process.platform === 'linux' && process.arch === 'x64') {
				const execution = spawnSync(artifactPath, [], { input: fixture.stdin, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 });
				assert.ifError(execution.error);
				assert.equal(execution.status, 0, execution.stderr);
				assert.equal(execution.stdout, fixture.stdout);
				nativeRun = 'passed';
			} else nativeRun = 'requires-linux-x64';
		}
		report.cases.push({ name: fixture.name, cpu: fixture.cpu, format: result.artifact.format, bytes: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex'), elapsedMs: result.elapsedMs, nativeRun, objectDisassembly });
	}
	report.success = true;
	report.qualification = report.cases.some((entry) => entry.nativeRun === 'requires-linux-x64') ? 'browser-compilation-only' : 'browser-compilation-and-native-io';
} catch (error) {
	report.error = String(error?.stack || error);
	process.exitCode = 1;
} finally {
	await browser?.close();
	await server?.close();
	await fs.rm(temporary, { recursive: true, force: true });
	await fs.writeFile(path.join(output, 'qualification.json'), `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify({ success: report.success, output, ...(report.error ? { error: report.error } : {}) }));
}
