import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const bridge = new URL('../runtimes/wasm-bash/bridge/', import.meta.url);

test('live existing-file opens preserve append intent through the delegate boundary', async () => {
	const [patch, filesystem, prepare] = await Promise.all([
		readFile(new URL('patches/0014-preserve-live-append.patch', bridge), 'utf8'),
		readFile(new URL('sdk_host_filesystem.rs', bridge), 'utf8'),
		readFile(new URL('./prepare-container-shell-bridge.mjs', import.meta.url), 'utf8')
	]);
	assert.match(prepare, /'0014-preserve-live-append\.patch'/);
	assert.match(patch, /^-\s*\.append\(false\)/m);
	assert.match(
		patch,
		/^\+\s*\.append\(crate::fs::is_live_path\(path\) && minimum_rights\.append\)/m
	);
	assert.match(filesystem, /append: conf\.append/);
	assert.match(filesystem, /if self\.append\s*\{\s*Op::Append/);
	const append = filesystem.slice(
		filesystem.indexOf('Op::Append { handle, bytes } =>'),
		filesystem.indexOf('Op::Fstat { handle } =>')
	);
	assert.match(append, /"append",\s*&\[int\(handle as u64\), data\.into\(\)\]/);
	assert.doesNotMatch(append, /"write"|"fstat"|offset/);
});

test('queued filesystem calls retain their registration and release on its owner', async () => {
	const [filesystem, prepare] = await Promise.all([
		readFile(new URL('sdk_host_filesystem.rs', bridge), 'utf8'),
		readFile(new URL('./prepare-container-shell-bridge.mjs', import.meta.url), 'utf8')
	]);
	assert.match(prepare, /'sdk_host_filesystem_lifetime\.rs', 'wasmer-sdk', 'src\/host_filesystem_lifetime\.rs'/);
	assert.match(filesystem, /struct HostFsCall\s*\{[^}]*registration: Option<Arc<Registration>>/s);
	assert.match(filesystem, /struct HostFileSystem\s*\{\s*registration: Arc<Registration>/);
	assert.match(filesystem, /struct HostFile\s*\{\s*registration: Arc<Registration>/);
	assert.match(filesystem, /registration: Some\(registration\.clone\(\)\)/);
	assert.match(filesystem, /post_owned\(registration\.link, op, Some\(registration\.clone\(\)\)\)/);
	assert.match(filesystem, /fn release\(link: Link\)\s*\{\s*post_owned\(link, Op::Release, None\)/);
	assert.match(filesystem, /Op::Release =>\s*\{\s*DELEGATES\.with\(\|delegates\| delegates\.borrow_mut\(\)\.remove\(&link\.key\)\)/);
});
