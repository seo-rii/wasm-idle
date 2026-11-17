// @vitest-environment node
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
	coqPpText,
	coqWorkspacePath,
	guardCoqFilesystem,
	readCoqCommandInput
} from '../../scripts/runtime-workers/coq-host.mjs';
import { buildCoqHostWorker, syncWasmCoqAssets } from '../../scripts/sync-wasm-coq.mjs';
import { COQ_PROFILE } from './playground/wasmCoqVersion';
import { compressStaticRuntimeAssets } from '../../scripts/compress-static-runtime-assets.mjs';
import { StaticStdinRingHost } from './playground/staticStdinRing';

describe('pinned original Coq distribution and host I/O', () => {
	it('verifies original release bytes, matching libraries, source records and generated worker', async () => {
		await syncWasmCoqAssets({ check: true });
	});
	it('rejects a corrupted kernel before evaluating it or writing derived output', async () => {
		const temp = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-coq-pin-'));
		try {
			const bytes = await readFile('static/wasm-coq/jscoq_worker.bc.js');
			bytes[bytes.length - 1] ^= 1;
			await writeFile(path.join(temp, 'jscoq_worker.bc.js'), bytes);
			await expect(syncWasmCoqAssets({ check: true, targetDir: temp })).rejects.toThrow(
				'pinned asset changed'
			);
		} finally {
			await rm(temp, { recursive: true, force: true });
		}
	});
	it('retains the real receipt-pinned URLs after production asset compression', async () => {
		const temp = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-coq-compressed-'));
		try {
			await cp('static/wasm-coq', path.join(temp, 'wasm-coq'), { recursive: true });
			const result = await compressStaticRuntimeAssets({ rootDir: temp });
			expect(result.compressed).toEqual([]);
			expect(result.manifestAssets).toEqual([]);
			await syncWasmCoqAssets({ check: true, targetDir: path.join(temp, 'wasm-coq') });
		} finally {
			await rm(temp, { recursive: true, force: true });
		}
	});
	it('builds the same pinned host in another checkout and dependency installation path', async () => {
		const temp = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-coq-portable-'));
		try {
			await cp('package.json', path.join(temp, 'package.json'));
			const sources = path.join(temp, 'scripts/runtime-workers');
			await mkdir(sources, { recursive: true });
			for (const file of ['coq-host.mjs', 'wasm-coq-runner-worker.js'])
				await cp(path.join('scripts/runtime-workers', file), path.join(sources, file));
			await mkdir(path.join(temp, 'node_modules'));
			await symlink(
				await realpath('node_modules/fflate'),
				path.join(temp, 'node_modules/fflate'),
				'dir'
			);
			expect(await buildCoqHostWorker({ sourceRoot: temp, profile: COQ_PROFILE })).toEqual(
				await readFile('static/wasm-coq/runner-worker.js')
			);
		} finally {
			await rm(temp, { recursive: true, force: true });
		}
	});
	it('normalizes native file aliases without touching source', () => {
		expect(coqWorkspacePath('src/main.v')).toBe('/lib/work/src/main.v');
		expect(coqWorkspacePath('src/main.coq')).toBe('/lib/work/src/main.coq.v');
		expect(coqWorkspacePath('main.COQ')).toBe('/lib/work/main.COQ.v');
		for (const value of ['../x', '/x', 'a/../b', 'a\\b', 'a//b', 'a\0b'])
			expect(() => coqWorkspacePath(value)).toThrow('Invalid Coq workspace path');
	});
	it('preserves Coq output text, breaks and Unicode from native pretty-print trees', () => {
		expect(
			coqPpText([
				'Pp_glue',
				[
					['Pp_string', '안녕'],
					['Pp_print_break', 1, 0],
					['Pp_tag', 'type', ['Pp_string', 'nat']],
					['Pp_force_newline'],
					['Pp_string', '42']
				]
			])
		).toBe('안녕 nat\n42');
		expect(
			coqPpText([
				'Pp_box',
				['Pp_vbox', 0],
				[
					'Pp_glue',
					[
						['Pp_string', 'a'],
						['Pp_print_break', 1, 0],
						['Pp_string', 'b']
					]
				]
			])
		).toBe('a\nb');
	});
	it('drains an EOF command stream unchanged across ring backpressure and UTF-8 boundaries', () => {
		const input = '(* 안녕. *)\nCheck nat.\n';
		const ring = new StaticStdinRingHost({ capacity: 7, maxBufferedBytes: 128 });
		ring.enqueue(input);
		ring.close();
		let notifications = 0;
		const bytes = readCoqCommandInput(ring.descriptor, 128, () => {
			notifications++;
			ring.consumerRequestedInput();
		});
		expect(new TextDecoder().decode(bytes)).toBe(input);
		expect(notifications).toBeLessThan(new TextEncoder().encode(input).length);
	});
	it('handles non-power-of-two counter rollover and enforces byte limits before allocation', () => {
		const buffer = new SharedArrayBuffer(19);
		new Int32Array(buffer, 0, 4).set([1, 4294967293, 1, 0]);
		new Uint8Array(buffer, 16).set([99, 97, 98]);
		const descriptor = {
			protocol: 'wasm-idle-static-stdin-ring',
			protocolVersion: 2,
			controlBytes: 16,
			capacity: 3,
			buffer
		};
		expect(new TextDecoder().decode(readCoqCommandInput(descriptor, 3, () => {}))).toBe('abc');
		new Int32Array(buffer, 0, 4).set([1, 4294967293, 1, 0]);
		expect(() => readCoqCommandInput(descriptor, 2, () => {})).toThrow('workspace limit');
		expect(() => readCoqCommandInput({}, 3, () => {})).toThrow('Invalid Coq stdin ring');
	});
	it('bounds native virtual-file writes and retains a violation caught by the kernel', () => {
		class File {
			size: number;
			constructor(size = 0) {
				this.size = size;
			}
			length() {
				return this.size;
			}
			write(offset: number, _source: unknown, _sourceOffset: number, length: number) {
				this.size = Math.max(this.size, offset + length);
			}
			truncate(size = 0) {
				this.size = size;
			}
		}
		class Device {
			content: Record<string, File> = { library: new File(1000) };
			open(name: string, _flags: unknown) {
				return (this.content[name] ||= new File());
			}
		}
		const device = new Device(),
			fs = guardCoqFilesystem(
				{ MlFakeFile: File, MlFakeDevice: Device, jsoo_mount_point: [{ device }] },
				10
			);
		expect(fs.usage()).toBe(0);
		const output = device.open('answer.ml', {});
		output.write(0, null, 0, 8);
		expect(fs.usage()).toBe(8);
		expect(() => output.write(8, null, 0, 3)).toThrow('workspace limit');
		expect(output.length()).toBe(8);
		expect(() => fs.check()).toThrow('workspace limit');
		expect(() => device.content.library.truncate(0)).toThrow('read-only');
		expect(() => device.open('untrusted.cma.js', {})).toThrow('verified bundled');
	});
});
