/** Bound the original module's sole memory before instantiation; language code stays unchanged. */
function capVerilogWasmMemory(bytes, maxBytes) {
	const u32 = (offset) => {
		let value = 0;
		let shift = 0;
		for (let count = 0; count < 5; count++) {
			const byte = bytes[offset++];
			if (byte === undefined) throw new Error('Truncated Verilog Wasm section');
			value += (byte & 127) * 2 ** shift;
			if (!(byte & 128)) return [value, offset];
			shift += 7;
		}
		throw new Error('Invalid Verilog Wasm integer');
	};
	const encode = (value) => {
		const result = [];
		do {
			const byte = value % 128;
			value = Math.floor(value / 128);
			result.push(byte | (value ? 128 : 0));
		} while (value);
		return result;
	};
	if (
		!(bytes instanceof Uint8Array) ||
		bytes.length < 8 ||
		bytes[0] !== 0 ||
		bytes[1] !== 97 ||
		bytes[2] !== 115 ||
		bytes[3] !== 109
	)
		throw new Error('Invalid Verilog Wasm module');
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
		throw new Error('Invalid Verilog memory limit');
	for (let offset = 8; offset < bytes.length;) {
		const start = offset;
		const id = bytes[offset++];
		let length;
		[length, offset] = u32(offset);
		const end = offset + length;
		if (end > bytes.length) throw new Error('Truncated Verilog Wasm section');
		if (id !== 5) {
			offset = end;
			continue;
		}
		let count, flags, minimum, maximum;
		[count, offset] = u32(offset);
		[flags, offset] = u32(offset);
		[minimum, offset] = u32(offset);
		if (count !== 1 || flags > 1) throw new Error('Unsupported Verilog Wasm memory');
		if (flags === 1) [maximum, offset] = u32(offset);
		if (offset !== end) throw new Error('Invalid Verilog Wasm memory section');
		const pages = Math.min(Math.floor(maxBytes / 65536), maximum ?? 65536);
		if (pages < minimum)
			throw Object.assign(new Error('Verilog memory limit is below the stage minimum'), {
				code: 'resource-limit',
				resource: 'wasm-memory',
				actual: minimum * 65536,
				limit: maxBytes
			});
		const payload = [1, 1, ...encode(minimum), ...encode(pages)];
		const section = [5, ...encode(payload.length), ...payload];
		const result = new Uint8Array(start + section.length + bytes.length - end);
		result.set(bytes.subarray(0, start));
		result.set(section, start);
		result.set(bytes.subarray(end), start + section.length);
		return result;
	}
	throw new Error('Verilog Wasm memory is missing');
}

function createVerilogStdin(source, channel, notify) {
	if (!channel) {
		const bytes = new TextEncoder().encode(source || '');
		let offset = 0;
		return () => (offset < bytes.length ? bytes[offset++] : null);
	}
	if (
		channel.protocol !== 'wasm-idle-static-stdin-ring' ||
		channel.protocolVersion !== 2 ||
		channel.controlBytes !== 16 ||
		!Number.isSafeInteger(channel.capacity) ||
		channel.capacity <= 0 ||
		channel.capacity > 2 ** 31 ||
		typeof SharedArrayBuffer !== 'function' ||
		!(channel.buffer instanceof SharedArrayBuffer) ||
		channel.buffer.byteLength !== 16 + channel.capacity
	)
		throw new Error('Invalid Verilog stdin ring');
	const control = new Int32Array(channel.buffer, 0, 4);
	const range = Math.floor(2 ** 32 / channel.capacity) * channel.capacity;
	const bytes = new Uint8Array(channel.buffer, 16, channel.capacity);
	return () => {
		for (;;) {
			if (Atomics.load(control, 3)) throw new Error('Verilog stdin cancelled');
			const write = Atomics.load(control, 0) >>> 0;
			const read = Atomics.load(control, 1) >>> 0;
			const available = (write - read + range) % range;
			if (write >= range || read >= range || available > bytes.length)
				throw new Error('Invalid Verilog stdin counters');
			if (available) {
				const byte = bytes[read % bytes.length];
				Atomics.store(control, 1, (read + 1) % range);
				if (available === 1 || (read + 1) % 4096 === 0) notify();
				return byte;
			}
			if (Atomics.load(control, 2)) return null;
			notify();
			Atomics.wait(control, 0, write, 100);
		}
	};
}

function verilogWorkspacePath(name) {
	if (
		typeof name !== 'string' ||
		name.startsWith('/') ||
		name.includes('\\') ||
		name.split('/').some((part) => !part || part === '.' || part === '..')
	)
		throw new Error('Invalid Verilog workspace path');
	return '/work/' + name;
}

/** MEMFS stores file contents in JavaScript memory; bound file growth separately from Wasm. */
function guardVerilogFilesystem(fs, maxBytes) {
	let violation;
	const usage = (directory = '/') => {
		let total = 0;
		for (const name of fs.readdir(directory)) {
			if (name === '.' || name === '..') continue;
			const file = directory.replace(/\/$/u, '') + '/' + name;
			if (file === '/dev' || file === '/proc') continue;
			const stat = fs.lstat(file);
			if (fs.isDir(stat.mode)) total += usage(file);
			else if (fs.isFile(stat.mode)) total += stat.size;
		}
		return total;
	};
	const check = (actual) => {
		if (actual > maxBytes)
			throw (violation = Object.assign(
				new Error('Verilog filesystem exceeds workspace limit'),
				{
					code: 'resource-limit',
					resource: 'workspace-bytes',
					actual,
					limit: maxBytes
				}
			));
	};
	check(usage());
	const write = fs.write.bind(fs);
	fs.write = (stream, buffer, offset, length, position, ...rest) => {
		if (fs.isFile(stream.node.mode)) {
			const size = fs.stat(stream.path).size;
			const end = (position ?? stream.position) + length;
			check(usage() + Math.max(0, end - size));
		}
		return write(stream, buffer, offset, length, position, ...rest);
	};
	return () => {
		if (violation) throw violation;
	};
}

// Generated distribution prepends verilog-host.mjs and the pinned profile.
const verilogProfile = {"profileId":"icarus-14-c7530db-verisim-ab0ff386-v1","assets":{"ivlpp.js":{"bytes":160083,"sha256":"97d41e9cd11588b7bdbc952873cd71658165e6bd7938c5d39275cedb9ddad405"},"ivlpp.wasm":{"bytes":121092,"sha256":"039bfd9a34d5fb527f1309a680a8361c259bd4d6d4d1e6e91020e28da39487c0"},"ivl.js":{"bytes":66100,"sha256":"a2f56ba8611135d43971053605fb013550dc30d1671e9808a7f82ab02838e915"},"ivl.wasm":{"bytes":1670232,"sha256":"8e909e2d9c7e7ee7a59c25694fa923eae3d60b78993b6e42cc2f53701dc42cea"},"vvp.js":{"bytes":67164,"sha256":"7bb3762198fb5297726bdd0714b4bcc2ac09d99122deefba544d45c6beaebb05"},"vvp.wasm":{"bytes":909906,"sha256":"c38bf14a399b66a226fecc90285f35f465eeb759bf37aee59f6aed9cb7e948bd"}}};
let verilogConsumed = false;

self.onmessage = async ({ data }) => {
	if (data?.run !== true || verilogConsumed) return;
	verilogConsumed = true;
	let phase = 'compile';
	const urls = [];
	try {
		const { runtimePreflight: assets, limits } = data;
		if (
			assets?.protocol !== 'wasm-idle-verilog-preflight' ||
			assets.profileId !== verilogProfile.profileId ||
			typeof data.code !== 'string' ||
			!limits ||
			!Array.isArray(data.workspaceFiles) ||
			!Array.isArray(data.args) ||
			data.args.some((arg) => typeof arg !== 'string')
		)
			throw new Error('Invalid Verilog execution payload');
		for (const name of ['maxOutputBytes', 'maxWorkspaceBytes', 'maxWasmMemoryBytes'])
			if (!Number.isSafeInteger(limits[name]) || limits[name] <= 0)
				throw new Error('Invalid Verilog execution limit');
		let outputBytes = 0;
		const postText = (text, stream = 'stdout') => {
			outputBytes += new TextEncoder().encode(text).length;
			if (outputBytes > limits.maxOutputBytes)
				throw Object.assign(new Error('Verilog output limit exceeded'), {
					code: 'output-limit',
					actual: outputBytes,
					limit: limits.maxOutputBytes
				});
			if (text) self.postMessage({ output: text, stream });
		};
		const diagnostic = (line) => {
			postText(line + '\n', 'stderr');
			const match = line.match(/^\/?work\/(.*?):(\d+):\s*(.*)$/u);
			if (match)
				self.postMessage({
					diagnostic: {
						fileName: match[1],
						lineNumber: Number(match[2]),
						severity: /warning/iu.test(match[3]) ? 'warning' : 'error',
						message: match[3]
					}
				});
		};
		const factories = {};
		for (const name of ['ivlpp', 'ivl', 'vvp']) {
			for (const extension of ['js', 'wasm']) {
				const key = name + (extension === 'js' ? 'JavaScript' : 'Wasm');
				const bytes = assets[key],
					expected = verilogProfile.assets[name + '.' + extension];
				if (!(bytes instanceof Uint8Array) || bytes.length !== expected.bytes)
					throw new Error('Verilog asset length changed: ' + name + '.' + extension);
				const hash = Array.from(
					new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
					(value) => value.toString(16).padStart(2, '0')
				).join('');
				if (hash !== expected.sha256)
					throw new Error('Verilog asset hash changed: ' + name + '.' + extension);
			}
			const url = URL.createObjectURL(
				new Blob([assets[name + 'JavaScript']], { type: 'text/javascript' })
			);
			urls.push(url);
			factories[name] = (await import(url)).default;
		}
		// All three module instances may be live during a run; their combined maxima fit the cap.
		const stageMemoryBytes = Math.floor(limits.maxWasmMemoryBytes / 3);
		const createStage = (name, options) =>
			factories[name]({
				wasmBinary: capVerilogWasmMemory(assets[name + 'Wasm'], stageMemoryBytes),
				noInitialRun: true,
				locateFile: (file) => file,
				...options
			});
		const activePath = verilogWorkspacePath(data.activePath);
		if (!/\.(?:v|sv)$/iu.test(activePath)) throw new Error('Verilog source must use .v or .sv');
		const workspace = new Map(
			data.workspaceFiles.map((file) => [verilogWorkspacePath(file.path), file.content])
		);
		workspace.set(activePath, data.code);
		const populate = (module) => {
			for (const [file, content] of workspace) {
				module.FS.mkdirTree(file.slice(0, file.lastIndexOf('/')));
				module.FS.writeFile(file, content);
			}
			module.FS.chdir('/work');
		};
		self.postMessage({ progress: { percent: 25, stage: 'Preprocessing Verilog' } });
		const preprocessed = [];
		let preprocessedBytes = 0;
		let block = new Uint8Array(4096),
			blockBytes = 0;
		const preprocessor = await createStage('ivlpp', {
			stdout: (byte) => {
				if (byte === null || byte === undefined) return;
				preprocessedBytes += 1;
				if (preprocessedBytes > limits.maxWorkspaceBytes)
					throw Object.assign(
						new Error('Verilog preprocessed source exceeds workspace limit'),
						{
							code: 'resource-limit',
							resource: 'workspace-bytes',
							limit: limits.maxWorkspaceBytes
						}
					);
				block[blockBytes++] = byte;
				if (blockBytes === block.length) {
					preprocessed.push(block);
					block = new Uint8Array(4096);
					blockBytes = 0;
				}
			},
			printErr: diagnostic
		});
		populate(preprocessor);
		const checkPreprocessorFiles = guardVerilogFilesystem(
			preprocessor.FS,
			limits.maxWorkspaceBytes
		);
		const sources = [
			activePath,
			...Array.from(workspace.keys()).filter(
				(file) => file !== activePath && /\.(?:v|sv)$/iu.test(file)
			)
		];
		const preprocessStatus = preprocessor.callMain(['-L', ...sources]);
		checkPreprocessorFiles();
		if (preprocessStatus !== 0) {
			self.postMessage({ results: false });
			return;
		}
		const compiler = await createStage('ivl', { print: diagnostic, printErr: diagnostic });
		const combined = new Uint8Array(preprocessedBytes);
		let offset = 0;
		for (const chunk of preprocessed) {
			combined.set(chunk, offset);
			offset += chunk.length;
		}
		combined.set(block.subarray(0, blockBytes), offset);
		compiler.FS.writeFile('/main.v', combined);
		// vvp loads the statically linked system tasks below; compiler dlopen is not needed.
		compiler.FS.writeFile(
			'/ivl.conf',
			'basedir:/\ngeneration:2012\ngeneration:no-specify\nout:/out.vvp\niwidth:32\nwidthcap:65536\nfunctor:cprop\nfunctor:nodangle\nflag:DLL=vvp.tgt\n'
		);
		self.postMessage({ progress: { percent: 50, stage: 'Compiling Verilog' } });
		const checkCompilerFiles = guardVerilogFilesystem(compiler.FS, limits.maxWorkspaceBytes);
		const compileStatus = compiler.callMain(['-C/ivl.conf', '--', '/main.v']);
		checkCompilerFiles();
		if (compileStatus !== 0) {
			self.postMessage({ results: false });
			return;
		}
		const program = compiler.FS.readFile('/out.vvp');
		if (program.length > limits.maxWorkspaceBytes)
			throw Object.assign(new Error('Verilog simulation exceeds workspace limit'), {
				code: 'resource-limit',
				resource: 'workspace-bytes',
				limit: limits.maxWorkspaceBytes
			});
		const stdin = createVerilogStdin(data.stdin, data.stdinChannel, () =>
			self.postMessage({ type: 'stdin-request' })
		);
		const createSink = (stream) => {
			const decoder = new TextDecoder();
			let pending = [];
			const flush = (final = false) => {
				postText(decoder.decode(Uint8Array.from(pending), { stream: !final }), stream);
				pending = [];
			};
			return {
				flush,
				write(byte) {
					if (byte === null || byte === undefined) {
						flush();
						return;
					}
					pending.push(byte);
					if (byte === 10 || pending.length >= 4096) flush();
				}
			};
		};
		const stdout = createSink('stdout'),
			stderr = createSink('stderr');
		const runtime = await createStage('vvp', {
			stdin,
			stdout: stdout.write,
			stderr: stderr.write,
			print: (line) => postText(line + '\n'),
			printErr: (line) => postText(line + '\n', 'stderr')
		});
		populate(runtime);
		runtime.FS.writeFile('/sim.vvp', program);
		const checkRuntimeFiles = guardVerilogFilesystem(runtime.FS, limits.maxWorkspaceBytes);
		phase = 'execute';
		self.postMessage({ type: 'execution-ready' });
		let status;
		try {
			status = runtime.callMain(['-i', '-n', '-msystem', '/sim.vvp', ...data.args]);
		} finally {
			stdout.flush(true);
			stderr.flush(true);
		}
		checkRuntimeFiles();
		self.postMessage({ results: status === 0 });
	} catch (error) {
		const message = String(error?.message || error);
		const code =
			error?.code ||
			(/out of memory|Cannot enlarge memory|memory limit/iu.test(message)
				? 'resource-limit'
				: phase === 'compile'
					? 'compile'
					: 'runtime');
		self.postMessage({
			error: message,
			failure: {
				name: error?.name || 'Error',
				message,
				code,
				phase,
				runtimeId: 'VERILOG',
				...(code === 'output-limit' ? { actual: error.actual, limit: error.limit } : {}),
				...(code === 'resource-limit'
					? {
							...(error?.resource === 'workspace-bytes'
								? {}
								: { resource: 'wasm-memory' }),
							limit: error?.limit || data.limits?.maxWasmMemoryBytes
						}
					: {})
			}
		});
	} finally {
		for (const url of urls) URL.revokeObjectURL(url);
		self.close();
	}
};
self.postMessage({ __wasmIdleStaticWorkerReady: true });
