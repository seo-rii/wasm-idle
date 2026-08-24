// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runStdinBrowserProbe } from '../../../scripts/stdin-browser-probe-lib.mjs';
import {
	RUBY_RUNTIME_MANIFEST_PATH,
	RUBY_RUNTIME_MODULE_STORAGE_PATH,
	RUBY_RUNTIME_PROFILE,
	RUBY_RUNTIME_WASM_STORAGE_PATH
} from '@wasm-idle/core';

const rubyCanonicalRequests = [
	{
		path: `/wasm-ruby/${RUBY_RUNTIME_MANIFEST_PATH}`,
		version: RUBY_RUNTIME_PROFILE.manifestFingerprint
	},
	{
		path: `/wasm-ruby/${RUBY_RUNTIME_MODULE_STORAGE_PATH}`,
		version: RUBY_RUNTIME_PROFILE.moduleJavaScriptReceipt.sha256
	},
	{
		path: `/wasm-ruby/${RUBY_RUNTIME_WASM_STORAGE_PATH}`,
		version: RUBY_RUNTIME_PROFILE.wasmReceipt.sha256
	}
] as const;

function expectExactRubyPreflightRequests(requests: readonly string[]) {
	const rubyRequests = requests.filter((request) =>
		new URL(request).pathname.includes('/wasm-ruby/')
	);
	expect(rubyRequests).toHaveLength(rubyCanonicalRequests.length);
	for (const expected of rubyCanonicalRequests) {
		const matches = rubyRequests.filter((request) =>
			new URL(request).pathname.endsWith(expected.path)
		);
		expect(matches).toHaveLength(1);
		expect([...new URL(matches[0]!).searchParams.entries()]).toEqual([['v', expected.version]]);
	}
	for (const request of rubyRequests) {
		const pathname = new URL(request).pathname;
		expect(pathname).not.toMatch(/\/wasm-ruby\/runtime\.mjs$/u);
		expect(pathname).not.toMatch(/\/wasm-ruby\/assets\/ruby_stdlib-C40Yu-vu\.wasm(?:\.gz)?$/u);
	}
}

describe('wasm-idle Ruby browser playwright integration', () => {
	it('streams stdin through the real runtime using only three canonical pinned assets', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_RUBY !== '1') return;

		await runWithBrowserProbeSessionLock(async () => {
			const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
			const serverMode =
				process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
			const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
			if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
				await runBrowserPreparationScripts(['sync:wasm-ruby', 'build:preview'], {
					timeoutMs: Number(process.env.WASM_IDLE_RUBY_PREP_TIMEOUT_MS || '900000')
				});
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
							: { origin: 'http://127.0.0.1:4683', serverMode }
					);

			try {
				const summary = await runStdinBrowserProbe({
					browserUrl: previewServer.browserUrl,
					expectedOutput: 'ruby-result=42',
					language: 'RUBY',
					runTimeoutMs: Number(process.env.WASM_IDLE_RUBY_RUN_TIMEOUT_MS || '180000'),
					source: `$stdout.sync = true
print "ruby-value?"
value = STDIN.gets
puts "ruby-result=#{value.to_i + 7}"
`,
					stdinText: '35\n',
					waitForOutputBeforeStdin: 'ruby-value?'
				});

				expect(summary.activeState.crossOriginIsolated).toBe(true);
				expect(summary.activeState.sharedArrayBuffer).toBe(true);
				expect(summary.pageErrors).toEqual([]);
				expect(summary.transcript).toContain('ruby-value?');
				expect(summary.transcript).toContain('ruby-result=42');
				expect(summary.transcript).toContain('Process finished after');
				expectExactRubyPreflightRequests(summary.runtimeRequests);
			} finally {
				await previewServer.close();
			}
		});
	}, 960_000);
});
