import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import {
	configureWorkerRuntimeAssets,
	handleWorkerAssetMessage
} from '$lib/playground/worker/assets';
import { installObjectiveCWorker } from '@wasm-idle/llvm-core/objective-c';

declare const self: unknown;

installObjectiveCWorker(self as any, {
	configureRuntimeAssets: configureWorkerRuntimeAssets,
	handleAssetMessage: handleWorkerAssetMessage,
	waitForStdin: waitForBufferedStdin
});
