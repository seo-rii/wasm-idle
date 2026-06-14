import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('SQLite worker', () => {
	beforeEach(() => {
		vi.resetModules();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = vi.fn();
	});

	it('executes SQL and prints result sets as tab-separated tables', async () => {
		await import('./sqlite');
		await (globalThis as any).self.onmessage({
			data: {
				load: true
			}
		});
		await (globalThis as any).self.onmessage({
			data: {
				code: `CREATE TABLE numbers (n INTEGER NOT NULL);
INSERT INTO numbers VALUES (4);
SELECT 'factorial_plus_bonus=' || 27 AS result;`,
				prepare: false,
				activePath: 'main.sql',
				workspaceFiles: []
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			output: 'result\nfactorial_plus_bonus=27\n'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	}, 15000);

	it('reports SQLite execution failures as worker errors', async () => {
		await import('./sqlite');
		await (globalThis as any).self.onmessage({
			data: {
				code: 'select missing from nowhere;',
				prepare: false,
				activePath: 'main.sql',
				workspaceFiles: []
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: expect.stringContaining('no such table')
		});
	}, 15000);
});
