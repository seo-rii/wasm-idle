// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runStdinBrowserProbe } from '../../../scripts/stdin-browser-probe-lib.mjs';

const assemblyScriptStdinSource = `@external("env", "readLine")
declare function readLine(): string | null;

export function main(): string {
  const line = readLine();
  return line == null ? "EOF" : line;
}`;

const watStdinSource = `(module
  (import "env" "readByte" (func $readByte (result i32)))
  (func (export "main") (result i32)
    call $readByte
  )
)`;

const rubyStdinSource = `line = STDIN.gets&.strip || ""
puts "main=#{line}"`;

const rStdinSource = `line <- readLines(stdin(), n = 1, warn = FALSE)
cat(sprintf("main=%s\\n", trimws(line[[1]])))`;

const sqliteOutputSource = `SELECT 'main=73' AS result;`;

const phpStdinSource = `<?php
$input = trim(file_get_contents('php://input'));
echo "main=", $input, "\\n";`;

describe('wasm-idle browser stdin connection', () => {
	it('passes terminal stdin and output through real browser runtime paths', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_STDIN !== '1') {
			return;
		}

		await runWithBrowserProbeSessionLock(async () => {
			const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
			const serverMode =
				process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
			const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
			if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
				await runBrowserPreparationScripts(['build:preview']);
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
							: { origin: 'http://localhost:4573', serverMode }
					);

			try {
				const assemblyScriptSummary = await runStdinBrowserProbe({
					browserUrl: previewServer.browserUrl,
					expectedOutput: 'main=73',
					language: 'ASSEMBLYSCRIPT',
					runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '180000'),
					source: assemblyScriptStdinSource,
					stdinText: '73\n'
				});
				expect(assemblyScriptSummary.transcript).toContain('main=73');

				const watSummary = await runStdinBrowserProbe({
					browserUrl: previewServer.browserUrl,
					expectedOutput: 'main=75',
					language: 'WAT',
					runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '180000'),
					source: watStdinSource,
					stdinText: 'K\n'
				});
				expect(watSummary.transcript).toContain('main=75');

				const rubySummary = await runStdinBrowserProbe({
					browserUrl: previewServer.browserUrl,
					expectedOutput: 'main=73',
					language: 'RUBY',
					runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '300000'),
					source: rubyStdinSource,
					stdinText: '73\n'
				});
				expect(rubySummary.transcript).toContain('main=73');

				const rSummary = await runStdinBrowserProbe({
					browserUrl: previewServer.browserUrl,
					expectedOutput: 'main=73',
					language: 'R',
					runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '300000'),
					source: rStdinSource,
					stdinText: '73\n'
				});
				expect(rSummary.transcript).toContain('main=73');

				const sqliteSummary = await runStdinBrowserProbe({
					browserUrl: previewServer.browserUrl,
					expectedOutput: 'main=73',
					language: 'SQLITE',
					runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '180000'),
					source: sqliteOutputSource,
					stdinText: ''
				});
				expect(sqliteSummary.transcript).toContain('main=73');

				const phpSummary = await runStdinBrowserProbe({
					browserUrl: previewServer.browserUrl,
					expectedOutput: 'main=73',
					language: 'PHP',
					runTimeoutMs: Number(process.env.WASM_IDLE_STDIN_RUN_TIMEOUT_MS || '300000'),
					source: phpStdinSource,
					stdinText: '73\n'
				});
				expect(phpSummary.transcript).toContain('main=73');
			} finally {
				await previewServer.close();
			}
		});
	}, 900_000);
});
