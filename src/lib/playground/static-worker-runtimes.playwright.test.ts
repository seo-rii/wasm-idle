// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runStdinBrowserProbe } from '../../../scripts/stdin-browser-probe-lib.mjs';

const prologStdinSource = `:- use_module(library(readutil)).

main :-
    read_line_to_string(user_input, Line),
    number_string(N, Line),
    Result is N + 5,
    format("main=~w~n", [Result]).
`;

const gleamStdinSource = `import gleam/int
import gleam/io
import wasm_idle/stdin

pub fn main() {
  let assert Ok(n) = int.parse(stdin.read_line())
  io.println("main=" <> int.to_string(n + 5))
}
`;

const perlStdinSource = `my $line = <STDIN>;
chomp $line;
print "main=", $line + 5, "\\n";
`;

const tclStdinSource = `gets stdin line
puts "main=[expr {$line + 5}]"
`;

const awkStdinSource = `{ print "main=" ($1 + 5) }
`;

const pascalStdinSource = `program Main;

var
  N: Integer;

begin
  ReadLn(N);
  WriteLn('main=', N + 5);
end.
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
  READ-NUMBER 5 + ." main=" PRINT-UINT CR
;

RUN
`;

const jStdinSource = `input =: 1!:1 [ 1
n =: ". input
smoutput 'main=', ": n + 5
`;

const bqnStdinSource = `5 + •ParseFloat •GetLine @
`;

const janetStdinSource = `(def n (scan-number (string/trim (getline))))
(print "main=" (+ n 5))
`;

const juliaStdinSource = `line = readline()
n = tryparse(Int, strip(line))
if n === nothing
    n = 0
end
println("main=", n + 5)
`;

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
					stdinText: '68\n'
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
					stdinText: '68\n'
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
					stdinText: '68\n'
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
					stdinText: '68\n'
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
					stdinText: '68\n'
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
					stdinText: '68\n'
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
					stdinText: '68\n'
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
					stdinText: '68\n'
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
					stdinText: '68\n'
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
					stdinText: '68\n'
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
					stdinText: '68\n'
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
});
