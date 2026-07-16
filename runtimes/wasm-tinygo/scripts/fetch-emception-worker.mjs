import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	syncEmceptionRuntime,
	TINYGO_LLVM_PROFILE
} from '../../../scripts/llvm-contracts/tinygo.mjs';

const emceptionWorkerUrl =
	process.env.WASM_TINYGO_EMCEPTION_WORKER_URL ?? TINYGO_LLVM_PROFILE.workerUrl;

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath =
	process.env.WASM_TINYGO_EMCEPTION_OUTPUT_PATH ??
	path.join(rootDir, 'public', 'vendor', 'emception', 'emception.worker.js');

const result = await syncEmceptionRuntime({ workerUrl: emceptionWorkerUrl, outputPath });
if (result.reusedExistingWorker) {
	console.warn(`Reused ${path.relative(rootDir, outputPath)}`);
} else {
	console.log(`Wrote ${path.relative(rootDir, outputPath)}`);
}
console.log(`Resolved ${result.assetNames.length} emception runtime assets`);
