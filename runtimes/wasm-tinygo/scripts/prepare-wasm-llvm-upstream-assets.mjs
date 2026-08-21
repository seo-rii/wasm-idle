#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const FLAGS = new Map([
	['--compiler', 'compilerPath'],
	['--root-archive', 'rootArchivePath'],
	['--producer-receipt', 'producerReceiptPath'],
	['--package-graph', 'packageGraphPath'],
	['--package-graph-receipt', 'packageGraphReceiptPath'],
	['--lld', 'lldPath'],
	['--output-dir', 'outputDir']
]);

function parseArgs(argv) {
	const options = {};
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		const property = FLAGS.get(flag);
		if (!property) throw new Error(`unknown option: ${flag}`);
		const value = argv[index + 1];
		if (!value || value.startsWith('--')) throw new Error(`${flag} requires a path`);
		if (options[property]) throw new Error(`duplicate option: ${flag}`);
		options[property] = path.resolve(value);
		index += 1;
	}
	for (const [flag, property] of FLAGS) {
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

function assertProducerReceipt(receipt, compilerEvidence, rootEvidence) {
	const compileProtocolVersion =
		receipt?.schemaVersion === 1 && receipt?.format === 'wasm-llvm-tinygo-browser-compiler-v1'
			? 1
			: receipt?.schemaVersion === 2 &&
				  receipt?.format === 'wasm-llvm-tinygo-browser-compiler-v2'
				? 2
				: receipt?.schemaVersion === 3 &&
					  receipt?.format === 'wasm-llvm-tinygo-browser-compiler-v3'
					? 3
					: receipt?.schemaVersion === 4 &&
						  receipt?.format === 'wasm-llvm-tinygo-browser-compiler-v4'
						? 4
						: receipt?.schemaVersion === 5 &&
							  receipt?.format === 'wasm-llvm-tinygo-browser-compiler-v5'
							? 5
							: receipt?.schemaVersion === 6 &&
								  receipt?.format === 'wasm-llvm-tinygo-browser-compiler-v6'
								? 6
								: null;
	if (
		compileProtocolVersion === null ||
		receipt?.producerId !== 'wasm-llvm/tinygo-browser' ||
		receipt?.verification?.status !== 'passed' ||
		receipt?.verification?.identityMode !== 'upstream-package-graph' ||
		receipt?.verification?.acceptance?.status !== 'passed'
	) {
		throw new Error(
			'producer receipt is not a passed upstream TinyGo browser compiler receipt'
		);
	}
	if (
		compileProtocolVersion >= 2 &&
		(receipt?.build?.compileProtocol?.version !== compileProtocolVersion ||
			receipt?.build?.compileProtocol?.format !==
				`wasm-llvm-tinygo-link-plan-v${compileProtocolVersion}` ||
			JSON.stringify(receipt?.build?.compileProtocol?.capabilities) !==
				JSON.stringify(
					compileProtocolVersion === 2
						? ['go-embed-objects']
						: compileProtocolVersion === 3
							? ['go-embed-objects', 'target-cgo-c']
							: compileProtocolVersion === 4
								? [
									'go-embed-objects',
									'target-cgo-c',
									'target-cxx-freestanding',
									'target-clang-assembly'
									]
								: compileProtocolVersion === 5
									? [
											'go-embed-objects',
											'target-cgo-c',
											'target-cxx-hosted-noeh',
											'target-clang-assembly'
										]
									: [
											'go-embed-objects',
											'target-cgo-c',
											'target-cxx-hosted-noeh',
											'target-clang-assembly',
											'target-cgo-cxxflags',
											'target-cgo-linker-flags'
										]
				) ||
			JSON.stringify(receipt?.build?.compileOutputs) !==
				JSON.stringify(['objects', 'link-plan.json']))
	) {
		throw new Error(
			`producer receipt does not bind TinyGo compile protocol v${compileProtocolVersion}`
		);
	}
	if (
		compileProtocolVersion >= 5 &&
		receipt?.build?.rootArchive?.runtimeClosureFormat !==
			'wasm-llvm-tinygo-runtime-closure-v2'
	) {
		throw new Error('producer receipt does not bind TinyGo runtime closure v2');
	}
	for (const expected of [compilerEvidence, rootEvidence]) {
		const actual = receipt.assets?.find((asset) => asset?.path === expected.path);
		if (actual?.bytes !== expected.bytes || actual?.sha256 !== expected.sha256) {
			throw new Error(`producer receipt does not bind ${expected.path}`);
		}
	}
}

function assertPackageGraphReceipt(receipt, packageGraphEvidence) {
	if (
		receipt?.format !== 'wasm-llvm-tinygo-package-graph-provider-v1' ||
		receipt?.producerId !== 'wasm-llvm/tinygo-browser/package-graph' ||
		receipt?.status !== 'passed' ||
		receipt?.upstream?.entrypoint !== 'cmd/go' ||
		receipt?.acceptance?.status !== 'passed' ||
		receipt?.acceptance?.comparison !== 'same-pinned-native-cmd-go-exact-json'
	) {
		throw new Error('package-graph receipt is not a passed upstream cmd/go provider receipt');
	}
	const actual = receipt.assets?.find((asset) => asset?.path === packageGraphEvidence.path);
	if (
		actual?.bytes !== packageGraphEvidence.bytes ||
		actual?.sha256 !== packageGraphEvidence.sha256
	) {
		throw new Error(`package-graph receipt does not bind ${packageGraphEvidence.path}`);
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const existing = await lstat(options.outputDir).catch((error) => {
		if (error?.code === 'ENOENT') return null;
		throw error;
	});
	if (existing)
		throw new Error(`refusing to replace existing output directory ${options.outputDir}`);
	const [compiler, packageGraph, rootArchive, producerReceipt, packageGraphReceipt, lld] =
		await Promise.all([
			readFile(options.compilerPath),
			readFile(options.packageGraphPath),
			readFile(options.rootArchivePath),
			readFile(options.producerReceiptPath),
			readFile(options.packageGraphReceiptPath),
			readFile(options.lldPath)
		]);
	let receipt;
	let graphReceipt;
	try {
		receipt = JSON.parse(producerReceipt.toString('utf8'));
	} catch (error) {
		throw new Error('compiler producer receipt is not valid JSON', { cause: error });
	}
	try {
		graphReceipt = JSON.parse(packageGraphReceipt.toString('utf8'));
	} catch (error) {
		throw new Error('package-graph producer receipt is not valid JSON', { cause: error });
	}
	const compilerEvidence = evidence('tinygo-compiler.wasm', compiler);
	const packageGraphEvidence = evidence('tinygo-package-graph.wasm', packageGraph);
	const rootEvidence = evidence('tinygoroot.tar.gz', rootArchive);
	assertProducerReceipt(receipt, compilerEvidence, rootEvidence);
	assertPackageGraphReceipt(graphReceipt, packageGraphEvidence);
	const manifest = {
		schemaVersion: 2,
		format: 'wasm-idle-tinygo-upstream-assets-v2',
		producerReceipt: evidence('producer-receipt.json', producerReceipt),
		packageGraphReceipt: evidence('package-graph-provider-receipt.json', packageGraphReceipt),
		assets: {
			compiler: compilerEvidence,
			packageGraph: packageGraphEvidence,
			rootArchive: rootEvidence,
			lld: evidence('lld.wasm', lld)
		}
	};
	await mkdir(path.dirname(options.outputDir), { recursive: true });
	const temporaryDirectory = await mkdtemp(
		path.join(path.dirname(options.outputDir), `.${path.basename(options.outputDir)}.tmp-`)
	);
	try {
		await Promise.all([
			writeFile(path.join(temporaryDirectory, 'tinygo-compiler.wasm'), compiler),
			writeFile(path.join(temporaryDirectory, 'tinygo-package-graph.wasm'), packageGraph),
			writeFile(path.join(temporaryDirectory, 'tinygoroot.tar.gz'), rootArchive),
			writeFile(path.join(temporaryDirectory, 'producer-receipt.json'), producerReceipt),
			writeFile(
				path.join(temporaryDirectory, 'package-graph-provider-receipt.json'),
				packageGraphReceipt
			),
			writeFile(path.join(temporaryDirectory, 'lld.wasm'), lld),
			writeFile(
				path.join(temporaryDirectory, 'upstream-toolchain.v2.json'),
				`${JSON.stringify(manifest, null, 2)}\n`
			)
		]);
		await rename(temporaryDirectory, options.outputDir);
	} catch (error) {
		await rm(temporaryDirectory, { recursive: true, force: true });
		throw error;
	}
	process.stdout.write(`prepared: ${options.outputDir}\n`);
}

main().catch((error) => {
	console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
	process.exitCode = 1;
});
