import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
export const phpantomLock = JSON.parse(
	await readFile(new URL('./phpantom-lsp-assets.lock.json', import.meta.url), 'utf8')
);

export function verifyPhpantomAsset(bytes, receipt, name) {
	if (
		bytes.length !== receipt.bytes ||
		createHash('sha256').update(bytes).digest('hex') !== receipt.sha256
	) {
		throw new Error(
			`PHPantom ${name} does not match the pinned ${phpantomLock.version} release`
		);
	}
	return bytes;
}

async function download(receipt, name) {
	const response = await fetch(receipt.url, { signal: AbortSignal.timeout(120_000) });
	if (!response.ok) throw new Error(`PHPantom ${name} download failed: HTTP ${response.status}`);
	const chunks = [];
	let length = 0;
	for await (const chunk of response.body) {
		length += chunk.length;
		if (length > receipt.bytes)
			throw new Error(`PHPantom ${name} exceeds the pinned byte size`);
		chunks.push(chunk);
	}
	return verifyPhpantomAsset(Buffer.concat(chunks), receipt, name);
}

/** Download and verify unmodified upstream bytes. The optional archive is also hash-checked. */
export async function syncPhpantomLsp({
	outputDirectory = path.join(root, 'static/wasm-phpantom-lsp'),
	archivePath
} = {}) {
	const cacheDirectory = path.join(root, '.cache/phpantom-lsp');
	await mkdir(cacheDirectory, { recursive: true });
	const archive = archivePath
		? verifyPhpantomAsset(await readFile(archivePath), phpantomLock.archive, 'archive')
		: await download(phpantomLock.archive, 'archive');
	const temporaryArchive = path.join(cacheDirectory, `${randomUUID()}.tar.gz`);
	const temporaryOutput = `${outputDirectory}.preparing-${randomUUID()}`;
	try {
		await writeFile(temporaryArchive, archive, { mode: 0o600 });
		const { stdout } = await exec('tar', ['-xOzf', temporaryArchive, 'phpantom_lsp.wasm'], {
			encoding: 'buffer',
			maxBuffer: phpantomLock.wasm.bytes + 1024
		});
		const wasm = verifyPhpantomAsset(stdout, phpantomLock.wasm, 'WASM');
		const module = await WebAssembly.compile(wasm);
		const names = new Set(WebAssembly.Module.exports(module).map((item) => item.name));
		for (const name of [
			'memory',
			'lsp_alloc',
			'lsp_dealloc',
			'lsp_handle',
			'lsp_response_len'
		]) {
			if (!names.has(name)) throw new Error(`PHPantom reactor is missing ${name}`);
		}
		const license = await download(phpantomLock.license, 'LICENSE');
		await mkdir(temporaryOutput, { recursive: true });
		await writeFile(path.join(temporaryOutput, 'phpantom_lsp.wasm'), wasm);
		await writeFile(path.join(temporaryOutput, 'LICENSE'), license);
		await writeFile(
			path.join(temporaryOutput, 'source.json'),
			`${JSON.stringify(phpantomLock, null, '\t')}\n`
		);
		await mkdir(outputDirectory, { recursive: true });
		for (const name of ['phpantom_lsp.wasm', 'LICENSE', 'source.json']) {
			await rename(path.join(temporaryOutput, name), path.join(outputDirectory, name));
		}
		return { version: phpantomLock.version, outputDirectory, ...phpantomLock.wasm };
	} finally {
		await rm(temporaryArchive, { force: true });
		await rm(temporaryOutput, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	console.log(await syncPhpantomLsp({ archivePath: process.env.PHPANTOM_LSP_ARCHIVE }));
}
