import { EventEmitter } from 'events';
export { Buffer } from 'buffer/';
export const process = Object.assign(new EventEmitter(), {
	env: {},
	platform: 'linux',
	arch: 'wasm32',
	pid: 1,
	versions: { node: '22.0.0' },
	version: 'v22.0.0',
	argv: ['node', '/rescript/server/out/cli.js', '--node-ipc'],
	cwd: () => '/workspace',
	nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
	send: () => {
		throw Error('ReScript transport is not connected');
	},
	exit: (code) => {
		throw Object.assign(Error('ReScript server exit'), { exitCode: code });
	}
});
export default process;
