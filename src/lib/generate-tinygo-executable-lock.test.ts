// @vitest-environment node

import {
	chmod,
	link,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateTinyGoExecutableLock } from '../../scripts/generate-tinygo-executable-lock.mjs';

const fixtures: string[] = [];
const originalSource = 'export const compiler = true;\n';

async function fixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-tinygo-lock-path-'));
	fixtures.push(root);
	const source = path.join(root, 'source');
	await mkdir(source);
	const entry = path.join(source, 'upstream.js');
	await writeFile(entry, originalSource);
	return { root, source, entry };
}

afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('TinyGo lock output safety', () => {
	it('rejects an output parent alias into the input without overwriting source', async () => {
		const { root, source, entry } = await fixture();
		const alias = path.join(root, 'alias');
		await symlink(source, alias, 'dir');
		await expect(
			generateTinyGoExecutableLock(source, path.join(alias, 'upstream.js'))
		).rejects.toThrow('outside');
		expect(await readFile(entry, 'utf8')).toBe(originalSource);
	});

	it('rejects a leaf output symlink to source and preserves the symlink', async () => {
		const { root, source, entry } = await fixture();
		const output = path.join(root, 'lock.json');
		await symlink(entry, output, 'file');
		await expect(generateTinyGoExecutableLock(source, output)).rejects.toThrow('symlink');
		expect(await readFile(entry, 'utf8')).toBe(originalSource);
		expect((await lstat(output)).isSymbolicLink()).toBe(true);
	});

	it('rejects missing output parents below an alias into the input before creating them', async () => {
		const { root, source } = await fixture();
		const alias = path.join(root, 'alias');
		await symlink(source, alias, 'dir');
		await expect(
			generateTinyGoExecutableLock(source, path.join(alias, 'new', 'nested', 'lock.json'))
		).rejects.toThrow('outside');
		expect(await readdir(source)).toEqual(['upstream.js']);
	});

	it('uses the real input path when an input ancestor is a symlink', async () => {
		const { root, source } = await fixture();
		const alias = path.join(root, 'root-alias');
		await symlink(root, alias, 'dir');
		await expect(
			generateTinyGoExecutableLock(path.join(alias, 'source'), path.join(source, 'lock.json'))
		).rejects.toThrow('outside');
		expect(await readdir(source)).toEqual(['upstream.js']);
	});

	it('rejects a dangling output symlink without following it', async () => {
		const { root, source } = await fixture();
		const output = path.join(root, 'lock.json');
		const missing = path.join(source, 'missing.json');
		await symlink(missing, output, 'file');
		await expect(generateTinyGoExecutableLock(source, output)).rejects.toThrow('symlink');
		expect((await lstat(output)).isSymbolicLink()).toBe(true);
		await expect(lstat(missing)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('creates absent outside parents and updates an existing regular lock atomically', async () => {
		const { root, source, entry } = await fixture();
		const output = path.join(root, 'outside', 'nested', 'lock.json');
		const first = await generateTinyGoExecutableLock(source, output);
		expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(first);
		await chmod(output, 0o664);
		await writeFile(entry, 'export const compiler = false;\n');
		const second = await generateTinyGoExecutableLock(source, output);
		expect(second.modules[0].sha256).not.toBe(first.modules[0].sha256);
		expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(second);
		expect((await lstat(output)).mode & 0o777).toBe(0o664);
		expect(await readdir(path.dirname(output))).toEqual(['lock.json']);
	});

	it('replaces an outside hardlinked lock without truncating the input inode', async () => {
		const { root, source, entry } = await fixture();
		const output = path.join(root, 'lock.json');
		await link(entry, output);
		const generated = await generateTinyGoExecutableLock(source, output);
		expect(await readFile(entry, 'utf8')).toBe(originalSource);
		expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(generated);
		expect((await lstat(output)).ino).not.toBe((await lstat(entry)).ino);
	});

	it('allows an outside parent alias and leaves an existing lock unchanged on invalid input', async () => {
		const { root, source } = await fixture();
		const outside = path.join(root, 'outside');
		await mkdir(outside);
		const alias = path.join(root, 'output-alias');
		await symlink(outside, alias, 'dir');
		const output = path.join(alias, 'lock.json');
		await generateTinyGoExecutableLock(source, output);
		const before = await readFile(output);
		await writeFile(path.join(source, 'unreachable.js'), 'export {};');
		await expect(generateTinyGoExecutableLock(source, output)).rejects.toThrow('unreachable');
		expect(await readFile(output)).toEqual(before);
		expect(await readdir(outside)).toEqual(['lock.json']);
	});
});
