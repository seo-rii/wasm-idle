// Runs unchanged in Node and Chromium using production container workers.
import { checkCommandResult, compareTree, fromHex, toHex } from './command-cases.mjs';

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
			if (entry.type === 'directory') fs.mkdir(full);
			else if (entry.type === 'symlink') fs.symlink(entry.target, full);
			else fs.writeFile(full, fromHex(entry.hex));
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
