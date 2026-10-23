import {
	createContainerPlaygroundBinding as createSharedContainerPlaygroundBinding,
	type ContainerPlaygroundBindingOptions
} from '../../container/binding';
import type { SandboxRuntimeAssets } from '../sandbox';

export type { ContainerPlaygroundBinding } from '../../container/binding';

export function createContainerPlaygroundBinding(
	runtimeAssets: SandboxRuntimeAssets,
	options: ContainerPlaygroundBindingOptions
) {
	return createSharedContainerPlaygroundBinding(runtimeAssets, {
		...options,
		workerFactory:
			options.workerFactory ??
			(() =>
				new Worker(new URL('./owner.worker.ts', import.meta.url), {
					type: 'module',
					name: 'wasm-idle-container-owner'
				}))
	});
}
