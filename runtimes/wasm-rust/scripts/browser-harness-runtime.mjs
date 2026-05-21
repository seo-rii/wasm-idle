import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function parseTargetTripleList(value) {
	return [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))];
}

export async function resolveHarnessTargetTriples(projectRoot, env = process.env) {
	if (env.WASM_RUST_BROWSER_HARNESS_TARGET_TRIPLES) {
		return parseTargetTripleList(env.WASM_RUST_BROWSER_HARNESS_TARGET_TRIPLES);
	}
	const manifestPaths = [
		path.join(projectRoot, 'dist', 'runtime', 'runtime-manifest.v3.json'),
		path.join(projectRoot, 'dist', 'runtime', 'runtime-manifest.v2.json')
	];
	for (const manifestPath of manifestPaths) {
		try {
			const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
			const targets = Object.keys(manifest.targets || {});
			if (targets.length > 0) {
				return targets;
			}
		} catch {}
	}
	const legacyManifest = JSON.parse(
		await fs.readFile(path.join(projectRoot, 'dist', 'runtime', 'runtime-manifest.json'), 'utf8')
	);
	return [legacyManifest.targetTriple || 'wasm32-wasip1'];
}

export async function resolveChromiumExecutable(
	env = process.env,
	homeDirectory = os.homedir()
) {
	if (env.WASM_RUST_CHROMIUM_EXECUTABLE) {
		return env.WASM_RUST_CHROMIUM_EXECUTABLE;
	}
	const cacheRoot = path.join(homeDirectory, '.cache', 'ms-playwright');
	const entries = await fs.readdir(cacheRoot, { withFileTypes: true });
	const chromiumFolder = entries
		.filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium-'))
		.map((entry) => entry.name)
		.sort()
		.at(-1);
	if (!chromiumFolder) {
		throw new Error('failed to locate a cached Chromium build under ~/.cache/ms-playwright');
	}
	return path.join(cacheRoot, chromiumFolder, 'chrome-linux64', 'chrome');
}

export function isBrowserHarnessTargetSuccessful(targetResult, expectedStdout) {
	if (
		!targetResult.ok ||
		!targetResult.result?.compile?.success ||
		targetResult.result?.runtime?.exitCode !== 0
	) {
		return false;
	}
	if (expectedStdout === undefined) {
		return true;
	}
	return targetResult.result?.runtime?.stdout === expectedStdout;
}

export function isBrowserHarnessProbeSuccessful(targetResults, expectedStdout) {
	return (
		targetResults.length > 0 &&
		targetResults.every((targetResult) =>
			isBrowserHarnessTargetSuccessful(targetResult, expectedStdout)
		)
	);
}
