// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

function makeLFortranFixture() {
	const sourceDir = path.join(process.cwd(), 'static', 'wasm-fortran');
	const tempDir = path.join(os.tmpdir(), `wasm-idle-lfortran-${process.pid}-${Date.now()}`);
	mkdirSync(tempDir);
	tempDirs.push(tempDir);
	copyFileSync(path.join(sourceDir, 'lfortran.js'), path.join(tempDir, 'lfortran.js'));
	copyFileSync(path.join(sourceDir, 'lfortran.data'), path.join(tempDir, 'lfortran.data'));
	writeFileSync(
		path.join(tempDir, 'lfortran.wasm'),
		gunzipSync(readFileSync(path.join(sourceDir, 'lfortran.wasm.gz')))
	);
	return tempDir;
}

function runLFortranCodegenProbe() {
	const tempDir = makeLFortranFixture();
	writeFileSync(
		path.join(tempDir, 'probe.cjs'),
		`
const Module = require('./lfortran.js');
const stdoutOnly = 'program main\\nprint *, 73\\nend program main';
const stdinRead = 'program main\\ninteger :: n\\nread(*,*) n\\nprint *, n + 5\\nend program main';
const record = (entry) => console.log(JSON.stringify(entry));
Module.onRuntimeInitialized = () => {
  const names = [
    'emit_c_from_source',
    'emit_cpp_from_source',
    'emit_wat_from_source',
    'emit_wasm_from_source'
  ];
  const fns = Object.fromEntries(names.map((name) => [
    name,
    Module.cwrap(name, 'string', ['string'])
  ]));
  for (const [label, source] of [['stdout-only', stdoutOnly], ['stdin-read', stdinRead]]) {
    for (const name of names) {
      try {
        const output = fns[name](source);
        record({ label, name, ok: true, output: String(output).slice(0, 5000) });
      } catch (error) {
        record({
          label,
          name,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
};
`
	);
	const result = spawnSync(process.execPath, ['probe.cjs'], {
		cwd: tempDir,
		encoding: 'utf8',
		timeout: 120_000
	});
	return result.stdout
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.startsWith('{'))
		.map((line) => JSON.parse(line) as Record<string, string | boolean>);
}

describe('LFortran browser runtime blocker', () => {
	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) rmSync(tempDir, { recursive: true, force: true });
	});

	it('keeps Fortran execution blocked until stdin READ codegen works in upstream LFortran', () => {
		const results = runLFortranCodegenProbe();
		const byKey = new Map(results.map((entry) => [`${entry.label}:${entry.name}`, entry]));

		expect(byKey.get('stdout-only:emit_wasm_from_source')).toMatchObject({ ok: true });
		expect(String(byKey.get('stdout-only:emit_wasm_from_source')?.output)).toContain(
			'97,115,109'
		);

		expect(byKey.get('stdin-read:emit_wasm_from_source')).toMatchObject({ ok: false });
		expect(byKey.get('stdin-read:emit_wat_from_source')).toMatchObject({ ok: false });
		expect(byKey.get('stdin-read:emit_c_from_source')).toMatchObject({ ok: false });
		expect(String(byKey.get('stdin-read:emit_cpp_from_source')?.output)).toContain(
			'FIXME: READ'
		);
	});
});
