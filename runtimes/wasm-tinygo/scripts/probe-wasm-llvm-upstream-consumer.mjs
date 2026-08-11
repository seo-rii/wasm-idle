#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FLAG_NAMES = new Map([
	['--module', 'modulePath'],
	['--compiler', 'compilerPath'],
	['--root-archive', 'rootArchivePath'],
	['--producer-receipt', 'producerReceiptPath'],
	['--package-graph', 'packageGraphPath'],
	['--package-graph-receipt', 'packageGraphReceiptPath'],
	['--lld', 'lldPath'],
	['--workspace-dir', 'workspaceDirPath'],
	['--stdin', 'stdinPath'],
	['--expected-stdout', 'expectedStdoutPath'],
	['--output', 'outputPath']
]);

function parseArgs(argv) {
	const options = {};
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		const property = FLAG_NAMES.get(flag);
		if (!property) throw new Error(`unknown option: ${flag}`);
		const value = argv[index + 1];
		if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
		if (options[property]) throw new Error(`duplicate option: ${flag}`);
		options[property] = path.resolve(value);
		index += 1;
	}
	for (const [flag, property] of FLAG_NAMES) {
		if (!options[property]) throw new Error(`${flag} is required`);
	}
	return options;
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function evidence(assetPath, bytes) {
	return { path: assetPath, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const workspaceFiles = {};
	const visitWorkspace = async (directory, prefix = '') => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
			const absolute = path.join(directory, entry.name);
			if (entry.isDirectory()) await visitWorkspace(absolute, relative);
			else if (entry.isFile()) workspaceFiles[relative] = await readFile(absolute);
			else throw new Error(`unsupported workspace entry: ${relative}`);
		}
	};
	await visitWorkspace(options.workspaceDirPath);
	const [
		runtime,
		binaryenModule,
		compiler,
		packageGraph,
		rootArchive,
		producerReceipt,
		packageGraphReceipt,
		lld,
		stdin,
		expectedStdout
	] = await Promise.all([
		import(pathToFileURL(options.modulePath).href),
		import('binaryen'),
		readFile(options.compilerPath),
		readFile(options.packageGraphPath),
		readFile(options.rootArchivePath),
		readFile(options.producerReceiptPath),
		readFile(options.packageGraphReceiptPath),
		readFile(options.lldPath),
		readFile(options.stdinPath),
		readFile(options.expectedStdoutPath)
	]);
	const manifest = {
		schemaVersion: 2,
		format: runtime.TINYGO_UPSTREAM_ASSET_MANIFEST_FORMAT,
		producerReceipt: evidence('producer-receipt.json', producerReceipt),
		packageGraphReceipt: evidence('package-graph-provider-receipt.json', packageGraphReceipt),
		assets: {
			compiler: evidence('tinygo-compiler.wasm', compiler),
			packageGraph: evidence('tinygo-package-graph.wasm', packageGraph),
			rootArchive: evidence('tinygoroot.tar.gz', rootArchive),
			lld: evidence('lld.wasm', lld)
		}
	};
	process.stderr.write('upstream consumer phase=prepare\n');
	const toolchain = await runtime.prepareTinyGoUpstreamToolchain({
		manifest,
		producerReceipt,
		packageGraphReceipt,
		compiler,
		packageGraph,
		rootArchive,
		lld
	});
	const optimizer = runtime.createBinaryenTinyGoOptimizer(
		binaryenModule.default ?? binaryenModule
	);
	const compileResult = await runtime.compileUpstreamTinyGo(
		toolchain,
		{
			workspaceFiles,
			onPhase: (phase) => process.stderr.write(`upstream consumer phase=${phase}\n`)
		},
		optimizer
	);
	process.stderr.write('upstream consumer phase=execute\n');
	const execution = await runtime.executeUpstreamTinyGoWasm({
		wasm: compileResult.wasm,
		stdin
	});
	if (execution.exitCode !== 0) {
		throw new Error(
			`compiled TinyGo program exited with ${execution.exitCode}: ${new TextDecoder().decode(execution.stderr)}`
		);
	}
	if (!Buffer.from(execution.stdout).equals(expectedStdout)) {
		throw new Error(
			`compiled TinyGo stdout mismatch: ${JSON.stringify(new TextDecoder().decode(execution.stdout))}`
		);
	}
	const receipt = {
		schemaVersion: 2,
		format: 'wasm-idle-tinygo-upstream-consumer-acceptance-v2',
		status: 'passed',
		compileProtocolVersion: toolchain.compileProtocolVersion,
		producerReceiptSha256: sha256(producerReceipt),
		packageGraphReceiptSha256: sha256(packageGraphReceipt),
		assets: manifest.assets,
		binaryenVersion: runtime.TINYGO_BINARYEN_VERSION,
		packageCount: runtime.parseConcatenatedTinyGoPackageJSON(compileResult.packageJSON).length,
		compile: {
			object: evidence('program.o', compileResult.object),
			objects: compileResult.objects.map((object, index) =>
				evidence(
					compileResult.linkPlan.schemaVersion === 1
						? compileResult.linkPlan.object
						: compileResult.linkPlan.objects[index].path,
					object
				)
			),
			unoptimizedWasm: evidence('program.unoptimized.wasm', compileResult.unoptimizedWasm),
			wasm: evidence('program.wasm', compileResult.wasm),
			compilerStderrBytes: compileResult.compilerStderr.byteLength,
			linkerStderrBytes: compileResult.linkerStderr.byteLength
		},
		execution: {
			exitCode: execution.exitCode,
			stdout: new TextDecoder().decode(execution.stdout),
			stdoutSha256: sha256(execution.stdout),
			stderrBytes: execution.stderr.byteLength
		}
	};
	await writeFile(options.outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
	process.stdout.write(`passed: ${options.outputPath}\n`);
}

main().catch((error) => {
	console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
	process.exitCode = 1;
});
