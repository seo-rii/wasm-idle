import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const lock = JSON.parse(await readFile(new URL('./assets.lock.json', import.meta.url), 'utf8'));
const verifyOnly = process.argv.includes('--verify');
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && !process.argv[outputIndex + 1])
	throw new Error('--output requires a directory');
const outputDirectory =
	outputIndex < 0
		? new URL('./assets/', import.meta.url)
		: pathToFileURL(path.resolve(process.argv[outputIndex + 1]) + path.sep);
let total = 0;
for (const entry of lock.files) {
	if (!/^(?:[\w.-]+\/)*[\w.-]+$/.test(entry.path)) throw new Error('Invalid locked asset path');
	const target = new URL(entry.path, outputDirectory);
	let bytes;
	try {
		bytes = await readFile(target);
	} catch (error) {
		if (verifyOnly) throw error;
	}
	const valid = (data) =>
		data &&
		data.length === entry.bytes &&
		createHash('sha256').update(data).digest('hex') === entry.sha256;
	if (!valid(bytes)) {
		if (verifyOnly) throw new Error(`Scala asset integrity mismatch: ${entry.path}`);
		const response = await fetch(
			`https://raw.githubusercontent.com/${lock.repository}/${lock.revision}/compiler/browser-ide/assets/${entry.path}`
		);
		if (!response.ok) throw new Error(`Scala asset HTTP ${response.status}: ${entry.path}`);
		bytes = Buffer.from(await response.arrayBuffer());
		if (!valid(bytes)) throw new Error(`Scala asset integrity mismatch: ${entry.path}`);
		await mkdir(new URL('.', target), { recursive: true });
		await writeFile(target, bytes);
	}
	total += bytes.length;
}
console.log(
	`Verified ${lock.files.length} Scala assets (${total} bytes), revision ${lock.revision}.`
);
