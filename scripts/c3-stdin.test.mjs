import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

test('C3 stdin observes EOF even when close notification arrives immediately before wait', async () => {
	const buffer = new SharedArrayBuffer(17);
	const channel = {
		protocol: 'wasm-idle-static-stdin-ring',
		protocolVersion: 1,
		controlBytes: 16,
		capacity: 1,
		buffer
	};
	const source = (
		await readFile(
			new URL('./runtime-workers/wasm-c3-runner-worker.js', import.meta.url),
			'utf8'
		)
	).replace('__WASM_IDLE_C3_PROFILE__', '{}');
	let waits = 0;
	const atomics = Object.create(Atomics);
	atomics.wait = (control, index, expected, timeout) => {
		waits++;
		Atomics.store(control, 2, 1);
		Atomics.notify(control, 0);
		// The notification is deliberately lost: no waiter existed yet and slot 0 did not change.
		return Atomics.wait(control, index, expected, timeout);
	};
	const result = runInNewContext(
		source + '\nc3Stdin("", channel)();',
		{
			self: { postMessage() {} },
			TextEncoder,
			SharedArrayBuffer,
			Int32Array,
			Uint8Array,
			Atomics: atomics,
			channel
		},
		{ timeout: 1000 }
	);
	assert.equal(result, -1);
	assert.equal(waits, 1);
});
