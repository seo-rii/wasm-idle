import browserProcess from 'process/browser.js';
export { Buffer } from 'buffer/';

export const process = {
	...browserProcess,
	env: { PATH: '/bin', SHELLCHECK_PATH: '', SHFMT_PATH: '', BASH_IDE_LOG_LEVEL: 'error' },
	// Node filesystem polyfills inspect the version for Dirent support. Renderer keeps
	// Emscripten on its browser transport rather than its native Node loader.
	platform: 'linux',
	version: 'v22.0.0',
	versions: { node: '22.0.0' },
	type: 'renderer',
	cwd: () => '/workspace'
};
