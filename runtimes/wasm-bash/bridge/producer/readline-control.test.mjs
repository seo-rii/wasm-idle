import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	buildBashShim,
	parseOptions,
	verifyReadlineControlSources,
	verifyArchive
} from './build.mjs';
import { readProducerLock, sha256 } from './verify.mjs';

const here = new URL('.', import.meta.url);

test('Readline control is an explicit opt-in and all producer patch bytes are pinned', async () => {
	const ordinary = await buildBashShim(parseOptions(['--plan']));
	assert.equal(ordinary.readlineControl, null);
	assert.equal(ordinary.producerFiles['readline-control.patch'], undefined);
	const opted = await buildBashShim(parseOptions(['--plan', '--readline-control']));
	const policy = await verifyReadlineControlSources();
	assert.deepEqual(opted.readlineControl, policy);
	assert.deepEqual(policy.environment, { WASM_IDLE_SHELL_CONTROL: '1' });
	assert.equal(policy.function, '__wasm_idle_poll');
	assert.equal(policy.readonlyFunctionRequired, true);
	assert.equal(policy.redrawExitCode, 124);
	assert.equal(policy.ignoreReturnFlag, 'SEVAL_IGNORE_RETURN');
	assert.deepEqual(policy.importedFunctionInitialization, {
		readonly: true,
		exported: false,
		requiresImportedAttribute: true
	});
	assert.equal(opted.producerFiles['readline-control.patch'].sha256, policy.patch.sha256);
	assert.throws(
		() => parseOptions(['--plan', '--readline-control', '--readline-control']),
		/duplicate/
	);
});

test('actual Bash conditional command semantics retain 124 without errexit or ERR', () => {
	// This checks the Bash semantics selected by CMD_IGNORE_RETURN, rather than
	// claiming that the host Bash binary contains our producer patch.
	const result = execFileSync(
		'/bin/bash',
		[
			'--noprofile',
			'--norc',
			'-c',
			`
set -eE
trap 'printf unexpected-ERR; exit 99' ERR
__wasm_idle_poll() { return 124; }
if __wasm_idle_poll; then result=0; else result=$?; fi
test "$result" -eq 124
printf alive
`
		],
		{ encoding: 'utf8' }
	);
	assert.equal(result, 'alive');
});

test('exact C initialization protects only imported control, and the hook defers unsafe states', async () => {
	const patch = await readFile(new URL('readline-control.patch', here), 'utf8');
	const match = patch.match(
		/\+static int\n\+wasm_idle_readline_poll \(void\)\n\+\{[\s\S]+?\n[ +]\}/
	);
	assert(match, 'the actual hook must be present as complete producer patch source');
	const hook = match[0]
		.split('\n')
		.map((line) => line.slice(1))
		.join('\n');
	const initialization = patch.match(
		/\+  \/\* Only the explicit website control profile installs this idle callback\. \*\/[\s\S]+?\n\+    \}/
	);
	assert(initialization, 'the actual imported-function initialization must be present');
	const initialize = initialization[0]
		.split('\n')
		.map((line) => line.slice(1))
		.join('\n');
	const fixture = await readFile(new URL('readline-control.fixture.c', here), 'utf8');
	const directory = await mkdtemp(path.join(tmpdir(), 'bash-readline-control-'));
	try {
		const source = path.join(directory, 'hook.c');
		const binary = path.join(directory, 'hook');
		await writeFile(
			source,
			fixture.replace('/* POLL_SOURCE */', hook).replace('/* INIT_SOURCE */', initialize)
		);
		execFileSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', source, '-o', binary]);
		execFileSync(binary);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test(
	'patch applies without fuzz to the pinned actual Bash source and produces the locked identity',
	{
		skip: !process.env.WASM_IDLE_BASH_SOURCE_ARCHIVE
	},
	async () => {
		const lock = await readProducerLock();
		const policy = await verifyReadlineControlSources();
		const archive = process.env.WASM_IDLE_BASH_SOURCE_ARCHIVE;
		await verifyArchive(archive, lock.inputs.source.sha256);
		const directory = await mkdtemp(path.join(tmpdir(), 'bash-readline-apply-'));
		try {
			execFileSync('tar', [
				'-xzf',
				archive,
				'-C',
				directory,
				'--strip-components=1',
				'--',
				...Object.keys(policy.files).map((name) => `bash-${lock.sourceRevision}/${name}`)
			]);
			for (const [name, identities] of Object.entries(policy.files)) {
				const original = await readFile(path.join(directory, name));
				assert.deepEqual(
					{ bytes: original.length, sha256: sha256(original) },
					identities.original
				);
			}
			execFileSync(
				'patch',
				[
					'--batch',
					'--fuzz=0',
					'--no-backup-if-mismatch',
					'-p1',
					'-i',
					new URL('readline-control.patch', here).pathname
				],
				{ cwd: directory }
			);
			for (const [name, identities] of Object.entries(policy.files)) {
				const patched = await readFile(path.join(directory, name));
				assert.deepEqual(
					{ bytes: patched.length, sha256: sha256(patched) },
					identities.patched
				);
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}
);
