import assert from 'node:assert/strict';
import { delimiter, join } from 'node:path';
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { buildWasmAwkRuntime } from './build.mjs';

const FAKE_GO_SOURCE = `#!/usr/bin/env node
const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_GO_LOG, JSON.stringify(args) + '\\n');

if (args[0] === 'env' && args[1] === 'GOROOT') {
  process.stdout.write(process.env.FAKE_GO_ROOT + '\\n');
} else if (args[0] === 'env' && args[1] === 'GOVERSION') {
  process.stdout.write('go1.24.0\\n');
} else if (args[0] === 'list') {
  process.stdout.write('v1.30.1\\n');
} else if (args[0] === 'build') {
  const outputPath = args[args.indexOf('-o') + 1];
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
} else {
  process.stderr.write('Unexpected fake Go invocation: ' + args.join(' ') + '\\n');
  process.exitCode = 1;
}
`;

test('uses a repeatable Go build command without VCS metadata', async (t) => {
	const tempRoot = await mkdtemp(join(tmpdir(), 'wasm-awk-build-'));
	const binDir = join(tempRoot, 'bin');
	const fakeGoRoot = join(tempRoot, 'goroot');
	const logPath = join(tempRoot, 'go-invocations.jsonl');
	const distDir = join(tempRoot, 'dist');
	const fakeGoPath = join(binDir, 'go');
	const wasmExecPath = join(fakeGoRoot, 'lib', 'wasm', 'wasm_exec.js');
	const originalPath = process.env.PATH;
	const originalFakeGoLog = process.env.FAKE_GO_LOG;
	const originalFakeGoRoot = process.env.FAKE_GO_ROOT;

	await mkdir(binDir, { recursive: true });
	await mkdir(join(fakeGoRoot, 'lib', 'wasm'), { recursive: true });
	await writeFile(fakeGoPath, FAKE_GO_SOURCE, 'utf8');
	await chmod(fakeGoPath, 0o755);
	await writeFile(wasmExecPath, 'fake wasm exec\n', 'utf8');

	process.env.PATH = `${binDir}${delimiter}${originalPath ?? ''}`;
	process.env.FAKE_GO_LOG = logPath;
	process.env.FAKE_GO_ROOT = fakeGoRoot;

	t.after(async () => {
		if (originalPath === undefined) delete process.env.PATH;
		else process.env.PATH = originalPath;
		if (originalFakeGoLog === undefined) delete process.env.FAKE_GO_LOG;
		else process.env.FAKE_GO_LOG = originalFakeGoLog;
		if (originalFakeGoRoot === undefined) delete process.env.FAKE_GO_ROOT;
		else process.env.FAKE_GO_ROOT = originalFakeGoRoot;
		await rm(tempRoot, { recursive: true, force: true });
	});

	await buildWasmAwkRuntime({ distDir });
	const firstWasm = await readFile(join(distDir, 'goawk.wasm'));
	const firstMetadata = await readFile(join(distDir, 'runtime-build.json'), 'utf8');

	await buildWasmAwkRuntime({ distDir });
	const secondWasm = await readFile(join(distDir, 'goawk.wasm'));
	const secondMetadata = await readFile(join(distDir, 'runtime-build.json'), 'utf8');

	const invocations = (await readFile(logPath, 'utf8'))
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line));
	const buildInvocations = invocations.filter(([command]) => command === 'build');
	const expectedBuildInvocation = [
		'build',
		'-buildvcs=false',
		'-trimpath',
		'-ldflags=-s -w -buildid=',
		'-o',
		join(distDir, 'goawk.wasm'),
		'./cmd/wasm-awk'
	];

	assert.equal(buildInvocations.length, 2);
	assert.deepEqual(buildInvocations[0], expectedBuildInvocation);
	assert.deepEqual(buildInvocations[1], expectedBuildInvocation);
	assert.deepEqual(secondWasm, firstWasm);
	assert.equal(secondMetadata, firstMetadata);
});
