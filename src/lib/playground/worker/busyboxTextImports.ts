import { wasi } from '@bjorn3/browser_wasi_shim';

/**
 * The pinned BusyBox libc calls this import before main to initialize its real cwd.
 * This interpreter mounts its private source snapshot at /. Stored permission bits
 * are not available in browser_wasi_shim; metadata requests fail explicitly.
 */
export function createBusyboxTextImports(memory: () => WebAssembly.Memory | undefined) {
	return {
		wasm_idle_process_v1: {
			initial_cwd(pointer: number, capacity: number) {
				const bytes = memory()?.buffer;
				const start = pointer >>> 0;
				const size = capacity >>> 0;
				if (
					!bytes ||
					size < 2 ||
					start > bytes.byteLength ||
					size > bytes.byteLength - start
				) {
					return -1;
				}
				new Uint8Array(bytes, start, 2).set([47, 0]);
				return 2;
			}
		},
		wasm_idle_fs_v1: {
			path_mode: () => -wasi.ERRNO_NOTSUP,
			fd_mode: () => -wasi.ERRNO_NOTSUP
		}
	};
}
