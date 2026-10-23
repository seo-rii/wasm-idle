import { Volume, createFsFromVolume } from 'memfs';
export const volume = new Volume();
export const fs = createFsFromVolume(volume);
fs.opendirSync = (name) => {
	const entries = fs.readdirSync(name, { withFileTypes: true });
	let offset = 0,
		closed = false;
	const check = () => {
		if (closed)
			throw Object.assign(Error('Directory is closed'), {
				code: 'EBADF',
				errno: -9,
				syscall: 'readdir',
				path: name
			});
	};
	return {
		path: name,
		readSync() {
			check();
			return entries[offset++] || null;
		},
		closeSync() {
			check();
			closed = true;
		}
	};
};
// Node 20's FileHandle.readLines is used only to read upstream build.ninja.
const open = fs.promises.open.bind(fs.promises);
fs.promises.open = async (...args) => {
	const handle = await open(...args);
	handle.readLines = async function* () {
		const text = await handle.readFile({ encoding: 'utf8' });
		for (const line of text.split(/\r?\n/)) yield line;
	};
	return handle;
};
export const promises = fs.promises;
export const {
	existsSync,
	readFileSync,
	writeFileSync,
	mkdirSync,
	readdirSync,
	statSync,
	lstatSync,
	realpathSync,
	unlinkSync,
	readFile,
	writeFile,
	mkdir,
	readdir,
	stat,
	lstat,
	realpath,
	unlink,
	rm,
	rmSync,
	watch,
	watchFile,
	unwatchFile,
	access,
	accessSync,
	constants,
	readSync,
	writeSync,
	openSync,
	closeSync,
	fstatSync,
	fsyncSync,
	ftruncateSync,
	truncateSync,
	rmdirSync,
	renameSync,
	utimesSync,
	readlinkSync,
	symlinkSync,
	opendirSync
} = fs;
export default fs;
