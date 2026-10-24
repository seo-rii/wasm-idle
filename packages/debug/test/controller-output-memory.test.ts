// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { beforeAll, describe, expect, it } from 'vitest';

let controllerBundle: string;

beforeAll(() => {
	controllerBundle = buildSync({
		entryPoints: [fileURLToPath(new URL('../src/controller.ts', import.meta.url))],
		bundle: true,
		format: 'iife',
		globalName: 'controllerModule',
		platform: 'node',
		write: false
	}).outputFiles[0].text;
});

describe('debugger diagnostic memory bounds', () => {
	it.each([
		{ field: 'output', sliced: false, expectedLength: 65_536 },
		{ field: 'output', sliced: true, expectedLength: 1_024 },
		{ field: 'sourcePath', sliced: false, expectedLength: 4_096 },
		{ field: 'sourcePath', sliced: true, expectedLength: 1_024 }
	])('releases the backing string for $field (already sliced: $sliced)', (scenario) => {
		// Isolate heap measurements from Vitest, and collect after the sender's stack has
		// unwound. Merely checking string.length misses V8 slices retaining a large parent.
		const child = spawnSync(process.execPath, ['--expose-gc', '--input-type=module'], {
			input: `${controllerBundle}
const controller = controllerModule.createDebugSessionController();
const scenario = ${JSON.stringify(scenario)};
async function heapUsedAfterCollection() {
  await new Promise(resolve => setImmediate(resolve));
  for (let index = 0; index < 3; index += 1) global.gc();
  return process.memoryUsage().heapUsed;
}
const before = await heapUsedAfterCollection();
(() => {
  const backing = Buffer.alloc(8 * 1024 * 1024, 97).toString('utf8');
  const value = scenario.sliced ? backing.slice(0, 1_024) : backing;
  controller.handleEvent({
    type: 'output',
    category: 'console',
    output: 'diagnostic\\n',
    [scenario.field]: value
  });
})();
const retained = await heapUsedAfterCollection();
const length = controller.diagnostics[0][scenario.field].length;
controller.clearDiagnostics();
const cleared = await heapUsedAfterCollection();
process.stdout.write(JSON.stringify({
  length,
  retainedBytes: retained - before,
  clearedBytes: cleared - before
}));
`,
			encoding: 'utf8',
			timeout: 10_000,
			maxBuffer: 64 * 1024
		});
		expect(child.error).toBeUndefined();
		expect(child.status, child.stderr).toBe(0);
		const result = JSON.parse(child.stdout) as {
			length: number;
			retainedBytes: number;
			clearedBytes: number;
		};
		expect(result.length).toBe(scenario.expectedLength);
		// Allow substantial runtime/GC noise while rejecting the 8 MiB parent buffer.
		expect(result.retainedBytes).toBeLessThan(2 * 1024 * 1024);
		expect(result.clearedBytes).toBeLessThan(2 * 1024 * 1024);
	});
});
