import fs from './fs.js';
export const {
	readFile,
	writeFile,
	mkdir,
	readdir,
	stat,
	lstat,
	realpath,
	unlink,
	rm,
	open,
	access
} = fs.promises;
export default fs.promises;
