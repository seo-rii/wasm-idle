import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = (
	await readFile(new URL('./runtime-workers/wasm-c3-runner-worker.js', import.meta.url), 'utf8')
).replace('__WASM_IDLE_C3_PROFILE__', '{}');
const parse = (line) =>
	JSON.parse(
		runInNewContext(source + '\nJSON.stringify(c3CompilerDiagnostic(line));', {
			self: {},
			line
		})
	);

test('C3 0.8.5 diagnostics preserve the observed file, line, column, severity and message', () => {
	assert.deepEqual(
		parse(
			"/work/main.c3:2:32: error: 'missing_value' could not be found, did you spell it right?"
		),
		{
			fileName: 'main.c3',
			lineNumber: 2,
			columnNumber: 32,
			severity: 'error',
			message: "'missing_value' could not be found, did you spell it right?"
		}
	);
	assert.deepEqual(parse('/work/lib/example.c3:12:5: warning: unused value: example'), {
		fileName: 'lib/example.c3',
		lineNumber: 12,
		columnNumber: 5,
		severity: 'warning',
		message: 'unused value: example'
	});
});

test('legacy C3 diagnostics still parse while source excerpts and carets are ignored', () => {
	assert.deepEqual(parse('(/work/main.c3:2:32) Error: missing value'), {
		fileName: 'main.c3',
		lineNumber: 2,
		columnNumber: 32,
		severity: 'error',
		message: 'missing value'
	});
	for (const line of [' 2: fn void main() { missing_value(); }', '       ^^^^^^^^^^^^^', '']) {
		assert.equal(parse(line), null);
	}
});
