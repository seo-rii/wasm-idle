/**
 * Apply optional local/CI credentials through the cookie jar so unrelated asset
 * origins never receive a global Cookie header.
 * @param {{ addCookies: (cookies: { name: string; value: string; url: string }[]) => Promise<void> }} context
 * @param {string} browserUrl
 */
export async function addBrowserTestCookies(context, browserUrl) {
	const cookie = process.env.WASM_IDLE_TEST_BYPASS_COOKIE || '';
	if (!cookie) return;
	const match = /^dev_bypass_waf=([^;\r\n]+)$/u.exec(cookie);
	if (!match)
		throw new Error('WASM_IDLE_TEST_BYPASS_COOKIE must contain one dev_bypass_waf cookie');
	await context.addCookies([
		{ name: 'dev_bypass_waf', value: match[1], url: new URL(browserUrl).origin }
	]);
}
