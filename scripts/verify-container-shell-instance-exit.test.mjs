import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const patch = new URL('../runtimes/wasm-bash/bridge/patches/0016-streaming-instance-exit.patch', import.meta.url);
const baselineSha256 = 'e53a2b8516efcdb66e04ac857f958a9423c105a5bfa1cda0049d7efd6c345f09';

test('exit-only SDK patch leaves the legacy capture implementation intact', async () => {
	const text = await readFile(patch, 'utf8');
	assert.match(text, /--- a\/src\/instance\.rs\n\+\+\+ b\/src\/instance\.rs\n/);
	// Inserting tests before the final module brace can relocate that brace in
	// unified diff matching; no original declaration or behavior may be removed.
	assert(text.split('\n').filter(line => line.startsWith('-') && !line.startsWith('---'))
		.every(line => line.trim() === '-}'));
	assert.match(text, /wasm_bindgen\(js_name = "waitForExit"\)/);
	assert.match(text, /pub async fn js_wait_for_exit\(self\) -> Result<JsExitStatus, Error>/);
	const start = text.indexOf('+    pub async fn js_wait_for_exit');
	const end = text.indexOf('+    }', start);
	const method = text.slice(start, end);
	assert.match(method, /self\.exit\.await\.map_err\(Error::from\)\?/);
	assert.doesNotMatch(method, /stdin|stdout|stderr|read|close|capture|Vec|buffer/);
	assert.match(method, /"code"/);
	assert.match(method, /code == 0/);
	assert.match(text, /readonly code: number/);
	assert.match(text, /readonly ok: boolean/);
	assert.match(text, /for code in \[0, 23, 126, 255\]/);
	assert.match(text, /exit_only_preserves_unlocked_streams_without_waiting_for_output_eof/);
	assert.match(text, /exit_only_accepts_caller_owned_readers_and_reports_a_lost_exit_channel/);
	assert.match(text, /assert!\(instance\.js_wait_for_exit\(\)\.await\.is_err\(\)\)/);
});

const sourceRoot = process.env.CONTAINER_SDK_SOURCE;
test('exit-only patch applies to the exact pinned SDK and preserves legacy methods', {
	skip: sourceRoot ? false : 'Set CONTAINER_SDK_SOURCE to an existing verified SDK source; no download is performed'
}, async () => {
	assert(path.isAbsolute(sourceRoot));
	const original = await readFile(path.join(sourceRoot, 'src/instance.rs'));
	assert.equal(createHash('sha256').update(original).digest('hex'), baselineSha256);
	const directory = await mkdtemp(path.join(tmpdir(), 'container-instance-exit-'));
	try {
		await mkdir(path.join(directory, 'src'));
		await writeFile(path.join(directory, 'src/instance.rs'), original);
		execFileSync('git', ['apply', '--check', fileURLToPath(patch)], { cwd: directory, stdio: 'pipe' });
		execFileSync('git', ['apply', fileURLToPath(patch)], { cwd: directory, stdio: 'pipe' });
		const updated = await readFile(path.join(directory, 'src/instance.rs'), 'utf8');
		const previous = original.toString('utf8');
		// These entire blocks include stdin handling, locked-output delegation,
		// capture buffering, status extraction and the old exported Output type.
		for (const [begin, end] of [
			['impl Instance {\n    #[tracing::instrument', '\nasync fn copy_to_buffer'],
			['async fn copy_to_buffer', '\n#[derive(Debug)]\npub(crate) struct ExitCondition'],
			['impl ExitCondition {', '\n#[derive(Debug, Clone, PartialEq)]'],
			['const OUTPUT_TYPE_DEFINITION:', '\n"#;']
		]) {
			const start = previous.indexOf(begin), finish = previous.indexOf(end, start) + end.length;
			assert(start >= 0 && finish > start, `baseline block ${begin}`);
			assert(updated.includes(previous.slice(start, finish)), `legacy behavior changed in ${begin}`);
		}
		assert.equal(updated.match(/pub async fn js_wait_for_exit\(/g)?.length, 1);
		assert.equal(updated.match(/async fn exit_only_/g)?.length, 2);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
