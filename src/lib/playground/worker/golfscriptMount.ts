/** Readonly GolfScript workspace/runtime directories, including opened nested descriptors. */
export function createReadonlyGolfscriptMount(shim: any, contents: Map<string, any>) {
	const { wasi } = shim;
	const readOnly = wasi.ERRNO_ROFS;
	const writeRights = [
		wasi.RIGHTS_FD_WRITE,
		wasi.RIGHTS_FD_ALLOCATE,
		wasi.RIGHTS_FD_FILESTAT_SET_SIZE,
		wasi.RIGHTS_FD_FILESTAT_SET_TIMES
	].reduce((rights, right) => rights | BigInt(right), 0n);
	const wantsWrite = (oflags: number, rights: bigint, fdFlags: number) =>
		Boolean(oflags & (wasi.OFLAGS_CREAT | wasi.OFLAGS_TRUNC)) ||
		Boolean(fdFlags & wasi.FDFLAGS_APPEND) ||
		Boolean(rights & writeRights);

	class ReadonlyOpenDirectory extends shim.OpenDirectory {
		constructor(directory: any) {
			super(directory);
		}
		path_open(
			dirflags: number,
			path: string,
			oflags: number,
			rights: bigint,
			inheriting: bigint,
			fdFlags: number
		) {
			if (wantsWrite(oflags, rights | inheriting, fdFlags)) {
				return { ret: readOnly, fd_obj: null };
			}
			return super.path_open(dirflags, path, oflags, rights, inheriting, fdFlags);
		}
		path_create_directory() {
			return readOnly;
		}
		path_link() {
			return readOnly;
		}
		path_unlink() {
			return { ret: readOnly, inode_obj: null };
		}
		path_unlink_file() {
			return readOnly;
		}
		path_remove_directory() {
			return readOnly;
		}
		path_rename() {
			return readOnly;
		}
		path_filestat_set_times() {
			return readOnly;
		}
	}

	class ReadonlyDirectory extends shim.Directory {
		constructor(entries: Map<string, any>) {
			super(entries);
		}
		path_open(oflags: number, rights: bigint, fdFlags: number) {
			if (wantsWrite(oflags, rights, fdFlags)) return { ret: readOnly, fd_obj: null };
			return { ret: wasi.ERRNO_SUCCESS, fd_obj: new ReadonlyOpenDirectory(this) };
		}
	}

	// Keep verified stdlib file views and live maps; only directory adapters change.
	const protectDirectories = (entries: Map<string, any>) => {
		for (const [name, entry] of entries) {
			if (!(entry instanceof shim.Directory)) continue;
			protectDirectories(entry.contents);
			entries.set(name, new ReadonlyDirectory(entry.contents));
		}
	};
	protectDirectories(contents);

	class ReadonlyRootPreopen extends ReadonlyOpenDirectory {
		readonly prestat_name = '/';
		constructor() {
			super(new ReadonlyDirectory(contents));
		}
		fd_prestat_get() {
			return { ret: wasi.ERRNO_SUCCESS, prestat: wasi.Prestat.dir(this.prestat_name) };
		}
	}
	return {
		preopen: new ReadonlyRootPreopen(),
		createDirectory: (entries: Map<string, any>) => new ReadonlyDirectory(entries)
	};
}
