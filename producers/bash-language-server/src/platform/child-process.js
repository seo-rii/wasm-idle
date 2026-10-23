function unavailable() {
	throw Object.assign(new Error('External processes are unavailable in the browser Bash LSP'), {
		code: 'ENOSYS'
	});
}
export const spawn = unavailable;
export const execFile = unavailable;
export const exec = unavailable;
export const execSync = unavailable;
export const spawnSync = () => ({
	status: 127,
	stdout: new Uint8Array(),
	stderr: new Uint8Array()
});
