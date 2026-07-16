import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { compileOnHost } from '../dist/src/node.js';
import { DEFAULT_SWITCH_NAME } from './toolchain-defaults.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const projectRoot = path.resolve(scriptsDir, '..');

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
						`${command} ${args.join(' ')} failed with ${code}\n${Buffer.concat(stderrParts).toString('utf8')}`
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

const opamRoot =
	process.env.WASM_OF_JS_OF_OCAML_OPAM_ROOT ||
	path.join(process.env.HOME || process.cwd(), '.cache', 'wasm-of-js-of-ocaml', 'opam');
const switchName = process.env.WASM_OF_JS_OF_OCAML_SWITCH_NAME || DEFAULT_SWITCH_NAME;
const opamBin =
	process.env.WASM_OF_JS_OF_OCAML_OPAM_BIN ||
	(await readFile(path.join(projectRoot, '.cache', 'opam-2.2.1')).then(
		() => path.join(projectRoot, '.cache', 'opam-2.2.1'),
		() => 'opam'
	));
const validateTarget = process.env.WASM_OF_JS_OF_OCAML_VALIDATE_TARGET || 'both';
const binaryenBin =
	process.env.WASM_OF_JS_OF_OCAML_BINARYEN_BIN ||
	(await readFile(
		path.join(projectRoot, '.cache', 'binaryen-version_129', 'bin', 'wasm-merge')
	).then(
		() => path.join(projectRoot, '.cache', 'binaryen-version_129', 'bin'),
		() => undefined
	));
const source = await readFile(path.join(projectRoot, 'fixtures', 'hello', 'hello.ml'), 'utf8');
const prefix =
	process.env.WASM_OF_JS_OF_OCAML_SWITCH_PREFIX ||
	(
		await runCommand(opamBin, ['var', 'prefix', '--root', opamRoot, '--switch', switchName], {
			env: process.env
		})
	).stdout.trim();

const jsResult = await compileOnHost(
	{
		files: {
			'hello.ml': source
		},
		entry: 'hello.ml',
		target: 'js'
	},
	{
		switchPrefix: prefix,
		...(binaryenBin ? { binaryenBin } : {})
	}
);

if (!jsResult.success) {
	throw new Error(`js pipeline failed\n${jsResult.stderr}`);
}
if (!jsResult.artifacts.some((artifact) => artifact.kind === 'js')) {
	throw new Error('js pipeline succeeded without a JavaScript artifact');
}

let wasmArtifacts = [];
if (validateTarget === 'wasm' || validateTarget === 'both') {
	const wasmResult = await compileOnHost(
		{
			files: {
				'hello.ml': source
			},
			entry: 'hello.ml',
			target: 'wasm'
		},
		{
			switchPrefix: prefix,
			...(binaryenBin ? { binaryenBin } : {})
		}
	);

	if (!wasmResult.success) {
		throw new Error(`wasm pipeline failed\n${wasmResult.stderr}`);
	}
	if (!wasmResult.artifacts.some((artifact) => artifact.kind === 'js')) {
		throw new Error('wasm pipeline succeeded without a JavaScript loader artifact');
	}
	if (
		!wasmResult.artifacts.some(
			(artifact) => artifact.kind === 'wasm' || artifact.path.endsWith('.wasm')
		)
	) {
		throw new Error('wasm pipeline succeeded without a wasm asset');
	}
	wasmArtifacts = wasmResult.artifacts.map((artifact) => ({
		path: artifact.path,
		kind: artifact.kind
	}));
}

console.log(
	JSON.stringify(
		{
			validateTarget,
			switchPrefix: prefix,
			jsArtifacts: jsResult.artifacts.map((artifact) => ({
				path: artifact.path,
				kind: artifact.kind
			})),
			wasmArtifacts
		},
		null,
		2
	)
);
