import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { compileOnHost } from '../dist/src/node.js';

const testPath = fileURLToPath(import.meta.url);
const testsDir = path.dirname(testPath);
const projectRoot = path.resolve(testsDir, '..');
const opamRoot =
	process.env.WASM_OF_JS_OF_OCAML_OPAM_ROOT ||
	path.join(process.env.HOME || process.cwd(), '.cache', 'wasm-of-js-of-ocaml', 'opam');
const switchName = process.env.WASM_OF_JS_OF_OCAML_SWITCH_NAME || 'wasm-of-js-of-ocaml';
const opamBin =
	process.env.WASM_OF_JS_OF_OCAML_OPAM_BIN ||
	(await readFile(path.join(projectRoot, '.cache', 'opam-2.2.1')).then(
		() => path.join(projectRoot, '.cache', 'opam-2.2.1'),
		() => 'opam'
	));
const switchPrefix =
	process.env.WASM_OF_JS_OF_OCAML_SWITCH_PREFIX ||
	(
		await runCommand(opamBin, ['var', 'prefix', '--root', opamRoot, '--switch', switchName], {
			env: process.env
		})
	).stdout.trim();
const binaryenBin =
	process.env.WASM_OF_JS_OF_OCAML_BINARYEN_BIN ||
	path.join(projectRoot, '.cache', 'binaryen-version_129', 'bin');

function runCommand(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const stdoutParts = [];
		const stderrParts = [];
		const child = spawn(command, args, options);
		child.stdout.on('data', (chunk) => {
			stdoutParts.push(Buffer.from(chunk));
		});
		child.stderr.on('data', (chunk) => {
			stderrParts.push(Buffer.from(chunk));
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				reject(
					new Error(
						`${command} ${args.join(' ')} failed with ${code ?? 1}\n${Buffer.concat(stderrParts).toString('utf8')}`
					)
				);
				return;
			}
			resolve({
				stdout: Buffer.concat(stdoutParts).toString('utf8'),
				stderr: Buffer.concat(stderrParts).toString('utf8')
			});
		});
	});
}

test(
	'host pipeline validator emits JavaScript and wasm artifacts',
	{ timeout: 180_000 },
	async () => {
		const result = await runCommand(
			process.execPath,
			['./scripts/validate-host-pipeline.mjs'],
			{
				cwd: projectRoot,
				env: {
					...process.env,
					WASM_OF_JS_OF_OCAML_VALIDATE_TARGET: 'both'
				}
			}
		);
		const summary = JSON.parse(result.stdout);
		assert.equal(summary.validateTarget, 'both');
		assert.ok(
			summary.jsArtifacts.some((artifact) => artifact.path.endsWith('.js')),
			'expected a JavaScript artifact from the host js pipeline'
		);
		assert.ok(
			summary.wasmArtifacts.some(
				(artifact) => artifact.kind === 'wasm' || artifact.path.endsWith('.wasm')
			),
			'expected a wasm artifact from the host wasm pipeline'
		);
	}
);

test('host pipeline compiles a multi-module JavaScript fixture', async () => {
	const [greetingSource, mainSource] = await Promise.all([
		readFile(path.join(projectRoot, 'fixtures', 'modules', 'greeting.ml'), 'utf8'),
		readFile(path.join(projectRoot, 'fixtures', 'modules', 'main.ml'), 'utf8')
	]);

	const result = await compileOnHost(
		{
			files: {
				'greeting.ml': greetingSource,
				'main.ml': mainSource
			},
			entry: 'main.ml',
			target: 'js'
		},
		{
			switchPrefix
		}
	);

	assert.equal(result.success, true, result.stderr);
	assert.ok(
		result.artifacts.some((artifact) => artifact.path.endsWith('/main.js')),
		'expected a JavaScript artifact for the multi-module entrypoint'
	);
});

test('host pipeline surfaces diagnostics for compile failures', async () => {
	const source = await readFile(
		path.join(projectRoot, 'fixtures', 'diagnostics', 'type_error.ml'),
		'utf8'
	);

	const result = await compileOnHost(
		{
			files: {
				'type_error.ml': source
			},
			entry: 'type_error.ml',
			target: 'js'
		},
		{
			switchPrefix
		}
	);

	assert.equal(result.success, false, 'expected the diagnostics fixture to fail');
	assert.ok(
		result.stderr.includes('Error:'),
		'expected compiler stderr to include the OCaml error'
	);
	assert.ok(result.diagnostics.length > 0, 'expected at least one diagnostic');
	assert.equal(result.diagnostics[0]?.file, 'type_error.ml');
	assert.equal(result.diagnostics[0]?.severity, 'error');
	assert.match(result.diagnostics[0]?.message || '', /string|int/i);
});

test('host pipeline resolves yojson for js and wasm targets', async () => {
	const source = await readFile(
		path.join(projectRoot, 'fixtures', 'packages', 'yojson_main.ml'),
		'utf8'
	);

	for (const target of ['js', 'wasm']) {
		const result = await compileOnHost(
			{
				files: {
					'yojson_main.ml': source
				},
				entry: 'yojson_main.ml',
				target,
				packages: ['yojson']
			},
			{
				switchPrefix,
				binaryenBin
			}
		);

		assert.equal(result.success, true, `${target} package fixture failed\n${result.stderr}`);
		assert.ok(
			result.artifacts.some((artifact) => artifact.path.endsWith('/yojson_main.js')),
			`expected a JavaScript artifact for the ${target} package fixture`
		);
		if (target === 'wasm') {
			assert.ok(
				result.artifacts.some((artifact) => artifact.path.endsWith('.wasm')),
				'expected a wasm artifact for the yojson wasm fixture'
			);
		}
	}
});
