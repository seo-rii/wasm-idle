// @vitest-environment node
import { vi } from 'vitest';

// Keep dispatch/asset/preparation cases unchanged. This boundary mock does not
// replace the separate actual-Pyodide helper integration or executable regressions.
vi.mock('./pythonExecution', () => ({
	createPythonExecutionHelpers: (runtime: { runPythonAsync(source: string): Promise<unknown> }) => ({
		importSource: (source: string) => source,
		async run(source: string, _filename: string, ready: () => void) {
			ready();
			await runtime.runPythonAsync(source);
		},
		dispose: vi.fn()
	})
}));

import './python.runtime.cases';
