import { mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../runtimes/wasm-bash/bridge/', import.meta.url));
const temporary = await mkdtemp(
	join(process.env.WASM_IDLE_SHELL_TEST_TMP || tmpdir(), 'shell-frame-')
);
try {
	const c = join(temporary, 'c-encoder');
	const rust = join(temporary, 'rust-decoder');
	execFileSync(
		process.env.CC || 'cc',
		[
			'-std=c11',
			'-Wall',
			'-Wextra',
			'-Werror',
			'-DWASM_IDLE_SHELL_EXEC_TEST',
			join(source, 'execve.c'),
			join(source, 'test-execve.c'),
			'-o',
			c
		],
		{ stdio: 'inherit' }
	);
	execFileSync(c, [temporary], { stdio: 'inherit' });
	execFileSync(
		process.env.RUSTC || 'rustc',
		['--edition=2021', '--test', join(source, 'exec_frame_test.rs'), '-o', rust],
		{ stdio: 'inherit' }
	);
	execFileSync(rust, [], {
		stdio: 'inherit',
		env: { ...process.env, WASM_IDLE_EXEC_FRAME_FIXTURES: temporary }
	});
	for (const name of [
		'sdk_host_command_pending',
		'sdk_host_filesystem_lifetime',
		'bounded_pipe',
		'sdk_exit_status'
	]) {
		const executable = join(temporary, name);
		execFileSync(
			process.env.RUSTC || 'rustc',
			['--edition=2021', '--test', join(source, `${name}.rs`), '-o', executable],
			{ stdio: 'inherit' }
		);
		execFileSync(executable, [], { stdio: 'inherit' });
	}
	console.log(
		'C/Rust exec frame and SDK request/lifetime tests passed. The patched SDK and Bash were not built by this test.'
	);
} finally {
	await rm(temporary, { recursive: true, force: true });
}
