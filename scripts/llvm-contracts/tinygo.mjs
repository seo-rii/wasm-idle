import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import path from 'node:path';
export const TINYGO_LLVM_PROFILE = Object.freeze({
	id: 'tinygo-emception-llvm',
	version: 2,
	tinygoVersion: '0.40.1',
	llvmVersion: '16.0.0',
	llvmCommit: 'd5a963ab8b40fcf7a99acd834e5f10a1a30cc2e5',
	workerUrl: 'https://jprendes.github.io/emception/emception.worker.bundle.worker.js',
	patchedWorkerSha256: '2c2347f5869d1c08181f46bd1ae10723be242d66cdc233e201cad0d5acb8fcea'
});
const AUTOMATIC_PUBLIC_PATH_SNIPPET = [
	'if(!e)throw new Error("Automatic publicPath is not supported in this browser");',
	'e=e.replace(/#.*$/,""\u0029.replace(/\\?.*$/,""\u0029.replace(/\\/[^\\/]+$/,"/"),',
	'__webpack_require__.p=e'
].join('');
const MODULE_INIT_SNIPPET = 'this.ready=this.#e(e,r,{onrunprocess:t,...a});';
const MODULE_INIT_PATCHED = 'this.ready=this.#e(e,r,a);';
const EMCEPTION_EXPOSE_SNIPPET = 'globalThis.emception=Hn,i(Hn)';
const EMCEPTION_EXPOSE_PATCHED =
	'Hn.mkdir=async e=>{await Hn.fileSystem.mkdir(e)};globalThis.emception=Hn,i(Hn)';
export function patchEmceptionWorkerSource(source) {
	if (!source.includes(AUTOMATIC_PUBLIC_PATH_SNIPPET)) {
		throw new Error('emception worker format changed; update the wasm-llvm TinyGo profile');
	}
	if (!source.includes(MODULE_INIT_SNIPPET)) {
		throw new Error(
			'emception worker init format changed; update the wasm-llvm TinyGo profile'
		);
	}
	if (!source.includes(EMCEPTION_EXPOSE_SNIPPET)) {
		throw new Error(
			'emception worker export format changed; update the wasm-llvm TinyGo profile'
		);
	}
	return source
		.replace(/e\.exports=t\.p\+"([^"]+)\.br"/g, 'e.exports=t.p+"$1.brotli"')
		.replace(
			AUTOMATIC_PUBLIC_PATH_SNIPPET,
			'__webpack_require__.p=new URL("./",self.location.href).href'
		)
		.replace(MODULE_INIT_SNIPPET, MODULE_INIT_PATCHED)
		.replace(EMCEPTION_EXPOSE_SNIPPET, EMCEPTION_EXPOSE_PATCHED);
}
export function discoverEmceptionAssetNames(workerSource) {
	const assetNames = [];
	const seenAssetNames = new Set();
	for (const match of workerSource.matchAll(/e\.exports=t\.p\+"([^"]+)"/g)) {
		const assetName = match[1];
		if (!assetName || seenAssetNames.has(assetName)) continue;
		seenAssetNames.add(assetName);
		assetNames.push(assetName);
	}
	return assetNames;
}
export async function syncEmceptionRuntime({
	workerUrl = TINYGO_LLVM_PROFILE.workerUrl,
	outputPath,
	fetchImpl = fetch,
	expectedWorkerSha256 = workerUrl === TINYGO_LLVM_PROFILE.workerUrl
		? TINYGO_LLVM_PROFILE.patchedWorkerSha256
		: null
}) {
	let sourceText = '';
	let reusedExistingWorker = false;
	try {
		const response = await fetchImpl(workerUrl);
		if (!response.ok) {
			throw new Error(
				`Failed to download emception worker: ${response.status} ${response.statusText}`
			);
		}
		sourceText = await response.text();
	} catch (error) {
		try {
			await access(outputPath);
			reusedExistingWorker = true;
			sourceText = await readFile(outputPath, 'utf8');
		} catch {
			throw error;
		}
	}
	const outputDir = path.dirname(outputPath);
	let workerSource = sourceText;
	if (!reusedExistingWorker) {
		workerSource = patchEmceptionWorkerSource(sourceText);
	}
	if (expectedWorkerSha256) {
		const sourceWithoutBanner = workerSource.replace(/^\/\* Generated[^\n]*\*\/\n/, '');
		const actualWorkerSha256 = createHash('sha256').update(sourceWithoutBanner).digest('hex');
		if (actualWorkerSha256 !== expectedWorkerSha256) {
			throw new Error(
				`emception worker checksum mismatch: expected ${expectedWorkerSha256}, received ${actualWorkerSha256}`
			);
		}
	}
	if (!reusedExistingWorker) {
		const banner = `/* Generated from ${workerUrl} by @seo-rii/wasm-llvm. */\n`;
		await mkdir(outputDir, { recursive: true });
		await writeFile(outputPath, `${banner}${workerSource}`);
	}
	const assetBaseUrl = new URL('./', workerUrl);
	const assetNames = discoverEmceptionAssetNames(workerSource);
	for (const assetName of assetNames) {
		const assetPath = path.join(outputDir, assetName);
		try {
			await access(assetPath);
			continue;
		} catch {
			// Download missing assets below.
		}
		const remoteAssetName = assetName.endsWith('.brotli')
			? `${assetName.slice(0, -'.brotli'.length)}.br`
			: assetName;
		const response = await fetchImpl(new URL(remoteAssetName, assetBaseUrl));
		if (!response.ok) {
			throw new Error(
				`Failed to download emception asset ${remoteAssetName}: ${response.status} ${response.statusText}`
			);
		}
		await mkdir(path.dirname(assetPath), { recursive: true });
		await writeFile(assetPath, Buffer.from(await response.arrayBuffer()));
	}
	return { workerUrl, outputPath, assetNames, reusedExistingWorker };
}
