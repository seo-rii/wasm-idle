declare module '@bjorn3/browser_wasi_shim/dist/fd.js' {
	export class Fd {}
	export class Inode {
		ino: bigint;
		static issue_ino(): bigint;
		static root_ino(): bigint;
	}
}

declare module '@bjorn3/browser_wasi_shim/dist/fs_mem.js' {
	import { Fd } from '@bjorn3/browser_wasi_shim/dist/fd.js';

	export class PreopenDirectory extends Fd {
		constructor(name: string, contents: Map<string, unknown> | Array<[string, unknown]>);
	}
}

declare module '@bjorn3/browser_wasi_shim/dist/wasi.js' {
	export default class WASI {
		constructor(args: string[], env: string[], fds: unknown[], options?: { debug?: boolean });
		wasiImport: WebAssembly.ModuleImports;
		start(instance: {
			exports: {
				memory: WebAssembly.Memory;
				_start: () => unknown;
			};
		}): number | null;
	}
}

declare module '@bjorn3/browser_wasi_shim/dist/wasi_defs.js' {
	export const ERRNO_SUCCESS: number;
	export const FILETYPE_CHARACTER_DEVICE: number;
	export const RIGHTS_FD_READ: number;
	export const RIGHTS_FD_WRITE: number;

	export class Filestat {
		constructor(ino: bigint, filetype: number, size: bigint);
	}

	export class Fdstat {
		constructor(filetype: number, flags: number);
		fs_rights_base: bigint;
	}
}
