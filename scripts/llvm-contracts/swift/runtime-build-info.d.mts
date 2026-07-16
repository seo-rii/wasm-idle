export function swiftBaselineReceiptSnapshotFile(preset: any): string;
export function createSwiftRuntimeBuildInfo({
	swiftVersion,
	wasmSdkId,
	wasmSdkUrl,
	wasmSdkChecksum,
	source,
	notes
}: {
	swiftVersion: any;
	wasmSdkId: any;
	wasmSdkUrl: any;
	wasmSdkChecksum: any;
	source: any;
	notes: any;
}): {
	notes?: any;
	source?: any;
	runnerWorker: string;
	compilerWasm: string;
	packageManagerWasm: string;
	sdkArchive: string;
	runtimeContract: {
		format: string;
		version: number;
	};
	wasmSdkChecksum?: any;
	wasmSdkUrl?: any;
	format: string;
	swiftVersion: any;
	wasmSdkId: any;
};
export function validateSwiftRuntimeBuildInfo(buildInfo: any): string[];
export function validateSwiftRuntimeSdkChecksum(
	buildInfo: any,
	{
		bundleDir,
		messagePrefix
	}?: {
		bundleDir?: any;
		messagePrefix?: string | undefined;
	}
): Promise<string[]>;
export const SWIFT_RUNTIME_BUILD_FORMAT: 'wasm-swift-runtime-build-v1';
export namespace EXPECTED_BUILD_FILES {
	let runnerWorker: string;
	let compilerWasm: string;
	let packageManagerWasm: string;
	let sdkArchive: string;
}
export const BUILD_PLAN_SNAPSHOT_FILE: 'build-plan.snapshot.json';
export const WORKFLOW_PREFLIGHT_RECEIPT_SNAPSHOT_FILE: 'workflow-preflight.snapshot.json';
export const SOURCE_BOOTSTRAP_RECEIPT_SNAPSHOT_FILE: 'source-bootstrap.snapshot.json';
export const BROWSER_BUILD_LOG_SNAPSHOT_FILE: 'browser-build.snapshot.log';
export namespace EXPECTED_RUNTIME_CONTRACT {
	export { SWIFT_RUNTIME_CONTRACT_FORMAT as format };
	export { SWIFT_RUNTIME_CONTRACT_VERSION as version };
}
import { SWIFT_RUNTIME_CONTRACT_FORMAT } from './runtime-contract.mjs';
import { SWIFT_RUNTIME_CONTRACT_VERSION } from './runtime-contract.mjs';
