import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import {
	configureWorkerRuntimeAssets,
	handleWorkerAssetMessage
} from '$lib/playground/worker/assets';
import { installObjectiveCWorker } from '@seo-rii/wasm-llvm/runtime/objective-c';

declare const self: DedicatedWorkerGlobalScope;

installObjectiveCWorker(self as any, {
	configureRuntimeAssets: configureWorkerRuntimeAssets,
	handleAssetMessage: handleWorkerAssetMessage,
	waitForStdin: waitForBufferedStdin
});
