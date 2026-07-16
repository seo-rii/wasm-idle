#!/usr/bin/env node
export function createSwiftRuntimeManifest({
	files,
	swiftVersion,
	wasmSdkId,
	fingerprint
}: {
	files: any;
	swiftVersion: any;
	wasmSdkId: any;
	fingerprint: any;
}): {
	format: string;
	runtime: string;
	swiftVersion: any;
	wasmSdkId: any;
	runtimeContract: {
		format: string;
		version: number;
	};
	fingerprint: any;
	files: any;
};
export function hashFile(filePath: any): Promise<{
	bytes: any;
	sha256: string;
}>;
export function hashBytes(bytes: any): {
	bytes: any;
	sha256: string;
};
export function validateSwiftWasmModuleBytes(bytes: any, label: any): Promise<string[]>;
export function validateSwiftCompilerWasmModuleBytes(bytes: any, label: any): Promise<string[]>;
export function validateSwiftSdkArchiveBytes(bytes: any, label?: string): string[];
export function buildFileEntries(
	baseDir: any,
	files?: string[]
): Promise<
	{
		path: string;
		bytes: any;
		sha256: string;
	}[]
>;
export function fingerprintFileEntries(entries: any): string;
export function validateSwiftRuntimeFileSignatures(baseDir: any): Promise<string[]>;
export function validateSwiftRuntimeManifest(manifest: any): string[];
export function validateSwiftRuntimeManifestFiles(baseDir: any, manifest: any): Promise<string[]>;
export function validateSwiftRunnerWorkerSource(source: any): string[];
export const SWIFT_RUNTIME_MANIFEST_FORMAT: 'wasm-swift-runtime-manifest-v1';
export namespace EXPECTED_MANIFEST_RUNTIME_CONTRACT {
	export { SWIFT_RUNTIME_CONTRACT_FORMAT as format };
	export { SWIFT_RUNTIME_CONTRACT_VERSION as version };
}
export const REQUIRED_RUNTIME_FILES: string[];
export const RUNNER_WORKER_REQUIRED_INPUT_FIELDS: string[];
export const RUNNER_WORKER_REQUIRED_OUTPUT_FIELDS: string[];
export const RUNNER_WORKER_REQUIRED_ASSET_REFERENCES: string[];
import { SWIFT_RUNTIME_CONTRACT_FORMAT } from './runtime-contract.mjs';
import { SWIFT_RUNTIME_CONTRACT_VERSION } from './runtime-contract.mjs';
