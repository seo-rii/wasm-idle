// Diagnostic-only instrumentation for the pinned G0 assets. Not a container API.
// No import behavior, return value, exception, guest memory, or shell string changes.
export function installSyscallTrace(emit) {
	const OriginalInstance = WebAssembly.Instance;
	let nextInstance = 1;
	let events = 0;
	const record = (entry) => {
		if (events++ < 1000)
			emit({ type: 'g0Syscall', worker: globalThis.name ?? 'root', ...entry });
	};
	const decoder = new TextDecoder('utf-8', { fatal: true });
	WebAssembly.Instance = new Proxy(OriginalInstance, {
		construct(target, [module, imports], newTarget) {
			const descriptors = WebAssembly.Module.imports(module);
			if (
				!descriptors.some(({ module }) =>
					['wasix_32v1', 'wasi_snapshot_preview1'].includes(module)
				)
			)
				return Reflect.construct(target, [module, imports], newTarget);
			const id = nextInstance++;
			let memory;
			for (const { module: namespace, name, kind } of descriptors)
				if (kind === 'memory') memory = imports[namespace][name];
			const bytes = (offset, length) => {
				offset >>>= 0;
				length >>>= 0;
				if (!memory || length > 4096 || offset > memory.buffer.byteLength - length)
					return { unavailable: true, offset, length };
				return Array.from(new Uint8Array(memory.buffer, offset, length));
			};
			const text = (offset, length) => {
				const raw = bytes(offset, length);
				if (!Array.isArray(raw)) return raw;
				try {
					return { bytes: raw, text: decoder.decode(new Uint8Array(raw)) };
				} catch {
					return { bytes: raw, invalidUtf8: true };
				}
			};
			const bound = { ...imports };
			for (const namespace of ['wasix_32v1', 'wasi_snapshot_preview1']) {
				if (!imports[namespace]) continue;
				bound[namespace] = { ...imports[namespace] };
				for (const [name, original] of Object.entries(imports[namespace])) {
					if (!/^proc_(exec\d*|spawn\d*|fork|join|exit)$/.test(name)) continue;
					bound[namespace][name] = (...args) => {
						const entry = { id, namespace, name, args, phase: 'call' };
						if (/^proc_(exec|spawn)/.test(name)) {
							entry.program = text(args[0], args[1]);
							entry.argv = text(args[2], args[3]);
							if (args.length >= 6 && args[4] !== 0)
								entry.env = text(args[4], args[5]);
						}
						if (name === 'proc_join') entry.pid = bytes(args[0], 8);
						record(entry);
						try {
							const value = original(...args);
							record({
								id,
								namespace,
								name,
								phase: 'return',
								value,
								...(name === 'proc_join'
									? { pid: bytes(args[0], 8), status: bytes(args[2], 16) }
									: {})
							});
							return value;
						} catch (error) {
							record({ id, namespace, name, phase: 'throw', error: String(error) });
							throw error;
						}
					};
				}
			}
			const instance = Reflect.construct(target, [module, bound], newTarget);
			memory ??= instance.exports.memory;
			record({
				id,
				phase: 'instance',
				imports: descriptors.filter(({ kind }) => kind === 'function')
			});
			return instance;
		}
	});
}
