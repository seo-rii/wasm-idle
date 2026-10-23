import {
	createContainerWorkerClient as createSharedContainerWorkerClient,
	type ContainerWorkerClientOptions
} from '../../container/client';

export type { ContainerWorkerClient } from '../../container/client';

export function createContainerWorkerClient(
	options: Omit<ContainerWorkerClientOptions, 'workerFactory'> &
		Pick<Partial<ContainerWorkerClientOptions>, 'workerFactory'>
) {
	return createSharedContainerWorkerClient({
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
