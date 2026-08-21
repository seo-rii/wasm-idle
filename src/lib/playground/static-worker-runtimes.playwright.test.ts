// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runStdinBrowserProbe as runBaseStdinBrowserProbe } from '../../../scripts/stdin-browser-probe-lib.mjs';
import { WASM_NIM_RUNTIME_BUNDLE } from './wasmNimVersion';
import { WASM_PASCAL_RUNTIME_BUNDLE } from './wasmPascalVersion';

const prologStdinSource = `:- use_module(library(readutil)).

main :-
    format("value?~n", []),
    read_line_to_string(user_input, Line),
    number_string(N, Line),
    Result is N + 5,
    format("main=~w~n", [Result]).
`;

const gleamStdinSource = `import gleam/int
import gleam/io
import wasm_idle/stdin

pub fn main() {
  io.println("value?")
  let assert Ok(n) = int.parse(stdin.read_line())
  io.println("main=" <> int.to_string(n + 5))
}
`;

const perlStdinSource = `$| = 1;
print "value?\\n";
my $line = <STDIN>;
chomp $line;
print "main=", $line + 5, "\\n";
`;

const tclStdinSource = `puts "value?"
gets stdin line
puts "main=[expr {$line + 5}]"
`;

const awkStdinSource = `BEGIN {
  print "value?"
  fflush()
  if ((getline line) > 0) {
    print "main=" (line + 5)
  }
}
`;

const pascalStdinSource = `program Main;

var
  N: Integer;

begin
  WriteLn('value?');
  ReadLn(N);
  WriteLn('main=', N + 5);
end.
`;

const clojureScriptStdinSource = `(ns wasm-idle.main
  (:require [wasm-idle.runtime :as runtime]))

(do
  (println "value?")
  (let [n (js/parseInt (runtime/read-line) 10)]
    (println (str "main=" (+ n 5)))))
`;

const forthStdinSource = `: READ-NUMBER ( -- n )
  0
  BEGIN
    KEY DUP 10 <> OVER 13 <> AND
  WHILE
    48 - SWAP 10 * +
  REPEAT
  DROP
;

: PRINT-UINT ( n -- )
  0 <# #S #> TYPE
;

: RUN
  ." value?" CR
  READ-NUMBER 5 + ." main=" PRINT-UINT CR
;

RUN
`;

const jStdinSource = `smoutput 'value?'
input =: 1!:1 [ 1
n =: ". input
smoutput 'main=', ": n + 5
`;

const bqnStdinSource = `•Show "value?"
5 + •ParseFloat •GetLine @
`;

const janetStdinSource = `(print "value?")
(def n (scan-number (string/trim (getline))))
(print "main=" (+ n 5))
`;

const juliaStdinSource = `println("version=", VERSION)
print("value? ")
flush(stdout)
line = readline()
n = tryparse(Int, strip(line))
if n === nothing
    n = 0
end
println("main=", n + 5)
`;

const nimStdinSource = `import strutils

stdout.write("value?\\n")
stdout.flushFile()
let line = stdin.readLine()
let n =
  try:
    parseInt(line.strip())
  except ValueError:
    0

echo "main=", n + 5
`;

const runStdinBrowserProbe = (options: Parameters<typeof runBaseStdinBrowserProbe>[0]) =>
	runBaseStdinBrowserProbe({ ...options, sendEof: true });

async function withPreviewServer(
	syncScripts: string[],
	timeoutMs: number,
	callback: (browserUrl: string, close: () => Promise<void>) => Promise<void>
) {
	await runWithBrowserProbeSessionLock(async () => {
		const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
		const serverMode = process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
		const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
		if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
			await runBrowserPreparationScripts(
				[...syncScripts, 'compress:static-runtimes', 'build:preview'],
				{ timeoutMs }
			);
		}
		const previewServer = reuseProvidedBrowserUrl
			? {
					origin: new URL(configuredBrowserUrl).origin,
					browserUrl: configuredBrowserUrl,
					close: async () => {}
				}
			: await startBrowserPreviewServer(
					configuredBrowserUrl
						? {
								origin: new URL(configuredBrowserUrl).origin,
								basePath: new URL(configuredBrowserUrl).pathname,
								serverMode
							}
						: { origin: 'http://127.0.0.1:4678', serverMode }
				);
		try {
			await callback(previewServer.browserUrl, previewServer.close);
		} finally {
			await previewServer.close();
		}
	});
}

describe('wasm-idle static worker language browser integrations', () => {
	it('runs real SWI-Prolog wasm and connects stdin on the page path', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_PROLOG !== '1') return;
		await withPreviewServer(
			['sync:wasm-prolog'],
			Number(process.env.WASM_IDLE_PROLOG_PREP_TIMEOUT_MS || '900000'),
			async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					browserUrl,
					expectedOutput: 'main=73',
					language: 'PROLOG',
					runTimeoutMs: Number(process.env.WASM_IDLE_PROLOG_RUN_TIMEOUT_MS || '240000'),
					source: prologStdinSource,
					stdinText: '68\n',
					waitForOutputBeforeStdin: 'value?'
				});
				expect(summary.activeState.crossOriginIsolated).toBe(true);
				expect(summary.activeState.sharedArrayBuffer).toBe(true);
				expect(summary.activeState.serviceWorkerControlled).toBe(true);
				expect(summary.pageErrors).toEqual([]);
				expect(summary.transcript).toContain('main=73');
				expect(summary.transcript).toContain('Process finished after');
				const runtimePaths = summary.runtimeRequests.map(
					(requestUrl) => new URL(requestUrl).pathname
				);
				for (const assetPath of [
					'runtime-manifest.v2.json',
					'runner-worker.js',
					'swipl-web.data.gz.bin',
					'swipl-web.js',
					'swipl-web.wasm.gz.bin'
				]) {
					expect(
						runtimePaths.some((path) => path.endsWith(`/wasm-prolog/${assetPath}`))
					).toBe(true);
				}
				for (const legacyPath of ['swipl-web.data.gz', 'swipl-web.wasm.gz']) {
					expect(
						runtimePaths.some((path) => path.endsWith(`/wasm-prolog/${legacyPath}`))
					).toBe(false);
				}
			}
		);
	}, 960_000);

	it('runs real Gleam wasm compiler output and connects stdin on the page path', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_GLEAM !== '1') return;
		await withPreviewServer(
			['sync:wasm-gleam'],
			Number(process.env.WASM_IDLE_GLEAM_PREP_TIMEOUT_MS || '900000'),
			async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					browserUrl,
					expectedOutput: 'main=73',
					language: 'GLEAM',
					runTimeoutMs: Number(process.env.WASM_IDLE_GLEAM_RUN_TIMEOUT_MS || '240000'),
					source: gleamStdinSource,
					stdinText: '68\n',
					waitForOutputBeforeStdin: 'value?'
				});
				expect(summary.activeState.crossOriginIsolated).toBe(true);
				expect(summary.activeState.sharedArrayBuffer).toBe(true);
				expect(summary.activeState.serviceWorkerControlled).toBe(true);
				expect(summary.pageErrors).toEqual([]);
				expect(summary.transcript).toContain('main=73');
				expect(summary.transcript).toContain('Process finished after');
			}
		);
	}, 960_000);

	it('runs real WebPerl wasm and connects stdin on the page path', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_PERL !== '1') return;
		await withPreviewServer(
			['sync:wasm-perl'],
			Number(process.env.WASM_IDLE_PERL_PREP_TIMEOUT_MS || '900000'),
			async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					browserUrl,
					expectedOutput: 'main=73',
					language: 'PERL',
					runTimeoutMs: Number(process.env.WASM_IDLE_PERL_RUN_TIMEOUT_MS || '240000'),
					source: perlStdinSource,
					stdinText: '68\n',
					waitForOutputBeforeStdin: 'value?'
				});
				expect(summary.activeState.crossOriginIsolated).toBe(true);
				expect(summary.activeState.sharedArrayBuffer).toBe(true);
				expect(summary.activeState.serviceWorkerControlled).toBe(true);
				expect(summary.pageErrors).toEqual([]);
				expect(summary.transcript).toContain('main=73');
				expect(summary.transcript).toContain('Process finished after');
				const perlRuntimePaths = summary.runtimeRequests
					.map((requestUrl) => new URL(requestUrl).pathname)
					.filter((pathname) => pathname.includes('/wasm-perl/'))
					.map((pathname) => pathname.slice(pathname.indexOf('/wasm-perl/')));
				expect(new Set(perlRuntimePaths)).toEqual(
					new Set([
						'/wasm-perl/emperl.data.gz.bin',
						'/wasm-perl/emperl.js.gz.bin',
						'/wasm-perl/emperl.wasm.gz.bin',
						'/wasm-perl/runner-worker.js',
						'/wasm-perl/runtime-manifest.v2.json'
					])
				);
				for (const legacyPath of [
					'/wasm-perl/emperl.data.gz',
					'/wasm-perl/emperl.js.gz',
					'/wasm-perl/emperl.wasm.gz'
				]) {
					expect(perlRuntimePaths).not.toContain(legacyPath);
				}
			}
		);
	}, 960_000);

	it('runs real Wacl Tcl wasm and connects stdin on the page path', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_TCL !== '1') return;
		await withPreviewServer(
			['sync:wasm-tcl'],
			Number(process.env.WASM_IDLE_TCL_PREP_TIMEOUT_MS || '900000'),
			async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					browserUrl,
					expectedOutput: 'main=73',
					language: 'TCL',
					runTimeoutMs: Number(process.env.WASM_IDLE_TCL_RUN_TIMEOUT_MS || '240000'),
					source: tclStdinSource,
					stdinText: '68\n',
					waitForOutputBeforeStdin: 'value?'
				});
				expect(summary.activeState.crossOriginIsolated).toBe(true);
				expect(summary.activeState.sharedArrayBuffer).toBe(true);
				expect(summary.activeState.serviceWorkerControlled).toBe(true);
				expect(summary.pageErrors).toEqual([]);
				expect(summary.transcript).toContain('main=73');
				expect(summary.transcript).toContain('Process finished after');
				const tclRuntimePaths = summary.runtimeRequests
					.map((requestUrl) => new URL(requestUrl).pathname)
					.filter((pathname) => pathname.includes('/wasm-tcl/'))
					.map((pathname) => pathname.slice(pathname.indexOf('/wasm-tcl/')));
				expect(new Set(tclRuntimePaths)).toEqual(
					new Set([
						'/wasm-tcl/require.js',
						'/wasm-tcl/runner-worker.js',
						'/wasm-tcl/runtime-manifest.v2.json',
						'/wasm-tcl/tcl/wacl-custom.data.bin',
						'/wasm-tcl/tcl/wacl-library.data.gz.bin',
						'/wasm-tcl/tcl/wacl.js',
						'/wasm-tcl/tcl/wacl.wasm.gz.bin'
					])
				);
				expect(tclRuntimePaths).not.toContain('/wasm-tcl/tcl/wacl-custom.data');
			}
		);
	}, 960_000);

	it('runs real GoAWK wasm and connects stdin on the page path', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_AWK !== '1') return;
		await withPreviewServer(
			['sync:wasm-awk'],
			Number(process.env.WASM_IDLE_AWK_PREP_TIMEOUT_MS || '900000'),
			async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					browserUrl,
					expectedOutput: 'main=73',
					language: 'AWK',
					runTimeoutMs: Number(process.env.WASM_IDLE_AWK_RUN_TIMEOUT_MS || '240000'),
					source: awkStdinSource,
					stdinText: '68\n',
					waitForOutputBeforeStdin: 'value?'
				});
				expect(summary.activeState.crossOriginIsolated).toBe(true);
				expect(summary.activeState.sharedArrayBuffer).toBe(true);
				expect(summary.activeState.serviceWorkerControlled).toBe(true);
				expect(summary.pageErrors).toEqual([]);
				expect(summary.transcript).toContain('main=73');
				expect(summary.transcript).toContain('Process finished after');
			}
		);
	}, 960_000);

	it('runs real pas2js Pascal assets and connects stdin on the page path', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_PASCAL !== '1') return;
		await withPreviewServer(
			['sync:wasm-pascal'],
			Number(process.env.WASM_IDLE_PASCAL_PREP_TIMEOUT_MS || '900000'),
			async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					browserUrl,
					expectedOutput: 'main=73',
					language: 'PASCAL',
					runTimeoutMs: Number(process.env.WASM_IDLE_PASCAL_RUN_TIMEOUT_MS || '240000'),
					source: pascalStdinSource,
					stdinText: '68\n',
					waitForOutputBeforeStdin: 'value?'
				});
				expect(summary.activeState.crossOriginIsolated).toBe(true);
				expect(summary.activeState.sharedArrayBuffer).toBe(true);
				expect(summary.activeState.serviceWorkerControlled).toBe(true);
				expect(summary.pageErrors).toEqual([]);
				expect(summary.transcript).toContain('main=73');
				expect(summary.transcript).toContain('Process finished after');
				const pascalRequests = summary.runtimeRequests
					.map((requestUrl) => new URL(requestUrl))
					.filter(({ pathname }) => pathname.includes('/wasm-pascal/'));
				expect(pascalRequests).toHaveLength(5);
				const requestByPath = new Map(
					pascalRequests.map((url) => [
						url.pathname.slice(url.pathname.indexOf('/wasm-pascal/')),
						url
					])
				);
				expect(new Set(requestByPath.keys())).toEqual(
					new Set([
						'/wasm-pascal/runtime-manifest.v2.json',
						'/wasm-pascal/compiler.js.gz.bin',
						'/wasm-pascal/rtl.js.bin',
						'/wasm-pascal/system.pas.bin',
						'/wasm-pascal/runner-worker.js'
					])
				);
				expect(
					Object.fromEntries(
						[...requestByPath].map(([path, url]) => [path, url.searchParams.get('v')])
					)
				).toEqual({
					'/wasm-pascal/runtime-manifest.v2.json':
						WASM_PASCAL_RUNTIME_BUNDLE.profile.manifestFingerprint,
					'/wasm-pascal/compiler.js.gz.bin':
						WASM_PASCAL_RUNTIME_BUNDLE.profile.compilerJavaScriptReceipt.sha256,
					'/wasm-pascal/rtl.js.bin':
						WASM_PASCAL_RUNTIME_BUNDLE.profile.rtlJavaScriptReceipt.sha256,
					'/wasm-pascal/system.pas.bin':
						WASM_PASCAL_RUNTIME_BUNDLE.profile.systemPascalReceipt.sha256,
					'/wasm-pascal/runner-worker.js': WASM_PASCAL_RUNTIME_BUNDLE.workerReceipt.sha256
				});
				for (const forbiddenPath of [
					'/wasm-pascal/compiler.js',
					'/wasm-pascal/compiler.js.gz',
					'/wasm-pascal/rtl.js',
					'/wasm-pascal/system.pas'
				]) {
					expect(requestByPath.has(forbiddenPath)).toBe(false);
				}
			}
		);
	}, 960_000);

	it('runs the real self-hosted ClojureScript compiler and connects stdin', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_CLOJURESCRIPT !== '1') return;
		await withPreviewServer(
			['sync:wasm-clojurescript'],
			Number(process.env.WASM_IDLE_CLOJURESCRIPT_PREP_TIMEOUT_MS || '900000'),
			async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					browserUrl,
					expectedOutput: 'main=73',
					language: 'CLOJURESCRIPT',
					runTimeoutMs: Number(
						process.env.WASM_IDLE_CLOJURESCRIPT_RUN_TIMEOUT_MS || '240000'
					),
					source: clojureScriptStdinSource,
					stdinText: '68\n',
					waitForOutputBeforeStdin: 'value?'
				});
				expect(summary.activeState.crossOriginIsolated).toBe(true);
				expect(summary.activeState.sharedArrayBuffer).toBe(true);
				expect(summary.activeState.serviceWorkerControlled).toBe(true);
				expect(summary.pageErrors).toEqual([]);
				expect(summary.transcript).toContain('main=73');
				expect(summary.transcript).toContain('Process finished after');
				const runtimePaths = summary.runtimeRequests.map(
					(requestUrl) => new URL(requestUrl).pathname
				);
				expect(
					runtimePaths.some((path) =>
						path.endsWith('/wasm-clojurescript/runtime-manifest.v2.json')
					)
				).toBe(true);
				expect(
					runtimePaths.some((path) =>
						path.endsWith('/wasm-clojurescript/compiler.js.gz.bin')
					)
				).toBe(true);
				expect(
					runtimePaths.some((path) =>
						path.endsWith('/wasm-clojurescript/runner-worker.js')
					)
				).toBe(true);
				expect(
					runtimePaths.some((path) => path.endsWith('/wasm-clojurescript/compiler.js.gz'))
				).toBe(false);
				expect(
					runtimePaths.some((path) => path.endsWith('/wasm-clojurescript/compiler.js'))
				).toBe(false);
			}
		);
	}, 960_000);

	it('runs real WAForth wasm and connects stdin on the page path', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_FORTH !== '1') return;
		await withPreviewServer(
			['sync:wasm-forth'],
			Number(process.env.WASM_IDLE_FORTH_PREP_TIMEOUT_MS || '900000'),
			async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					browserUrl,
					expectedOutput: 'main=73',
					language: 'FORTH',
					runTimeoutMs: Number(process.env.WASM_IDLE_FORTH_RUN_TIMEOUT_MS || '240000'),
					source: forthStdinSource,
					stdinText: '68\n',
					waitForOutputBeforeStdin: 'value?'
				});
				expect(summary.activeState.crossOriginIsolated).toBe(true);
				expect(summary.activeState.sharedArrayBuffer).toBe(true);
				expect(summary.activeState.serviceWorkerControlled).toBe(true);
				expect(summary.pageErrors).toEqual([]);
				expect(summary.transcript).toContain('main=73');
				expect(summary.transcript).toContain('Process finished after');
			}
		);
	}, 960_000);

	it('runs real J playground wasm and connects stdin on the page path', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_J !== '1') return;
		await withPreviewServer(
			['sync:wasm-j'],
			Number(process.env.WASM_IDLE_J_PREP_TIMEOUT_MS || '900000'),
			async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					browserUrl,
					expectedOutput: 'main=73',
					language: 'J',
					runTimeoutMs: Number(process.env.WASM_IDLE_J_RUN_TIMEOUT_MS || '240000'),
					source: jStdinSource,
					stdinText: '68\n',
					waitForOutputBeforeStdin: 'value?'
				});
				expect(summary.activeState.crossOriginIsolated).toBe(true);
				expect(summary.activeState.sharedArrayBuffer).toBe(true);
				expect(summary.activeState.serviceWorkerControlled).toBe(true);
				expect(summary.pageErrors).toEqual([]);
				expect(summary.transcript).toContain('main=73');
				expect(summary.transcript).toContain('Process finished after');
			}
		);
	}, 960_000);

	it('runs real CBQN wasm and connects stdin on the page path', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_BQN !== '1') return;
		await withPreviewServer(
			['sync:wasm-bqn'],
			Number(process.env.WASM_IDLE_BQN_PREP_TIMEOUT_MS || '900000'),
			async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					browserUrl,
					expectedOutput: '73',
					language: 'BQN',
					runTimeoutMs: Number(process.env.WASM_IDLE_BQN_RUN_TIMEOUT_MS || '240000'),
					source: bqnStdinSource,
					stdinText: '68\n',
					waitForOutputBeforeStdin: 'value?'
				});
				expect(summary.activeState.crossOriginIsolated).toBe(true);
				expect(summary.activeState.sharedArrayBuffer).toBe(true);
				expect(summary.activeState.serviceWorkerControlled).toBe(true);
				expect(summary.pageErrors).toEqual([]);
				expect(summary.transcript).toContain('73');
				expect(summary.transcript).toContain('Process finished after');
			}
		);
	}, 960_000);

	it('runs real Janet VM wasm and connects stdin on the page path', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_JANET !== '1') return;
		await withPreviewServer(
			['sync:wasm-janet'],
			Number(process.env.WASM_IDLE_JANET_PREP_TIMEOUT_MS || '900000'),
			async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					browserUrl,
					expectedOutput: 'main=73',
					language: 'JANET',
					runTimeoutMs: Number(process.env.WASM_IDLE_JANET_RUN_TIMEOUT_MS || '240000'),
					source: janetStdinSource,
					stdinText: '68\n',
					waitForOutputBeforeStdin: 'value?'
				});
				expect(summary.activeState.crossOriginIsolated).toBe(true);
				expect(summary.activeState.sharedArrayBuffer).toBe(true);
				expect(summary.activeState.serviceWorkerControlled).toBe(true);
				expect(summary.pageErrors).toEqual([]);
				expect(summary.transcript).toContain('main=73');
				expect(summary.transcript).toContain('Process finished after');
				const janetRuntimePaths = summary.runtimeRequests
					.map((requestUrl) => new URL(requestUrl).pathname)
					.filter((pathname) => pathname.includes('/wasm-janet/'))
					.map((pathname) => pathname.slice(pathname.indexOf('/wasm-janet/')));
				expect(new Set(janetRuntimePaths)).toEqual(
					new Set([
						'/wasm-janet/janet.js',
						'/wasm-janet/janet.wasm.gz.bin',
						'/wasm-janet/runner-worker.js',
						'/wasm-janet/runtime-manifest.v2.json'
					])
				);
				expect(janetRuntimePaths).not.toContain('/wasm-janet/janet.wasm.gz');
				expect(janetRuntimePaths).not.toContain('/wasm-janet/janet.wasm');
			}
		);
	}, 960_000);

	it('runs real Julia wasm and connects stdin on the page path', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_JULIA !== '1') return;
		await withPreviewServer(
			['sync:wasm-julia'],
			Number(process.env.WASM_IDLE_JULIA_PREP_TIMEOUT_MS || '900000'),
			async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					browserUrl,
					expectedOutput: 'main=73',
					language: 'JULIA',
					runTimeoutMs: Number(process.env.WASM_IDLE_JULIA_RUN_TIMEOUT_MS || '240000'),
					source: juliaStdinSource,
					stdinText: '68\n',
					waitForOutputBeforeStdin: 'value?'
				});
				expect(summary.activeState.crossOriginIsolated).toBe(true);
				expect(summary.activeState.sharedArrayBuffer).toBe(true);
				expect(summary.activeState.serviceWorkerControlled).toBe(true);
				expect(summary.pageErrors).toEqual([]);
				expect(summary.transcript).toContain('version=1.3.0-DEV.560');
				expect(summary.transcript).toContain('main=73');
				expect(summary.transcript).toContain('Process finished after');
				const juliaRuntimePaths = summary.runtimeRequests
					.map((requestUrl) => new URL(requestUrl).pathname)
					.filter((pathname) => pathname.includes('/wasm-julia/'))
					.map((pathname) => pathname.slice(pathname.indexOf('/wasm-julia/')));
				expect(juliaRuntimePaths).toHaveLength(5);
				expect(new Set(juliaRuntimePaths)).toEqual(
					new Set([
						'/wasm-julia/julia.data.gz.bin',
						'/wasm-julia/julia.js.gz.bin',
						'/wasm-julia/julia.wasm.gz.bin',
						'/wasm-julia/runner-worker.js',
						'/wasm-julia/runtime-manifest.v2.json'
					])
				);
				for (const legacyPath of [
					'/wasm-julia/julia.data.gz',
					'/wasm-julia/julia.js.gz',
					'/wasm-julia/julia.wasm.gz',
					'/wasm-julia/julia.data',
					'/wasm-julia/julia.js',
					'/wasm-julia/julia.wasm'
				]) {
					expect(juliaRuntimePaths).not.toContain(legacyPath);
				}
			}
		);
	}, 960_000);

	it('runs real Nim wasm compiler output and connects stdin on the page path', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_NIM !== '1') return;
		await withPreviewServer(
			['sync:wasm-nim'],
			Number(process.env.WASM_IDLE_NIM_PREP_TIMEOUT_MS || '900000'),
			async (browserUrl) => {
				const summary = await runStdinBrowserProbe({
					browserUrl,
					expectedOutput: 'main=73',
					language: 'NIM',
					runTimeoutMs: Number(process.env.WASM_IDLE_NIM_RUN_TIMEOUT_MS || '420000'),
					source: nimStdinSource,
					stdinText: '68\n',
					waitForOutputBeforeStdin: 'value?'
				});
				expect(summary.activeState.crossOriginIsolated).toBe(true);
				expect(summary.activeState.sharedArrayBuffer).toBe(true);
				expect(summary.activeState.serviceWorkerControlled).toBe(true);
				expect(summary.pageErrors).toEqual([]);
				expect(summary.transcript).toContain('main=73');
				expect(summary.transcript).toContain('Process finished after');
				const nimRuntimePaths = summary.runtimeRequests
					.map((requestUrl) => new URL(requestUrl).pathname)
					.filter((pathname) => pathname.includes('/wasm-nim/'))
					.map((pathname) => pathname.slice(pathname.indexOf('/wasm-nim/')));
				const expectedNimRuntimePaths = [
					'/wasm-nim/runtime-manifest.v2.json',
					'/wasm-nim/nim/nim-bundle.js.gz.bin',
					'/wasm-nim/nim/nim.wasm.gz.bin',
					'/wasm-nim/nim/nimbase.h.bin',
					'/wasm-nim/clang/clang.js.bin',
					'/wasm-nim/clang/clang.wasm.gz.bin',
					'/wasm-nim/clang/lld.wasm.gz.bin',
					'/wasm-nim/clang/memfs.wasm.gz.bin',
					'/wasm-nim/clang/sysroot.tar.gz.bin',
					'/wasm-nim/runner-worker.js'
				];
				expect(nimRuntimePaths).toHaveLength(10);
				expect(new Set(nimRuntimePaths)).toEqual(new Set(expectedNimRuntimePaths));
				const expectedVersionByPath = new Map([
					[
						'/wasm-nim/runtime-manifest.v2.json',
						WASM_NIM_RUNTIME_BUNDLE.profile.manifestFingerprint
					],
					[
						'/wasm-nim/nim/nim-bundle.js.gz.bin',
						WASM_NIM_RUNTIME_BUNDLE.profile.nimJavaScriptReceipt.sha256
					],
					[
						'/wasm-nim/nim/nim.wasm.gz.bin',
						WASM_NIM_RUNTIME_BUNDLE.profile.nimWasmReceipt.sha256
					],
					[
						'/wasm-nim/nim/nimbase.h.bin',
						WASM_NIM_RUNTIME_BUNDLE.profile.nimbaseReceipt.sha256
					],
					[
						'/wasm-nim/clang/clang.js.bin',
						WASM_NIM_RUNTIME_BUNDLE.profile.clangJavaScriptReceipt.sha256
					],
					[
						'/wasm-nim/clang/clang.wasm.gz.bin',
						WASM_NIM_RUNTIME_BUNDLE.profile.clangWasmReceipt.sha256
					],
					[
						'/wasm-nim/clang/lld.wasm.gz.bin',
						WASM_NIM_RUNTIME_BUNDLE.profile.lldWasmReceipt.sha256
					],
					[
						'/wasm-nim/clang/memfs.wasm.gz.bin',
						WASM_NIM_RUNTIME_BUNDLE.profile.memfsWasmReceipt.sha256
					],
					[
						'/wasm-nim/clang/sysroot.tar.gz.bin',
						WASM_NIM_RUNTIME_BUNDLE.profile.sysrootReceipt.sha256
					],
					['/wasm-nim/runner-worker.js', WASM_NIM_RUNTIME_BUNDLE.workerReceipt.sha256]
				]);
				for (const requestUrl of summary.runtimeRequests) {
					const url = new URL(requestUrl);
					const runtimePath = url.pathname.slice(url.pathname.indexOf('/wasm-nim/'));
					const expectedVersion = expectedVersionByPath.get(runtimePath);
					if (!expectedVersion) continue;
					expect([...url.searchParams.keys()]).toEqual(['v']);
					expect(url.searchParams.get('v')).toBe(expectedVersion);
				}
				const runnerRequestIndex = nimRuntimePaths.indexOf('/wasm-nim/runner-worker.js');
				for (const runtimeAssetPath of expectedNimRuntimePaths.slice(0, 9)) {
					expect(nimRuntimePaths.indexOf(runtimeAssetPath)).toBeLessThan(
						runnerRequestIndex
					);
				}
				for (const legacyOrLogicalPath of [
					'/wasm-nim/nim/nim-bundle.js.gz',
					'/wasm-nim/nim/nim.wasm.gz',
					'/wasm-nim/nim/nimbase.h',
					'/wasm-nim/clang/clang.js',
					'/wasm-nim/clang/clang.wasm.gz',
					'/wasm-nim/clang/lld.wasm.gz',
					'/wasm-nim/clang/memfs.wasm.gz',
					'/wasm-nim/clang/sysroot.tar.gz',
					'/wasm-nim/nim/nim-bundle.js',
					'/wasm-nim/nim/nim.wasm',
					'/wasm-nim/clang/clang.wasm',
					'/wasm-nim/clang/lld.wasm',
					'/wasm-nim/clang/memfs.wasm',
					'/wasm-nim/clang/sysroot.tar'
				]) {
					expect(nimRuntimePaths).not.toContain(legacyOrLogicalPath);
				}
			}
		);
	}, 960_000);
});
