import { Directory, File, OpenFile, PreopenDirectory, WASI } from '@bjorn3/browser_wasi_shim';

import { resolveVersionedAssetUrl } from './asset-url.js';
import {
	fetchRuntimeAssetBytes,
	loadRuntimePackEntries
} from './runtime-asset.js';
import {
	CaptureFd,
	ensureGuestDirectory,
	normalizeGuestPath,
	readGuestFile,
	toStandaloneBytes,
	writeGuestFile
} from './wasi-guest.js';
import type {
	BrowserGoBuildPlan,
	BrowserGoToolInvocation,
	BrowserGoToolResult,
	BrowserGoWorkspaceFile
} from './types.js';

async function loadSysrootFiles(
	plan: BrowserGoBuildPlan,
	runtimeBaseUrl: string | URL,
	fetchImpl: typeof fetch,
	reportAssetProgress?: (asset: string, loaded: number, total?: number) => void
) {
	if (plan.sysrootPack) {
		return await loadRuntimePackEntries(runtimeBaseUrl, plan.sysrootPack, fetchImpl, {
			index: (loaded, total) =>
				reportAssetProgress?.(plan.sysrootPack!.index, loaded, total),
			asset: (loaded, total) =>
				reportAssetProgress?.(plan.sysrootPack!.asset, loaded, total)
		});
	}
	return await Promise.all(
		(plan.sysrootFiles || []).map(async (entry) => ({
			runtimePath: entry.runtimePath,
			bytes: await fetchRuntimeAssetBytes(
				resolveVersionedAssetUrl(runtimeBaseUrl, entry.asset),
				`sysroot asset ${entry.runtimePath}`,
				fetchImpl,
				true,
				(loaded, total) => reportAssetProgress?.(entry.asset, loaded, total)
			)
		}))
	);
}

function collectInputFiles(
	invocation: BrowserGoToolInvocation,
	plan: BrowserGoBuildPlan
) {
	const files: BrowserGoWorkspaceFile[] = [...invocation.inputFiles];
	if (invocation.tool === 'link' && plan.link) {
		const compileOutput = plan.compile.outputPath;
		if (!files.some((file) => file.path === compileOutput)) {
			throw new Error(`missing compile output ${compileOutput} for link invocation`);
		}
	}
	return files;
}

export async function executeGoToolInvocation(
	invocation: BrowserGoToolInvocation,
	plan: BrowserGoBuildPlan,
	runtimeBaseUrl: string | URL,
	fetchImpl: typeof fetch = fetch,
	reportAssetProgress?: (asset: string, loaded: number, total?: number) => void
): Promise<BrowserGoToolResult> {
	const root = new Directory(new Map());
	ensureGuestDirectory(root, '/tmp');
	for (const entry of await loadSysrootFiles(plan, runtimeBaseUrl, fetchImpl, reportAssetProgress)) {
		writeGuestFile(root, entry.runtimePath, entry.bytes, true);
	}
	for (const file of collectInputFiles(invocation, plan)) {
		writeGuestFile(root, file.path, file.contents);
	}
	ensureGuestDirectory(
		root,
		normalizeGuestPath(invocation.outputPath).split('/').slice(0, -1).join('/')
	);
	const toolBytes = await fetchRuntimeAssetBytes(
		resolveVersionedAssetUrl(runtimeBaseUrl, invocation.toolAsset),
		`${invocation.tool}.wasm`,
		fetchImpl,
		true,
		(loaded, total) => reportAssetProgress?.(invocation.toolAsset, loaded, total)
	);
	const stdout = new CaptureFd();
	const stderr = new CaptureFd();
	const wasiInstance = new WASI(
		invocation.args,
		Object.entries(invocation.env).map(([key, value]) => `${key}=${value}`),
		[
			new OpenFile(new File(new Uint8Array(), { readonly: true })),
			stdout,
			stderr,
			new PreopenDirectory('/', root.contents)
		],
		{ debug: false }
	);
	const module = await WebAssembly.compile(toStandaloneBytes(toolBytes));
	const instance = await WebAssembly.instantiate(module, {
		wasi_snapshot_preview1: wasiInstance.wasiImport
	});
	const exitCode = wasiInstance.start(instance as unknown as {
		exports: {
			memory: WebAssembly.Memory;
			_start: () => unknown;
		};
	});
	const outputBytes = readGuestFile(root, invocation.outputPath);
	return {
		exitCode,
		stdout: stdout.getText(),
		stderr: stderr.getText(),
		outputs: outputBytes
			? {
					[invocation.outputPath]: outputBytes
				}
			: {}
	};
}
