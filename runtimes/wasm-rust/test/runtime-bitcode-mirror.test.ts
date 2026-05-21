import { File, wasi } from '@bjorn3/browser_wasi_shim';
import { describe, expect, it } from 'vitest';

import { normalizeRuntimeManifest } from '../src/runtime-manifest.js';
import { buildPreopenedDirectories, readMirroredBitcode } from '../src/rustc-runtime.js';
import { createRuntimeManifest } from './helpers.js';

describe('mirrored bitcode file', () => {
	it('preserves the shared mirror when rustc renames a temp bitcode file into place', async () => {
		const sharedBitcodeBuffer = new SharedArrayBuffer(16 + 256);
		const manifest = normalizeRuntimeManifest(createRuntimeManifest());
		const { fds } = await buildPreopenedDirectories(
			manifest,
			[],
			'fn main() { println!("hi"); }',
			sharedBitcodeBuffer
		);
		const workDirectory = fds[5] as any;
		const tempFileName = 'rmeta-temp.bc';
		const expectedBitcode = new Uint8Array([0x42, 0x43, 0xc0, 0xde]);

		expect(readMirroredBitcode(sharedBitcodeBuffer).length).toBe(0);
		expect(workDirectory.path_link(tempFileName, new File(expectedBitcode), false)).toBe(
			wasi.ERRNO_SUCCESS
		);

		const tempUnlink = workDirectory.path_unlink(tempFileName);
		expect(tempUnlink.ret).toBe(wasi.ERRNO_SUCCESS);
		expect(tempUnlink.inode_obj).toBeInstanceOf(File);

		expect(workDirectory.path_unlink_file(manifest.compiler.workerBitcodeFile)).toBe(
			wasi.ERRNO_SUCCESS
		);
		expect(
			workDirectory.path_link(manifest.compiler.workerBitcodeFile, tempUnlink.inode_obj, true)
		).toBe(
			wasi.ERRNO_SUCCESS
		);

		const mirrored = readMirroredBitcode(sharedBitcodeBuffer);
		expect(mirrored.overflowed).toBe(false);
		expect(Array.from(mirrored.bytes)).toEqual(Array.from(expectedBitcode));
	});

	it('preserves the shared mirror when the root preopen renames work bitcode into place', async () => {
		const sharedBitcodeBuffer = new SharedArrayBuffer(16 + 256);
		const manifest = normalizeRuntimeManifest(createRuntimeManifest());
		const { fds } = await buildPreopenedDirectories(
			manifest,
			[],
			'fn main() { println!("hi"); }',
			sharedBitcodeBuffer
		);
		const rootDirectory = fds[6] as any;
		const tempFileName = 'work/rmeta-temp.bc';
		const expectedBitcode = new Uint8Array([0x0b, 0x17, 0xc0, 0xde]);

		expect(rootDirectory.path_link(tempFileName, new File(expectedBitcode), false)).toBe(
			wasi.ERRNO_SUCCESS
		);

		const tempUnlink = rootDirectory.path_unlink(tempFileName);
		expect(tempUnlink.ret).toBe(wasi.ERRNO_SUCCESS);
		expect(tempUnlink.inode_obj).toBeInstanceOf(File);

		expect(rootDirectory.path_unlink_file(`work/${manifest.compiler.workerBitcodeFile}`)).toBe(
			wasi.ERRNO_SUCCESS
		);
		expect(
			rootDirectory.path_link(
				`work/${manifest.compiler.workerBitcodeFile}`,
				tempUnlink.inode_obj,
				true
			)
		).toBe(wasi.ERRNO_SUCCESS);

		const mirrored = readMirroredBitcode(sharedBitcodeBuffer);
		expect(mirrored.overflowed).toBe(false);
		expect(Array.from(mirrored.bytes)).toEqual(Array.from(expectedBitcode));
	});

	it('preserves the shared mirror after reopening /work from the root preopen', async () => {
		const sharedBitcodeBuffer = new SharedArrayBuffer(16 + 256);
		const manifest = normalizeRuntimeManifest(createRuntimeManifest());
		const { fds } = await buildPreopenedDirectories(
			manifest,
			[],
			'fn main() { println!("hi"); }',
			sharedBitcodeBuffer
		);
		const rootDirectory = fds[6] as any;
		const openedWork = rootDirectory.path_open(0, 'work', 0, 0n, 0n, 0);
		const workDirectory = openedWork.fd_obj as any;
		const tempFileName = 'rmeta-opened-dir.bc';
		const expectedBitcode = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);

		expect(openedWork.ret).toBe(wasi.ERRNO_SUCCESS);
		expect(workDirectory.path_link(tempFileName, new File(expectedBitcode), false)).toBe(
			wasi.ERRNO_SUCCESS
		);

		const tempUnlink = workDirectory.path_unlink(tempFileName);
		expect(tempUnlink.ret).toBe(wasi.ERRNO_SUCCESS);
		expect(tempUnlink.inode_obj).toBeInstanceOf(File);

		expect(workDirectory.path_unlink_file(manifest.compiler.workerBitcodeFile)).toBe(
			wasi.ERRNO_SUCCESS
		);
		expect(
			workDirectory.path_link(manifest.compiler.workerBitcodeFile, tempUnlink.inode_obj, true)
		).toBe(
			wasi.ERRNO_SUCCESS
		);

		const mirrored = readMirroredBitcode(sharedBitcodeBuffer);
		expect(mirrored.overflowed).toBe(false);
		expect(Array.from(mirrored.bytes)).toEqual(Array.from(expectedBitcode));
	});
});
