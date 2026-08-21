import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(projectRoot, 'scripts', 'prepare-wasm-llvm-upstream-assets.mjs');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

for (const producer of [
	{ schemaVersion: 1, format: 'wasm-llvm-tinygo-browser-compiler-v1' },
	{ schemaVersion: 2, format: 'wasm-llvm-tinygo-browser-compiler-v2' },
	{ schemaVersion: 3, format: 'wasm-llvm-tinygo-browser-compiler-v3' },
	{ schemaVersion: 4, format: 'wasm-llvm-tinygo-browser-compiler-v4' },
	{ schemaVersion: 5, format: 'wasm-llvm-tinygo-browser-compiler-v5' },
	{ schemaVersion: 6, format: 'wasm-llvm-tinygo-browser-compiler-v6' }
]) {
	test(`prepares a hash-bound ${producer.format} asset directory without replacing an existing one`, async () => {
		const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'wasm-tinygo-upstream-assets-'));
		try {
			const compiler = Buffer.from([0, 97, 115, 109]);
			const packageGraph = Buffer.from([0, 97, 115, 109, 2]);
			const rootArchive = Buffer.from([31, 139, 8]);
			const lld = Buffer.from([0, 97, 115, 109, 1]);
			const compilerPath = path.join(temporaryRoot, 'compiler');
			const packageGraphPath = path.join(temporaryRoot, 'package-graph');
			const rootPath = path.join(temporaryRoot, 'root');
			const lldPath = path.join(temporaryRoot, 'lld');
			const receiptPath = path.join(temporaryRoot, 'receipt.json');
			const packageGraphReceiptPath = path.join(temporaryRoot, 'package-graph-receipt.json');
			const outputPath = path.join(temporaryRoot, 'output');
			const receipt = {
				schemaVersion: producer.schemaVersion,
				format: producer.format,
				producerId: 'wasm-llvm/tinygo-browser',
				...(producer.schemaVersion >= 2
					? {
							build: {
								compileProtocol: {
									version: producer.schemaVersion,
									format: `wasm-llvm-tinygo-link-plan-v${producer.schemaVersion}`,
									capabilities:
										producer.schemaVersion === 2
											? ['go-embed-objects']
											: producer.schemaVersion === 3
												? ['go-embed-objects', 'target-cgo-c']
												: producer.schemaVersion === 4
													? [
														'go-embed-objects',
														'target-cgo-c',
														'target-cxx-freestanding',
														'target-clang-assembly'
														]
													: producer.schemaVersion === 5
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
								},
								compileOutputs: ['objects', 'link-plan.json'],
								...(producer.schemaVersion >= 5
									? {
											rootArchive: {
												runtimeClosureFormat: 'wasm-llvm-tinygo-runtime-closure-v2'
											}
										}
									: {})
							}
						}
					: {}),
				verification: {
					status: 'passed',
					identityMode: 'upstream-package-graph',
					acceptance: { status: 'passed' }
				},
				assets: [
					{
						path: 'tinygo-compiler.wasm',
						bytes: compiler.byteLength,
						sha256: sha256(compiler)
					},
					{
						path: 'tinygoroot.tar.gz',
						bytes: rootArchive.byteLength,
						sha256: sha256(rootArchive)
					}
				]
			};
			const packageGraphReceipt = {
				format: 'wasm-llvm-tinygo-package-graph-provider-v1',
				producerId: 'wasm-llvm/tinygo-browser/package-graph',
				status: 'passed',
				upstream: { entrypoint: 'cmd/go' },
				acceptance: {
					status: 'passed',
					comparison: 'same-pinned-native-cmd-go-exact-json'
				},
				assets: [
					{
						path: 'tinygo-package-graph.wasm',
						bytes: packageGraph.byteLength,
						sha256: sha256(packageGraph)
					}
				]
			};
			await Promise.all([
				writeFile(compilerPath, compiler),
				writeFile(packageGraphPath, packageGraph),
				writeFile(rootPath, rootArchive),
				writeFile(lldPath, lld),
				writeFile(receiptPath, JSON.stringify(receipt)),
				writeFile(packageGraphReceiptPath, JSON.stringify(packageGraphReceipt))
			]);
			const args = [
				'--compiler',
				compilerPath,
				'--root-archive',
				rootPath,
				'--producer-receipt',
				receiptPath,
				'--package-graph',
				packageGraphPath,
				'--package-graph-receipt',
				packageGraphReceiptPath,
				'--lld',
				lldPath,
				'--output-dir',
				outputPath
			];
			await execFileAsync(process.execPath, [scriptPath, ...args]);
			const manifest = JSON.parse(
				await readFile(path.join(outputPath, 'upstream-toolchain.v2.json'), 'utf8')
			);
			assert.equal(manifest.format, 'wasm-idle-tinygo-upstream-assets-v2');
			assert.equal(manifest.assets.compiler.sha256, sha256(compiler));
			assert.equal(manifest.assets.packageGraph.sha256, sha256(packageGraph));
			assert.equal(manifest.assets.rootArchive.sha256, sha256(rootArchive));
			assert.equal(manifest.assets.lld.sha256, sha256(lld));
			if (producer.schemaVersion >= 2) {
				const mismatchedReceiptPath = path.join(temporaryRoot, 'mismatched-receipt.json');
				const mismatchedOutputPath = path.join(temporaryRoot, 'mismatched-output');
				await writeFile(
					mismatchedReceiptPath,
					JSON.stringify({ ...receipt, schemaVersion: 1 })
				);
				const mismatchedArgs = [...args];
				mismatchedArgs[mismatchedArgs.indexOf('--producer-receipt') + 1] =
					mismatchedReceiptPath;
				mismatchedArgs[mismatchedArgs.indexOf('--output-dir') + 1] = mismatchedOutputPath;
				await assert.rejects(
					execFileAsync(process.execPath, [scriptPath, ...mismatchedArgs]),
					/not a passed upstream TinyGo browser compiler receipt/
				);
			}
			if (producer.schemaVersion >= 4) {
				const wrongCapabilitiesPath = path.join(
					temporaryRoot,
					'wrong-capabilities-receipt.json'
				);
				const wrongCapabilitiesOutput = path.join(
					temporaryRoot,
					'wrong-capabilities-output'
				);
				await writeFile(
					wrongCapabilitiesPath,
					JSON.stringify({
						...receipt,
						build: {
							...receipt.build,
							compileProtocol: {
								...receipt.build.compileProtocol,
								capabilities: ['go-embed-objects', 'target-cgo-c']
							}
						}
					})
				);
				const wrongCapabilitiesArgs = [...args];
				wrongCapabilitiesArgs[wrongCapabilitiesArgs.indexOf('--producer-receipt') + 1] =
					wrongCapabilitiesPath;
				wrongCapabilitiesArgs[wrongCapabilitiesArgs.indexOf('--output-dir') + 1] =
					wrongCapabilitiesOutput;
				await assert.rejects(
					execFileAsync(process.execPath, [scriptPath, ...wrongCapabilitiesArgs]),
					new RegExp(`does not bind TinyGo compile protocol v${producer.schemaVersion}`)
				);
			}
			await assert.rejects(
				execFileAsync(process.execPath, [scriptPath, ...args]),
				/refusing to replace existing output directory/
			);
		} finally {
			await rm(temporaryRoot, { recursive: true, force: true });
		}
	});
}
