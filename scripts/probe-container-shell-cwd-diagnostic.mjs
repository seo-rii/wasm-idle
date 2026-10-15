// Fixed real-shell comparisons only. These observations cannot qualify a backend.
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProbe, runProbe } from './probe-patched-container-shell.mjs';

const stdin = [0, 255, 226, 130, 172, 10, 13, 97, 98];
const cases = [
	{
		id: 'DIAG-CWD-RELATIVE',
		script: '/workspace/cwd.wasm cwd; printf "\\n"; ./probe.wasm copy | ./probe.wasm copy > relative; ./probe.wasm copy < relative',
		stdin, readFiles: ['/relative']
	},
	{
		id: 'DIAG-CWD-ABSOLUTE',
		script: './probe.wasm copy | ./probe.wasm copy > /workspace/absolute; ./probe.wasm copy < /workspace/absolute',
		stdin, readFiles: ['/absolute']
	},
	{
		id: 'DIAG-CWD-CHDIR',
		script: 'cd /workspace; ./probe.wasm copy | ./probe.wasm copy > after-chdir; ./probe.wasm copy < after-chdir',
		stdin, readFiles: ['/after-chdir']
	},
	{
		id: 'DIAG-CWD-PARENT',
		script: 'printf "from-parent\\n" > parent; ./probe.wasm copy < parent',
		stdin: [], readFiles: ['/parent']
	}
];

if (process.argv[1] && (await realpath(process.argv[1]).catch(() => null)) ===
	(await realpath(fileURLToPath(import.meta.url)))) {
	try {
		assert(process.argv.length === 4 && ['--check', '--run'].includes(process.argv[2]),
			'usage: probe-container-shell-cwd-diagnostic.mjs --check|--run /absolute/config.json');
		assert(isAbsolute(process.argv[3]), 'absolute configuration path required');
		const configuration = JSON.parse(await readFile(process.argv[3]));
		if (process.argv[2] === '--check') {
			await checkProbe(configuration);
			console.log(JSON.stringify({ checked: true, built: false, browserLaunched: false,
				fixtureSet: 'diagnostic-only', cases: cases.length }));
		} else {
			const result = await runProbe(configuration, cases);
			assert.equal(result.guestAcceptancePassed, false, 'diagnostics never qualify a shell backend');
			console.log(JSON.stringify({ ...result, fixtureSet: 'diagnostic-only' }));
			if (!result.complete) process.exitCode = 1;
		}
	} catch (error) {
		console.error(String(error));
		process.exitCode = 1;
	}
}
