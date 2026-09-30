import assert from 'node:assert/strict';
import test from 'node:test';
import {
	connectBrowserNativeAssetCache,
	serveBrowserNativeAssetCache
} from '../runtime/browser-native-asset-cache.ts';

test('nested worker ports admit only request-scoped receipt identities and close cleanly', async () => {
	const channel = new MessageChannel();
	const identity = {
		url: 'https://assets.example.test/tool.js',
		bytes: 4,
		sha256: 'a'.repeat(64),
		validationKey: 'tool-boundary'
	};
	const stored = new Uint8Array([1, 2, 3, 4]);
	let reads = 0;
	let writes = 0;
	const close = serveBrowserNativeAssetCache(
		channel.port1,
		{
			async read() {
				reads++;
				return stored;
			},
			async write(_identity, bytes) {
				writes++;
				assert.deepEqual(bytes, stored);
				return true;
			}
		},
		[identity]
	);
	const client = connectBrowserNativeAssetCache(channel.port2);
	try {
		assert.deepEqual(await client.read(identity), stored);
		assert.equal(await client.write(identity, stored), true);
		for (const changed of [
			{ url: identity.url + '?other' },
			{ bytes: 3 },
			{ sha256: 'b'.repeat(64) },
			{ validationKey: 'other' }
		]) {
			assert.equal(await client.read({ ...identity, ...changed }), undefined);
			assert.equal(await client.write({ ...identity, ...changed }, stored), false);
		}
		assert.equal(await client.write(identity, stored.slice(0, 2)), false);
		assert.equal(reads, 1);
		assert.equal(writes, 1);
	} finally {
		client.close();
		close();
	}
	assert.equal(await client.read(identity), undefined);
});

test('closing the owner cancels pending backend work and client close settles waiting requests', async () => {
	const channel = new MessageChannel();
	const identity = {
		url: 'https://assets.example.test/tool.js',
		bytes: 4,
		sha256: 'a'.repeat(64)
	};
	let started;
	const ready = new Promise((resolve) => {
		started = resolve;
	});
	let signal;
	const close = serveBrowserNativeAssetCache(
		channel.port1,
		{
			async read(_identity, activeSignal) {
				signal = activeSignal;
				started();
				return new Promise(() => {});
			},
			async write() {}
		},
		[identity]
	);
	const client = connectBrowserNativeAssetCache(channel.port2);
	const pending = client.read(identity);
	await ready;
	close();
	assert.equal(signal.aborted, true);
	client.close();
	assert.equal(await pending, undefined);
});
