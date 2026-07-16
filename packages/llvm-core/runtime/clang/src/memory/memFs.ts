import CoreMemFS, { type MemFsOptions as CoreMemFsOptions } from '../../../core/src/memfs.js';
import type { ProgressSink } from '../types.js';
import { memfsUrl } from '../url.js';

export interface MemFsOptions extends Omit<CoreMemFsOptions, 'moduleUrl' | 'progress'> {
	path: string;
	memfsModuleUrl?: string;
	progress?: ProgressSink;
}

export default class MemFS extends CoreMemFS {
	constructor(options: MemFsOptions) {
		const { memfsModuleUrl, path, ...coreOptions } = options;
		super({
			...coreOptions,
			moduleUrl: memfsModuleUrl || memfsUrl(path)
		});
	}
}
