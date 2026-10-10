// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createPreciseChromiumLauncher } from '../../scripts/precise-chromium-launcher.mjs';

it('adds precision only and forwards caller arguments literally', async () => {
	const dir = await mkdtemp(path.join(tmpdir(), 'precise-browser-'));
	try {
		const executable = path.join(dir, "browser ' $name");
		await writeFile(executable, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o700 });
		const launcher = path.join(dir, 'launcher');
		await createPreciseChromiumLauncher(executable, launcher);
		const result = spawnSync(launcher, ['--remote-debugging-pipe', 'space value', '$unexpanded', '"quoted"'], { encoding: 'utf8' });
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout.split('\n')).toEqual(['--enable-precise-memory-info', '--remote-debugging-pipe', 'space value', '$unexpanded', '"quoted"', '']);
		await expect(createPreciseChromiumLauncher(executable, launcher)).rejects.toThrow();
		await expect(createPreciseChromiumLauncher(executable, executable)).rejects.toThrow('Distinct');
		await expect(createPreciseChromiumLauncher('relative', launcher)).rejects.toThrow('absolute');
	} finally { await rm(dir, { recursive: true, force: true }); }
});

it('keeps LLDB heap and worker guards while selecting the precision launcher', async () => {
	const workflow = await readFile('.github/workflows/debug-browser.yml', 'utf8');
	const source = await readFile('src/lib/playground/debug.playwright.test.ts', 'utf8');
	expect(workflow).toContain('precise-chromium-launcher.mjs');
	expect(workflow).toContain('WASM_IDLE_CHROMIUM_EXECUTABLE=');
	expect(source).toContain('latestMetrics.usedJsHeapSize - baselineMetrics.usedJsHeapSize');
	expect(source).toContain(').toBeLessThanOrEqual(heapGrowthLimit);');
	expect(source).toMatch(/64\s*\*\s*1024\s*\*\s*1024/);
	expect(workflow).not.toContain('WASM_IDLE_DEBUG_HEAP_GROWTH_LIMIT_BYTES:');
	expect(source).toContain('expect(latestMetrics.activeDebug).toBe(0)');
});
