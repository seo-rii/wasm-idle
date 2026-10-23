export const homedir = () => '/workspace';
export const tmpdir = () => '/tmp';
export const platform = () => 'linux';
export const type = () => 'Browser';
export const cpus = () => [
	{ model: 'Browser worker', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }
];
export const availableParallelism = () => 1;
export const EOL = '\n';
