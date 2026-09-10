import { CLANG_RESOURCE_HEADERS } from './clang-resource-headers.generated.js';

export const CLANG_RESOURCE_HEADER_PROVENANCE = Object.freeze({
	name: 'clang',
	version: '22.1.8',
	revision: 'ca7933e47d3a3451d81e72ac174dcb5aa28b59d1'
});
export const CLANG_RESOURCE_HEADER_DIRECTORY = '/lib/clang/22';

interface ResourceHeaderFileSystem {
	readFile(path: string): Uint8Array | null;
	mkdirTree(path: string): void;
	writeFile(path: string, contents: Uint8Array): void;
}

/** Repair the pinned producer's trimmed resource set using its exact LLVM sources. */
export function installClangResourceHeaders(
	fs: ResourceHeaderFileSystem,
	provenance?: { name: string; version: string; revision: string },
	resourceDir?: string
) {
	if (
		provenance?.name !== CLANG_RESOURCE_HEADER_PROVENANCE.name ||
		provenance.version !== CLANG_RESOURCE_HEADER_PROVENANCE.version ||
		provenance.revision !== CLANG_RESOURCE_HEADER_PROVENANCE.revision ||
		resourceDir !== CLANG_RESOURCE_HEADER_DIRECTORY
	)
		return false;

	const decoder = new TextDecoder('utf-8', { fatal: true });
	const missing: Array<[string, string]> = [];
	for (const [name, contents] of Object.entries(CLANG_RESOURCE_HEADERS)) {
		const path = `${resourceDir}/include/${name}`;
		const existing = fs.readFile(path);
		if (existing !== null) {
			if (decoder.decode(existing) !== contents) {
				throw new Error(
					`Clang ${provenance.version} resource header differs from its pinned source: ${name}`
				);
			}
		} else {
			missing.push([path, contents]);
		}
	}
	if (missing.length) fs.mkdirTree(`${resourceDir}/include`);
	const encoder = new TextEncoder();
	for (const [path, contents] of missing) fs.writeFile(path, encoder.encode(contents));
	return true;
}
