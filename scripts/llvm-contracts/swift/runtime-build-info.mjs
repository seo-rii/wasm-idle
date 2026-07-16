import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
	SWIFT_RUNTIME_CONTRACT_FORMAT,
	SWIFT_RUNTIME_CONTRACT_VERSION
} from './runtime-contract.mjs';

export const SWIFT_RUNTIME_BUILD_FORMAT = 'wasm-swift-runtime-build-v1';

export const EXPECTED_BUILD_FILES = {
	runnerWorker: 'runner-worker.js',
	compilerWasm: 'swiftc.wasm',
	packageManagerWasm: 'swiftpm.wasm',
	sdkArchive: 'sdk.tar.gz'
};
export const BUILD_PLAN_SNAPSHOT_FILE = 'build-plan.snapshot.json';
export const WORKFLOW_PREFLIGHT_RECEIPT_SNAPSHOT_FILE = 'workflow-preflight.snapshot.json';
export const SOURCE_BOOTSTRAP_RECEIPT_SNAPSHOT_FILE = 'source-bootstrap.snapshot.json';
export const BROWSER_BUILD_LOG_SNAPSHOT_FILE = 'browser-build.snapshot.log';
export const EXPECTED_RUNTIME_CONTRACT = {
	format: SWIFT_RUNTIME_CONTRACT_FORMAT,
	version: SWIFT_RUNTIME_CONTRACT_VERSION
};

export function swiftBaselineReceiptSnapshotFile(preset) {
	if (typeof preset !== 'string' || !/^[A-Za-z0-9._+-]+$/u.test(preset)) {
		throw new Error('Swift baseline receipt preset must be a safe string');
	}
	return `upstream-baseline-${preset}.snapshot.json`;
}

export function createSwiftRuntimeBuildInfo({
	swiftVersion,
	wasmSdkId,
	wasmSdkUrl,
	wasmSdkChecksum,
	source,
	notes
}) {
	return {
		format: SWIFT_RUNTIME_BUILD_FORMAT,
		swiftVersion,
		wasmSdkId,
		...(wasmSdkUrl ? { wasmSdkUrl } : {}),
		...(wasmSdkChecksum ? { wasmSdkChecksum } : {}),
		runtimeContract: EXPECTED_RUNTIME_CONTRACT,
		...EXPECTED_BUILD_FILES,
		...(source ? { source } : {}),
		...(notes ? { notes } : {})
	};
}

export function validateSwiftRuntimeBuildInfo(buildInfo) {
	const errors = [];
	if (!buildInfo || typeof buildInfo !== 'object' || Array.isArray(buildInfo)) {
		return ['runtime-build.json must contain a JSON object'];
	}
	if (buildInfo.format !== SWIFT_RUNTIME_BUILD_FORMAT) {
		errors.push(`format must be ${SWIFT_RUNTIME_BUILD_FORMAT}`);
	}
	if (
		typeof buildInfo.swiftVersion !== 'string' ||
		!/^\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/u.test(buildInfo.swiftVersion)
	) {
		errors.push('swiftVersion must be a Swift release version string such as 6.3.3');
	}
	if (
		typeof buildInfo.wasmSdkId !== 'string' ||
		!/^[A-Za-z0-9._+-]+_wasm$/u.test(buildInfo.wasmSdkId)
	) {
		errors.push('wasmSdkId must name a Swift Wasm SDK ending in _wasm');
	}
	for (const [field, expectedPath] of Object.entries(EXPECTED_BUILD_FILES)) {
		if (buildInfo[field] !== expectedPath) {
			errors.push(`${field} must be ${expectedPath}`);
		}
	}
	if (
		!buildInfo.runtimeContract ||
		typeof buildInfo.runtimeContract !== 'object' ||
		Array.isArray(buildInfo.runtimeContract)
	) {
		errors.push('runtimeContract must describe the Swift browser runtime contract');
	} else {
		if (buildInfo.runtimeContract.format !== EXPECTED_RUNTIME_CONTRACT.format) {
			errors.push(`runtimeContract.format must be ${EXPECTED_RUNTIME_CONTRACT.format}`);
		}
		if (buildInfo.runtimeContract.version !== EXPECTED_RUNTIME_CONTRACT.version) {
			errors.push(`runtimeContract.version must be ${EXPECTED_RUNTIME_CONTRACT.version}`);
		}
	}
	if ('source' in buildInfo && typeof buildInfo.source !== 'string') {
		errors.push('source must be a string when provided');
	}
	if ('wasmSdkUrl' in buildInfo !== 'wasmSdkChecksum' in buildInfo) {
		errors.push('wasmSdkUrl and wasmSdkChecksum must be provided together');
	}
	if (
		'wasmSdkUrl' in buildInfo &&
		(typeof buildInfo.wasmSdkUrl !== 'string' ||
			!/^https:\/\/download\.swift\.org\/.+\.artifactbundle\.tar\.gz$/u.test(
				buildInfo.wasmSdkUrl
			))
	) {
		errors.push('wasmSdkUrl must be a Swift.org artifact bundle HTTPS URL when provided');
	}
	if (
		'wasmSdkChecksum' in buildInfo &&
		(typeof buildInfo.wasmSdkChecksum !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(buildInfo.wasmSdkChecksum))
	) {
		errors.push('wasmSdkChecksum must be a lowercase sha256 hex digest when provided');
	}
	if (
		typeof buildInfo.wasmSdkUrl === 'string' &&
		typeof buildInfo.wasmSdkId === 'string' &&
		!buildInfo.wasmSdkUrl.endsWith(`/${buildInfo.wasmSdkId}.artifactbundle.tar.gz`)
	) {
		errors.push('wasmSdkUrl artifact name must match wasmSdkId');
	}
	if ('notes' in buildInfo && typeof buildInfo.notes !== 'string') {
		errors.push('notes must be a string when provided');
	}
	return errors;
}

export async function validateSwiftRuntimeSdkChecksum(
	buildInfo,
	{ bundleDir, messagePrefix = 'runtime-build.json ' } = {}
) {
	const errors = [];
	if (typeof buildInfo?.wasmSdkChecksum !== 'string') return errors;
	if (typeof bundleDir !== 'string' || !bundleDir.trim()) {
		return [`${messagePrefix}wasmSdkChecksum bundleDir is required for verification`];
	}
	const sdkArchivePath = path.join(bundleDir, 'sdk.tar.gz');
	const sdkArchiveBytes = await readFile(sdkArchivePath).catch((error) => {
		errors.push(
			`${messagePrefix}wasmSdkChecksum could not be verified because sdk.tar.gz could not be read from ${sdkArchivePath}: ${error.message}`
		);
		return null;
	});
	if (!sdkArchiveBytes) return errors;
	const actualSdkDigest = createHash('sha256').update(sdkArchiveBytes).digest('hex');
	if (actualSdkDigest !== buildInfo.wasmSdkChecksum) {
		errors.push(
			`${messagePrefix}wasmSdkChecksum ${buildInfo.wasmSdkChecksum} does not match sdk.tar.gz sha256 ${actualSdkDigest}`
		);
	}
	return errors;
}
