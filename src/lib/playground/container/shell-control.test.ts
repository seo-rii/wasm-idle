// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createContainer,
	MemoryFileSystem,
	type Container,
	type HostCommandInvocation
} from '@wasm-idle/container';
import {
	createShellControl,
	SHELL_CONTROL_COMMAND,
	SHELL_CONTROL_FUNCTION_ENV,
	SHELL_CONTROL_RCFILE,
	SHELL_CONTROL_REQUEST,
	SHELL_CONTROL_ROUTE
} from './shell-control';

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const owned: Container[] = [];
const nativeDirectories: string[] = [];
afterEach(async () => {
	await Promise.all(owned.splice(0).map((container) => container.dispose()));
	for (const path of nativeDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture() {
	const changes = vi.fn();
	const control = createShellControl({
		languages: ['C', 'CPP', 'PYTHON'],
		session: 'ab'.repeat(16),
		onChange: changes
	});
	const fs = new MemoryFileSystem();
	const settings = control.setup(fs);
	return { control, fs, settings, changes };
}

function acknowledgement(
	fs: MemoryFileSystem,
	cwd?: string,
	verdict = 'ok'
): HostCommandInvocation {
	const fields = decoder.decode(fs.readFile(SHELL_CONTROL_REQUEST)).trim().split(' ');
	return {
		path: SHELL_CONTROL_ROUTE,
		argv: [SHELL_CONTROL_ROUTE, ...fields, verdict],
		cwd: cwd ?? `/workspace/${fields[3]}`,
		env: [encoder.encode(`PWD=/workspace/${fields[3]}`)],
		stdin: null,
		stdout: null,
		stderr: null
	};
}

/** Use actual Bash and filesystem bytes; only relocate guest absolute paths to a private fixture. */
function nativeFixture(mailbox: string) {
	const { fs } = fixture();
	const root = mkdtempSync(join(tmpdir(), 'wasm-idle-shell-control-'));
	nativeDirectories.push(root);
	const workspace = join(root, 'workspace');
	for (const language of ['C', 'CPP', 'PYTHON'])
		mkdirSync(join(workspace, language), { recursive: true });
	const request = join(root, 'request'),
		route = join(root, 'acknowledge'),
		ack = join(root, 'ack'),
		rc = join(root, 'rcfile');
	writeFileSync(request, mailbox);
	writeFileSync(
		route,
		'#!/bin/sh\nprintf \'%s|%s|%s|%s|%s|%s\\n\' "$PWD" "$1" "$2" "$3" "$4" "$5" >> "$ACK_FILE"\nexit "${ACK_EXIT:-0}"\n',
		{ mode: 0o700 }
	);
	writeFileSync(
		rc,
		decoder
			.decode(fs.readFile(SHELL_CONTROL_RCFILE))
			.replaceAll(SHELL_CONTROL_REQUEST, request)
			.replaceAll(SHELL_CONTROL_ROUTE, route)
			.replaceAll('/workspace', workspace)
	);
	return {
		workspace,
		request,
		ack,
		run(script: string, options: { input?: string; ackExit?: string } = {}) {
			return spawnSync(
				'/usr/bin/bash',
				['--noprofile', '--norc', '-c', 'builtin source "$RCFILE"\n' + script],
				{
					cwd: join(workspace, 'C'),
					encoding: 'utf8',
					input: options.input,
					env: {
						PATH: '/usr/bin:/bin',
						RCFILE: rc,
						ACK_FILE: ack,
						ACK_EXIT: options.ackExit ?? '0'
					},
					timeout: 5000
				}
			);
		}
	};
}

describe('real Bash directory control protocol', () => {
	it('installs a readonly bounded rcfile and a separate mutable request mailbox', () => {
		const { control, fs, settings } = fixture();
		expect(settings.args).toEqual(['--noprofile', '--norc', '-i']);
		expect(settings.env.WASM_IDLE_SHELL_CONTROL).toBe('1');
		expect(settings.env[SHELL_CONTROL_FUNCTION_ENV]).toMatch(/^\(\) \{/);
		const imported = spawnSync(
			'/usr/bin/bash',
			['--noprofile', '--norc', '-c', 'declare -f __wasm_idle_poll'],
			{ env: { ...process.env, ...settings.env }, encoding: 'utf8' }
		);
		expect(imported.status).toBe(0);
		expect(imported.stdout).toContain('builtin cd -P');
		expect(fs.lstat(SHELL_CONTROL_RCFILE)).toMatchObject({ type: 'file', mode: 0o444 });
		expect(() => fs.writeFile(SHELL_CONTROL_RCFILE, encoder.encode('changed'))).toThrow();
		fs.writeFile(SHELL_CONTROL_REQUEST, encoder.encode('malformed mailbox'));
		expect(control.setup(fs)).toBe(settings);
		expect(() => control.setup(new MemoryFileSystem())).toThrow(/share containers/);
		const source = decoder.decode(fs.readFile(SHELL_CONTROL_RCFILE));
		expect(
			spawnSync('/usr/bin/bash', ['--noprofile', '--norc', '-n'], {
				input: source,
				encoding: 'utf8'
			}).status
		).toBe(0);
		expect(source).toContain('read -r -n 160');
		expect(source).toContain('readonly -f __wasm_idle_poll');
		expect(source).not.toMatch(/\b(?:eval|source)\b/);
		expect(source).not.toContain('READLINE_');
		expect(source).not.toContain('PROMPT_COMMAND');
	});

	it('uses a real parent-shell cd without consuming stdin, replacing user state, or failing under errexit', () => {
		const local = nativeFixture(`1 ${'ab'.repeat(16)} 1 CPP\n`);
		const result = local.run(
			[
				'set -eu',
				'sentinel=retained',
				'if __wasm_idle_poll; then status=0; else status=$?; fi',
				'IFS= builtin read -r untouched',
				'printf "%s\\n" "$status" "$PWD" "$sentinel" "$untouched"',
				'if __wasm_idle_poll; then status=0; else status=$?; fi',
				'printf "%s\\n" "$status"'
			].join('\n'),
			{ input: 'partial 한글🙂 input\n', ackExit: '73' }
		);
		expect(result).toMatchObject({ status: 0, stderr: '' });
		expect(result.stdout.trimEnd().split('\n')).toEqual([
			'\r',
			'124',
			join(local.workspace, 'CPP'),
			'retained',
			'partial 한글🙂 input',
			'0'
		]);
		expect(readFileSync(local.ack, 'utf8')).toBe(
			`${join(local.workspace, 'CPP')}|1|${'ab'.repeat(16)}|1|CPP|ok\n`
		);
	});

	it('starts a changed directory prompt on a new line without adding lines for an unchanged directory', () => {
		for (const language of ['CPP', 'C']) {
			const local = nativeFixture(`1 ${'ab'.repeat(16)} 1 ${language}\n`);
			const result = local.run(
				[
					'builtin printf "old-prompt $ partial-input"',
					'if __wasm_idle_poll; then status=0; else status=$?; fi',
					'if [[ "$status" == 124 ]]; then builtin printf "new-prompt $ partial-input"; fi',
					'if __wasm_idle_poll; then :; else exit 1; fi'
				].join('\n')
			);
			expect(result).toMatchObject({ status: 0, stderr: '' });
			expect(result.stdout).toBe(
				language === 'CPP'
					? 'old-prompt $ partial-input\r\nnew-prompt $ partial-input'
					: 'old-prompt $ partial-input'
			);
		}
	});

	it('does not execute malformed mailbox bytes and rejects overlong, noncanonical, and foreign requests', () => {
		const local = nativeFixture('');
		const marker = join(local.workspace, 'injected');
		for (const mailbox of [
			`1 ${'ab'.repeat(16)} 1 CPP;touch ${marker}\n`,
			`1 ${'ab'.repeat(16)} 1 $(touch ${marker})\n`,
			`1 ${'ab'.repeat(16)} 01 CPP\n`,
			`1 ${'ab'.repeat(16)} 2147483648 CPP\n`,
			`1 ${'cd'.repeat(16)} 1 CPP\n`,
			`1 ${'ab'.repeat(16)} 1 CPP ${'x'.repeat(512)}\n`
		]) {
			writeFileSync(local.request, mailbox);
			const result = local.run(
				'set -eu\nif __wasm_idle_poll; then status=0; else status=$?; fi\nprintf "%s\\n" "$status" "$PWD"\n'
			);
			expect(result).toMatchObject({ status: 0, stderr: '' });
			expect(result.stdout.trimEnd().split('\n')).toEqual(['0', join(local.workspace, 'C')]);
		}
		expect(() => readFileSync(marker)).toThrow();
		expect(() => readFileSync(local.ack)).toThrow();
	});

	it('reports a real failed cd and preserves the prior cwd when the target disappears', () => {
		const local = nativeFixture(`1 ${'ab'.repeat(16)} 1 CPP\n`);
		rmSync(join(local.workspace, 'CPP'), { recursive: true });
		const result = local.run(
			'set -eu\nif __wasm_idle_poll; then status=0; else status=$?; fi\nprintf "%s\\n" "$status" "$PWD"\n'
		);
		expect(result.status).toBe(0);
		expect(result.stderr).toContain('No such file or directory');
		expect(result.stdout.trimEnd().split('\n')).toEqual(['0', join(local.workspace, 'C')]);
		expect(readFileSync(local.ack, 'utf8')).toBe(
			`${join(local.workspace, 'C')}|1|${'ab'.repeat(16)}|1|CPP|failed\n`
		);
	});

	it('keeps a directory request pending until the actual host cwd matches its acknowledgement', async () => {
		const { control, fs, changes } = fixture();
		const moved = control.requestDirectory('CPP');
		let settled = false;
		void moved.then(() => {
			settled = true;
		});
		expect(control.inspect()).toMatchObject({
			cwd: '/workspace',
			pendingCwd: '/workspace/CPP',
			generation: 1,
			appliedGeneration: 0
		});
		expect(fs.lstat('/workspace/CPP').type).toBe('directory');
		expect(control.onInvocation(acknowledgement(fs, '/workspace/C'))).toBe(126);
		await Promise.resolve();
		expect(settled).toBe(false); // A forged PWD string is not evidence of a parent-shell cd.
		expect(control.onInvocation(acknowledgement(fs))).toBe(0);
		await moved;
		expect(control.inspect()).toMatchObject({
			cwd: '/workspace/CPP',
			pendingCwd: null,
			generation: 1,
			appliedGeneration: 1
		});
		expect(control.inspect()).not.toHaveProperty('session');
		expect(changes).toHaveBeenCalledTimes(3);
	});

	it('publishes only the newest generation and rejects superseded callers explicitly', async () => {
		const { control, fs } = fixture();
		const earlier = control.requestDirectory('C');
		const superseded = earlier.catch((error) => error);
		const oldAck = acknowledgement(fs);
		const latest = control.requestDirectory('CPP');
		expect((await superseded).name).toBe('AbortError');
		expect(control.onInvocation(oldAck)).toBe(0);
		expect(control.inspect()).toMatchObject({
			pendingCwd: '/workspace/CPP',
			appliedGeneration: 0,
			generation: 2
		});
		expect(control.onInvocation({ ...oldAck, cwd: '/tmp' })).toBe(126);
		control.onInvocation(acknowledgement(fs));
		await latest;
		expect(control.inspect()).toMatchObject({
			cwd: '/workspace/CPP',
			pendingCwd: null,
			appliedGeneration: 2
		});
	});

	it('deduplicates one pending target but reissues a confirmed target after manual shell navigation', async () => {
		const { control, fs } = fixture();
		const first = control.requestDirectory('C');
		expect(control.requestDirectory('C')).toBe(first);
		control.onInvocation(acknowledgement(fs));
		await first;
		const again = control.requestDirectory('C');
		expect(control.inspect()).toMatchObject({ generation: 2, pendingCwd: '/workspace/C' });
		control.onInvocation(acknowledgement(fs));
		await again;
	});

	it('rejects malformed, foreign, future, and wrong-project acknowledgements without clearing pending work', async () => {
		const { control, fs } = fixture();
		const moved = control.requestDirectory('CPP');
		const valid = acknowledgement(fs);
		for (const [index, value] of [
			[1, '2'],
			[2, 'cd'.repeat(16)],
			[3, '99'],
			[3, '01'],
			[4, 'PYTHON'],
			[5, 'unknown']
		] as const) {
			const argv = [...valid.argv];
			argv[index] = value;
			expect(control.onInvocation({ ...valid, argv })).toBe(126);
		}
		expect(control.onInvocation({ ...valid, path: '/usr/local/bin/cat' })).toBeUndefined();
		expect(control.inspect().pendingCwd).toBe('/workspace/CPP');
		control.onInvocation(valid);
		await moved;
		expect(control.onInvocation(valid)).toBe(0); // The observer and adapter may see one ack.
	});

	it('reports a failed transition without losing its confirmed cwd and can retry a new generation', async () => {
		const { control, fs } = fixture();
		const moved = control.requestDirectory('CPP');
		const failed = moved.catch((error) => error);
		const ack = acknowledgement(fs, '/workspace', 'failed');
		expect(control.onInvocation(ack)).toBe(0);
		expect((await failed).message).toContain('/workspace/CPP');
		expect(control.inspect()).toMatchObject({
			cwd: '/workspace',
			pendingCwd: null,
			appliedGeneration: 0,
			error: 'Bash could not enter /workspace/CPP'
		});
		expect(control.onInvocation(ack)).toBe(0);
		const retried = control.requestDirectory('CPP');
		control.onInvocation(acknowledgement(fs));
		await retried;
		expect(control.inspect().error).toBeNull();
	});

	it('rejects arbitrary directory text and symlink substitutions before writing user files', async () => {
		const { control, fs } = fixture();
		await expect(control.requestDirectory('CPP; echo injected')).rejects.toThrow(/Unknown/);
		fs.mkdir('/workspace/PYTHON');
		fs.symlink('/workspace/PYTHON', '/workspace/C');
		await expect(control.requestDirectory('C')).rejects.toThrow(/actual project directory/);
		fs.writeFile('/workspace/keep.txt', encoder.encode('user content'));
		fs.unlink(SHELL_CONTROL_REQUEST);
		fs.symlink('/workspace/keep.txt', SHELL_CONTROL_REQUEST);
		await expect(control.requestDirectory('CPP')).rejects.toThrow(/regular file/);
		expect(decoder.decode(fs.readFile('/workspace/keep.txt'))).toBe('user content');
		expect(control.inspect().generation).toBe(0);
	});

	it('settles pending callers and removes only its own mailbox on idempotent disposal', async () => {
		const { control, fs } = fixture();
		const moved = control.requestDirectory('CPP');
		const cancelled = moved.catch((error) => error);
		const lateAcknowledgement = acknowledgement(fs);
		control.dispose();
		control.dispose();
		expect((await cancelled).name).toBe('AbortError');
		expect(control.inspect()).toMatchObject({ disposed: true, pendingCwd: null });
		expect(() => fs.lstat(SHELL_CONTROL_REQUEST)).toThrow();
		await expect(control.requestDirectory('C')).rejects.toThrow(/disposed/);
		expect(control.onInvocation(lateAcknowledgement)).toBe(126);
	});

	it('executes the real protocol adapter under the container and validates independently of an observer', async () => {
		const control = createShellControl({ languages: ['C', 'CPP'] });
		const container = createContainer({
			adapters: [control.adapter],
			commands: control.commands
		});
		owned.push(container);
		control.setup(container.fs);
		const moved = control.requestDirectory('CPP');
		const inv = acknowledgement(container.fs);
		const rejected = await container.run(
			SHELL_CONTROL_COMMAND,
			inv.argv.slice(1),
			{
				cwd: '/workspace'
			}
		);
		expect(rejected.code).toBe(126);
		expect(control.inspect().pendingCwd).toBe('/workspace/CPP');
		const accepted = await container.run(
			SHELL_CONTROL_COMMAND,
			inv.argv.slice(1),
			{
				cwd: inv.cwd
			}
		);
		await moved;
		expect(accepted).toMatchObject({ code: 0, reason: 'exited' });
		expect(accepted.stdout).toHaveLength(0);
		expect(accepted.stderr).toHaveLength(0);
		expect((await container.inspect()).processes).toEqual([]);
		control.dispose();
	});
});
