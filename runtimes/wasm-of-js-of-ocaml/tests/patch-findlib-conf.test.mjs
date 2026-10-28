import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/patch-findlib-conf.mjs', import.meta.url));

for (const [name, paths] of [
	['relative findlib 1.9.9 paths', './ocaml:.'],
	['absolute findlib 1.9.8 paths', '/switch/lib/ocaml:/switch/lib']
]) {
	test(`mounts ${name} independently of the user workspace`, async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), 'findlib-conf-'));
		try {
			const input = path.join(directory, 'findlib.conf');
			const output = path.join(directory, 'browser.conf');
			await writeFile(input, `path="${paths}"\ndestdir="."\nocamlc="ocamlc.opt"\n`);
			await run(process.execPath, [
				script,
				'--input',
				input,
				'--output',
				output,
				'--source-prefix',
				'/switch/lib',
				'--toolchain-root',
				'/static/toolchain/lib'
			]);
			assert.equal(
				await readFile(output, 'utf8'),
				'path="/static/toolchain/lib/ocaml:/static/toolchain/lib"\ndestdir="/static/toolchain/lib"\nocamlc="ocamlc.opt"\n'
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
}
