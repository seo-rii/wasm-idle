import { describe, expect, it, vi } from 'vitest';
import { getFennelLanguageServer } from '../src/fennel/language-server.js';

describe('original Fennel language server asset admission', () => {
	it('requires an asset root before starting a worker', async () => {
		const createWorker = vi.fn();
		await expect(getFennelLanguageServer({ createWorker })).rejects.toThrow(
			'fennel.baseUrl or rootUrl'
		);
		expect(createWorker).not.toHaveBeenCalled();
	});
	it.each([
		'file:///tmp/server/',
		'data:text/plain,code',
		'https://example.test/assets/?v=unreviewed',
		'https://user:password@example.test/assets/'
	])('rejects unsupported asset root %s', async (baseUrl) => {
		const createWorker = vi.fn();
		await expect(
			getFennelLanguageServer({ fennel: { baseUrl }, createWorker })
		).rejects.toThrow('HTTP(S)');
		expect(createWorker).not.toHaveBeenCalled();
	});
});
