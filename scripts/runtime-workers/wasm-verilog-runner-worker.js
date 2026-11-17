// Generated distribution prepends verilog-host.mjs and the pinned profile.
const verilogProfile = __WASM_IDLE_VERILOG_PROFILE__;
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
