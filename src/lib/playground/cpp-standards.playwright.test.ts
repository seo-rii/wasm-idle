// @vitest-environment node

import { afterAll, describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { runStdinBrowserProbe } from '../../../scripts/stdin-browser-probe-lib.mjs';
import { expectPinnedContainerClangAssets } from '../../../scripts/container-clang-browser-assertions.mjs';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_CPP_STANDARDS === '1';
const runTimeoutMs = Number(process.env.WASM_IDLE_CPP_STANDARDS_RUN_TIMEOUT_MS || '420000');
let previewServerPromise: ReturnType<typeof startBrowserPreviewServer> | undefined;

afterAll(async () => {
	const preview = await previewServerPromise?.catch(() => undefined);
	await preview?.close();
});

async function browserPreview() {
	previewServerPromise ??= (async () => {
		const configuredUrl = process.env.WASM_IDLE_BROWSER_URL || '';
		if (shouldReuseProvidedBrowserUrl(configuredUrl)) {
			return {
				browserUrl: configuredUrl,
				origin: new URL(configuredUrl).origin,
				close: async () => {}
			};
		}
		const serverMode = process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
		if (serverMode === 'preview') {
			await runBrowserPreparationScripts(['build:preview'], { timeoutMs: 900_000 });
		}
		return startBrowserPreviewServer({
			origin: configuredUrl ? new URL(configuredUrl).origin : 'http://127.0.0.1:4683',
			...(configuredUrl ? { basePath: new URL(configuredUrl).pathname } : {}),
			serverMode
		});
	})();
	return previewServerPromise;
}

const cases = [
	{ cppVersion: 'CPP20', minimum: 202002, maximum: 202302 },
	{ cppVersion: 'CPP23', minimum: 202302, maximum: 202400 },
	{ cppVersion: 'CPP26', minimum: 202400, maximum: undefined }
] as const;

describe('C++ standard library browser compatibility', () => {
	it.each(cases)(
		'$cppVersion runs restored standard library headers with stdin/stdout',
		{
			skip: !enabled,
			meta: { browser: true, requiredBrowser: enabled },
			timeout: runTimeoutMs + 180_000
		},
		async ({ cppVersion, minimum, maximum }) => {
			expect.hasAssertions();
			await runWithBrowserProbeSessionLock(async () => {
				const preview = await browserPreview();
				const source = `#if __cplusplus < ${minimum}L${maximum ? ` || __cplusplus >= ${maximum}L` : ''}
#error The selected C++ standard was not applied
#endif
#include <any>
#include <array>
#include <bit>
#include <charconv>
#include <chrono>
#include <cinttypes>
#include <complex>
#include <iostream>
#include <random>
#include <ranges>
#include <regex>
#include <span>
#include <string>
#if __cplusplus >= 202302L
#include <expected>
#endif

int main() {
    int value = 0;
    if (!(std::cin >> value)) return 1;

    const std::any stored = value;
    std::array<char, 32> digits{};
    const auto encoded = std::to_chars(digits.data(), digits.data() + digits.size(), std::any_cast<int>(stored));
    if (encoded.ec != std::errc{}) return 2;
    int decoded = 0;
    const auto parsed = std::from_chars(digits.data(), encoded.ptr, decoded);
    if (parsed.ec != std::errc{} || decoded != value) return 3;
    if (!std::regex_match(std::string(digits.data(), encoded.ptr), std::regex("[0-9]+"))) return 4;

    std::mt19937 first(7), second(7);
    if (first() != second()) return 5;
    const std::complex<double> product = std::complex<double>(decoded, 2) * std::complex<double>(1, -1);
    const int values[] = {decoded, 5};
    const std::span<const int> view(values);
    int total = 0;
    for (int item : view | std::views::transform([](int item) { return item + 1; })) total += item;
    const auto milliseconds = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::seconds(decoded));

    std::cout << "${cppVersion} main=" << decoded + 5
              << " complex=" << product.real() << ',' << product.imag()
              << " range=" << total << " duration=" << milliseconds.count();
#if __cplusplus >= 202302L
    const std::expected<int, int> result(total);
    const std::expected<int, int> error(std::unexpected(9));
    if (!result || error || error.error() != 9) return 6;
    const auto reversed = std::byteswap(std::uint32_t{0x01020304});
    if (reversed != 0x04030201) return 7;
    std::cout << " expected=" << result.value() << " byteswap=" << reversed;
#endif
    std::cout << '\\n';
    return 0;
}
`;
				const expectedOutput =
					`${cppVersion} main=73 complex=70,-66 range=75 duration=68000` +
					(cppVersion === 'CPP20' ? '' : ' expected=75 byteswap=67305985');
				const summary = await runStdinBrowserProbe({
					browserUrl: preview.browserUrl,
					language: 'CPP',
					cppVersion,
					source,
					stdinText: '68\n',
					expectedOutput,
					requireSharedArrayBuffer: false,
					// This regression checks header completeness and the actual compiler result.
					checkLoadingProgress: false,
					runTimeoutMs
				});
				expect(summary.execution?.state).toMatchObject({
					status: 'completed',
					exitCode: 0
				});
				expect(summary.transcript).toContain(expectedOutput);
				expect(summary.pageErrors).toEqual([]);
				await expectPinnedContainerClangAssets(preview.browserUrl, summary.runtimeRequests);
			});
		}
	);
});
