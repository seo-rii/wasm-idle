import { ProtocolError } from '@wasm-idle/core';

const strictDecoder = new TextDecoder('utf-8', { fatal: true });
const pythonPackageAssetPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]*\.(?:whl|tar|zip)$/u;
const MAX_PYTHON_PACKAGE_ASSETS = 4096;
const MAX_PYTHON_PACKAGE_ASSET_NAME_LENGTH = 1024;

export interface ParsedPythonPackageLock {
	lock: Record<string, unknown>;
	packageAssets: Set<string>;
}

export function parsePythonPackageLock(bytes: Uint8Array): ParsedPythonPackageLock {
	let lock: unknown;
	try {
		lock = JSON.parse(strictDecoder.decode(bytes));
	} catch {
		throw new ProtocolError('Python runtime lock file is not valid UTF-8 JSON', {
			phase: 'asset',
			runtimeId: 'python'
		});
	}
	if (
		typeof lock !== 'object' ||
		lock === null ||
		!('packages' in lock) ||
		typeof lock.packages !== 'object' ||
		lock.packages === null ||
		Array.isArray(lock.packages)
	) {
		throw new ProtocolError('Python runtime lock file has an invalid packages map', {
			phase: 'asset',
			runtimeId: 'python'
		});
	}

	const entries = Object.values(lock.packages);
	if (entries.length > MAX_PYTHON_PACKAGE_ASSETS) {
		throw new ProtocolError('Python runtime lock file has too many package assets', {
			phase: 'asset',
			runtimeId: 'python'
		});
	}

	const packageAssets = new Set<string>();
	for (const entry of entries) {
		if (typeof entry !== 'object' || entry === null || !('file_name' in entry)) {
			throw new ProtocolError('Python runtime lock file has an invalid package entry', {
				phase: 'asset',
				runtimeId: 'python'
			});
		}
		const asset = entry.file_name;
		if (
			typeof asset !== 'string' ||
			asset.length > MAX_PYTHON_PACKAGE_ASSET_NAME_LENGTH ||
			!pythonPackageAssetPattern.test(asset)
		) {
			throw new ProtocolError('Python runtime lock file has an unsafe package asset name', {
				phase: 'asset',
				runtimeId: 'python'
			});
		}
		packageAssets.add(asset);
	}
	return { lock: lock as Record<string, unknown>, packageAssets };
}

export const readPythonPackageAssets = (bytes: Uint8Array) =>
	parsePythonPackageLock(bytes).packageAssets;
