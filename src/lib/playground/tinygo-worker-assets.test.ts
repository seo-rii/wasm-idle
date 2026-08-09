import { describe, expect, it } from 'vitest';

import { createTinyGoCompilerWorkerSource } from '../../../runtimes/wasm-tinygo/src/runtime-assets';

const PUBLIC_PATH_SNIPPET = '__webpack_require__.p=new URL("./",self.location.href).href';
const BASE_URL_SNIPPET = '__webpack_require__.b=self.location+""';

describe('TinyGo compiler worker asset base', () => {
	it('rewrites both webpack URL bases for blob worker execution', () => {
		const source = createTinyGoCompilerWorkerSource({
			assetBaseUrl: 'https://runtime.invalid/vendor/emception/',
			source: `${PUBLIC_PATH_SNIPPET};${BASE_URL_SNIPPET};`
		});

		expect(source).toContain(
			'__webpack_require__.p="https://runtime.invalid/vendor/emception/"'
		);
		expect(source).toContain(
			'__webpack_require__.b="https://runtime.invalid/vendor/emception/"'
		);
		expect(source).not.toContain('self.location');
	});

	it('rejects worker layouts whose URL initializers cannot be patched exactly once', () => {
		expect(() =>
			createTinyGoCompilerWorkerSource({
				assetBaseUrl: 'https://runtime.invalid/vendor/emception/',
				source: PUBLIC_PATH_SNIPPET
			})
		).toThrow('base-URL initializer');
		expect(() =>
			createTinyGoCompilerWorkerSource({
				assetBaseUrl: 'https://runtime.invalid/vendor/emception/',
				source: `${PUBLIC_PATH_SNIPPET};${PUBLIC_PATH_SNIPPET};${BASE_URL_SNIPPET}`
			})
		).toThrow('public-path initializer');
	});
});
