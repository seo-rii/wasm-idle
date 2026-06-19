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
});
