// Runs unchanged in Node and Chromium using production container workers.
import { checkCommandResult, compareTree, fromHex, toHex } from './command-cases.mjs';
import {
	DIRECTORY_ARCHIVE_MTIME_MS,
	DIRECTORY_LAST_ARCHIVE_MTIME_MS,
	directoryTarHex,
	directoryTreeTarHex,
	duplicateDirectoryTarHex,
	storedBadCrcZipHex
} from './archive-regression-fixtures.mjs';

export async function exerciseCommands(config) {
	const { createContainer, validateDistribution, createContainerPackageManager } = await import(
		config.containerModule
	);
	const adapterModule = await import(config.adapterModule);
	const live = config.profile === 'live';
	const adapterId = live ? 'wasi-preview1-live' : 'wasi-preview1';
	const distribution = await validateDistribution({
		bytes: new TextEncoder().encode(config.distribution),
		expectedSha256: config.distributionSha256,
		adapterIds: [adapterId],
		allowedAssetURLs: [config.assetURL]
	});
	const manager = createContainerPackageManager({
		distribution,
		capabilities: ['wasi-preview1'],
		persistentCache: false
	});
	let activeWorkers = 0,
		createdWorkers = 0;
	const workerFactory = () => {
		const worker = config.workerFactory
			? config.workerFactory()
			: new Worker(config.workerModule, { type: 'module' });
		activeWorkers++;
		createdWorkers++;
		const stop = worker.terminate.bind(worker);
		let stopped;
		worker.terminate = () =>
			(stopped ??= Promise.resolve(stop()).finally(() => {
				activeWorkers--;
			}));
		return worker;
	};
	const adapter = live
		? adapterModule.createLiveWasiAdapter({
				workerFactory,
				pipeBytes: 4093,
				maxBlockedIoMs: 60000
			})
		: adapterModule.createWasiAdapter({ workerFactory });
	const container = createContainer({
		packages: manager,
		adapters: [adapter],
		maxProcesses: 4,
		maxBytes: config.artifactBytes + 2 * 1024 * 1024
	});
	const fs = container.fs,
		cwd = '/workspace/a b';
	const cases = [],
		checks = [];
	const options = {
		cwd,
		env: { LC_ALL: 'C', TZ: 'UTC0' },
		timeoutMs: 30000,
		maxCaptureBytes: 2 * 1024 * 1024
	};
	const errorDetails = (error) => ({
		name: error.name,
		code: error.code,
		message: error.message
	});
	const digest = async (bytes) =>
		toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
	function clear(path) {
		for (const name of fs.readdir(path)) {
			const child = `${path}/${name}`;
			if (fs.lstat(child).type === 'directory') {
				clear(child);
				fs.rmdir(child);
			} else fs.unlink(child);
		}
	}
	function prepare(tree) {
		clear(cwd);
		for (const [path, entry] of Object.entries(tree).sort(([a], [b]) =>
			a < b ? -1 : a > b ? 1 : 0
		)) {
			const full = `${cwd}/${path}`;
			if (entry.type === 'directory') fs.mkdir(full, { mode: entry.mode ?? 0o755 });
			else if (entry.type === 'symlink') fs.symlink(entry.target, full);
			else fs.writeFile(full, fromHex(entry.hex), { mode: entry.mode ?? 0o644 });
		}
		for (const [path, entry] of Object.entries(tree)) {
			if (entry.atimeMs === undefined && entry.mtimeMs === undefined) continue;
			fs.setTimes(
				`${cwd}/${path}`,
				{
					...(entry.atimeMs === undefined ? {} : { atimeMs: entry.atimeMs }),
					...(entry.mtimeMs === undefined ? {} : { mtimeMs: entry.mtimeMs })
				},
				{},
				entry.type !== 'symlink'
			);
		}
	}
	function snapshot(prefix = '') {
		const tree = {};
		for (const name of fs.readdir(prefix ? `${cwd}/${prefix}` : cwd)) {
			const path = prefix ? `${prefix}/${name}` : name,
				full = `${cwd}/${path}`,
				info = fs.lstat(full);
			const meta = { mode: info.mode, mtimeMs: info.mtimeMs, atimeMs: info.atimeMs };
			if (info.type === 'directory') {
				tree[path] = { type: 'directory', ...meta };
				Object.assign(tree, snapshot(path));
			} else if (info.type === 'symlink')
				tree[path] = { type: 'symlink', target: fs.readlink(full), ...meta };
			else tree[path] = { type: 'file', hex: toHex(fs.readFile(full)), ...meta };
		}
		return tree;
	}
	const check = (id, passed, extra = {}) => checks.push({ id, passed, ...extra });
	const drain = async (stream) => {
		const reader = stream.getReader(),
			parts = [];
		let length = 0;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				length += value.length;
				if (length > 2 * 1024 * 1024)
					throw new Error('Command pipeline exceeded output bound');
				parts.push(value);
			}
		} finally {
			reader.releaseLock();
		}
		const result = new Uint8Array(length);
		let offset = 0;
		for (const part of parts) {
			result.set(part, offset);
			offset += part.length;
		}
		return result;
	};
	try {
		const cachedBefore = manager.inspect().assets.cachedEntries;
		check(
			'metadata-resolves-before-body',
			config.matrix.applets.every((name) => manager.resolveCommand(name)?.name === name) &&
				manager.resolveCommand('busybox')?.name === 'busybox' &&
				manager.inspect().assets.cachedEntries === cachedBefore
		);
		fs.mkdir(cwd);
		for (const test of config.matrix.cases)
			for (const invocation of ['argv0', 'multicall']) {
				const steps = [];
				let tree = {},
					failure;
				try {
					prepare(test.before);
					for (const expected of test.steps) {
						const result = await container.run(
							invocation === 'argv0' ? expected.applet : 'busybox',
							invocation === 'argv0'
								? expected.args
								: [expected.applet, ...expected.args],
							{ ...options, stdin: fromHex(expected.stdinHex) }
						);
						steps.push(checkCommandResult(result, expected));
					}
					tree = snapshot();
				} catch (error) {
					failure = errorDetails(error);
				}
				const files = compareTree(tree, test.after);
				cases.push({
					id: test.id,
					stage: test.stage,
					invocation,
					steps,
					files,
					passed:
						!failure &&
						steps.length === test.steps.length &&
						steps.every((result) => result.passed) &&
						files.passed,
					...(failure ? { error: failure } : {}),
					...(!files.passed ? { actualTree: tree, expectedTree: test.after } : {})
				});
			}
		prepare({ source: { type: 'file', hex: '0001ff' } });
		const packagePath = '/opt/toolchains/busybox/bin/busybox',
			packageBefore = await digest(fs.readFile(packagePath));
		const readonly = await container.run('tee', [packagePath], {
			...options,
			stdin: Uint8Array.of(0, 255)
		});
		check(
			'tee-readonly-package',
			readonly.reason === 'exited' &&
				readonly.code === 1 &&
				readonly.stderr.length > 0 &&
				toHex(readonly.stdout) === '00ff' &&
				(await digest(fs.readFile(packagePath))) === packageBefore,
			{ code: readonly.code, reason: readonly.reason, stderrHex: toHex(readonly.stderr) }
		);
		if (live) {
			const pipeline = await container.spawnPipeline(
				[{ command: 'sort' }, { command: 'uniq' }, { command: 'wc', args: ['-l'] }],
				options
			);
			const stdout = drain(pipeline.stdout),
				errors = Promise.all(pipeline.stderr.map(drain));
			const writer = pipeline.stdin.getWriter();
			await writer.write(new TextEncoder().encode('b\na\nb\na\n'));
			await writer.close();
			writer.releaseLock();
			const exits = await pipeline.exited,
				output = await stdout,
				stderr = await errors;
			check(
				'sort-uniq-wc-live-pipeline',
				exits.every((exit) => exit.reason === 'exited' && exit.code === 0) &&
					toHex(output) === toHex('2\n') &&
					stderr.every((bytes) => !bytes.length),
				{ exits, stdoutHex: toHex(output), stderrHex: stderr.map(toHex) }
			);
		}
		for (const applet of ['sort', 'uniq'])
			for (const invocation of ['argv0', 'multicall']) {
				const args = applet === 'sort' ? ['-o', 'file-output'] : ['-', 'file-output'];
				for (const length of [1025, 8193]) {
					prepare({ source: { type: 'file', hex: '0001ff' } });
					const payload = new TextEncoder().encode(`${'x'.repeat(length - 1)}\n`);
					const result = await container.run(
						invocation === 'argv0' ? applet : 'busybox',
						invocation === 'argv0' ? args : [applet, ...args],
						{ ...options, stdin: payload }
					);
					const output = fs.readFile(`${cwd}/file-output`);
					check(
						`${applet}-file-output-${length}-${invocation}`,
						result.reason === 'exited' &&
							result.code === 0 &&
							result.stderr.length === 0 &&
							result.stdout.length === 0 &&
							toHex(output) === toHex(payload),
						{
							code: result.code,
							reason: result.reason,
							stderrHex: toHex(result.stderr),
							inputBytes: payload.length,
							writtenBytes: output.length
						}
					);
				}
				// The WASI stdio buffer holds 1024 bytes. The smaller case fails on
				// fclose; the larger cases fail during fprintf before the final close.
				for (const length of [1024, 1025, 8193]) {
					prepare({ source: { type: 'file', hex: '0001ff' } });
					fs.writeFile(
						`${cwd}/quota-filler`,
						new Uint8Array(fs.maxBytes - fs.byteLength)
					);
					try {
						const payload = new TextEncoder().encode(`${'x'.repeat(length - 1)}\n`);
						const result = await container.run(
							invocation === 'argv0' ? applet : 'busybox',
							invocation === 'argv0' ? args : [applet, ...args],
							{ ...options, stdin: payload }
						);
						const writtenBytes = fs.stat(`${cwd}/file-output`).size;
						check(
							`${applet}-file-output-quota-${length}-${invocation}`,
							result.reason === 'exited' &&
								Number.isInteger(result.code) &&
								result.code > 0 &&
								result.stderr.length > 0 &&
								result.stdout.length === 0 &&
								writtenBytes === 0 &&
								toHex(fs.readFile(`${cwd}/source`)) === '0001ff',
							{
								code: result.code,
								reason: result.reason,
								stderrHex: toHex(result.stderr),
								inputBytes: payload.length,
								writtenBytes
							}
						);
					} finally {
						fs.unlink(`${cwd}/quota-filler`);
					}
				}
			}
		if (live)
			for (const applet of ['sort', 'uniq'])
				for (const length of [1025, 8193]) {
					prepare({ source: { type: 'file', hex: '0001ff' } });
					const outputPath = `${cwd}/redirected-output`;
					const fd = fs.open(outputPath, { write: true, create: true, truncate: true });
					let closed = false,
						filled = false,
						process;
					const pending = [];
					const closeOutput = () => {
						if (!closed) {
							closed = true;
							fs.close(fd);
						}
					};
					try {
						fs.writeFile(
							`${cwd}/quota-filler`,
							new Uint8Array(fs.maxBytes - fs.byteLength)
						);
						filled = true;
						process = await container.spawn(applet, [], {
							...options,
							stdio: {
								stdout: {
									async write(bytes) {
										return fs.write(fd, bytes);
									},
									close: closeOutput
								}
							}
						});
						const payload = new TextEncoder().encode(`${'x'.repeat(length - 1)}\n`);
						const send = async () => {
							const writer = process.stdin.getWriter();
							try {
								await writer.write(payload);
								await writer.close();
							} finally {
								writer.releaseLock();
							}
						};
						pending.push(
							drain(process.stdout),
							drain(process.stderr),
							process.exited,
							send()
						);
						const [stdout, stderr, result] = await Promise.all(pending);
						const writtenBytes = fs.stat(outputPath).size;
						check(
							`${applet}-redirected-stdout-quota-${length}`,
							result.reason === 'exited' &&
								Number.isInteger(result.code) &&
								result.code > 0 &&
								stderr.length > 0 &&
								stdout.length === 0 &&
								writtenBytes === 0 &&
								toHex(fs.readFile(`${cwd}/source`)) === '0001ff',
							{
								...result,
								stderrHex: toHex(stderr),
								inputBytes: payload.length,
								writtenBytes
							}
						);
					} finally {
						if (process) await process.terminate();
						await Promise.allSettled(pending);
						// Delegated descriptors belong to this caller, including on exit.
						closeOutput();
						if (filled) fs.unlink(`${cwd}/quota-filler`);
					}
				}
		if (config.matrix.stage >= 4)
			for (const invocation of ['argv0', 'multicall']) {
				const seedAtime = 1262304000123,
					seedMtime = 1262304000456;
				prepare({
					'archive.tar': { type: 'file', hex: directoryTarHex },
					data: {
						type: 'file',
						hex: toHex('preserved bytes'),
						atimeMs: seedAtime,
						mtimeMs: seedMtime
					}
				});
				const before = fs.stat(`${cwd}/data`);
				const conflict = await container.run(
					invocation === 'argv0' ? 'tar' : 'busybox',
					invocation === 'argv0' ? ['-xf', 'archive.tar'] : ['tar', '-xf', 'archive.tar'],
					options
				);
				const after = fs.stat(`${cwd}/data`);
				check(
					`tar-directory-file-conflict-${invocation}`,
					conflict.reason === 'exited' &&
						Number.isInteger(conflict.code) &&
						conflict.code > 0 &&
						conflict.stderr.length > 0 &&
						after.type === 'file' &&
						after.inode === before.inode &&
						after.atimeMs === before.atimeMs &&
						after.mtimeMs === before.mtimeMs &&
						toHex(fs.readFile(`${cwd}/data`)) === toHex('preserved bytes'),
					{
						code: conflict.code,
						reason: conflict.reason,
						stderrHex: toHex(conflict.stderr),
						before,
						after
					}
				);
				prepare({ 'archive.tar': { type: 'file', hex: directoryTarHex } });
				const readonlyRoot = `/opt/toolchains/archive-regression-${invocation}`;
				fs.mountReadonly(readonlyRoot, [
					{
						path: 'data',
						type: 'directory',
						mode: 0o755,
						atimeMs: seedAtime,
						mtimeMs: seedMtime
					}
				]);
				const readonlyArgs = ['-xmf', `${cwd}/archive.tar`, '-C', readonlyRoot];
				const readonlyDirectory = await container.run(
					invocation === 'argv0' ? 'tar' : 'busybox',
					invocation === 'argv0' ? readonlyArgs : ['tar', ...readonlyArgs],
					options
				);
				const readonlyInfo = fs.stat(`${readonlyRoot}/data`);
				check(
					`tar-readonly-directory-no-mtime-${invocation}`,
					readonlyDirectory.reason === 'exited' &&
						Number.isInteger(readonlyDirectory.code) &&
						readonlyDirectory.code > 0 &&
						readonlyDirectory.stderr.length > 0 &&
						readonlyInfo.atimeMs === seedAtime &&
						readonlyInfo.mtimeMs === seedMtime &&
						fs.readdir(`${readonlyRoot}/data`).length === 0,
					{
						code: readonlyDirectory.code,
						reason: readonlyDirectory.reason,
						stderrHex: toHex(readonlyDirectory.stderr),
						actual: readonlyInfo
					}
				);
				for (const [id, archiveHex, directoryMtime] of [
					['directory-child', directoryTreeTarHex, DIRECTORY_ARCHIVE_MTIME_MS],
					[
						'duplicate-directory',
						duplicateDirectoryTarHex,
						DIRECTORY_LAST_ARCHIVE_MTIME_MS
					]
				]) {
					prepare({ 'archive.tar': { type: 'file', hex: archiveHex } });
					const args = ['-xf', 'archive.tar'];
					const result = await container.run(
						invocation === 'argv0' ? 'tar' : 'busybox',
						invocation === 'argv0' ? args : ['tar', ...args],
						options
					);
					const directory = fs.stat(`${cwd}/data`),
						file = fs.stat(`${cwd}/data/file.txt`);
					check(
						`tar-${id}-mtime-${invocation}`,
						result.reason === 'exited' &&
							result.code === 0 &&
							result.stderr.length === 0 &&
							directory.type === 'directory' &&
							file.type === 'file' &&
							directory.mtimeMs === directoryMtime &&
							file.mtimeMs === DIRECTORY_ARCHIVE_MTIME_MS &&
							toHex(fs.readFile(`${cwd}/data/file.txt`)) === toHex('child'),
						{
							code: result.code,
							reason: result.reason,
							stderrHex: toHex(result.stderr),
							directory,
							file
						}
					);
				}
				for (const extract of [false, true]) {
					prepare({
						'bad-crc.zip': { type: 'file', hex: storedBadCrcZipHex },
						guard: { type: 'file', hex: toHex('preserved bytes') }
					});
					const args = [extract ? '-q' : '-p', 'bad-crc.zip'];
					const result = await container.run(
						invocation === 'argv0' ? 'unzip' : 'busybox',
						invocation === 'argv0' ? args : ['unzip', ...args],
						options
					);
					check(
						`unzip-stored-crc-${extract ? 'extract' : 'stdout'}-${invocation}`,
						result.reason === 'exited' &&
							Number.isInteger(result.code) &&
							result.code > 0 &&
							result.stderr.length > 0 &&
							toHex(fs.readFile(`${cwd}/guard`)) === toHex('preserved bytes'),
						{
							code: result.code,
							reason: result.reason,
							stderrHex: toHex(result.stderr),
							stdoutHex: toHex(result.stdout)
						}
					);
				}
			}
		// Leave only 32 bytes after a warm package mount. No large host allocation
		// or fake filesystem error is needed to exercise a real guest ENOSPC.
		prepare({ source: { type: 'file', hex: '0001ff' } });
		fs.writeFile(`${cwd}/quota-filler`, new Uint8Array(fs.maxBytes - fs.byteLength - 32));
		const payload = Uint8Array.from({ length: 257 }, (_, index) => index % 256);
		const quota = await container.run('tee', ['quota-output'], { ...options, stdin: payload });
		const quotaSize = fs.stat(`${cwd}/quota-output`).size;
		check(
			'tee-real-filesystem-quota',
			quota.reason === 'exited' &&
				quota.code === 1 &&
				quota.stderr.length > 0 &&
				toHex(quota.stdout) === toHex(payload) &&
				quotaSize <= 32 &&
				toHex(fs.readFile(`${cwd}/source`)) === '0001ff',
			{
				code: quota.code,
				reason: quota.reason,
				stderrHex: toHex(quota.stderr),
				writtenBytes: quotaSize
			}
		);
		fs.unlink(`${cwd}/quota-filler`);
		const restart = await container.run('true', [], options);
		check('restart-after-quota', restart.code === 0 && restart.reason === 'exited');
		const inspection = await container.inspect();
		check(
			'workers-and-processes-released',
			activeWorkers === 0 && inspection.processes.length === 0,
			{ activeWorkers, createdWorkers, processes: inspection.processes.length }
		);
		return {
			passed: cases.every((test) => test.passed) && checks.every((test) => test.passed),
			cases,
			checks,
			profile: config.profile,
			stage: config.matrix.stage,
			activeWorkers,
			createdWorkers,
			cachedAssets: manager.inspect().assets.cachedEntries,
			isolated: globalThis.crossOriginIsolated ?? false
		};
	} catch (error) {
		return {
			passed: false,
			cases,
			checks,
			error: errorDetails(error),
			activeWorkers,
			createdWorkers,
			profile: config.profile,
			stage: config.matrix.stage
		};
	} finally {
		await container.dispose();
		await manager.dispose();
	}
}
